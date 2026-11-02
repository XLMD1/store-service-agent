from sqlalchemy import ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.db import Base


class Draft(Base):
    __tablename__ = 'drafts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    version: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(32))
    parameters: Mapped[dict] = mapped_column(JSONB)
    target_versions: Mapped[dict] = mapped_column(JSONB)
    missing_fields: Mapped[list] = mapped_column(JSONB)
    preview: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    state: Mapped[str] = mapped_column(String(32))


class Operation(Base):
    __tablename__ = 'operations'
    __table_args__ = (Index('uq_successful_draft', 'draft_id', unique=True,
                           postgresql_where=text("state = 'succeeded'")),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    draft_id: Mapped[str] = mapped_column(ForeignKey('drafts.id'), index=True)
    draft_version: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    parameters_digest: Mapped[str] = mapped_column(String(64))
    target_versions: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(32))
    confirmed_at: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
