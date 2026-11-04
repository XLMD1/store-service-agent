from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import or_, select

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


def execute(db, user, item):
    """Resolve names, then call existing Python query/draft functions; never confirm."""
    p, chosen, candidates = item.plan, item.selections, {}
    action = p['action']
    ensure_permission(db, user, permission(action))

    def target(cls, field, required=True):
        if chosen.get(field):
            row = db.get(cls, chosen[field])
            if not row or getattr(row, 'enabled', True) is False:
                raise HTTPException(409, 'Selected object is no longer available')
            return row
        value = p.get(field, '').strip()
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
        if value:
            rows = exact or [row for row in rows if value.casefold() in str(
                getattr(row, 'name', getattr(row, 'display_name', ''))).casefold() or
                cls is Customer and value in ((row.phone or '')+' '+(row.address or ''))]
        if required or value:
            candidates[field] = [{'id': row.id, 'label': (getattr(row, 'name', getattr(row, 'display_name', ''))+
                (' · 区分编号 '+row.code if cls is Warehouse else '')+
                (' · '+(row.phone or '联系方式未知')+' · '+(row.address or '地址未知') if cls is Customer else ''))}
                for row in rows[:50]]
        return None

    warehouse = model = customer = original = reservation = None
    if action in ['reservation_pickup', 'reservation_cancel']:
        reference = chosen.get('reference') or p.get('reference')
        query = select(Reservation).join(InventoryAccount).join(Customer).where(
            Reservation.registered_quantity > Reservation.picked_quantity+Reservation.cancelled_quantity)
        if p.get('customer') or chosen.get('customer'):
            customer = target(Customer, 'customer')
            if customer:
                query = query.where(Reservation.customer_id == customer.id)
        for cls, field, column in [(Warehouse, 'warehouse', InventoryAccount.warehouse_id),
                                   (ProductModel, 'model', InventoryAccount.model_id)]:
            if p.get(field) or chosen.get(field):
                row = target(cls, field)
                if row:
                    query = query.where(column == row.id)
        if reference:
            query = query.where(Reservation.id == reference)
        elif not customer and p.get('customer'):
            key = '%'+p['customer']+'%'
            query = query.where(or_(Customer.display_name.ilike(key), Customer.phone.ilike(key), Customer.address.ilike(key)))
        rows = list(db.scalars(query.order_by(Reservation.id).limit(50)))
        if reference and len(rows) == 1:
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
            candidates['reference'] = [{'id': row.id, 'label': f'{row.kind} · 有效{row.effective_quantity}台 · {row.id}'}
                for row in db.scalars(select(InventoryDocument).where(InventoryDocument.kind.in_(['inbound','outbound','pickup'])).order_by(InventoryDocument.id).limit(50))]
    else:
        warehouse = target(Warehouse, 'warehouse', action not in ['query_reservations', 'query_statistics'])
        model = target(ProductModel, 'model', action not in ['query_inventory', 'query_reservations', 'query_statistics'])
        if action == 'reservation_create':
            customer = target(Customer, 'customer')
    item.candidates = candidates
    if candidates:
        item.state, item.question = 'missing', '请人工选择或补充：'+ '、'.join(
            {'warehouse':'库房','model':'型号','customer':'客户及地址','reference':'具体预留或原单'}[key] for key in candidates)
        return
    w, m = warehouse.id if warehouse else None, model.id if model else None
    if action.startswith('query_'):
        if action == 'query_inventory':
            result = overview(w, m, user=user, db=db)
        elif action == 'query_reservations':
            result = {'reservations': reservations(p.get('customer', ''), w, m, True, user=user, db=db)}
        elif action == 'query_statistics':
            if not p.get('start') or not p.get('end'):
                item.state, item.question = 'missing', '请补充统计起止日期。'
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
            item.state, item.question = 'missing', '请核对期初预留：明确没有期初留货时补充“期初预留为0”；有留货请到期初建账表单逐笔填写客户和剩余量。'
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
        if existing.state == 'succeeded':
            raise HTTPException(409,'Already submitted; corrections require a separate task')
    result = prepare_draft(db, user, parameters, existing, kind=action)
    item.draft_id, item.state = result['id'], 'awaiting_confirmation' if result['preview'] else 'missing'
    item.question = '' if result['preview'] else '请在原表单补齐：'+'、'.join(result['missing_fields'])
