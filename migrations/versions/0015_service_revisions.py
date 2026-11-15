"""Keep an audit trail for field corrections and archive voiding."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0015_service_revisions'
down_revision = '0014_service_supplements'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_records', sa.Column('voided', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        'service_record_revisions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('service_records.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.Column('reason', sa.String(500), nullable=False),
        sa.Column('before', JSONB, nullable=False),
        sa.Column('after', JSONB, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('record_id', 'version', name='uq_service_revision_version'),
        sa.UniqueConstraint('record_id', 'actor_id', 'operation_id', name='uq_service_revision_operation'),
    )


def downgrade():
    op.drop_table('service_record_revisions')
    op.drop_column('service_records', 'voided')
