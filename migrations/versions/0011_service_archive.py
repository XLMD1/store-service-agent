"""Add reviewed customer-address associations and archived service records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0011_service_archive'
down_revision = '0010_service_record_drafts'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_record_drafts', sa.Column('archive_preview', JSONB()))
    op.create_table(
        'service_contacts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(100)),
        sa.Column('phone', sa.String(100)),
        sa.Column('phone_key', sa.String(15)),
        sa.Column('address', sa.String(500)),
        sa.Column('address_key', sa.String()),
    )
    op.create_index('ix_service_contacts_phone_key', 'service_contacts', ['phone_key'])
    op.create_table(
        'service_records',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('draft_id', sa.String(36), sa.ForeignKey('service_record_drafts.id'), nullable=False, unique=True),
        sa.Column('contact_id', sa.String(36), sa.ForeignKey('service_contacts.id'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False, unique=True),
        sa.Column('archived_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('fields', JSONB(), nullable=False),
    )
    op.create_index('ix_service_records_contact_id', 'service_records', ['contact_id'])


def downgrade():
    db = op.get_bind()
    db.execute(sa.text('LOCK TABLE service_records, service_contacts IN ACCESS EXCLUSIVE MODE'))
    if db.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM service_records) OR EXISTS (SELECT 1 FROM service_contacts)')):
        raise RuntimeError('Cannot downgrade while archived service records exist')
    op.drop_table('service_records')
    op.drop_table('service_contacts')
    op.drop_column('service_record_drafts', 'archive_preview')
