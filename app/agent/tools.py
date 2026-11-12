from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.service import ensure_permission, now
from app.agent.extraction import warehouse_name
from app.catalog.models import Customer, ProductModel, Warehouse
from app.inventory.models import InventoryAccount, InventoryDocument, Reservation
from app.inventory.router import ledger, overview, reservations
from app.inventory.reports import statistics
from app.operations.models import Draft, Operation
from app.operations.service import PERMISSIONS, prepare_draft


def catalog_context(db):
    return {'today': now().astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat(),
        'warehouses': [row.name for row in db.scalars(select(Warehouse).where(Warehouse.enabled).limit(100))],
        'models': [{'name': row.name, 'aliases': row.aliases} for row in
                   db.scalars(select(ProductModel).where(ProductModel.enabled).limit(100))]}


def permission(action):
    return PERMISSIONS.get(action, 'inventory.read')


def missing_question(plan, unresolved_objects, missing=None):
    action = plan['action']
    fields = list(unresolved_objects)
    if missing is not None:
        fields.extend(missing)
    elif action == 'query_statistics':
        fields.extend(key for key in ('start', 'end') if not plan.get(key))
    elif not action.startswith('query_'):
        if action == 'inventory_opening':
            required = ('t0', 'on_hand', 'opening_reserved')
        elif action == 'inventory_correction':
            required = ('new_quantity',)
        elif action == 'inventory_adjustment':
            required = ('on_hand', 'occurred')
        elif action == 'reservation_create':
            required = ('quantity', 'occurred', 'basis_kind')
        else:
            required = ('quantity', 'occurred')
        fields.extend(key for key in required if plan.get(key) in (None, ''))
        occurred = plan.get('occurred')
        if occurred:
            key = 'at' if occurred['precision'] == 'datetime' else 'date'
            if not occurred.get(key):
                fields.append('occurred.' + key)
        if action in ('inventory_opening', 'reservation_pickup', 'reservation_cancel',
                      'inventory_adjustment', 'inventory_correction') and not plan.get('basis_note', '').strip():
            fields.append('basis_note')
    labels = {
        'warehouse': '具体库房', 'warehouse_id': '具体库房', 'model': '具体型号', 'model_id': '具体型号',
        'customer': '客户及地址', 'customer_id': '客户及地址',
        'reference': '要更正的原单编号' if action == 'inventory_correction' else '要办理的预留单（可提供客户、库房型号或预留单编号）',
        'reservation_id': '要办理的预留单', 'document_id': '要更正的原单',
        'quantity': '本次数量', 'on_hand': '实际盘点数量', 'new_quantity': '更正后的有效数量',
        'occurred': '实际发生日期或时刻', 'occurred.date': '实际发生日期', 'occurred.at': '实际发生时刻',
        'occurred.t0_relation': '这笔业务发生在建账当天的起点之前还是之后',
        'occurred.boundary_note': '核实该业务发生在起点之后的依据',
        'basis_kind': '留货依据类型（口头约定、已付订金或已付全款）', 'basis_note': '办理依据或原因',
        't0': '建账起点的日期和时刻', 'opening_reserved': '期初预留数量（尚未提走的留货）',
        'start': '统计开始日期', 'end': '统计结束日期',
    }
    needed = list(dict.fromkeys(labels[key] for key in fields if key in labels))
    if needed:
        return '还需要你补充：' + '、'.join(needed) + '。可以在下方回复。'
    return '请补充需要更正的信息，或重新整理这项任务。'


def inventory_question(detail):
    return {
        'Quantity exceeds available stock': '数量超过当前可售库存。请核对库存后补充可办理的数量。',
        'Quantity exceeds the selected reservation remaining amount': '数量超过该预留单剩余未提量。请补充正确数量或换一张预留单。',
        'Open this warehouse/model before recording stock events': '这个库房和型号尚未建账。请确认对象，或先办理期初建账。',
        'Events at or before T0 are already included in opening stock': '该业务发生在建账起点或更早。若日期或时刻填错，请补充实际发生时间。',
        'This warehouse/model is already opened': '该库房和型号已建账。请核对要办理的库房及型号。',
        'Start date must not be after end date': '统计开始日期晚于结束日期。请补充正确的起止日期。',
        'Corrected physical stock must cover reservations and supported quantity range': '更正后的实物数量无法覆盖现有预留。请核对并补充有效数量。',
    }.get(str(detail), '请核对并补充本笔的对象、时间或数量，再重新整理。')


def execute(db, user, item):
    """Resolve names, then call existing Python query/draft functions; never confirm."""
    p, chosen, candidates = item.plan, item.selections, {}
    missing_objects = []
    action = p['action']
    ensure_permission(db, user, permission(action))

    def target(cls, field, required=True):
        if chosen.get(field):
            row = db.get(cls, chosen[field])
            if not row or getattr(row, 'enabled', True) is False:
                raise HTTPException(409, 'Selected object is no longer available')
            return row
        value = p.get(field, '').strip()
        if field == 'model' and value in ('型号', '某型号', '未知型号', '型号未知'):
            value = ''
        if not value:
            if required:
                missing_objects.append(field)
            return None
        query = select(cls)
        if cls is not Customer:
            query = query.where(cls.enabled)
        rows = list(db.scalars(query.order_by(cls.id)))
        exact = [row for row in rows if value and (getattr(row, 'name', getattr(row, 'display_name', '')) == value
                 or cls is ProductModel and value in row.aliases)]
        if len(exact) == 1:
            return exact[0]
        if not exact and value and cls is Warehouse:
            exact = [row for row in rows if warehouse_name(row.name) == warehouse_name(value)]
            if len(exact) == 1:
                return exact[0]
        rows = exact or [row for row in rows if value.casefold() in str(
            getattr(row, 'name', getattr(row, 'display_name', ''))).casefold() or
            cls is Customer and value in ((row.phone or '')+' '+(row.address or ''))]
        candidates[field] = [{'id': row.id, 'label': (getattr(row, 'name', getattr(row, 'display_name', ''))+
            (' · 区分编号 '+row.code if cls is Warehouse else '')+
            (' · '+(row.phone or '联系方式未知')+' · '+(row.address or '地址未知') if cls is Customer else ''))}
            for row in rows[:50]]
        return None

    warehouse = model = customer = original = reservation = None
    if action in ['reservation_pickup', 'reservation_cancel']:
        reference = chosen.get('reference') or p.get('reference')
        scoped = bool(reference)
        query = select(Reservation).join(InventoryAccount).join(Customer).where(
            Reservation.registered_quantity > Reservation.picked_quantity+Reservation.cancelled_quantity)
        if p.get('customer') or chosen.get('customer'):
            customer = target(Customer, 'customer')
            if customer:
                query = query.where(Reservation.customer_id == customer.id)
                scoped = True
        for cls, field, column in [(Warehouse, 'warehouse', InventoryAccount.warehouse_id),
                                   (ProductModel, 'model', InventoryAccount.model_id)]:
            if p.get(field) or chosen.get(field):
                row = target(cls, field)
                if row:
                    query = query.where(column == row.id)
                    scoped = True
        if reference:
            query = query.where(Reservation.id == reference)
        rows = list(db.scalars(query.order_by(Reservation.id).limit(50))) if scoped and not candidates else []
        if not scoped or candidates:
            missing_objects.append('reference')
        elif reference and len(rows) == 1:
            reservation = rows[0]
        else:
            candidates['reference'] = []
            for row in rows:
                account, person = db.get(InventoryAccount, row.account_id), db.get(Customer, row.customer_id)
                w, m = db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id)
                candidates['reference'].append({'id': row.id, 'label': f'{person.display_name} · {person.address or "地址未知"} · {w.name} · {m.name} · 剩余{row.registered_quantity-row.picked_quantity-row.cancelled_quantity}台 · {row.id}'})
    elif action == 'inventory_correction':
        reference = chosen.get('reference') or p.get('reference')
        original = db.get(InventoryDocument, reference) if reference else None
        if not original or original.kind not in ['inbound', 'outbound', 'pickup']:
            missing_objects.append('reference')
    else:
        warehouse = target(Warehouse, 'warehouse', action not in ['query_reservations', 'query_statistics'])
        model = target(ProductModel, 'model', action not in ['query_inventory', 'query_reservations', 'query_statistics'])
        if action == 'reservation_create':
            customer = target(Customer, 'customer')
    item.candidates = candidates
    if candidates or missing_objects:
        item.state, item.question = 'missing', missing_question(p, [*candidates, *missing_objects])
        return
    w, m = warehouse.id if warehouse else None, model.id if model else None
    if action.startswith('query_'):
        if action == 'query_inventory':
            result = overview(w, m, user=user, db=db)
        elif action == 'query_reservations':
            result = {'reservations': reservations(p.get('customer', ''), w, m, True, user=user, db=db)}
        elif action == 'query_statistics':
            if not p.get('start') or not p.get('end'):
                item.state, item.question = 'missing', missing_question(p, {})
                return
            from datetime import date
            result = statistics(date.fromisoformat(p['start']), date.fromisoformat(p['end']), w, m, p['group_by'], user=user, db=db)
        else:
            from datetime import date
            result = {'ledger': ledger(w, m, date.fromisoformat(p['start']) if p.get('start') else None,
                date.fromisoformat(p['end']) if p.get('end') else None, None, None, user=user, db=db)}
        item.result, item.state, item.question = result, 'completed', ''
        return
    if action == 'inventory_correction':
        parameters = {'document_id': original.id, 'new_quantity': p.get('new_quantity'), 'basis_note': p['basis_note']}
    elif action in ['reservation_pickup', 'reservation_cancel']:
        parameters = {'reservation_id': reservation.id, 'quantity': p.get('quantity'), 'occurred': p.get('occurred'), 'basis_note': p['basis_note']}
    elif action == 'inventory_opening':
        if p.get('opening_reserved') != 0:
            item.state = 'missing'
            item.question = (missing_question(p, {}) if p.get('opening_reserved') is None else
                             '请到期初建账表单逐笔核对期初预留的客户和剩余数量。')
            return
        parameters = {'warehouse_id': w, 'model_id': m, 't0': p.get('t0'), 'on_hand': p.get('on_hand'),
                      'opening_reservations': [], 'basis_note': p['basis_note']}
    elif action == 'inventory_adjustment':
        parameters = {'warehouse_id': w, 'model_id': m, 'on_hand': p.get('on_hand'), 'occurred': p.get('occurred'), 'basis_note': p['basis_note']}
    else:
        parameters = {'warehouse_id': w, 'model_id': m, 'quantity': p.get('quantity'),
                      'occurred': p.get('occurred'), 'basis_note': p['basis_note']}
        if action == 'reservation_create':
            parameters.update(customer_id=customer.id, basis_kind=p.get('basis_kind'))
    existing = None
    if item.draft_id:
        db.scalars(select(Operation).where(Operation.draft_id==item.draft_id).order_by(Operation.id).with_for_update()).all()
        existing = db.scalar(select(Draft).where(Draft.id==item.draft_id).with_for_update().execution_options(populate_existing=True))
        if existing.state not in ('missing', 'ready'):
            raise HTTPException(409, 'This draft can no longer be edited')
    result = prepare_draft(db, user, parameters, existing, kind=action)
    item.draft_id, item.state = result['id'], 'awaiting_confirmation' if result['preview'] else 'missing'
    item.question = '' if result['preview'] else missing_question(p, {}, result['missing_fields'])
