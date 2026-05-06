import importlib
import os
import pathlib
import shutil
import unittest
from unittest.mock import patch


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
os.environ.setdefault('SECRET_KEY', 'test-secret-key')
temp_dir = ROOT_DIR / '.tmp' / f'docker-update-tests-{os.getpid()}'
temp_dir.mkdir(parents=True, exist_ok=True)
os.environ['DATABASE_PATH'] = str(temp_dir / 'test.db')

web_outlook_app = importlib.import_module('web_outlook_app')


def tearDownModule():
    shutil.rmtree(temp_dir, ignore_errors=True)


class DockerUpdateTests(unittest.TestCase):
    def setUp(self):
        self.app = web_outlook_app.app
        self.app.config['TESTING'] = True
        self.app.config['WTF_CSRF_ENABLED'] = False
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['logged_in'] = True

    def test_status_is_disabled_by_default(self):
        with patch.dict(os.environ, {'DOCKER_UPDATE_ENABLED': 'false'}, clear=False):
            response = self.client.get('/api/docker-update/status')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertFalse(payload['docker_update']['enabled'])
        self.assertFalse(payload['docker_update']['available'])

    def test_start_requires_enabled_flag(self):
        with patch.dict(os.environ, {'DOCKER_UPDATE_ENABLED': 'false'}, clear=False):
            response = self.client.post('/api/docker-update', json={})

        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])

    def test_start_rejects_missing_docker_socket(self):
        with patch.dict(
            os.environ,
            {
                'DOCKER_UPDATE_ENABLED': 'true',
                'DOCKER_UPDATE_SOCKET': str(ROOT_DIR / '.tmp' / 'missing-docker.sock'),
                'DOCKER_UPDATE_CONTAINER': 'outlook-mail-reader',
            },
            clear=False,
        ):
            response = self.client.post('/api/docker-update', json={})

        self.assertEqual(response.status_code, 503)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertRegex(payload['error'], r'Docker socket|Unix docker socket')

    def test_watchtower_payload_targets_configured_container_only(self):
        payload = web_outlook_app.build_watchtower_create_payload(
            container_name='outlook-mail-reader',
            socket_path='/var/run/docker.sock',
            watchtower_image='containrrr/watchtower:latest',
        )

        self.assertEqual(payload['Image'], 'containrrr/watchtower:latest')
        self.assertEqual(payload['Cmd'], ['--run-once', '--cleanup', 'outlook-mail-reader'])
        self.assertEqual(payload['Env'], ['DOCKER_HOST=unix:///var/run/docker.sock'])
        self.assertEqual(payload['HostConfig']['Binds'], ['/var/run/docker.sock:/var/run/docker.sock'])
        self.assertTrue(payload['HostConfig']['AutoRemove'])

    def test_watchtower_payload_uses_custom_socket_for_docker_host(self):
        payload = web_outlook_app.build_watchtower_create_payload(
            container_name='outlook-mail-reader',
            socket_path='/custom/docker.sock',
            watchtower_image='containrrr/watchtower:latest',
        )

        self.assertEqual(payload['Env'], ['DOCKER_HOST=unix:///custom/docker.sock'])
        self.assertEqual(payload['HostConfig']['Binds'], ['/custom/docker.sock:/custom/docker.sock'])

    def test_docker_api_body_reads_full_stream(self):
        class FakeResponse:
            def read(self):
                return ('{"status":"pulling"}\n' + ('x' * 70000)).encode('utf-8')

        body = web_outlook_app._read_docker_api_body(FakeResponse())

        self.assertIn('{"status":"pulling"}', body)
        self.assertEqual(body.count('x'), 70000)
        self.assertNotIn('truncated', body)

    def test_ensure_watchtower_image_detects_stream_error(self):
        config = {
            'watchtower_image': 'containrrr/watchtower:latest',
            'socket_path': '/var/run/docker.sock',
            'api_version': 'v1.41',
            'timeout_seconds': 30,
        }
        stream_body = (
            '{"status":"Pulling from containrrr/watchtower"}\n'
            '{"errorDetail":{"message":"pull access denied"},"error":"pull access denied"}\n'
        )

        with patch.object(web_outlook_app, '_docker_api_request', return_value=(200, stream_body)):
            with self.assertRaisesRegex(RuntimeError, 'pull access denied'):
                web_outlook_app._ensure_watchtower_image(config)


if __name__ == '__main__':
    unittest.main()
