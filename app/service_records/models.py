from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class ServiceRecordDraft(Base):
    __tablename__ = 'service_record_drafts'
    __table_args__ = (UniqueConstraint('source_id', 'request_id', name='uq_service_draft_request'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(ForeignKey('service_sources.id'))
    request_id: Mapped[str] = mapped_column(String(36))
    request_digest: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    fields: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    archive_preview: Mapped[dict | None] = mapped_column(JSONB)


class ServiceContact(Base):
    __tablename__ = 'service_contacts'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(100))
    phone_key: Mapped[str | None] = mapped_column(String(15), index=True)
    address: Mapped[str | None] = mapped_column(String(500))
    address_key: Mapped[str | None] = mapped_column(String)


class ServiceRecord(Base):
    __tablename__ = 'service_records'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    draft_id: Mapped[str] = mapped_column(ForeignKey('service_record_drafts.id'), unique=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey('service_contacts.id'), index=True)
    operation_id: Mapped[str] = mapped_column(String(36), unique=True)
    archived_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    archived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    fields: Mapped[dict] = mapped_column(JSONB)
