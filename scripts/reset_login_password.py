#!/usr/bin/env python3
# -*- coding: utf-8 -*-
'Reset the web login password (the official operation and maintenance portal when you forget your password).\n\nNo old password is required; requires host permissions to access the database files.\nOnly supports interactive terminal input of new passwords (no --password / stdin password channels are provided).\n\nAlignment with web application behavior:\n- bcrypt writes to settings.login_password\n- Rotate settings.login_session_version to invalidate existing web/extension sessions\n- Write to audit_logs (without password)\n\nUsage:\n  python scripts/reset_login_password.py\n  DATABASE_PATH=/path/to/outlook_accounts.db python scripts/reset_login_password.py\n\nDocker example:\n  docker exec -it <container> python scripts/reset_login_password.py\n'

from __future__ import annotations

import argparse
import getpass
import os
import secrets
import sqlite3
import sys
from pathlib import Path
from typing import Optional, Tuple

# Consistent with outlook_web/segments/01_bootstrap.py / setting page password change
MIN_PASSWORD_LENGTH = 8
LOGIN_PASSWORD_KEY = "login_password"
LOGIN_SESSION_VERSION_KEY = "login_session_version"
DEFAULT_DATABASE_RELATIVE = Path("data") / "outlook_accounts.db"


class ResetError(Exception):
    'Reset failure that can be displayed to the user.'


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_dotenv_file(path: Path) -> None:
    'Lightly load .env (only handles KEY=VALUE, does not overwrite existing environment variables).'
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


def resolve_database_path() -> Path:
    'Consistent with application: DATABASE_PATH takes precedence, otherwise data/outlook_accounts.db.'
    env_value = (os.getenv("DATABASE_PATH") or "").strip()
    if env_value:
        return Path(env_value).expanduser().resolve()
    return (project_root() / DEFAULT_DATABASE_RELATIVE).resolve()


def hash_password(password: str) -> str:
    'Hash passwords using bcrypt (consistent with applying hash_password).'
    try:
        import bcrypt
    except ImportError as exc:
        raise ResetError(
            'The bcrypt dependency is missing, please install it first: pip install bcrypt'
        ) from exc
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        import bcrypt
    except ImportError:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def require_interactive_tty() -> None:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ResetError(
            'Only interactive terminal password reset is supported. Please run this script in a TTY (e.g. docker exec -it ...). Passing in a new password via --password, environment variables or pipes is not supported.'
        )


def validate_password_format(password: str) -> Optional[str]:
    'Only verify the format of the password itself (null value, length); by returning None.'
    if not password:
        return 'New password cannot be empty'
    if len(password) < MIN_PASSWORD_LENGTH:
        return f'The password length must be at least {MIN_PASSWORD_LENGTH} bits'
    return None


def validate_new_password(password: str, confirm: str) -> Optional[str]:
    'Return error information; return None if passed. No libraries are written.\n\n    Perform format verification first, and then compare the two inputs to avoid formatting problems being covered up by "inconsistencies."\n    '
    format_error = validate_password_format(password)
    if format_error:
        return format_error
    if password != confirm:
        return 'The passwords entered twice are inconsistent'
    return None


def prompt_new_password() -> str:
    'Interactively enter a new password: perform format verification immediately after the first input, and then confirm after passing it.'
    require_interactive_tty()
    password = getpass.getpass('New login password:')
    format_error = validate_password_format(password)
    if format_error:
        raise ResetError(format_error)
    confirm = getpass.getpass('Confirm new login password:')
    if password != confirm:
        raise ResetError('The passwords entered twice are inconsistent')
    return password


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def _upsert_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        """,
        (key, value),
    )


def _get_setting(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute(
        "SELECT value FROM settings WHERE key = ?",
        (key,),
    ).fetchone()
    if row is None:
        return None
    return row[0]


def write_audit_log(conn: sqlite3.Connection, details: str) -> None:
    'Write audit log; silently skipped if table does not exist or fails (consistent with applying log_audit).'
    if not _table_exists(conn, "audit_logs"):
        return
    try:
        conn.execute(
            """
            INSERT INTO audit_logs (action, resource_type, resource_id, user_ip, details)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                "reset_login_password",
                "settings",
                LOGIN_PASSWORD_KEY,
                "cli",
                details,
            ),
        )
    except sqlite3.Error:
        pass


def reset_login_password(db_path: Path, new_password: str) -> Tuple[str, str]:
    'Write new password to database and rotate session versions.\n\n    :return: (bcrypt_hash, new_session_version)\n    :raises ResetError: Path/library structure/strategy verification failed (the library is not written)\n    '
    error = validate_new_password(new_password, new_password)
    if error:
        raise ResetError(error)

    if not db_path.is_file():
        raise ResetError(
            f'The database file does not exist: {db_path}\n Please confirm whether the DATABASE_PATH or the default data/outlook_accounts.db is correct.'
        )

    hashed = hash_password(new_password)
    new_version = secrets.token_urlsafe(24)

    try:
        conn = sqlite3.connect(str(db_path))
    except sqlite3.Error as exc:
        raise ResetError(f'Unable to open database: {db_path} ({exc})') from exc

    try:
        if not _table_exists(conn, "settings"):
            raise ResetError(
                f'The database is missing the settings table and is not a valid OutlookEmail library: {db_path}'
            )
        _upsert_setting(conn, LOGIN_PASSWORD_KEY, hashed)
        _upsert_setting(conn, LOGIN_SESSION_VERSION_KEY, new_version)
        write_audit_log(
            conn,
            'CLI reset web login password; rotated login_session_version',
        )
        conn.commit()
    except ResetError:
        conn.rollback()
        raise
    except sqlite3.Error as exc:
        conn.rollback()
        raise ResetError(f'Failed to write to database: {exc}') from exc
    finally:
        conn.close()

    return hashed, new_version


def parse_args(argv: Optional[list] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            'Interactively reset web login password (used when you forget your password). The old password is not required; passing in new passwords via parameters or pipes is not supported.'
        ),
    )
    parser.add_argument(
        "--dry-run-check-db",
        action="store_true",
        help=argparse.SUPPRESS,  # Discoverable internal/testing only; password not changed
    )
    return parser.parse_args(argv)


def main(argv: Optional[list] = None) -> int:
    # Load the project .env first to make the local DATABASE_PATH consistent with the application
    load_dotenv_file(project_root() / ".env")
    load_dotenv_file(project_root() / ".env.local")

    try:
        parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return int(code) if isinstance(code, int) else 1

    db_path = resolve_database_path()
    print(f'Database: {db_path}')
    print('Note: Resetting does not require the old password; all logged-in sessions will be invalid after success.')
    print('Suggestion: If the service is running, you can stop it and then reset it (not mandatory).')
    print("-" * 40)

    if not db_path.is_file():
        print(
            f'Error: Database file does not exist: {db_path}',
            file=sys.stderr,
        )
        return 1

    try:
        new_password = prompt_new_password()
        _hashed, _version = reset_login_password(db_path, new_password)
    except ResetError as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print('\nCanceled, password not changed.', file=sys.stderr)
        return 1

    print("-" * 40)
    print('Web login password reset.')
    print('Please use the new password you just set to log in.')
    print('The source of password truth is the database settings.login_password, not the environment variable LOGIN_PASSWORD.')
    print(
        'After online password change or reset of this script, only modifying LOGIN_PASSWORD in docker-compose/.env will not overwrite the hash in the existing library.'
    )
    print('If the old LOGIN_PASSWORD is still written in compose, it is recommended to change it to a comment or make it consistent with the new password to avoid confusion in operation and maintenance.')
    print('The existing web/browser extension login session has expired and needs to be logged in again.')
    return 0


if __name__ == "__main__":
    sys.exit(main())
