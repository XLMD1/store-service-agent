"""Save service review drafts linked to their original sources."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0010_service_record_drafts'
down_revision = '0009_source_photos'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_record_drafts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('service_sources.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('fields', JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('source_id', 'request_id', name='uq_service_draft_request'),
    )


def downgrade():
    db = op.get_bind()
    db.execute(sa.text('LOCK TABLE service_record_drafts IN ACCESS EXCLUSIVE MODE'))
    if db.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM service_record_drafts)')):
        raise RuntimeError('Cannot downgrade while saved service drafts exist')
    op.drop_table('service_record_drafts')
