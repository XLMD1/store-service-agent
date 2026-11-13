from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class WorkOrder(Base):
    __tablename__ = 'work_orders'
    __table_args__ = (UniqueConstraint('created_by', 'request_id', name='uq_work_order_request'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    request_id: Mapped[str] = mapped_column(String(36))
    request_digest: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    location: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(String(2000))
    scheduled_on: Mapped[date | None] = mapped_column(Date)
    service_record_id: Mapped[str | None] = mapped_column(ForeignKey('service_records.id'))
    reference: Mapped[str | None] = mapped_column(String(100))
    backfill_from: Mapped[date | None] = mapped_column(Date)


class WorkerFee(Base):
    __tablename__ = 'worker_fees'
    __table_args__ = (
        UniqueConstraint('work_id', 'worker_id', name='uq_worker_fee_work_worker'),
        CheckConstraint(
            "(state IN ('assigned', 'review') AND confirmed_cents IS NULL) OR "
            "(state IN ('payable', 'deducted', 'paid') AND confirmed_cents IS NOT NULL AND confirmed_cents >= 0)",
            name='ck_worker_fee_state_amount',
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    work_id: Mapped[str] = mapped_column(ForeignKey('work_orders.id'))
    worker_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(16))
    worked_on: Mapped[date | None] = mapped_column(Date, index=True)
    report: Mapped[dict | None] = mapped_column(JSONB)
    claimed_cents: Mapped[int | None] = mapped_column(Integer)
    confirmed_cents: Mapped[int | None] = mapped_column(Integer)
    settlement: Mapped[dict | None] = mapped_column(JSONB)


class FeeEvent(Base):
    __tablename__ = 'work_fee_events'
    __table_args__ = (UniqueConstraint('actor_id', 'operation_id', name='uq_work_fee_operation'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fee_id: Mapped[str] = mapped_column(ForeignKey('worker_fees.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    operation_id: Mapped[str] = mapped_column(String(36))
    request_digest: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decision: Mapped[dict] = mapped_column(JSONB)
    before: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
