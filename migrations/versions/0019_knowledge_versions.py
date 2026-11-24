"""Persist reviewed manual editions and their original scans."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0019_knowledge_versions'
down_revision = '0018_source_review_grants'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'knowledge_versions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('document_code', sa.String(80), nullable=False),
        sa.Column('edition', sa.String(80), nullable=False),
        sa.Column('models', JSONB(), nullable=False),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('document_code', 'edition', name='uq_knowledge_edition'),
        sa.UniqueConstraint('created_by', 'request_id', name='uq_knowledge_import_request'),
        sa.CheckConstraint("state IN ('pending_review','reviewed','published','retired')", name='ck_knowledge_state'),
    )
    op.create_index('uq_knowledge_published_document', 'knowledge_versions', ['document_code'],
                    unique=True, postgresql_where=sa.text("state = 'published'"))
    op.create_table(
        'knowledge_scans',
        sa.Column('version_id', sa.String(36), sa.ForeignKey('knowledge_versions.id'), primary_key=True),
        sa.Column('position', sa.Integer(), primary_key=True),
        sa.Column('first_page', sa.Integer(), nullable=False),
        sa.Column('last_page', sa.Integer(), nullable=False),
        sa.Column('leading_pages', sa.Integer(), nullable=False),
        sa.Column('trailing_pages', sa.Integer(), nullable=False),
        sa.Column('page_height', sa.Integer(), nullable=False),
        sa.Column('mime_type', sa.String(16), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
    )
    op.create_table(
        'knowledge_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('version_id', sa.String(36), sa.ForeignKey('knowledge_versions.id'), nullable=False),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('action', sa.String(12), nullable=False),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('note', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('actor_id', 'operation_id', name='uq_knowledge_transition_request'),
        sa.UniqueConstraint('version_id', 'version', name='uq_knowledge_transition_version'),
    )


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM knowledge_versions)')):
        raise RuntimeError('Cannot downgrade while knowledge versions are saved')
    op.drop_table('knowledge_events')
    op.drop_table('knowledge_scans')
    op.drop_table('knowledge_versions')
