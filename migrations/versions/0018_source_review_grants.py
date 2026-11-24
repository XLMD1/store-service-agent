"""Allow submitters to grant access to a source and its drafts."""
from alembic import op
import sqlalchemy as sa

revision = '0018_source_review_grants'
down_revision = '0017_source_deletion'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_source_review_grants',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('service_sources.id'), nullable=False),
        sa.Column('reviewer_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
    )
    op.create_index('uq_active_source_reviewer', 'service_source_review_grants', ['reviewer_id', 'source_id'],
                    unique=True, postgresql_where=sa.text('revoked_at IS NULL'))


def downgrade():
    op.drop_table('service_source_review_grants')
