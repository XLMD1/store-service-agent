"""Preserve date-only inbound events without inventing a timestamp."""
from alembic import op
import sqlalchemy as sa


revision = '0004_document_occurrence'
down_revision = 'f803b23a24b7'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('inventory_documents', 'occurred_at', existing_type=sa.DateTime(timezone=True), nullable=True)
    op.add_column('inventory_documents', sa.Column('occurred_date', sa.Date(), nullable=True))
    op.add_column('inventory_documents', sa.Column('occurred_precision', sa.String(16), nullable=False, server_default='datetime'))
    op.add_column('inventory_documents', sa.Column('t0_relation', sa.String(32), nullable=True))
    op.add_column('inventory_documents', sa.Column('boundary_note', sa.String(1000), nullable=True))
    op.create_check_constraint('ck_document_occurrence', 'inventory_documents',
        "(occurred_precision = 'date' AND occurred_date IS NOT NULL AND occurred_at IS NULL) OR "
        "(occurred_precision = 'datetime' AND occurred_at IS NOT NULL AND occurred_date IS NULL)")


def downgrade():
    # The old schema cannot represent dates faithfully. Refuse rather than invent midnight.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM inventory_documents WHERE occurred_precision='date'")):
        raise RuntimeError('Cannot downgrade date-only events; restore a compatible pre-migration backup instead')
    op.drop_constraint('ck_document_occurrence', 'inventory_documents', type_='check')
    for column in ['boundary_note', 't0_relation', 'occurred_precision', 'occurred_date']:
        op.drop_column('inventory_documents', column)
    op.alter_column('inventory_documents', 'occurred_at', existing_type=sa.DateTime(timezone=True), nullable=False)
