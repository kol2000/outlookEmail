"""Validate offline catalogs and rebuild the extension's shared resources."""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
catalogs = {}
for language in ('en', 'ru'):
    catalog = json.loads((ROOT / 'static/locales' / (language + '.json')).read_text(encoding='utf-8'))
    for source, translated in catalog.items():
        assert not re.search('[\u3400-\u9fff]', translated), (language, source)
        assert sorted(re.findall(r'\{__\d+__\}', source)) == sorted(re.findall(r'\{__\d+__\}', translated)), source
    catalogs[language] = catalog
assert catalogs['en'].keys() == catalogs['ru'].keys()
(ROOT / 'browser-extension/catalogs.js').write_text(
    'globalThis.OUTLOOK_CATALOGS = ' + json.dumps(catalogs, ensure_ascii=False) + ';\n', encoding='utf-8')
for source, destination in [('static/js/i18n.js', 'browser-extension/i18n.js'), ('static/css/i18n.css', 'browser-extension/i18n.css')]:
    shutil.copyfile(ROOT / source, ROOT / destination)
print('Validated and synchronized', len(catalogs['en']), 'messages per language.')
