import argparse
from getpass import getpass

from app.auth.service import initialize_owner
from app.config import Settings
from app.db import create_database


def main():
    parser = argparse.ArgumentParser(description='Local controlled owner initialization')
    parser.add_argument('action', choices=['init-owner'])
    parser.parse_args()
    username = input('Owner username: ').strip()
    password = getpass('Password (at least 12 characters): ')
    if password != getpass('Repeat password: '):
        raise SystemExit('Passwords do not match')
    if input('Type CREATE OWNER to confirm: ') != 'CREATE OWNER':
        raise SystemExit('Cancelled')
    engine, sessions = create_database(Settings.load())
    try:
        with sessions.begin() as db:
            initialize_owner(db, username, password, confirmed=True)
        print('Owner initialized; no password was printed or saved in configuration.')
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
