"""Create an isolated loopback-only development cluster, never use existing data."""
import json
import os
from pathlib import Path
import secrets
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    local = root / '.local'
    local.mkdir(exist_ok=True)
    bin_dir = Path(os.environ.get('PG_BIN', 'C:/Program Files/PostgreSQL/18/bin'))
    data = local / 'postgres'
    marker = local / 'postgres-settings.json'
    if data.exists() or marker.exists():
        raise SystemExit('Local cluster already exists. Use the documented pg_ctl start command.')
    admin_password = secrets.token_hex(32)
    app_password = secrets.token_hex(32)
    marker.write_text(json.dumps({'port': 55432, 'admin_password': admin_password,
                                  'state': 'initializing'}), encoding='utf-8')
    pwfile = local / 'postgres-init-password'
    pwfile.write_text(admin_password, encoding='ascii')
    try:
        subprocess.run([str(bin_dir / 'initdb.exe'), '-D', str(data), '-U', 'm1_local_admin',
                        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C',
                        '--pwfile', str(pwfile)], check=True)
    finally:
        pwfile.unlink(missing_ok=True)
    with (data / 'postgresql.conf').open('a', encoding='utf-8') as handle:
        handle.write("\nlisten_addresses = '127.0.0.1'\nport = 55432\n")
    subprocess.run([str(bin_dir / 'pg_ctl.exe'), '-D', str(data), '-l', str(local / 'postgres.log'),
                    '-w', 'start'], check=True)
    env = {**os.environ, 'PGPASSWORD': admin_password}
    sql = (f"CREATE ROLE m1_app LOGIN PASSWORD '{app_password}';\n"
           'CREATE DATABASE store_agent_m1_dev OWNER m1_app;\n'
           'CREATE DATABASE store_agent_m1_test OWNER m1_app;\n')
    subprocess.run([str(bin_dir / 'psql.exe'), '-h', '127.0.0.1', '-p', '55432',
                    '-U', 'm1_local_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                   input=sql, text=True, env=env, check=True, capture_output=True)
    settings = {'port': 55432, 'admin_password': admin_password}
    marker.write_text(json.dumps(settings), encoding='utf-8')
    for suffix in ('dev', 'test'):
        config = {'database_url': f'postgresql+psycopg://m1_app:{app_password}@127.0.0.1:55432/store_agent_m1_{suffix}',
                  'origin': 'http://127.0.0.1:8000', 'cookie_secure': False}
        (local / f'{suffix}.json').write_text(json.dumps(config), encoding='utf-8')
    print('Created isolated development/test databases on 127.0.0.1:55432; credentials kept in .local only.')


if __name__ == '__main__':
    main()
