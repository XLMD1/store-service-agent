"""Allow photo sources while retaining existing original text."""
from alembic import op
import sqlalchemy as sa


revision = '0009_source_photos'
down_revision = '0008_service_sources'
branch_labels = None
depends_on = None

MATERIAL_CHECK = (
    "(text IS NOT NULL AND photo_type IS NULL AND photo_sha256 IS NULL AND photo_size IS NULL)"
    " OR (text IS NULL AND photo_type IS NOT NULL AND photo_type IN ('image/jpeg', 'image/png')"
    " AND photo_sha256 IS NOT NULL AND photo_size IS NOT NULL AND photo_size > 0)"
)


def upgrade():
    op.add_column('service_sources', sa.Column('photo_type', sa.String(16)))
    op.add_column('service_sources', sa.Column('photo_sha256', sa.String(64)))
    op.add_column('service_sources', sa.Column('photo_size', sa.Integer()))
    op.alter_column('service_sources', 'text', nullable=True)
    op.create_check_constraint('ck_service_source_material', 'service_sources', MATERIAL_CHECK)


def downgrade():
    db = op.get_bind()
    db.execute(sa.text('LOCK TABLE service_sources IN ACCESS EXCLUSIVE MODE'))
    if db.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM service_sources WHERE photo_type IS NOT NULL)')):
        raise RuntimeError('Cannot downgrade while saved service photos exist')
    op.drop_constraint('ck_service_source_material', 'service_sources', type_='check')
    op.alter_column('service_sources', 'text', nullable=False)
    for column in ('photo_size', 'photo_sha256', 'photo_type'):
        op.drop_column('service_sources', column)
