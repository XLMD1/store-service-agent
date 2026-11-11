import os
from dataclasses import replace
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


@pytest.fixture(scope='session')
def settings(tmp_path_factory):
    from app.config import Settings
    config_path = os.environ.get('M1_TEST_CONFIG')
    if not config_path:
        pytest.fail('Set M1_TEST_CONFIG to an explicit dedicated test configuration')
    config = Settings.load(Path(config_path))
    url = make_url(config.database_url)
    if url.host != '127.0.0.1' or url.database != 'store_agent_m1_test':
        pytest.fail('Refusing destructive fixtures outside the dedicated loopback test database')
    return replace(config,deepseek_settings_file=str(tmp_path_factory.mktemp('provider')/'deepseek.json'))


@pytest.fixture(scope='session')
def migrated(settings):
    config = Config('alembic.ini')
    config.attributes['database_url'] = settings.database_url
    command.upgrade(config, 'head')
    yield


@pytest.fixture()
def application(settings, migrated):
    from app.main import create_app
    from app.auth.service import initialize_owner
    engine = create_engine(settings.database_url)
    with engine.begin() as connection:
        connection.execute(text('TRUNCATE service_sources, login_throttles, account_audit, auth_sessions, user_roles, users, '
            'warehouses, product_models, customers, catalog_audit, drafts, operations, inventory_accounts, '
            'inventory_reservations, inventory_documents, inventory_ledger, agent_task_items, agent_tasks, '
            'checkpoints, checkpoint_blobs, checkpoint_writes CASCADE'))
    app = create_app(settings)
    with app.state.sessions.begin() as db:
        initialize_owner(db, 'demo-owner', 'Sample-Owner-Password-123', confirmed=True)
    yield app
    app.state.engine.dispose()
    engine.dispose()
