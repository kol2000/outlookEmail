from __future__ import annotations

import secrets

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from outlook_web.mail_datetime import parse_mail_datetime

if TYPE_CHECKING:
    # These segmented files are executed into the shared `web_outlook_app`
    # globals at runtime. Importing from the assembled module keeps IDE
    # inspections from flagging the shared names as unresolved.
    from web_outlook_app import *  # noqa: F403


DIRECT_PROXY_SENTINEL = "__DIRECT__"
# PySocks only enables SOCKS5 UserPass if username and password are both true.
# When the password is empty, it will degenerate to NO AUTH, Resin will not receive Platform.Account, and the sticky lease will not be created.
# Use a non-empty placeholder password to force UserPass; Resin accepts any password when RESIN_PROXY_TOKEN="".
SOCKS_EMPTY_PASSWORD_PLACEHOLDER = "\x00"


def resolve_socks_proxy_auth(
    username: Optional[str],
    password: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    'Standardize authentication for PySocks: fill in the placeholder password when there is a username but the password is empty, and ensure that UserPass is sent.'
    if not username:
        return None, None
    if password:
        return username, password
    return username, SOCKS_EMPTY_PASSWORD_PLACEHOLDER


def prepare_proxy_url_for_transport(proxy_url: str) -> str:
    'Convert the proxy URL into a form usable by the underlying client (fix SOCKS empty password and not issue authentication).'
    value = str(proxy_url or "").strip()
    if not value or value == DIRECT_PROXY_SENTINEL:
        return value

    parsed = urlparse(value)
    scheme = (parsed.scheme or "").lower()
    if not scheme.startswith("socks"):
        return value

    username = unquote(parsed.username) if parsed.username else None
    if not username:
        return value

    raw_password = unquote(parsed.password) if parsed.password is not None else None
    auth_user, auth_pass = resolve_socks_proxy_auth(username, raw_password)
    if not auth_user or auth_pass is None:
        return value
    # There is already a non-empty password and no need to rewrite it
    if raw_password:
        return value

    host = parsed.hostname or ""
    if not host:
        return value
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    userinfo = f"{quote(auth_user, safe='')}:{quote(auth_pass, safe='')}"
    if parsed.port is not None:
        netloc = f"{userinfo}@{host}:{parsed.port}"
    else:
        netloc = f"{userinfo}@{host}"
    rebuilt = f"{parsed.scheme}://{netloc}"
    if parsed.path:
        rebuilt += parsed.path
    if parsed.query:
        rebuilt += f"?{parsed.query}"
    if parsed.fragment:
        rebuilt += f"#{parsed.fragment}"
    return rebuilt


def build_proxies(proxy_url: str) -> Optional[Dict[str, str]]:
    'Construct proxies parameters of requests'
    if not proxy_url:
        return None
    transport_url = prepare_proxy_url_for_transport(proxy_url)
    return {"http": transport_url, "https": transport_url}


def build_direct_proxies() -> Dict[str, None]:
    'Explicitly disable the environment proxy of requests to ensure direct connection'
    return {"http": None, "https": None, "all": None}


def normalize_proxy_candidate(proxy_value: Any) -> str:
    value = str(proxy_value or '').strip()
    if not value:
        return ''
    if value.lower() == 'direct' or value == 'direct':
        return DIRECT_PROXY_SENTINEL
    return value


def get_proxy_failover_candidates(primary_proxy_url: str = '',
                                  fallback_proxy_urls: Optional[List[str]] = None) -> List[tuple[str, str]]:
    primary = normalize_proxy_candidate(primary_proxy_url)
    if not primary:
        return []

    candidates: List[tuple[str, str]] = [('primary', primary)]
    seen = {primary}

    for index, raw_candidate in enumerate(fallback_proxy_urls or [], start=1):
        candidate = normalize_proxy_candidate(raw_candidate)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        candidates.append((f'fallback{index}', candidate))

    return candidates


def is_proxy_connection_error(exc: Exception) -> bool:
    if isinstance(exc, requests.exceptions.ProxyError):
        return True
    if isinstance(exc, requests.exceptions.ConnectTimeout):
        return True
    if not isinstance(exc, requests.exceptions.ConnectionError):
        return False
    message = str(exc).lower()
    return any(marker in message for marker in (
        'socks',
        'proxy',
        'tunnel connection failed',
        'connection refused',
        'host unreachable',
    ))


def should_retry_next_proxy(exc: Exception, proxy_candidate: str) -> bool:
    if proxy_candidate == DIRECT_PROXY_SENTINEL:
        return isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.Timeout))
    return is_proxy_connection_error(exc)


def build_mail_fetch_error(exc: Exception, proxy_url: str = '', operation: str = 'Fetch mail',
                           legacy_code: str = '', legacy_message: str = '',
                           legacy_type: str = '', legacy_status: Optional[int] = None) -> Dict[str, Any]:
    'Convert proxy, network, and timeout exceptions into errors that can be directly displayed by the front end.'
    error_type = type(exc).__name__
    raw_details = sanitize_error_details(str(exc)).strip()
    details_lower = raw_details.lower()
    proxy_configured = bool(str(proxy_url or '').strip())
    proxy_failures = getattr(exc, 'proxy_failures', None) or []
    last_proxy_attempt = proxy_failures[-1] if proxy_failures else {}
    proxy_route_available = proxy_configured and last_proxy_attempt.get('proxy', True) is not False
    proxy_related = (
        isinstance(exc, requests.exceptions.ProxyError)
        or any(marker in details_lower for marker in ('proxy', 'socks', 'tunnel connection failed'))
        or (proxy_route_available and is_proxy_connection_error(exc))
    )
    timeout_related = (
        isinstance(exc, (requests.exceptions.Timeout, TimeoutError, socket.timeout))
        or any(marker in details_lower for marker in ('timed out', 'timeout', 'Timeout'))
    )
    tls_related = isinstance(exc, requests.exceptions.SSLError) or any(
        marker in details_lower for marker in ('ssl', 'tls', 'certificate verify failed')
    )
    connection_related = (
        isinstance(exc, (requests.exceptions.ConnectionError, socket.gaierror, ConnectionError))
        or any(marker in details_lower for marker in (
            'connection refused',
            'connection reset',
            'host unreachable',
            'name or service not known',
            'temporary failure in name resolution',
            'network is unreachable',
        ))
    )

    if proxy_related:
        reason_code = 'MAIL_PROXY_FAILED'
        category = 'proxy'
        status = 502
        message = 'Proxy connection failed: Unable to access the mail service through the current proxy, please check the proxy address, port, authentication information and fallback proxy settings'
    elif timeout_related:
        reason_code = 'MAIL_NETWORK_TIMEOUT'
        category = 'network'
        status = 504
        message = 'Network connection timeout: The email service did not respond within the specified time, please check the network, proxy and service address'
    elif tls_related:
        reason_code = 'MAIL_TLS_FAILED'
        category = 'network'
        status = 502
        message = 'TLS/SSL connection failed: please check the mail service address, port and system certificate'
    elif connection_related:
        reason_code = 'MAIL_NETWORK_FAILED'
        category = 'network'
        status = 502
        message = 'Network connection failed: Unable to connect to the mail service, please check DNS, firewall, proxy and service address'
    else:
        reason_code = 'MAIL_FETCH_EXCEPTION'
        category = 'mail'
        status = 500
        message = legacy_message or f'{operation} failed, please check the detailed error message'

    if proxy_failures:
        error_details: Any = {
            'exception': raw_details,
            'proxy_attempts': proxy_failures,
        }
    else:
        error_details = raw_details

    payload = build_error_payload(
        legacy_code or reason_code,
        message,
        legacy_type or error_type,
        legacy_status if legacy_status is not None else status,
        error_details,
    )
    payload['reason_code'] = reason_code
    payload['category'] = category
    payload['proxy_configured'] = proxy_configured
    payload['retryable'] = category in {'proxy', 'network'}
    return payload


def format_proxy_for_log(proxy_value: Any) -> str:
    'Console/log display using proxy: retain username (Resin Platform.Account) and hide password.'
    value = str(proxy_value or '').strip()
    if not value:
        return 'Direct connection (no application proxy configured)'
    if value == DIRECT_PROXY_SENTINEL or value.lower() in ('direct', 'direct'):
        return 'direct'
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.hostname:
        return sanitize_error_details(value)
    host = parsed.hostname
    if ':' in host and not host.startswith('['):
        host = f'[{host}]'
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port is not None:
        host = f'{host}:{port}'
    username = unquote(parsed.username) if parsed.username else None
    if username is not None:
        if parsed.password is not None:
            host = f'{username}:***@{host}'
        else:
            host = f'{username}@{host}'
    return f'{parsed.scheme}://{host}'


def parse_resin_proxy_identity(proxy_value: Any) -> tuple[str, str]:
    "Platform / Account (first '.' separator) is resolved from proxy URL username by Resin V1 rules."
    value = str(proxy_value or '').strip()
    if not value or value == DIRECT_PROXY_SENTINEL:
        return '', ''
    parsed = urlparse(value)
    username = unquote(parsed.username) if parsed.username else ''
    if not username:
        return '', ''
    if '.' in username:
        platform, account = username.split('.', 1)
        return platform, account
    return username, ''


def log_outbound_proxy_usage(context: str, proxy_value: Any = '', *, label: str = '') -> None:
    'Record the actual agent used this time (controlled by LOG_LEVEL, visible by default INFO).'
    display = format_proxy_for_log(proxy_value)
    suffix = f' ({label})' if label else ''
    platform, account = parse_resin_proxy_identity(proxy_value)
    identity = ''
    if platform or account:
        identity = f" | Resin Identity Platform={platform or '(empty)'} Account={account or '(empty - no sticky lease)'}"
    message = f'[Agent] {context}{suffix}: {display}{identity}'
    try:
        app.logger.info(message)
    except Exception:
        pass


def build_request_kwargs_for_proxy(kwargs: Dict[str, Any], proxy_candidate: str) -> Dict[str, Any]:
    request_kwargs = dict(kwargs)
    if proxy_candidate == DIRECT_PROXY_SENTINEL:
        request_kwargs['proxies'] = build_direct_proxies()
        return request_kwargs

    proxies = build_proxies(proxy_candidate)
    if proxies:
        request_kwargs['proxies'] = proxies
    return request_kwargs


def request_with_proxy_failover(method: str, url: str, *, proxy_url: str = None,
                                fallback_proxy_urls: Optional[List[str]] = None, **kwargs):
    candidates = get_proxy_failover_candidates(proxy_url or '', fallback_proxy_urls)
    if not candidates:
        log_outbound_proxy_usage(f'{method.upper()} {url}', '')
        return requests.request(method, url, **kwargs)

    last_exc = None
    proxy_failures = []
    for index, (label, candidate) in enumerate(candidates):
        log_outbound_proxy_usage(f'{method.upper()} {url}', candidate, label=label)
        request_kwargs = build_request_kwargs_for_proxy(kwargs, candidate)
        try:
            response = requests.request(method, url, **request_kwargs)
            if index > 0:
                app.logger.warning(
                    "Proxy candidate %s succeeded for %s %s after previous failures",
                    label,
                    method.upper(),
                    url,
                )
            return response
        except Exception as exc:
            last_exc = exc
            proxy_failures.append({
                'candidate': label,
                'proxy': candidate != DIRECT_PROXY_SENTINEL,
                'type': type(exc).__name__,
                'details': sanitize_error_details(str(exc)),
            })
            try:
                exc.proxy_failures = list(proxy_failures)
            except Exception:
                pass
            if index == len(candidates) - 1 or not should_retry_next_proxy(exc, candidate):
                raise
            app.logger.warning(
                "Proxy candidate %s failed for %s %s: %s",
                label,
                method.upper(),
                url,
                sanitize_error_details(str(exc)),
            )

    if last_exc:
        raise last_exc
    raise RuntimeError(f'Request failed: {method.upper()} {url}')


def post_with_proxy_fallback(url: str, *, proxy_url: str = None,
                             fallback_proxy_urls: Optional[List[str]] = None, **kwargs):
    return request_with_proxy_failover(
        'post',
        url,
        proxy_url=proxy_url,
        fallback_proxy_urls=fallback_proxy_urls,
        **kwargs
    )


GRAPH_DEFAULT_TOKEN_SCOPE = "https://graph.microsoft.com/.default"


def build_graph_refresh_scope(graph_scopes: List[str]) -> str:
    scopes = [scope for scope in graph_scopes if scope]
    if 'offline_access' in OAUTH_SCOPES:
        scopes.append('offline_access')
    return ' '.join(scopes)


def get_graph_token_scope_candidates(include_original_scope_fallback: bool = False) -> List[tuple[str, str]]:
    configured_graph_scopes = [
        scope for scope in OAUTH_GRAPH_SCOPES
        if str(scope or '').startswith('https://graph.microsoft.com/')
    ]
    read_write_graph_scopes = [
        scope for scope in configured_graph_scopes
        if scope != 'https://graph.microsoft.com/Mail.Send'
    ]
    read_graph_scopes = [
        scope for scope in read_write_graph_scopes
        if scope != 'https://graph.microsoft.com/Mail.ReadWrite'
    ]
    raw_candidates = [
        ('configured', build_graph_refresh_scope(configured_graph_scopes)),
        ('read_write', build_graph_refresh_scope(read_write_graph_scopes)),
        ('read', build_graph_refresh_scope(read_graph_scopes)),
        ('default', GRAPH_DEFAULT_TOKEN_SCOPE),
    ]
    if include_original_scope_fallback:
        raw_candidates.append(('original', ''))

    candidates = []
    seen_scopes = set()
    for label, scope in raw_candidates:
        if scope in seen_scopes:
            continue
        seen_scopes.add(scope)
        candidates.append((label, scope))
    return candidates


def is_graph_token_scope_retryable_response(response) -> bool:
    if response.status_code not in {400, 401, 403}:
        return False
    details = get_response_details(response)
    if isinstance(details, dict):
        error_code = str(details.get('error') or '').strip().lower()
        details_text = json.dumps(details, ensure_ascii=True).lower()
    else:
        error_code = ''
        details_text = str(details or '').lower()

    if error_code in {'invalid_scope', 'consent_required', 'interaction_required'}:
        return True
    return any(marker in details_text for marker in (
        'aadsts90023',
        'aadsts70000',
        'aadsts70011',
        'no applicable permissions',
        'requested are unauthorized or expired',
        'consent',
        'invalid scope',
    ))


def request_graph_token_response(client_id: str, refresh_token: str, proxy_url: str = None,
                                 fallback_proxy_urls: Optional[List[str]] = None,
                                 include_original_scope_fallback: bool = False):
    'When requesting Graph token, give priority to using explicit delegation scope during authorization to avoid .default relying on application pre-configured permissions.'
    last_response = None
    candidates = get_graph_token_scope_candidates(include_original_scope_fallback)
    for index, (_label, scope) in enumerate(candidates):
        data = {
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        if scope:
            data["scope"] = scope

        response = post_with_proxy_fallback(
            TOKEN_URL_GRAPH,
            data=data,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )
        last_response = response
        if response.status_code == 200:
            return response
        if index == len(candidates) - 1 or not is_graph_token_scope_retryable_response(response):
            return response

    return last_response


def get_with_proxy_fallback(url: str, *, proxy_url: str = None,
                            fallback_proxy_urls: Optional[List[str]] = None, **kwargs):
    return request_with_proxy_failover(
        'get',
        url,
        proxy_url=proxy_url,
        fallback_proxy_urls=fallback_proxy_urls,
        **kwargs
    )


@contextmanager
def proxy_socket_context(proxy_url: str):
    if not proxy_url or not socks:
        log_outbound_proxy_usage('IMAP socket', proxy_url or '')
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
        log_outbound_proxy_usage('IMAP socket (invalid proxy, fallback to direct connection)', proxy_url)
        yield
        return

    username = unquote(parsed.username) if parsed.username else None
    # Distinguish between "no password field" and "empty password": password may be ''
    password = unquote(parsed.password) if parsed.password is not None else None
    username, password = resolve_socks_proxy_auth(username, password)
    rdns = scheme == 'socks5h'
    log_outbound_proxy_usage('IMAP socket', proxy_url)

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


def get_access_token_graph_result(client_id: str, refresh_token: str, proxy_url: str = None,
                                  fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Get Graph API access_token (including error details)'
    try:
        res = request_graph_token_response(
            client_id,
            refresh_token,
            proxy_url,
            fallback_proxy_urls,
        )

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "GRAPH_TOKEN_FAILED",
                    'Failed to obtain access token',
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
                    'Failed to obtain access token',
                    "GraphAPIError",
                    res.status_code,
                    payload
                )
            }

        return {"success": True, "access_token": access_token}
    except Exception as exc:
        return {
            "success": False,
            "error": build_mail_fetch_error(
                exc,
                proxy_url,
                'Get access token',
                legacy_code='GRAPH_TOKEN_EXCEPTION',
                legacy_message='Failed to obtain access token',
                legacy_status=500,
            )
        }


def get_access_token_graph(client_id: str, refresh_token: str, proxy_url: str = None,
                           fallback_proxy_urls: Optional[List[str]] = None) -> Optional[str]:
    'Get Graph API access_token'
    result = get_access_token_graph_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if result.get("success"):
        return result.get("access_token")
    return None


_GRAPH_SEND_RECIPIENT_PATTERN = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
_GRAPH_SEND_REAUTH_MARKERS = (
    'invalid_grant',
    'invalid_scope',
    'consent_required',
    'interaction_required',
    'mail.send',
    'insufficient privileges',
    'access is denied',
    'authorization has been denied',
    'token has expired',
    'token is expired',
)


def post_once_with_primary_proxy(url: str, *, proxy_url: str = None, **kwargs):
    'Submit POST only once through the main proxy to avoid repeated writing to the remote service when the result is uncertain.'
    proxy_candidate = normalize_proxy_candidate(proxy_url)
    if proxy_candidate:
        log_outbound_proxy_usage(f'POST {url}', proxy_candidate, label='primary')
        request_kwargs = build_request_kwargs_for_proxy(kwargs, proxy_candidate)
    else:
        log_outbound_proxy_usage(f'POST {url}', '')
        request_kwargs = dict(kwargs)
    request_kwargs['allow_redirects'] = False
    return requests.request('post', url, **request_kwargs)


def normalize_graph_send_mail_payload(recipients: Any, subject: Any, body: Any) -> tuple[Optional[Dict[str, Any]], str]:
    'Verify and normalize Graph basic signaling fields.'
    if not isinstance(recipients, list):
        return None, 'Invalid recipient format'

    normalized_recipients = []
    seen = set()
    for raw_recipient in recipients:
        if not isinstance(raw_recipient, str):
            return None, 'Invalid recipient format'
        address = raw_recipient.strip()
        normalized_address = address.lower()
        if not _GRAPH_SEND_RECIPIENT_PATTERN.fullmatch(address):
            return None, 'The recipient email address is invalid'
        if normalized_address not in seen:
            seen.add(normalized_address)
            normalized_recipients.append(normalized_address)

    if not normalized_recipients:
        return None, 'Please fill in at least one recipient'
    if not isinstance(subject, str) or not isinstance(body, str):
        return None, 'The subject and body must be text'
    if '\x00' in subject or '\x00' in body:
        return None, 'The subject and body cannot contain null characters'
    if '\r' in subject or '\n' in subject:
        return None, 'The subject cannot contain line breaks'
    if not subject.strip() and not body.strip():
        return None, 'The subject and body cannot be empty at the same time'

    return {
        'recipients': normalized_recipients,
        'subject': subject,
        'body': body,
    }, ''


def is_graph_send_reauthorization_error(status: Any, details: Any) -> bool:
    'Determine whether the failure of sending the message requires the user to complete the Graph authorization again.'
    try:
        status_code = int(status or 0)
    except (TypeError, ValueError):
        status_code = 0
    if status_code in {401, 403}:
        return True
    try:
        details_text = json.dumps(details, ensure_ascii=True).lower()
    except Exception:
        details_text = str(details or '').lower()
    return any(marker in details_text for marker in _GRAPH_SEND_REAUTH_MARKERS)


def build_graph_send_error_result(code: str, message: str, status: int, details: Any = None,
                                  *, retryable: bool = False, submission_unknown: bool = False,
                                  retry_after: Optional[int] = None) -> Dict[str, Any]:
    'Construct stable failure results for basic messaging to avoid exposing sensitive credentials to the client.'
    result = {
        'success': False,
        'submitted': False,
        'retryable': retryable,
        'submission_unknown': submission_unknown,
        'error': build_error_payload(code, message, 'GraphSendError', status, details),
    }
    if retry_after is not None:
        result['retry_after'] = retry_after
    return result


def get_graph_send_retry_after(response) -> Optional[int]:
    'Read the second-level Retry-After in the Graph 429 response; non-second values \u200b\u200bare given to the user to try again later.'
    try:
        raw_value = str((response.headers or {}).get('Retry-After') or '').strip()
        retry_after = int(raw_value)
    except (AttributeError, TypeError, ValueError):
        return None
    return retry_after if retry_after >= 0 else None


def send_graph_mail_result(client_id: str, refresh_token: str, recipients: Any, subject: Any, body: Any,
                           proxy_url: str = None,
                           fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Use the current Graph delegation account to submit a basic plain text email at a time.'
    payload, validation_error = normalize_graph_send_mail_payload(recipients, subject, body)
    if validation_error:
        return build_graph_send_error_result(
            'GRAPH_SEND_INVALID_REQUEST',
            validation_error,
            400,
        )

    token_result = get_access_token_graph_result(
        client_id,
        refresh_token,
        proxy_url,
        fallback_proxy_urls,
    )
    if not token_result.get('success'):
        token_error = token_result.get('error') or {}
        token_status = token_error.get('status', 502) if isinstance(token_error, dict) else 502
        token_details = token_error.get('details', '') if isinstance(token_error, dict) else token_error
        if is_graph_send_reauthorization_error(token_status, token_details):
            return build_graph_send_error_result(
                'GRAPH_SEND_REAUTH_REQUIRED',
                'Insufficient permission to send messages or the authorization has expired. Please complete the Graph authorization again and try again.',
                403,
                token_details,
            )
        return build_graph_send_error_result(
            'GRAPH_SEND_TOKEN_FAILED',
            'Failed to obtain the sending access token, please try again later.',
            int(token_status or 502),
            token_details,
            retryable=bool(token_error.get('retryable')) if isinstance(token_error, dict) else False,
        )

    graph_payload = {
        'message': {
            'subject': payload['subject'],
            'body': {
                'contentType': 'Text',
                'content': payload['body'],
            },
            'toRecipients': [
                {'emailAddress': {'address': recipient}}
                for recipient in payload['recipients']
            ],
        },
    }
    headers = {
        'Authorization': f"Bearer {token_result.get('access_token')}",
        'Content-Type': 'application/json',
    }

    try:
        response = post_once_with_primary_proxy(
            'https://graph.microsoft.com/v1.0/me/sendMail',
            headers=headers,
            json=graph_payload,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
        )
    except Exception as exc:
        return build_graph_send_error_result(
            'GRAPH_SEND_RESULT_UNKNOWN',
            'The result of email submission is uncertain, please confirm before deciding whether to resend.',
            503,
            sanitize_error_details(str(exc)),
            submission_unknown=True,
        )

    if response.status_code == 202:
        return {
            'success': True,
            'submitted': True,
            'message': 'The email has been submitted for sending',
        }

    response_status = int(response.status_code or 502)
    response_details = get_response_details(response)
    if response_status == 429:
        retry_after = get_graph_send_retry_after(response)
        return build_graph_send_error_result(
            'GRAPH_SEND_THROTTLED',
            'Requests are sent too frequently, please try again later.',
            429,
            response_details,
            retryable=True,
            retry_after=retry_after,
        )
    if 300 <= response_status < 400 or response_status == 408 or response_status >= 500:
        return build_graph_send_error_result(
            'GRAPH_SEND_RESULT_UNKNOWN',
            'The result of email submission is uncertain, please confirm before deciding whether to resend.',
            response_status,
            response_details,
            submission_unknown=True,
        )
    if is_graph_send_reauthorization_error(response_status, response_details):
        return build_graph_send_error_result(
            'GRAPH_SEND_REAUTH_REQUIRED',
            'Insufficient permission to send messages or the authorization has expired. Please complete the Graph authorization again and try again.',
            403,
            response_details,
        )
    return build_graph_send_error_result(
        'GRAPH_SEND_FAILED',
        'Email submission failed, please check the recipient and account status and try again',
        response_status,
        response_details,
    )


def get_emails_graph(client_id: str, refresh_token: str, folder: str = 'inbox', skip: int = 0,
                     top: int = 20, proxy_url: str = None,
                     fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Use Graph API to get the mailing list (supports paging and folder selection)'
    token_result = get_access_token_graph_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get("success"):
        return {"success": False, "error": token_result.get("error")}

    access_token = token_result.get("access_token")

    try:
        # Select API endpoint based on folder type
        # Use Well-known folder names, which are standard folder names for the Microsoft Graph API
        folder_map = {
            'inbox': 'inbox',
            'junkemail': 'junkemail',  # Standard name for spam
            'deleteditems': 'deleteditems',  # The fully qualified name of a deleted message
            'trash': 'deleteditems'  # Alias for trash can
        }
        folder_name = folder_map.get(folder.lower(), 'inbox')

        url = f"https://graph.microsoft.com/v1.0/me/mailFolders/{folder_name}/messages"
        params = {
            "$top": top,
            "$skip": skip,
            "$select": "id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview",
            "$orderby": "receivedDateTime desc"
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='text'"
        }

        res = get_with_proxy_fallback(
            url,
            headers=headers,
            params=params,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "EMAIL_FETCH_FAILED",
                    'Failed to obtain email, please check account configuration',
                    "GraphAPIError",
                    res.status_code,
                    details
                )
            }

        return {"success": True, "emails": res.json().get("value", [])}
    except Exception as exc:
        return {
            "success": False,
            "error": build_mail_fetch_error(
                exc,
                proxy_url,
                'Fetch mail',
                legacy_code='EMAIL_FETCH_FAILED',
                legacy_message='Failed to obtain email, please check account configuration',
                legacy_status=500,
            )
        }


def get_raw_email_graph(client_id: str, refresh_token: str, message_id: str, proxy_url: str = None,
                        fallback_proxy_urls: Optional[List[str]] = None) -> Optional[bytes]:
    'Use Graph API to obtain the original MIME email source code.'
    access_token = get_access_token_graph(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return None

    try:
        url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/$value"
        headers = {
            "Authorization": f"Bearer {access_token}",
        }
        res = get_with_proxy_fallback(
            url,
            headers=headers,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )
        if res.status_code != 200:
            return None
        return res.content
    except Exception:
        return None


def get_email_detail_graph_result(client_id: str, refresh_token: str, message_id: str, proxy_url: str = None,
                                  fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Use Graph API to get email details (including structured errors)'
    token_result = get_access_token_graph_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get('success'):
        return {'success': False, 'error': token_result.get('error')}

    access_token = token_result.get('access_token')
    try:
        url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}"
        params = {
            "$select": "id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body,bodyPreview"
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='html'"
        }

        res = get_with_proxy_fallback(
            url,
            headers=headers,
            params=params,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                'success': False,
                'error': build_error_payload(
                    'EMAIL_DETAIL_FETCH_FAILED',
                    'Failed to obtain email details',
                    'GraphAPIError',
                    res.status_code,
                    details,
                ),
            }

        return {'success': True, 'detail': res.json()}
    except Exception as exc:
        return {
            'success': False,
            'error': build_mail_fetch_error(
                exc,
                proxy_url,
                'Get email details',
                legacy_code='EMAIL_DETAIL_FETCH_FAILED',
                legacy_message='Failed to obtain email details',
                legacy_status=500,
            ),
        }


def get_email_detail_graph(client_id: str, refresh_token: str, message_id: str, proxy_url: str = None,
                           fallback_proxy_urls: Optional[List[str]] = None) -> Optional[Dict]:
    'Use Graph API to get email details'
    result = get_email_detail_graph_result(
        client_id, refresh_token, message_id, proxy_url, fallback_proxy_urls
    )
    if result.get('success'):
        return result.get('detail')
    return None


def mark_emails_read_graph_result(client_id: str, refresh_token: str, message_ids: List[str],
                                  proxy_url: str = None,
                                  fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Mark emails as read in batches using Graph API'
    normalized_ids = [str(message_id or '').strip() for message_id in (message_ids or []) if str(message_id or '').strip()]
    if not normalized_ids:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': 0,
            'updated_ids': [],
            'errors': ['message_ids cannot be empty'],
        }

    token_result = get_access_token_graph_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get('success'):
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(normalized_ids),
            'updated_ids': [],
            'errors': [token_result.get('error')],
        }

    access_token = token_result.get('access_token')
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }

    batch_size = 20
    updated_ids: List[str] = []
    errors: List[Any] = []

    for index in range(0, len(normalized_ids), batch_size):
        batch = normalized_ids[index:index + batch_size]
        batch_requests = []
        for batch_index, message_id in enumerate(batch):
            batch_requests.append({
                'id': str(batch_index),
                'method': 'PATCH',
                'url': f'/me/messages/{message_id}',
                'headers': {
                    'Content-Type': 'application/json',
                },
                'body': {
                    'isRead': True,
                },
            })

        try:
            response = request_with_proxy_failover(
                'post',
                'https://graph.microsoft.com/v1.0/$batch',
                headers=headers,
                json={'requests': batch_requests},
                timeout=HTTP_REQUEST_TIMEOUT,
                proxy_url=proxy_url,
                fallback_proxy_urls=fallback_proxy_urls,
            )
        except Exception as exc:
            errors.extend({
                'id': message_id,
                'error': build_error_payload(
                    'EMAIL_MARK_READ_FAILED',
                    'Failed to mark email as read',
                    type(exc).__name__,
                    500,
                    str(exc)
                )
            } for message_id in batch)
            continue

        if response.status_code != 200:
            error_payload = build_error_payload(
                'EMAIL_MARK_READ_FAILED',
                'Failed to mark email as read',
                'GraphAPIError',
                response.status_code,
                get_response_details(response)
            )
            errors.extend({'id': message_id, 'error': error_payload} for message_id in batch)
            continue

        response_items = response.json().get('responses', [])
        response_map = {str(item.get('id')): item for item in response_items}

        for batch_index, message_id in enumerate(batch):
            item = response_map.get(str(batch_index))
            status_code = int(item.get('status', 0) or 0) if item else 0
            if status_code in {200, 202, 204}:
                updated_ids.append(message_id)
                continue

            error_body = item.get('body') if item else ''
            errors.append({
                'id': message_id,
                'error': build_error_payload(
                    'EMAIL_MARK_READ_FAILED',
                    'Failed to mark email as read',
                    'GraphAPIError',
                    status_code or 500,
                    error_body or 'Batch processing returns empty response'
                )
            })

    success_count = len(updated_ids)
    failed_count = len(normalized_ids) - success_count
    return {
        'success': failed_count == 0,
        'success_count': success_count,
        'failed_count': failed_count,
        'updated_ids': updated_ids,
        'errors': errors,
    }


def get_email_attachments_graph(client_id: str, refresh_token: str, message_id: str, proxy_url: str = None,
                                fallback_proxy_urls: Optional[List[str]] = None) -> Optional[List[Dict[str, Any]]]:
    'Use Graph API to get email attachment list'
    access_token = get_access_token_graph(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return None

    try:
        url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments"
        headers = {
            "Authorization": f"Bearer {access_token}",
        }
        params = {
            "$select": "id,name,contentType,size,isInline"
        }

        res = get_with_proxy_fallback(
            url,
            headers=headers,
            params=params,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )

        if res.status_code != 200:
            return None

        attachments = []
        for index, item in enumerate(res.json().get("value", []), start=1):
            attachments.append({
                "id": item.get("id", ""),
                "name": sanitize_attachment_filename(item.get("name", ""), f"attachment-{index}"),
                "content_type": item.get("contentType", "application/octet-stream") or "application/octet-stream",
                "size": int(item.get("size", 0) or 0),
                "is_inline": bool(item.get("isInline", False)),
                "content_id": str(item.get("contentId", "") or "").strip("<>"),
            })

        return attachments
    except Exception:
        return None


def download_email_attachment_graph_result(client_id: str, refresh_token: str, message_id: str, attachment_id: str,
                                           proxy_url: str = None,
                                           fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Use Graph API to download email attachments'
    token_result = get_access_token_graph_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get("success"):
        return {"success": False, "error": token_result.get("error")}

    access_token = token_result.get("access_token")
    headers = {
        "Authorization": f"Bearer {access_token}",
    }

    try:
        metadata_url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments/{attachment_id}"
        metadata_res = get_with_proxy_fallback(
            metadata_url,
            headers=headers,
            timeout=HTTP_REQUEST_TIMEOUT,
            proxy_url=proxy_url,
            fallback_proxy_urls=fallback_proxy_urls,
        )
        if metadata_res.status_code != 200:
            return {
                "success": False,
                "error": build_error_payload(
                    "ATTACHMENT_FETCH_FAILED",
                    'Failed to obtain attachment',
                    "GraphAPIError",
                    metadata_res.status_code,
                    get_response_details(metadata_res)
                )
            }

        metadata = metadata_res.json()
        raw_content = metadata.get("contentBytes")
        if raw_content:
            try:
                content = base64.b64decode(raw_content)
            except Exception as exc:
                return {
                    "success": False,
                    "error": build_error_payload(
                        "ATTACHMENT_DECODE_FAILED",
                        'Failed to parse attachment content',
                        type(exc).__name__,
                        500,
                        str(exc)
                    )
                }
        else:
            content_url = f"{metadata_url}/$value"
            content_res = get_with_proxy_fallback(
                content_url,
                headers=headers,
                timeout=HTTP_REQUEST_TIMEOUT,
                proxy_url=proxy_url,
                fallback_proxy_urls=fallback_proxy_urls,
            )
            if content_res.status_code != 200:
                return {
                    "success": False,
                    "error": build_error_payload(
                        "ATTACHMENT_FETCH_FAILED",
                        'Failed to obtain attachment',
                        "GraphAPIError",
                        content_res.status_code,
                        get_response_details(content_res)
                    )
                }
            content = content_res.content

        return {
            "success": True,
            "filename": sanitize_attachment_filename(metadata.get("name", ""), "attachment"),
            "content_type": metadata.get("contentType", "application/octet-stream") or "application/octet-stream",
            "content": content,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": build_error_payload(
                "ATTACHMENT_FETCH_FAILED",
                'Failed to obtain attachment',
                type(exc).__name__,
                500,
                str(exc)
            )
        }


# ==================== IMAP method ====================

IMAP_TOKEN_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"


def request_imap_token_response(client_id: str, refresh_token: str, proxy_url: str = None,
                                fallback_proxy_urls: Optional[List[str]] = None):
    return post_with_proxy_fallback(
        TOKEN_URL_IMAP,
        data={
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": IMAP_TOKEN_SCOPE
        },
        timeout=HTTP_REQUEST_TIMEOUT,
        proxy_url=proxy_url,
        fallback_proxy_urls=fallback_proxy_urls,
    )


def get_access_token_imap_result(client_id: str, refresh_token: str, proxy_url: str = None,
                                 fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Get IMAP access_token (with error details)'
    try:
        res = request_imap_token_response(client_id, refresh_token, proxy_url, fallback_proxy_urls)

        if res.status_code != 200:
            details = get_response_details(res)
            return {
                "success": False,
                "error": build_error_payload(
                    "IMAP_TOKEN_FAILED",
                    'Failed to obtain access token',
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
                    'Failed to obtain access token',
                    "IMAPError",
                    res.status_code,
                    payload
                )
            }

        return {"success": True, "access_token": access_token}
    except Exception as exc:
        return {
            "success": False,
            "error": build_mail_fetch_error(
                exc,
                proxy_url,
                'Get IMAP access token',
                legacy_code='IMAP_TOKEN_EXCEPTION',
                legacy_message='Failed to obtain access token',
                legacy_status=500,
            )
        }


def get_access_token_imap(client_id: str, refresh_token: str, proxy_url: str = None,
                          fallback_proxy_urls: Optional[List[str]] = None) -> Optional[str]:
    'Get IMAP access_token'
    result = get_access_token_imap_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if result.get("success"):
        return result.get("access_token")
    return None


def get_emails_imap(account: str, client_id: str, refresh_token: str, folder: str = 'inbox', skip: int = 0,
                    top: int = 20, proxy_url: str = None,
                    fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Get mailing list using IMAP (supports paging and folder selection) - uses newer server by default'
    return get_emails_imap_with_server(
        account,
        client_id,
        refresh_token,
        folder,
        skip,
        top,
        IMAP_SERVER_NEW,
        proxy_url,
        fallback_proxy_urls,
    )


def get_emails_imap_with_server(account: str, client_id: str, refresh_token: str, folder: str = 'inbox',
                                skip: int = 0, top: int = 20, server: str = IMAP_SERVER_NEW,
                                proxy_url: str = None,
                                fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    'Get mailing list using IMAP (supports paging, folder selection, and server selection)'
    token_result = get_access_token_imap_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get("success"):
        return {"success": False, "error": token_result.get("error")}

    access_token = token_result.get("access_token")

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(server, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)

        selected_folder, folder_diagnostics = resolve_imap_folder(connection, 'outlook', folder, readonly=True)
        if not selected_folder:
            return {
                "success": False,
                "error": build_error_payload(
                    "EMAIL_FETCH_FAILED",
                    f'Unable to access the folder, please check the account configuration',
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
                    'Failed to obtain email, please check account configuration',
                    "IMAPSearchError",
                    500,
                    f"search status={status}"
                )
            }
        if not messages or not messages[0]:
            return {"success": True, "emails": []}

        message_ids = messages[0].split()
        # Calculate paging range
        total = len(message_ids)
        start_idx = max(0, total - skip - top)
        end_idx = total - skip

        if start_idx >= end_idx:
            return {"success": True, "emails": []}

        paged_ids = message_ids[start_idx:end_idx][::-1]  # Reverse order, latest first

        emails = []
        for msg_id in paged_ids:
            try:
                status, msg_data = connection.fetch(msg_id, '(INTERNALDATE RFC822)')
                if status == 'OK' and msg_data and msg_data[0]:
                    raw_email = msg_data[0][1]
                    internal_date = extract_imap_internaldate(msg_data[0][0])
                    msg = email.message_from_bytes(raw_email)
                    body_preview = get_email_body(msg)

                    emails.append({
                        'id': msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id),
                        'subject': decode_header_value(msg.get("Subject", 'No topic')),
                        'from': decode_header_value(msg.get("From", 'Unknown sender')),
                        'to': decode_header_value(msg.get("To", "")),
                        'date': internal_date or msg.get("Date", 'Unknown time'),
                        'id_mode': 'sequence',
                        'body_preview': body_preview[:200] + "..." if len(body_preview) > 200 else body_preview
                    })
            except Exception:
                continue

        emails.sort(key=lambda item: parse_email_datetime(item.get('date')) or datetime.min, reverse=True)
        return {"success": True, "emails": emails}
    except Exception as exc:
        return {
            "success": False,
            "error": build_mail_fetch_error(
                exc,
                proxy_url,
                'Fetch mail',
                legacy_code='EMAIL_FETCH_FAILED',
                legacy_message='Failed to obtain email, please check account configuration',
                legacy_status=500,
            )
        }
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def get_raw_email_imap(account: str, client_id: str, refresh_token: str, message_id: str,
                       folder: str = 'inbox', proxy_url: str = None,
                       fallback_proxy_urls: Optional[List[str]] = None) -> Optional[bytes]:
    'Use Outlook IMAP to obtain the original MIME email source code.'
    access_token = get_access_token_imap(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return None

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)

        selected_folder, _ = resolve_imap_folder(connection, 'outlook', folder, readonly=True)
        if not selected_folder:
            return None

        status, msg_data = connection.fetch(message_id.encode() if isinstance(message_id, str) else message_id, '(RFC822)')
        if status != 'OK' or not msg_data or not msg_data[0]:
            return None
        return msg_data[0][1]
    except Exception:
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


EMAIL_DETAIL_IMAP_MAX_ATTEMPTS = 2
EMAIL_DETAIL_IMAP_RETRY_DELAY_SECONDS = 0.4


def is_retryable_email_detail_error(error_payload: Any) -> bool:
    'Detailed retries are only allowed for transport errors such as proxy/network/timeout.'
    if not isinstance(error_payload, dict):
        return False
    if error_payload.get('retryable') is True:
        return True
    if str(error_payload.get('category') or '').strip().lower() in {'proxy', 'network'}:
        return True

    reason_code = str(error_payload.get('reason_code') or '').strip()
    if reason_code in {
        'MAIL_PROXY_FAILED',
        'MAIL_NETWORK_TIMEOUT',
        'MAIL_TLS_FAILED',
        'MAIL_NETWORK_FAILED',
    }:
        return True

    code = str(error_payload.get('code') or '').strip()
    if code in {'IMAP_CONNECT_FAILED', 'EMAIL_DETAIL_CONNECT_FAILED'}:
        return True

    error_type = str(error_payload.get('type') or '').strip()
    return error_type in {
        'ProxyError',
        'ConnectionError',
        'ConnectTimeout',
        'ReadTimeout',
        'Timeout',
        'TimeoutError',
        'SSLError',
        'OSError',
        'socket.timeout',
        'gaierror',
    }


def annotate_email_detail_retry(error_payload: Any, attempts: int, retried: bool) -> Any:
    if not isinstance(error_payload, dict):
        return error_payload
    annotated = dict(error_payload)
    annotated['attempts'] = attempts
    annotated['retried'] = bool(retried)
    return annotated


def _get_email_detail_imap_result_once(account: str, client_id: str, refresh_token: str, message_id: str,
                                       folder: str = 'inbox', proxy_url: str = None,
                                       fallback_proxy_urls: Optional[List[str]] = None,
                                       preferred_id_mode: str = 'uid') -> Dict[str, Any]:
    'Single IMAP details retrieval (excluding retries).'
    token_result = get_access_token_imap_result(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not token_result.get('success'):
        return {'success': False, 'error': token_result.get('error')}

    access_token = token_result.get('access_token')
    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        try:
            connection.authenticate('XOAUTH2', lambda x: auth_string)
        except imaplib.IMAP4.error as exc:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_AUTH_FAILED',
                    sanitize_error_details(str(exc)) or 'IMAP authentication failed',
                    'IMAPAuthError',
                    401,
                    '',
                ),
            }

        selected_folder, folder_diagnostics = resolve_imap_folder(
            connection, 'outlook', folder, readonly=True
        )
        if not selected_folder:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_FOLDER_NOT_FOUND',
                    'IMAP folder does not exist or does not have access rights',
                    'IMAPSelectError',
                    400,
                    folder_diagnostics,
                ),
            }

        preferred_mode = str(preferred_id_mode or 'uid').strip().lower()
        if preferred_mode not in {'uid', 'sequence'}:
            preferred_mode = 'uid'
        status, msg_data, _fetch_mode, _fetch_attempts = fetch_imap_message(
            connection,
            message_id,
            '(RFC822)',
            preferred_mode=preferred_mode
        )
        if status != 'OK' or not msg_data:
            return {
                'success': False,
                'error': build_error_payload(
                    'EMAIL_DETAIL_FETCH_FAILED',
                    'Failed to obtain email details',
                    'IMAPFetchError',
                    502,
                    {
                        'status': status,
                        'folder': selected_folder,
                        'message_id': str(message_id),
                        'preferred_id_mode': preferred_mode,
                        'fetch_attempts': (_fetch_attempts or [])[:10],
                    },
                ),
            }

        raw_email, fetch_response_text = parse_imap_fetch_response(msg_data)
        if not raw_email:
            return {
                'success': False,
                'error': build_error_payload(
                    'EMAIL_DETAIL_FETCH_FAILED',
                    'Failed to obtain email details',
                    'IMAPFetchError',
                    502,
                    {
                        'folder': selected_folder,
                        'message_id': str(message_id),
                        'preferred_id_mode': preferred_mode,
                        'fetch_attempts': (_fetch_attempts or [])[:10],
                    },
                ),
            }
        msg = email.message_from_bytes(raw_email)
        return {
            'success': True,
            'email': build_email_detail_from_message(
                msg,
                str(message_id),
                extract_imap_internaldate(fetch_response_text)
            ),
        }
    except Exception as exc:
        return {
            'success': False,
            'error': build_mail_fetch_error(
                exc,
                proxy_url,
                'Get email details',
                legacy_code='EMAIL_DETAIL_FETCH_FAILED',
                legacy_message='Failed to obtain email details',
                legacy_status=500,
            ),
        }
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def get_email_detail_imap_result(account: str, client_id: str, refresh_token: str, message_id: str,
                                 folder: str = 'inbox', proxy_url: str = None,
                                 fallback_proxy_urls: Optional[List[str]] = None,
                                 preferred_id_mode: str = 'uid') -> Dict[str, Any]:
    'Use IMAP to get email details (including structured errors; transmission failure will be retried once in a limited time).'
    max_attempts = max(1, int(EMAIL_DETAIL_IMAP_MAX_ATTEMPTS or 1))
    last_result: Dict[str, Any] = {'success': False, 'error': 'Failed to obtain email details'}
    attempt = 0

    for attempt in range(1, max_attempts + 1):
        result = _get_email_detail_imap_result_once(
            account,
            client_id,
            refresh_token,
            message_id,
            folder,
            proxy_url,
            fallback_proxy_urls,
            preferred_id_mode,
        )
        if result.get('success'):
            if attempt > 1:
                result = dict(result)
                result['retried'] = True
                result['attempts'] = attempt
            return result

        last_result = result
        error_payload = result.get('error')
        if attempt >= max_attempts or not is_retryable_email_detail_error(error_payload):
            break
        time.sleep(EMAIL_DETAIL_IMAP_RETRY_DELAY_SECONDS)

    if isinstance(last_result, dict) and last_result.get('error') is not None:
        annotated = dict(last_result)
        # attempt records the actual number of executions; failure that cannot be retried is 1, and failure after retry is max_attempts
        annotated['error'] = annotate_email_detail_retry(
            last_result.get('error'),
            max(1, attempt),
            bool(attempt > 1),
        )
        return annotated
    return last_result


def get_email_detail_imap(account: str, client_id: str, refresh_token: str, message_id: str,
                          folder: str = 'inbox', proxy_url: str = None,
                          fallback_proxy_urls: Optional[List[str]] = None,
                          preferred_id_mode: str = 'uid') -> Optional[Dict]:
    'Use IMAP to get email details'
    result = get_email_detail_imap_result(
        account,
        client_id,
        refresh_token,
        message_id,
        folder,
        proxy_url,
        fallback_proxy_urls,
        preferred_id_mode,
    )
    if result.get('success'):
        return result.get('email')
    return None


# ==================== Login verification ====================

def extract_imap_internaldate(fetch_metadata: Any) -> str:
    if isinstance(fetch_metadata, (bytes, bytearray)):
        metadata_text = fetch_metadata.decode('utf-8', errors='ignore')
    else:
        metadata_text = str(fetch_metadata or '')

    match = re.search(r'INTERNALDATE "([^"]+)"', metadata_text)
    if not match:
        return ''
    return match.group(1).strip()


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


def sanitize_attachment_filename(filename: str, fallback: str = 'attachment') -> str:
    decoded = decode_header_value(filename or '').strip()
    if not decoded:
        return fallback

    cleaned = re.sub(r'[\r\n]+', ' ', decoded).strip()
    cleaned = cleaned.replace('/', '_').replace('\\', '_')
    return cleaned or fallback


def extract_message_attachments(msg, include_content: bool = False) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    attachment_number = 0

    if not msg.is_multipart():
        return attachments

    for part in msg.walk():
        if part.is_multipart():
            continue

        disposition = str(part.get('Content-Disposition', '') or '').lower()
        filename = part.get_filename()
        has_filename = bool(filename)
        is_attachment = 'attachment' in disposition
        is_inline = 'inline' in disposition

        if not (is_attachment or is_inline or has_filename):
            continue

        attachment_number += 1
        payload = part.get_payload(decode=True) or b''
        item = {
            'id': f'attachment-{attachment_number}',
            'name': sanitize_attachment_filename(filename or '', f'attachment-{attachment_number}'),
            'content_type': (part.get_content_type() or 'application/octet-stream').lower(),
            'size': len(payload),
            'is_inline': bool(is_inline and not is_attachment),
            'content_id': str(part.get('Content-ID', '') or '').strip('<>'),
        }
        if include_content:
            item['content'] = payload
        attachments.append(item)

    return attachments


def get_message_attachment_by_id(msg, attachment_id: str) -> Optional[Dict[str, Any]]:
    for attachment in extract_message_attachments(msg, include_content=True):
        if attachment.get('id') == attachment_id:
            return attachment
    return None


def get_raw_email_imap_generic(email_addr: str, imap_password: str, imap_host: str,
                               imap_port: int, message_id: str, folder: str = 'inbox',
                               provider: str = 'custom', proxy_url: str = '') -> Optional[bytes]:
    'Use Universal IMAP to obtain the original MIME email source code.'
    if not message_id:
        return None

    connection = None
    try:
        connection = create_imap_connection(imap_host, imap_port, proxy_url)
        connection.login(email_addr, imap_password)
        selected_folder, _folder_diagnostics = resolve_imap_folder(connection, provider, folder, readonly=True)
        if not selected_folder:
            return None

        status, msg_data, _fetch_mode, _fetch_attempts = fetch_imap_message(
            connection,
            str(message_id),
            '(RFC822)',
            preferred_mode='uid'
        )
        if status != 'OK' or not msg_data or not msg_data[0]:
            return None
        return msg_data[0][1]
    except Exception:
        return None
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def build_email_detail_from_message(msg, message_id: str, date_value: str = '') -> Dict[str, Any]:
    body_text, body_html = extract_text_and_html(msg)
    return {
        'id': str(message_id),
        'subject': decode_header_value(msg.get('Subject', 'No topic')),
        'from': decode_header_value(msg.get('From', 'Unknown sender')),
        'to': decode_header_value(msg.get('To', '')),
        'cc': decode_header_value(msg.get('Cc', '')),
        'date': date_value or msg.get('Date', ''),
        'body': body_html or body_text,
        'body_type': 'html' if body_html else 'text',
        'attachments': extract_message_attachments(msg),
    }


def has_message_attachments(msg) -> bool:
    return len(extract_message_attachments(msg)) > 0


def create_imap_connection(imap_host: str, imap_port: int = 993, proxy_url: str = ''):
    host = (imap_host or '').strip()
    port = int(imap_port or 993)
    if not host:
        raise ValueError('IMAP host cannot be empty')
    try:
        with proxy_socket_context(proxy_url):
            return imaplib.IMAP4_SSL(host, port, timeout=IMAP_TIMEOUT)
    except TypeError:
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(IMAP_TIMEOUT)
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


def extract_imap_exists_count(select_response: Any) -> int:
    if isinstance(select_response, (list, tuple)):
        for item in select_response:
            if isinstance(item, (bytes, bytearray)):
                text = item.decode('utf-8', errors='ignore').strip()
            else:
                text = str(item or '').strip()
            if text.isdigit():
                try:
                    return int(text)
                except ValueError:
                    continue
    text = str(select_response or '')
    match = re.search(r"\b(\d+)\b", text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 0
    return 0


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
    message = sanitize_error_details(str(raw_message or '')).strip() or 'IMAP authentication failed'
    if 'unsafe login' in message.lower():
        if (provider or '').strip().lower() in {'126', '163'}:
            return 'NetEase Mailbox has intercepted the current IMAP login (Unsafe Login). Please enable IMAP on the web page and use the client authorization code; if it still fails, it means that the current network or server IP is under risk control.'
        return 'The email service provider has blocked the current IMAP login (Unsafe Login). Please check whether IMAP is turned on and use the authorization code instead.'
    if (provider or '').strip().lower() == 'gmail':
        return 'IMAP authentication failed, please use Gmail application-specific password and confirm that IMAP is turned on'
    if ((provider or '').strip().lower() == 'outlook' or (imap_host or '').strip().lower() in {IMAP_SERVER_NEW, IMAP_SERVER_OLD}) and 'basicauthblocked' in message.lower():
        return 'Outlook has blocked Basic Auth, please use Outlook OAuth import instead'
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
        message = 'NetEase Mailbox has intercepted the current IMAP login (Unsafe Login). Please enable IMAP on the web page and use the client authorization code; if it still fails, it means that the current network or server IP is controlled by NetEase.'
    else:
        message = 'The email service provider has intercepted the current IMAP login (Unsafe Login). Please confirm that IMAP has been turned on, use the authorization code, and check whether the current network or proxy is risk controlled.'

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


def search_imap_message_ids(mail) -> tuple[Optional[List[bytes]], str, List[Dict[str, Any]]]:
    attempts: List[Dict[str, Any]] = []

    try:
        status, data = mail.uid('SEARCH', None, 'ALL')
        attempts.append({
            'mode': 'uid',
            'status': str(status),
            'response': sanitize_error_details(str(data or ''))[:200],
        })
        if status == 'OK':
            payload = data[0] if data else b''
            return payload.split() if payload else [], 'uid', attempts
    except Exception as exc:
        attempts.append({
            'mode': 'uid',
            'status': type(exc).__name__,
            'response': sanitize_error_details(str(exc))[:200],
        })

    try:
        status, data = mail.search(None, 'ALL')
        attempts.append({
            'mode': 'sequence',
            'status': str(status),
            'response': sanitize_error_details(str(data or ''))[:200],
        })
        if status == 'OK':
            payload = data[0] if data else b''
            return payload.split() if payload else [], 'sequence', attempts
    except Exception as exc:
        attempts.append({
            'mode': 'sequence',
            'status': type(exc).__name__,
            'response': sanitize_error_details(str(exc))[:200],
        })

    return None, '', attempts


def build_sequence_message_ids(total_messages: int) -> List[bytes]:
    if total_messages <= 0:
        return []
    return [str(index).encode('utf-8') for index in range(1, total_messages + 1)]


def has_imap_fetch_payload(data: Any) -> bool:
    if not data:
        return False

    items = data if isinstance(data, (list, tuple)) else [data]
    for item in items:
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        payload = item[1]
        if payload is None:
            continue
        if isinstance(payload, memoryview):
            payload = payload.tobytes()
        if isinstance(payload, (bytes, bytearray)):
            if payload:
                return True
            continue
        if str(payload):
            return True
    return False


def parse_imap_fetch_response(data: Any) -> tuple[bytes | None, str]:
    raw_email = None
    response_fragments: List[str] = []
    items = data if isinstance(data, (list, tuple)) else [data]

    for item in items:
        if item is None:
            continue

        if isinstance(item, tuple):
            tuple_items = list(item)
            if tuple_items:
                head = tuple_items[0]
                if isinstance(head, memoryview):
                    head = head.tobytes()
                if isinstance(head, (bytes, bytearray)):
                    response_fragments.append(head.decode('utf-8', errors='ignore'))
                elif head is not None:
                    response_fragments.append(str(head))

            for payload in tuple_items[1:]:
                if isinstance(payload, memoryview):
                    payload = payload.tobytes()
                if raw_email is None and isinstance(payload, (bytes, bytearray)) and payload:
                    raw_email = bytes(payload)
                    continue
                if isinstance(payload, (bytes, bytearray)):
                    response_fragments.append(payload.decode('utf-8', errors='ignore'))
                elif payload is not None:
                    response_fragments.append(str(payload))
            continue

        if isinstance(item, memoryview):
            item = item.tobytes()
        if isinstance(item, (bytes, bytearray)):
            response_fragments.append(item.decode('utf-8', errors='ignore'))
        else:
            response_fragments.append(str(item))

    return raw_email, ' '.join(fragment for fragment in response_fragments if fragment).strip()


def fetch_imap_message(mail, message_id: Any, query: str, preferred_mode: str = 'uid') -> tuple[str, Any, str, List[Dict[str, Any]]]:
    message_text = message_id.decode('utf-8', errors='ignore') if isinstance(message_id, (bytes, bytearray)) else str(message_id)
    modes = [preferred_mode]
    if preferred_mode != 'uid':
        modes.append('uid')
    if preferred_mode != 'sequence':
        modes.append('sequence')

    attempts: List[Dict[str, Any]] = []
    for mode in modes:
        try:
            if mode == 'uid':
                status, data = mail.uid('FETCH', message_id, query)
            else:
                status, data = mail.fetch(message_text, query)
            payload_present = has_imap_fetch_payload(data)
            attempts.append({
                'mode': mode,
                'status': str(status),
                'response': sanitize_error_details(str(data or ''))[:200],
                'payload_present': payload_present,
            })
            if status == 'OK' and payload_present:
                return status, data, mode, attempts
        except Exception as exc:
            attempts.append({
                'mode': mode,
                'status': type(exc).__name__,
                'response': sanitize_error_details(str(exc))[:200],
            })
    return 'NO', None, '', attempts


def store_imap_message_flags(mail, message_id: Any, action: str = '+FLAGS.SILENT',
                             flags: str = r'(\Seen)',
                             preferred_mode: str = 'uid') -> tuple[bool, str, List[Dict[str, Any]]]:
    message_text = message_id.decode('utf-8', errors='ignore') if isinstance(message_id, (bytes, bytearray)) else str(message_id)
    modes = [preferred_mode]
    if preferred_mode != 'uid':
        modes.append('uid')
    if preferred_mode != 'sequence':
        modes.append('sequence')

    attempts: List[Dict[str, Any]] = []
    for mode in modes:
        try:
            if mode == 'uid':
                status, data = mail.uid('STORE', message_id, action, flags)
            else:
                status, data = mail.store(message_text, action, flags)
            attempts.append({
                'mode': mode,
                'status': str(status),
                'response': sanitize_error_details(str(data or ''))[:200],
            })
            if status == 'OK':
                return True, mode, attempts
        except Exception as exc:
            attempts.append({
                'mode': mode,
                'status': type(exc).__name__,
                'response': sanitize_error_details(str(exc))[:200],
            })
    return False, '', attempts


def mark_email_items_seen_imap(mail, items: List[Dict[str, Any]], provider: str,
                               default_mode: str = 'uid') -> Dict[str, Any]:
    success_count = 0
    updated_ids: List[str] = []
    errors: List[Any] = []
    grouped_items: Dict[str, List[Dict[str, Any]]] = {}

    for item in items or []:
        message_id = str(item.get('id', '') or '').strip()
        folder = str(item.get('folder', 'inbox') or 'inbox').strip().lower()
        if not message_id:
            errors.append({
                'id': '',
                'error': build_error_payload(
                    'EMAIL_MARK_READ_INVALID',
                    'message_id cannot be empty',
                    'ValidationError',
                    400,
                    item
                )
            })
            continue
        grouped_items.setdefault(folder, []).append({
            'id': message_id,
            'folder': folder,
            'id_mode': str(item.get('id_mode', '') or '').strip().lower(),
        })

    for folder, folder_items in grouped_items.items():
        selected_folder, folder_diagnostics = resolve_imap_folder(mail, provider, folder, readonly=False)
        if not selected_folder:
            folder_error = build_error_payload(
                'IMAP_FOLDER_NOT_FOUND',
                'IMAP folder does not exist or does not have access rights',
                'IMAPFolderError',
                400,
                {
                    'provider': provider,
                    'folder': folder,
                    **folder_diagnostics,
                }
            )
            errors.extend({'id': item['id'], 'error': folder_error} for item in folder_items)
            continue

        for item in folder_items:
            preferred_mode = item.get('id_mode') or default_mode
            success, used_mode, attempts = store_imap_message_flags(
                mail,
                item['id'],
                preferred_mode=preferred_mode
            )
            if success:
                success_count += 1
                updated_ids.append(item['id'])
                item['id_mode'] = used_mode
                continue

            errors.append({
                'id': item['id'],
                'error': build_error_payload(
                    'EMAIL_MARK_READ_FAILED',
                    'Failed to mark email as read',
                    'IMAPStoreError',
                    502,
                    {
                        'provider': provider,
                        'folder': selected_folder,
                        'message_id': item['id'],
                        'store_attempts': attempts[:10],
                    }
                )
            })

    total_count = sum(len(group) for group in grouped_items.values())
    failed_count = total_count - success_count + sum(1 for item in errors if not item.get('id'))
    return {
        'success': failed_count == 0,
        'success_count': success_count,
        'failed_count': failed_count,
        'updated_ids': updated_ids,
        'errors': errors,
    }


def mark_emails_read_imap_batch(email_addr: str, client_id: str, refresh_token: str,
                                items: List[Dict[str, Any]], server: str = IMAP_SERVER_NEW,
                                proxy_url: str = None,
                                fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    access_token = get_access_token_imap(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_TOKEN_FAILED', 'Failed to obtain access token', 'IMAPError', 401, '')],
        }

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(server, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={email_addr}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        return mark_email_items_seen_imap(connection, items, 'outlook', default_mode='sequence')
    except Exception as exc:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_CONNECT_FAILED', 'IMAP connection failed', type(exc).__name__, 502, str(exc))],
        }
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def mark_emails_read_imap_generic_result(email_addr: str, imap_password: str, imap_host: str,
                                         items: List[Dict[str, Any]], imap_port: int = 993,
                                         provider: str = 'custom', proxy_url: str = '') -> Dict[str, Any]:
    mail = None
    try:
        mail = create_imap_connection(imap_host, imap_port, proxy_url)
        try:
            mail.login(email_addr, imap_password)
        except imaplib.IMAP4.error as exc:
            return {
                'success': False,
                'success_count': 0,
                'failed_count': len(items or []),
                'updated_ids': [],
                'errors': [build_error_payload(
                    'IMAP_AUTH_FAILED',
                    normalize_imap_auth_error(provider, imap_host, str(exc)),
                    'IMAPAuthError',
                    401,
                    ''
                )],
            }

        send_imap_id(mail, provider, imap_host)
        return mark_email_items_seen_imap(mail, items, provider, default_mode='uid')
    except Exception as exc:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_CONNECT_FAILED', sanitize_error_details(str(exc)) or 'IMAP connection failed', 'IMAPConnectError', 502, '')],
        }
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


def delete_email_items_imap(mail, items: List[Dict[str, Any]], provider: str,
                            default_mode: str = 'uid') -> Dict[str, Any]:
    '\u901a\u8fc7 IMAP \u6c38\u4e45\u5220\u9664\u90ae\u4ef6：\u6807\u8bb0 \\Deleted \u540e EXPUNGE。'
    success_count = 0
    deleted_ids: List[str] = []
    errors: List[Any] = []
    grouped_items: Dict[str, List[Dict[str, Any]]] = {}

    for item in items or []:
        message_id = str(item.get('id', '') or '').strip()
        folder = str(item.get('folder', 'inbox') or 'inbox').strip().lower()
        if not message_id:
            errors.append({
                'id': '',
                'error': build_error_payload(
                    'EMAIL_DELETE_INVALID',
                    'message_id cannot be empty',
                    'ValidationError',
                    400,
                    item
                )
            })
            continue
        grouped_items.setdefault(folder, []).append({
            'id': message_id,
            'folder': folder,
            'id_mode': str(item.get('id_mode', '') or '').strip().lower(),
        })

    for folder, folder_items in grouped_items.items():
        selected_folder, folder_diagnostics = resolve_imap_folder(mail, provider, folder, readonly=False)
        if not selected_folder:
            folder_error = build_error_payload(
                'IMAP_FOLDER_NOT_FOUND',
                'IMAP folder does not exist or does not have access rights',
                'IMAPFolderError',
                400,
                {
                    'provider': provider,
                    'folder': folder,
                    **folder_diagnostics,
                }
            )
            errors.extend({'id': item['id'], 'error': folder_error} for item in folder_items)
            continue

        folder_deleted_ids: List[str] = []
        for item in folder_items:
            preferred_mode = item.get('id_mode') or default_mode
            success, used_mode, attempts = store_imap_message_flags(
                mail,
                item['id'],
                action='+FLAGS.SILENT',
                flags=r'(\Deleted)',
                preferred_mode=preferred_mode,
            )
            if success:
                folder_deleted_ids.append(item['id'])
                item['id_mode'] = used_mode
                continue

            errors.append({
                'id': item['id'],
                'error': build_error_payload(
                    'EMAIL_DELETE_FAILED',
                    'Failed to delete message',
                    'IMAPStoreError',
                    502,
                    {
                        'provider': provider,
                        'folder': selected_folder,
                        'message_id': item['id'],
                        'store_attempts': attempts[:10],
                    }
                )
            })

        if not folder_deleted_ids:
            continue

        try:
            expunge_status, expunge_data = mail.expunge()
            if expunge_status != 'OK':
                raise imaplib.IMAP4.error(str(expunge_data or expunge_status))
            success_count += len(folder_deleted_ids)
            deleted_ids.extend(folder_deleted_ids)
        except Exception as exc:
            expunge_error = build_error_payload(
                'EMAIL_DELETE_EXPUNGE_FAILED',
                'Message marked for deletion, but permanent purge failed',
                type(exc).__name__,
                502,
                {
                    'provider': provider,
                    'folder': selected_folder,
                    'message_ids': folder_deleted_ids[:20],
                    'details': sanitize_error_details(str(exc))[:200],
                }
            )
            errors.extend({'id': message_id, 'error': expunge_error} for message_id in folder_deleted_ids)

    total_count = sum(len(group) for group in grouped_items.values())
    failed_count = total_count - success_count + sum(1 for item in errors if not item.get('id'))
    return {
        'success': failed_count == 0,
        'success_count': success_count,
        'failed_count': failed_count,
        'deleted_ids': deleted_ids,
        'updated_ids': deleted_ids,
        'errors': errors,
    }


def delete_emails_imap_batch(email_addr: str, client_id: str, refresh_token: str,
                             items: List[Dict[str, Any]], server: str = IMAP_SERVER_NEW,
                             proxy_url: str = None,
                             fallback_proxy_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    access_token = get_access_token_imap(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'deleted_ids': [],
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_TOKEN_FAILED', 'Failed to obtain access token', 'IMAPError', 401, '')],
        }

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(server, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={email_addr}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)
        return delete_email_items_imap(connection, items, 'outlook', default_mode='sequence')
    except Exception as exc:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'deleted_ids': [],
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_CONNECT_FAILED', 'IMAP connection failed', type(exc).__name__, 502, str(exc))],
        }
    finally:
        if connection:
            try:
                connection.logout()
            except Exception:
                pass


def delete_emails_imap_generic_result(email_addr: str, imap_password: str, imap_host: str,
                                      items: List[Dict[str, Any]], imap_port: int = 993,
                                      provider: str = 'custom', proxy_url: str = '') -> Dict[str, Any]:
    mail = None
    try:
        mail = create_imap_connection(imap_host, imap_port, proxy_url)
        try:
            mail.login(email_addr, imap_password)
        except imaplib.IMAP4.error as exc:
            return {
                'success': False,
                'success_count': 0,
                'failed_count': len(items or []),
                'deleted_ids': [],
                'updated_ids': [],
                'errors': [build_error_payload(
                    'IMAP_AUTH_FAILED',
                    normalize_imap_auth_error(provider, imap_host, str(exc)),
                    'IMAPAuthError',
                    401,
                    ''
                )],
            }

        send_imap_id(mail, provider, imap_host)
        return delete_email_items_imap(mail, items, provider, default_mode='uid')
    except Exception as exc:
        return {
            'success': False,
            'success_count': 0,
            'failed_count': len(items or []),
            'deleted_ids': [],
            'updated_ids': [],
            'errors': [build_error_payload('IMAP_CONNECT_FAILED', sanitize_error_details(str(exc)) or 'IMAP connection failed', 'IMAPConnectError', 502, '')],
        }
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


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
                    'IMAP folder does not exist or does not have access rights',
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

        selected_exists = 0
        for attempt in reversed(folder_diagnostics.get('select_attempts') or []):
            if str(attempt.get('status') or '') == 'OK':
                selected_exists = extract_imap_exists_count(attempt.get('response'))
                if selected_exists > 0:
                    break

        message_ids, search_mode, search_attempts = search_imap_message_ids(mail)
        if message_ids is None:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_SEARCH_FAILED',
                    'IMAP search for mail failed',
                    'IMAPSearchError',
                    502,
                    {'attempts': search_attempts[:10]}
                ),
                'error_code': 'IMAP_SEARCH_FAILED'
            }

        if not message_ids and selected_exists > 0:
            message_ids = build_sequence_message_ids(selected_exists)
            search_mode = 'sequence'

        if not message_ids:
            return {'success': True, 'emails': [], 'method': 'IMAP (Generic)', 'has_more': False}

        total = len(message_ids)
        start_idx = max(0, total - skip - top)
        end_idx = total - skip
        if start_idx >= end_idx:
            return {'success': True, 'emails': [], 'method': 'IMAP (Generic)', 'has_more': False}

        paged_uids = message_ids[start_idx:end_idx][::-1]
        emails_data = []
        for uid in paged_uids:
            try:
                f_status, f_data, fetch_mode, _fetch_attempts = fetch_imap_message(
                    mail, uid, '(FLAGS INTERNALDATE RFC822)', preferred_mode=search_mode or 'uid'
                )
                if f_status != 'OK' or not f_data:
                    continue
                raw_email, fetch_response_text = parse_imap_fetch_response(f_data)
                if not raw_email:
                    continue
                internal_date = extract_imap_internaldate(fetch_response_text)

                msg = email.message_from_bytes(raw_email)
                body_text, body_html = extract_text_and_html(msg)
                preview_source = body_text or strip_html_content(body_html)
                preview = preview_source[:200] + ('...' if len(preview_source) > 200 else '')
                emails_data.append({
                    'id': uid.decode('utf-8', errors='ignore') if isinstance(uid, (bytes, bytearray)) else str(uid),
                    'subject': decode_header_value(msg.get('Subject', 'No topic')),
                    'from': decode_header_value(msg.get('From', 'Unknown')),
                    'to': decode_header_value(msg.get('To', '')),
                    'date': internal_date or msg.get('Date', ''),
                    'id_mode': search_mode or 'uid',
                    'is_read': bool(re.search(r'\\Seen\b', fetch_response_text, flags=re.IGNORECASE)),
                    'has_attachments': has_message_attachments(msg),
                    'body_preview': preview,
                })
            except Exception:
                continue

        emails_data.sort(key=lambda item: parse_email_datetime(item.get('date')) or datetime.min, reverse=True)
        return {
            'success': True,
            'emails': emails_data,
            'method': 'IMAP (Generic)',
            'has_more': start_idx > 0
        }
    except Exception as exc:
        return {
            'success': False,
            'error': build_mail_fetch_error(
                exc,
                proxy_url,
                'Fetch mail',
                legacy_code='IMAP_CONNECT_FAILED',
                legacy_message=sanitize_error_details(str(exc)) or 'IMAP connection failed',
                legacy_type='IMAPConnectError',
                legacy_status=502,
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
        return {'success': False, 'error': build_error_payload('EMAIL_DETAIL_INVALID', 'message_id cannot be empty', 'ValidationError', 400, '')}

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
                    'IMAP folder does not exist or does not have access rights',
                    'IMAPFolderError',
                    400,
                    {
                        'provider': provider,
                        'folder': folder,
                        **folder_diagnostics,
                    }
                )
            }

        status, msg_data, _fetch_mode, _fetch_attempts = fetch_imap_message(
            mail, str(message_id), '(RFC822)', preferred_mode='uid'
        )
        if status != 'OK' or not msg_data:
            return {
                'success': False,
                'error': build_error_payload(
                    'EMAIL_DETAIL_FETCH_FAILED',
                    'Failed to obtain email details',
                    'IMAPFetchError',
                    502,
                    {
                        'status': status,
                        'provider': provider,
                        'folder': selected,
                        'message_id': str(message_id),
                        'fetch_attempts': _fetch_attempts[:10],
                    }
                )
            }

        raw_email = None
        for item in msg_data:
            if isinstance(item, tuple) and len(item) >= 2:
                raw_email = item[1]
                break
        if not raw_email:
            return {
                'success': False,
                'error': build_error_payload(
                    'EMAIL_DETAIL_FETCH_FAILED',
                    'Failed to obtain email details',
                    'IMAPFetchError',
                    502,
                    {
                        'provider': provider,
                        'folder': selected,
                        'message_id': str(message_id),
                        'fetch_attempts': _fetch_attempts[:10],
                    }
                )
            }

        msg = email.message_from_bytes(raw_email)
        return {
            'success': True,
            'email': build_email_detail_from_message(msg, str(message_id))
        }
    except Exception as exc:
        return {'success': False, 'error': build_error_payload('IMAP_CONNECT_FAILED', sanitize_error_details(str(exc)) or 'IMAP connection failed', 'IMAPConnectError', 502, '')}
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


def download_email_attachment_imap_result(account: str, client_id: str, refresh_token: str, message_id: str,
                                          attachment_id: str, folder: str = 'inbox', proxy_url: str = None,
                                          fallback_proxy_urls: Optional[List[str]] = None,
                                          preferred_id_mode: str = 'uid') -> Dict[str, Any]:
    'Download email attachments using Outlook IMAP'
    access_token = get_access_token_imap(client_id, refresh_token, proxy_url, fallback_proxy_urls)
    if not access_token:
        return {
            'success': False,
            'error': build_error_payload(
                'IMAP_TOKEN_FAILED',
                'Failed to obtain access token',
                'IMAPError',
                401,
                ''
            )
        }

    connection = None
    try:
        with proxy_socket_context(proxy_url):
            connection = imaplib.IMAP4_SSL(IMAP_SERVER_NEW, IMAP_PORT, timeout=IMAP_TIMEOUT)
        auth_string = f"user={account}\1auth=Bearer {access_token}\1\1".encode('utf-8')
        connection.authenticate('XOAUTH2', lambda x: auth_string)

        selected_folder, _ = resolve_imap_folder(connection, 'outlook', folder, readonly=True)
        if not selected_folder:
            return {
                'success': False,
                'error': build_error_payload(
                    'IMAP_FOLDER_NOT_FOUND',
                    'IMAP folder does not exist or does not have access rights',
                    'IMAPFolderError',
                    400,
                    {'folder': folder}
                )
            }

        preferred_mode = str(preferred_id_mode or 'uid').strip().lower()
        if preferred_mode not in {'uid', 'sequence'}:
            preferred_mode = 'uid'
        status, msg_data, _fetch_mode, fetch_attempts = fetch_imap_message(
            connection,
            message_id,
            '(RFC822)',
            preferred_mode=preferred_mode,
        )
        if status != 'OK' or not msg_data:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_FETCH_FAILED',
                    'Failed to obtain attachment',
                    'IMAPFetchError',
                    502,
                    {'message_id': str(message_id), 'fetch_attempts': fetch_attempts[:10]}
                )
            }

        raw_email, _fetch_response_text = parse_imap_fetch_response(msg_data)
        if not raw_email:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_FETCH_FAILED',
                    'Failed to obtain attachment',
                    'IMAPFetchError',
                    502,
                    {'message_id': str(message_id), 'fetch_attempts': fetch_attempts[:10]}
                )
            }
        msg = email.message_from_bytes(raw_email)
        attachment = get_message_attachment_by_id(msg, attachment_id)
        if not attachment:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_NOT_FOUND',
                    'Attachment does not exist',
                    'NotFoundError',
                    404,
                    {'attachment_id': attachment_id}
                )
            }

        return {
            'success': True,
            'filename': attachment.get('name', 'attachment'),
            'content_type': attachment.get('content_type', 'application/octet-stream'),
            'content': attachment.get('content', b''),
        }
    except Exception as exc:
        return {
            'success': False,
            'error': build_error_payload(
                'ATTACHMENT_FETCH_FAILED',
                'Failed to obtain attachment',
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


def download_email_attachment_imap_generic_result(email_addr: str, imap_password: str, imap_host: str,
                                                  imap_port: int = 993, message_id: str = '',
                                                  attachment_id: str = '', folder: str = 'inbox',
                                                  provider: str = 'custom', proxy_url: str = '') -> Dict[str, Any]:
    'Download email attachments using Universal IMAP'
    if not message_id or not attachment_id:
        return {'success': False, 'error': build_error_payload('ATTACHMENT_INVALID', 'Attachment parameters are incomplete', 'ValidationError', 400, '')}

    mail = None
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

        send_imap_id(mail, provider, imap_host)
        selected, folder_diagnostics = resolve_imap_folder(mail, provider, folder, readonly=True)
        if not selected:
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
                    'IMAP folder does not exist or does not have access rights',
                    'IMAPFolderError',
                    400,
                    {
                        'provider': provider,
                        'folder': folder,
                        **folder_diagnostics,
                    }
                )
            }

        status, msg_data, _fetch_mode, fetch_attempts = fetch_imap_message(
            mail, str(message_id), '(RFC822)', preferred_mode='uid'
        )
        if status != 'OK' or not msg_data:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_FETCH_FAILED',
                    'Failed to obtain attachment',
                    'IMAPFetchError',
                    502,
                    {
                        'provider': provider,
                        'folder': selected,
                        'message_id': str(message_id),
                        'fetch_attempts': fetch_attempts[:10],
                    }
                )
            }

        raw_email = None
        for item in msg_data:
            if isinstance(item, tuple) and len(item) >= 2:
                raw_email = item[1]
                break
        if not raw_email:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_FETCH_FAILED',
                    'Failed to obtain attachment',
                    'IMAPFetchError',
                    502,
                    {
                        'provider': provider,
                        'folder': selected,
                        'message_id': str(message_id),
                    }
                )
            }

        msg = email.message_from_bytes(raw_email)
        attachment = get_message_attachment_by_id(msg, attachment_id)
        if not attachment:
            return {
                'success': False,
                'error': build_error_payload(
                    'ATTACHMENT_NOT_FOUND',
                    'Attachment does not exist',
                    'NotFoundError',
                    404,
                    {'attachment_id': attachment_id}
                )
            }

        return {
            'success': True,
            'filename': attachment.get('name', 'attachment'),
            'content_type': attachment.get('content_type', 'application/octet-stream'),
            'content': attachment.get('content', b''),
        }
    except Exception as exc:
        return {
            'success': False,
            'error': build_error_payload(
                'IMAP_CONNECT_FAILED',
                sanitize_error_details(str(exc)) or 'IMAP connection failed',
                'IMAPConnectError',
                502,
                ''
            )
        }
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


def parse_email_datetime(value: str) -> Optional[datetime]:
    'Compatible with old shared global names, the actual implementation is located at outlook_web.mail_datetime.'
    return parse_mail_datetime(value)


def login_required(f):
    'Login verification decorator'
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_web_login_session_valid():
            if session.get('logged_in'):
                clear_web_login_session()
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'success': False, 'error': 'Please log in first', 'need_login': True}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    decorated_function._requires_login = True
    return decorated_function


def normalize_api_key(value: Any) -> str:
    'Normalize API Key to ensure that the comparison input is a stable string.'
    return str(value or '').strip()


def api_key_required(f):
    'API Key verification decorator (for external API)'
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get API Key from Header or query parameters
        api_key = normalize_api_key(
            request.headers.get('X-API-Key')
            or request.args.get('api_key')
            or request.args.get('apikey')
        )
        if not api_key:
            return jsonify({'success': False, 'error': 'API Key is missing, please provide it through Header X-API-Key or query parameter api_key'}), 401

        # Verify API Key
        stored_key = normalize_api_key(get_external_api_key())
        if not stored_key:
            return jsonify({'success': False, 'error': 'The external API Key is not configured, please configure it in the system settings.'}), 403

        if not secrets.compare_digest(api_key, stored_key):
            return jsonify({'success': False, 'error': 'API Key is invalid'}), 401

        return f(*args, **kwargs)
    decorated_function._requires_api_key = True
    return decorated_function


def assert_endpoint_protection(endpoint: str, protection_attr: str, protection_name: str):
    'Ensure that the dynamically replaced endpoint still retains necessary authentication protection.'
    view_func = app.view_functions.get(endpoint)
    if view_func is None:
        raise RuntimeError(f'Endpoint not registered: {endpoint}')
    if not getattr(view_func, protection_attr, False):
        raise RuntimeError(f'Endpoint {endpoint} lacks {protection_name} protection')


# ==================== Flask routing ====================
