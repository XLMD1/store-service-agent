"""Persist service assistant tasks and their confirmation context."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0016_service_agent'
down_revision = '0015_service_revisions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_agent_tasks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('text', sa.String(10000), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('plan', JSONB, nullable=False),
        sa.Column('contact_id', sa.String(36), sa.ForeignKey('service_contacts.id')),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('service_records.id')),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('service_sources.id')),
        sa.Column('draft_id', sa.String(36), sa.ForeignKey('service_record_drafts.id')),
        sa.Column('preview', JSONB),
        sa.Column('receipt', JSONB),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('actor_id', 'request_id', name='uq_service_agent_request'),
    )
    op.create_index('ix_service_agent_tasks_actor_id', 'service_agent_tasks', ['actor_id'])


def downgrade():
    op.drop_table('service_agent_tasks')
