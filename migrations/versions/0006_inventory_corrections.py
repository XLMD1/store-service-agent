"""Preserve original documents and append correction history."""
from alembic import op
import sqlalchemy as sa

revision = '0006_inventory_corrections'
down_revision = '0005_reservation_operations'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('inventory_documents', sa.Column('original_document_id', sa.String(36), nullable=True))
    op.add_column('inventory_documents', sa.Column('old_quantity', sa.Integer(), nullable=True))
    op.add_column('inventory_documents', sa.Column('new_quantity', sa.Integer(), nullable=True))
    op.add_column('inventory_documents', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.create_foreign_key('fk_document_original', 'inventory_documents', 'inventory_documents', ['original_document_id'], ['id'])
    op.create_index('ix_inventory_documents_original_document_id', 'inventory_documents', ['original_document_id'])


def downgrade():
    db = op.get_bind()
    if db.scalar(sa.text("SELECT count(*) FROM inventory_documents WHERE kind IN ('adjustment','correction')")) or db.scalar(sa.text("SELECT count(*) FROM drafts WHERE kind IN ('inventory_adjustment','inventory_correction')")):
        raise RuntimeError('Cannot discard correction history; use a compatible pre-migration backup')
    op.drop_index('ix_inventory_documents_original_document_id', table_name='inventory_documents')
    op.drop_constraint('fk_document_original', 'inventory_documents', type_='foreignkey')
    for column in ['version', 'new_quantity', 'old_quantity', 'original_document_id']:
        op.drop_column('inventory_documents', column)
