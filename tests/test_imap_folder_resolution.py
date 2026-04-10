import importlib
import json
import os
import tempfile
import unittest
from unittest.mock import patch


os.environ.setdefault('SECRET_KEY', 'test-secret-key')
_temp_dir = tempfile.mkdtemp(prefix='outlookEmail-tests-')
os.environ['DATABASE_PATH'] = os.path.join(_temp_dir, 'test.db')

web_outlook_app = importlib.import_module('web_outlook_app')


class FakeMail:
    def __init__(self, selectable=None, list_entries=None, selectable_by_mode=None):
        self.selectable = set(selectable or [])
        self.selectable_by_mode = dict(selectable_by_mode or {})
        self.list_entries = list_entries or []
        self.select_calls = []
        self.logged_out = False
        self.xatom_calls = []

    def login(self, *_args, **_kwargs):
        return 'OK', [b'logged in']

    def xatom(self, name, *args):
        self.xatom_calls.append((name, args))
        return 'OK', [b'ID completed']

    def select(self, name, readonly=True):
        self.select_calls.append((name, readonly))
        if (name, readonly) in self.selectable_by_mode:
            return self.selectable_by_mode[(name, readonly)]
        if name in self.selectable:
            return 'OK', [b'']
        return 'NO', [b'folder not found']

    def list(self):
        return 'OK', self.list_entries

    def uid(self, *_args, **_kwargs):
        return 'OK', [b'']

    def logout(self):
        self.logged_out = True
        return 'BYE', [b'logout']


class ImapFolderResolutionTests(unittest.TestCase):
    def test_parse_outlook_import_default_order(self):
        parsed = web_outlook_app.parse_outlook_account_string(
            'user@outlook.com----password123----24d9a0ed-8787-4584-883c-2fd79308940a----0.AXEA_refresh',
            'client_id_refresh_token',
        )

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed['client_id'], '24d9a0ed-8787-4584-883c-2fd79308940a')
        self.assertEqual(parsed['refresh_token'], '0.AXEA_refresh')

    def test_parse_outlook_import_reversed_order_even_when_selector_is_default(self):
        parsed = web_outlook_app.parse_outlook_account_string(
            'user@outlook.com----password123----0.AXEA_refresh----24d9a0ed-8787-4584-883c-2fd79308940a',
            'client_id_refresh_token',
        )

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed['client_id'], '24d9a0ed-8787-4584-883c-2fd79308940a')
        self.assertEqual(parsed['refresh_token'], '0.AXEA_refresh')

    def test_resolve_126_inbox_from_listed_folder(self):
        mail = FakeMail(
            selectable={'INBOX.收件箱'},
            list_entries=[
                b'(\\HasNoChildren) "." "INBOX.Archive"',
                '(\\HasNoChildren) "." "INBOX.收件箱"'.encode('utf-8'),
            ],
        )

        selected, diagnostics = web_outlook_app.resolve_imap_folder(mail, '126', 'inbox', readonly=True)

        self.assertEqual(selected, 'INBOX.收件箱')
        self.assertIn('INBOX.收件箱', diagnostics.get('matched_folders', []))
        self.assertNotIn('INBOX.Archive', diagnostics.get('matched_folders', []))

    def test_resolve_junk_folder_from_terminal_alias(self):
        mail = FakeMail(
            selectable={'INBOX.Spam'},
            list_entries=[b'(\\HasNoChildren) "." "INBOX.Spam"'],
        )

        selected, diagnostics = web_outlook_app.resolve_imap_folder(mail, 'custom', 'junkemail', readonly=True)

        self.assertEqual(selected, 'INBOX.Spam')
        self.assertEqual(diagnostics.get('matched_folders'), ['INBOX.Spam'])

    def test_imap_folder_not_found_returns_available_folders(self):
        mail = FakeMail(
            selectable=set(),
            list_entries=[b'(\\HasNoChildren) "." "INBOX"', b'(\\HasNoChildren) "." "INBOX.Archive"'],
        )

        with patch.object(web_outlook_app, 'create_imap_connection', return_value=mail):
            result = web_outlook_app.get_emails_imap_generic(
                email_addr='user@example.com',
                imap_password='secret',
                imap_host='imap.example.com',
                folder='deleteditems',
                provider='custom',
            )

        self.assertFalse(result['success'])
        self.assertEqual(result['error_code'], 'IMAP_FOLDER_NOT_FOUND')
        details = json.loads(result['error']['details'])
        self.assertEqual(details['folder'], 'deleteditems')
        self.assertEqual(details['provider'], 'custom')
        self.assertEqual(details['available_folders'], ['INBOX', 'INBOX.Archive'])
        self.assertTrue(mail.logged_out)

    def test_fallback_from_examine_to_select_for_126_inbox(self):
        mail = FakeMail(
            selectable_by_mode={
                ('INBOX', True): ('NO', [b'EXAMINE not supported']),
                ('"INBOX"', True): ('NO', [b'EXAMINE not supported']),
                ('INBOX', False): ('OK', [b'12']),
            },
            list_entries=[b'(\\HasNoChildren) "." "INBOX"'],
        )

        selected, diagnostics = web_outlook_app.resolve_imap_folder(mail, '126', 'inbox', readonly=True)

        self.assertEqual(selected, 'INBOX')
        self.assertEqual(diagnostics.get('fallback_mode'), 'select')
        self.assertIn(('INBOX', True), mail.select_calls)
        self.assertIn(('INBOX', False), mail.select_calls)

    def test_unsafe_login_is_classified_as_provider_block(self):
        unsafe = "Unsafe Login. Please contact kefu@188.com for help"
        mail = FakeMail(
            selectable_by_mode={
                ('INBOX', True): ('NO', [unsafe.encode('utf-8')]),
                ('"INBOX"', True): ('NO', [unsafe.encode('utf-8')]),
                ('INBOX', False): ('NO', [unsafe.encode('utf-8')]),
                ('"INBOX"', False): ('NO', [unsafe.encode('utf-8')]),
            },
            list_entries=[b'(\\HasNoChildren) "." "INBOX"'],
        )

        with patch.object(web_outlook_app, 'create_imap_connection', return_value=mail):
            result = web_outlook_app.get_emails_imap_generic(
                email_addr='user@126.com',
                imap_password='secret',
                imap_host='imap.126.com',
                folder='inbox',
                provider='126',
            )

        self.assertFalse(result['success'])
        self.assertEqual(result['error_code'], 'IMAP_UNSAFE_LOGIN_BLOCKED')
        self.assertEqual(result['error']['status'], 403)
        self.assertEqual(result['error']['code'], 'IMAP_UNSAFE_LOGIN_BLOCKED')
        self.assertIn('Unsafe Login', result['error']['message'])
        self.assertEqual(mail.xatom_calls[0][0], 'ID')

    def test_send_imap_id_after_login(self):
        mail = FakeMail(
            selectable={'INBOX'},
            list_entries=[b'(\\HasNoChildren) "." "INBOX"'],
        )

        with patch.object(web_outlook_app, 'create_imap_connection', return_value=mail):
            result = web_outlook_app.get_emails_imap_generic(
                email_addr='user@126.com',
                imap_password='secret',
                imap_host='imap.126.com',
                folder='inbox',
                provider='126',
            )

        self.assertTrue(result['success'])
        self.assertEqual(mail.xatom_calls[0][0], 'ID')
        payload = mail.xatom_calls[0][1][0]
        self.assertIn('"name" "outlookEmail"', payload)
        self.assertIn('"version"', payload)


class ExternalAccountsApiTests(unittest.TestCase):
    def setUp(self):
        self.app = web_outlook_app.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

        with self.app.app_context():
            db = web_outlook_app.get_db()
            db.execute('DELETE FROM account_tags')
            db.execute('DELETE FROM account_aliases')
            db.execute('DELETE FROM account_refresh_logs')
            db.execute('DELETE FROM accounts')
            db.execute('DELETE FROM tags')
            db.execute("DELETE FROM groups WHERE name NOT IN ('默认分组', '临时邮箱')")
            db.commit()

            self.assertTrue(web_outlook_app.set_setting('external_api_key', 'test-external-key'))

            tag_id = web_outlook_app.add_tag('核心', '#1a1a1a')
            self.assertIsNotNone(tag_id)

            added = web_outlook_app.add_account(
                'user@outlook.com',
                'password123',
                '24d9a0ed-8787-4584-883c-2fd79308940a',
                '0.AXEA_refresh',
                group_id=1,
                remark='主账号',
                forward_enabled=True
            )
            self.assertTrue(added)

            account = web_outlook_app.get_account_by_email('user@outlook.com')
            self.assertIsNotNone(account)

            alias_ok, _, alias_errors = web_outlook_app.replace_account_aliases(
                account['id'],
                account['email'],
                ['alias@example.com'],
                db
            )
            self.assertTrue(alias_ok, alias_errors)
            db.commit()

            self.assertTrue(web_outlook_app.add_account_tag(account['id'], tag_id))
            db.execute(
                '''
                INSERT INTO account_refresh_logs (account_id, account_email, refresh_type, status, error_message)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (account['id'], account['email'], 'manual', 'success', None)
            )
            db.commit()

    def test_external_accounts_requires_api_key(self):
        response = self.client.get('/api/external/accounts')

        self.assertEqual(response.status_code, 401)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('API Key', payload['error'])

    def test_external_accounts_returns_sanitized_accounts(self):
        with self.app.app_context():
            group_id = web_outlook_app.add_group('代理组', '带代理的账号', '#123456')
            self.assertIsNotNone(group_id)
            added = web_outlook_app.add_account(
                'other@example.com',
                'password456',
                '',
                '',
                group_id=group_id,
                remark='次账号',
                account_type='imap',
                provider='custom',
                imap_host='imap.example.com',
                imap_port=993,
                imap_password='imap-secret',
                forward_enabled=False
            )
            self.assertTrue(added)

        response = self.client.get(
            '/api/external/accounts?group_id=1',
            headers={'X-API-Key': 'test-external-key'}
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['total'], 1)
        self.assertEqual(len(payload['accounts']), 1)

        account = payload['accounts'][0]
        self.assertEqual(account['email'], 'user@outlook.com')
        self.assertEqual(account['aliases'], ['alias@example.com'])
        self.assertEqual(account['alias_count'], 1)
        self.assertEqual(account['group_id'], 1)
        self.assertEqual(account['group_name'], '默认分组')
        self.assertEqual(account['remark'], '主账号')
        self.assertEqual(account['status'], 'active')
        self.assertEqual(account['provider'], 'outlook')
        self.assertTrue(account['forward_enabled'])
        self.assertEqual(account['last_refresh_status'], 'success')
        self.assertIsNone(account['last_refresh_error'])
        self.assertEqual(account['tags'][0]['name'], '核心')
        self.assertNotIn('password', account)
        self.assertNotIn('refresh_token', account)
        self.assertNotIn('client_id', account)
        self.assertNotIn('imap_host', account)
        self.assertNotIn('imap_port', account)


class BatchForwardingApiTests(unittest.TestCase):
    def setUp(self):
        self.app = web_outlook_app.app
        self.app.config['TESTING'] = True
        self.app.config['WTF_CSRF_ENABLED'] = False
        self.client = self.app.test_client()

        with self.client.session_transaction() as sess:
            sess['logged_in'] = True

        with self.app.app_context():
            db = web_outlook_app.get_db()
            db.execute('DELETE FROM account_tags')
            db.execute('DELETE FROM account_aliases')
            db.execute('DELETE FROM account_refresh_logs')
            db.execute('DELETE FROM accounts')
            db.execute('DELETE FROM tags')
            db.execute("DELETE FROM groups WHERE name NOT IN ('默认分组', '临时邮箱')")
            db.commit()

            self.assertTrue(web_outlook_app.add_account(
                'disabled-forward@outlook.com',
                'password123',
                'client-id-disabled',
                'refresh-token-disabled',
                group_id=1,
                forward_enabled=False
            ))
            self.assertTrue(web_outlook_app.add_account(
                'enabled-forward@outlook.com',
                'password123',
                'client-id-enabled',
                'refresh-token-enabled',
                group_id=1,
                forward_enabled=True
            ))

            disabled_account = web_outlook_app.get_account_by_email('disabled-forward@outlook.com')
            enabled_account = web_outlook_app.get_account_by_email('enabled-forward@outlook.com')
            self.assertIsNotNone(disabled_account)
            self.assertIsNotNone(enabled_account)

            self.disabled_account_id = disabled_account['id']
            self.enabled_account_id = enabled_account['id']
            self.disabled_cursor_before = disabled_account.get('forward_last_checked_at')
            self.enabled_cursor_before = enabled_account.get('forward_last_checked_at')

    def test_batch_enable_forwarding_only_updates_disabled_accounts(self):
        response = self.client.post(
            '/api/accounts/batch-update-forwarding',
            json={
                'account_ids': [self.disabled_account_id, self.enabled_account_id],
                'forward_enabled': True,
            }
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['updated_count'], 1)
        self.assertEqual(payload['unchanged_count'], 1)

        with self.app.app_context():
            disabled_account = web_outlook_app.get_account_by_id(self.disabled_account_id)
            enabled_account = web_outlook_app.get_account_by_id(self.enabled_account_id)

        self.assertTrue(disabled_account['forward_enabled'])
        self.assertTrue(disabled_account['forward_last_checked_at'])
        self.assertEqual(enabled_account['forward_last_checked_at'], self.enabled_cursor_before)

    def test_batch_disable_forwarding_only_updates_enabled_accounts(self):
        response = self.client.post(
            '/api/accounts/batch-update-forwarding',
            json={
                'account_ids': [self.disabled_account_id, self.enabled_account_id],
                'forward_enabled': False,
            }
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['updated_count'], 1)
        self.assertEqual(payload['unchanged_count'], 1)

        with self.app.app_context():
            disabled_account = web_outlook_app.get_account_by_id(self.disabled_account_id)
            enabled_account = web_outlook_app.get_account_by_id(self.enabled_account_id)

        self.assertFalse(disabled_account['forward_enabled'])
        self.assertEqual(disabled_account['forward_last_checked_at'], self.disabled_cursor_before)
        self.assertFalse(enabled_account['forward_enabled'])
        self.assertEqual(enabled_account['forward_last_checked_at'], self.enabled_cursor_before)


if __name__ == '__main__':
    unittest.main()
