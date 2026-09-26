"""Offline English/Russian localization of application-owned messages.

Catalog substitutions never inspect or translate interpolated mailbox data.
"""
import codecs
import json
import os
import re
from functools import lru_cache
from pathlib import Path

SUPPORTED_LANGUAGES = ('en', 'ru')
_API_LANGUAGES = (*SUPPORTED_LANGUAGES, 'zh-CN')
_PLACEHOLDER = re.compile(r'\{__(\d+)__\}')


def get_locale():
    from flask import has_request_context, request
    if has_request_context():
        explicit = request.headers.get('X-Outlook-Language') or request.cookies.get('outlook_language')
        if explicit in _API_LANGUAGES:
            return explicit
        for language, quality in request.accept_languages:
            if quality <= 0:
                continue
            primary = language.lower().split('-')[0]
            if primary in SUPPORTED_LANGUAGES:
                return primary
    configured = os.environ.get('OUTLOOK_LANGUAGE', 'en')
    return configured if configured in _API_LANGUAGES else 'en'


@lru_cache(maxsize=3)
def catalog(locale):
    if locale == 'zh-CN':
        return {}
    from outlook_web.runtime import resource_path
    path = resource_path('static') / 'locales' / (locale + '.json')
    return json.loads(Path(path).read_text(encoding='utf-8'))


def translate(source, *values):
    translated = catalog(get_locale()).get(source, source)
    return _PLACEHOLDER.sub(lambda match: str(values[int(match[1])]) if int(match[1]) < len(values) else match[0], translated)


@lru_cache(maxsize=2)
def message_patterns(locale):
    patterns = []
    for source, target in catalog(locale).items():
        if not _PLACEHOLDER.search(source) or '<' in source:
            continue
        pieces = _PLACEHOLDER.split(source)
        if not pieces[0] and not pieces[-1]:
            continue
        pattern = re.escape(pieces[0])
        indexes = []
        for i in range(1, len(pieces), 2):
            indexes.append(int(pieces[i]))
            pattern += '(.*?)' + re.escape(pieces[i + 1])
        patterns.append((len(_PLACEHOLDER.sub('', source)), re.compile(pattern, re.DOTALL), indexes, target))
    return sorted(patterns, key=lambda item: item[0], reverse=True)


def translate_message(value, locale):
    """Translate an application status at the response boundary, after logic runs."""
    if not isinstance(value, str) or locale == 'zh-CN':
        return value
    translated = catalog(locale).get(value)
    if translated is not None:
        return translated
    for _, pattern, indexes, target in message_patterns(locale):
        match = pattern.fullmatch(value)
        if match:
            values = dict(zip(indexes, match.groups()))
            return _PLACEHOLDER.sub(lambda marker: values.get(int(marker[1]), marker[0]), target)
    return value


def localize_payload(payload, locale):
    """Only application-owned status fields; never walk email/account content."""
    if not isinstance(payload, dict):
        return payload
    result = dict(payload)
    for key in ('error', 'message', 'hint', 'badge_label', 'warning', 'status_message', 'user_message'):
        if isinstance(result.get(key), str):
            result[key] = translate_message(result[key], locale)
    if isinstance(result.get('errors'), list):
        result['errors'] = [translate_message(item, locale) if isinstance(item, str) else item for item in result['errors']]
    # Refresh/forwarding history consists of application status records. Mail
    # data, names, subjects, bodies, settings and exports are deliberately absent.
    for key in ('failed_list', 'logs', 'history'):
        if isinstance(result.get(key), list):
            result[key] = [localize_payload(item, locale) for item in result[key]]
    for key in ('error', 'status', 'clear_status'):
        if isinstance(result.get(key), dict):
            result[key] = localize_payload(result[key], locale)
    def builtin_skin(skin):
        if not isinstance(skin, dict) or not skin.get('builtin'):
            return skin
        return {**skin, **{key: translate_message(skin[key], locale) for key in ('name', 'description') if key in skin}}
    if isinstance(result.get('active_skin'), dict):
        result['active_skin'] = builtin_skin(result['active_skin'])
    if isinstance(result.get('skins'), list):
        result['skins'] = [builtin_skin(skin) for skin in result['skins']]
    return result


def localize_sse(chunks, locale):
    """Handle split SSE chunks without buffering an entire long-lived stream."""
    buffer = ''
    decoder = codecs.getincrementaldecoder('utf-8')()
    try:
        for chunk in chunks:
            buffer += decoder.decode(chunk) if isinstance(chunk, bytes) else chunk
            while '\n' in buffer:
                line, buffer = buffer.split('\n', 1)
                if line.startswith('data: '):
                    try:
                        data = json.loads(line[6:])
                    except (ValueError, TypeError):
                        pass
                    else:
                        line = 'data: ' + json.dumps(localize_payload(data, locale), ensure_ascii=True)
                yield line + '\n'
        buffer += decoder.decode(b'', final=True)
        if buffer:
            yield buffer
    finally:
        close = getattr(chunks, 'close', None)
        if close:
            close()


def install(app):
    app.jinja_env.globals.update(tr=translate, current_language=get_locale)

    @app.get('/localization.js')
    def localized_catalog():
        from flask import Response
        language = get_locale()
        payload = json.dumps({language: catalog(language)}, ensure_ascii=True).replace('<', '\\u003c')
        return Response(
            'globalThis.OUTLOOK_LANGUAGE=' + json.dumps(language) + ';\n'
            'globalThis.OUTLOOK_CATALOGS=' + payload + ';\n',
            mimetype='application/javascript',
            headers={'Cache-Control': 'no-cache'},
        )

    @app.after_request
    def localization_headers(response):
        locale = get_locale()
        if response.is_json and not response.is_streamed:
            payload = response.get_json(silent=True)
            if isinstance(payload, dict):
                response.set_data(json.dumps(localize_payload(payload, locale), ensure_ascii=True))
        elif response.mimetype == 'text/event-stream':
            response.response = localize_sse(response.response, locale)
        response.headers['Content-Language'] = locale
        response.vary.add('Cookie')
        response.vary.add('Accept-Language')
        response.vary.add('X-Outlook-Language')
        return response
