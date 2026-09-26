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
        assert.equal(vm.runInContext("I18n.t('分组')", context), catalogs[language]['分组']);
        const userText = '你好 ${secret} $& <b>untouched</b>';
        context.userText = userText;
        const result = vm.runInContext('I18n.tpl`已更新：${userText}`', context);
        assert.equal(result, catalogs[language]['已更新：{__0__}'].replace('{__0__}', () => userText));
        assert.equal(vm.runInContext("I18n.groupName({id: 7, name: '用户数据'})", context), '用户数据');
        assert.equal(vm.runInContext("I18n.groupName({id: 1, name: '默认分组'})", context), catalogs[language]['默认分组']);
        assert.equal(vm.runInContext("I18n.groupName({id: 42, name: '默认分组'})", context), '默认分组');
    });
}
