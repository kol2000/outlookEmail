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

for (const language of ['en', 'ru']) {
    test(language + ': populated account menu translates without altering account data', () => {
        const elements = {accountList: {innerHTML: '', querySelectorAll: () => []}, globalSearch: {value: ''}};
        const context = vm.createContext({OUTLOOK_LANGUAGE: language, OUTLOOK_CATALOGS: catalogs,
            document: {getElementById: id => elements[id], addEventListener() {}},
            cancelAccountDrag() {}, hasAccountServerSideFilters: () => false, getAccountSearchScope: () => 'current',
            currentGroupId: 1, currentSortBy: 'manual', currentAccount: '',
            escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
            escapeJs: value => value, getProviderLabel: () => 'Outlook',
            renderAccountSortNameAttributes: () => '', renderAccountGroupSummary: () => '',
            renderAccountAliasSummary: () => '', renderAccountFooter: () => '', renderAccountPaginationFooter: () => '',
            updateBatchActionBar() {}, maybeLoadMoreAccounts() {}});
        vm.runInContext(fs.readFileSync(path.join(root, 'static/js/i18n.js'), 'utf8'), context);
        const source = fs.readFileSync(path.join(root, 'static/js/index/02-groups.js'), 'utf8');
        const start = source.indexOf('function renderAccountList(accounts)');
        const end = source.indexOf('const ACCOUNT_SORT_DEFAULT_BY', start);
        assert.ok(start >= 0 && end > start);
        vm.runInContext(source.slice(start, end), context);
        context.rows = [{id: 42, email: 'demo@example.test', status: 'active', account_type: 'outlook', remark: 'user note <raw>'}];
        vm.runInContext('renderAccountList(rows)', context);
        const html = elements.accountList.innerHTML;
        for (const label of language === 'ru'
            ? ['Копировать адрес', 'Поделиться почтовым ящиком', 'Журнал пересылки', 'Изменить аккаунт', 'Удалить аккаунт']
            : ['Copy address', 'Share mailbox', 'Forwarding log', 'Edit account', 'Delete account']) assert.ok(html.includes(label), label);
        assert.doesNotMatch(html, /\p{Script=Han}/u);
        assert.ok(html.includes('demo@example.test'));
        assert.ok(html.includes('user note &lt;raw>'));
        assert.ok(html.includes('data-account-id="42"'));
    });
}

test('Russian detail placeholders are translated at every account-selection path', () => {
    const context = vm.createContext({OUTLOOK_LANGUAGE: 'ru', OUTLOOK_CATALOGS: catalogs});
    vm.runInContext(fs.readFileSync(path.join(root, 'static/js/i18n.js'), 'utf8'), context);
    let count = 0;
    for (const file of ['04-accounts.js', '03-temp-emails.js']) {
        const source = fs.readFileSync(path.join(root, 'static/js/index', file), 'utf8');
        for (const match of source.matchAll(/I18n\.tpl`([^`]*Select an email to view details[^`]*)`/g)) {
            const html = vm.runInContext(match[0], context);
            assert.ok(html.includes('Выберите письмо для просмотра'));
            assert.ok(!html.includes('Select an email'));
            count++;
        }
    }
    assert.equal(count, 6);
});
