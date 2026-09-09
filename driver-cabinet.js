import { financeSettings, moneyRound } from './driver-finance.js?v=53';

// Presentation only. Existing forms and their listeners keep their identity.
export function initDriverCabinet({ onViewChange = () => {}, onFilterChange = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const profile = $('driver-profile');
    if (!profile) return null;
    let enabled = false, view = 'orders';
    const parked = [];
    const node = (tag, className, text = '') => {
        const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
    };
    const button = (text, action) => {
        const el = node('button', 'cabinet-button', text); el.type = 'button'; el.addEventListener('click', action); return el;
    };
    const oldGrid = $('driver-profile-name').parentElement.parentElement;
    const identity = $('driver-profile-name').parentElement;
    identity.className = 'cabinet-driver-copy';
    const identityRow = node('div', 'cabinet-driver-row');
    identityRow.append(identity, button('Профиль', () => open('profile')));
    const wallet = button('', () => open('balance'));
    wallet.id = 'driver-wallet-summary'; wallet.className = 'cabinet-wallet';
    const walletCopy = node('span', '');
    const rate = node('span', 'cabinet-rate'); rate.id = 'driver-commission-short';
    walletCopy.append($('driver-profile-balance'), rate);
    wallet.append(walletCopy, node('span', 'cabinet-wallet-link', 'Подробнее ›'));
    const finance = $('driver-finance-summary');
    finance.className = 'cabinet-finance'; finance.replaceChildren();
    oldGrid.replaceWith(identityRow, wallet);
    const views = {};
    for (const [key, label] of [['orders','Заказы'],['balance','Баланс'],['chat','Диспетчер'],['profile','Профиль и настройки']]) {
        const section = node('section', 'cabinet-view'); section.id = `driver-view-${key}`;
        section.setAttribute('aria-label', label); section.hidden = key !== 'orders';
        if (key !== 'orders') section.append(node('h3', 'cabinet-view-title', label));
        profile.append(section); views[key] = section;
    }
    views.orders.append($('driver-online-orders'));
    views.balance.append(finance, $('driver-balance-history'));
    const call = node('a', 'cabinet-button', 'Позвонить диспетчеру'); call.href = 'tel:+77770649648';
    views.chat.append(call, $('driver-dispatcher-chat'));
    const settings = node('div', 'cabinet-settings');
    const more = node('div', 'cabinet-more');
    const publicInfo = node('details', 'cabinet-public-info');
    publicInfo.append(node('summary', '', 'О работе в «Такси Успех»'));
    views.profile.append(settings, $('driver-order-alerts'), more, publicInfo);
    const ordersLinks = $('driver-orders-link').parentElement;
    more.append(ordersLinks, $('driver-orders-unavailable'));
    const legacyBar = $('driver-mobile-primary-action').parentElement.parentElement;
    legacyBar.classList.add('cabinet-legacy-bar');
    const googleIdentity = $('driver-user-name').parentElement.parentElement;
    const publicBlocks = [...$('driver-account').parentElement.children].filter(el => el !== $('driver-account'));
    const movable = [
        [googleIdentity, settings],
        [$('driver-install-app-button'), settings], [$('driver-install-app-message'), settings],
        [$('driver-mobile-share'), more], [legacyBar.querySelector('a[href="./index.html"]'), more],
        ...publicBlocks.map(el => [el, publicInfo])
    ];
    function park(el, target) {
        if (!el) return;
        const marker = document.createComment('cabinet-return'); el.before(marker); target.append(el); parked.push([el, marker]);
    }
    const nav = node('nav', 'cabinet-nav'); nav.id = 'driver-cabinet-nav'; nav.hidden = true;
    nav.setAttribute('aria-label', 'Разделы кабинета');
    const navButtons = new Map();
    for (const [key, label, icon] of [['orders','Заказы','list'],['balance','Баланс','wallet'],['chat','Диспетчер','comments']]) {
        const control = button('', () => open(key)); control.dataset.cabinetView = key;
        control.setAttribute('aria-controls', views[key].id);
        const symbol = node('i', `fas fa-${icon}`); symbol.setAttribute('aria-hidden', 'true');
        control.append(symbol, node('span', '', label)); nav.append(control); navButtons.set(key, control);
    }
    const unread = node('span', 'cabinet-unread', 'Новое'); unread.hidden = true; navButtons.get('chat').append(unread);
    document.body.append(nav);
    const filters = node('div', 'cabinet-order-filters'); filters.setAttribute('role','group'); filters.setAttribute('aria-label','Список заказов');
    const filterButtons = new Map();
    for (const [key, label] of [['new','Новые'],['current','Мой заказ'],['history','История']]) {
        const control = button(label, () => onFilterChange(key)); control.dataset.orderFilter = key;
        filters.append(control); filterButtons.set(key, { control, label });
    }
    $('driver-orders-loading').before(filters);
    function open(next, { scroll = true } = {}) {
        if (!enabled || !views[next]) return;
        view = next;
        for (const [key, section] of Object.entries(views)) section.hidden = key !== view;
        for (const [key, control] of navButtons) control.setAttribute('aria-pressed', String(key === view));
        wallet.setAttribute('aria-expanded', String(view === 'balance'));
        onViewChange(view);
        if (scroll) $('driver-account').scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    function setEnabled(next) {
        if (enabled === Boolean(next)) return;
        enabled = Boolean(next);
        document.body.classList.toggle('driver-cabinet-ready', enabled);
        nav.hidden = !enabled;
        if (enabled) { movable.forEach(([el,target]) => park(el,target)); open('orders', { scroll:false }); }
        else {
            for (const [el,marker] of parked.splice(0)) { marker.replaceWith(el); }
            view = 'orders';
            for (const [key, section] of Object.entries(views)) section.hidden = key !== 'orders';
        }
    }
    function updateFinance(driver, reserved = 0) {
        const settings = financeSettings(driver), balance = Number(driver.balance);
        rate.textContent = `Комиссия ${settings.commissionRate}%`;
        const fmt = value => `${value.toLocaleString('ru-RU')} ₸`;
        const limit = settings.debtMode === 'none' ? 'Без долга' : settings.debtMode === 'unlimited' ? 'Без ограничения' : fmt(settings.debtLimit);
        const available = settings.debtMode === 'unlimited' ? 'Без ограничения' : fmt(Math.max(0, moneyRound((settings.debtMode === 'none' ? 0 : settings.debtLimit) - balance - reserved)));
        const list = node('dl','');
        for (const [label,value] of [['Комиссия',`${settings.commissionRate}%`],['Лимит долга',limit],['Зарезервировано',fmt(reserved)],['Доступно для комиссии',available]]) {
            const row = node('div',''); row.append(node('dt','',label),node('dd','',value)); list.append(row);
        }
        finance.replaceChildren(list);
    }
    return {
        open, setEnabled, updateFinance,
        get view() { return view; },
        get enabled() { return enabled; },
        updateUnread(value) { unread.hidden = !value; },
        updateFilters(counts, selected) {
            for (const [key,{control,label}] of filterButtons) {
                control.textContent = `${label} · ${counts[key] ?? 0}`;
                control.setAttribute('aria-pressed',String(key === selected));
            }
        }
    };
}
