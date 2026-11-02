from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.db import Base


class InventoryAccount(Base):
    __tablename__ = 'inventory_accounts'
    __table_args__ = (UniqueConstraint('warehouse_id', 'model_id', name='uq_inventory_object'),
                     CheckConstraint('on_hand >= reserved AND reserved >= 0', name='ck_inventory_balance'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    warehouse_id: Mapped[str] = mapped_column(ForeignKey('warehouses.id'))
    model_id: Mapped[str] = mapped_column(ForeignKey('product_models.id'))
    t0: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    opening_on_hand: Mapped[int] = mapped_column(Integer)
    opening_reserved: Mapped[int] = mapped_column(Integer)
    on_hand: Mapped[int] = mapped_column(Integer)
    reserved: Mapped[int] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer, default=1)
    opening_operation_id: Mapped[str] = mapped_column(ForeignKey('operations.id'), unique=True)


class Reservation(Base):
    __tablename__ = 'inventory_reservations'
    __table_args__ = (CheckConstraint('registered_quantity > 0 AND picked_quantity >= 0 AND cancelled_quantity >= 0 '
                                     'AND picked_quantity + cancelled_quantity <= registered_quantity', name='ck_reservation_quantity'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey('inventory_accounts.id'), index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey('customers.id'))
    registered_quantity: Mapped[int] = mapped_column(Integer)
    picked_quantity: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_quantity: Mapped[int] = mapped_column(Integer, default=0)
    is_opening: Mapped[bool] = mapped_column(Boolean, default=True)
    basis_note: Mapped[str] = mapped_column(String(1000))
    basis_kind: Mapped[str | None] = mapped_column(String(16))
    version: Mapped[int] = mapped_column(Integer, default=1)


class InventoryDocument(Base):
    __tablename__ = 'inventory_documents'
    __table_args__ = (CheckConstraint("(occurred_precision = 'date' AND occurred_date IS NOT NULL AND occurred_at IS NULL) OR "
                                     "(occurred_precision = 'datetime' AND occurred_at IS NOT NULL AND occurred_date IS NULL)",
                                     name='ck_document_occurrence'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey('inventory_accounts.id'))
    operation_id: Mapped[str] = mapped_column(ForeignKey('operations.id'), unique=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    kind: Mapped[str] = mapped_column(String(32))
    original_quantity: Mapped[int] = mapped_column(Integer)
    effective_quantity: Mapped[int] = mapped_column(Integer)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    occurred_date: Mapped[date | None] = mapped_column(Date)
    occurred_precision: Mapped[str] = mapped_column(String(16), default='datetime', server_default='datetime')
    t0_relation: Mapped[str | None] = mapped_column(String(32))
    boundary_note: Mapped[str | None] = mapped_column(String(1000))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    basis_note: Mapped[str] = mapped_column(String(1000))
    reservation_id: Mapped[str | None] = mapped_column(ForeignKey('inventory_reservations.id'), index=True)


class Ledger(Base):
    __tablename__ = 'inventory_ledger'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey('inventory_accounts.id'))
    document_id: Mapped[str] = mapped_column(ForeignKey('inventory_documents.id'), unique=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey('operations.id'), unique=True)
    on_hand_delta: Mapped[int] = mapped_column(Integer)
    reserved_delta: Mapped[int] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer)
