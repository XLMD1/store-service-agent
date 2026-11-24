"""Store human-verified manual page titles and keywords."""

from alembic import op
import sqlalchemy as sa

revision = '0020_knowledge_page_index'
down_revision = '0019_knowledge_versions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'knowledge_page_index',
        sa.Column('version_id', sa.String(36), sa.ForeignKey('knowledge_versions.id'), primary_key=True),
        sa.Column('page', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('keywords', sa.Text(), nullable=False),
        sa.Column('search_text', sa.Text(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM knowledge_page_index)')):
        raise RuntimeError('Cannot downgrade while verified page entries exist')
    op.drop_table('knowledge_page_index')
