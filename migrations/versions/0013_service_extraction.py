"""Save the generated draft identifiers on their source."""
from alembic import op
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB


revision = '0013_service_extraction'
down_revision = '0012_work_fees'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_sources', Column('extracted_draft_ids', JSONB))


def downgrade():
    op.drop_column('service_sources', 'extracted_draft_ids')
