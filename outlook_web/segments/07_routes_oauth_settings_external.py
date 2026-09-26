from __future__ import annotations

import os
import sqlite3
import threading
import time

from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    # These segmented files are executed into the shared `web_outlook_app`
    # globals at runtime. Importing from the assembled module keeps IDE
    # inspections from flagging the shared names as unresolved.
    from web_outlook_app import *  # noqa: F403


# ==================== OAuth Token API ====================

def extract_oauth_authorization_code(redirected_url: str) -> tuple[bool, str, str]:
    'Extract the authorization code from the OAuth callback URL.'
    import urllib.parse

    normalized_url = str(redirected_url or '').strip()
    if not normalized_url:
        return False, '', 'Please provide the complete URL after authorization'

    try:
        parsed_url = urllib.parse.urlparse(normalized_url)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        auth_code = str(query_params['code'][0] or '').strip()
    except (KeyError, IndexError):
        return False, '', 'Unable to extract authorization code from URL, please check if the URL is correct'

    if not auth_code:
        return False, '', 'Unable to extract authorization code from URL, please check if the URL is correct'
    return True, auth_code, ''


def exchange_oauth_code_for_tokens(redirected_url: str) -> Dict[str, Any]:
    'Use the authorized callback URL to exchange for a Microsoft OAuth token.'
    success, auth_code, error_message = extract_oauth_authorization_code(redirected_url)
    if not success:
        return {'success': False, 'error': error_message}

    token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    token_data = {
        "client_id": OAUTH_CLIENT_ID,
        "code": auth_code,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "grant_type": "authorization_code",
        "scope": " ".join(OAUTH_SCOPES)
    }

    try:
        response = requests.post(token_url, data=token_data, timeout=30)
    except Exception as e:
        return {'success': False, 'error': f'Request failed: {sanitize_error_details(str(e))}'}

    if response.status_code != 200:
        try:
            error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
        except Exception:
            error_data = {}
        error_msg = error_data.get('error_description', response.text)
        return {'success': False, 'error': f'Failed to obtain token: {sanitize_error_details(error_msg)}'}

    tokens = response.json()
    refresh_token = str(tokens.get('refresh_token') or '').strip()
    if not refresh_token:
        return {'success': False, 'error': 'Failed to obtain Refresh Token'}

    return {
        'success': True,
        'refresh_token': refresh_token,
        'client_id': OAUTH_CLIENT_ID,
        'token_type': tokens.get('token_type'),
        'expires_in': tokens.get('expires_in'),
        'scope': tokens.get('scope')
    }


def update_account_authorization_for_reauth(account_id: int, client_id: str, refresh_token: str, db_conn=None) -> bool:
    'Only update the authorization fields of existing Outlook accounts and clear the old refresh failure status.'
    token_value = str(refresh_token or '').strip()
    client_id_value = str(client_id or '').strip()
    if not token_value or not client_id_value:
        return False

    db = db_conn or get_db()
    should_commit = db_conn is None
    try:
        db.execute(
            '''
            UPDATE accounts
            SET client_id = ?,
                refresh_token = ?,
                refresh_token_updated_at = CURRENT_TIMESTAMP,
                last_refresh_status = 'never',
                last_refresh_error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (client_id_value, encrypt_data(token_value), account_id)
        )
        if should_commit:
            db.commit()
        return True
    except Exception as e:
        if should_commit:
            try:
                db.rollback()
            except Exception:
                pass
        print(f'Failed to update account re-authorization information: {sanitize_error_details(str(e))}')
        return False


@app.route('/api/oauth/auth-url', methods=['GET'])
@login_required
def api_get_oauth_auth_url():
    'Generate OAuth authorization URL'
    import urllib.parse

    base_auth_url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    params = {
        "client_id": OAUTH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": OAUTH_REDIRECT_URI,
        "response_mode": "query",
        "scope": " ".join(OAUTH_SCOPES),
        "state": "12345"
    }
    auth_url = f"{base_auth_url}?{urllib.parse.urlencode(params)}"

    return jsonify({
        'success': True,
        'auth_url': auth_url,
        'client_id': OAUTH_CLIENT_ID,
        'redirect_uri': OAUTH_REDIRECT_URI
    })


@app.route('/api/oauth/exchange-token', methods=['POST'])
@login_required
def api_exchange_oauth_token():
    'Use authorization code to exchange for Refresh Token'
    data = request.get_json(silent=True) or {}
    token_result = exchange_oauth_code_for_tokens(data.get('redirected_url', ''))
    return jsonify(token_result)


@app.route('/api/accounts/<int:account_id>/reauthorize', methods=['POST'])
@login_required
def api_reauthorize_account(account_id):
    'Reauthorize the existing Outlook account and perform a refresh verification immediately.'
    db = get_db()
    account = db.execute(
        '''
        SELECT id, email, client_id, refresh_token, group_id, account_type, provider, authorization_type,
               proxy_url, fallback_proxy_url_1, fallback_proxy_url_2
        FROM accounts
        WHERE id = ?
        ''',
        (account_id,)
    ).fetchone()

    if not account:
        return jsonify({
            'success': False,
            'error': build_error_payload(
                "ACCOUNT_NOT_FOUND",
                'Account does not exist',
                "NotFoundError",
                404,
                f"account_id={account_id}"
            )
        }), 404

    if (account['account_type'] or 'outlook').strip().lower() == 'imap':
        return jsonify({
            'success': False,
            'error': build_error_payload(
                "ACCOUNT_REAUTH_UNSUPPORTED",
                'IMAP accounts do not support re-authorization',
                "UnsupportedAccountTypeError",
                400,
                f"account_id={account_id}"
            )
        }), 400

    data = request.get_json(silent=True) or {}
    token_result = exchange_oauth_code_for_tokens(data.get('redirected_url', ''))
    if not token_result.get('success'):
        return jsonify({
            'success': False,
            'error': build_error_payload(
                "OAUTH_EXCHANGE_FAILED",
                'Reauthorization failed',
                "OAuthExchangeError",
                400,
                token_result.get('error') or 'Unknown error'
            )
        }), 400

    if not update_account_authorization_for_reauth(
        account_id,
        token_result.get('client_id', ''),
        token_result.get('refresh_token', ''),
        db
    ):
        db.rollback()
        return jsonify({
            'success': False,
            'error': build_error_payload(
                "ACCOUNT_REAUTH_SAVE_FAILED",
                'Failed to save reauthorization information',
                "DatabaseError",
                500,
                f"account_id={account_id}"
            )
        }), 500

    db.commit()

    refreshed_account = db.execute(
        '''
        SELECT id, email, client_id, refresh_token, group_id, account_type, provider, authorization_type,
               proxy_url, fallback_proxy_url_1, fallback_proxy_url_2
        FROM accounts
        WHERE id = ?
        ''',
        (account_id,)
    ).fetchone()
    validation_result = refresh_outlook_account_token(refreshed_account, 'reauthorize', db_conn=db)
    db.commit()

    if validation_result.get('success'):
        return jsonify({
            'success': True,
            'message': 'Re-authorization is successful, Token refresh verification passed',
            'authorization_updated': True,
            'validation': {
                'success': True,
                'status': 'success',
                'message': validation_result.get('message') or 'Token refreshed successfully',
                'authorization_type': validation_result.get('authorization_type') or '',
            }
        })

    return jsonify({
        'success': True,
        'message': 'Reauthorization saved, but auto-refresh verification failed',
        'authorization_updated': True,
        'validation': {
            'success': False,
            'status': 'failed',
            'error': validation_result.get('error_payload'),
            'error_message': validation_result.get('error_message') or 'Unknown error'
        }
    })


# ==================== Settings API ====================

WEBDAV_BACKUP_SETTING_KEYS = (
    'webdav_backup_enabled',
    'webdav_backup_url',
    'webdav_backup_username',
    'webdav_backup_password',
    'webdav_backup_cron',
)


def normalize_bool_setting_value(value) -> str:
    return 'true' if str(value).strip().lower() in ('1', 'true', 'yes', 'on') else 'false'


def normalize_webdav_backup_setting_value(key: str, value) -> str:
    if key == 'webdav_backup_enabled':
        return normalize_bool_setting_value(value)
    return str(value or '').strip()


def get_current_webdav_backup_setting_value(key: str) -> str:
    if key == 'webdav_backup_password':
        return get_setting_decrypted(key, '')
    if key == 'webdav_backup_enabled':
        return normalize_bool_setting_value(get_setting(key, 'false'))
    if key == 'webdav_backup_cron':
        return get_setting(key, '0 3 * * *')
    return get_setting(key, '')


def has_webdav_backup_setting_changes(data) -> bool:
    for key in WEBDAV_BACKUP_SETTING_KEYS:
        if key not in data:
            continue
        incoming_value = normalize_webdav_backup_setting_value(key, data.get(key))
        current_value = normalize_webdav_backup_setting_value(key, get_current_webdav_backup_setting_value(key))
        if incoming_value != current_value:
            return True
    return False


def validate_cron_expression_for_timezone(cron_expr: str, time_zone: str):
    if not cron_expr:
        return 'Cron expression cannot be empty'
    if not is_valid_app_timezone_name(time_zone):
        return 'Invalid time zone'
    try:
        from croniter import croniter
        from datetime import datetime
        croniter(cron_expr, datetime.now(ZoneInfo(time_zone)))
        return None
    except ImportError:
        return 'The croniter library is not installed'
    except Exception as exc:
        return f'Invalid Cron expression: {str(exc)}'


def validate_five_field_cron_expression_for_timezone(cron_expr: str, time_zone: str):
    normalized = str(cron_expr or '').strip()
    if not normalized:
        return 'Cron expression cannot be empty'
    if len(normalized.split()) != 5:
        return 'Only supports 5-segment Cron'
    return validate_cron_expression_for_timezone(normalized, time_zone)


def build_cron_preview(cron_expr: str, time_zone: str, count: int = 5):
    from croniter import croniter
    from datetime import datetime

    tzinfo = ZoneInfo(time_zone)
    base_time = datetime.now(tzinfo)
    cron = croniter(cron_expr, base_time)
    next_run = cron.get_next(datetime)
    if next_run.tzinfo is None:
        next_run = next_run.replace(tzinfo=tzinfo)

    future_runs = [next_run.isoformat()]
    for _ in range(max(0, count - 1)):
        future_run = cron.get_next(datetime)
        if future_run.tzinfo is None:
            future_run = future_run.replace(tzinfo=tzinfo)
        future_runs.append(future_run.isoformat())

    return {
        'next_run': next_run.isoformat(),
        'future_runs': future_runs,
        'time_zone': time_zone,
    }


NORMAL_MAIL_RETENTION_TEXT_COLUMNS = (
    'folder',
    'provider_message_id',
    'id_mode',
    'subject',
    'sender',
    'recipients',
    'cc',
    'received_at',
    'body_preview',
    'body',
    'body_type',
    'attachments_json',
    'list_cached_at',
    'body_cached_at',
    'last_synced_at',
    'created_at',
    'updated_at',
)


NORMAL_MAIL_RETENTION_CLEAR_STATUS_LOCK = threading.Lock()
NORMAL_MAIL_RETENTION_CLEAR_RETRY_ATTEMPTS = 3
NORMAL_MAIL_RETENTION_CLEAR_RETRY_DELAY_SECONDS = 0.05
NORMAL_MAIL_RETENTION_CLEAR_STATUS = {
    'state': 'idle',
    'message': 'No cache cleanup is running',
}


def set_normal_mail_retention_clear_status(state: str, message: str):
    with NORMAL_MAIL_RETENTION_CLEAR_STATUS_LOCK:
        NORMAL_MAIL_RETENTION_CLEAR_STATUS.update({
            'state': state,
            'message': message,
        })
        return dict(NORMAL_MAIL_RETENTION_CLEAR_STATUS)


def get_normal_mail_retention_clear_status():
    with NORMAL_MAIL_RETENTION_CLEAR_STATUS_LOCK:
        return dict(NORMAL_MAIL_RETENTION_CLEAR_STATUS)


def is_sqlite_database_locked_error(exc: Exception) -> bool:
    return isinstance(exc, sqlite3.OperationalError) and 'database is locked' in str(exc).lower()


def clear_retained_normal_mail_cache_rows() -> int:
    db = get_db()
    last_error = None
    for attempt in range(NORMAL_MAIL_RETENTION_CLEAR_RETRY_ATTEMPTS):
        try:
            cursor = db.execute('DELETE FROM retained_normal_mail_messages')
            db.commit()
            return int(cursor.rowcount if cursor.rowcount is not None else 0)
        except sqlite3.OperationalError as exc:
            db.rollback()
            if not is_sqlite_database_locked_error(exc):
                raise
            last_error = exc
            if attempt + 1 >= NORMAL_MAIL_RETENTION_CLEAR_RETRY_ATTEMPTS:
                break
            time.sleep(NORMAL_MAIL_RETENTION_CLEAR_RETRY_DELAY_SECONDS * (attempt + 1))
    raise last_error or sqlite3.OperationalError('database is locked')


def run_normal_mail_retention_clear_operation():
    with app.app_context():
        try:
            deleted_count = clear_retained_normal_mail_cache_rows()
        except Exception as exc:
            set_normal_mail_retention_clear_status('failed', f'Cleanup failed: {exc}')
            return
        set_normal_mail_retention_clear_status(
            'succeeded',
            f'{deleted_count} local cached emails of ordinary mailboxes have been cleared',
        )


def start_normal_mail_retention_clear_operation():
    worker = threading.Thread(
        target=run_normal_mail_retention_clear_operation,
        name='normal-mail-retention-clear',
        daemon=True,
    )
    with NORMAL_MAIL_RETENTION_CLEAR_STATUS_LOCK:
        if NORMAL_MAIL_RETENTION_CLEAR_STATUS.get('state') == 'running':
            status = dict(NORMAL_MAIL_RETENTION_CLEAR_STATUS)
            status['already_running'] = True
            return status
        NORMAL_MAIL_RETENTION_CLEAR_STATUS.update({
            'state': 'running',
            'message': 'Cleaning the local cache of ordinary mailboxes...',
        })
        worker.start()
        status = dict(NORMAL_MAIL_RETENTION_CLEAR_STATUS)
        status['already_running'] = False
    return status


def get_normal_mail_retention_db_file_bytes() -> int:
    if not DATABASE or not os.path.exists(DATABASE):
        return 0
    return max(0, int(os.path.getsize(DATABASE)))


NORMAL_MAIL_RETENTION_SIZE_SQL_TERMS = tuple(
    "length(CAST(coalesce(" + column + ", '') AS BLOB))"
    for column in NORMAL_MAIL_RETENTION_TEXT_COLUMNS
)
NORMAL_MAIL_RETENTION_SIZE_SQL = ' + '.join(NORMAL_MAIL_RETENTION_SIZE_SQL_TERMS)


def get_normal_mail_retention_size_sql() -> str:
    return NORMAL_MAIL_RETENTION_SIZE_SQL


def get_normal_mail_retention_storage_stats():
    db = get_db()
    size_sql = get_normal_mail_retention_size_sql()
    def query_retention_stats():
        return db.execute(
            f'''
            SELECT
                COUNT(*) AS saved_message_count,
                COALESCE(SUM(CASE WHEN body_cached = 1 THEN 1 ELSE 0 END), 0)
                    AS cached_body_count,
                COALESCE(SUM({size_sql}), 0) AS estimated_retained_bytes
            FROM retained_normal_mail_messages
            '''
        ).fetchone()

    row = query_retention_stats()
    clear_status = get_normal_mail_retention_clear_status()
    if clear_status.get('state') == 'succeeded':
        row = query_retention_stats()

    enabled_value = normalize_bool_setting_value(
        get_setting('normal_mail_local_retention_enabled', 'false')
    )
    return {
        'enabled': enabled_value == 'true',
        'saved_message_count': int(row['saved_message_count'] or 0),
        'cached_body_count': int(row['cached_body_count'] or 0),
        'estimated_retained_bytes': int(row['estimated_retained_bytes'] or 0),
        'db_file_bytes': get_normal_mail_retention_db_file_bytes(),
        'clear_status': clear_status,
    }


@app.route('/api/settings/normal-mail-retention/status', methods=['GET'])
@login_required
def api_get_normal_mail_retention_status():
    'Return local retention statistics of ordinary mailboxes for display on the settings page.'
    return jsonify({
        'success': True,
        'status': get_normal_mail_retention_storage_stats(),
    })


@app.route('/api/settings/normal-mail-retention/clear', methods=['POST'])
@login_required
def api_clear_normal_mail_retention_cache():
    'Explicitly initiate local retention cache cleanup for ordinary mailboxes.'
    status = start_normal_mail_retention_clear_operation()
    return jsonify({
        'success': True,
        'status': status,
        'already_running': bool(status.get('already_running', False)),
    })


@app.route('/api/settings/validate-cron', methods=['POST'])
@login_required
def api_validate_cron():
    'Validating Cron expressions'
    try:
        from croniter import croniter  # noqa: F401
    except ImportError:
        return jsonify({'success': False, 'error': 'The croniter library is not installed, please run: pip install croniter'})

    data = request.json or {}
    cron_expr = data.get('cron_expression', '').strip()
    requested_timezone = str(data.get('time_zone', '')).strip()
    expected_fields = data.get('expected_fields')

    if not cron_expr:
        return jsonify({'success': False, 'error': 'Cron expression cannot be empty'})

    if expected_fields is not None:
        try:
            expected_field_count = int(expected_fields)
        except (TypeError, ValueError):
            expected_field_count = 0
        if expected_field_count > 0 and len(cron_expr.split()) != expected_field_count:
            return jsonify({
                'success': False,
                'valid': False,
                'error': f'Only supports {expected_field_count} segment Cron'
            })

    if requested_timezone and not is_valid_app_timezone_name(requested_timezone):
        return jsonify({'success': False, 'error': 'Invalid time zone'})

    preview_timezone = normalize_app_timezone_name(requested_timezone, get_app_timezone())

    try:
        preview = build_cron_preview(cron_expr, preview_timezone)
        return jsonify({
            'success': True,
            'valid': True,
            'next_run': preview['next_run'],
            'future_runs': preview['future_runs'],
            'time_zone': preview['time_zone']
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'valid': False,
            'error': f'Invalid Cron expression: {str(e)}'
        })


@app.route('/api/settings', methods=['GET'])
@login_required
def api_get_settings():
    'Get all settings'
    settings = get_all_settings()
    # Hide some characters of password
    if 'login_password' in settings:
        pwd = settings['login_password']
        if len(pwd) > 2:
            settings['login_password_masked'] = pwd[0] + '*' * (len(pwd) - 2) + pwd[-1]
        else:
            settings['login_password_masked'] = '*' * len(pwd)
    # Return the decrypted external API Key
    settings['external_api_key'] = get_external_api_key()
    # Return to DuckMail settings
    settings['duckmail_base_url'] = get_duckmail_base_url()
    settings['duckmail_api_key'] = get_duckmail_api_key()
    settings['cloudflare_worker_domain'] = get_cloudflare_worker_domain()
    settings['cloudflare_email_domains'] = ', '.join(get_cloudflare_email_domains())
    settings['cloudflare_admin_password'] = get_cloudflare_admin_password()
    settings.pop('cloudflare_ai_username_api_key', None)
    cloudflare_ai_api_key = get_setting_decrypted('cloudflare_ai_username_api_key', '')
    settings['cloudflare_ai_username_enabled'] = get_setting('cloudflare_ai_username_enabled', 'false')
    settings['cloudflare_ai_username_api_url'] = get_setting('cloudflare_ai_username_api_url', '')
    settings['cloudflare_ai_username_model'] = get_setting('cloudflare_ai_username_model', '')
    settings['cloudflare_ai_username_prompt'] = get_setting(
        'cloudflare_ai_username_prompt',
        CLOUDFLARE_AI_USERNAME_DEFAULT_PROMPT,
    )
    settings['cloudflare_ai_username_api_key_configured'] = bool(cloudflare_ai_api_key)
    settings['cloudflare_ai_username_api_key_masked'] = '********' if cloudflare_ai_api_key else ''
    settings['app_timezone'] = get_app_timezone()
    settings['show_account_created_at'] = get_setting('show_account_created_at', 'true')
    settings['show_account_sort_order'] = get_setting('show_account_sort_order', 'false')
    settings['show_group_id'] = get_setting('show_group_id', 'true')
    settings['mail_fetch_timeout_seconds'] = str(get_mail_fetch_timeout_seconds())
    settings['normal_mail_local_retention_enabled'] = get_setting(
        'normal_mail_local_retention_enabled',
        'false',
    )
    skin_settings = get_skin_settings_payload()
    settings['active_skin_id'] = skin_settings['active_skin_id']
    settings['configured_skin_id'] = skin_settings['configured_skin_id']
    settings['active_skin'] = skin_settings['active_skin']
    settings['active_skin_asset_hash'] = skin_settings['asset_hash']
    settings['forward_channels'] = get_forward_channels()
    settings['forward_check_interval_minutes'] = get_setting('forward_check_interval_minutes', '5')
    settings['forward_check_interval_seconds'] = str(normalize_forward_check_interval_seconds())
    forward_execution_mode = normalize_forward_execution_mode()
    settings['forward_execution_mode'] = forward_execution_mode
    settings['forward_parallel_workers'] = str(normalize_forward_parallel_workers())
    settings['forward_account_delay_seconds'] = (
        '0' if forward_execution_mode == 'parallel' else get_setting('forward_account_delay_seconds', '0')
    )
    settings['forward_email_window_minutes'] = get_setting('forward_email_window_minutes', '0')
    settings['forward_include_junkemail'] = get_setting('forward_include_junkemail', 'false')
    settings['email_forward_recipient'] = get_setting('email_forward_recipient', '')
    settings['smtp_host'] = get_setting('smtp_host', '')
    settings['smtp_port'] = get_setting('smtp_port', '465')
    settings['smtp_username'] = get_setting('smtp_username', '')
    settings['smtp_password'] = get_setting_decrypted('smtp_password', '')
    settings['smtp_from_email'] = get_setting('smtp_from_email', '')
    settings['smtp_provider'] = normalize_smtp_forward_provider(get_setting('smtp_provider', 'custom'))
    settings['smtp_use_tls'] = get_setting('smtp_use_tls', 'false')
    settings['smtp_use_ssl'] = get_setting('smtp_use_ssl', 'true')
    settings['telegram_bot_token'] = get_setting_decrypted('telegram_bot_token', '')
    settings['telegram_chat_id'] = get_setting('telegram_chat_id', '')
    settings['telegram_topic_id'] = get_setting('telegram_topic_id', '')
    settings['telegram_proxy_url'] = get_setting('telegram_proxy_url', '')
    settings['wecom_webhook_url'] = get_setting_decrypted('wecom_webhook_url', '')
    settings['webdav_backup_enabled'] = get_setting('webdav_backup_enabled', 'false')
    settings['webdav_backup_url'] = get_setting('webdav_backup_url', '')
    settings['webdav_backup_username'] = get_setting('webdav_backup_username', '')
    settings['webdav_backup_password'] = get_setting_decrypted('webdav_backup_password', '')
    settings['webdav_backup_cron'] = get_setting('webdav_backup_cron', '0 3 * * *')
    settings['webdav_backup_last_run_at'] = get_setting('webdav_backup_last_run_at', '')
    settings['webdav_backup_last_status'] = get_setting('webdav_backup_last_status', '')
    settings['webdav_backup_last_message'] = get_setting('webdav_backup_last_message', '')
    settings['webdav_backup_last_filename'] = get_setting('webdav_backup_last_filename', '')
    settings['webdav_backup_next_run'] = ''
    cron_error = validate_five_field_cron_expression_for_timezone(settings['webdav_backup_cron'], settings['app_timezone'])
    if not cron_error:
        try:
            settings['webdav_backup_next_run'] = build_cron_preview(
                settings['webdav_backup_cron'],
                settings['app_timezone'],
                count=1,
            )['next_run']
        except Exception:
            settings['webdav_backup_next_run'] = ''
    return jsonify({'success': True, 'settings': settings})


@app.route('/api/settings', methods=['PUT'])
@login_required
def api_update_settings():
    'Update settings'
    data = request.json or {}
    updated = []
    errors = []

    webdav_backup_changed = has_webdav_backup_setting_changes(data)
    if webdav_backup_changed:
        confirm_password = str(data.get('webdav_backup_verify_password', ''))
        if not confirm_password:
            return jsonify({'success': False, 'error': 'Modifying WebDAV backup settings requires verification of login password'})
        if not verify_login_password(confirm_password):
            return jsonify({'success': False, 'error': 'WebDAV backup settings verification failed: wrong login password'})

        proposed_backup = {
            key: normalize_webdav_backup_setting_value(key, get_current_webdav_backup_setting_value(key))
            for key in WEBDAV_BACKUP_SETTING_KEYS
        }
        for key in WEBDAV_BACKUP_SETTING_KEYS:
            if key in data:
                proposed_backup[key] = normalize_webdav_backup_setting_value(key, data.get(key))

        if proposed_backup['webdav_backup_enabled'] == 'true':
            backup_url = proposed_backup['webdav_backup_url']
            parsed_url = urlparse(backup_url)
            if not backup_url:
                return jsonify({'success': False, 'error': 'WebDAV directory URL must be filled in when enabling WebDAV backup'})
            if parsed_url.scheme not in ('http', 'https') or not parsed_url.netloc:
                return jsonify({'success': False, 'error': 'WebDAV directory URL must be a valid http(s) address'})

            backup_timezone = str(data.get('app_timezone') or get_app_timezone()).strip()
            backup_timezone = normalize_app_timezone_name(backup_timezone, get_app_timezone())
            cron_error = validate_five_field_cron_expression_for_timezone(proposed_backup['webdav_backup_cron'], backup_timezone)
            if cron_error:
                return jsonify({'success': False, 'error': cron_error})

    # Update login password: the current password must be verified; after success, the session version will be rotated to invalidate other logged-in sessions
    if 'login_password' in data:
        new_password = str(data.get('login_password') or '').strip()
        if new_password:
            if len(new_password) < 8:
                return jsonify({'success': False, 'error': 'Password length must be at least 8 characters'})
            current_password = str(data.get('current_login_password') or '')
            if not current_password:
                return jsonify({'success': False, 'error': 'Changing the login password requires verifying the current password'})
            if not verify_login_password(current_password):
                return jsonify({'success': False, 'error': 'The current login password is incorrect'})
            hashed_password = hash_password(new_password)
            if not set_setting('login_password', hashed_password):
                return jsonify({'success': False, 'error': 'Failed to update login password'})
            new_session_version = rotate_login_session_version()
            # The current encryption session will continue to be valid, and the remaining old sessions will become invalid on the next request.
            session['logged_in'] = True
            session.permanent = True
            bind_login_session_version(new_session_version)
            updated.append('Password')

    # Update GPTMail API Key
    if 'gptmail_api_key' in data:
        new_api_key = data['gptmail_api_key'].strip()
        if new_api_key:
            if set_setting('gptmail_api_key', new_api_key):
                updated.append('GPTMail API Key')
            else:
                errors.append('Failed to update GPTMail API Key')

    # Update refresh cycle
    if 'refresh_interval_days' in data:
        try:
            days = int(data['refresh_interval_days'])
            if days < 1 or days > 90:
                errors.append('Refresh period must be between 1-90 days')
            elif set_setting('refresh_interval_days', str(days)):
                updated.append('Refresh cycle')
            else:
                errors.append('Update refresh cycle failed')
        except ValueError:
            errors.append('The refresh period must be a number')

    # Update refresh interval
    if 'refresh_delay_seconds' in data:
        try:
            seconds = int(data['refresh_delay_seconds'])
            if seconds < 0 or seconds > 60:
                errors.append('The refresh interval must be between 0-60 seconds')
            elif set_setting('refresh_delay_seconds', str(seconds)):
                updated.append('Refresh interval')
            else:
                errors.append('Failed to update refresh interval')
        except ValueError:
            errors.append('The refresh interval must be a number')

    # Update Cron expression
    if 'refresh_cron' in data:
        cron_expr = data['refresh_cron'].strip()
        if cron_expr:
            try:
                from croniter import croniter
                from datetime import datetime
                croniter(cron_expr, datetime.now())
                if set_setting('refresh_cron', cron_expr):
                    updated.append('Cron expression')
                else:
                    errors.append('Failed to update Cron expression')
            except ImportError:
                errors.append('The croniter library is not installed')
            except Exception as e:
                errors.append(f'Invalid Cron expression: {str(e)}')

    # Update refresh strategy
    if 'use_cron_schedule' in data:
        use_cron = str(data['use_cron_schedule']).lower()
        if use_cron in ('true', 'false'):
            if set_setting('use_cron_schedule', use_cron):
                updated.append('Refresh strategy')
            else:
                errors.append('Failed to update refresh policy')
        else:
            errors.append('Refresh strategy must be true or false')

    # Update scheduled refresh switch
    if 'enable_scheduled_refresh' in data:
        enable = str(data['enable_scheduled_refresh']).lower()
        if enable in ('true', 'false'):
            if set_setting('enable_scheduled_refresh', enable):
                updated.append('Scheduled refresh switch')
            else:
                errors.append('Failed to update scheduled refresh switch')
        else:
            errors.append('The scheduled refresh switch must be true or false')

    if 'app_timezone' in data:
        app_timezone = str(data['app_timezone']).strip()
        if not is_valid_app_timezone_name(app_timezone):
            errors.append('Invalid time zone')
        elif set_setting('app_timezone', app_timezone):
            updated.append('Time zone')
        else:
            errors.append('Failed to save time zone')

    if 'show_account_created_at' in data:
        show_created_at = str(data['show_account_created_at']).lower()
        if show_created_at in ('true', 'false'):
            if set_setting('show_account_created_at', show_created_at):
                updated.append('Creation time display')
            else:
                errors.append('Failed to update creation time display')
        else:
            errors.append('Creation time display must be true or false')

    if 'show_account_sort_order' in data:
        show_sort_order = str(data['show_account_sort_order']).lower()
        if show_sort_order in ('true', 'false'):
            if set_setting('show_account_sort_order', show_sort_order):
                updated.append('Sorting value display')
            else:
                errors.append('Failed to update sorting value display')
        else:
            errors.append('Sort value display must be true or false')

    if 'show_group_id' in data:
        show_group_id = str(data['show_group_id']).lower()
        if show_group_id in ('true', 'false'):
            if set_setting('show_group_id', show_group_id):
                updated.append('Group ID display')
            else:
                errors.append('Failed to update group ID display')
        else:
            errors.append('Group ID display must be true or false')

    if 'normal_mail_local_retention_enabled' in data:
        retention_enabled = str(data['normal_mail_local_retention_enabled']).strip().lower()
        if retention_enabled in ('true', 'false'):
            normalized_retention_enabled = normalize_bool_setting_value(retention_enabled)
            if set_setting(
                'normal_mail_local_retention_enabled',
                normalized_retention_enabled,
            ):
                set_normal_mail_local_retention_enabled_cache(normalized_retention_enabled)
                updated.append('Ordinary mailbox local retention switch')
            else:
                errors.append('Failed to update the local retention switch of ordinary mailboxes')
        else:
            errors.append('The local retention switch for ordinary mailboxes must be true or false')

    if 'active_skin_id' in data:
        success, error, _skin = set_active_skin(data.get('active_skin_id'))
        if success:
            updated.append('Current skin')
        else:
            errors.append(error or 'Failed to save current skin')

    # Update external API Key
    if 'external_api_key' in data:
        new_ext_key = data['external_api_key'].strip()
        if new_ext_key:
            if set_setting('external_api_key', new_ext_key):
                updated.append('External API Key')
            else:
                errors.append('Failed to update external API Key')
        else:
            if set_setting('external_api_key', ''):
                updated.append('External API Key (cleared)')

    # Update DuckMail settings
    if 'duckmail_base_url' in data:
        new_url = data['duckmail_base_url'].strip()
        if set_setting('duckmail_base_url', new_url):
            updated.append('DuckMail API address')
        else:
            errors.append('Failed to update DuckMail API address')

    if 'duckmail_api_key' in data:
        new_dk_key = data['duckmail_api_key'].strip()
        if set_setting('duckmail_api_key', new_dk_key):
            updated.append('DuckMail API Key')
        else:
            errors.append('Failed to update DuckMail API Key')

    if 'cloudflare_worker_domain' in data:
        new_domain = data['cloudflare_worker_domain'].strip()
        if set_setting('cloudflare_worker_domain', new_domain):
            updated.append('Cloudflare Worker domain name')
        else:
            errors.append('Failed to update Cloudflare Worker domain name')

    if 'cloudflare_email_domains' in data:
        new_domains = data['cloudflare_email_domains'].strip()
        if set_setting('cloudflare_email_domains', new_domains):
            updated.append('Cloudflare email domain name')
        else:
            errors.append('Failed to update Cloudflare email domain name')

    if 'cloudflare_admin_password' in data:
        new_password = data['cloudflare_admin_password'].strip()
        if set_setting('cloudflare_admin_password', new_password):
            updated.append('Cloudflare Admin Password')
        else:
            errors.append('Failed to update Cloudflare admin password')

    if 'cloudflare_ai_username_enabled' in data:
        enabled = normalize_bool_setting_value(data['cloudflare_ai_username_enabled'])
        if set_setting('cloudflare_ai_username_enabled', enabled):
            updated.append('Cloudflare AI username switch')
        else:
            errors.append('Failed to save Cloudflare AI username switch')

    if 'cloudflare_ai_username_api_url' in data:
        if set_setting('cloudflare_ai_username_api_url', str(data['cloudflare_ai_username_api_url']).strip()):
            updated.append('Cloudflare AI API address')
        else:
            errors.append('Failed to save Cloudflare AI API address')

    if 'cloudflare_ai_username_model' in data:
        if set_setting('cloudflare_ai_username_model', str(data['cloudflare_ai_username_model']).strip()):
            updated.append('Cloudflare AI model')
        else:
            errors.append('Failed to save Cloudflare AI model')

    if 'cloudflare_ai_username_prompt' in data:
        prompt = str(data['cloudflare_ai_username_prompt'] or '').strip() or CLOUDFLARE_AI_USERNAME_DEFAULT_PROMPT
        if set_setting('cloudflare_ai_username_prompt', prompt):
            updated.append('Cloudflare AI prompt words')
        else:
            errors.append('Failed to save Cloudflare AI prompt words')

    if data.get('cloudflare_ai_username_clear_api_key'):
        if set_setting_encrypted('cloudflare_ai_username_api_key', ''):
            updated.append('Cloudflare AI API Key (cleared)')
        else:
            errors.append('Failed to clear Cloudflare AI API Key')
    elif 'cloudflare_ai_username_api_key' in data:
        ai_api_key = str(data['cloudflare_ai_username_api_key'] or '').strip()
        if ai_api_key:
            if set_setting_encrypted('cloudflare_ai_username_api_key', ai_api_key):
                updated.append('Cloudflare AI API Key')
            else:
                errors.append('Failed to save Cloudflare AI API Key')

    forward_execution_mode_for_delay = normalize_forward_execution_mode()
    forward_account_delay_updated = False

    if 'forward_check_interval_minutes' in data:
        try:
            minutes = int(data['forward_check_interval_minutes'])
            if minutes < 1 or minutes > 60:
                errors.append('Forward check interval must be between 1-60 minutes')
            elif set_setting('forward_check_interval_minutes', str(minutes)):
                updated.append('Forwarding check interval')
                if 'forward_check_interval_seconds' not in data:
                    if not set_setting('forward_check_interval_seconds', str(minutes * 60)):
                        errors.append('Failed to save forwarding second-level polling interval')
            else:
                errors.append('Failed to save forwarding check interval')
        except ValueError:
            errors.append('The forwarding check interval must be a number')

    if 'forward_check_interval_seconds' in data:
        try:
            seconds = parse_forward_check_interval_seconds_input(data['forward_check_interval_seconds'])
            if set_setting('forward_check_interval_seconds', str(seconds)):
                updated.append('Forwarding second-level polling interval')
            else:
                errors.append('Failed to save forwarding second-level polling interval')
        except ValueError as exc:
            errors.append(str(exc))

    if 'forward_execution_mode' in data:
        try:
            execution_mode = parse_forward_execution_mode_input(data['forward_execution_mode'])
            if set_setting('forward_execution_mode', execution_mode):
                updated.append('Forward execution mode')
                forward_execution_mode_for_delay = execution_mode
            else:
                errors.append('Failed to save forwarding execution mode')
        except ValueError as exc:
            errors.append(str(exc))

    if 'forward_parallel_workers' in data:
        try:
            workers = parse_forward_parallel_workers_input(data['forward_parallel_workers'])
            if set_setting('forward_parallel_workers', str(workers)):
                updated.append('Number of forwarding parallel workers')
            else:
                errors.append('Failed to save the number of forwarding parallel workers')
        except ValueError as exc:
            errors.append(str(exc))

    if 'forward_account_delay_seconds' in data:
        try:
            seconds = (
                0 if forward_execution_mode_for_delay == 'parallel'
                else int(data['forward_account_delay_seconds'])
            )
            if seconds < 0 or seconds > 60:
                errors.append('The pull interval between accounts must be between 0-60 seconds')
            elif set_setting('forward_account_delay_seconds', str(seconds)):
                updated.append('Pull interval between accounts')
                forward_account_delay_updated = True
            else:
                errors.append('Failed to save the pull interval between accounts')
        except (TypeError, ValueError):
            errors.append('The pull interval between accounts must be a number')

    if (
        'forward_execution_mode' in data
        and forward_execution_mode_for_delay == 'parallel'
        and not forward_account_delay_updated
    ):
        if set_setting('forward_account_delay_seconds', '0'):
            updated.append('Pull interval between accounts')
        else:
            errors.append('Failed to save the pull interval between accounts')

    if 'forward_email_window_minutes' in data:
        try:
            minutes = int(data['forward_email_window_minutes'])
            if minutes < 0 or minutes > 10080:
                errors.append('The mail forwarding time range must be between 0-10080 minutes')
            elif set_setting('forward_email_window_minutes', str(minutes)):
                updated.append('Forwarding email time range')
            else:
                errors.append('Failed to save forwarding email time range')
        except ValueError:
            errors.append('The email forwarding time range must be a number')

    if 'forward_include_junkemail' in data:
        include_junk = str(data['forward_include_junkemail']).lower()
        if include_junk in ('true', 'false'):
            if set_setting('forward_include_junkemail', include_junk):
                updated.append('Forward spam emails')
            else:
                errors.append('Failed to save and forward junk mail')
        else:
            errors.append('Forwarding spam messages must be true or false')

    if MAIL_FETCH_TIMEOUT_SETTING_KEY in data:
        mail_fetch_timeout_seconds = parse_mail_fetch_timeout_seconds(data[MAIL_FETCH_TIMEOUT_SETTING_KEY])
        if mail_fetch_timeout_seconds is None:
            errors.append(
                f'Mail retrieval timeout must be between {MAIL_FETCH_TIMEOUT_MIN_SECONDS}-{MAIL_FETCH_TIMEOUT_MAX_SECONDS} seconds'
            )
        elif set_setting(MAIL_FETCH_TIMEOUT_SETTING_KEY, str(mail_fetch_timeout_seconds)):
            updated.append('Mail retrieval timeout')
        else:
            errors.append('Failed to save email and get timeout')

    if 'forward_channels' in data:
        forward_channels = normalize_forward_channel_settings(data['forward_channels'])
        stored_value = ','.join(forward_channels) if forward_channels else 'none'
        if set_setting('forward_channels', stored_value):
            updated.append('Forwarding channel')
        else:
            errors.append('Failed to save forwarding channel')

    if 'email_forward_recipient' in data:
        if set_setting('email_forward_recipient', data['email_forward_recipient'].strip()):
            updated.append('Mail forwarding inbox')
        else:
            errors.append('Failed to save mail forwarding inbox')

    if 'smtp_host' in data:
        if set_setting('smtp_host', data['smtp_host'].strip()):
            updated.append('SMTP host')
        else:
            errors.append('Failed to save SMTP host')

    if 'smtp_port' in data:
        try:
            smtp_port = int(data['smtp_port'])
            if smtp_port <= 0 or smtp_port > 65535:
                errors.append('Invalid SMTP port')
            elif set_setting('smtp_port', str(smtp_port)):
                updated.append('SMTP port')
            else:
                errors.append('Failed to save SMTP port')
        except ValueError:
            errors.append('SMTP port must be numeric')

    if 'smtp_username' in data:
        if set_setting('smtp_username', data['smtp_username'].strip()):
            updated.append('SMTP username')
        else:
            errors.append('Failed to save SMTP username')

    if 'smtp_password' in data:
        if set_setting_encrypted('smtp_password', data['smtp_password'].strip()):
            updated.append('SMTP password')
        else:
            errors.append('Failed to save SMTP password')

    if 'smtp_from_email' in data:
        if set_setting('smtp_from_email', data['smtp_from_email'].strip()):
            updated.append('SMTP sender')
        else:
            errors.append('Failed to save SMTP sender')

    if 'smtp_provider' in data:
        smtp_provider = normalize_smtp_forward_provider(data['smtp_provider'])
        if str(data['smtp_provider']).strip().lower() not in SMTP_FORWARD_PROVIDERS:
            errors.append('Invalid SMTP mailbox type')
        elif set_setting('smtp_provider', smtp_provider):
            updated.append('SMTP mailbox type')
        else:
            errors.append('Failed to save SMTP mailbox type')

    if 'smtp_use_tls' in data:
        if set_setting('smtp_use_tls', str(data['smtp_use_tls']).lower()):
            updated.append('SMTP TLS')
        else:
            errors.append('Saving SMTP TLS failed')

    if 'smtp_use_ssl' in data:
        if set_setting('smtp_use_ssl', str(data['smtp_use_ssl']).lower()):
            updated.append('SMTP SSL')
        else:
            errors.append('Saving SMTP SSL failed')

    if 'telegram_bot_token' in data:
        if set_setting_encrypted('telegram_bot_token', data['telegram_bot_token'].strip()):
            updated.append('Telegram Bot Token')
        else:
            errors.append('Failed to save Telegram Bot Token')

    if 'telegram_chat_id' in data:
        if set_setting('telegram_chat_id', data['telegram_chat_id'].strip()):
            updated.append('Telegram Chat ID')
        else:
            errors.append('Failed to save Telegram Chat ID')

    if 'telegram_topic_id' in data:
        if set_setting('telegram_topic_id', data['telegram_topic_id'].strip()):
            updated.append('Telegram Topic ID')
        else:
            errors.append('Failed to save Telegram Topic ID')

    if 'telegram_proxy_url' in data:
        if set_setting('telegram_proxy_url', data['telegram_proxy_url'].strip()):
            updated.append('Telegram proxy')
        else:
            errors.append('Failed to save Telegram proxy')

    if 'wecom_webhook_url' in data:
        if set_setting_encrypted('wecom_webhook_url', data['wecom_webhook_url'].strip()):
            updated.append('Enterprise WeChat Webhook')
        else:
            errors.append('Failed to save Enterprise WeChat Webhook')

    if 'webdav_backup_enabled' in data:
        enabled = normalize_bool_setting_value(data['webdav_backup_enabled'])
        if set_setting('webdav_backup_enabled', enabled):
            updated.append('WebDAV backup switch')
        else:
            errors.append('Failed to save WebDAV backup switch')

    if 'webdav_backup_url' in data:
        if set_setting('webdav_backup_url', str(data['webdav_backup_url']).strip()):
            updated.append('WebDAV Directory URL')
        else:
            errors.append('Failed to save WebDAV directory URL')

    if 'webdav_backup_username' in data:
        if set_setting('webdav_backup_username', str(data['webdav_backup_username']).strip()):
            updated.append('WebDAV username')
        else:
            errors.append('Failed to save WebDAV username')

    if 'webdav_backup_password' in data:
        if set_setting_encrypted('webdav_backup_password', str(data['webdav_backup_password']).strip()):
            updated.append('WebDAV password')
        else:
            errors.append('Failed to save WebDAV password')

    if 'webdav_backup_cron' in data:
        cron_expr = str(data['webdav_backup_cron']).strip()
        backup_timezone = normalize_app_timezone_name(str(data.get('app_timezone') or get_app_timezone()).strip(), get_app_timezone())
        cron_error = validate_five_field_cron_expression_for_timezone(cron_expr, backup_timezone)
        if cron_error:
            errors.append(cron_error)
        elif set_setting('webdav_backup_cron', cron_expr):
            updated.append('WebDAV Backup Cron')
        else:
            errors.append('Saving WebDAV backup Cron failed')

    if errors:
        return jsonify({'success': False, 'error': '；'.join(errors)})

    if updated:
        return jsonify({'success': True, 'message': f"Updated: {', '.join(updated)}"})
    else:
        return jsonify({'success': False, 'error': 'There are no settings to update'})


# ==================== Skin Management API ====================

@app.route('/api/skins', methods=['GET'])
@login_required
def api_list_skins():
    return jsonify({
        'success': True,
        **get_skin_settings_payload(),
    })


@app.route('/api/skins/<skin_id>/activate', methods=['POST'])
@login_required
def api_activate_skin(skin_id):
    success, error, skin = set_active_skin(skin_id)
    if not success:
        return jsonify({'success': False, 'error': error or 'Failed to enable skin'})
    return jsonify({
        'success': True,
        'message': 'Skin enabled',
        'active_skin': skin,
        'asset_hash': get_active_skin_asset_hash(),
    })


@app.route('/api/skins/upload', methods=['POST'])
@login_required
def api_upload_skin():
    uploaded_file = request.files.get('skin') or request.files.get('file')
    try:
        skin = install_uploaded_skin_file(uploaded_file)
    except SkinValidationError as exc:
        return jsonify({'success': False, 'error': str(exc)})
    except Exception as exc:
        return jsonify({'success': False, 'error': f'Failed to install and upload skin: {sanitize_error_details(str(exc))}'})

    return jsonify({
        'success': True,
        'message': 'Skin installed',
        'skin': skin,
    })


@app.route('/api/skins/git/install', methods=['POST'])
@login_required
def api_install_git_skin():
    data = request.get_json(silent=True) or {}
    try:
        skin = install_git_skin_package(data.get('git_url'), data.get('git_ref', ''))
    except SkinValidationError as exc:
        return jsonify({'success': False, 'error': str(exc)})
    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Timeout when pulling Git skin'})
    except Exception as exc:
        return jsonify({'success': False, 'error': f'Failed to install Git skin: {sanitize_error_details(str(exc))}'})

    return jsonify({
        'success': True,
        'message': 'Git skin installed',
        'skin': skin,
    })


@app.route('/api/skins/<skin_id>/git/update', methods=['POST'])
@login_required
def api_update_git_skin(skin_id):
    try:
        skin = update_git_skin_package(skin_id)
    except SkinValidationError as exc:
        return jsonify({'success': False, 'error': str(exc)})
    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Update Git skin timeout'})
    except Exception as exc:
        return jsonify({'success': False, 'error': f'Failed to update Git skin: {sanitize_error_details(str(exc))}'})

    return jsonify({
        'success': True,
        'message': 'Git skin has been updated',
        'skin': skin,
    })


@app.route('/api/skins/<skin_id>', methods=['DELETE'])
@login_required
def api_delete_skin(skin_id):
    success, error = delete_custom_skin(skin_id)
    if not success:
        return jsonify({'success': False, 'error': error or 'Failed to delete skin'})
    return jsonify({'success': True, 'message': 'Skin removed'})


# ==================== External API ====================

@app.route('/api/external/emails', methods=['GET'])
@csrf_exempt
@api_key_required
def api_external_get_emails():
    'External API: Get the mailing list through API Key'
    email_addr = get_query_arg_preserve_plus('email', '').strip()
    folder = request.args.get('folder', 'inbox').strip().lower()
    skip = parse_non_negative_int(request.args.get('skip', 0), 0)
    top = parse_non_negative_int(request.args.get('top', 20), 20, 50)

    if not email_addr:
        return jsonify({'success': False, 'error': 'Missing email parameter'}), 400

    # Verify folder parameter
    valid_folders = ['inbox', 'junkemail']
    if folder not in valid_folders:
        return jsonify({'success': False, 'error': f"The folder parameter is invalid, supported: {', '.join(valid_folders)}"}), 400

    account = resolve_account_for_email_api(email_addr)
    if not account:
        return jsonify({'success': False, 'error': 'The email account does not exist'}), 404

    # Get proxy settings: Account level configuration takes priority, if not configured, group proxy will be inherited.
    proxy_url = get_account_proxy_url(account)
    fallback_proxy_urls = get_account_proxy_failover_urls(account)

    # Collect all error information
    all_errors = {}

    # 1. Try Graph API
    graph_result = get_emails_graph(
        account['client_id'],
        account['refresh_token'],
        folder,
        skip,
        top,
        proxy_url,
        fallback_proxy_urls,
    )
    if graph_result.get('success'):
        emails = graph_result.get('emails', [])
        formatted = [format_graph_email_item(e, folder) for e in emails]
        return jsonify({
            'success': True,
            'emails': formatted,
            'method': 'Graph API',
            'has_more': len(formatted) >= top
        })
    else:
        graph_error = graph_result.get('error')
        all_errors['graph'] = graph_error
        if isinstance(graph_error, dict) and graph_error.get('type') in ('ProxyError', 'ConnectionError'):
            return jsonify({'success': False, 'error': 'Account proxy or group proxy connection failed', 'details': all_errors})

    # 2. Try the new version of IMAP
    imap_new_result = get_emails_imap_with_server(
        account['email'], account['client_id'], account['refresh_token'],
        folder, skip, top, IMAP_SERVER_NEW, proxy_url, fallback_proxy_urls
    )
    if imap_new_result.get('success'):
        return jsonify({
            'success': True,
            'emails': imap_new_result.get('emails', []),
            'method': 'IMAP (New)',
            'has_more': False
        })
    else:
        all_errors['imap_new'] = imap_new_result.get('error')

    # 3. Try an older version of IMAP
    imap_old_result = get_emails_imap_with_server(
        account['email'], account['client_id'], account['refresh_token'],
        folder, skip, top, IMAP_SERVER_OLD, proxy_url, fallback_proxy_urls
    )
    if imap_old_result.get('success'):
        return jsonify({
            'success': True,
            'emails': imap_old_result.get('emails', []),
            'method': 'IMAP (Old)',
            'has_more': False
        })
    else:
        all_errors['imap_old'] = imap_old_result.get('error')

    return jsonify({'success': False, 'error': 'Unable to get mail, all methods failed', 'details': all_errors})


@app.route('/api/external/outlook/upload', methods=['POST'])
@csrf_exempt
@api_key_required
def api_external_upload_outlook():
    'External API: Upload Outlook email account password to the upload table (unauthorized by default).\n\n    Supports single {email, password, remark?} or batch {accounts: [...]}.\n    '
    data = request.get_json(silent=True) or {}

    raw_accounts = data.get('accounts')
    if isinstance(raw_accounts, list) and raw_accounts:
        items = [
            {
                'email': item.get('email', ''),
                'password': item.get('password', ''),
                'remark': item.get('remark', ''),
            }
            for item in raw_accounts
            if isinstance(item, dict)
        ]
    elif data.get('email'):
        items = [{
            'email': data.get('email', ''),
            'password': data.get('password', ''),
            'remark': data.get('remark', ''),
        }]
    else:
        return jsonify({'success': False, 'error': 'The request body must contain email/password or a non-empty accounts array'}), 400

    summary = add_upload_accounts_bulk(items)
    return jsonify({'success': True, **summary})


@app.route('/api/outlook-upload-accounts', methods=['GET'])
@login_required
def api_list_outlook_upload_accounts():
    'Query externally uploaded Outlook accounts in pages for front-end pop-up table display.'
    page = parse_non_negative_int(request.args.get('page', 1), 1) or 1
    page_size = parse_non_negative_int(
        request.args.get('page_size', UPLOAD_ACCOUNTS_API_DEFAULT_PAGE_SIZE),
        UPLOAD_ACCOUNTS_API_DEFAULT_PAGE_SIZE,
        UPLOAD_ACCOUNTS_MAX_PAGE_SIZE,
    )
    keyword = str(request.args.get('keyword', '') or '').strip()
    auth_status = str(request.args.get('auth_status', 'all') or 'all').strip().lower()
    result = query_upload_accounts_page(
        page=page,
        page_size=page_size,
        keyword=keyword,
        auth_status=auth_status,
    )
    return jsonify({'success': True, **result})


@app.route('/api/outlook-upload-accounts', methods=['POST'])
@login_required
def api_add_outlook_upload_account():
    'Add a single externally uploaded Outlook account.'
    data = request.get_json(silent=True) or {}
    email = str(data.get('email', '') or '').strip()
    password = str(data.get('password', '') or '').strip()
    remark = str(data.get('remark', '') or '').strip()
    group_id = data.get('group_id')
    proxy_url = str(data.get('proxy_url', '') or '').strip()
    tag_ids = data.get('tag_ids')

    if not email:
        return jsonify({'success': False, 'error': 'The mailbox cannot be empty'}), 400
    if not password:
        return jsonify({'success': False, 'error': 'Password cannot be empty'}), 400

    result = add_upload_account(
        email,
        password,
        remark,
        group_id=group_id,
        proxy_url=proxy_url,
        tag_ids=tag_ids,
    )
    db = get_db()
    db.commit()

    if result['status'] == 'added':
        return jsonify({'success': True, 'message': 'Added successfully', 'account': result})
    elif result['status'] == 'duplicate':
        return jsonify({'success': False, 'error': 'The email already exists'}), 400
    else:
        return jsonify({'success': False, 'error': 'Invalid email format'}), 400


@app.route('/api/outlook-upload-accounts/<int:account_id>', methods=['PUT'])
@login_required
def api_update_outlook_upload_account(account_id):
    'Update the external upload account (email/password/notes) of the specified ID.\n\n    The request body fields are all optional; leaving password blank means keeping the original password; email/remark will keep the original value if it is not passed in.\n    '
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    password = data.get('password')
    remark = data.get('remark')

    if email is not None:
        email = str(email).strip()
    if password is not None:
        password = str(password)
    if remark is not None:
        remark = str(remark).strip()

    result = update_upload_account(
        account_id,
        email=email,
        password=password,
        remark=remark,
    )
    status = result.get('status')
    if status == 'updated':
        db = get_db()
        db.commit()
        return jsonify({'success': True, 'message': 'Modification successful', 'account': result})
    if status == 'not_found':
        return jsonify({'success': False, 'error': 'Account does not exist'}), 404
    if status == 'duplicate':
        return jsonify({'success': False, 'error': 'The email already exists'}), 400
    if status == 'invalid':
        return jsonify({'success': False, 'error': 'Invalid email format'}), 400
    return jsonify({'success': False, 'error': 'Modification failed'}), 400


@app.route('/api/outlook-upload-accounts/<int:account_id>', methods=['DELETE'])
@login_required
def api_delete_outlook_upload_account(account_id):
    'Delete the external upload account with the specified ID.'
    success = delete_upload_account(account_id)
    if success:
        db = get_db()
        db.commit()
        return jsonify({'success': True, 'message': 'Deletion successful'})
    else:
        return jsonify({'success': False, 'error': 'Account does not exist'}), 404


@app.route('/api/outlook-upload-accounts/batch-delete', methods=['POST'])
@login_required
def api_batch_delete_outlook_upload_accounts():
    'Delete Outlook upload accounts in batches.'
    data = request.get_json(silent=True) or {}
    account_ids = normalize_account_ids(data.get('account_ids') or [])
    if not account_ids:
        return jsonify({'success': False, 'error': 'Please select the account you want to delete'}), 400

    summary = delete_upload_accounts_bulk(account_ids)
    get_db().commit()
    return jsonify({
        'success': True,
        'message': f"{summary['deleted']} accounts deleted",
        **summary,
    })


@app.route('/api/outlook-upload-accounts/export-selected', methods=['POST'])
@login_required
def api_export_selected_upload_accounts():
    'Export the selected Outlook upload account to a TXT file (secondary verification required)'
    data = request.get_json(silent=True) or {}
    account_ids = normalize_account_ids(data.get('account_ids') or [])
    verify_token = data.get('verify_token')

    # Check the two-step verification token (using memory storage)
    if not verify_token or verify_token not in export_verify_tokens:
        return jsonify({'success': False, 'error': 'Secondary verification required', 'need_verify': True}), 401

    token_data = export_verify_tokens[verify_token]

    # Check if it is expired
    if token_data['expires'] < time.time():
        del export_verify_tokens[verify_token]
        return jsonify({'success': False, 'error': 'Verification has expired, please verify again', 'need_verify': True}), 401

    # Clear verification token (one-time use)
    del export_verify_tokens[verify_token]

    if not account_ids:
        return jsonify({'success': False, 'error': 'Please select the account to be exported'}), 400

    # Query upload account
    db = get_db()
    placeholders = ','.join('?' * len(account_ids))
    rows = db.execute(
        f'''SELECT u.id, u.email, u.password,
                   COALESCE(a.client_id, '') AS client_id,
                   COALESCE(a.refresh_token, '') AS refresh_token
            FROM outlook_upload_accounts u
            LEFT JOIN accounts a ON a.email = u.email AND a.account_type = 'outlook'
            WHERE u.id IN ({placeholders})''',
        account_ids
    ).fetchall()

    if not rows:
        return jsonify({'success': False, 'error': 'The selected account does not exist or there is no exportable upload account.'})

    # Format export content
    lines = []
    for row in rows:
        email = str(row['email'] or '')
        password = get_upload_account_plain_password(row, tolerate_decrypt_error=True)
        client_id = str(row['client_id'] or '')
        # refresh_token is stored in the library as 'enc:' ciphertext; export must be decrypted into plaintext, otherwise external
        # What the consumer gets is unusable ciphertext. Consistent with password: leave blank when decryption fails instead
        # Leak the ciphertext into the export file.
        try:
            refresh_token = decrypt_data(str(row['refresh_token'] or ''))
        except RuntimeError:
            refresh_token = ''
        lines.append(f"{email}----{password}----{client_id}----{refresh_token}")

    content = '\n'.join(lines)

    log_audit(
        'export',
        'selected_upload_accounts',
        ','.join(map(str, account_ids)),
        f'Export the selected {len(rows)} upload accounts'
    )

    from datetime import datetime
    from urllib.parse import quote
    filename = f"upload_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    encoded_filename = quote(filename)

    return Response(
        content,
        mimetype='text/plain',
        headers={
            'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}",
            'Content-Type': 'text/plain; charset=utf-8'
        }
    )


def _queue_formal_account_for_auto_auth(account_id: int) -> Dict[str, Any]:
    'Add a single official account to the automatic authorization queue; return the result dictionary (including success).'
    account = get_account_by_id(account_id)
    if not account:
        return {
            'success': False,
            'account_id': account_id,
            'error': 'Account does not exist',
            'error_code': 'ACCOUNT_NOT_FOUND',
        }

    account_type = str(account.get('account_type') or 'outlook').lower()
    if account_type == 'imap':
        return {
            'success': False,
            'account_id': account_id,
            'email': str(account.get('email') or ''),
            'error': 'IMAP accounts do not support Outlook automated authorization.',
            'error_code': 'ACCOUNT_AUTO_AUTH_UNSUPPORTED',
        }

    email = str(account.get('email') or '').strip()
    password = str(account.get('password') or '').strip()
    if not email or not password:
        return {
            'success': False,
            'account_id': account_id,
            'email': email,
            'error': 'The account password is empty or cannot be decrypted. Please set the password in editing first.',
            'error_code': 'ACCOUNT_PASSWORD_MISSING',
        }

    remark = str(account.get('remark') or '').strip()
    group_id = account.get('group_id') or DEFAULT_GROUP_ID
    proxy_url = str(account.get('proxy_url') or '').strip()
    tag_ids = [tag.get('id') for tag in get_account_tags(account_id)]
    result = upsert_upload_account_for_auto_auth(
        email,
        password,
        remark,
        group_id=group_id,
        proxy_url=proxy_url,
        tag_ids=tag_ids,
    )
    if result['status'] == 'invalid':
        return {
            'success': False,
            'account_id': account_id,
            'email': email,
            'error': 'Invalid email or password, unable to join automatic authorization',
            'error_code': 'ACCOUNT_AUTO_AUTH_INVALID',
        }

    return {
        'success': True,
        'account_id': account_id,
        'upload_account_id': result['id'],
        'email': result['email'],
        'status': result['status'],
    }


@app.route('/api/accounts/<int:account_id>/outlook-auto-auth', methods=['POST'])
@login_required
def api_queue_account_for_outlook_auto_auth(account_id):
    'Add the existing official Outlook account to the Outlook automated authorization queue.\n\n    Read the official account email and password from the server, and call the explicit re-entry helper to write\n    outlook_upload_accounts. No password is returned.\n    '
    result = _queue_formal_account_for_auto_auth(account_id)
    if not result.get('success'):
        error_code = result.get('error_code') or 'ACCOUNT_AUTO_AUTH_FAILED'
        status_code = 404 if error_code == 'ACCOUNT_NOT_FOUND' else 400
        return jsonify({
            'success': False,
            'error': build_error_payload(
                error_code,
                result.get('error') or 'Failed to join automatic authorization',
                'NotFoundError' if status_code == 404 else 'ValidationError',
                status_code,
                f"account_id={account_id}",
            ),
        }), status_code

    get_db().commit()
    return jsonify({
        'success': True,
        'message': 'Automatic authorization has been added' if result['status'] == 'added' else 'Automatic authorization has been rejoined',
        'upload_account_id': result['upload_account_id'],
        'email': result['email'],
        'status': result['status'],
    })


@app.route('/api/accounts/batch-outlook-auto-auth', methods=['POST'])
@login_required
def api_batch_queue_accounts_for_outlook_auto_auth():
    'Add official Outlook accounts to the automated authorization queue in batches.'
    data = request.get_json(silent=True) or {}
    account_ids = normalize_account_ids(data.get('account_ids') or [])
    if not account_ids:
        return jsonify({'success': False, 'error': 'Please select the account to be added to the automatic authorization'}), 400

    results: List[Dict[str, Any]] = []
    added = updated = failed = 0
    for account_id in account_ids:
        outcome = _queue_formal_account_for_auto_auth(account_id)
        results.append(outcome)
        if not outcome.get('success'):
            failed += 1
            continue
        if outcome.get('status') == 'updated':
            updated += 1
        else:
            added += 1

    get_db().commit()
    return jsonify({
        'success': True,
        'message': f'{len(account_ids)} accounts processed: {added} added, {updated} rejoined, failed {failed}',
        'total': len(account_ids),
        'added': added,
        'updated': updated,
        'failed': failed,
        'results': results,
    })
