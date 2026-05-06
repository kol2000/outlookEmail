from __future__ import annotations

import http.client
import json
import os
import socket
import threading
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, Optional, Tuple
from urllib.parse import quote, urlencode

if TYPE_CHECKING:
    from web_outlook_app import *  # noqa: F403


DOCKER_UPDATE_STATE_LOCK = threading.Lock()
DOCKER_UPDATE_STATE: Dict[str, Any] = {
    'running': False,
    'started_at': None,
    'finished_at': None,
    'success': None,
    'message': '',
    'error': '',
    'container_id': '',
}


def _env_flag(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _docker_update_api_version() -> str:
    version = os.getenv('DOCKER_UPDATE_API_VERSION', 'v1.41').strip()
    return version if version.startswith('v') else f'v{version}'


def _docker_update_socket_path() -> str:
    return os.getenv('DOCKER_UPDATE_SOCKET', '/var/run/docker.sock').strip() or '/var/run/docker.sock'


def _docker_update_container_name() -> str:
    configured = os.getenv('DOCKER_UPDATE_CONTAINER', '').strip()
    if configured:
        return configured
    hostname = os.getenv('HOSTNAME', '').strip()
    return hostname or 'outlook-mail-reader'


def _docker_update_watchtower_image() -> str:
    return os.getenv('DOCKER_UPDATE_WATCHTOWER_IMAGE', 'containrrr/watchtower:latest').strip() or 'containrrr/watchtower:latest'


def _docker_update_timeout_seconds() -> int:
    try:
        timeout = int(os.getenv('DOCKER_UPDATE_TIMEOUT', '300'))
    except ValueError:
        timeout = 300
    return min(max(timeout, 30), 1800)


def get_docker_update_config() -> Dict[str, Any]:
    socket_path = _docker_update_socket_path()
    socket_supported = hasattr(socket, 'AF_UNIX')
    socket_exists = socket_supported and os.path.exists(socket_path)
    enabled = _env_flag('DOCKER_UPDATE_ENABLED', False)
    container_name = _docker_update_container_name()
    reason = ''
    if not enabled:
        reason = 'Docker update is disabled'
    elif not socket_supported:
        reason = 'Unix docker socket is not supported on this platform'
    elif not socket_exists:
        reason = f'Docker socket not found: {socket_path}'
    elif not container_name:
        reason = 'Docker update container name is empty'

    return {
        'enabled': enabled,
        'available': enabled and socket_exists and bool(container_name),
        'reason': reason,
        'socket_path': socket_path,
        'container': container_name,
        'watchtower_image': _docker_update_watchtower_image(),
        'api_version': _docker_update_api_version(),
        'timeout_seconds': _docker_update_timeout_seconds(),
    }


def get_docker_update_state() -> Dict[str, Any]:
    with DOCKER_UPDATE_STATE_LOCK:
        return dict(DOCKER_UPDATE_STATE)


def _update_docker_update_state(**changes: Any) -> Dict[str, Any]:
    with DOCKER_UPDATE_STATE_LOCK:
        DOCKER_UPDATE_STATE.update(changes)
        return dict(DOCKER_UPDATE_STATE)


class _DockerUnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: int):
        super().__init__('localhost', timeout=timeout)
        self.socket_path = socket_path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self.socket_path)
        self.sock = sock


def _read_docker_api_body(response: http.client.HTTPResponse) -> str:
    return response.read().decode('utf-8', errors='replace')


def _docker_api_request(
    method: str,
    path: str,
    *,
    socket_path: str,
    api_version: str,
    body: Optional[Dict[str, Any]] = None,
    timeout: int,
) -> Tuple[int, str]:
    request_body = None
    headers = {'Host': 'docker'}
    if body is not None:
        request_body = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = str(len(request_body))
    elif method.upper() in {'POST', 'PUT', 'PATCH'}:
        headers['Content-Length'] = '0'

    versioned_path = f'/{api_version}{path}'
    connection = _DockerUnixHTTPConnection(socket_path, timeout=timeout)
    try:
        connection.request(method, versioned_path, body=request_body, headers=headers)
        response = connection.getresponse()
        return response.status, _read_docker_api_body(response)
    finally:
        connection.close()


def _split_image_reference(image_ref: str) -> Tuple[str, str]:
    slash_index = image_ref.rfind('/')
    colon_index = image_ref.rfind(':')
    if colon_index > slash_index:
        return image_ref[:colon_index], image_ref[colon_index + 1:]
    return image_ref, 'latest'


def build_watchtower_create_payload(
    *,
    container_name: str,
    socket_path: str,
    watchtower_image: str,
) -> Dict[str, Any]:
    return {
        'Image': watchtower_image,
        'Cmd': ['--run-once', '--cleanup', container_name],
        'Env': [f'DOCKER_HOST=unix://{socket_path}'],
        'HostConfig': {
            'AutoRemove': True,
            'Binds': [f'{socket_path}:{socket_path}'],
        },
    }


def _docker_pull_stream_error(body: str) -> str:
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue

        error_detail = payload.get('errorDetail')
        detail_message = ''
        if isinstance(error_detail, dict):
            detail_message = str(error_detail.get('message') or '').strip()

        error_message = str(payload.get('error') or '').strip()
        if error_message or detail_message:
            return error_message or detail_message

    return ''


def _ensure_watchtower_image(config: Dict[str, Any]) -> None:
    image_name, image_tag = _split_image_reference(config['watchtower_image'])
    query = urlencode({'fromImage': image_name, 'tag': image_tag})
    status, body = _docker_api_request(
        'POST',
        f'/images/create?{query}',
        socket_path=config['socket_path'],
        api_version=config['api_version'],
        timeout=config['timeout_seconds'],
    )
    if status < 200 or status >= 300:
        raise RuntimeError(f'Failed to pull watchtower image: HTTP {status} {body}')
    stream_error = _docker_pull_stream_error(body)
    if stream_error:
        raise RuntimeError(f'Failed to pull watchtower image: {stream_error}')


def _create_watchtower_container(config: Dict[str, Any]) -> str:
    container_suffix = str(int(time.time()))
    container_name = f'outlookemail-watchtower-update-{container_suffix}'
    payload = build_watchtower_create_payload(
        container_name=config['container'],
        socket_path=config['socket_path'],
        watchtower_image=config['watchtower_image'],
    )
    status, body = _docker_api_request(
        'POST',
        f'/containers/create?{urlencode({"name": container_name})}',
        socket_path=config['socket_path'],
        api_version=config['api_version'],
        body=payload,
        timeout=config['timeout_seconds'],
    )
    if status not in {201, 202}:
        raise RuntimeError(f'Failed to create watchtower container: HTTP {status} {body}')

    try:
        payload_body = json.loads(body or '{}')
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Invalid docker create response: {body}') from exc

    container_id = str(payload_body.get('Id') or '').strip()
    if not container_id:
        raise RuntimeError(f'Docker create response did not include a container id: {body}')
    return container_id


def _start_watchtower_container(config: Dict[str, Any], container_id: str) -> None:
    status, body = _docker_api_request(
        'POST',
        f'/containers/{quote(container_id, safe="")}/start',
        socket_path=config['socket_path'],
        api_version=config['api_version'],
        timeout=config['timeout_seconds'],
    )
    if status not in {204, 304}:
        raise RuntimeError(f'Failed to start watchtower container: HTTP {status} {body}')


def run_docker_update_job(config: Dict[str, Any]) -> None:
    _update_docker_update_state(
        running=True,
        started_at=datetime.now(timezone.utc).isoformat(),
        finished_at=None,
        success=None,
        message='Pulling watchtower image',
        error='',
        container_id='',
    )
    try:
        _ensure_watchtower_image(config)
        _update_docker_update_state(message='Creating watchtower update container')
        container_id = _create_watchtower_container(config)
        _update_docker_update_state(
            message='Starting watchtower update container',
            container_id=container_id,
        )
        _start_watchtower_container(config, container_id)
        _update_docker_update_state(
            running=False,
            finished_at=datetime.now(timezone.utc).isoformat(),
            success=True,
            message='Docker update task started. The service may restart shortly.',
            error='',
            container_id=container_id,
        )
    except Exception as exc:
        _update_docker_update_state(
            running=False,
            finished_at=datetime.now(timezone.utc).isoformat(),
            success=False,
            message='Docker update failed',
            error=str(exc),
        )


def start_docker_update_job(config: Dict[str, Any]) -> Tuple[bool, str]:
    with DOCKER_UPDATE_STATE_LOCK:
        if DOCKER_UPDATE_STATE.get('running'):
            return False, 'Docker update is already running'
        DOCKER_UPDATE_STATE.update({
            'running': True,
            'started_at': datetime.now(timezone.utc).isoformat(),
            'finished_at': None,
            'success': None,
            'message': 'Docker update queued',
            'error': '',
            'container_id': '',
        })

    thread = threading.Thread(
        target=run_docker_update_job,
        args=(dict(config),),
        name='docker-update',
        daemon=True,
    )
    thread.start()
    return True, 'Docker update task queued'


@app.route('/api/docker-update/status', methods=['GET'])
@login_required
def api_get_docker_update_status():
    return jsonify({
        'success': True,
        'docker_update': {
            **get_docker_update_config(),
            'state': get_docker_update_state(),
        },
    })


@app.route('/api/docker-update', methods=['POST'])
@login_required
def api_start_docker_update():
    config = get_docker_update_config()
    if not config['enabled']:
        return jsonify({'success': False, 'error': config['reason']}), 403
    if not config['available']:
        return jsonify({'success': False, 'error': config['reason']}), 503

    started, message = start_docker_update_job(config)
    if not started:
        return jsonify({'success': False, 'error': message, 'docker_update': get_docker_update_state()}), 409

    return jsonify({
        'success': True,
        'message': message,
        'docker_update': {
            **config,
            'state': get_docker_update_state(),
        },
    }), 202
