from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission, lock_accounts
from app.catalog.models import CatalogAudit, Customer, ProductModel, Warehouse
from app.catalog.schemas import CustomerCreate, ModelCreate, ModelUpdate, WarehouseCreate, WarehouseUpdate


router = APIRouter(prefix='/api/catalog')


def serialize(row):
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def write_catalog(db, user, kind, cls, payload, target=None):
    lock_accounts(db)
    ensure_permission(db, user, 'inventory.opening' if cls is Customer else 'catalog.manage')
    values = payload.model_dump(exclude={'confirmed', 'expected_version'}, exclude_unset=True)
    before = None
    if target:
        row = db.scalar(select(cls).where(cls.id == str(target)).with_for_update())
        if not row:
            raise HTTPException(404, 'Catalog item not found')
        if row.version != payload.expected_version:
            raise HTTPException(409, 'Catalog version changed')
        if not values or any(value is None for value in values.values()):
            raise HTTPException(422, 'Supply non-null catalog changes')
        before = serialize(row)
        for key, value in values.items():
            setattr(row, key, value)
        row.version += 1
    else:
        row = cls(**values)
        db.add(row)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, 'Catalog identifier already exists') from None
    result = serialize(row)
    db.add(CatalogAudit(actor_id=user.id, target_id=row.id, kind=kind,
                        changes={'before': before, 'after': result}))
    return result


@router.get('/warehouses')
def warehouses(user=Depends(current_user), db=Depends(database, scope='function')):
    return [serialize(row) for row in db.scalars(select(Warehouse).order_by(Warehouse.code))]


@router.get('/models')
def models(user=Depends(current_user), db=Depends(database, scope='function')):
    return [serialize(row) for row in db.scalars(select(ProductModel).order_by(ProductModel.name))]


@router.get('/customers')
def customers(user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.opening')
    return [serialize(row) for row in db.scalars(select(Customer).order_by(Customer.display_name, Customer.id))]


@router.post('/warehouses', status_code=201, dependencies=[Depends(check_write)])
def add_warehouse(payload: WarehouseCreate, user=Depends(current_user), db=Depends(database, scope='function')):
    return write_catalog(db, user, 'warehouse', Warehouse, payload)


@router.post('/models', status_code=201, dependencies=[Depends(check_write)])
def add_model(payload: ModelCreate, user=Depends(current_user), db=Depends(database, scope='function')):
    return write_catalog(db, user, 'model', ProductModel, payload)


@router.post('/customers', status_code=201, dependencies=[Depends(check_write)])
def add_customer(payload: CustomerCreate, user=Depends(current_user), db=Depends(database, scope='function')):
    return write_catalog(db, user, 'customer', Customer, payload)


@router.patch('/warehouses/{target}', dependencies=[Depends(check_write)])
def edit_warehouse(target: UUID, payload: WarehouseUpdate, user=Depends(current_user), db=Depends(database, scope='function')):
    return write_catalog(db, user, 'warehouse', Warehouse, payload, target)


@router.patch('/models/{target}', dependencies=[Depends(check_write)])
def edit_model(target: UUID, payload: ModelUpdate, user=Depends(current_user), db=Depends(database, scope='function')):
    return write_catalog(db, user, 'model', ProductModel, payload, target)
