from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import new_id
from app.auth.service import now
from app.db import Base


class AgentTask(Base):
    __tablename__ = 'agent_tasks'
    __table_args__ = (UniqueConstraint('actor_id', 'request_id', name='uq_agent_request'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    followups: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    plan_revision: Mapped[int] = mapped_column(Integer, default=1)
    planned_revision: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String(32), default='processing')
    question: Mapped[str] = mapped_column(Text, default='')
    model_attempts: Mapped[int] = mapped_column(Integer, default=0)
    known_tokens: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    lease: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)


class AgentTaskItem(Base):
    __tablename__ = 'agent_task_items'
    __table_args__ = (UniqueConstraint('task_id', 'position', name='uq_agent_item_position'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey('agent_tasks.id'), index=True)
    position: Mapped[int] = mapped_column(Integer)
    plan: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(32), default='missing')
    question: Mapped[str] = mapped_column(Text, default='')
    candidates: Mapped[dict] = mapped_column(JSONB, default=dict)
    selections: Mapped[dict] = mapped_column(JSONB, default=dict)
    draft_id: Mapped[str | None] = mapped_column(ForeignKey('drafts.id'), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
