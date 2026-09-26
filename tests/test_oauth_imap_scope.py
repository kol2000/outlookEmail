'Test manual OAuth and use GraphAPI single resource permission by default (does not rely on complete application import)'
import ast
import pathlib


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
BOOTSTRAP_PATH = ROOT_DIR / 'outlook_web' / 'segments' / '01_bootstrap.py'
HELPERS_PATH = ROOT_DIR / 'outlook_web' / 'segments' / '03_mail_helpers.py'


def extract_assignment_value(path, name):
    'Extract constant assignments from source code.'
    tree = ast.parse(path.read_text(encoding='utf-8'))

    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    if isinstance(node.value, ast.List):
                        scopes = []
                        for element in node.value.elts:
                            if isinstance(element, ast.Constant):
                                scopes.append(element.value)
                        return scopes
                    if isinstance(node.value, ast.Constant):
                        return node.value.value
    return None


def extract_oauth_scopes_from_source():
    'Manual OAuth scope configuration extracted from source code.'
    return extract_assignment_value(BOOTSTRAP_PATH, 'OAUTH_SCOPES') or []


def extract_graph_oauth_scopes_from_source():
    'Extract Graph-specific scope configuration from source code.'
    return extract_assignment_value(BOOTSTRAP_PATH, 'OAUTH_GRAPH_SCOPES') or []


def scope_resource(scope):
    if scope == 'offline_access':
        return ''
    if scope.startswith('https://graph.microsoft.com/'):
        return 'https://graph.microsoft.com'
    if scope.startswith('https://outlook.office.com/'):
        return 'https://outlook.office.com'
    return scope.rsplit('/', 1)[0] if '/' in scope else scope


def test_manual_oauth_scopes_are_graph_api():
    'Manually authorize the default GraphAPI and cannot mix Outlook IMAP resources, otherwise AADSTS70011 will be triggered.'
    scopes = extract_oauth_scopes_from_source()
    expected = [
        "offline_access",
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
        "https://graph.microsoft.com/User.Read",
    ]

    assert scopes == expected, \
        f'Manual OAuth should request GraphAPI permissions by default, current configuration: {scopes}'


def test_oauth_scopes_contains_offline_access():
    'Verify that OAUTH_SCOPES contains offline_access (required to obtain RefreshToken)'
    scopes = extract_oauth_scopes_from_source()
    assert "offline_access" in scopes, \
        f'OAUTH_SCOPES must contain offline_access to obtain RefreshToken\nCurrent configuration: {scopes}'


def test_oauth_scopes_count():
    'Verify that OAUTH_SCOPES contains the expected number of permissions'
    scopes = extract_oauth_scopes_from_source()
    expected_count = 5  # offline_access + Mail.Read + Mail.ReadWrite + Mail.Send + User.Read
    assert len(scopes) == expected_count, \
        f'OAUTH_SCOPES should contain {expected_count} permissions, actual: {len(scopes)}\nCurrent configuration: {scopes}'


def test_oauth_scopes_has_no_duplicates():
    'Verify that OAUTH_SCOPES does not have duplicate permissions'
    scopes = extract_oauth_scopes_from_source()
    assert len(scopes) == len(set(scopes)), \
        f'OAUTH_SCOPES should not contain duplicate permissions: {scopes}'


def test_oauth_scopes_all_valid():
    'Verify that all permissions are valid strings'
    scopes = extract_oauth_scopes_from_source()
    assert all(isinstance(scope, str) and scope.strip() for scope in scopes), \
        f'All scopes should be non-empty strings: {scopes}'


def test_manual_oauth_scopes_do_not_mix_resource_hosts():
    'The scope of a single authorization request in OAuth v2 can only contain one resource host.'
    scopes = extract_oauth_scopes_from_source()
    resource_hosts = {scope_resource(scope) for scope in scopes if scope_resource(scope)}

    assert resource_hosts == {'https://graph.microsoft.com'}, \
        f'Manual OAuth scope cannot mix multiple resources: {scopes}'


def test_manual_oauth_scopes_align_with_graph_oauth_scopes():
    "Manual OAuth's Graph permissions should be consistent with OAUTH_GRAPH_SCOPES."
    scopes = extract_oauth_scopes_from_source()
    graph_scopes = extract_graph_oauth_scopes_from_source()

    assert set(scopes) - {'offline_access'} == set(graph_scopes), \
        f'Manual OAuth Graph permissions should be consistent with OAUTH_GRAPH_SCOPES: {scopes} vs {graph_scopes}'


def test_graph_oauth_scopes_include_read_write_send_and_user():
    'The Graph-specific scope must include reading, writing, sending, and User.Read.'
    graph_scopes = extract_graph_oauth_scopes_from_source()

    assert "https://graph.microsoft.com/Mail.Read" in graph_scopes
    assert "https://graph.microsoft.com/Mail.ReadWrite" in graph_scopes
    assert "https://graph.microsoft.com/Mail.Send" in graph_scopes
    assert "https://graph.microsoft.com/User.Read" in graph_scopes


def test_imap_token_scope_remains_imap_only():
    'IMAP token replacement path still only uses IMAP single resource, which is separated from manual Graph authorization.'
    imap_token_scope = extract_assignment_value(HELPERS_PATH, 'IMAP_TOKEN_SCOPE')
    assert imap_token_scope == "https://outlook.office.com/IMAP.AccessAsUser.All offline_access", \
        f'IMAP_TOKEN_SCOPE should remain IMAP single resource: {imap_token_scope}'


if __name__ == '__main__':
    print("\n" + "="*60)
    print('Start testing OAuth GraphAPI Scope configuration')
    print("="*60 + "\n")

    tests = [
        test_manual_oauth_scopes_are_graph_api,
        test_oauth_scopes_contains_offline_access,
        test_oauth_scopes_count,
        test_oauth_scopes_has_no_duplicates,
        test_oauth_scopes_all_valid,
        test_manual_oauth_scopes_do_not_mix_resource_hosts,
        test_manual_oauth_scopes_align_with_graph_oauth_scopes,
        test_graph_oauth_scopes_include_read_write_send_and_user,
        test_imap_token_scope_remains_imap_only,
    ]

    failed = 0
    for test in tests:
        try:
            test()
        except AssertionError as e:
            print(f"[FAIL] {test.__name__}: {e}")
            failed += 1

    print("\n" + "="*60)
    if failed == 0:
        print('[SUCCESS] All tests passed!')

        scopes = extract_oauth_scopes_from_source()
        print('\nCurrent OAUTH_SCOPES configuration:')
        for i, scope in enumerate(scopes, 1):
            print(f"  {i}. {scope}")
    else:
        print(f'[FAIL] {failed} tests failed')
    print("="*60 + "\n")
