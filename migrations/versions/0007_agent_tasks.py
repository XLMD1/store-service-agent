"""Agent tasks plus the pinned LangGraph PostgresSaver 3.2 checkpoint schema."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0007_agent_tasks'
down_revision = '0006_inventory_corrections'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('agent_tasks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False), sa.Column('text', sa.Text(), nullable=False),
        sa.Column('followups', JSONB(), nullable=False), sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('plan_revision', sa.Integer(), nullable=False), sa.Column('planned_revision', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(32), nullable=False),
        sa.Column('question', sa.Text(), nullable=False), sa.Column('model_attempts', sa.Integer(), nullable=False),
        sa.Column('known_tokens', sa.Integer(), nullable=False), sa.Column('tool_calls', sa.Integer(), nullable=False),
        sa.Column('lease', sa.String(36)), sa.Column('lease_until', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('actor_id', 'request_id', name='uq_agent_request'))
    op.create_index('ix_agent_tasks_actor_id', 'agent_tasks', ['actor_id'])
    op.create_table('agent_task_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('task_id', sa.String(36), sa.ForeignKey('agent_tasks.id'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False), sa.Column('plan', JSONB(), nullable=False),
        sa.Column('state', sa.String(32), nullable=False), sa.Column('question', sa.Text(), nullable=False),
        sa.Column('candidates', JSONB(), nullable=False),
        sa.Column('selections', JSONB(), nullable=False),
        sa.Column('draft_id', sa.String(36), sa.ForeignKey('drafts.id')), sa.Column('result', JSONB()),
        sa.UniqueConstraint('task_id', 'position', name='uq_agent_item_position'))
    op.create_index('ix_agent_task_items_task_id', 'agent_task_items', ['task_id'])
    # Frozen upstream DDL; normal indexes preserve transactional Alembic upgrades.
    op.execute('CREATE TABLE checkpoint_migrations (v INTEGER PRIMARY KEY)')
    op.execute("""CREATE TABLE checkpoints (thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL, parent_checkpoint_id TEXT, type TEXT, checkpoint JSONB NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}', PRIMARY KEY(thread_id,checkpoint_ns,checkpoint_id))""")
    op.execute("""CREATE TABLE checkpoint_blobs (thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL, version TEXT NOT NULL, type TEXT NOT NULL, blob BYTEA,
        PRIMARY KEY(thread_id,checkpoint_ns,channel,version))""")
    op.execute("""CREATE TABLE checkpoint_writes (thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL, task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL,
        type TEXT, blob BYTEA NOT NULL, task_path TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(thread_id,checkpoint_ns,checkpoint_id,task_id,idx))""")
    for table in ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']:
        op.create_index(table+'_thread_id_idx', table, ['thread_id'])
    op.execute('INSERT INTO checkpoint_migrations(v) SELECT generate_series(0,9)')


def downgrade():
    db = op.get_bind()
    if any(db.scalar(sa.text('SELECT count(*) FROM '+table)) for table in
           ['agent_tasks', 'checkpoints', 'checkpoint_blobs', 'checkpoint_writes']):
        raise RuntimeError('Cannot discard Agent task or checkpoint history; use a compatible backup')
    for table in ['agent_task_items', 'agent_tasks', 'checkpoint_writes', 'checkpoint_blobs', 'checkpoints', 'checkpoint_migrations']:
        op.drop_table(table)
