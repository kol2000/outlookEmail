from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    # These segmented files are executed into the shared `web_outlook_app`
    # globals at runtime. Importing from the assembled module keeps IDE
    # inspections from flagging the shared names as unresolved.
    from web_outlook_app import *  # noqa: F403


# ==================== GPTMail temporary mailbox API ====================

def gptmail_request(method: str, endpoint: str, params: dict = None, json_data: dict = None) -> Optional[Dict]:
    'Send GPTMail API request'
    try:
        url = f"{GPTMAIL_BASE_URL}{endpoint}"
        # Get API Key from database
        api_key = get_gptmail_api_key()
        headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        }
        
        if method.upper() == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=30)
        elif method.upper() == 'POST':
            response = requests.post(url, headers=headers, json=json_data, timeout=30)
        elif method.upper() == 'DELETE':
            response = requests.delete(url, headers=headers, params=params, timeout=30)
        else:
            return None
        
        if response.status_code == 200:
            return response.json()
        else:
            return {'success': False, 'error': f'API request failed: {response.status_code}'}
    except Exception as e:
        return {'success': False, 'error': f'Request exception: {str(e)}'}


def generate_temp_email(prefix: str = None, domain: str = None) -> Optional[str]:
    'Generate temporary email address'
    json_data = {}
    if prefix:
        json_data['prefix'] = prefix
    if domain:
        json_data['domain'] = domain
    
    if json_data:
        result = gptmail_request('POST', '/api/generate-email', json_data=json_data)
    else:
        result = gptmail_request('GET', '/api/generate-email')
    
    if result and result.get('success'):
        return result.get('data', {}).get('email')
    return None


def get_temp_emails_from_api(email_addr: str) -> Optional[List[Dict]]:
    'Get mailing list from GPTMail API'
    result = gptmail_request('GET', '/api/emails', params={'email': email_addr})
    
    if result and result.get('success'):
        return result.get('data', {}).get('emails', [])
    return None


def get_temp_email_detail_from_api(message_id: str) -> Optional[Dict]:
    'Get email details from GPTMail API'
    result = gptmail_request('GET', f'/api/email/{message_id}')
    
    if result and result.get('success'):
        return result.get('data')
    return None


def delete_temp_email_from_api(message_id: str) -> bool:
    'Delete messages from GPTMail API'
    result = gptmail_request('DELETE', f'/api/email/{message_id}')
    return result and result.get('success', False)


def clear_temp_emails_from_api(email_addr: str) -> bool:
    'Clear all emails in GPTMail mailbox'
    result = gptmail_request('DELETE', '/api/emails/clear', params={'email': email_addr})
    return result and result.get('success', False)


# ==================== Cloudflare Temp Email API ====================

def get_cloudflare_channel_for_request(channel: Optional[Dict[str, Any]] = None,
                                       include_disabled: bool = False) -> Optional[Dict[str, Any]]:
    if channel and channel.get('id'):
        return get_cloudflare_channel_by_id(
            channel.get('id'),
            include_disabled=include_disabled,
            include_secret=True,
        )
    return get_default_cloudflare_channel(include_disabled=include_disabled, include_secret=True)


def get_cloudflare_channel_for_temp_email(temp_email: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not temp_email or temp_email.get('provider') != 'cloudflare':
        return None
    channel_id = temp_email.get('cloudflare_channel_id')
    if channel_id:
        return get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
    return get_default_cloudflare_channel(include_disabled=True, include_secret=True)


def cloudflare_temp_request(method: str, endpoint: str, jwt: str = None,
                            admin_auth: bool = False, params: dict = None,
                            json_data: dict = None,
                            channel: Optional[Dict[str, Any]] = None) -> Optional[Dict]:
    'Send Cloudflare Temp Email API request'
    request_channel = get_cloudflare_channel_for_request(channel, include_disabled=True)
    worker_domain = (
        request_channel.get('worker_domain', '').strip()
        if request_channel
        else get_cloudflare_worker_domain().strip()
    )
    if not worker_domain:
        return {'success': False, 'error': 'Cloudflare Worker domain name not configured'}

    try:
        url = f"https://{worker_domain}{endpoint}"
        headers = {"Content-Type": "application/json"}

        if jwt:
            headers["Authorization"] = f"Bearer {jwt}"
        if admin_auth:
            admin_password = (
                decrypt_data(request_channel.get('admin_password', '')).strip()
                if request_channel
                else get_cloudflare_admin_password().strip()
            )
            if not admin_password:
                return {'success': False, 'error': 'Cloudflare admin password not configured'}
            headers["x-admin-auth"] = admin_password

        if method.upper() == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=30)
        elif method.upper() == 'POST':
            response = requests.post(url, headers=headers, params=params, json=json_data, timeout=30)
        elif method.upper() == 'DELETE':
            response = requests.delete(url, headers=headers, params=params, timeout=30)
        else:
            return {'success': False, 'error': 'Unsupported request method'}

        if response.status_code in (200, 201):
            try:
                return response.json()
            except Exception:
                return {'success': False, 'error': 'Cloudflare API response is not valid JSON'}
        if response.status_code == 204:
            return {'success': True}

        try:
            error_data = response.json()
            error_message = error_data.get('message') or error_data.get('error') or response.text
        except Exception:
            error_message = response.text or f'API request failed: {response.status_code}'
        return {'success': False, 'error': error_message}
    except Exception as e:
        return {'success': False, 'error': f'Request exception: {str(e)}'}


def cloudflare_get_domains(channel: Optional[Dict[str, Any]] = None) -> tuple[List[str], Optional[str]]:
    'Get the list of available domain names for Cloudflare Temp Email'
    request_channel = get_cloudflare_channel_for_request(
        channel,
        include_disabled=bool(channel),
    )
    if request_channel:
        if not request_channel.get('enabled'):
            return [], 'Cloudflare channel is not available'
        domains = request_channel.get('email_domains', [])
    else:
        domains = get_cloudflare_email_domains()
    if domains:
        return domains, None
    if request_channel:
        return [], None
    return [], 'Cloudflare email domain name is not configured, please fill it in the settings'


def cloudflare_create_address(username: str = None, domain: str = None,
                              channel: Optional[Dict[str, Any]] = None) -> Optional[Dict]:
    'Create a Cloudflare Temp Email address'
    request_channel = get_cloudflare_channel_for_request(channel)
    if not request_channel:
        return {'success': False, 'error': 'Please configure Cloudflare channel first'}
    if not request_channel.get('enabled'):
        return {'success': False, 'error': 'Cloudflare channel is not available and mailbox cannot be created'}

    domains = request_channel.get('email_domains', [])
    selected_domain = domain or (domains[0] if domains else None)
    if not selected_domain:
        return {'success': False, 'error': 'No available domain name is configured'}
    if selected_domain.strip().lower().lstrip('@').rstrip('.') not in domains:
        return {'success': False, 'error': 'The selected domain is not part of the current Cloudflare channel'}

    email_name = username or generate_random_temp_name()
    last_error: Optional[Dict] = None

    for candidate_domain in build_cloudflare_domain_candidates(selected_domain):
        payload = {
            'enablePrefix': True,
            'name': email_name,
            'domain': candidate_domain
        }
        result = cloudflare_temp_request(
            'POST',
            '/admin/new_address',
            admin_auth=True,
            json_data=payload,
            channel=request_channel,
        )
        if result and result.get('jwt') and result.get('address'):
            return result

        last_error = result
        error_text = str((result or {}).get('error', '')).lower()
        if 'invalid domain' not in error_text:
            break

    if last_error and 'invalid domain' in str(last_error.get('error', '')).lower():
        last_error['error'] = (
            f"{last_error.get('error')}, please confirm that the domain name has been configured to DOMAINS/DEFAULT_DOMAINS of cloudflare_temp_email, and if you use a subdomain name to receive emails, the subdomain mailbox configuration has been completed according to the official document"
        )
    return last_error


CLOUDFLARE_BATCH_GENERATE_MAX_COUNT = 50
CLOUDFLARE_AI_USERNAME_MIN_LENGTH = 3
CLOUDFLARE_AI_USERNAME_MAX_LENGTH = 32
CLOUDFLARE_AI_USERNAME_ALLOWED_RE = re.compile(r'^[A-Za-z0-9._@+-]+$')
CLOUDFLARE_AI_USERNAME_RESERVED_WORDS = {
    'sure',
    'yes',
    'ok',
    'okay',
    'username',
    'usernames',
    'name',
    'names',
    'prefix',
    'prefixes',
    'json',
    'array',
    'list',
}


def normalize_cloudflare_batch_count(value: Any) -> Optional[int]:
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    if count < 1 or count > CLOUDFLARE_BATCH_GENERATE_MAX_COUNT:
        return None
    return count


def normalize_cloudflare_ai_endpoint(api_url: str) -> str:
    normalized = str(api_url or '').strip().rstrip('/')
    if not normalized:
        return ''
    if normalized.endswith('/chat/completions'):
        return normalized
    return f'{normalized}/chat/completions'


def sanitize_cloudflare_username_candidate(value: Any) -> str:
    candidate = str(value or '').strip().lower()
    if not candidate:
        return ''
    if '@' in candidate:
        candidate = candidate.split('@', 1)[0]
    candidate = re.sub(r'[^a-z0-9]', '', candidate)
    if len(candidate) < CLOUDFLARE_AI_USERNAME_MIN_LENGTH:
        return ''
    if candidate in CLOUDFLARE_AI_USERNAME_RESERVED_WORDS:
        return ''
    return candidate[:CLOUDFLARE_AI_USERNAME_MAX_LENGTH]


def is_plausible_cloudflare_ai_username_fragment(value: str) -> bool:
    fragment = str(value or '').strip().strip('"\'`')
    if not fragment:
        return False
    if len(fragment) > 80:
        return False
    if re.search(r'\s', fragment):
        return False
    if ':' in fragment:
        return False
    if not CLOUDFLARE_AI_USERNAME_ALLOWED_RE.match(fragment):
        return False
    return bool(sanitize_cloudflare_username_candidate(fragment))


def normalize_cloudflare_ai_username_list_item(value: str) -> str:
    item = re.sub(r'^\s*(?:[-*]|\d+[.)])\s*', '', str(value or '')).strip()
    return item.strip().strip('"\'`').strip()


def extract_ai_username_values(value: Any) -> List[str]:
    if isinstance(value, list):
        results: List[str] = []
        for item in value:
            results.extend(extract_ai_username_values(item))
        return results
    if isinstance(value, dict):
        for key in ('usernames', 'names', 'prefixes', 'data'):
            if key in value:
                return extract_ai_username_values(value[key])
        return []
    return [str(value)]


def parse_cloudflare_ai_username_content(content: str) -> List[str]:
    text = str(content or '').strip()
    if not text:
        return []

    cleaned_text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.IGNORECASE | re.MULTILINE).strip()
    json_candidates = [cleaned_text]
    array_match = re.search(r'\[[\s\S]*\]', cleaned_text)
    if array_match:
        json_candidates.insert(0, array_match.group(0))

    for candidate in json_candidates:
        try:
            parsed = json.loads(candidate)
            values = extract_ai_username_values(parsed)
            if values:
                return values
        except Exception:
            continue

    quoted_items = re.findall(r'["\']([^"\']+)["\']', cleaned_text)
    if quoted_items:
        return quoted_items

    items = []
    for part in re.split(r'[\n,;]+', cleaned_text):
        item = normalize_cloudflare_ai_username_list_item(part)
        if is_plausible_cloudflare_ai_username_fragment(item):
            items.append(item)
    return items


def clean_cloudflare_ai_usernames(values: List[Any], limit: Optional[int] = None) -> List[str]:
    usernames: List[str] = []
    seen = set()
    for value in values:
        username = sanitize_cloudflare_username_candidate(value)
        if not username or username in seen:
            continue
        seen.add(username)
        usernames.append(username)
        if limit and len(usernames) >= limit:
            break
    return usernames


def normalize_cloudflare_explicit_usernames(values: Any, expected_count: int) -> Dict[str, Any]:
    if values is None:
        return {'success': True, 'usernames': [], 'provided': False}
    if not isinstance(values, list):
        return {'success': False, 'error': 'The username list format is invalid'}

    usernames: List[str] = []
    seen = set()
    has_non_empty_value = False
    for index, value in enumerate(values):
        raw_value = str(value or '').strip()
        if not raw_value:
            continue
        has_non_empty_value = True
        username = sanitize_cloudflare_username_candidate(raw_value)
        if not username:
            return {'success': False, 'error': f'The {index + 1} username format is invalid'}
        if username in seen:
            return {'success': False, 'error': 'Username cannot be repeated'}
        seen.add(username)
        usernames.append(username)

    if not has_non_empty_value:
        return {'success': True, 'usernames': [], 'provided': False}
    if len(usernames) != expected_count:
        return {'success': False, 'error': f'The number of usernames must equal {expected_count}'}
    return {'success': True, 'usernames': usernames, 'provided': True}


def validate_strict_cloudflare_ai_username_result(result: Dict[str, Any], expected_count: int) -> Dict[str, Any]:
    raw_usernames = result.get('raw_usernames')
    if raw_usernames is None:
        raw_usernames = result.get('usernames', [])
    if not isinstance(raw_usernames, list):
        return {'success': False, 'error': 'AI username generation response missing username list'}

    raw_count = len(raw_usernames)
    if raw_count != expected_count:
        return {
            'success': False,
            'error': f'The number of user names returned by AI is {raw_count}, which must be equal to {expected_count}',
        }

    usernames = clean_cloudflare_ai_usernames(raw_usernames)
    if len(usernames) != expected_count:
        return {
            'success': False,
            'error': f'The number of user names after AI cleaning is {len(usernames)}, which must be equal to {expected_count}',
        }
    return {'success': True, 'usernames': usernames}


def build_cloudflare_ai_username_config(data: Optional[Dict[str, Any]] = None,
                                        use_saved_secret: bool = True) -> Dict[str, Any]:
    source = data or {}
    api_key_provided = 'api_key' in source or 'cloudflare_ai_username_api_key' in source
    api_key = (
        source.get('api_key')
        if 'api_key' in source
        else source.get('cloudflare_ai_username_api_key')
    )
    if not api_key_provided and use_saved_secret:
        api_key = get_setting_decrypted('cloudflare_ai_username_api_key', '')

    return {
        'enabled': str(
            source.get(
                'enabled',
                source.get(
                    'cloudflare_ai_username_enabled',
                    get_setting('cloudflare_ai_username_enabled', 'false'),
                )
            )
        ).strip().lower() in {'1', 'true', 'yes', 'on'},
        'api_url': str(
            source.get(
                'api_url',
                source.get(
                    'cloudflare_ai_username_api_url',
                    get_setting('cloudflare_ai_username_api_url', ''),
                )
            ) or ''
        ).strip(),
        'model': str(
            source.get(
                'model',
                source.get(
                    'cloudflare_ai_username_model',
                    get_setting('cloudflare_ai_username_model', ''),
                )
            ) or ''
        ).strip(),
        'api_key': str(api_key or '').strip(),
        'prompt': str(
            source.get(
                'prompt',
                source.get(
                    'cloudflare_ai_username_prompt',
                    get_setting(
                        'cloudflare_ai_username_prompt',
                        CLOUDFLARE_AI_USERNAME_DEFAULT_PROMPT,
                    ),
                )
            ) or CLOUDFLARE_AI_USERNAME_DEFAULT_PROMPT
        ).strip(),
    }


def validate_cloudflare_ai_username_config(config: Dict[str, Any]) -> Optional[str]:
    missing = []
    if not config.get('api_url'):
        missing.append('AI API address')
    if not config.get('model'):
        missing.append('AI model')
    if not config.get('api_key'):
        missing.append('AI API Key')
    if missing:
        return 'Missing' + '、'.join(missing)
    return None


def request_cloudflare_ai_usernames(config: Dict[str, Any], count: int,
                                    seed: str = '') -> Dict[str, Any]:
    error = validate_cloudflare_ai_username_config(config)
    if error:
        return {'success': False, 'error': error, 'usernames': []}

    normalized_count = normalize_cloudflare_batch_count(count) or 1
    request_seed = seed or generate_trace_id()[:12]
    prompt = str(config.get('prompt') or CLOUDFLARE_AI_USERNAME_DEFAULT_PROMPT)
    prompt = prompt.replace('{count}', str(normalized_count)).replace('{seed}', request_seed)
    url = normalize_cloudflare_ai_endpoint(config.get('api_url', ''))
    payload = {
        'model': config.get('model'),
        'messages': [
            {
                'role': 'system',
                'content': 'Return only a JSON array of email username prefixes. Do not include domains.',
            },
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.7,
    }

    try:
        response = requests.post(
            url,
            headers={
                'Authorization': f"Bearer {config.get('api_key')}",
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=30,
        )
    except Exception as exc:
        return {'success': False, 'error': f'AI username generation request failed: {exc}', 'usernames': []}

    if response.status_code >= 400:
        return {
            'success': False,
            'error': f"AI username generation failed: HTTP {response.status_code} {getattr(response, 'text', '')[:120]}".strip(),
            'usernames': [],
        }

    try:
        data = response.json()
    except Exception as exc:
        return {'success': False, 'error': f'AI username generated response is not valid JSON: {exc}', 'usernames': []}

    choices = data.get('choices') if isinstance(data, dict) else None
    content = ''
    if choices:
        first_choice = choices[0] or {}
        message = first_choice.get('message') or {}
        content = message.get('content') or first_choice.get('text') or ''
    elif isinstance(data, dict):
        direct_values = extract_ai_username_values(data)
        if direct_values:
            usernames = clean_cloudflare_ai_usernames(direct_values)
            if usernames:
                return {'success': True, 'usernames': usernames, 'raw_usernames': direct_values, 'seed': request_seed}
        return {'success': False, 'error': 'AI username generation response missing username list', 'usernames': []}
    else:
        content = str(data)

    parsed_usernames = parse_cloudflare_ai_username_content(content)
    usernames = clean_cloudflare_ai_usernames(
        parsed_usernames,
    )
    if not usernames:
        return {'success': False, 'error': 'AI username generation result is empty or unavailable', 'usernames': []}
    return {'success': True, 'usernames': usernames, 'raw_usernames': parsed_usernames, 'seed': request_seed}


def normalize_cloudflare_admin_mail_limit(value: Any, default: int = 50, maximum: int = 100) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, maximum))


def normalize_cloudflare_admin_mail_offset(value: Any) -> int:
    try:
        offset = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, offset)


def cloudflare_get_admin_messages(limit: int = 50, offset: int = 0, address: str = '',
                                  channel: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    'Get the global mailing list through the Cloudflare admin interface'
    params = {'limit': limit, 'offset': offset}
    if address:
        params['address'] = address

    result = cloudflare_temp_request('GET', '/admin/mails', admin_auth=True, params=params, channel=channel)
    if not result:
        return {'success': False, 'error': 'Failed to get Cloudflare global mail'}
    if isinstance(result, list):
        return {'success': True, 'messages': result, 'count': len(result)}
    if not isinstance(result, dict):
        return {'success': False, 'error': 'Cloudflare API response format is not supported'}
    if result.get('success') is False:
        return {'success': False, 'error': result.get('error', 'Failed to get Cloudflare global mail')}

    if isinstance(result.get('results'), list):
        messages = result['results']
    elif isinstance(result.get('mails'), list):
        messages = result['mails']
    elif isinstance(result.get('emails'), list):
        messages = result['emails']
    elif isinstance(result.get('data'), dict) and isinstance(result['data'].get('results'), list):
        messages = result['data']['results']
    elif isinstance(result.get('data'), list):
        messages = result['data']
    else:
        return {'success': False, 'error': 'Cloudflare API response missing mailing list'}

    count = result.get('count')
    if count is None and isinstance(result.get('data'), dict):
        count = result['data'].get('count')
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = len(messages)

    return {'success': True, 'messages': messages, 'count': count}


def cloudflare_get_admin_addresses(limit: int = 100, offset: int = 0, query: str = '',
                                   channel: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    'Get the address list through the Cloudflare admin interface.'
    params = {'limit': limit, 'offset': offset}
    if query:
        params['query'] = query
    result = cloudflare_temp_request(
        'GET',
        '/admin/address',
        admin_auth=True,
        params=params,
        channel=channel,
    )
    if not result:
        return {'success': False, 'error': 'Failed to obtain Cloudflare address list'}
    if isinstance(result, list):
        return {'success': True, 'addresses': result, 'count': len(result)}
    if not isinstance(result, dict):
        return {'success': False, 'error': 'Cloudflare API response format is not supported'}
    if result.get('success') is False:
        return {'success': False, 'error': result.get('error', 'Failed to obtain Cloudflare address list')}

    if isinstance(result.get('results'), list):
        addresses = result['results']
    elif isinstance(result.get('addresses'), list):
        addresses = result['addresses']
    elif isinstance(result.get('data'), dict) and isinstance(result['data'].get('results'), list):
        addresses = result['data']['results']
    elif isinstance(result.get('data'), list):
        addresses = result['data']
    else:
        return {'success': False, 'error': 'Cloudflare API response is missing address list'}

    count = result.get('count')
    if count is None and isinstance(result.get('data'), dict):
        count = result['data'].get('count')
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = len(addresses)

    return {'success': True, 'addresses': addresses, 'count': count}


def normalize_cloudflare_address_item(item: Any) -> tuple[str, Optional[str]]:
    if isinstance(item, str):
        return normalize_email_address(item), None
    if not isinstance(item, dict):
        return '', None
    email_addr = normalize_email_address(
        item.get('name') or item.get('address') or item.get('email') or item.get('email_address') or ''
    )
    address_id = item.get('id') or item.get('address_id')
    return email_addr, str(address_id).strip() if address_id not in (None, '') else None


def parse_cloudflare_mail_timestamp(item: Dict[str, Any]) -> int:
    for key in ('created_at', 'createdAt', 'date', 'timestamp'):
        raw_value = item.get(key)
        if not raw_value:
            continue
        if isinstance(raw_value, (int, float)):
            return int(raw_value)
        try:
            return int(datetime.fromisoformat(str(raw_value).replace('Z', '+00:00')).timestamp())
        except Exception:
            continue
    return 0


def get_cloudflare_mail_recipient(item: Dict[str, Any], fallback_address: str = '') -> str:
    for key in ('address', 'to', 'recipient', 'email_address'):
        value = str(item.get(key, '') or '').strip()
        if value:
            return value
    return fallback_address


def normalize_cloudflare_admin_mail_item(item: Dict[str, Any], index: int,
                                         fallback_address: str = '') -> Optional[Dict[str, Any]]:
    raw_email = item.get('raw') or item.get('raw_content') or item.get('source_raw')
    if not raw_email:
        return None

    recipient = get_cloudflare_mail_recipient(item, fallback_address)
    raw_text = raw_email if isinstance(raw_email, str) else raw_email.decode('utf-8', 'replace')
    upstream_id = item.get('id') or item.get('mail_id')
    fallback_id = (
        f"cf-admin-{upstream_id}"
        if upstream_id
        else f"cf-admin-{index}-{hashlib.sha256(raw_text.encode('utf-8', 'replace')).hexdigest()}"
    )
    parsed = parse_raw_email_to_temp_message(
        recipient or fallback_address or 'cloudflare-admin',
        raw_text,
        fallback_id,
        parse_cloudflare_mail_timestamp(item)
    )
    body = parsed.get('html_content') if parsed.get('has_html') else parsed.get('content', '')
    return {
        'id': parsed.get('id'),
        'message_id': item.get('message_id') or parsed.get('id'),
        'upstream_id': upstream_id,
        'from': parsed.get('from_address', item.get('source') or 'Unknown'),
        'to': recipient,
        'subject': parsed.get('subject', 'No topic'),
        'body_preview': (parsed.get('content', '') or '')[:200],
        'body': body,
        'body_type': 'html' if parsed.get('has_html') else 'text',
        'date': parsed.get('timestamp', 0),
        'timestamp': parsed.get('timestamp', 0),
        'has_html': 1 if parsed.get('has_html') else 0,
        'folder': 'cloudflare',
        'provider': 'cloudflare',
    }


def format_cloudflare_admin_messages(messages: List[Dict[str, Any]], fallback_address: str = '') -> List[Dict[str, Any]]:
    formatted = []
    for index, item in enumerate(messages):
        if not isinstance(item, dict):
            continue
        normalized = normalize_cloudflare_admin_mail_item(item, index, fallback_address)
        if normalized:
            formatted.append(normalized)
    return formatted


def parse_cloudflare_temp_messages(email_addr: str, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unified_messages = []
    for index, item in enumerate(messages or []):
        if not isinstance(item, dict):
            continue
        raw_email = item.get('raw') or item.get('raw_content') or item.get('source_raw')
        if not raw_email:
            continue
        raw_text = raw_email if isinstance(raw_email, str) else raw_email.decode('utf-8', 'replace')
        upstream_id = item.get('id') or item.get('mail_id')
        fallback_id = (
            str(upstream_id)
            if upstream_id
            else f"{email_addr}-{index}-{hashlib.sha256(raw_text.encode('utf-8', 'replace')).hexdigest()}"
        )
        unified_messages.append(
            parse_raw_email_to_temp_message(
                email_addr,
                raw_text,
                fallback_id,
                parse_cloudflare_mail_timestamp(item),
            )
        )
    return unified_messages


def fetch_cloudflare_temp_messages(email_addr: str, temp_email: Optional[Dict[str, Any]],
                                   limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    'Obtain Cloudflare temporary mailbox emails through the administrator interface'
    channel = get_cloudflare_channel_for_temp_email(temp_email)
    if not channel:
        return {'success': False, 'error': 'Cloudflare channel attribution does not exist, please re-import or create a mailbox'}

    admin_result = cloudflare_get_admin_messages(
        limit=limit,
        offset=offset,
        address=email_addr,
        channel=channel,
    )
    if not admin_result.get('success'):
        return {'success': False, 'error': admin_result.get('error', 'Failed to get Cloudflare email')}
    return {
        'success': True,
        'messages': parse_cloudflare_temp_messages(email_addr, admin_result.get('messages', [])),
        'method': 'Cloudflare Admin',
    }


def cloudflare_delete_address(address_id: str, channel: Optional[Dict[str, Any]] = None) -> bool:
    'Delete Cloudflare Temp Email address'
    if not address_id:
        return False
    result = cloudflare_temp_request(
        'DELETE',
        f'/admin/delete_address/{quote(str(address_id))}',
        admin_auth=True,
        channel=channel,
    )
    return result is not None and result.get('success', False)


def cloudflare_delete_address_by_email(email_addr: str, channel: Optional[Dict[str, Any]] = None) -> bool:
    normalized_email = normalize_email_address(email_addr)
    if not normalized_email:
        return False
    result = cloudflare_get_admin_addresses(limit=20, offset=0, query=normalized_email, channel=channel)
    if not result.get('success'):
        return False
    for item in result.get('addresses') or []:
        item_email, address_id = normalize_cloudflare_address_item(item)
        if item_email == normalized_email and address_id:
            return cloudflare_delete_address(address_id, channel=channel)
    return False


# ==================== DuckMail temporary mailbox API ====================

def duckmail_request(method: str, endpoint: str, token: str = None,
                     json_data: dict = None, params: dict = None) -> Optional[Dict]:
    'Send DuckMail API request'
    try:
        base_url = get_duckmail_base_url().rstrip('/')
        url = f"{base_url}{endpoint}"
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        if method.upper() == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=30)
        elif method.upper() == 'POST':
            response = requests.post(url, headers=headers, json=json_data, timeout=30)
        elif method.upper() == 'PATCH':
            response = requests.patch(url, headers=headers, json=json_data, timeout=30)
        elif method.upper() == 'DELETE':
            response = requests.delete(url, headers=headers, params=params, timeout=30)
        else:
            return None

        if response.status_code == 204:
            return {'success': True}
        elif response.status_code in (200, 201):
            return response.json()
        else:
            try:
                err = response.json()
                return {'success': False, 'error': err.get('message', f'API request failed: {response.status_code}')}
            except Exception:
                return {'success': False, 'error': f'API request failed: {response.status_code}'}
    except Exception as e:
        return {'success': False, 'error': f'Request exception: {str(e)}'}


def duckmail_get_domains() -> tuple:
    'Get the list of domain names available for DuckMail, return (domains_list, error_msg)'
    api_key = get_duckmail_api_key()
    token = api_key if api_key else None
    result = duckmail_request('GET', '/domains', token=token)
    if result and 'hydra:member' in result:
        domains = [d for d in result['hydra:member'] if d.get('isVerified', False)]
        return domains, None
    error = result.get('error', 'Failed to obtain domain name') if result else 'Unable to connect to DuckMail API'
    return [], error


def duckmail_create_account(address: str, password: str) -> Optional[Dict]:
    'Create a DuckMail email account and return account information'
    api_key = get_duckmail_api_key()
    token = api_key if api_key else None
    result = duckmail_request('POST', '/accounts', token=token,
                              json_data={'address': address, 'password': password})
    if result and result.get('id'):
        return result
    return result  # Return error message


def duckmail_get_token(address: str, password: str) -> Optional[Dict]:
    'Get DuckMail Bearer Token'
    result = duckmail_request('POST', '/token',
                              json_data={'address': address, 'password': password})
    if result and result.get('token'):
        return result
    return result


def duckmail_get_messages(token: str, page: int = 1) -> Optional[List[Dict]]:
    'Get the DuckMail mailing list'
    result = duckmail_request('GET', '/messages', token=token, params={'page': page})
    if result and 'hydra:member' in result:
        return result['hydra:member']
    return None


def duckmail_get_message_detail(token: str, message_id: str) -> Optional[Dict]:
    'Get DuckMail email details (including body)'
    result = duckmail_request('GET', f'/messages/{message_id}', token=token)
    if result and result.get('id'):
        return result
    return None


def duckmail_delete_message(token: str, message_id: str) -> bool:
    'Delete DuckMail messages'
    result = duckmail_request('DELETE', f'/messages/{message_id}', token=token)
    return result is not None and result.get('success', False)


def duckmail_delete_account(token: str, account_id: str) -> bool:
    'Delete DuckMail account'
    result = duckmail_request('DELETE', f'/accounts/{account_id}', token=token)
    return result is not None and result.get('success', False)


def duckmail_refresh_token(email_addr: str) -> Optional[str]:
    'Refresh DuckMail Token (retrieve using stored password)'
    temp_email = get_temp_email_by_address(email_addr)
    if not temp_email or temp_email.get('provider') != 'duckmail':
        return None

    password = temp_email.get('duckmail_password', '')
    if password:
        password = decrypt_data(password)

    if not password:
        return None

    result = duckmail_get_token(email_addr, password)
    if result and result.get('token'):
        new_token = result['token']
        # Update Token in the database
        db = get_db()
        db.execute('UPDATE temp_emails SET duckmail_token = ? WHERE email = ?',
                   (encrypt_data(new_token), email_addr))
        db.commit()
        return new_token
    return None


def get_duckmail_token_for_email(email_addr: str) -> Optional[str]:
    'Obtain the DuckMail Token of the temporary mailbox, and it will be automatically refreshed when it expires.'
    temp_email = get_temp_email_by_address(email_addr)
    if not temp_email or temp_email.get('provider') != 'duckmail':
        return None

    token = temp_email.get('duckmail_token', '')
    if token:
        token = decrypt_data(token)

    if not token:
        # Token does not exist, try to refresh
        token = duckmail_refresh_token(email_addr)

    return token


# ==================== Temporary mailbox database operations ====================

def normalize_cloudflare_channel_domains(value: Any) -> List[str]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r'[,\n]', str(value or ''))

    domains: List[str] = []
    seen = set()
    for item in raw_items:
        domain = str(item or '').strip().lower().lstrip('@').rstrip('.')
        if not domain or domain in seen:
            continue
        domains.append(domain)
        seen.add(domain)
    return domains


def serialize_cloudflare_channel_domains(value: Any) -> str:
    return ', '.join(normalize_cloudflare_channel_domains(value))


def get_cloudflare_channel_reference_count(channel_id: int) -> int:
    db = get_db()
    row = db.execute(
        '''
        SELECT COUNT(*) AS count
        FROM temp_emails
        WHERE provider = 'cloudflare' AND cloudflare_channel_id = ?
        ''',
        (channel_id,)
    ).fetchone()
    return int(row['count']) if row else 0


def format_cloudflare_channel(row: Any, include_secret: bool = False) -> Dict[str, Any]:
    item = dict(row)
    admin_password = item.get('admin_password', '') or ''
    formatted = {
        'id': item.get('id'),
        'name': item.get('name', ''),
        'worker_domain': item.get('worker_domain', ''),
        'email_domains': normalize_cloudflare_channel_domains(item.get('email_domains', '')),
        'enabled': bool(item.get('enabled', 0)),
        'is_default': bool(item.get('is_default', 0)),
        'admin_password_configured': bool(admin_password),
        'reference_count': get_cloudflare_channel_reference_count(item.get('id')),
        'created_at': item.get('created_at', ''),
        'updated_at': item.get('updated_at', ''),
    }
    if include_secret:
        formatted['admin_password'] = admin_password
    return formatted


def list_cloudflare_channels(include_disabled: bool = False) -> List[Dict[str, Any]]:
    db = get_db()
    query = '''
        SELECT * FROM cloudflare_channels
    '''
    if not include_disabled:
        query += ' WHERE enabled = 1'
    query += ' ORDER BY is_default DESC, name COLLATE NOCASE, id'
    rows = db.execute(query).fetchall()
    return [format_cloudflare_channel(row) for row in rows]


def get_cloudflare_channel_by_id(channel_id: Any, include_disabled: bool = False,
                                 include_secret: bool = False) -> Optional[Dict[str, Any]]:
    try:
        normalized_id = int(channel_id)
    except (TypeError, ValueError):
        return None

    db = get_db()
    row = db.execute('SELECT * FROM cloudflare_channels WHERE id = ?', (normalized_id,)).fetchone()
    if not row:
        return None
    if not include_disabled and not bool(row['enabled']):
        return None
    return format_cloudflare_channel(row, include_secret=include_secret)


def get_cloudflare_channel_by_name(name: str, include_disabled: bool = False,
                                   include_secret: bool = False) -> Optional[Dict[str, Any]]:
    normalized_name = str(name or '').strip()
    if not normalized_name:
        return None

    db = get_db()
    row = db.execute(
        'SELECT * FROM cloudflare_channels WHERE LOWER(name) = LOWER(?)',
        (normalized_name,)
    ).fetchone()
    if not row:
        return None
    if not include_disabled and not bool(row['enabled']):
        return None
    return format_cloudflare_channel(row, include_secret=include_secret)


def get_default_cloudflare_channel(include_disabled: bool = False,
                                   include_secret: bool = False) -> Optional[Dict[str, Any]]:
    db = get_db()
    query = 'SELECT * FROM cloudflare_channels WHERE is_default = 1'
    if not include_disabled:
        query += ' AND enabled = 1'
    query += ' ORDER BY id LIMIT 1'
    row = db.execute(query).fetchone()
    if not row:
        return None
    return format_cloudflare_channel(row, include_secret=include_secret)


def ensure_cloudflare_default_channel(db=None) -> None:
    database = db or get_db()
    default_row = database.execute(
        'SELECT id FROM cloudflare_channels WHERE is_default = 1 LIMIT 1'
    ).fetchone()
    if default_row:
        return
    first_enabled = database.execute(
        'SELECT id FROM cloudflare_channels WHERE enabled = 1 ORDER BY id LIMIT 1'
    ).fetchone()
    if first_enabled:
        database.execute('UPDATE cloudflare_channels SET is_default = 1 WHERE id = ?', (first_enabled['id'],))


def get_cloudflare_channel_name_conflict(name: str, exclude_id: Optional[int] = None,
                                         db=None) -> Optional[Dict[str, Any]]:
    normalized_name = str(name or '').strip()
    if not normalized_name:
        return None

    database = db or get_db()
    query = 'SELECT id, name FROM cloudflare_channels WHERE LOWER(name) = LOWER(?)'
    params: List[Any] = [normalized_name]
    if exclude_id is not None:
        query += ' AND id != ?'
        params.append(exclude_id)
    query += ' LIMIT 1'
    row = database.execute(query, params).fetchone()
    return dict(row) if row else None


def validate_cloudflare_channel_payload(data: Dict[str, Any], require_password: bool,
                                        existing_channel: Optional[Dict[str, Any]] = None) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    name = str(data.get('name', existing_channel.get('name') if existing_channel else '') or '').strip()
    worker_domain = str(data.get('worker_domain', existing_channel.get('worker_domain') if existing_channel else '') or '').strip()
    email_domains = serialize_cloudflare_channel_domains(
        data.get('email_domains', existing_channel.get('email_domains') if existing_channel else '')
    )
    admin_password = str(data.get('admin_password', '') or '').strip()

    if not name:
        return None, 'Channel name cannot be empty'
    if not worker_domain:
        return None, 'Worker domain name cannot be empty'
    if require_password and not admin_password:
        return None, 'Administrator password cannot be empty'

    return {
        'name': name,
        'worker_domain': worker_domain,
        'email_domains': email_domains,
        'admin_password': admin_password,
        'enabled': 1 if data.get('enabled', existing_channel.get('enabled') if existing_channel else True) else 0,
        'is_default': 1 if data.get('is_default', existing_channel.get('is_default') if existing_channel else False) else 0,
    }, None


def create_cloudflare_channel(name: str, worker_domain: str, email_domains: Any,
                              admin_password: str, enabled: bool = True,
                              is_default: bool = False) -> tuple[Optional[int], Optional[str]]:
    payload, error = validate_cloudflare_channel_payload({
        'name': name,
        'worker_domain': worker_domain,
        'email_domains': email_domains,
        'admin_password': admin_password,
        'enabled': enabled,
        'is_default': is_default,
    }, require_password=True)
    if error:
        return None, error

    db = get_db()
    try:
        if get_cloudflare_channel_name_conflict(payload['name'], db=db):
            return None, 'Cloudflare channel name already exists'
        existing_default = db.execute('SELECT id FROM cloudflare_channels WHERE is_default = 1 LIMIT 1').fetchone()
        payload['is_default'] = 1 if payload['is_default'] or existing_default is None else 0
        if payload['is_default']:
            db.execute('UPDATE cloudflare_channels SET is_default = 0')
        cursor = db.execute(
            '''
            INSERT INTO cloudflare_channels
            (name, worker_domain, email_domains, admin_password, enabled, is_default)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                payload['name'],
                payload['worker_domain'],
                payload['email_domains'],
                encrypt_data(payload['admin_password']),
                payload['enabled'],
                payload['is_default'],
            )
        )
        db.commit()
        return cursor.lastrowid, None
    except sqlite3.IntegrityError:
        db.rollback()
        return None, 'Cloudflare channel name already exists'
    except Exception as exc:
        db.rollback()
        return None, f'Failed to create Cloudflare channel: {str(exc)}'


def update_cloudflare_channel(channel_id: int, data: Dict[str, Any]) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    existing = get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
    if not existing:
        return None, 'Cloudflare channel does not exist'

    payload, error = validate_cloudflare_channel_payload(data, require_password=False, existing_channel=existing)
    if error:
        return None, error

    encrypted_password = existing.get('admin_password', '')
    if payload['admin_password']:
        encrypted_password = encrypt_data(payload['admin_password'])
    if not encrypted_password:
        return None, 'Administrator password cannot be empty'

    db = get_db()
    try:
        if get_cloudflare_channel_name_conflict(payload['name'], exclude_id=channel_id, db=db):
            return None, 'Cloudflare channel name already exists'
        if payload['is_default']:
            db.execute('UPDATE cloudflare_channels SET is_default = 0 WHERE id != ?', (channel_id,))
        db.execute(
            '''
            UPDATE cloudflare_channels
            SET name = ?,
                worker_domain = ?,
                email_domains = ?,
                admin_password = ?,
                enabled = ?,
                is_default = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (
                payload['name'],
                payload['worker_domain'],
                payload['email_domains'],
                encrypted_password,
                payload['enabled'],
                payload['is_default'],
                channel_id,
            )
        )
        ensure_cloudflare_default_channel(db)
        db.commit()
        return get_cloudflare_channel_by_id(channel_id, include_disabled=True), None
    except sqlite3.IntegrityError:
        db.rollback()
        return None, 'Cloudflare channel name already exists'
    except Exception as exc:
        db.rollback()
        return None, f'Failed to update Cloudflare channel: {str(exc)}'


def delete_cloudflare_channel(channel_id: int) -> tuple[bool, str]:
    channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True)
    if not channel:
        return False, 'Cloudflare channel does not exist'

    reference_count = get_cloudflare_channel_reference_count(channel_id)
    if reference_count > 0:
        return False, f'This Cloudflare channel is still referenced by {reference_count} temporary mailboxes and cannot be deleted'

    db = get_db()
    try:
        db.execute('DELETE FROM cloudflare_channels WHERE id = ?', (channel_id,))
        ensure_cloudflare_default_channel(db)
        db.commit()
        return True, 'Cloudflare channel removed'
    except Exception as exc:
        db.rollback()
        return False, f'Failed to delete Cloudflare channel: {str(exc)}'


def get_temp_email_group_id() -> int:
    'Get the ID of the temporary mailbox group'
    db = get_db()
    cursor = db.execute("SELECT id FROM groups WHERE name = '\u4e34\u65f6\u90ae\u7bb1'")
    row = cursor.fetchone()
    return row['id'] if row else 2


def load_temp_emails() -> List[Dict]:
    'Load all temporary mailboxes'
    db = get_db()
    cursor = db.execute('''
        SELECT te.*, cc.name AS cloudflare_channel_name
        FROM temp_emails te
        LEFT JOIN cloudflare_channels cc ON te.cloudflare_channel_id = cc.id
        ORDER BY te.created_at DESC
    ''')
    rows = cursor.fetchall()
    emails = []
    for row in rows:
        item = dict(row)
        item['tags'] = get_temp_email_tags(item['id'])
        emails.append(item)
    return emails


def get_temp_email_by_id(temp_email_id: int) -> Optional[Dict]:
    'Get temporary mailbox based on ID'
    db = get_db()
    cursor = db.execute('SELECT * FROM temp_emails WHERE id = ?', (temp_email_id,))
    row = cursor.fetchone()
    return dict(row) if row else None


def get_temp_email_by_address(email_addr: str) -> Optional[Dict]:
    'Get temporary email address based on email address'
    db = get_db()
    cursor = db.execute('SELECT * FROM temp_emails WHERE email = ?', (email_addr,))
    row = cursor.fetchone()
    return dict(row) if row else None


def get_temp_email_tags(temp_email_id: int) -> List[Dict]:
    'Get the label of the temporary mailbox'
    db = get_db()
    cursor = db.execute('''
        SELECT t.*
        FROM tags t
        JOIN temp_email_tags tet ON t.id = tet.tag_id
        WHERE tet.temp_email_id = ?
        ORDER BY t.created_at DESC
    ''', (temp_email_id,))
    return [dict(row) for row in cursor.fetchall()]


def add_temp_email_tag(temp_email_id: int, tag_id: int) -> bool:
    'Add a label to the temporary mailbox'
    db = get_db()
    try:
        db.execute(
            'INSERT OR IGNORE INTO temp_email_tags (temp_email_id, tag_id) VALUES (?, ?)',
            (temp_email_id, tag_id)
        )
        db.commit()
        return True
    except Exception:
        return False


def remove_temp_email_tag(temp_email_id: int, tag_id: int) -> bool:
    'Remove temporary mailbox label'
    db = get_db()
    try:
        db.execute(
            'DELETE FROM temp_email_tags WHERE temp_email_id = ? AND tag_id = ?',
            (temp_email_id, tag_id)
        )
        db.commit()
        return True
    except Exception:
        return False


def get_existing_temp_email_tag_ids(tag_ids: Any) -> List[int]:
    'Normalize and filter existing tag IDs.'
    normalized_tag_ids = normalize_tag_ids_input(tag_ids)
    if not normalized_tag_ids:
        return []

    db = get_db()
    placeholders = ','.join('?' * len(normalized_tag_ids))
    rows = db.execute(
        f'SELECT id FROM tags WHERE id IN ({placeholders})',
        normalized_tag_ids,
    ).fetchall()
    existing_ids = {int(row['id']) for row in rows}
    return [tag_id for tag_id in normalized_tag_ids if tag_id in existing_ids]


def bind_temp_email_tags(temp_email_ids: List[int], tag_ids: Any) -> int:
    'Bind existing labels to a batch of temporary mailboxes and return the number of mailboxes processed.'
    normalized_temp_email_ids = []
    seen_email_ids = set()
    for raw_id in temp_email_ids:
        try:
            temp_email_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if temp_email_id <= 0 or temp_email_id in seen_email_ids:
            continue
        seen_email_ids.add(temp_email_id)
        normalized_temp_email_ids.append(temp_email_id)

    existing_tag_ids = get_existing_temp_email_tag_ids(tag_ids)
    if not normalized_temp_email_ids or not existing_tag_ids:
        return 0

    db = get_db()
    db.executemany(
        'INSERT OR IGNORE INTO temp_email_tags (temp_email_id, tag_id) VALUES (?, ?)',
        [
            (temp_email_id, tag_id)
            for temp_email_id in normalized_temp_email_ids
            for tag_id in existing_tag_ids
        ],
    )
    db.commit()
    return len(normalized_temp_email_ids)


def add_temp_email(email_addr: str, provider: str = 'gptmail',
                   duckmail_token: str = None, duckmail_account_id: str = None,
                   duckmail_password: str = None,
                   cloudflare_address_id: str = None,
                   cloudflare_channel_id: Optional[int] = None) -> bool:
    'Add temporary mailbox'
    db = get_db()
    try:
        db.execute('''INSERT INTO temp_emails (
                        email, provider, duckmail_token, duckmail_account_id, duckmail_password,
                        cloudflare_address_id, cloudflare_channel_id
                      ) VALUES (?, ?, ?, ?, ?, ?, ?)''',
                   (email_addr, provider,
                    encrypt_data(duckmail_token) if duckmail_token else None,
                    duckmail_account_id,
                    encrypt_data(duckmail_password) if duckmail_password else None,
                    cloudflare_address_id,
                    cloudflare_channel_id))
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def upsert_cloudflare_temp_email(email_addr: str, channel: Dict[str, Any],
                                 cloudflare_address_id: Any = None) -> tuple[str, Optional[int]]:
    'Add or update Cloudflare temporary email, account credentials depend on channel administrator permissions.'
    normalized_email = normalize_email_address(email_addr)
    if not normalized_email or '@' not in normalized_email:
        return 'skipped', None

    channel_id = channel.get('id') if channel else None
    if not channel_id:
        return 'skipped', None

    address_id = str(cloudflare_address_id or '').strip() or None
    existing = get_temp_email_by_address(normalized_email)
    db = get_db()
    if existing:
        db.execute(
            '''
            UPDATE temp_emails
            SET provider = ?,
                cloudflare_jwt = NULL,
                cloudflare_address_id = ?,
                cloudflare_channel_id = ?
            WHERE email = ?
            ''',
            ('cloudflare', address_id, channel_id, normalized_email),
        )
        db.commit()
        return 'updated', int(existing['id'])

    if add_temp_email(
        normalized_email,
        provider='cloudflare',
        cloudflare_address_id=address_id,
        cloudflare_channel_id=channel_id,
    ):
        created = get_temp_email_by_address(normalized_email)
        return 'added', int(created['id']) if created else None

    return 'skipped', None


def get_enabled_cloudflare_channel_for_import(channel_id: Any = None) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    if channel_id not in (None, ''):
        channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
        if not channel:
            return None, 'Cloudflare channel does not exist'
    else:
        channel = get_default_cloudflare_channel(include_disabled=True, include_secret=True)
        if not channel:
            return None, 'Default Cloudflare channel does not exist'

    if not channel.get('enabled'):
        return None, 'Cloudflare channel is not available'
    if not channel.get('worker_domain') or not decrypt_data(channel.get('admin_password', '')).strip():
        return None, 'Cloudflare channel configuration is missing'
    return channel, None


def delete_temp_email(email_addr: str) -> bool:
    'Delete the temporary mailbox and all its messages'
    db = get_db()
    try:
        db.execute('DELETE FROM temp_email_messages WHERE email_address = ?', (email_addr,))
        db.execute('DELETE FROM temp_emails WHERE email = ?', (email_addr,))
        db.commit()
        return True
    except Exception:
        return False


def cleanup_temp_email_provider_resource(temp_email: Optional[Dict]) -> None:
    'Synchronously clean upstream resources before deleting temporary mailboxes'
    if not temp_email:
        return

    provider = temp_email.get('provider')
    email_addr = temp_email.get('email', '')

    if provider == 'duckmail':
        token = get_duckmail_token_for_email(email_addr)
        account_id = temp_email.get('duckmail_account_id', '')
        if token and account_id:
            duckmail_delete_account(token, account_id)
    elif provider == 'cloudflare':
        channel = get_cloudflare_channel_for_temp_email(temp_email)
        address_id = temp_email.get('cloudflare_address_id', '')
        if address_id:
            cloudflare_delete_address(address_id, channel=channel)
        else:
            cloudflare_delete_address_by_email(email_addr, channel=channel)


def save_temp_email_messages(email_addr: str, messages: List[Dict]) -> int:
    'Save temporary emails to database'
    db = get_db()
    saved = 0
    for msg in messages:
        try:
            db.execute('''
                INSERT OR REPLACE INTO temp_email_messages
                (message_id, email_address, from_address, subject, content, html_content, has_html, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                msg.get('id'),
                email_addr,
                msg.get('from_address', ''),
                msg.get('subject', ''),
                msg.get('content', ''),
                msg.get('html_content', ''),
                1 if msg.get('has_html') else 0,
                msg.get('timestamp', 0)
            ))
            saved += 1
        except Exception:
            continue
    db.commit()
    return saved


def get_temp_email_messages(email_addr: str) -> List[Dict]:
    'Get all emails of temporary mailbox (from database)'
    db = get_db()
    cursor = db.execute('''
        SELECT * FROM temp_email_messages
        WHERE email_address = ?
        ORDER BY timestamp DESC
    ''', (email_addr,))
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


def get_temp_email_message_by_id(message_id: str) -> Optional[Dict]:
    'Get temporary mail based on ID'
    db = get_db()
    cursor = db.execute('SELECT * FROM temp_email_messages WHERE message_id = ?', (message_id,))
    row = cursor.fetchone()
    return dict(row) if row else None


def delete_temp_email_message(message_id: str) -> bool:
    'Delete temporary messages'
    db = get_db()
    try:
        db.execute('DELETE FROM temp_email_messages WHERE message_id = ?', (message_id,))
        db.commit()
        return True
    except Exception:
        return False


def get_temp_email_count() -> int:
    'Get the number of temporary mailboxes'
    db = get_db()
    cursor = db.execute('SELECT COUNT(*) as count FROM temp_emails')
    row = cursor.fetchone()
    return row['count'] if row else 0


# ==================== Temporary mailbox API routing ====================

@app.route('/api/temp-emails', methods=['GET'])
@login_required
def api_get_temp_emails():
    'Get all temporary mailboxes'
    emails = load_temp_emails()
    return jsonify({'success': True, 'emails': emails})


@app.route('/api/temp-emails/tags', methods=['POST'])
@login_required
def api_batch_manage_temp_email_tags():
    'Batch management of temporary mailbox labels'
    data = request.json or {}
    temp_email_ids = data.get('temp_email_ids', [])
    tag_id = data.get('tag_id')
    action = data.get('action')

    if not temp_email_ids or not tag_id or action not in {'add', 'remove'}:
        return jsonify({'success': False, 'error': 'Incomplete parameters'})

    count = 0
    for temp_email_id in temp_email_ids:
        try:
            normalized_id = int(temp_email_id)
        except (TypeError, ValueError):
            continue

        if action == 'add':
            if add_temp_email_tag(normalized_id, tag_id):
                count += 1
        elif action == 'remove':
            if remove_temp_email_tag(normalized_id, tag_id):
                count += 1

    return jsonify({'success': True, 'message': f'Successfully processed {count} temporary mailboxes'})


@app.route('/api/temp-emails/batch-delete', methods=['POST'])
@login_required
def api_batch_delete_temp_emails():
    'Delete temporary mailboxes in batches'
    data = request.json or {}
    temp_email_ids = data.get('temp_email_ids', [])

    if not temp_email_ids:
        return jsonify({'success': False, 'error': 'Please select the temporary mailbox to be deleted'})

    deleted_emails = []
    missing_ids = []

    for temp_email_id in temp_email_ids:
        try:
            normalized_id = int(temp_email_id)
        except (TypeError, ValueError):
            continue

        temp_email = get_temp_email_by_id(normalized_id)
        if not temp_email:
            missing_ids.append(normalized_id)
            continue

        cleanup_temp_email_provider_resource(temp_email)
        if delete_temp_email(temp_email['email']):
            deleted_emails.append({'id': temp_email['id'], 'email': temp_email['email']})

    if not deleted_emails:
        return jsonify({'success': False, 'error': 'No temporary mailbox to delete', 'missing_ids': missing_ids})

    return jsonify({
        'success': True,
        'message': f'{len(deleted_emails)} temporary mailboxes deleted',
        'deleted_emails': deleted_emails,
        'missing_ids': missing_ids,
    })


@app.route('/api/cloudflare/channels', methods=['GET'])
@login_required
def api_list_cloudflare_channels():
    'List Cloudflare channels'
    channels = list_cloudflare_channels(include_disabled=True)
    return jsonify({'success': True, 'channels': channels})


@app.route('/api/cloudflare/channels', methods=['POST'])
@login_required
def api_create_cloudflare_channel():
    'Create a Cloudflare channel'
    data = request.json or {}
    channel_id, error = create_cloudflare_channel(
        name=data.get('name', ''),
        worker_domain=data.get('worker_domain', ''),
        email_domains=data.get('email_domains', ''),
        admin_password=data.get('admin_password', ''),
        enabled=data.get('enabled', True),
        is_default=data.get('is_default', False),
    )
    if error:
        return jsonify({'success': False, 'error': error})

    channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True)
    return jsonify({'success': True, 'channel': channel, 'message': 'Cloudflare channel created'})


@app.route('/api/cloudflare/channels/<int:channel_id>', methods=['PUT'])
@login_required
def api_update_cloudflare_channel(channel_id: int):
    'Update Cloudflare channel'
    channel, error = update_cloudflare_channel(channel_id, request.json or {})
    if error:
        status_code = 404 if 'does not exist' in error else 200
        return jsonify({'success': False, 'error': error}), status_code
    return jsonify({'success': True, 'channel': channel, 'message': 'Cloudflare channel updated'})


@app.route('/api/cloudflare/channels/<int:channel_id>', methods=['DELETE'])
@login_required
def api_delete_cloudflare_channel(channel_id: int):
    'Remove Cloudflare channel'
    success, message = delete_cloudflare_channel(channel_id)
    if not success:
        status_code = 404 if 'does not exist' in message else 200
        return jsonify({'success': False, 'error': message}), status_code
    return jsonify({'success': True, 'message': message})


@app.route('/api/cloudflare/channels/<int:channel_id>/test', methods=['POST'])
@login_required
def api_test_cloudflare_channel(channel_id: int):
    'Testing the Cloudflare Channel Manager API connection'
    channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
    if not channel:
        return jsonify({'success': False, 'error': 'Cloudflare channel does not exist'}), 404

    worker_domain = channel.get('worker_domain', '').strip()
    admin_password_encrypted = channel.get('admin_password', '')

    if not worker_domain:
        return jsonify({
            'success': False,
            'error': 'Worker Domain not configured',
            'details': 'Please fill in the Worker Domain and try again'
        })

    if not admin_password_encrypted:
        return jsonify({
            'success': False,
            'error': 'Administrator password is not configured',
            'details': 'Please fill in the administrator password and try again'
        })

    try:
        admin_password = decrypt_data(admin_password_encrypted)
        if not admin_password.strip():
            return jsonify({
                'success': False,
                'error': 'Administrator password is blank',
                'details': 'Please fill in a valid administrator password and try again'
            })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Administrator password decryption failed',
            'details': str(e)
        })

    # Test 1: Get domain name list
    test_results = []
    domains_result, domains_error = cloudflare_get_domains(channel=channel)
    if domains_error:
        test_results.append({
            'test': 'Get domain name list',
            'success': False,
            'error': domains_error
        })
    else:
        test_results.append({
            'test': 'Get domain name list',
            'success': True,
            'domains': domains_result[:5] if domains_result else []  # Return only the first 5
        })

    # Test 2: Get list of addresses (top 10)
    addresses_result = cloudflare_get_admin_addresses(limit=10, offset=0, channel=channel)
    if not addresses_result.get('success'):
        test_results.append({
            'test': 'Get address list',
            'success': False,
            'error': addresses_result.get('error', 'Failed to obtain address list')
        })
    else:
        addresses = addresses_result.get('addresses', [])
        test_results.append({
            'test': 'Get address list',
            'success': True,
            'count': addresses_result.get('count', 0),
            'sample_size': len(addresses)
        })

    # Test 3: Get mailing list (global, first 5 messages)
    messages_result = cloudflare_get_admin_messages(limit=5, offset=0, channel=channel)
    if not messages_result.get('success'):
        test_results.append({
            'test': 'Get mailing list',
            'success': False,
            'error': messages_result.get('error', 'Failed to obtain mailing list')
        })
    else:
        messages = messages_result.get('messages', [])
        test_results.append({
            'test': 'Get mailing list',
            'success': True,
            'count': messages_result.get('count', 0),
            'sample_size': len(messages)
        })

    # Summary
    all_success = all(test.get('success', False) for test in test_results)
    failed_tests = [test['test'] for test in test_results if not test.get('success', False)]

    if all_success:
        message = f"✅ All tests passed - {channel.get('name', '')} connection is normal"
    else:
        message = f"❌ Partial test failure: {', '.join(failed_tests)}"

    return jsonify({
        'success': all_success,
        'message': message,
        'channel_id': channel_id,
        'channel_name': channel.get('name', ''),
        'worker_domain': worker_domain,
        'tests': test_results,
    })


@app.route('/api/temp-emails/import', methods=['POST'])
@login_required
def api_import_temp_emails():
    'Import temporary mailbox (use different formats depending on the channel)'
    data = request.json or {}
    import_text = data.get('account_string', '').strip()
    provider = data.get('provider', 'gptmail')
    tag_ids = data.get('tag_ids', [])
    cloudflare_channel_id = data.get('cloudflare_channel_id', data.get('channel_id'))

    if not import_text:
        return jsonify({'success': False, 'error': 'Please enter the temporary email address to be imported.'})

    lines = import_text.strip().split('\n')
    added = 0
    updated = 0
    skipped = 0
    token_errors = []
    import_errors = []
    tagged_temp_email_ids: List[int] = []
    current_cloudflare_channel = None
    if provider == 'cloudflare':
        current_cloudflare_channel, channel_error = get_enabled_cloudflare_channel_for_import(cloudflare_channel_id)
        if channel_error:
            return jsonify({'success': False, 'error': channel_error})

    for line in lines:
        line = line.strip()
        if not line:
            continue

        try:
            if provider == 'duckmail':
                # DuckMail format: Email----Password
                parts = line.split('----')
                if len(parts) >= 2:
                    email_addr = parts[0].strip()
                    duckmail_password = parts[1].strip()

                    if email_addr and duckmail_password:
                        # Check if it already exists, update the password if it exists
                        existing = get_temp_email_by_address(email_addr)
                        if existing:
                            # Update password and provider
                            db = get_db()
                            db.execute('UPDATE temp_emails SET duckmail_password = ?, provider = ? WHERE email = ?',
                                       (encrypt_data(duckmail_password), 'duckmail', email_addr))
                            db.commit()
                            updated += 1
                        else:
                            if not add_temp_email(
                                email_addr, provider='duckmail',
                                duckmail_token=None,
                                duckmail_account_id=None,
                                duckmail_password=duckmail_password
                            ):
                                skipped += 1
                                continue
                            added += 1

                        # Try to obtain Token (non-blocking, failure will not affect import)
                        try:
                            token_result = duckmail_get_token(email_addr, duckmail_password)
                            if token_result and token_result.get('token'):
                                db = get_db()
                                db.execute('UPDATE temp_emails SET duckmail_token = ? WHERE email = ?',
                                           (encrypt_data(token_result['token']), email_addr))
                                db.commit()
                            else:
                                token_errors.append(email_addr)
                        except Exception:
                            token_errors.append(email_addr)
                    else:
                        skipped += 1
                else:
                    skipped += 1
            elif provider == 'cloudflare':
                header_match = re.match(r'^\[cloudflare(?::([^\]]+))?\]$', line, flags=re.IGNORECASE)
                if header_match:
                    channel_name = (header_match.group(1) or '').strip()
                    if channel_name:
                        current_cloudflare_channel = get_cloudflare_channel_by_name(
                            channel_name,
                            include_disabled=True,
                            include_secret=True,
                        )
                        if not current_cloudflare_channel:
                            import_errors.append(f'Cloudflare channel does not exist: {channel_name}')
                        elif not current_cloudflare_channel.get('enabled'):
                            import_errors.append(f'Cloudflare channel unavailable: {channel_name}')
                    else:
                        current_cloudflare_channel, channel_error = get_enabled_cloudflare_channel_for_import(cloudflare_channel_id)
                        if channel_error:
                            import_errors.append(channel_error)
                    continue

                # Compatible with old format email----JWT, automatically extract the email part
                if '----' in line:
                    parts = line.split('----')
                    line = parts[0].strip()  # Get only the email part
                    if not line:
                        skipped += 1
                        continue

                if not current_cloudflare_channel:
                    import_errors.append('Cloudflare channel does not exist')
                    skipped += 1
                    continue
                if not current_cloudflare_channel.get('enabled'):
                    import_errors.append(f"Cloudflare channel unavailable: {current_cloudflare_channel.get('name', '')}")
                    skipped += 1
                    continue

                email_addr = normalize_email_address(line)
                status, temp_email_id = upsert_cloudflare_temp_email(email_addr, current_cloudflare_channel)
                if status == 'added':
                    added += 1
                elif status == 'updated':
                    updated += 1
                else:
                    skipped += 1
                if temp_email_id:
                    tagged_temp_email_ids.append(temp_email_id)
            else:
                # GPTMail format: one email address per line
                email_addr = line.strip()
                if email_addr and '@' in email_addr:
                    existing = get_temp_email_by_address(email_addr)
                    if existing:
                        updated += 1
                    elif add_temp_email(email_addr, provider='gptmail'):
                        added += 1
                    else:
                        skipped += 1
                else:
                    skipped += 1
        except Exception:
            skipped += 1

    total = added + updated
    if total > 0:
        tagged_count = bind_temp_email_tags(tagged_temp_email_ids, tag_ids)
        log_audit('import', 'temp_emails', None, f'Import {added} new temporary mailboxes and update {updated} existing mailboxes')
        msg = ''
        if added > 0:
            msg += f'Add {added} temporary mailboxes'
        if updated > 0:
            msg += ('，' if msg else '') + f'Update {updated} existing mailboxes'
        if tagged_count > 0:
            msg += f', bind label {tagged_count} mailboxes'
        if skipped > 0:
            msg += f', skip {skipped} (format error)'
        if token_errors:
            msg += f', {len(token_errors)} mailbox Token acquisition failed (does not affect use, will automatically retry when obtaining emails)'
        if import_errors:
            msg += f', {len(import_errors)} errors:' + '；'.join(import_errors[:3])
        return jsonify({
            'success': True,
            'message': msg,
            'errors': import_errors,
            'tagged_count': tagged_count,
        })
    else:
        error_message = 'No new temporary mailbox was imported (possibly malformed)'
        if import_errors:
            error_message = '；'.join(import_errors[:3])
        return jsonify({'success': False, 'error': error_message, 'errors': import_errors})


@app.route('/api/temp-emails/import-cloudflare-addresses', methods=['POST'])
@login_required
def api_import_cloudflare_addresses():
    'Automatically import email addresses from Cloudflare admin address list without pulling JWT.'
    from flask import Response, stream_with_context
    import json

    data = request.json or {}
    channel, channel_error = get_enabled_cloudflare_channel_for_import(
        data.get('cloudflare_channel_id', data.get('channel_id'))
    )
    if channel_error:
        return jsonify({'success': False, 'error': channel_error})

    page_size = normalize_cloudflare_admin_mail_limit(data.get('page_size', 100), default=100, maximum=500)
    tag_ids = data.get('tag_ids', [])
    stream = data.get('stream', False)  # Whether to stream the return progress

    def generate_progress():
        'Generator function, streaming return of import progress'
        offset = 0
        added = 0
        updated = 0
        skipped = 0
        imported = 0
        errors: List[str] = []
        tagged_temp_email_ids: List[int] = []

        # Protection mechanism to prevent infinite loops
        MAX_AUTO_IMPORT_PAGES = 100
        page_count = 0

        while page_count < MAX_AUTO_IMPORT_PAGES:
            result = cloudflare_get_admin_addresses(limit=page_size, offset=offset, channel=channel)
            if not result.get('success'):
                errors.append(result.get('error', 'Failed to obtain Cloudflare address list'))
                break

            addresses = result.get('addresses') or []
            if not addresses:
                break

            for item in addresses:
                email_addr, address_id = normalize_cloudflare_address_item(item)
                if not email_addr or '@' not in email_addr:
                    skipped += 1
                    continue
                status, temp_email_id = upsert_cloudflare_temp_email(email_addr, channel, address_id)
                if status == 'added':
                    added += 1
                elif status == 'updated':
                    updated += 1
                else:
                    skipped += 1
                if temp_email_id:
                    tagged_temp_email_ids.append(temp_email_id)
                imported += 1

            total_count = result.get('count', len(addresses))
            offset += len(addresses)
            page_count += 1

            # Send progress updates
            if stream:
                progress_data = {
                    'type': 'progress',
                    'added': added,
                    'updated': updated,
                    'skipped': skipped,
                    'imported': imported,
                    'total': total_count,
                    'page': page_count,
                }
                yield f"data: {json.dumps(progress_data)}\n\n"

            if len(addresses) < page_size or offset >= int(total_count or 0):
                break

        if page_count >= MAX_AUTO_IMPORT_PAGES:
            errors.append(f'The maximum paging limit has been reached ({MAX_AUTO_IMPORT_PAGES} pages), stop importing')

        total = added + updated
        if total <= 0:
            error = 'No Cloudflare mailbox to import'
            if errors:
                error = '；'.join(errors[:3])
            final_result = {
                'type': 'complete',
                'success': False,
                'error': error,
                'added_count': added,
                'updated_count': updated,
                'skipped_count': skipped,
                'errors': errors,
            }
            if stream:
                yield f"data: {json.dumps(final_result)}\n\n"
            else:
                yield final_result
            return

        tagged_count = bind_temp_email_tags(tagged_temp_email_ids, tag_ids)
        message = f'Automatically import {added} new mailboxes'
        if updated:
            message += f', update {updated} existing mailboxes'
        if skipped:
            message += f', skip {skipped}'
        if tagged_count:
            message += f', bind label {tagged_count} mailboxes'
        if errors:
            message += f', {len(errors)} errors:' + '；'.join(errors[:3])
        log_audit(
            'import',
            'temp_emails',
            None,
            f"Automatically import {added} new temporary mailboxes from Cloudflare channel {channel.get('name', '')} and update {updated} existing mailboxes",
        )
        final_result = {
            'type': 'complete',
            'success': True,
            'message': message,
            'added_count': added,
            'updated_count': updated,
            'skipped_count': skipped,
            'imported_count': imported,
            'tagged_count': tagged_count,
            'channel_id': channel.get('id'),
            'channel_name': channel.get('name', ''),
            'errors': errors,
        }
        if stream:
            yield f"data: {json.dumps(final_result)}\n\n"
        else:
            yield final_result

    def generate_progress_with_app_context():
        with app.app_context():
            yield from generate_progress()

    # If request streaming returns, use Server-Sent Events
    if stream:
        return Response(stream_with_context(generate_progress_with_app_context()), mimetype='text/event-stream')

    # Otherwise, return the result in one go
    result = None
    for r in generate_progress():
        result = r
    return jsonify(result)


@app.route('/api/duckmail/domains', methods=['GET'])
@login_required
def api_get_duckmail_domains():
    'Get the list of DuckMail available domain names'
    domains, error = duckmail_get_domains()
    if error:
        return jsonify({'success': False, 'error': error, 'domains': []})
    return jsonify({
        'success': True,
        'domains': [{'id': d.get('id'), 'domain': d.get('domain')} for d in domains]
    })


@app.route('/api/cloudflare/domains', methods=['GET'])
@login_required
def api_get_cloudflare_domains():
    'Get the list of available domain names for Cloudflare Temp Email'
    channel_id = request.args.get('channel_id')
    if channel_id:
        channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
        if not channel:
            return jsonify({'success': False, 'error': 'Cloudflare channel does not exist', 'domains': []}), 404
    else:
        channel = get_default_cloudflare_channel(include_disabled=True, include_secret=True)
        if not channel:
            return jsonify({'success': False, 'error': 'Please configure Cloudflare channel first', 'domains': []})
    domains, error = cloudflare_get_domains(channel=channel)
    if error:
        return jsonify({'success': False, 'error': error, 'domains': []})
    return jsonify({
        'success': True,
        'channel_id': channel.get('id') if channel else None,
        'channel_name': channel.get('name') if channel else '',
        'domains': [{'domain': domain} for domain in domains]
    })


@app.route('/api/cloudflare/messages', methods=['GET'])
@login_required
def api_get_cloudflare_admin_messages():
    'Get Cloudflare Temp Email global mailing list'
    limit = normalize_cloudflare_admin_mail_limit(request.args.get('limit', 50))
    offset = normalize_cloudflare_admin_mail_offset(request.args.get('offset', 0))
    channel_id = request.args.get('channel_id')
    if channel_id:
        channel = get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
        if not channel:
            return jsonify({'success': False, 'error': 'Cloudflare channel does not exist'}), 404
    else:
        channel = get_default_cloudflare_channel(include_disabled=True, include_secret=True)
        if not channel:
            return jsonify({'success': False, 'error': 'Please configure Cloudflare channel first'}), 400
    if not channel.get('enabled'):
        return jsonify({'success': False, 'error': 'Cloudflare channel is not available'}), 400
    if not channel.get('worker_domain') or not decrypt_data(channel.get('admin_password', '')).strip():
        return jsonify({'success': False, 'error': 'Cloudflare channel configuration is missing'}), 400

    requested_address = (
        get_query_arg_preserve_plus('address', '').strip()
        or get_query_arg_preserve_plus('email', '').strip()
    )
    normalized_requested_address = normalize_email_address(requested_address)

    if requested_address and not normalized_requested_address:
        return jsonify({'success': False, 'error': 'The address parameter is invalid'}), 400

    address_candidates = build_email_query_candidates(normalized_requested_address) if normalized_requested_address else ['']
    if requested_address and not address_candidates:
        return jsonify({'success': False, 'error': 'The address parameter is invalid'}), 400

    selected_result: Optional[Dict[str, Any]] = None
    selected_address = ''
    fallback_attempted = False

    for index, candidate_address in enumerate(address_candidates):
        if index > 0:
            fallback_attempted = True

        admin_result = cloudflare_get_admin_messages(
            limit=limit,
            offset=offset,
            address=candidate_address,
            channel=channel,
        )
        if not admin_result.get('success'):
            return jsonify({
                'success': False,
                'error': admin_result.get('error', 'Failed to get Cloudflare global mail'),
                'channel_id': channel.get('id'),
                'channel_name': channel.get('name', ''),
                'requested_email': normalized_requested_address,
                'queried_email': candidate_address,
            })

        selected_result = admin_result
        selected_address = candidate_address
        raw_messages = admin_result.get('messages', [])
        if not normalized_requested_address or raw_messages or index == len(address_candidates) - 1:
            break

    raw_messages = selected_result.get('messages', []) if selected_result else []
    formatted = format_cloudflare_admin_messages(raw_messages, selected_address)
    total_count = selected_result.get('count', len(raw_messages)) if selected_result else 0
    fallback_used = bool(normalized_requested_address and selected_address != normalized_requested_address)

    return jsonify({
        'success': True,
        'emails': formatted,
        'count': len(formatted),
        'total_count': total_count,
        'limit': limit,
        'offset': offset,
        'has_more': total_count > offset + limit if isinstance(total_count, int) else len(raw_messages) >= limit,
        'method': 'Cloudflare Admin',
        'channel_id': channel.get('id'),
        'channel_name': channel.get('name', ''),
        'requested_email': normalized_requested_address,
        'queried_email': selected_address,
        'fallback_used': fallback_used,
        'fallback_attempted': fallback_attempted,
    })


@app.route('/api/temp-emails/generate', methods=['POST'])
@login_required
def api_generate_temp_email():
    'Generate new temporary mailbox (supports GPTMail, DuckMail and Cloudflare)'
    data = request.json or {}
    provider = data.get('provider', 'gptmail')

    if provider == 'duckmail':
        # DuckMail: requires domain, username, password
        domain = data.get('domain', '')
        username = data.get('username', '')
        password = data.get('password', '')

        if not domain or not username:
            return jsonify({'success': False, 'error': 'Please enter username and domain name'})
        if len(username) < 3:
            return jsonify({'success': False, 'error': 'Username must be at least 3 characters'})
        if not password or len(password) < 6:
            return jsonify({'success': False, 'error': 'Password must be at least 6 characters'})

        email_addr = f"{username}@{domain}"

        # Check whether the local database already exists
        existing = get_temp_email_by_address(email_addr)
        if existing:
            return jsonify({'success': False, 'error': 'The mailbox already exists'})

        # 1. Create an account
        account_result = duckmail_create_account(email_addr, password)
        if not account_result or not account_result.get('id'):
            error_msg = account_result.get('error', 'Failed to create DuckMail account') if account_result else 'Failed to create DuckMail account'
            return jsonify({'success': False, 'error': error_msg})

        account_id = account_result['id']

        # 2. Obtain Token
        token_result = duckmail_get_token(email_addr, password)
        if not token_result or not token_result.get('token'):
            error_msg = token_result.get('error', 'Failed to obtain DuckMail Token') if token_result else 'Failed to obtain DuckMail Token'
            return jsonify({'success': False, 'error': error_msg})

        token = token_result['token']

        # 3. Save to database
        if add_temp_email(email_addr, provider='duckmail',
                         duckmail_token=token,
                         duckmail_account_id=account_id,
                         duckmail_password=password):
            return jsonify({'success': True, 'email': email_addr, 'message': 'DuckMail temporary mailbox is created successfully'})
        else:
            return jsonify({'success': False, 'error': 'The mailbox already exists'})
    elif provider == 'cloudflare':
        channel_id = data.get('channel_id')
        channel = (
            get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
            if channel_id
            else get_default_cloudflare_channel(include_disabled=True, include_secret=True)
        )
        if not channel:
            return jsonify({'success': False, 'error': 'Please select or configure a Cloudflare channel first'})
        if not channel.get('enabled'):
            return jsonify({'success': False, 'error': 'Cloudflare channel is not available and mailbox cannot be created'})

        domain = data.get('domain', '').strip()
        username = data.get('username', '').strip() or None

        if username and len(username) < 3:
            return jsonify({'success': False, 'error': 'Username must be at least 3 characters, or left blank to generate randomly'})
        if not domain:
            domains = channel.get('email_domains', [])
            if not domains:
                return jsonify({'success': False, 'error': 'Please configure the Cloudflare email domain name in the settings first'})
            domain = domains[0]

        result = cloudflare_create_address(username=username, domain=domain, channel=channel)
        if not result:
            return jsonify({'success': False, 'error': 'Failed to create Cloudflare temporary mailbox'})

        email_addr = result.get('address')
        address_id = result.get('id') or result.get('address_id')

        if not email_addr:
            return jsonify({'success': False, 'error': result.get('error', 'Cloudflare returns incomplete data')})

        if add_temp_email(
            email_addr,
            provider='cloudflare',
            cloudflare_address_id=address_id,
            cloudflare_channel_id=channel.get('id'),
        ):
            return jsonify({'success': True, 'email': email_addr, 'message': 'Cloudflare temporary mailbox is created successfully'})
        return jsonify({'success': False, 'error': 'The mailbox already exists'})
    else:
        # GPTMail: Keep the original logic
        prefix = data.get('prefix')
        domain = data.get('domain')

        email_addr = generate_temp_email(prefix, domain)

        if email_addr:
            if add_temp_email(email_addr, provider='gptmail'):
                return jsonify({'success': True, 'email': email_addr, 'message': 'Temporary mailbox created successfully'})
            else:
                return jsonify({'success': False, 'error': 'The mailbox already exists'})
        else:
            return jsonify({'success': False, 'error': 'Failed to generate temporary mailbox, please try again later.'})


@app.route('/api/cloudflare/ai-usernames/test', methods=['POST'])
@login_required
def api_test_cloudflare_ai_usernames():
    data = request.json or {}
    count = normalize_cloudflare_batch_count(data.get('count', 5))
    if count is None:
        return jsonify({'success': False, 'error': f'The quantity must be between 1-{CLOUDFLARE_BATCH_GENERATE_MAX_COUNT}'})

    config = build_cloudflare_ai_username_config(data, use_saved_secret=True)
    result = request_cloudflare_ai_usernames(config, count)
    if not result.get('success'):
        return jsonify({'success': False, 'error': result.get('error', 'AI username generation failed')})

    return jsonify({
        'success': True,
        'usernames': result.get('usernames', []),
        'seed': result.get('seed', ''),
    })


@app.route('/api/cloudflare/ai-usernames/generate', methods=['POST'])
@login_required
def api_generate_cloudflare_ai_usernames():
    data = request.json or {}
    count = normalize_cloudflare_batch_count(data.get('count', 1))
    if count is None:
        return jsonify({'success': False, 'error': f'The quantity must be between 1-{CLOUDFLARE_BATCH_GENERATE_MAX_COUNT}'})

    config = build_cloudflare_ai_username_config({}, use_saved_secret=True)
    if not config.get('enabled'):
        return jsonify({'success': False, 'error': 'Cloudflare AI username feature is not enabled'})

    config_error = validate_cloudflare_ai_username_config(config)
    if config_error:
        return jsonify({'success': False, 'error': config_error})

    result = request_cloudflare_ai_usernames(config, count)
    if not result.get('success'):
        return jsonify({'success': False, 'error': result.get('error', 'AI username generation failed')})

    strict_result = validate_strict_cloudflare_ai_username_result(result, count)
    if not strict_result.get('success'):
        return jsonify({'success': False, 'error': strict_result.get('error', 'AI username generation failed')})

    return jsonify({
        'success': True,
        'usernames': strict_result.get('usernames', []),
        'seed': result.get('seed', ''),
    })


@app.route('/api/temp-emails/generate-batch', methods=['POST'])
@login_required
def api_generate_temp_emails_batch():
    data = request.json or {}
    provider = data.get('provider', 'cloudflare')
    if provider != 'cloudflare':
        return jsonify({'success': False, 'error': 'Batch generation only supports Cloudflare temporary mailboxes.'})

    count = normalize_cloudflare_batch_count(data.get('count', 1))
    if count is None:
        return jsonify({'success': False, 'error': f'The quantity must be between 1-{CLOUDFLARE_BATCH_GENERATE_MAX_COUNT}'})

    channel_id = data.get('channel_id')
    channel = (
        get_cloudflare_channel_by_id(channel_id, include_disabled=True, include_secret=True)
        if channel_id
        else get_default_cloudflare_channel(include_disabled=True, include_secret=True)
    )
    if not channel:
        return jsonify({'success': False, 'error': 'Please select or configure a Cloudflare channel first'})
    if not channel.get('enabled'):
        return jsonify({'success': False, 'error': 'Cloudflare channel is not available and mailbox cannot be created'})

    domain = data.get('domain', '').strip()
    if not domain:
        domains = channel.get('email_domains', [])
        if not domains:
            return jsonify({'success': False, 'error': 'Please configure the Cloudflare email domain name in the settings first'})
        domain = domains[0]

    username_result = normalize_cloudflare_explicit_usernames(data.get('usernames'), count)
    if not username_result.get('success'):
        return jsonify({'success': False, 'error': username_result.get('error', 'Invalid username list')})

    usernames = username_result.get('usernames', [])
    if not usernames:
        usernames = [generate_random_temp_name() for _ in range(count)]

    created_emails: List[str] = []
    created_temp_email_ids: List[int] = []
    failures: List[Dict[str, Any]] = []

    for index in range(count):
        username = usernames[index]
        result = cloudflare_create_address(username=username, domain=domain, channel=channel)
        email_addr = (result or {}).get('address')
        address_id = (result or {}).get('id') or (result or {}).get('address_id')

        if not email_addr:
            failures.append({
                'index': index + 1,
                'username': username,
                'error': (result or {}).get('error', 'Cloudflare returns incomplete data'),
            })
            continue

        if not add_temp_email(
            email_addr,
            provider='cloudflare',
            cloudflare_address_id=address_id,
            cloudflare_channel_id=channel.get('id'),
        ):
            failures.append({
                'index': index + 1,
                'username': username,
                'email': email_addr,
                'error': 'The mailbox already exists',
            })
            continue

        created_emails.append(email_addr)
        created_email = get_temp_email_by_address(email_addr)
        if created_email:
            created_temp_email_ids.append(int(created_email['id']))

    tagged_count = bind_temp_email_tags(created_temp_email_ids, data.get('tag_ids', []))
    failed_count = count - len(created_emails)
    response_payload = {
        'success': bool(created_emails),
        'emails': created_emails,
        'created_count': len(created_emails),
        'failed_count': failed_count,
        'failures': failures,
        'tagged_count': tagged_count,
        'ai_fallback_used': False,
        'ai_error': '',
    }

    if created_emails:
        response_payload['message'] = f'{len(created_emails)} temporary Cloudflare mailboxes created'
        return jsonify(response_payload)

    first_error = failures[0]['error'] if failures else 'Failed to create Cloudflare temporary mailbox'
    response_payload['error'] = first_error
    return jsonify(response_payload)


@app.route('/api/temp-emails/<path:email_addr>', methods=['DELETE'])
@login_required
def api_delete_temp_email(email_addr):
    'Delete temporary mailbox'
    temp_email = get_temp_email_by_address(email_addr)
    cleanup_temp_email_provider_resource(temp_email)

    if delete_temp_email(email_addr):
        return jsonify({'success': True, 'message': 'The temporary mailbox has been deleted'})
    else:
        return jsonify({'success': False, 'error': 'Delete failed'})


@app.route('/api/temp-emails/<path:email_addr>/messages', methods=['GET'])
@login_required
def api_get_temp_email_messages(email_addr):
    'Get the mailing list of the temporary mailbox'
    temp_email = get_temp_email_by_address(email_addr)
    provider = temp_email.get('provider', 'gptmail') if temp_email else 'gptmail'

    if provider == 'duckmail':
        # DuckMail: Get emails using Bearer Token
        token = get_duckmail_token_for_email(email_addr)
        if not token:
            # Token acquisition failed, try to refresh with password
            token = duckmail_refresh_token(email_addr)
        if not token:
            return jsonify({'success': False, 'error': 'Failed to obtain DuckMail Token, please check whether the password is correct or whether the DuckMail service is available'})

        messages = duckmail_get_messages(token)
        if messages is None:
            # Token may expire, try to refresh
            token = duckmail_refresh_token(email_addr)
            if token:
                messages = duckmail_get_messages(token)

        if messages is None:
            return jsonify({'success': False, 'error': 'Failed to get DuckMail email'})

        # Convert to unified format and save to database
        unified_messages = []
        for msg in messages:
            from_info = msg.get('from', {})
            from_addr = from_info.get('address', '') if isinstance(from_info, dict) else str(from_info)
            unified_messages.append({
                'id': msg.get('id', ''),
                'from_address': from_addr,
                'subject': msg.get('subject', 'No topic'),
                'content': msg.get('text', ''),
                'html_content': msg.get('html', [''])[0] if isinstance(msg.get('html'), list) else (msg.get('html', '') or ''),
                'has_html': bool(msg.get('html')),
                'timestamp': int(datetime.fromisoformat(msg['createdAt'].replace('Z', '+00:00')).timestamp()) if msg.get('createdAt') else 0
            })
        save_temp_email_messages(email_addr, unified_messages)

        formatted = []
        for msg in unified_messages:
            formatted.append({
                'id': msg.get('id'),
                'from': msg.get('from_address', 'Unknown'),
                'subject': msg.get('subject', 'No topic'),
                'body_preview': (msg.get('content', '') or '')[:200],
                'date': msg.get('timestamp', 0),
                'timestamp': msg.get('timestamp', 0),
                'has_html': 1 if msg.get('has_html') else 0
            })

        return jsonify({
            'success': True,
            'emails': formatted,
            'count': len(formatted),
            'method': 'DuckMail'
        })
    elif provider == 'cloudflare':
        fetch_result = fetch_cloudflare_temp_messages(email_addr, temp_email)
        if not fetch_result.get('success'):
            return jsonify({'success': False, 'error': fetch_result.get('error', 'Failed to get Cloudflare email')})
        unified_messages = fetch_result.get('messages', [])

        save_temp_email_messages(email_addr, unified_messages)

        formatted = []
        for msg in unified_messages:
            formatted.append({
                'id': msg.get('id'),
                'from': msg.get('from_address', 'Unknown'),
                'subject': msg.get('subject', 'No topic'),
                'body_preview': (msg.get('content', '') or '')[:200],
                'date': msg.get('timestamp', 0),
                'timestamp': msg.get('timestamp', 0),
                'has_html': 1 if msg.get('has_html') else 0
            })

        return jsonify({
            'success': True,
            'emails': formatted,
            'count': len(formatted),
            'method': fetch_result.get('method', 'Cloudflare')
        })
    else:
        # GPTMail: Keep the original logic
        api_messages = get_temp_emails_from_api(email_addr)

        if api_messages:
            save_temp_email_messages(email_addr, api_messages)

        messages = get_temp_email_messages(email_addr)

        formatted = []
        for msg in messages:
            formatted.append({
                'id': msg.get('message_id'),
                'from': msg.get('from_address', 'Unknown'),
                'subject': msg.get('subject', 'No topic'),
                'body_preview': (msg.get('content', '') or '')[:200],
                'date': msg.get('created_at', ''),
                'timestamp': msg.get('timestamp', 0),
                'has_html': msg.get('has_html', 0)
            })

        return jsonify({
            'success': True,
            'emails': formatted,
            'count': len(formatted),
            'method': 'GPTMail'
        })


@app.route('/api/temp-emails/<path:email_addr>/messages/<path:message_id>', methods=['GET'])
@login_required
def api_get_temp_email_message_detail(email_addr, message_id):
    'Get temporary email details'
    temp_email = get_temp_email_by_address(email_addr)
    provider = temp_email.get('provider', 'gptmail') if temp_email else 'gptmail'

    if provider == 'duckmail':
        # Check the local cache first
        msg = get_temp_email_message_by_id(message_id)

        # If there is HTML content, return it directly to the local cache
        if msg and msg.get('has_html') and msg.get('html_content'):
            return jsonify({
                'success': True,
                'email': {
                    'id': msg.get('message_id'),
                    'from': msg.get('from_address', 'Unknown'),
                    'to': email_addr,
                    'subject': msg.get('subject', 'No topic'),
                    'body': msg.get('html_content') if msg.get('has_html') else msg.get('content', ''),
                    'body_type': 'html' if msg.get('has_html') else 'text',
                    'date': msg.get('created_at', ''),
                    'timestamp': msg.get('timestamp', 0)
                }
            })

        # Get details (including body) from DuckMail API
        token = get_duckmail_token_for_email(email_addr)
        if not token:
            return jsonify({'success': False, 'error': 'DuckMail Token is invalid'})

        detail = duckmail_get_message_detail(token, message_id)
        if detail:
            from_info = detail.get('from', {})
            from_addr = from_info.get('address', '') if isinstance(from_info, dict) else str(from_info)
            html_content = detail.get('html', [''])[0] if isinstance(detail.get('html'), list) else (detail.get('html', '') or '')
            text_content = detail.get('text', '')

            # Update local cache
            save_temp_email_messages(email_addr, [{
                'id': detail.get('id', ''),
                'from_address': from_addr,
                'subject': detail.get('subject', 'No topic'),
                'content': text_content,
                'html_content': html_content,
                'has_html': bool(html_content),
                'timestamp': int(datetime.fromisoformat(detail['createdAt'].replace('Z', '+00:00')).timestamp()) if detail.get('createdAt') else 0
            }])

            body = html_content if html_content else text_content
            body_type = 'html' if html_content else 'text'

            return jsonify({
                'success': True,
                'email': {
                    'id': detail.get('id'),
                    'from': from_addr,
                    'to': email_addr,
                    'subject': detail.get('subject', 'No topic'),
                    'body': body,
                    'body_type': body_type,
                    'date': detail.get('createdAt', ''),
                    'timestamp': int(datetime.fromisoformat(detail['createdAt'].replace('Z', '+00:00')).timestamp()) if detail.get('createdAt') else 0
                }
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to obtain email details'})
    elif provider == 'cloudflare':
        msg = get_temp_email_message_by_id(message_id)

        if not msg:
            fetch_result = fetch_cloudflare_temp_messages(email_addr, temp_email)
            if not fetch_result.get('success'):
                return jsonify({'success': False, 'error': fetch_result.get('error', 'Failed to get Cloudflare email')})
            save_temp_email_messages(email_addr, fetch_result.get('messages', []))
            msg = get_temp_email_message_by_id(message_id)

        if msg:
            return jsonify({
                'success': True,
                'email': {
                    'id': msg.get('message_id'),
                    'from': msg.get('from_address', 'Unknown'),
                    'to': email_addr,
                    'subject': msg.get('subject', 'No topic'),
                    'body': msg.get('html_content') if msg.get('has_html') else msg.get('content', ''),
                    'body_type': 'html' if msg.get('has_html') else 'text',
                    'date': msg.get('created_at', ''),
                    'timestamp': msg.get('timestamp', 0)
                }
            })
        return jsonify({'success': False, 'error': 'Mail does not exist'})
    else:
        # GPTMail: Keep the original logic
        msg = get_temp_email_message_by_id(message_id)

        if not msg:
            api_msg = get_temp_email_detail_from_api(message_id)
            if api_msg:
                save_temp_email_messages(email_addr, [api_msg])
                msg = get_temp_email_message_by_id(message_id)

        if msg:
            return jsonify({
                'success': True,
                'email': {
                    'id': msg.get('message_id'),
                    'from': msg.get('from_address', 'Unknown'),
                    'to': email_addr,
                    'subject': msg.get('subject', 'No topic'),
                    'body': msg.get('html_content') if msg.get('has_html') else msg.get('content', ''),
                    'body_type': 'html' if msg.get('has_html') else 'text',
                    'date': msg.get('created_at', ''),
                    'timestamp': msg.get('timestamp', 0)
                }
            })
        else:
            return jsonify({'success': False, 'error': 'Mail does not exist'})


@app.route('/api/temp-emails/<path:email_addr>/messages/<path:message_id>', methods=['DELETE'])
@login_required
def api_delete_temp_email_message(email_addr, message_id):
    'Delete temporary messages'
    return jsonify({'success': False, 'error': 'The function of deleting single letters from temporary mailboxes has been temporarily closed.'})


@app.route('/api/temp-emails/<path:email_addr>/clear', methods=['DELETE'])
@login_required
def api_clear_temp_email_messages(email_addr):
    'Clear all emails from the temporary mailbox'
    return jsonify({'success': False, 'error': 'The temporary mailbox clearing function has been temporarily turned off'})


@app.route('/api/temp-emails/<path:email_addr>/refresh', methods=['POST'])
@login_required
def api_refresh_temp_email_messages(email_addr):
    'Refresh emails in temporary mailbox'
    temp_email = get_temp_email_by_address(email_addr)
    provider = temp_email.get('provider', 'gptmail') if temp_email else 'gptmail'

    if provider == 'duckmail':
        token = get_duckmail_token_for_email(email_addr)
        if not token:
            return jsonify({'success': False, 'error': 'DuckMail Token is invalid, please try to recreate the mailbox'})

        messages = duckmail_get_messages(token)
        if messages is None:
            # Token may expire, try to refresh
            token = duckmail_refresh_token(email_addr)
            if token:
                messages = duckmail_get_messages(token)

        if messages is not None:
            unified_messages = []
            for msg in messages:
                from_info = msg.get('from', {})
                from_addr = from_info.get('address', '') if isinstance(from_info, dict) else str(from_info)
                unified_messages.append({
                    'id': msg.get('id', ''),
                    'from_address': from_addr,
                    'subject': msg.get('subject', 'No topic'),
                    'content': msg.get('text', ''),
                    'html_content': msg.get('html', [''])[0] if isinstance(msg.get('html'), list) else (msg.get('html', '') or ''),
                    'has_html': bool(msg.get('html')),
                    'timestamp': int(datetime.fromisoformat(msg['createdAt'].replace('Z', '+00:00')).timestamp()) if msg.get('createdAt') else 0
                })
            saved = save_temp_email_messages(email_addr, unified_messages)

            formatted = []
            for msg in unified_messages:
                formatted.append({
                    'id': msg.get('id'),
                    'from': msg.get('from_address', 'Unknown'),
                    'subject': msg.get('subject', 'No topic'),
                    'body_preview': (msg.get('content', '') or '')[:200],
                    'date': msg.get('timestamp', 0),
                    'timestamp': msg.get('timestamp', 0),
                    'has_html': 1 if msg.get('has_html') else 0
                })

            return jsonify({
                'success': True,
                'emails': formatted,
                'count': len(formatted),
                'new_count': saved,
                'method': 'DuckMail'
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to get DuckMail email'})
    elif provider == 'cloudflare':
        fetch_result = fetch_cloudflare_temp_messages(email_addr, temp_email)
        if not fetch_result.get('success'):
            return jsonify({'success': False, 'error': fetch_result.get('error', 'Failed to get Cloudflare email')})
        unified_messages = fetch_result.get('messages', [])
        saved = save_temp_email_messages(email_addr, unified_messages)

        formatted = []
        for msg in unified_messages:
            formatted.append({
                'id': msg.get('id'),
                'from': msg.get('from_address', 'Unknown'),
                'subject': msg.get('subject', 'No topic'),
                'body_preview': (msg.get('content', '') or '')[:200],
                'date': msg.get('timestamp', 0),
                'timestamp': msg.get('timestamp', 0),
                'has_html': 1 if msg.get('has_html') else 0
            })

        return jsonify({
            'success': True,
            'emails': formatted,
            'count': len(formatted),
            'new_count': saved,
            'method': fetch_result.get('method', 'Cloudflare')
        })
    else:
        # GPTMail: Keep the original logic
        api_messages = get_temp_emails_from_api(email_addr)

        if api_messages is not None:
            saved = save_temp_email_messages(email_addr, api_messages)
            messages = get_temp_email_messages(email_addr)

            formatted = []
            for msg in messages:
                formatted.append({
                    'id': msg.get('message_id'),
                    'from': msg.get('from_address', 'Unknown'),
                    'subject': msg.get('subject', 'No topic'),
                    'body_preview': (msg.get('content', '') or '')[:200],
                    'date': msg.get('created_at', ''),
                    'timestamp': msg.get('timestamp', 0),
                    'has_html': msg.get('has_html', 0)
                })

            return jsonify({
                'success': True,
                'emails': formatted,
                'count': len(formatted),
                'new_count': saved,
                'method': 'GPTMail'
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to get mail'})
