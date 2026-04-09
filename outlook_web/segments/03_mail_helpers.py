def build_proxies(proxy_url: str) -> Optional[Dict[str, str]]:
    """构建 requests 的 proxies 参数"""
    if not proxy_url:
        return None
    return {"http": proxy_url, "https": proxy_url}


@contextmanager
def proxy_socket_context(proxy_url: str):
    if not proxy_url or not socks:
        yield
        return

    parsed = urlparse(proxy_url)
    scheme = (parsed.scheme or '').lower()
    proxy_type_map = {
        'socks5': socks.SOCKS5,
        'socks5h': socks.SOCKS5,
        'socks4': socks.SOCKS4,
        'http': socks.HTTP,
        'https': socks.HTTP,
    }
    proxy_type = proxy_type_map.get(scheme)
    if not proxy_type or not parsed.hostname or not parsed.port:
        yield
        return

    username = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None
    rdns = scheme == 'socks5h'

    with proxy_socket_lock:
        original_socket = socket.socket
        try:
            socks.set_default_proxy(
                proxy_type,
                parsed.hostname,
                parsed.port,
                username=username,
                password=password,
                rdns=rdns
            )
            socket.socket = socks.socksocket
            yield
        finally:
            socket.socket = original_socket
            socks.set_default_proxy()


def get_access_token_graph_result(client_id: str, refresh_token: str, proxy_url: str = None) -> Dict[str, Any]:
    """获取 Graph API access_token（包含错误详情）"""
    try:
        proxies = build_proxies(proxy_url)
        res = requests.post(
            TOKEN_URL_GRAPH,
            data={
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": "https://graph.microsoft.com/.default"
            },
            timeout=30,
            proxies=proxies
        )

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "GRAPH_TOKEN_FAILED",
                    "获取访问令牌失败",
                    "GraphAPIError",
                    res.status_code,
                    details
                )
            }

        payload = res.json()
        access_token = payload.get("access_token")
        if not access_token:
            return {
                "success": False,
                "error": build_error_payload(
                    "GRAPH_TOKEN_MISSING",
                    "获取访问令牌失败",
                    "GraphAPIError",
                    res.status_code,
                    payload
                )
            }

        return {"success": True, "access_token": access_token}
    except Exception as exc:
        return {
            "success": False,
            "error": build_error_payload(
                "GRAPH_TOKEN_EXCEPTION",
                "获取访问令牌失败",
                type(exc).__name__,
                500,
                str(exc)
            )
        }


def get_access_token_graph(client_id: str, refresh_token: str, proxy_url: str = None) -> Optional[str]:
    """获取 Graph API access_token"""
    result = get_access_token_graph_result(client_id, refresh_token, proxy_url)
    if result.get("success"):
        return result.get("access_token")
    return None


def get_emails_graph(client_id: str, refresh_token: str, folder: str = 'inbox', skip: int = 0, top: int = 20, proxy_url: str = None) -> Dict[str, Any]:
    """使用 Graph API 获取邮件列表（支持分页和文件夹选择）"""
    token_result = get_access_token_graph_result(client_id, refresh_token, proxy_url)
    if not token_result.get("success"):
        return {"success": False, "error": token_result.get("error")}

    access_token = token_result.get("access_token")

    try:
        # 根据文件夹类型选择 API 端点
        # 使用 Well-known folder names，这些是 Microsoft Graph API 的标准文件夹名称
        folder_map = {
            'inbox': 'inbox',
            'junkemail': 'junkemail',  # 垃圾邮件的标准名称
            'deleteditems': 'deleteditems',  # 已删除邮件的标准名称
            'trash': 'deleteditems'  # 垃圾箱的别名
        }
        folder_name = folder_map.get(folder.lower(), 'inbox')

        url = f"https://graph.microsoft.com/v1.0/me/mailFolders/{folder_name}/messages"
        params = {
            "$top": top,
            "$skip": skip,
            "$select": "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview",
            "$orderby": "receivedDateTime desc"
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='text'"
        }

        proxies = build_proxies(proxy_url)
        res = requests.get(url, headers=headers, params=params, timeout=30, proxies=proxies)

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "EMAIL_FETCH_FAILED",
                    "获取邮件失败，请检查账号配置",
                    "GraphAPIError",
                    res.status_code,
                    details
                )
            }

        return {"success": True, "emails": res.json().get("value", [])}
    except Exception as exc:
        return {
            "success": False,
            "error": build_error_payload(
                "EMAIL_FETCH_FAILED",
                "获取邮件失败，请检查账号配置",
                type(exc).__name__,
                500,
                str(exc)
            )
        }


def get_email_detail_graph(client_id: str, refresh_token: str, message_id: str, proxy_url: str = None) -> Optional[Dict]:
    """使用 Graph API 获取邮件详情"""
    access_token = get_access_token_graph(client_id, refresh_token, proxy_url)
    if not access_token:
        return None
    
    try:
        url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}"
        params = {
            "$select": "id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body,bodyPreview"
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='html'"
        }
        
        proxies = build_proxies(proxy_url)
        res = requests.get(url, headers=headers, params=params, timeout=30, proxies=proxies)
        
        if res.status_code != 200:
            return None
        
        return res.json()
    except Exception:
        return None


# ==================== IMAP 方式 ====================

def get_access_token_imap_result(client_id: str, refresh_token: str, proxy_url: str = None) -> Dict[str, Any]:
    """获取 IMAP access_token（包含错误详情）"""
    try:
        proxies = build_proxies(proxy_url)
        res = requests.post(
            TOKEN_URL_IMAP,
            data={
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
            },
            timeout=30,
            proxies=proxies
        )

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "IMAP_TOKEN_FAILED",
                    "获取访问令牌失败",
                    "IMAPError",
                    res.status_code,
                    details
                )
            }

        payload = res.json()
        access_token = payload.get("access_token")
        if not access_token:
            return {
                "success": False,
                "error": build_error_payload(
                    "IMAP_TOKEN_MISSING",
                    "获取访问令牌失败",
                    "IMAPError",
                    res.status_code,
                    payload
                )
            }

        return {"success": True, "access_token": access_token}
    except Exception as exc:
        return {
            "success": False,
            "error": build_error_payload(
                "IMAP_TOKEN_EXCEPTION",
                "获取访问令牌失败",
                type(exc).__name__,
                500,
                str(exc)
            )
        }


def get_access_token_imap(client_id: str, refresh_token: str, proxy_url: str = None) -> Optional[str]:
    """获取 IMAP access_token"""
    result = get_access_token_imap_result(client_id, refresh_token, proxy_url)
    if result.get("success"):
        return result.get("access_token")
    return None


def get_emails_imap(account: str, client_id: str, refresh_token: str, folder: str = 'inbox', skip: int = 0, top: int = 20, proxy_url: str = None) -> Dict[str, Any]:
    """使用 IMAP 获取邮件列表（支持分页和文件夹选择）- 默认使用新版服务器"""
    return get_emails_imap_with_server(account, client_id, refresh_token, folder, skip, top, IMAP_SERVER_NEW, proxy_url)


def get_emails_imap_with_server(account: str, client_id: str, refresh_token: str, folder: str = 'inbox', skip: int = 0, top: int = 20, server: str = IMAP_SERVER_NEW, proxy_url: str = None) -> Dict[str, Any]:
    """使用 IMAP 获取邮件列表（支持分页、文件夹选择和服务器选择）"""
    token_result = get_access_token_imap_result(client_id, refresh_token, proxy_url)
    if not token_result.get("success"):
        return {"success": False, "error": token_result.get("error")}

    access_token = token_result.get("access_token")

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(server, IMAP_PORT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)

        selected_folder, folder_diagnostics = resolve_imap_folder(connection, 'outlook', folder, readonly=True)
        if not selected_folder:
            return {
                "success": False,
                "error": build_error_payload(
                    "EMAIL_FETCH_FAILED",
                    f"无法访问文件夹，请检查账号配置",
                    "IMAPSelectError",
                    500,
                    folder_diagnostics
                )
            }

        status, messages = connection.search(None, 'ALL')
        if status != 'OK':
            return {
                "success": False,
                "error": build_error_payload(
                    "EMAIL_FETCH_FAILED",
                    "获取邮件失败，请检查账号配置",
                    "IMAPSearchError",
                    500,
                    f"search status={status}"
                )
            }
        if not messages or not messages[0]:
            return {"success": True, "emails": []}

        message_ids = messages[0].split()
        # 计算分页范围
        total = len(message_ids)
        start_idx = max(0, total - skip - top)
        end_idx = total - skip

        if start_idx >= end_idx:
            return {"success": True, "emails": []}

        paged_ids = message_ids[start_idx:end_idx][::-1]  # 倒序，最新的在前

        emails = []
        for msg_id in paged_ids:
            try:
                status, msg_data = connection.fetch(msg_id, '(RFC822)')
                if status == 'OK' and msg_data and msg_data[0]:
                    raw_email = msg_data[0][1]
                    msg = email.message_from_bytes(raw_email)

                    emails.append({
                        'id': msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id),
                        'subject': decode_header_value(msg.get("Subject", "无主题")),
                        'from': decode_header_value(msg.get("From", "未知发件人")),
                        'date': msg.get("Date", "未知时间"),
                        'body_preview': get_email_body(msg)[:200] + "..." if len(get_email_body(msg)) > 200 else get_email_body(msg)
                    })
            except Exception:
                continue

        return {"success": True, "emails": emails}
    except Exception as exc:
        return {
            "success": False,
            "error": build_error_payload(
                "EMAIL_FETCH_FAILED",
                "获取邮件失败，请检查账号配置",
                type(exc).__name__,
                500,
                str(exc)
            )
        }
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def get_email_detail_imap(account: str, client_id: str, refresh_token: str, message_id: str, folder: str = 'inbox', proxy_url: str = None) -> Optional[Dict]:
    """使用 IMAP 获取邮件详情"""
    access_token = get_access_token_imap(client_id, refresh_token, proxy_url)
    if not access_token:
        return None

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)

        selected_folder, _ = resolve_imap_folder(connection, 'outlook', folder, readonly=True)
        if not selected_folder:
            return None

        status, msg_data = connection.fetch(message_id.encode() if isinstance(message_id, str) else message_id, '(RFC822)')
        if status != 'OK' or not msg_data or not msg_data[0]:
            return None

        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        return {
            'id': message_id,
            'subject': decode_header_value(msg.get("Subject", "无主题")),
            'from': decode_header_value(msg.get("From", "未知发件人")),
            'to': decode_header_value(msg.get("To", "")),
            'cc': decode_header_value(msg.get("Cc", "")),
            'date': msg.get("Date", "未知时间"),
            'body': get_email_body(msg)
        }
    except Exception:
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


# ==================== 登录验证 ====================

def strip_html_content(html_text: str) -> str:
    if not html_text:
        return ''
    text = re.sub(r'(?is)<script.*?>.*?</script>', ' ', html_text)
    text = re.sub(r'(?is)<style.*?>.*?</style>', ' ', text)
    text = re.sub(r'(?s)<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_text_and_html(msg) -> tuple[str, str]:
    text_part = ''
    html_part = ''

    def decode_part(part) -> str:
        try:
            payload = part.get_payload(decode=True)
            charset = part.get_content_charset() or 'utf-8'
            if isinstance(payload, (bytes, bytearray)):
                return payload.decode(charset, errors='replace')
            return str(payload) if payload is not None else ''
        except Exception:
            try:
                return str(part.get_payload())
            except Exception:
                return ''

    if msg.is_multipart():
        for part in msg.walk():
            disposition = str(part.get('Content-Disposition', '') or '').lower()
            if 'attachment' in disposition:
                continue
            content_type = (part.get_content_type() or '').lower()
            if content_type == 'text/plain' and not text_part:
                text_part = decode_part(part)
            elif content_type == 'text/html' and not html_part:
                html_part = decode_part(part)
            if text_part and html_part:
                break
    else:
        content_type = (msg.get_content_type() or '').lower()
        if content_type == 'text/html':
            html_part = decode_part(msg)
        else:
            text_part = decode_part(msg)

    return text_part or '', html_part or ''


def has_message_attachments(msg) -> bool:
    if not msg.is_multipart():
        return False
    for part in msg.walk():
        disposition = str(part.get('Content-Disposition', '') or '').lower()
        if 'attachment' in disposition:
            return True
    return False


def create_imap_connection(imap_host: str, imap_port: int = 993, proxy_url: str = ''):
    host = (imap_host or '').strip()
    port = int(imap_port or 993)
    if not host:
        raise ValueError('IMAP host 不能为空')
    try:
        with proxy_socket_context(proxy_url):
            return imaplib.IMAP4_SSL(host, port, timeout=30)
    except TypeError:
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(30)
        try:
            with proxy_socket_context(proxy_url):
                return imaplib.IMAP4_SSL(host, port)
        finally:
            socket.setdefaulttimeout(old_timeout)


def quote_imap_id_value(value: str) -> str:
    return str(value or '').replace('\\', '\\\\').replace('"', r'\"')


def build_imap_id_payload() -> Optional[str]:
    parts = []
    for key, value in IMAP_IDENTITY_FIELDS.items():
        if not value:
            continue
        parts.append(f'"{quote_imap_id_value(key)}"')
        parts.append(f'"{quote_imap_id_value(value)}"')
    if not parts:
        return None
    return f'({" ".join(parts)})'


def send_imap_id(mail, provider: str, imap_host: str) -> Dict[str, Any]:
    payload = build_imap_id_payload()
    if not payload:
        return {'attempted': False, 'reason': 'empty_payload'}
    if not hasattr(mail, 'xatom'):
        return {'attempted': False, 'reason': 'xatom_not_supported'}

    try:
        status, response = mail.xatom('ID', payload)
        return {
            'attempted': True,
            'status': str(status),
            'response': sanitize_error_details(str(response or ''))[:300],
            'fields': [key for key, value in IMAP_IDENTITY_FIELDS.items() if value],
            'provider': provider,
            'imap_host': imap_host,
        }
    except Exception as exc:
        return {
            'attempted': True,
            'status': type(exc).__name__,
            'response': sanitize_error_details(str(exc))[:300],
            'fields': [key for key, value in IMAP_IDENTITY_FIELDS.items() if value],
            'provider': provider,
            'imap_host': imap_host,
        }


def build_imap_select_variants(folder_name: str) -> List[str]:
    raw_name = str(folder_name or '').strip()
    if not raw_name:
        return []

    unquoted_name = raw_name[1:-1] if raw_name.startswith('"') and raw_name.endswith('"') and len(raw_name) >= 2 else raw_name
    variants = []
    for candidate in (raw_name, unquoted_name, f'"{unquoted_name}"'):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def try_select_imap_folder(mail, folder_name: str, readonly: bool = True) -> tuple[Optional[str], List[Dict[str, Any]]]:
    if not folder_name:
        return None, []

    attempts = []
    readonly_modes = [readonly]
    if readonly:
        readonly_modes.append(False)

    for use_readonly in readonly_modes:
        for candidate in build_imap_select_variants(folder_name):
            try:
                status, response = mail.select(candidate, readonly=use_readonly)
                attempts.append({
                    'folder': candidate,
                    'readonly': use_readonly,
                    'status': str(status),
                    'response': sanitize_error_details(str(response or ''))[:200],
                })
                if status == 'OK':
                    return candidate, attempts
            except imaplib.IMAP4.readonly:
                attempts.append({
                    'folder': candidate,
                    'readonly': use_readonly,
                    'status': 'READONLY',
                    'response': 'mailbox selected as read-only',
                })
                return candidate, attempts
            except Exception as exc:
                attempts.append({
                    'folder': candidate,
                    'readonly': use_readonly,
                    'status': type(exc).__name__,
                    'response': sanitize_error_details(str(exc))[:200],
                })
    return None, attempts


def resolve_imap_folder(mail, provider: str, folder: str, readonly: bool = True) -> tuple[Optional[str], Dict[str, Any]]:
    candidates = []
    for folder_name in get_imap_folder_candidates(provider, folder):
        if folder_name and folder_name not in candidates:
            candidates.append(folder_name)

    select_attempts = []
    for folder_name in candidates:
        selected, attempts = try_select_imap_folder(mail, folder_name, readonly=readonly)
        select_attempts.extend(attempts)
        if selected:
            diagnostics = {'tried_folders': candidates}
            if attempts and any(not item.get('readonly', True) for item in attempts):
                diagnostics['fallback_mode'] = 'select'
            if select_attempts:
                diagnostics['select_attempts'] = select_attempts[-10:]
            return selected, diagnostics

    available_folders = list_imap_mailboxes(mail)
    ranked_folders = rank_imap_listed_mailboxes(folder, candidates, available_folders)
    for folder_name in ranked_folders:
        selected, attempts = try_select_imap_folder(mail, folder_name, readonly=readonly)
        select_attempts.extend(attempts)
        if selected:
            return selected, {
                'tried_folders': candidates,
                'available_folders': available_folders[:20],
                'matched_folders': ranked_folders[:10],
                'fallback_mode': 'select' if any(not item.get('readonly', True) for item in attempts) else '',
                'select_attempts': select_attempts[-10:],
            }

    diagnostics = {'tried_folders': candidates}
    if available_folders:
        diagnostics['available_folders'] = available_folders[:20]
    if ranked_folders:
        diagnostics['matched_folders'] = ranked_folders[:10]
    if select_attempts:
        diagnostics['select_attempts'] = select_attempts[-10:]
    return None, diagnostics


def normalize_imap_auth_error(provider: str, imap_host: str, raw_message: str) -> str:
    message = sanitize_error_details(str(raw_message or '')).strip() or 'IMAP 认证失败'
    if 'unsafe login' in message.lower():
        if (provider or '').strip().lower() in {'126', '163'}:
            return '网易邮箱拦截了当前 IMAP 登录（Unsafe Login），请在网页端开启 IMAP 并使用客户端授权码；若仍失败，说明当前网络或服务器 IP 被风控'
        return '邮箱服务商拦截了当前 IMAP 登录（Unsafe Login），请检查是否已开启 IMAP 并改用授权码'
    if (provider or '').strip().lower() == 'gmail':
        return 'IMAP 认证失败，请使用 Gmail 应用专用密码并确认已开启 IMAP'
    if ((provider or '').strip().lower() == 'outlook' or (imap_host or '').strip().lower() in {IMAP_SERVER_NEW, IMAP_SERVER_OLD}) and 'basicauthblocked' in message.lower():
        return 'Outlook 已阻止 Basic Auth，请改用 Outlook OAuth 导入'
    return message


def get_imap_access_block_error(provider: str, folder: str, diagnostics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    attempts = diagnostics.get('select_attempts') or []
    unsafe_attempts = []
    for item in attempts:
        response_text = str(item.get('response') or '')
        status_text = str(item.get('status') or '')
        if 'unsafe login' in response_text.lower() or 'unsafe login' in status_text.lower():
            unsafe_attempts.append(item)

    if not unsafe_attempts:
        return None

    provider_key = (provider or '').strip().lower()
    if provider_key in {'126', '163'}:
        message = '网易邮箱拦截了当前 IMAP 登录（Unsafe Login），请在网页端开启 IMAP 并使用客户端授权码；若仍失败，说明当前网络或服务器 IP 被网易风控'
    else:
        message = '邮箱服务商拦截了当前 IMAP 登录（Unsafe Login），请确认已开启 IMAP、使用授权码，并检查当前网络或代理是否被风控'

    return build_error_payload(
        'IMAP_UNSAFE_LOGIN_BLOCKED',
        message,
        'IMAPSecurityError',
        403,
        {
            'provider': provider,
            'folder': folder,
            **diagnostics,
        }
    )


def get_emails_imap_generic(email_addr: str, imap_password: str, imap_host: str,
                            imap_port: int = 993, folder: str = 'inbox',
                            provider: str = 'custom', skip: int = 0, top: int = 20,
                            proxy_url: str = '') -> Dict[str, Any]:
    mail = None
    imap_id_info = {}
    try:
        skip = max(0, int(skip or 0))
        top = max(1, int(top or 20))
        mail = create_imap_connection(imap_host, imap_port, proxy_url)
        try:
            mail.login(email_addr, imap_password)
        except imaplib.IMAP4.error as exc:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_AUTH_FAILED',
                    normalize_imap_auth_error(provider, imap_host, str(exc)),
                    'IMAPAuthError',
                    401,
                    ''
                ),
                'error_code': 'IMAP_AUTH_FAILED'
            }

        imap_id_info = send_imap_id(mail, provider, imap_host)
        selected, folder_diagnostics = resolve_imap_folder(mail, provider, folder, readonly=True)
        if not selected:
            if imap_id_info:
                folder_diagnostics = {**folder_diagnostics, 'imap_id': imap_id_info}
            blocked_error = get_imap_access_block_error(provider, folder, folder_diagnostics)
            if blocked_error:
                return {
                    'success': False,
                    'error': blocked_error,
                    'error_code': 'IMAP_UNSAFE_LOGIN_BLOCKED'
                }
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_FOLDER_NOT_FOUND',
                    'IMAP 文件夹不存在或无权访问',
                    'IMAPFolderError',
                    400,
                    {
                        'provider': provider,
                        'folder': folder,
                        **folder_diagnostics,
                    }
                ),
                'error_code': 'IMAP_FOLDER_NOT_FOUND'
            }

        status, data = mail.uid('SEARCH', None, 'ALL')
        if status != 'OK':
            return {
                'success': False,
                'error': build_error_payload('IMAP_SEARCH_FAILED', 'IMAP 搜索邮件失败', 'IMAPSearchError', 502, status),
                'error_code': 'IMAP_SEARCH_FAILED'
            }

        uid_bytes = data[0] if data else b''
        if not uid_bytes:
            return {'success': True, 'emails': [], 'method': 'IMAP (Generic)', 'has_more': False}

        uids = uid_bytes.split()
        total = len(uids)
        start_idx = max(0, total - skip - top)
        end_idx = total - skip
        if start_idx >= end_idx:
            return {'success': True, 'emails': [], 'method': 'IMAP (Generic)', 'has_more': False}

        paged_uids = uids[start_idx:end_idx][::-1]
        emails_data = []
        for uid in paged_uids:
            try:
                f_status, f_data = mail.uid('FETCH', uid, '(FLAGS RFC822)')
                if f_status != 'OK' or not f_data:
                    continue
                raw_email = None
                flags_text = ''
                for item in f_data:
                    if not item:
                        continue
                    if isinstance(item, tuple) and len(item) >= 2:
                        flags_text = item[0].decode('utf-8', errors='ignore') if isinstance(item[0], (bytes, bytearray)) else str(item[0])
                        raw_email = item[1]
                        break
                if not raw_email:
                    continue

                msg = email.message_from_bytes(raw_email)
                body_text, body_html = extract_text_and_html(msg)
                preview_source = body_text or strip_html_content(body_html)
                preview = preview_source[:200] + ('...' if len(preview_source) > 200 else '')
                emails_data.append({
                    'id': uid.decode('utf-8', errors='ignore') if isinstance(uid, (bytes, bytearray)) else str(uid),
                    'subject': decode_header_value(msg.get('Subject', '无主题')),
                    'from': decode_header_value(msg.get('From', '未知')),
                    'date': msg.get('Date', ''),
                    'is_read': '\\Seen' in (flags_text or ''),
                    'has_attachments': has_message_attachments(msg),
                    'body_preview': preview,
                })
            except Exception:
                continue

        return {
            'success': True,
            'emails': emails_data,
            'method': 'IMAP (Generic)',
            'has_more': total > end_idx
        }
    except Exception as exc:
        return {
            'success': False,
            'error': build_error_payload(
                'IMAP_CONNECT_FAILED',
                sanitize_error_details(str(exc)) or 'IMAP 连接失败',
                'IMAPConnectError',
                502,
                ''
            ),
            'error_code': 'IMAP_CONNECT_FAILED'
        }
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


def get_email_detail_imap_generic_result(email_addr: str, imap_password: str, imap_host: str,
                                         imap_port: int = 993, message_id: str = '',
                                         folder: str = 'inbox', provider: str = 'custom',
                                         proxy_url: str = '') -> Dict[str, Any]:
    if not message_id:
        return {'success': False, 'error': build_error_payload('EMAIL_DETAIL_INVALID', 'message_id 不能为空', 'ValidationError', 400, '')}

    mail = None
    imap_id_info = {}
    try:
        mail = create_imap_connection(imap_host, imap_port, proxy_url)
        try:
            mail.login(email_addr, imap_password)
        except imaplib.IMAP4.error as exc:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_AUTH_FAILED',
                    normalize_imap_auth_error(provider, imap_host, str(exc)),
                    'IMAPAuthError',
                    401,
                    ''
                )
            }

        imap_id_info = send_imap_id(mail, provider, imap_host)
        selected, folder_diagnostics = resolve_imap_folder(mail, provider, folder, readonly=True)
        if not selected:
            if imap_id_info:
                folder_diagnostics = {**folder_diagnostics, 'imap_id': imap_id_info}
            blocked_error = get_imap_access_block_error(provider, folder, folder_diagnostics)
            if blocked_error:
                return {
                    'success': False,
                    'error': blocked_error
                }
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_FOLDER_NOT_FOUND',
                    'IMAP 文件夹不存在或无权访问',
                    'IMAPFolderError',
                    400,
                    {
                        'provider': provider,
                        'folder': folder,
                        **folder_diagnostics,
                    }
                )
            }

        status, msg_data = mail.uid('FETCH', str(message_id), '(RFC822)')
        if status != 'OK' or not msg_data:
            return {'success': False, 'error': build_error_payload('EMAIL_DETAIL_FETCH_FAILED', '获取邮件详情失败', 'IMAPFetchError', 502, status)}

        raw_email = None
        for item in msg_data:
            if isinstance(item, tuple) and len(item) >= 2:
                raw_email = item[1]
                break
        if not raw_email:
            return {'success': False, 'error': build_error_payload('EMAIL_DETAIL_FETCH_FAILED', '获取邮件详情失败', 'IMAPFetchError', 502, '')}

        msg = email.message_from_bytes(raw_email)
        body_text, body_html = extract_text_and_html(msg)
        body = body_html or body_text.replace('\n', '<br>')
        return {
            'success': True,
            'email': {
                'id': str(message_id),
                'subject': decode_header_value(msg.get('Subject', '无主题')),
                'from': decode_header_value(msg.get('From', '未知')),
                'to': decode_header_value(msg.get('To', '')),
                'cc': decode_header_value(msg.get('Cc', '')),
                'date': msg.get('Date', ''),
                'body': body,
                'body_type': 'html' if body_html else 'text'
            }
        }
    except Exception as exc:
        return {'success': False, 'error': build_error_payload('IMAP_CONNECT_FAILED', sanitize_error_details(str(exc)) or 'IMAP 连接失败', 'IMAPConnectError', 502, '')}
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


def parse_email_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        if 'T' in str(value):
            normalized = str(value).replace('Z', '+00:00')
            dt = datetime.fromisoformat(normalized)
        else:
            dt = parsedate_to_datetime(str(value))
        if dt.tzinfo is not None:
            return dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'success': False, 'error': '请先登录', 'need_login': True}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


def api_key_required(f):
    """API Key 验证装饰器（用于对外 API）"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 从 Header 或查询参数获取 API Key
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key') or request.args.get('apikey')
        if not api_key:
            return jsonify({'success': False, 'error': '缺少 API Key，请通过 Header X-API-Key 或查询参数 api_key 提供'}), 401

        # 验证 API Key
        stored_key = get_external_api_key()
        if not stored_key:
            return jsonify({'success': False, 'error': '未配置对外 API Key，请在系统设置中配置'}), 403

        if api_key != stored_key:
            return jsonify({'success': False, 'error': 'API Key 无效'}), 401

        return f(*args, **kwargs)
    return decorated_function


# ==================== Flask 路由 ====================

