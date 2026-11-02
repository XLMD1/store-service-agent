"""Persist login cooldowns across workers and restarts."""
from alembic import op
import sqlalchemy as sa


revision = '0002_login_throttle'
down_revision = '0001_identity'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('login_throttles',
        sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('window_started_at', sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table('login_throttles')
