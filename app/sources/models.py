from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class Source(Base):
    __tablename__ = 'service_sources'
    __table_args__ = (
        UniqueConstraint('actor_id', 'request_id', name='uq_service_source_request'),
        CheckConstraint(
            "(text IS NOT NULL AND photo_type IS NULL AND photo_sha256 IS NULL AND photo_size IS NULL)"
            " OR (text IS NULL AND photo_type IS NOT NULL AND photo_type IN ('image/jpeg', 'image/png')"
            " AND photo_sha256 IS NOT NULL AND photo_size IS NOT NULL AND photo_size > 0)",
            name='ck_service_source_material',
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str | None] = mapped_column(Text)
    photo_type: Mapped[str | None] = mapped_column(String(16))
    photo_sha256: Mapped[str | None] = mapped_column(String(64))
    photo_size: Mapped[int | None] = mapped_column(Integer)
    source_kind: Mapped[str | None] = mapped_column(String(20))
    source_label: Mapped[str | None] = mapped_column(String(100))
    message_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    page_label: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(500))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
