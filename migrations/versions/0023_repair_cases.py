"""Keep submitted field experience separate from manufacturer evidence."""
from alembic import op
import sqlalchemy as sa

revision = '0023_repair_cases'
down_revision = '0022_repair_answers'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('repair_cases',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('problem', sa.Text(), nullable=False),
        sa.Column('conditions', sa.Text(), nullable=False),
        sa.Column('outcome', sa.Text(), nullable=False),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('reviewed_at', sa.DateTime(timezone=True)),
        sa.Column('review_note', sa.Text()),
        sa.Column('review_request_id', sa.String(36)),
        sa.UniqueConstraint('submitted_by', 'request_id'),
        sa.UniqueConstraint('reviewed_by', 'review_request_id'),
        sa.CheckConstraint("state IN ('pending_review','reviewed','rejected')", name='ck_repair_case_state'),
    )


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM repair_cases)')):
        raise RuntimeError('Cannot downgrade while repair cases exist')
    op.drop_table('repair_cases')
