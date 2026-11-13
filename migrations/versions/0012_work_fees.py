"""Store work orders, individual labor fees, and immutable decisions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0012_work_fees'
down_revision = '0011_service_archive'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'work_orders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('location', sa.String(500), nullable=False),
        sa.Column('description', sa.String(2000), nullable=False),
        sa.Column('scheduled_on', sa.Date()),
        sa.Column('service_record_id', sa.String(36), sa.ForeignKey('service_records.id')),
        sa.Column('reference', sa.String(100)),
        sa.Column('backfill_from', sa.Date()),
        sa.UniqueConstraint('created_by', 'request_id', name='uq_work_order_request'),
    )
    op.create_table(
        'worker_fees',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('work_id', sa.String(36), sa.ForeignKey('work_orders.id'), nullable=False),
        sa.Column('worker_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(16), nullable=False),
        sa.Column('worked_on', sa.Date()),
        sa.Column('report', JSONB()),
        sa.Column('claimed_cents', sa.Integer()),
        sa.Column('confirmed_cents', sa.Integer()),
        sa.Column('settlement', JSONB()),
        sa.UniqueConstraint('work_id', 'worker_id', name='uq_worker_fee_work_worker'),
        sa.CheckConstraint(
            "(state IN ('assigned', 'review') AND confirmed_cents IS NULL) OR "
            "(state IN ('payable', 'deducted', 'paid') AND confirmed_cents IS NOT NULL AND confirmed_cents >= 0)",
            name='ck_worker_fee_state_amount',
        ),
    )
    op.create_index('ix_worker_fees_worker_id', 'worker_fees', ['worker_id'])
    op.create_index('ix_worker_fees_worked_on', 'worker_fees', ['worked_on'])
    op.create_table(
        'work_fee_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('fee_id', sa.String(36), sa.ForeignKey('worker_fees.id'), nullable=False),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('decision', JSONB(), nullable=False),
        sa.Column('before', JSONB(), nullable=False),
        sa.Column('result', JSONB(), nullable=False),
        sa.UniqueConstraint('actor_id', 'operation_id', name='uq_work_fee_operation'),
    )
    op.create_index('ix_work_fee_events_fee_id', 'work_fee_events', ['fee_id'])


def downgrade():
    db = op.get_bind()
    db.execute(sa.text('LOCK TABLE work_orders, worker_fees, work_fee_events IN ACCESS EXCLUSIVE MODE'))
    if db.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM work_orders)')):
        raise RuntimeError('Cannot downgrade while work orders exist')
    op.drop_table('work_fee_events')
    op.drop_table('worker_fees')
    op.drop_table('work_orders')
