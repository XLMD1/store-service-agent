from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class Source(Base):
    __tablename__ = 'service_sources'
    __table_args__ = (UniqueConstraint('actor_id', 'request_id', name='uq_service_source_request'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    source_kind: Mapped[str | None] = mapped_column(String(20))
    source_label: Mapped[str | None] = mapped_column(String(100))
    message_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    page_label: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(500))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
