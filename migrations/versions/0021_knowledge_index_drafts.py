"""Keep OCR candidates separate from reviewed manual evidence."""

from alembic import op
import sqlalchemy as sa

revision = '0021_knowledge_index_drafts'
down_revision = '0020_knowledge_page_index'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('knowledge_page_index', sa.Column('source_excerpt', sa.Text(), server_default='', nullable=False))
    op.create_table(
        'knowledge_index_drafts',
        sa.Column('version_id', sa.String(36), sa.ForeignKey('knowledge_versions.id'), primary_key=True),
        sa.Column('page', sa.Integer(), primary_key=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('keywords', sa.Text(), nullable=False),
        sa.Column('source_excerpt', sa.Text(), nullable=False),
        sa.CheckConstraint("status IN ('ready','needs_review','failed')", name='ck_knowledge_index_draft_status'),
    )


def downgrade():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_index_drafts) OR "
                           "EXISTS (SELECT 1 FROM knowledge_page_index WHERE source_excerpt <> '')")):
        raise RuntimeError('Cannot downgrade while manual OCR drafts or reviewed excerpts exist')
    op.drop_table('knowledge_index_drafts')
    op.drop_column('knowledge_page_index', 'source_excerpt')
