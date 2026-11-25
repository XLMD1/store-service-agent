"""Explicit local HTTP benchmark, using the guarded PostgreSQL integration fixtures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from tests.acceptance.benchmark_timing import print_timings
from threading import Barrier
from time import perf_counter
from uuid import uuid4

import httpx2
from sqlalchemy import func, insert, select

from app.inventory.models import InventoryAccount, InventoryDocument, Ledger
from app.operations.models import Draft, Operation
from tests.integration.test_auth import OWNER
from tests.integration.test_inventory_opening import opening
from tests.integration.test_inventory_operations import opened
from tests.integration.test_process_restart import process_config, workbench_process


def test_inventory_queries(application, opened, workbench_process):
    client, params = opened
    target = {key: params[key] for key in ('warehouse_id', 'model_id')}
    actor = client.get('/api/auth/me').json()['id']
    first_day = date(2026, 10, 2)
    with application.state.sessions.begin() as db:
        account = db.scalars(select(InventoryAccount)).one()
        drafts, operations, documents, entries = [], [], [], []
        for index in range(9999):
            draft_id, operation_id, document_id = [str(uuid4()) for _ in range(3)]
            day = first_day + timedelta(days=index % 100)
            drafts.append(dict(id=draft_id, created_by=actor, kind='inventory_inbound', state='confirmed',
                               parameters={}, target_versions={}, missing_fields=[]))
            operations.append(dict(id=operation_id, draft_id=draft_id, draft_version=1, actor_id=actor,
                                   parameters_digest='0'*64, target_versions={}, state='succeeded'))
            documents.append(dict(id=document_id, account_id=account.id, operation_id=operation_id, actor_id=actor,
                                  kind='inbound', original_quantity=1, effective_quantity=1, occurred_precision='date',
                                  occurred_date=day, registered_at=account.t0 + timedelta(days=1 + index % 100),
                                  basis_note='虚构入库基准样例'))
            entries.append(dict(account_id=account.id, operation_id=operation_id, document_id=document_id,
                                on_hand_delta=1, reserved_delta=0, version=index + 2))
        for model, rows in [(Draft, drafts), (Operation, operations), (InventoryDocument, documents), (Ledger, entries)]:
            db.execute(insert(model), rows)
        account.on_hand += len(entries)
        account.version += len(entries)
        assert db.scalar(select(func.count()).select_from(Ledger)) == 10000
    assert client.get('/api/inventory/reconciliation', params=target).json()['consistent']

    origin, server = workbench_process
    ready = Barrier(5, timeout=60)

    def measure(worker):
        samples = []
        with httpx2.Client(base_url=origin, trust_env=False, timeout=60) as session:
            csrf = session.get('/api/auth/csrf').json()['csrf_token']
            session.post('/api/auth/login', json=OWNER, headers={'Origin': origin, 'X-CSRF-Token': csrf}).raise_for_status()
            for turn in range(4):
                offset = worker * 4 + turn
                day = (first_day + timedelta(days=offset)).isoformat()
                expected = list(range(offset + 2, 10001, 100))[::-1]
                for endpoint in ('balance', 'ledger', 'statistics'):
                    query = target if endpoint == 'balance' else {**target, 'start': day, 'end': day}
                    ready.wait()
                    start = perf_counter()
                    response = session.get('/api/inventory/' + endpoint, params=query)
                    samples.append((endpoint, (perf_counter() - start) * 1000, float(response.headers['x-benchmark-app-ms'])))
                    response.raise_for_status()
                    result = response.json()
                    if endpoint == 'balance':
                        assert [result[k] for k in ('on_hand', 'reserved', 'available', 'version')] == [10009, 3, 10006, 10000]
                    elif endpoint == 'ledger':
                        assert [row['version'] for row in result] == expected
                        assert all(row['on_hand_delta'] == 1 and row['reserved_delta'] == 0 for row in result)
                    else:
                        assert result['total_quantity'] == len(expected) == len(result['documents'])
                        assert all(row['occurred']['date'] == day for row in result['documents'])
        return samples

    with server('tests.acceptance.benchmark_timing:timed_app'), ThreadPoolExecutor(max_workers=5) as pool:
        samples = [sample for batch in pool.map(measure, range(5)) for sample in batch]
    for endpoint in ('balance', 'ledger', 'statistics'):
        print_timings(samples, endpoint, 20)
