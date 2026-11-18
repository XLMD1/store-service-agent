from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class KnowledgeVersion(Base):
    __tablename__ = 'knowledge_versions'
    __table_args__ = (
        UniqueConstraint('document_code', 'edition', name='uq_knowledge_edition'),
        UniqueConstraint('created_by', 'request_id', name='uq_knowledge_import_request'),
        CheckConstraint("state IN ('pending_review','reviewed','published','retired')", name='ck_knowledge_state'),
        Index('uq_knowledge_published_document', 'document_code', unique=True,
              postgresql_where=text("state = 'published'")),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    request_id: Mapped[str] = mapped_column(String(36))
    request_digest: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    document_code: Mapped[str] = mapped_column(String(80))
    edition: Mapped[str] = mapped_column(String(80))
    models: Mapped[list[str]] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(20), default='pending_review')
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class KnowledgeScan(Base):
    __tablename__ = 'knowledge_scans'

    version_id: Mapped[str] = mapped_column(ForeignKey('knowledge_versions.id'), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    first_page: Mapped[int] = mapped_column(Integer)
    last_page: Mapped[int] = mapped_column(Integer)
    leading_pages: Mapped[int] = mapped_column(Integer)
    trailing_pages: Mapped[int] = mapped_column(Integer)
    page_height: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(16))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


class KnowledgeEvent(Base):
    __tablename__ = 'knowledge_events'
    __table_args__ = (
        UniqueConstraint('actor_id', 'operation_id', name='uq_knowledge_transition_request'),
        UniqueConstraint('version_id', 'version', name='uq_knowledge_transition_version'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version_id: Mapped[str] = mapped_column(ForeignKey('knowledge_versions.id'))
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    operation_id: Mapped[str] = mapped_column(String(36))
    request_digest: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(12))
    state: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
