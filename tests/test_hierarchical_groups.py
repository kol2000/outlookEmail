import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path


os.environ.setdefault('SECRET_KEY', 'test-secret-key')
if 'DATABASE_PATH' not in os.environ:
    _temp_dir = tempfile.mkdtemp(prefix='outlookEmail-hierarchical-groups-')
    os.environ['DATABASE_PATH'] = os.path.join(_temp_dir, 'test.db')

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

web_outlook_app = importlib.import_module('web_outlook_app')


class HierarchicalGroupTests(unittest.TestCase):
    def setUp(self):
        self.app = web_outlook_app.app
        self.app.config['TESTING'] = True
        self.app.config['WTF_CSRF_ENABLED'] = False
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['logged_in'] = True

        with self.app.app_context():
            web_outlook_app.init_db()
            db = web_outlook_app.get_db()
            db.execute('DELETE FROM project_account_events')
            db.execute('DELETE FROM project_accounts')
            db.execute('DELETE FROM project_group_scopes')
            db.execute('DELETE FROM projects')
            db.execute('DELETE FROM account_aliases')
            db.execute('DELETE FROM account_tags')
            db.execute('DELETE FROM tags')
            db.execute('DELETE FROM accounts')
            db.execute('DELETE FROM temp_email_tags')
            db.execute('DELETE FROM temp_email_messages')
            db.execute('DELETE FROM temp_emails')
            db.execute("DELETE FROM groups WHERE name NOT IN ('\u9ed8\u8ba4\u5206\u7ec4', '\u4e34\u65f6\u90ae\u7bb1')")
            db.execute(
                "UPDATE groups SET parent_id = NULL, level = 1, proxy_url = '', fallback_proxy_url_1 = '', fallback_proxy_url_2 = '' WHERE name IN ('\u9ed8\u8ba4\u5206\u7ec4', '\u4e34\u65f6\u90ae\u7bb1')"
            )
            db.commit()

    def _insert_account(self, email_addr, group_id):
        db = web_outlook_app.get_db()
        cursor = db.execute(
            'INSERT INTO accounts (email, group_id, account_type, provider) VALUES (?, ?, ?, ?)',
            (email_addr, group_id, 'outlook', 'outlook'),
        )
        db.commit()
        return int(cursor.lastrowid)

    def test_schema_contains_hierarchy_columns_and_parent_index(self):
        with self.app.app_context():
            db = web_outlook_app.get_db()
            group_columns = {row[1] for row in db.execute('PRAGMA table_info(groups)').fetchall()}
            index_names = {row[1] for row in db.execute('PRAGMA index_list(groups)').fetchall()}

        self.assertIn('parent_id', group_columns)
        self.assertIn('level', group_columns)
        self.assertIn('idx_groups_parent_id', index_names)

    def test_three_level_groups_direct_accounts_proxy_and_delete(self):
        with self.app.app_context():
            root_id = web_outlook_app.add_group('Customer A')
            second_id = web_outlook_app.add_group('Project 1', parent_id=root_id)
            third_id = web_outlook_app.add_group('Subclass 1', parent_id=second_id)

            self.assertIsNotNone(root_id)
            self.assertIsNotNone(second_id)
            self.assertIsNotNone(third_id)
            self.assertIsNone(web_outlook_app.add_group('More than level three', parent_id=third_id))

            root = web_outlook_app.get_group_by_id(root_id)
            second = web_outlook_app.get_group_by_id(second_id)
            third = web_outlook_app.get_group_by_id(third_id)
            self.assertEqual(root['level'], 1)
            self.assertIsNone(root['parent_id'])
            self.assertEqual(second['level'], 2)
            self.assertEqual(second['parent_id'], root_id)
            self.assertEqual(third['level'], 3)
            self.assertEqual(third['parent_id'], second_id)

            self._insert_account('root@example.com', root_id)
            self._insert_account('second@example.com', second_id)
            self._insert_account('third@example.com', third_id)
            self.assertEqual(web_outlook_app.get_descendant_group_ids(root_id), [root_id, second_id, third_id])
            self.assertEqual(web_outlook_app.count_accounts(root_id), 3)
            self.assertEqual(web_outlook_app.get_group_account_count(root_id, recursive=True), 3)
            self.assertEqual(
                [account['email'] for account in web_outlook_app.load_accounts(root_id, sort_by='email', sort_order='asc')],
                ['root@example.com', 'second@example.com', 'third@example.com'],
            )
            self.assertEqual(
                [account['email'] for account in web_outlook_app.search_account_records('example.com', group_id=second_id, sort_by='email', sort_order='asc')],
                ['second@example.com', 'third@example.com'],
            )

            db = web_outlook_app.get_db()
            db.execute('UPDATE groups SET proxy_url = ? WHERE id = ?', ('http://root-proxy:8080', root_id))
            db.commit()
            third_account = web_outlook_app.get_account_by_email('third@example.com')
            self.assertEqual(web_outlook_app.get_account_proxy_url(third_account), 'http://root-proxy:8080')

            delete_result = web_outlook_app.delete_group_tree(root_id)
            self.assertTrue(delete_result['success'])
            self.assertEqual(delete_result['deleted_child_count'], 2)
            self.assertIsNone(web_outlook_app.get_group_by_id(second_id))
            self.assertEqual(web_outlook_app.get_account_by_email('third@example.com')['group_id'], 1)

    def test_group_export_recursively_includes_child_accounts_without_duplicates(self):
        with self.app.app_context():
            root_id = web_outlook_app.add_group('Export parent group')
            child_id = web_outlook_app.add_group('Export subgroup', parent_id=root_id)
            grandchild_id = web_outlook_app.add_group('Export grandchild group', parent_id=child_id)
            self._insert_account('export-root@example.com', root_id)
            self._insert_account('export-child@example.com', child_id)
            self._insert_account('export-grandchild@example.com', grandchild_id)

            export_payload = web_outlook_app.build_group_export_content([root_id])
            overlapping_export_payload = web_outlook_app.build_group_export_content([root_id, child_id])
            all_groups_payload = web_outlook_app.build_all_groups_export_content()

        self.assertEqual(export_payload['total_count'], 3)
        self.assertIn('export-root@example.com', export_payload['content'])
        self.assertIn('export-child@example.com', export_payload['content'])
        self.assertIn('export-grandchild@example.com', export_payload['content'])
        self.assertEqual(overlapping_export_payload['total_count'], 3)
        self.assertEqual(overlapping_export_payload['content'].count('export-child@example.com'), 1)
        self.assertEqual(overlapping_export_payload['content'].count('export-grandchild@example.com'), 1)
        self.assertEqual(all_groups_payload['total_count'], 3)

    def test_api_parent_validation_and_group_payload(self):
        with self.app.app_context():
            temp_group = next(group for group in web_outlook_app.load_groups() if group['name'] == '\u4e34\u65f6\u90ae\u7bb1')

        blocked = self.client.post('/api/groups', json={'name': 'Temporary mailbox subgroup', 'parent_id': temp_group['id']}).get_json()
        self.assertFalse(blocked['success'])
        self.assertIn('Temporary mailbox', blocked['error'])

        created_root = self.client.post(
            '/api/groups',
            json={'name': 'Interface root group', 'description': 'Interface root group description'},
        ).get_json()
        self.assertTrue(created_root['success'])
        root_id = created_root['group_id']

        created_child = self.client.post('/api/groups', json={'name': 'Interface subgroup', 'parent_id': root_id}).get_json()
        self.assertTrue(created_child['success'])
        child_id = created_child['group_id']

        groups_payload = self.client.get('/api/groups').get_json()
        root_group = next(group for group in groups_payload['groups'] if group['id'] == root_id)
        child_group = next(group for group in groups_payload['groups'] if group['id'] == child_id)
        self.assertEqual(root_group['description'], 'Interface root group description')
        self.assertEqual(child_group['parent_id'], root_id)
        self.assertEqual(child_group['level'], 2)
        self.assertIn('descendant_account_count', child_group)

    def test_default_group_cannot_move_or_be_deleted_through_ancestor(self):
        with self.app.app_context():
            parent_id = web_outlook_app.add_group('Protect parent by default')

            moved = web_outlook_app.update_group(
                1,
                '\u9ed8\u8ba4\u5206\u7ec4',
                '',
                '#1a1a1a',
                parent_id=parent_id,
            )
            self.assertFalse(moved)

            db = web_outlook_app.get_db()
            db.execute('UPDATE groups SET parent_id = ?, level = 2 WHERE id = 1', (parent_id,))
            db.commit()

            delete_result = web_outlook_app.delete_group_tree(parent_id)
            self.assertFalse(delete_result['success'])
            self.assertIn('default group', delete_result['error'])
            self.assertIsNotNone(web_outlook_app.get_group_by_id(1))
            self.assertIsNotNone(web_outlook_app.get_group_by_id(parent_id))

    def test_default_group_edit_without_parent_change_succeeds(self):
        'When editing the default group, the front end will submit parent_id=null and should not falsely report "unmovable".'
        with self.app.app_context():
            ok, err = web_outlook_app.validate_group_move(1, None)
            self.assertTrue(ok, err)

            updated = web_outlook_app.update_group(
                1,
                '\u9ed8\u8ba4\u5206\u7ec4',
                'Ungrouped mailboxes - updated',
                '#666666',
                proxy_url='socks5h://outlook.{mail}:tok@127.0.0.1:2260',
                parent_id=None,
            )
            self.assertTrue(updated)
            group = web_outlook_app.get_group_by_id(1)
            self.assertEqual(group['description'], 'Ungrouped mailboxes - updated')
            self.assertEqual(group['proxy_url'], 'socks5h://outlook.{mail}:tok@127.0.0.1:2260')
            self.assertIsNone(group['parent_id'])

        response = self.client.put(
            '/api/groups/1',
            json={
                'name': '\u9ed8\u8ba4\u5206\u7ec4',
                'description': 'API edit description',
                'color': '#666666',
                'proxy_url': 'socks5h://host:1080',
                'parent_id': None,
            },
        )
        payload = response.get_json()
        self.assertTrue(payload['success'], payload)
        self.assertNotIn('Not removable', payload.get('error') or '')

        with self.app.app_context():
            group = web_outlook_app.get_group_by_id(1)
            self.assertEqual(group['description'], 'API edit description')
            self.assertEqual(group['proxy_url'], 'socks5h://host:1080')

        # Real changes to the parent level should still be rejected
        with self.app.app_context():
            parent_id = web_outlook_app.add_group('Try to mount the default group')
            ok, err = web_outlook_app.validate_group_move(1, parent_id)
            self.assertFalse(ok)
            self.assertEqual(err, 'The default group cannot be moved')

    def test_project_group_scope_includes_descendant_groups(self):
        with self.app.app_context():
            root_id = web_outlook_app.add_group('Project parent group')
            child_id = web_outlook_app.add_group('Project subgroup', parent_id=root_id)
            other_id = web_outlook_app.add_group('Group outside project')
            self._insert_account('project-root@example.com', root_id)
            self._insert_account('project-child@example.com', child_id)
            self._insert_account('project-other@example.com', other_id)

        started = self.client.post(
            '/api/projects/start',
            json={'project_key': 'hier', 'name': 'Hierarchy items', 'group_ids': [root_id]},
        ).get_json()
        self.assertTrue(started['success'])
        self.assertEqual(started['data']['added_count'], 2)
        self.assertEqual(started['data']['total_count'], 2)

        filtered = self.client.get(
            '/api/projects/hier/accounts',
            query_string={'group_id': root_id},
        ).get_json()
        self.assertTrue(filtered['success'])
        self.assertEqual(
            {account['email'] for account in filtered['data']['accounts']},
            {'project-root@example.com', 'project-child@example.com'},
        )

    def test_external_accounts_group_filter_keeps_direct_group_scope(self):
        with self.app.app_context():
            self.assertTrue(web_outlook_app.set_setting('external_api_key', 'test-external-key'))
            root_id = web_outlook_app.add_group('External parent group')
            child_id = web_outlook_app.add_group('External subgroup', parent_id=root_id)
            self._insert_account('external-root@example.com', root_id)
            self._insert_account('external-child@example.com', child_id)

        internal = self.client.get('/api/accounts', query_string={'group_id': root_id}).get_json()
        self.assertTrue(internal['success'])
        self.assertEqual(
            {account['email'] for account in internal['accounts']},
            {'external-root@example.com', 'external-child@example.com'},
        )

        external = self.client.get(
            '/api/external/accounts',
            query_string={'group_id': root_id},
            headers={'X-API-Key': 'test-external-key'},
        ).get_json()
        self.assertTrue(external['success'])
        self.assertEqual(external['total'], 1)
        self.assertEqual(
            {account['email'] for account in external['accounts']},
            {'external-root@example.com'},
        )

    def test_frontend_contains_tree_group_controls(self):
        groups_js = (ROOT_DIR / 'static' / 'js' / 'index' / '02-groups.js').read_text(encoding='utf-8')
        accounts_js = (ROOT_DIR / 'static' / 'js' / 'index' / '04-accounts.js').read_text(encoding='utf-8')
        dialogs_html = (ROOT_DIR / 'templates' / 'partials' / 'index' / 'dialogs-primary.html').read_text(encoding='utf-8')
        layout_html = (ROOT_DIR / 'templates' / 'partials' / 'index' / 'layout.html').read_text(encoding='utf-8')
        layout_css = (ROOT_DIR / 'static' / 'css' / 'index' / '03-layout.css').read_text(encoding='utf-8')

        self.assertIn('function buildGroupTree', groups_js)
        self.assertIn('function renderGroupTree', groups_js)
        self.assertIn('GROUP_COLLAPSED_STORAGE_PREFIX', groups_js)
        self.assertIn('GROUP_DESCRIPTION_VISIBILITY_STORAGE_KEY', groups_js)
        self.assertIn('function toggleGroupDescriptionVisibility', groups_js)
        self.assertIn('showGroupDescriptions && groupDescription', groups_js)
        self.assertIn('parent_id: parentId', groups_js)
        self.assertIn('id="groupParentSelect"', dialogs_html)
        self.assertIn('id="groupDescriptionVisibilityBtn"', layout_html)
        self.assertIn('.group-item.level-3', layout_css)
        self.assertIn('.group-description', layout_css)
        self.assertIn('const isMovable = !isSystem && !isDefault', groups_js)
        self.assertIn('group.descendant_account_count ?? group.account_count ?? 0', groups_js)
        self.assertIn('syncExportGroupCheckboxStates', accounts_js)
        self.assertIn("document.querySelectorAll('.export-group-checkbox:checked')", accounts_js)
        self.assertNotIn('hasSelectedExportGroupHierarchyConflict', accounts_js)
