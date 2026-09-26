import json
import re
from pathlib import Path

import pytest
from flask import Flask, Response, jsonify

from outlook_web.i18n import (
    catalog, get_locale, install, localize_payload, localize_sse,
    translate, translate_message,
)

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def localized_app(monkeypatch):
    monkeypatch.setenv('OUTLOOK_LANGUAGE', 'en')
    app = Flask(__name__, template_folder=str(ROOT / 'templates'))
    install(app)

    @app.get('/status')
    def status():
        return jsonify(error='登录失败', subject='登录失败', name='临时邮箱', body={'message': '登录失败'})

    @app.get('/stream')
    def stream():
        return Response(iter(['data: {"message": "登录失败"}\n\n']), mimetype='text/event-stream')

    return app


def test_language_precedence_and_invalid_values(localized_app):
    for headers, expected in [({}, 'en'), ({'Accept-Language': 'ru-RU, en;q=0.5'}, 'ru'),
                              ({'Cookie': 'outlook_language=ru'}, 'ru'),
                              ({'Cookie': 'outlook_language=ru', 'X-Outlook-Language': 'en'}, 'en'),
                              ({'Cookie': 'outlook_language=../../bad'}, 'en')]:
        with localized_app.test_request_context(headers=headers):
            assert get_locale() == expected


@pytest.mark.parametrize('language', ['en', 'ru'])
def test_only_status_fields_are_translated(localized_app, language):
    client = localized_app.test_client()
    response = client.get('/status', headers={'X-Outlook-Language': language})
    value = response.get_json()
    assert value['error'] == catalog(language)['登录失败']
    assert value['subject'] == '登录失败'
    assert value['name'] == '临时邮箱'
    assert value['body'] == {'message': '登录失败'}
    assert response.headers['Content-Language'] == language
    assert 'Cookie' in response.headers['Vary']


@pytest.mark.parametrize('language', ['en', 'ru'])
def test_substitution_does_not_translate_user_data(localized_app, language):
    key = '已清理 {__0__} 封普通邮箱本地缓存邮件'
    with localized_app.test_request_context(headers={'X-Outlook-Language': language}):
        output = translate(key, '你好 ${secret} $& <script>')
    assert '你好 ${secret} $& <script>' in output
    assert '{__0__}' not in output
    source = '已清理 123 封普通邮箱本地缓存邮件'
    assert translate_message(source, language) == catalog(language)[key].replace('{__0__}', '123')


def test_original_api_language_is_available(localized_app):
    response = localized_app.test_client().get('/status', headers={'X-Outlook-Language': 'zh-CN'})
    assert response.get_json()['error'] == '登录失败'


def test_nested_status_and_builtin_skin_names_preserve_custom_content():
    payload = {'error': {'message': '登录失败', 'code': 'LOGIN_FAILED'},
               'status': {'clear_status': {'message': '普通邮箱本地缓存清理空闲'}},
               'skins': [{'builtin': True, 'name': '经典'}, {'builtin': False, 'name': '经典'}]}
    localized = localize_payload(payload, 'ru')
    assert localized['error']['message'] == catalog('ru')['登录失败']
    assert localized['error']['code'] == 'LOGIN_FAILED'
    assert localized['status']['clear_status']['message'] == catalog('ru')['普通邮箱本地缓存清理空闲']
    assert localized['skins'][0]['name'] == catalog('ru')['经典']
    assert localized['skins'][1]['name'] == '经典'


def test_stream_handles_split_json_without_touching_mail(localized_app):
    chunks = ['data: {"mess', 'age": "登录失败", "subject": "登录失败"}\n', '\n', ': keepalive\n\n']
    text = ''.join(localize_sse(iter(chunks), 'ru'))
    value = json.loads(text.splitlines()[0][6:])
    assert value['message'] == catalog('ru')['登录失败']
    assert value['subject'] == '登录失败'
    assert text.endswith(': keepalive\n\n')
    encoded = 'data: {"message": "登录失败"}\n\n'.encode('utf-8')
    split_bytes = [encoded[i:i + 1] for i in range(len(encoded))]
    assert catalog('ru')['登录失败'] == json.loads(''.join(localize_sse(split_bytes, 'ru')).splitlines()[0][6:])['message']
    response = localized_app.test_client().get('/stream', headers={'X-Outlook-Language': 'en'})
    assert catalog('en')['登录失败'] in response.get_data(as_text=True)


def test_catalogs_are_complete_and_preserve_placeholders():
    en, ru = catalog('en'), catalog('ru')
    assert en.keys() == ru.keys()
    assert len(en) >= 2300
    for language, values in [('en', en), ('ru', ru)]:
        for source, target in values.items():
            assert not re.search('[\u3400-\u9fff]', target), (language, source)
            assert sorted(re.findall(r'\{__\d+__\}', source)) == sorted(re.findall(r'\{__\d+__\}', target)), source


def test_templates_parse_and_use_offline_catalog(localized_app):
    for path in (ROOT / 'templates').rglob('*.html'):
        localized_app.jinja_env.parse(path.read_text(encoding='utf-8'))
    client = localized_app.test_client()
    en = client.get('/localization.js', headers={'X-Outlook-Language': 'en'})
    ru = client.get('/localization.js', headers={'X-Outlook-Language': 'ru'})
    assert en.mimetype == 'application/javascript'
    assert 'globalThis.OUTLOOK_LANGUAGE="en"' in en.get_data(as_text=True)
    assert en.data != ru.data
    assert en.headers['Cache-Control'] == 'no-cache'


def test_extension_bundle_matches_web_catalogs():
    bundle = (ROOT / 'browser-extension/catalogs.js').read_text(encoding='utf-8')
    payload = json.loads(bundle.removeprefix('globalThis.OUTLOOK_CATALOGS = ').rstrip(';\n'))
    assert payload == {language: catalog(language) for language in ('en', 'ru')}
    assert (ROOT / 'static/js/i18n.js').read_bytes() == (ROOT / 'browser-extension/i18n.js').read_bytes()
    manifest = json.loads((ROOT / 'browser-extension/manifest.json').read_text(encoding='utf-8'))
    assert manifest['default_locale'] == 'en'
    for language in ('en', 'ru'):
        labels = json.loads((ROOT / f'browser-extension/_locales/{language}/messages.json').read_text(encoding='utf-8'))
        assert all(labels[key]['message'] for key in ('extensionName', 'extensionDescription', 'openConsole'))
