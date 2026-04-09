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


if __name__ == '__main__':
    unittest.main()
