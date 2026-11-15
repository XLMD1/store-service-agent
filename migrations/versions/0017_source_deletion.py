"""Track sources removed by their submitters."""
from alembic import op
import sqlalchemy as sa

revision = '0017_source_deletion'
down_revision = '0016_service_agent'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_sources', sa.Column('deleted_at', sa.DateTime(timezone=True)))


def downgrade():
    op.drop_column('service_sources', 'deleted_at')
