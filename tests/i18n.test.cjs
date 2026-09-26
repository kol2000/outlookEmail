const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en', 'ru'].map(lang => [lang, JSON.parse(fs.readFileSync(path.join(root, 'static/locales', lang + '.json'), 'utf8'))]));
for (const language of ['en', 'ru']) {
    test(language + ': translates source literals and preserves interpolated data', () => {
        const context = vm.createContext({ OUTLOOK_LANGUAGE: language, OUTLOOK_CATALOGS: catalogs });
        vm.runInContext(fs.readFileSync(path.join(root, 'static/js/i18n.js'), 'utf8'), context);
        assert.equal(vm.runInContext("I18n.t('Groups')", context), catalogs[language]["Groups"]);
        const userText = "\u4f60\u597d ${secret} $& <b>untouched</b>";
        context.userText = userText;
        const result = vm.runInContext("I18n.tpl`Updated: ${userText}`", context);
        assert.equal(result, catalogs[language]["Updated: {__0__}"].replace('{__0__}', () => userText));
        assert.equal(vm.runInContext("I18n.groupName({id: 7, name: 'User data'})", context), "User data");
        context.legacyGroupName = '\u9ed8\u8ba4\u5206\u7ec4';
        assert.equal(vm.runInContext("I18n.groupName({id: 1, name: legacyGroupName})", context), catalogs[language]["Default group"]);
        assert.equal(vm.runInContext("I18n.groupName({id: 42, name: legacyGroupName})", context), context.legacyGroupName);
    });
}
