"""Associate reservation operations with their source documents."""
from alembic import op
import sqlalchemy as sa

revision = '0005_reservation_operations'
down_revision = '0004_document_occurrence'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('inventory_reservations', sa.Column('basis_kind', sa.String(16), nullable=True))
    op.add_column('inventory_documents', sa.Column('reservation_id', sa.String(36), nullable=True))
    op.create_foreign_key('fk_document_reservation', 'inventory_documents', 'inventory_reservations', ['reservation_id'], ['id'])
    op.create_index('ix_inventory_documents_reservation_id', 'inventory_documents', ['reservation_id'])


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM inventory_documents WHERE kind IN ('outbound','reserve','cancel','pickup')")) or connection.scalar(sa.text(
            "SELECT count(*) FROM drafts WHERE kind IN ('inventory_outbound','reservation_create','reservation_cancel','reservation_pickup')")):
        raise RuntimeError('Cannot downgrade recorded reservation/outbound operations; use a compatible pre-migration backup')
    op.drop_index('ix_inventory_documents_reservation_id', table_name='inventory_documents')
    op.drop_constraint('fk_document_reservation', 'inventory_documents', type_='foreignkey')
    op.drop_column('inventory_documents', 'reservation_id')
    op.drop_column('inventory_reservations', 'basis_kind')
