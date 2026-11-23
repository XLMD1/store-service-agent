"""Store cited assistant results and their feedback."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0022_repair_answers'
down_revision = '0021_knowledge_index_drafts'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('repair_answers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('result', JSONB(), nullable=False),
        sa.Column('feedback', JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM repair_answers)')):
        raise RuntimeError('Cannot downgrade while repair answers exist')
    op.drop_table('repair_answers')
