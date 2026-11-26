"""Run explicitly with pytest -s against the dedicated test database."""
from concurrent.futures import ThreadPoolExecutor
from tests.acceptance.benchmark_timing import print_timings
from threading import Barrier
from time import perf_counter
from uuid import uuid4

import httpx2
from fastapi.testclient import TestClient
from sqlalchemy import insert

from app.service_records.models import ServiceContact, ServiceRecord, ServiceRecordDraft
from tests.integration.test_auth import OWNER, login
from tests.integration.test_process_restart import process_config, workbench_process
from tests.integration.test_sources import source_payload, submit


def test_archive_search_baseline(application, workbench_process):
    with TestClient(application) as client:
        owner_id = login(client).json()['id']
        source = submit(client, source_payload())
        assert source.status_code == 201
        source_id = source.json()['id']

    contacts, drafts, records = [], [], []
    for index in range(1000):
        address = f'虚构基准小区{index:04d}室'
        phone = f'0000000{index:04d}'
        fields = {'address': address, 'phone': phone, 'problem': '基准样例'}
        contact_id, draft_id = str(uuid4()), str(uuid4())
        contacts.append(dict(id=contact_id, address=address, address_key=address, phone=phone, phone_key=phone))
        drafts.append(dict(id=draft_id, source_id=source_id, request_id=str(uuid4()), request_digest='0'*64, fields=fields))
        records.append(dict(contact_id=contact_id, draft_id=draft_id, archived_by=owner_id,
                            operation_id=str(uuid4()), fields=fields))
    with application.state.sessions.begin() as db:
        for model, rows in [(ServiceContact, contacts), (ServiceRecordDraft, drafts), (ServiceRecord, records)]:
            db.execute(insert(model), rows)

    origin, server = workbench_process
    ready = Barrier(5, timeout=20)

    def measure(worker):
        samples = []
        with httpx2.Client(base_url=origin, trust_env=False) as client:
            headers = {'Origin': origin, 'X-CSRF-Token': client.get('/api/auth/csrf').json()['csrf_token']}
            client.post('/api/auth/login', json=OWNER, headers=headers).raise_for_status()
            headers['X-CSRF-Token'] = client.get('/api/auth/csrf').json()['csrf_token']
            ready.wait()
            for turn in range(40):
                item = contacts[(worker * 200 + turn * 17) % len(contacts)]
                key = 'phone' if turn % 2 == 0 else 'address'
                query = item[key] if key == 'phone' else item[key][-5:]
                start = perf_counter()
                response = client.post('/api/service-records/search', json={'q': query}, headers=headers)
                samples.append((key, (perf_counter() - start) * 1000, float(response.headers['x-benchmark-app-ms'])))
                response.raise_for_status()
                assert [row['id'] for row in response.json()['items']] == [item['id']]
        return samples

    with server('tests.acceptance.benchmark_timing:timed_app'), ThreadPoolExecutor(max_workers=5) as pool:
        samples = [sample for batch in pool.map(measure, range(5)) for sample in batch]
    for key in ['phone', 'address']:
        print_timings(samples, key, 100)
