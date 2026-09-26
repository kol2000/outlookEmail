/* Offline localization. Only explicitly marked application strings are translated. */
(function (global) {
    'use strict';
    const catalogs = global.OUTLOOK_CATALOGS || {};
    let language = global.OUTLOOK_LANGUAGE;
    if (!['en', 'ru'].includes(language)) {
        try { language = localStorage.getItem('outlook_language'); } catch (_) { /* optional storage */ }
    }
    if (!['en', 'ru'].includes(language)) language = (global.navigator?.language || '').startsWith('ru') ? 'ru' : 'en';
    const dictionary = catalogs[language] || {};
    function t(source, ...values) {
        const translated = Object.prototype.hasOwnProperty.call(dictionary, source) ? dictionary[source] : source;
        return translated.replace(/\{__(\d+)__\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
    }
    function tpl(parts, ...values) {
        const source = parts.map((part, index) => part + (index < values.length ? `{__${index}__}` : '')).join('');
        return t(source, ...values);
    }
    function groupName(group) {
        if (group && (group.is_system === 1 || group.name === "\u4e34\u65f6\u90ae\u7bb1")) return t("\u4e34\u65f6\u90ae\u7bb1");
        if (group && Number(group.id) === 1 && group.name === "\u9ed8\u8ba4\u5206\u7ec4") return t("\u9ed8\u8ba4\u5206\u7ec4");
        return group?.name || '';
    }
    function setLanguage(value) {
        if (!['en', 'ru'].includes(value)) return;
        try { localStorage.setItem('outlook_language', value); } catch (_) { /* cookies still work */ }
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            document.cookie = `outlook_language=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
        }
        location.reload();
    }
    function initialize() {
        document.documentElement.lang = language;
        // Extension HTML is static at this point. Dynamic mail content is created
        // later by its application scripts and is never walked by this function.
        if (location.protocol.endsWith('-extension:')) {
            const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                if (node.parentElement?.closest('script, style')) continue;
                const key = node.textContent.trim();
                if (Object.prototype.hasOwnProperty.call(dictionary, key)) node.textContent = node.textContent.replace(key, t(key));
            }
            for (const element of document.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) {
                for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
                    if (element.hasAttribute(attr)) element.setAttribute(attr, t(element.getAttribute(attr)));
                }
            }
        }
        const host = document.querySelector('[data-language-switcher]');
        if (host) {
            const label = document.createElement('label');
            label.className = 'language-control';
            label.textContent = language === 'ru' ? 'Язык ' : 'Language ';
            const select = document.createElement('select');
            select.setAttribute('aria-label', language === 'ru' ? 'Язык интерфейса' : 'Interface language');
            for (const [value, text] of [['en', 'English'], ['ru', 'Русский']]) {
                const option = document.createElement('option'); option.value = value; option.textContent = text;
                select.appendChild(option);
            }
            select.value = language;
            select.addEventListener('change', () => setLanguage(select.value));
            label.appendChild(select); host.appendChild(label);
        }
    }
    global.I18n = Object.freeze({ t, tpl, groupName, language, setLanguage, initialize });
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initialize, { once: true });
})(globalThis);
