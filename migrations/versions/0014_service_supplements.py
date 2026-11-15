"""Version archived service records and keep append-only results."""
from alembic import op
import sqlalchemy as sa


revision = '0014_service_supplements'
down_revision = '0013_service_extraction'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_records', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.create_table(
        'service_record_supplements',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('record_id', sa.String(36), sa.ForeignKey('service_records.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('service_sources.id'), nullable=False),
        sa.Column('result', sa.String(4000), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('record_id', 'version', name='uq_service_supplement_version'),
        sa.UniqueConstraint('record_id', 'actor_id', 'operation_id', name='uq_service_supplement_operation'),
    )


def downgrade():
    op.drop_table('service_record_supplements')
    op.drop_column('service_records', 'version')
