from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth.router import current_user, database
from app.auth.service import ensure_permission
from app.catalog.models import ProductModel, Warehouse
from app.inventory.service import balance_result, find_account


router = APIRouter(prefix='/api/inventory')


@router.get('/balance')
def balance(warehouse_id: UUID, model_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    warehouse, model = db.get(Warehouse, str(warehouse_id)), db.get(ProductModel, str(model_id))
    if not warehouse or not model:
        raise HTTPException(404, 'Warehouse or model not found')
    return balance_result(db, warehouse, model, find_account(db, warehouse.id, model.id))
