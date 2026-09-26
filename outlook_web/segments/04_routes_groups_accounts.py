from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    # These segmented files are executed into the shared `web_outlook_app`
    # globals at runtime. Importing from the assembled module keeps IDE
    # inspections from flagging the shared names as unresolved.
    from web_outlook_app import *  # noqa: F403


@app.route('/login', methods=['GET', 'POST'])
@csrf_exempt  # The login interface excludes CSRF protection (the user cannot obtain the token when not logged in)
def login():
    'Login page'
    if request.method == 'POST':
        try:
            # Get client IP
            client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
            if client_ip:
                client_ip = client_ip.split(',')[0].strip()

            # Check rate limits
            allowed, remaining_time = check_rate_limit(client_ip)
            if not allowed:
                return jsonify({
                    'success': False,
                    'error': f'Too many failed login attempts, please try again in {remaining_time} seconds'
                }), 429

            data = request.get_json(silent=True) if request.is_json else request.form
            data = data or {}
            password = data.get('password', '')
            duration_provided = 'session_duration_days' in data
            duration_days = normalize_login_session_duration(
                data.get('session_duration_days'),
                allow_default=not duration_provided,
            )

            # Get password hash from database
            stored_password = get_login_password()

            # Verify password
            if verify_password(password, stored_password):
                if duration_days is None:
                    return jsonify({'success': False, 'error': 'The login validity period is invalid'}), 400
                # Successful login, reset failure record
                reset_login_attempts(client_ip)
                establish_web_login_session(duration_days)
                return jsonify({'success': True, 'message': 'Login successful'})
            else:
                # Login failed, record the number of failures
                record_login_failure(client_ip)
                return jsonify({'success': False, 'error': 'Wrong password'})
        except Exception as e:
            print(f"Login error: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'success': False, 'error': f'Login processing failed: {str(e)}'}), 500

    # GET request returns the login page
    return render_template('login.html')


@app.route('/logout')
def logout():
    'Sign out'
    clear_web_login_session()
    return redirect(url_for('login'))


extension_login_tokens = {}
EXTENSION_LOGIN_TOKEN_TTL_SECONDS = 60


def prune_extension_login_tokens():
    now = time.time()
    expired_tokens = [
        token for token, payload in extension_login_tokens.items()
        if float(payload.get('expires_at', 0)) <= now
    ]
    for token in expired_tokens:
        extension_login_tokens.pop(token, None)


def normalize_extension_next_path(next_path: str) -> str:
    value = str(next_path or '').strip()
    if not value or not value.startswith('/') or value.startswith('//'):
        return '/'
    if '\r' in value or '\n' in value:
        return '/'
    return value


@app.route('/api/extension/login', methods=['POST'])
@csrf_exempt
def api_extension_login():
    'Browser extension password login: Returns a one-time web session jump address.'
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if client_ip:
        client_ip = client_ip.split(',')[0].strip()

    allowed, remaining_time = check_rate_limit(client_ip)
    if not allowed:
        return jsonify({
            'success': False,
            'error': f'Too many failed login attempts, please try again in {remaining_time} seconds'
        }), 429

    data = request.get_json(silent=True) or {}
    password = str(data.get('password') or '')
    if not verify_login_password(password):
        record_login_failure(client_ip)
        return jsonify({'success': False, 'error': 'Wrong password'}), 401

    reset_login_attempts(client_ip)
    prune_extension_login_tokens()

    token = secrets.token_urlsafe(32)
    next_path = normalize_extension_next_path(data.get('next') or '/')
    extension_login_tokens[token] = {
        'expires_at': time.time() + EXTENSION_LOGIN_TOKEN_TTL_SECONDS,
        'next': next_path,
        'login_session_version': get_login_session_version(),
    }

    return jsonify({
        'success': True,
        'launch_url': url_for('extension_login', token=token, next=next_path),
        'expires_in': EXTENSION_LOGIN_TOKEN_TTL_SECONDS,
    })


@app.route('/extension-login/<token>', methods=['GET'])
@csrf_exempt
def extension_login(token):
    'Consume the extended one-time login ticket and establish a Web Session under the server domain name.'
    prune_extension_login_tokens()
    payload = extension_login_tokens.pop(str(token or ''), None)
    if not payload:
        return redirect(url_for('login'))

    token_version = str(payload.get('login_session_version') or DEFAULT_LOGIN_SESSION_VERSION)
    if token_version != get_login_session_version():
        return redirect(url_for('login'))

    establish_web_login_session()
    return redirect(normalize_extension_next_path(request.args.get('next') or payload.get('next') or '/'))


@app.route('/favicon.ico')
def favicon():
    'Return inline SVG favicon to avoid 500 errors'
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="20" fill="#1a1a1a"/>
        <text x="50" y="55" font-size="60" text-anchor="middle" dominant-baseline="middle">📧</text>
    </svg>'''
    response = make_response(svg)
    response.headers['Content-Type'] = 'image/svg+xml'
    response.headers['Cache-Control'] = 'public, max-age=31536000'
    return response


@app.route('/assets/index.css')
def bundled_index_css():
    'Return the merged homepage style to prevent the proxy layer from intercepting CSS @import subrequests.'
    static_root = Path(app.static_folder)

    combined_css = '\n\n'.join(
        (static_root / filename).read_text(encoding='utf-8')
        for filename in INDEX_CSS_FILES
    )
    response = Response(combined_css, mimetype='text/css')
    response.headers['ETag'] = f'"index-{compute_static_assets_hash(INDEX_CSS_FILES)}"'
    if request.args.get('v'):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    else:
        response.headers['Cache-Control'] = 'no-cache, max-age=0'
    return response


@app.route('/assets/active-skin.css')
def active_skin_css():
    'Returns the CSS of the currently enabled skin; falls back to empty classic override on failure.'
    css_text, asset_hash = get_active_skin_css()
    response = Response(css_text, mimetype='text/css')
    response.headers['Cache-Control'] = 'public, max-age=300'
    response.headers['ETag'] = f'"skin-{asset_hash}"'
    return response


@app.route('/')
@login_required
def index():
    'Home page'
    response = make_response(render_template(
        'index.html',
        app_version=APP_VERSION,
        changelog_url=CHANGELOG_URL,
        frontend_asset_hash=get_frontend_asset_hash(),
        skin_asset_hash=get_active_skin_asset_hash(),
        mail_fetch_timeout_seconds=get_mail_fetch_timeout_seconds(),
    ))
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.vary.add('Cookie')
    return response


@app.route('/api/version-status', methods=['GET'])
@login_required
def api_get_version_status():
    'Get the current version and warehouse version status'
    refresh = str(request.args.get('refresh', '')).strip().lower() in {'1', 'true', 'yes'}
    return jsonify({
        'success': True,
        'version_status': get_version_status_payload(force_refresh=refresh),
    })


@app.route('/api/csrf-token', methods=['GET'])
@login_required
@csrf_exempt  # CSRF token acquisition interface excludes CSRF protection
def get_csrf_token():
    'Obtain CSRF Token'
    response = None
    if CSRF_AVAILABLE:
        token = generate_csrf()
        response = jsonify({'csrf_token': token, 'csrf_disabled': False})
    else:
        response = jsonify({'csrf_token': None, 'csrf_disabled': True})

    # The CSRF token must be consistent with the current login session, and browser or proxy caching is prohibited.
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.vary.add('Cookie')
    return response


# ==================== Grouping API ====================

@app.route('/api/groups', methods=['GET'])
@login_required
def api_get_groups():
    'Get all groups'
    groups = load_groups()
    # Add the number of mailboxes for each group
    for group in groups:
        if group['name'] == '\u4e34\u65f6\u90ae\u7bb1':
            # Temporary mailbox grouping obtains the number from the temp_emails table
            group['account_count'] = get_temp_email_count()
            group['descendant_account_count'] = group['account_count']
            group['sort_position'] = None
        else:
            group['account_count'] = get_group_account_count(group['id'])
            group['descendant_account_count'] = get_group_account_count(group['id'], recursive=True)
            group['sort_position'] = get_group_sort_position(group['id'])
    return jsonify({'success': True, 'groups': groups})


@app.route('/api/groups/<int:group_id>', methods=['GET'])
@login_required
def api_get_group(group_id):
    'Get a single group'
    group = get_group_by_id(group_id)
    if not group:
        return jsonify({'success': False, 'error': 'Group does not exist'})
    group['account_count'] = get_group_account_count(group_id)
    group['descendant_account_count'] = get_group_account_count(group_id, recursive=True)
    group['sort_position'] = get_group_sort_position(group_id)
    return jsonify({'success': True, 'group': group})


@app.route('/api/groups', methods=['POST'])
@login_required
def api_add_group():
    'Add group'
    data = request.json
    name = sanitize_input(data.get('name', '').strip(), max_length=100)
    description = sanitize_input(data.get('description', ''), max_length=500)
    color = data.get('color', '#1a1a1a')
    proxy_url = data.get('proxy_url', '').strip()
    fallback_proxy_url_1 = data.get('fallback_proxy_url_1', '').strip()
    fallback_proxy_url_2 = data.get('fallback_proxy_url_2', '').strip()
    sort_position_raw = data.get('sort_position')
    parent_id_raw = data.get('parent_id')

    if not name:
        return jsonify({'success': False, 'error': 'The group name cannot be empty'})

    try:
        sort_position = int(sort_position_raw) if sort_position_raw not in (None, '') else None
        parent_id = normalize_group_parent_id(parent_id_raw)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Invalid grouping parameter'})

    valid_parent, parent_error, _ = validate_group_parent_for_create(parent_id)
    if not valid_parent:
        return jsonify({'success': False, 'error': parent_error})

    group_id = add_group(name, description, color, proxy_url, fallback_proxy_url_1, fallback_proxy_url_2, sort_position, parent_id)
    if group_id:
        return jsonify({'success': True, 'message': 'Group created successfully', 'group_id': group_id})
    else:
        return jsonify({'success': False, 'error': 'Group name already exists'})


@app.route('/api/groups/<int:group_id>', methods=['PUT'])
@login_required
def api_update_group(group_id):
    'Update group'
    data = request.json
    name = sanitize_input(data.get('name', '').strip(), max_length=100)
    description = sanitize_input(data.get('description', ''), max_length=500)
    color = data.get('color', '#1a1a1a')
    proxy_url = data.get('proxy_url', '').strip()
    fallback_proxy_url_1 = data.get('fallback_proxy_url_1', '').strip()
    fallback_proxy_url_2 = data.get('fallback_proxy_url_2', '').strip()
    sort_position_raw = data.get('sort_position')
    parent_id_provided = 'parent_id' in data
    parent_id_raw = data.get('parent_id') if parent_id_provided else None

    if not name:
        return jsonify({'success': False, 'error': 'The group name cannot be empty'})

    try:
        sort_position = int(sort_position_raw) if sort_position_raw not in (None, '') else None
        parent_id = normalize_group_parent_id(parent_id_raw) if parent_id_provided else None
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Invalid grouping parameter'})

    if parent_id_provided:
        valid_move, move_error = validate_group_move(group_id, parent_id)
        if not valid_move:
            return jsonify({'success': False, 'error': move_error})
        update_success = update_group(
            group_id, name, description, color, proxy_url,
            fallback_proxy_url_1, fallback_proxy_url_2, sort_position,
            parent_id=parent_id
        )
    else:
        update_success = update_group(group_id, name, description, color, proxy_url, fallback_proxy_url_1, fallback_proxy_url_2, sort_position)

    if update_success:
        return jsonify({'success': True, 'message': 'Group update successful'})
    else:
        return jsonify({'success': False, 'error': 'Update failed'})


@app.route('/api/groups/<int:group_id>', methods=['DELETE'])
@login_required
def api_delete_group(group_id):
    'Delete group'
    if group_id == 1:
        return jsonify({'success': False, 'error': 'The default group cannot be deleted'})

    result = delete_group_tree(group_id)
    if result.get('success'):
        child_count = int(result.get('deleted_child_count') or 0)
        return jsonify({
            'success': True,
            'message': 'The group has been deleted and the mailbox has been moved to the default group',
            'deleted_child_count': child_count,
        })
    else:
        return jsonify({'success': False, 'error': result.get('error') or 'Delete failed'})


@app.route('/api/groups/reorder', methods=['PUT'])
@login_required
def api_reorder_groups():
    'Reorder groups'
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    parent_id_raw = data.get('parent_id')

    if not isinstance(group_ids, list) or not all(isinstance(group_id, int) for group_id in group_ids):
        return jsonify({'success': False, 'error': 'Invalid grouping sorting parameter'})

    try:
        parent_id = normalize_group_parent_id(parent_id_raw)
    except ValueError:
        return jsonify({'success': False, 'error': 'Parent group is invalid'})

    if reorder_groups(group_ids, parent_id):
        return jsonify({'success': True, 'message': 'Group sorting has been updated'})
    else:
        return jsonify({'success': False, 'error': 'Group sorting failed'})


def append_temp_email_export_sections(lines: List[str], temp_emails: List[Dict[str, Any]]) -> int:
    exported_count = 0
    gptmail_list = [te for te in temp_emails if te.get('provider', 'gptmail') == 'gptmail']
    duckmail_list = [te for te in temp_emails if te.get('provider') == 'duckmail']
    cloudflare_list = [te for te in temp_emails if te.get('provider') == 'cloudflare']

    if gptmail_list:
        lines.append('[gptmail]')
        for te in gptmail_list:
            lines.append(te['email'])
            exported_count += 1

    if duckmail_list:
        lines.append('[duckmail]')
        for te in duckmail_list:
            duckmail_password = decrypt_data(te.get('duckmail_password', '')) if te.get('duckmail_password') else ''
            lines.append(f"{te['email']}----{duckmail_password}")
            exported_count += 1

    if cloudflare_list:
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for te in cloudflare_list:
            channel_name = str(te.get('cloudflare_channel_name') or 'default').strip() or 'default'
            grouped.setdefault(channel_name, []).append(te)
        for channel_name in sorted(grouped.keys(), key=str.lower):
            lines.append(f'[cloudflare:{channel_name}]')
            for te in grouped[channel_name]:
                lines.append(te['email'])
                exported_count += 1

    return exported_count


@app.route('/api/groups/<int:group_id>/export')
@login_required
def api_export_group(group_id):
    'Export all email accounts under the group as TXT files (secondary verification required)'
    # Check the two-step verification token (using memory storage)
    verify_token = request.args.get('verify_token')
    import time
    if not verify_token or verify_token not in export_verify_tokens:
        return jsonify({'success': False, 'error': 'Secondary verification required', 'need_verify': True}), 401
    
    token_data = export_verify_tokens[verify_token]
    if token_data['expires'] < time.time():
        del export_verify_tokens[verify_token]
        return jsonify({'success': False, 'error': 'Verification has expired, please verify again', 'need_verify': True}), 401
    
    # Clear verification token (one-time use)
    del export_verify_tokens[verify_token]

    group = get_group_by_id(group_id)
    if not group:
        return jsonify({'success': False, 'error': 'Group does not exist'})

    lines = []
    is_temp_group = group['name'] == '\u4e34\u65f6\u90ae\u7bb1'

    if is_temp_group:
        # Temporary mailbox grouping obtains data from the temp_emails table
        temp_emails = load_temp_emails()
        if not temp_emails:
            return jsonify({'success': False, 'error': 'There is no temporary mailbox under this group'})

        lines.append(group['name'])
        append_temp_email_export_sections(lines, temp_emails)

        log_audit('export', 'group', str(group_id), f'Export {len(temp_emails)} temporary mailboxes of temporary mailbox group')
    else:
        # Ordinary grouping obtains data from the accounts table
        accounts = load_accounts(group_id)
        if not accounts:
            return jsonify({'success': False, 'error': 'There is no email account under this group'})

        lines.append(group['name'])
        log_audit('export', 'group', str(group_id), f"Export {len(accounts)} accounts of group '{group['name']}'")

        for acc in accounts:
            line = format_account_export_line(acc)
            lines.append(line)

    content = '\n'.join(lines)

    # Generate file name (use URL encoding to handle Chinese)
    filename = f"{group['name']}_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    encoded_filename = quote(filename)

    # Return file download response
    return Response(
        content,
        mimetype='text/plain; charset=utf-8',
        headers={
            'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )

def format_account_export_line(account: Dict[str, Any]) -> str:
    if account.get('account_type') == 'imap':
        provider = account.get('provider', 'custom')
        imap_password = account.get('imap_password', '')
        if provider == 'custom':
            return f"{account['email']}----{imap_password}----{account.get('imap_host', '')}----{account.get('imap_port', 993)}"
        return f"{account['email']}----{imap_password}"
    return f"{account['email']}----{account.get('password', '')}----{account.get('client_id', '')}----{account.get('refresh_token', '')}"


def build_group_export_content(group_ids: List[int]) -> Dict[str, Any]:
    'Generate export content consistent with "Export selected group".'
    all_lines = []
    exported_group_ids = []
    exported_account_ids = set()
    total_count = 0

    for group_id in group_ids:
        group = get_group_by_id(group_id)
        if not group:
            continue

        if group['name'] == '\u4e34\u65f6\u90ae\u7bb1':
            temp_emails = load_temp_emails()
            if not temp_emails:
                continue

            exported_group_ids.append(group_id)
            all_lines.append(group['name'])
            total_count += append_temp_email_export_sections(all_lines, temp_emails)
            continue

        accounts = [
            account for account in load_accounts(group_id)
            if int(account.get('id') or 0) not in exported_account_ids
        ]
        if not accounts:
            continue

        exported_group_ids.append(group_id)
        all_lines.append(group['name'])
        for acc in accounts:
            exported_account_ids.add(int(acc.get('id') or 0))
            all_lines.append(format_account_export_line(acc))
            total_count += 1

    return {
        'content': '\n'.join(all_lines),
        'lines': all_lines,
        'total_count': total_count,
        'group_ids': exported_group_ids,
    }


def load_accounts_by_ids_for_export(account_ids: List[int]) -> List[Dict[str, Any]]:
    normalized_ids = normalize_account_ids(account_ids)
    if not normalized_ids:
        return []

    db = get_db()
    accounts_by_id = {}
    for chunk_ids in chunk_account_ids(normalized_ids):
        placeholders = ','.join('?' * len(chunk_ids))
        rows = db.execute(f'''
            SELECT a.*, g.name as group_name, g.color as group_color
            FROM accounts a
            LEFT JOIN groups g ON a.group_id = g.id
            WHERE a.id IN ({placeholders})
        ''', chunk_ids).fetchall()
        for account in serialize_account_rows(rows, db):
            accounts_by_id[int(account['id'])] = account

    return [
        accounts_by_id[account_id]
        for account_id in normalized_ids
        if account_id in accounts_by_id
    ]


def build_selected_account_export_content(account_ids: List[int]) -> Dict[str, Any]:
    accounts = load_accounts_by_ids_for_export(account_ids)
    lines = [format_account_export_line(account) for account in accounts]
    return {
        'content': '\n'.join(lines),
        'total_count': len(accounts),
        'account_ids': [int(account['id']) for account in accounts],
    }


def build_all_groups_export_content() -> Dict[str, Any]:
    groups = load_groups()
    return build_group_export_content([group['id'] for group in groups])


@app.route('/api/accounts/export')
@login_required
def api_export_all_accounts():
    'Export all email accounts to TXT files (secondary verification required)'
    # Check the two-step verification token (using memory storage)
    verify_token = request.args.get('verify_token')
    import time
    if not verify_token or verify_token not in export_verify_tokens:
        return jsonify({'success': False, 'error': 'Secondary verification required', 'need_verify': True}), 401
    
    token_data = export_verify_tokens[verify_token]
    if token_data['expires'] < time.time():
        del export_verify_tokens[verify_token]
        return jsonify({'success': False, 'error': 'Verification has expired, please verify again', 'need_verify': True}), 401
    
    # Clear verification token (one-time use)
    del export_verify_tokens[verify_token]


    # Use load_accounts to get all accounts (automatic decryption)
    accounts = load_accounts()

    if not accounts:
        return jsonify({'success': False, 'error': 'No email account'})

    # Record audit log
    log_audit('export', 'all_accounts', None, f'Export all accounts, total {len(accounts)}')

    # Generate export content (format: email----password----client_id----refresh_token)
    lines = []
    for acc in accounts:
        line = format_account_export_line(acc)
        lines.append(line)

    content = '\n'.join(lines)

    # Generate file name (use URL encoding to handle Chinese)
    filename = f"all_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    encoded_filename = quote(filename)

    # Return file download response
    return Response(
        content,
        mimetype='text/plain; charset=utf-8',
        headers={
            'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )


@app.route('/api/accounts/export-selected', methods=['POST'])
@login_required
def api_export_selected_accounts():
    'Export selected groups or selected accounts as TXT files (requires secondary verification)'
    data = request.get_json(silent=True) or {}
    group_ids = data.get('group_ids', [])
    account_ids = data.get('account_ids', [])
    verify_token = data.get('verify_token')

    # Check the two-step verification token (using memory storage)
    import time
    if not verify_token or verify_token not in export_verify_tokens:
        return jsonify({'success': False, 'error': 'Secondary verification required', 'need_verify': True}), 401
    
    token_data = export_verify_tokens[verify_token]
    
    # Check if it is expired
    if token_data['expires'] < time.time():
        del export_verify_tokens[verify_token]
        return jsonify({'success': False, 'error': 'Verification has expired, please verify again', 'need_verify': True}), 401
    
    # Optional: Verify IP consistency (enhanced security)
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if client_ip:
        client_ip = client_ip.split(',')[0].strip()
    # Note: Since Cloudflare may use different edge nodes and the IP may change, verification is not mandatory for the time being.
    # if token_data['ip'] != client_ip:
    # return jsonify({'success': False, 'error': 'IP does not match', 'need_verify': True}), 401
    
    # Clear verification token (one-time use)
    del export_verify_tokens[verify_token]

    if account_ids:
        export_payload = build_selected_account_export_content(account_ids)
        total_count = export_payload['total_count']

        if total_count == 0:
            return jsonify({'success': False, 'error': 'The selected account does not exist or there is no exportable email account.'})

        log_audit(
            'export',
            'selected_accounts',
            ','.join(map(str, export_payload['account_ids'])),
            f'Export the selected {total_count} accounts'
        )

        filename = f"selected_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        encoded_filename = quote(filename)

        return Response(
            export_payload['content'],
            mimetype='text/plain; charset=utf-8',
            headers={
                'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )

    if not group_ids:
        return jsonify({'success': False, 'error': 'Please select the group to export'})

    export_payload = build_group_export_content(group_ids)
    total_count = export_payload['total_count']

    if total_count == 0:
        return jsonify({'success': False, 'error': 'There is no email account under the selected group'})

    # Record audit log
    log_audit('export', 'selected_groups', ','.join(map(str, export_payload['group_ids'])), f'Export {total_count} accounts of the selected group')

    content = export_payload['content']

    # Generate file name
    filename = f"selected_accounts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    encoded_filename = quote(filename)

    # Return file download response
    return Response(
        content,
        mimetype='text/plain; charset=utf-8',
        headers={
            'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )


@app.route('/api/export/verify', methods=['POST'])
@login_required
def api_generate_export_verify_token():
    'Generate export verification token (secondary verification)'
    data = request.json
    password = data.get('password', '')

    # Verify password
    db = get_db()
    cursor = db.execute("SELECT value FROM settings WHERE key = 'login_password'")
    result = cursor.fetchone()

    if not result:
        return jsonify({'success': False, 'error': 'System configuration error'})

    if not verify_login_password(password):
        return jsonify({'success': False, 'error': 'Wrong password'})

    # Generate one-time verification token
    verify_token = secrets.token_urlsafe(32)
    
    # Use IP + timestamp as user ID (because session cookies may be unreliable)
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if client_ip:
        client_ip = client_ip.split(',')[0].strip()
    
    # Store in memory dictionary (set to expire in 5 minutes)
    import time
    export_verify_tokens[verify_token] = {
        'ip': client_ip,
        'expires': time.time() + 300  # Validity period of 5 minutes
    }
    
    # Clean up expired tokens
    current_time = time.time()
    expired_tokens = [k for k, v in export_verify_tokens.items() if v['expires'] < current_time]
    for token in expired_tokens:
        del export_verify_tokens[token]

    return jsonify({'success': True, 'verify_token': verify_token})


# ==================== Email Account API ====================

def get_account_list_request_args() -> Dict[str, Any]:
    limit_arg = request.args.get('limit')
    limit, offset = normalize_account_pagination(limit_arg, request.args.get('offset', 0))
    sort_by, sort_order = normalize_account_sort(
        request.args.get('sort_by', 'created_at'),
        request.args.get('sort_order', 'desc')
    )
    include_untagged = str(request.args.get('include_untagged', '')).strip().lower() in {'1', 'true', 'yes'}
    return {
        'limit': limit,
        'offset': offset,
        'sort_by': sort_by,
        'sort_order': sort_order,
        'tag_ids': normalize_tag_filter_values(request.args.get('tag_ids', '')),
        'exclude_tag_ids': normalize_tag_filter_values(
            ','.join(request.args.getlist('exclude_tag_ids'))
        ),
        'include_untagged': include_untagged,
    }


def build_account_list_response(accounts: List[Dict[str, Any]], total: int,
                                limit: Optional[int], offset: int) -> Dict[str, Any]:
    loaded_count = len(accounts)
    effective_limit = limit if limit is not None else loaded_count
    return {
        'success': True,
        'accounts': accounts,
        'total': total,
        'limit': effective_limit,
        'offset': offset,
        'has_more': offset + loaded_count < total,
    }


@app.route('/api/accounts', methods=['GET'])
@login_required
def api_get_accounts():
    'Get all accounts'
    group_id = request.args.get('group_id', type=int)
    list_args = get_account_list_request_args()
    accounts = load_accounts(
        group_id,
        limit=list_args['limit'],
        offset=list_args['offset'],
        sort_by=list_args['sort_by'],
        sort_order=list_args['sort_order'],
        tag_ids=list_args['tag_ids'],
        include_untagged=list_args['include_untagged'],
        exclude_tag_ids=list_args['exclude_tag_ids'],
    )

    # Hide sensitive information when returning
    safe_accounts = []
    for acc in accounts:
        safe_accounts.append(serialize_account_summary(acc, {}))
    total = count_accounts(
        group_id,
        tag_ids=list_args['tag_ids'],
        include_untagged=list_args['include_untagged'],
        exclude_tag_ids=list_args['exclude_tag_ids'],
    )
    return jsonify(build_account_list_response(
        safe_accounts,
        total,
        list_args['limit'],
        list_args['offset'],
    ))


@app.route('/api/external/accounts', methods=['GET'])
@csrf_exempt
@api_key_required
def api_external_get_accounts():
    'External API: Obtain email account list through API Key'
    group_id = request.args.get('group_id', type=int)
    accounts = load_accounts(group_id, include_descendants=False)

    safe_accounts = []
    for acc in accounts:
        safe_accounts.append(
            serialize_account_summary(
                acc,
                {},
                include_client_meta=False,
                include_imap_meta=False
            )
        )

    return jsonify({
        'success': True,
        'total': len(safe_accounts),
        'accounts': safe_accounts
    })


# ==================== Project API ====================

@app.route('/api/projects', methods=['GET'])
@login_required
def api_get_projects():
    return jsonify({'success': True, 'data': {'projects': load_projects()}})


@app.route('/api/projects/<project_key>', methods=['GET'])
@login_required
def api_get_project(project_key):
    project = get_project_by_key(project_key)
    if not project:
        return jsonify({'success': False, 'error': 'Project does not exist'}), 404
    return jsonify({'success': True, 'data': {'project': project}})


@app.route('/api/projects/start', methods=['POST'])
@login_required
def api_start_project():
    data = request.get_json(silent=True) or {}
    project_key = data.get('project_key', '')
    name = data['name'] if 'name' in data else None
    description = data['description'] if 'description' in data else None
    group_ids_provided = 'group_ids' in data
    group_ids = data.get('group_ids', []) if group_ids_provided else None
    use_alias_email_provided = 'use_alias_email' in data
    use_alias_email = data.get('use_alias_email') if use_alias_email_provided else None

    try:
        project = start_project(
            project_key,
            name=name,
            description=description,
            group_ids=group_ids,
            group_ids_provided=group_ids_provided,
            use_alias_email=use_alias_email,
            use_alias_email_provided=use_alias_email_provided,
        )
        log_audit(
            'start',
            'project',
            project.get('project_key'),
            json.dumps(
                {
                    'created': bool(project.get('created')),
                    'added_count': int(project.get('added_count', 0)),
                    'deleted_count': int(project.get('deleted_count', 0)),
                    'use_alias_email': bool(project.get('use_alias_email', False)),
                },
                ensure_ascii=False,
            ),
        )
        return jsonify({'success': True, 'message': 'Project has been launched', 'data': project})
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@app.route('/api/projects/<project_key>/accounts', methods=['GET'])
@login_required
def api_get_project_accounts(project_key):
    status = request.args.get('status', '').strip()
    group_id = request.args.get('group_id', type=int)
    provider = request.args.get('provider', '').strip()
    keyword = request.args.get('keyword', '').strip()
    result = load_project_accounts(project_key, status=status, group_id=group_id, provider=provider, keyword=keyword)
    if not result:
        return jsonify({'success': False, 'error': 'Project does not exist'}), 404
    return jsonify({'success': True, 'data': result})


@app.route('/api/projects/<project_key>/claim-random', methods=['POST'])
@login_required
def api_claim_project_account(project_key):
    data = request.get_json(silent=True) or {}
    caller_id = (data.get('caller_id') or '').strip()
    task_id = (data.get('task_id') or '').strip()
    lease_seconds = data.get('lease_seconds', 600)
    try:
        account = claim_project_account(project_key, caller_id, task_id, lease_seconds)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500

    if not account:
        return jsonify({'success': False, 'error': 'There is no project email to collect'}), 200
    return jsonify({'success': True, 'data': account})


@app.route('/api/projects/<project_key>/complete-success', methods=['POST'])
@login_required
def api_complete_project_success(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    claim_token = (data.get('claim_token') or '').strip()
    caller_id = (data.get('caller_id') or '').strip()
    task_id = (data.get('task_id') or '').strip()
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id or not claim_token:
        return jsonify({'success': False, 'error': 'Missing account_id or claim_token'}), 400

    if complete_project_account_success(project_key, int(account_id), claim_token, caller_id, task_id, detail):
        return jsonify({'success': True, 'message': 'The project account has been marked successfully'})
    return jsonify({'success': False, 'error': 'Project account status does not match'}), 400


@app.route('/api/projects/<project_key>/complete-failed', methods=['POST'])
@login_required
def api_complete_project_failed(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    claim_token = (data.get('claim_token') or '').strip()
    caller_id = (data.get('caller_id') or '').strip()
    task_id = (data.get('task_id') or '').strip()
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id or not claim_token:
        return jsonify({'success': False, 'error': 'Missing account_id or claim_token'}), 400

    if complete_project_account_failed(project_key, int(account_id), claim_token, caller_id, task_id, detail):
        return jsonify({'success': True, 'message': 'The project account has been marked as failed'})
    return jsonify({'success': False, 'error': 'Project account status does not match'}), 400


@app.route('/api/projects/<project_key>/release', methods=['POST'])
@login_required
def api_release_project_account(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    claim_token = (data.get('claim_token') or '').strip()
    caller_id = (data.get('caller_id') or '').strip()
    task_id = (data.get('task_id') or '').strip()
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id or not claim_token:
        return jsonify({'success': False, 'error': 'Missing account_id or claim_token'}), 400

    if release_project_account(project_key, int(account_id), claim_token, caller_id, task_id, detail):
        return jsonify({'success': True, 'message': 'Project account has been released'})
    return jsonify({'success': False, 'error': 'Project account status does not match'}), 400


@app.route('/api/projects/<project_key>/reset-failed', methods=['POST'])
@login_required
def api_reset_project_failed(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id:
        return jsonify({'success': False, 'error': 'Missing account_id'}), 400

    if reset_project_account_failed(project_key, int(account_id), detail):
        return jsonify({'success': True, 'message': 'The failed email has been reset to be available for collection.'})
    return jsonify({'success': False, 'error': 'Project account status does not match'}), 400


@app.route('/api/projects/<project_key>/remove-account', methods=['POST'])
@login_required
def api_remove_project_account(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id:
        return jsonify({'success': False, 'error': 'Missing account_id'}), 400

    if remove_project_account(project_key, int(account_id), detail):
        return jsonify({'success': True, 'message': 'Project mailbox has been removed'})
    return jsonify({'success': False, 'error': 'The project account status does not match or is being received.'}), 400


@app.route('/api/projects/<project_key>/restore-account', methods=['POST'])
@login_required
def api_restore_project_account(project_key):
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    detail = sanitize_input(data.get('detail', ''), max_length=500)
    if not account_id:
        return jsonify({'success': False, 'error': 'Missing account_id'}), 400

    if restore_project_account(project_key, int(account_id), detail):
        return jsonify({'success': True, 'message': 'The project mailbox has been restored'})
    return jsonify({'success': False, 'error': 'Project account status does not match'}), 400


# ==================== Tag API ====================

@app.route('/api/tags', methods=['GET'])
@login_required
def api_get_tags():
    'Get all tags'
    return jsonify({'success': True, 'tags': get_tags()})


@app.route('/api/tags', methods=['POST'])
@login_required
def api_add_tag():
    'Add tag'
    data = request.json
    name = sanitize_input(data.get('name', '').strip(), max_length=50)
    color = data.get('color', '#1a1a1a')

    if not name:
        return jsonify({'success': False, 'error': 'Tag name cannot be empty'})

    tag_id = add_tag(name, color)
    if tag_id:
        return jsonify({'success': True, 'tag': {'id': tag_id, 'name': name, 'color': color}})
    else:
        return jsonify({'success': False, 'error': 'Tag name already exists'})


@app.route('/api/tags/<int:tag_id>', methods=['DELETE'])
@login_required
def api_delete_tag(tag_id):
    'Delete tag'
    if delete_tag(tag_id):
        return jsonify({'success': True, 'message': 'Tag deleted'})
    else:
        return jsonify({'success': False, 'error': 'Delete failed'})


@app.route('/api/accounts/tags', methods=['POST'])
@login_required
def api_batch_manage_tags():
    'Batch management of account tags'
    data = request.json
    account_ids = data.get('account_ids', [])
    tag_id = data.get('tag_id')
    action = data.get('action')  # add, remove

    if not account_ids or not tag_id or not action:
        return jsonify({'success': False, 'error': 'Incomplete parameters'})

    count = 0
    for acc_id in account_ids:
        if action == 'add':
            if add_account_tag(acc_id, tag_id):
                count += 1
        elif action == 'remove':
            if remove_account_tag(acc_id, tag_id):
                count += 1

    return jsonify({'success': True, 'message': f'Successfully processed {count} accounts'})


@app.route('/api/accounts/batch-update-group', methods=['POST'])
@login_required
def api_batch_update_account_group():
    'Batch update account groups'
    data = request.json
    account_ids = data.get('account_ids', [])
    group_id = data.get('group_id')

    if not account_ids:
        return jsonify({'success': False, 'error': 'Please select the account to be modified'})

    if not group_id:
        return jsonify({'success': False, 'error': 'Please select the target group'})

    # Verify that the group exists
    group = get_group_by_id(group_id)
    if not group:
        return jsonify({'success': False, 'error': 'Target group does not exist'})

    # Check whether it is a temporary mailbox group (the system reserves the group)
    if group.get('is_system'):
        return jsonify({'success': False, 'error': 'Cannot move to system group'})

    # Batch update
    db = get_db()
    try:
        placeholders = ','.join('?' * len(account_ids))
        db.execute(f'''
            UPDATE accounts SET group_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id IN ({placeholders})
        ''', [group_id] + account_ids)
        db.commit()
        return jsonify({
            'success': True,
            'message': f'''{len(account_ids)} accounts have been moved to the "{group['name']}" group'''
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/accounts/batch-update-forwarding', methods=['POST'])
@login_required
def api_batch_update_account_forwarding():
    'Batch update account forwarding status'
    data = request.json or {}
    account_ids = data.get('account_ids', [])

    if 'forward_enabled' not in data:
        return jsonify({'success': False, 'error': 'Missing forwarding status parameter'})

    raw_forward_enabled = data.get('forward_enabled')
    if isinstance(raw_forward_enabled, str):
        forward_enabled = raw_forward_enabled.strip().lower() in {'1', 'true', 'yes', 'on'}
    else:
        forward_enabled = bool(raw_forward_enabled)

    result = update_accounts_forwarding_by_ids(account_ids, forward_enabled)
    if not result.get('success'):
        return jsonify(result)

    action_label = 'Turn on' if forward_enabled else 'Close'
    updated_count = result.get('updated_count', 0)
    unchanged_count = result.get('unchanged_count', 0)

    if updated_count and unchanged_count:
        message = f'Already forwarded for {updated_count} accounts {action_label}, {unchanged_count} accounts are already in this status'
    elif updated_count:
        message = f'Forwarded by {updated_count} account {action_label}'
    elif unchanged_count:
        message = f'The selected {unchanged_count} accounts are already in the {action_label} forwarding state'
    else:
        message = 'No account to update'

    return jsonify({
        'success': True,
        'message': message,
        'updated_count': updated_count,
        'updated_accounts': result.get('updated_accounts', []),
        'unchanged_count': unchanged_count,
        'missing_ids': result.get('missing_ids', []),
    })


@app.route('/api/accounts/batch-update-proxy', methods=['POST'])
@login_required
def api_batch_update_account_proxy():
    'Batch update account-level proxy configuration'
    data = request.json or {}
    result = update_accounts_proxy_by_ids(
        data.get('account_ids', []),
        str(data.get('proxy_url', '') or '').strip(),
        str(data.get('fallback_proxy_url_1', '') or '').strip(),
        str(data.get('fallback_proxy_url_2', '') or '').strip(),
    )
    if not result.get('success'):
        return jsonify(result)

    updated_count = result.get('updated_count', 0)
    unchanged_count = result.get('unchanged_count', 0)
    is_clearing = not any((
        str(data.get('proxy_url', '') or '').strip(),
        str(data.get('fallback_proxy_url_1', '') or '').strip(),
        str(data.get('fallback_proxy_url_2', '') or '').strip(),
    ))

    if updated_count:
        action_label = 'Clear account proxy and inherit group proxy instead' if is_clearing else 'Set up account proxy'
        message = f'Already {action_label} for {updated_count} accounts'
        if unchanged_count:
            message += f', {unchanged_count} accounts do not need to be updated'
    elif unchanged_count:
        message = f'The proxy configuration of the selected {unchanged_count} accounts does not need to be updated.'
    else:
        message = 'No account to update'

    return jsonify({
        'success': True,
        'message': message,
        'updated_count': updated_count,
        'updated_accounts': result.get('updated_accounts', []),
        'unchanged_count': unchanged_count,
        'missing_ids': result.get('missing_ids', []),
    })



@app.route('/api/accounts/search', methods=['GET'])
@login_required
def api_search_accounts():
    'Search account'
    query = request.args.get('q', '').strip()
    group_id = request.args.get('group_id', type=int)
    list_args = get_account_list_request_args()

    if not query:
        return jsonify(build_account_list_response([], 0, list_args['limit'], list_args['offset']))

    if len(normalize_account_search_terms(query)) > ACCOUNT_SEARCH_MAX_TERMS:
        return jsonify({'success': False, 'error': f'Search keywords support up to {ACCOUNT_SEARCH_MAX_TERMS}'}), 400

    accounts = search_account_records(
        query,
        group_id=group_id,
        limit=list_args['limit'],
        offset=list_args['offset'],
        sort_by=list_args['sort_by'],
        sort_order=list_args['sort_order'],
        tag_ids=list_args['tag_ids'],
        include_untagged=list_args['include_untagged'],
        exclude_tag_ids=list_args['exclude_tag_ids'],
    )
    safe_accounts = []
    for acc in accounts:
        safe_accounts.append(serialize_account_summary(acc, {}))

    total = count_accounts(
        group_id,
        query=query,
        tag_ids=list_args['tag_ids'],
        include_untagged=list_args['include_untagged'],
        exclude_tag_ids=list_args['exclude_tag_ids'],
    )
    return jsonify(build_account_list_response(
        safe_accounts,
        total,
        list_args['limit'],
        list_args['offset'],
    ))


@app.route('/api/accounts/<int:account_id>', methods=['GET'])
@login_required
def api_get_account(account_id):
    'Get single account details'
    account = get_account_by_id(account_id)
    if not account:
        return jsonify({'success': False, 'error': 'Account does not exist'})

    log_audit(
        'view_account_detail',
        'account',
        str(account_id),
        f"View account '{account.get('email', '')}' details (including password field)"
    )
    return jsonify({
        'success': True,
        'account': {
            'id': account['id'],
            'email': account['email'],
            'has_password': bool(account.get('password')),
            'password': account.get('password', '') or '',
            'client_id': account['client_id'],
            'refresh_token': account['refresh_token'],
            'account_type': account.get('account_type', 'outlook'),
            'provider': account.get('provider', 'outlook'),
            'authorization_type': get_account_authorization_type(account),
            'imap_host': account.get('imap_host', ''),
            'imap_port': account.get('imap_port', 993),
            'has_imap_password': bool(account.get('imap_password')),
            'imap_password': account.get('imap_password', '') or '',
            'aliases': account.get('aliases', []),
            'alias_count': account.get('alias_count', 0),
            'matched_alias': account.get('matched_alias', ''),
            'forward_enabled': bool(account.get('forward_enabled')),
            'forward_last_checked_at': account.get('forward_last_checked_at', ''),
            'proxy_url': account.get('proxy_url', '') or '',
            'fallback_proxy_url_1': account.get('fallback_proxy_url_1', '') or '',
            'fallback_proxy_url_2': account.get('fallback_proxy_url_2', '') or '',
            'proxy_override_enabled': account_has_proxy_override(account),
            'group_id': account.get('group_id'),
            'group_name': account.get('group_name', '\u9ed8\u8ba4\u5206\u7ec4'),
            'sort_order': normalize_account_sort_order(account.get('sort_order', 0)),
            'remark': account.get('remark', ''),
            'status': account.get('status', 'active'),
            'created_at': account.get('created_at', ''),
            'updated_at': account.get('updated_at', ''),
            'tags': get_account_tags(account['id'])
        }
    })


def parse_alias_payload(raw_aliases: Any) -> List[str]:
    if isinstance(raw_aliases, str):
        values = raw_aliases.replace(',', '\n').splitlines()
    elif isinstance(raw_aliases, (list, tuple, set)):
        values = list(raw_aliases)
    else:
        values = []
    return [str(value or '').strip() for value in values if str(value or '').strip()]


@app.route('/api/accounts/<int:account_id>/aliases', methods=['GET'])
@login_required
def api_get_account_aliases_endpoint(account_id):
    account = get_account_by_id(account_id)
    if not account:
        return jsonify({'success': False, 'error': 'Account does not exist'}), 404
    return jsonify({
        'success': True,
        'account_id': account_id,
        'email': account.get('email', ''),
        'aliases': account.get('aliases', []),
    })


@app.route('/api/accounts/<int:account_id>/aliases', methods=['PUT'])
@login_required
def api_replace_account_aliases_endpoint(account_id):
    account = get_account_by_id(account_id)
    if not account:
        return jsonify({'success': False, 'error': 'Account does not exist'}), 404

    data = request.json or {}
    aliases = parse_alias_payload(data.get('aliases', []))
    db = get_db()
    success, cleaned_aliases, errors = replace_account_aliases(account_id, account.get('email', ''), aliases, db)
    if not success:
        db.rollback()
        return jsonify({'success': False, 'error': '；'.join(errors), 'errors': errors}), 400

    db.commit()
    return jsonify({
        'success': True,
        'message': f'{len(cleaned_aliases)} alias saved',
        'aliases': cleaned_aliases,
    })


@app.route('/api/accounts', methods=['POST'])
@login_required
def api_add_account():
    'Add account'
    data = request.json or {}
    account_str = data.get('account_string', '')
    group_id = data.get('group_id', 1)
    account_format = data.get('account_format', 'client_id_refresh_token')
    provider = data.get('provider', 'outlook')
    forward_enabled = bool(data.get('forward_enabled', False))
    sort_order = parse_account_sort_order_input(data.get('sort_order')) if 'sort_order' in data else None
    remark = sanitize_input(str(data.get('remark', '') or '').strip(), max_length=500)
    status = normalize_account_status(data.get('status', 'active'))
    tag_ids = normalize_tag_ids_input(data.get('tag_ids', []))
    proxy_url = str(data.get('proxy_url', '') or '').strip()
    fallback_proxy_url_1 = str(data.get('fallback_proxy_url_1', '') or '').strip()
    fallback_proxy_url_2 = str(data.get('fallback_proxy_url_2', '') or '').strip()
    imap_host = (data.get('imap_host', '') or '').strip()
    try:
        imap_port = int(data.get('imap_port', 993) or 993)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Invalid IMAP port'})
    
    if not account_str:
        return jsonify({'success': False, 'error': 'Please enter account information'})
    
    # Support batch import (multiple lines)
    lines = account_str.strip().split('\n')
    parsed_accounts = []
    invalid_count = 0
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        parsed = parse_account_import(line, account_format, provider, imap_host, imap_port)
        if parsed:
            parsed_accounts.append(parsed)
        else:
            invalid_count += 1

    result = add_accounts_bulk(
        parsed_accounts,
        group_id,
        forward_enabled,
        sort_order,
        remark,
        status,
        tag_ids,
        proxy_url,
        fallback_proxy_url_1,
        fallback_proxy_url_2,
    )
    added = result.get('added_count', 0)
    skipped_count = result.get('skipped_count', 0)
    tagged_count = result.get('tagged_count', 0)
    
    if added > 0:
        message = f'{added} accounts successfully added'
        detail_parts = []
        if skipped_count:
            detail_parts.append(f'Skip duplicates {skipped_count}')
        if invalid_count:
            detail_parts.append(f'Invalid format {invalid_count} line')
        if detail_parts:
            message += '，' + '，'.join(detail_parts)
        return jsonify({
            'success': True,
            'message': message,
            'added_count': added,
            'skipped_count': skipped_count,
            'invalid_count': invalid_count,
            'tagged_count': tagged_count,
        })
    else:
        return jsonify({
            'success': False,
            'error': 'No new account was added (maybe incorrectly formatted or already exists)',
            'skipped_count': skipped_count,
            'invalid_count': invalid_count,
        })


@app.route('/api/accounts/<int:account_id>', methods=['PUT'])
@login_required
def api_update_account(account_id):
    'Update account'
    data = request.json

    # Check if only status is updated
    if 'status' in data and len(data) == 1:
        # Update status only
        return api_update_account_status(account_id, data['status'])

    current_account = get_account_by_id(account_id) or {}
    email_addr = data.get('email', '')
    password = data['password'] if 'password' in data else current_account.get('password', '')
    client_id = data.get('client_id', '')
    refresh_token = data.get('refresh_token', '')
    account_type = data.get('account_type', 'outlook')
    provider = data.get('provider', 'outlook')
    if 'authorization_type' in data:
        try:
            authorization_type = normalize_outlook_authorization_type(
                data.get('authorization_type'),
                strict=True,
            )
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)})
    else:
        authorization_type = get_account_authorization_type(current_account)
    imap_host = (data.get('imap_host', '') or '').strip()
    imap_port = data.get('imap_port', 993)
    imap_password = data['imap_password'] if 'imap_password' in data else current_account.get('imap_password', '')
    group_id = data.get('group_id', 1)
    sort_order = parse_account_sort_order_input(data.get('sort_order')) if 'sort_order' in data else None
    remark = sanitize_input(data.get('remark', ''), max_length=200)
    status = data.get('status', 'active')
    forward_enabled = bool(data.get('forward_enabled', False))
    proxy_url = str(data.get('proxy_url', current_account.get('proxy_url', '')) or '').strip()
    fallback_proxy_url_1 = str(
        data.get('fallback_proxy_url_1', current_account.get('fallback_proxy_url_1', '')) or ''
    ).strip()
    fallback_proxy_url_2 = str(
        data.get('fallback_proxy_url_2', current_account.get('fallback_proxy_url_2', '')) or ''
    ).strip()
    aliases_provided = 'aliases' in data
    aliases = parse_alias_payload(data.get('aliases', [])) if aliases_provided else []
    tag_ids_provided = 'tag_ids' in data
    normalized_tag_ids = normalize_tag_ids_input(data.get('tag_ids', [])) if tag_ids_provided else []

    provider_meta = get_provider_meta(provider, email_addr)
    is_outlook = (account_type == 'outlook') or provider_meta['key'] == 'outlook'
    if is_outlook:
        if not email_addr or not client_id or not refresh_token:
            return jsonify({'success': False, 'error': 'Email, Client ID and Refresh Token cannot be empty'})
        account_type = 'outlook'
        provider = 'outlook'
        imap_host = IMAP_SERVER_NEW
        imap_port = IMAP_PORT
        imap_password = ''
    else:
        if not email_addr or not imap_password:
            return jsonify({'success': False, 'error': 'Email and IMAP password cannot be empty'})
        if provider_meta['key'] == 'custom' and not imap_host:
            return jsonify({'success': False, 'error': 'Custom IMAP must fill in the server address'})
        client_id = ''
        refresh_token = ''
        account_type = 'imap'
        provider = provider_meta['key']
        if provider != 'custom':
            imap_host = provider_meta.get('imap_host', '')
            imap_port = provider_meta.get('imap_port', 993)

    if False:
        return jsonify({'success': False, 'error': 'Email, Client ID and Refresh Token cannot be empty'})

    if aliases_provided:
        _, alias_errors = validate_account_aliases(account_id, email_addr, aliases)
        if alias_errors:
            return jsonify({'success': False, 'error': '；'.join(alias_errors), 'errors': alias_errors})

    if update_account(
        account_id, email_addr, password, client_id, refresh_token, group_id, sort_order, remark, status,
        account_type, provider, imap_host, imap_port, imap_password, forward_enabled,
        proxy_url, fallback_proxy_url_1, fallback_proxy_url_2,
        authorization_type
    ):
        cleaned_aliases = get_account_aliases(account_id)
        db = get_db()
        if aliases_provided:
            alias_success, cleaned_aliases, alias_errors = replace_account_aliases(account_id, email_addr, aliases, db)
            if not alias_success:
                db.rollback()
                return jsonify({'success': False, 'error': '；'.join(alias_errors), 'errors': alias_errors})
        if tag_ids_provided:
            db.execute('DELETE FROM account_tags WHERE account_id = ?', (account_id,))
            for tid in normalized_tag_ids:
                db.execute(
                    'INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (?, ?)',
                    (account_id, tid)
                )
        db.commit()
        return jsonify({'success': True, 'message': 'Account updated successfully', 'aliases': cleaned_aliases})
    else:
        return jsonify({'success': False, 'error': 'Update failed'})


def api_update_account_status(account_id: int, status: str):
    'Only update account status'
    db = get_db()
    try:
        db.execute('''
            UPDATE accounts
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (status, account_id))
        db.commit()
        return jsonify({'success': True, 'message': 'Status updated successfully'})
    except Exception:
        return jsonify({'success': False, 'error': 'Update failed'})


@app.route('/api/accounts/<int:account_id>', methods=['DELETE'])
@login_required
def api_delete_account(account_id):
    'Delete account'
    if delete_account_by_id(account_id):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': 'Delete failed'})


@app.route('/api/accounts/email/<email_addr>', methods=['DELETE'])
@login_required
def api_delete_account_by_email(email_addr):
    'Delete account based on email address'
    if delete_account_by_email(email_addr):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': 'Delete failed'})


@app.route('/api/accounts/batch-delete', methods=['POST'])
@login_required
def api_batch_delete_accounts():
    'Delete accounts in batches'
    data = request.get_json(silent=True) or {}
    result = delete_accounts_by_ids(data.get('account_ids') or [])
    if not result.get('success'):
        return jsonify({'success': False, 'error': result.get('error', 'Delete failed')})

    deleted_count = result.get('deleted_count', 0)
    missing_ids = result.get('missing_ids', [])
    message = f'{deleted_count} accounts deleted'
    if missing_ids:
        message += f', ignore {len(missing_ids)} non-existent accounts'

    return jsonify({
        'success': True,
        'message': message,
        'deleted_count': deleted_count,
        'deleted_accounts': result.get('deleted_accounts', []),
        'missing_ids': missing_ids,
    })


# ==================== Account Refresh API ====================
