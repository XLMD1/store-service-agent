"""Save original service text and submission metadata."""
from alembic import op
import sqlalchemy as sa


revision = '0008_service_sources'
down_revision = '0007_agent_tasks'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('source_kind', sa.String(20)),
        sa.Column('source_label', sa.String(100)),
        sa.Column('message_time', sa.DateTime(timezone=True)),
        sa.Column('page_label', sa.String(40)),
        sa.Column('note', sa.String(500)),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('actor_id', 'request_id', name='uq_service_source_request'),
    )
    op.create_index('ix_service_sources_actor_id', 'service_sources', ['actor_id'])


def downgrade():
    db = op.get_bind()
    db.execute(sa.text('LOCK TABLE service_sources IN ACCESS EXCLUSIVE MODE'))
    if db.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM service_sources)')):
        raise RuntimeError('Cannot downgrade while saved service sources exist')
    op.drop_table('service_sources')
