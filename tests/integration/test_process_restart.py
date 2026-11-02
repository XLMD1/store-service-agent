from contextlib import contextmanager
from dataclasses import asdict
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx2
import pytest


@pytest.fixture
def process_config():
    path = Path('.local') / f'test-process-{uuid4()}.json'
    yield path
    path.unlink(missing_ok=True)


def test_authenticated_session_survives_server_process_restart(application, settings, process_config):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    config_path = process_config.resolve()
    config_path.write_text(json.dumps({**asdict(settings), 'origin': origin}), encoding='utf-8')

    @contextmanager
    def server():
        process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1',
             '--port', str(port)], env={**os.environ, 'APP_CONFIG_FILE': str(config_path)},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise AssertionError('Server exited before readiness')
                try:
                    with httpx2.Client(trust_env=False) as probe:
                        if probe.get(origin + '/api/auth/csrf', timeout=1).status_code == 200:
                            break
                except httpx2.TransportError:
                    time.sleep(0.1)
            else:
                raise AssertionError('Server did not become ready')
            yield
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    with httpx2.Client(base_url=origin, trust_env=False) as client:
        with server():
            token = client.get('/api/auth/csrf').json()['csrf_token']
            response = client.post('/api/auth/login', headers={'Origin': origin, 'X-CSRF-Token': token},
                                   json={'username': 'demo-owner', 'password': 'Sample-Owner-Password-123'})
            assert response.status_code == 200
            owner_id = response.json()['id']
        with server():
            response = client.get('/api/auth/me')
            assert response.status_code == 200
            assert response.json()['id'] == owner_id
