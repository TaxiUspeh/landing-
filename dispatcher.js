import { auth, db, googleProvider } from './firebase-config.js';
import {
    getRedirectResult,
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const elements = {
    authLoading: document.getElementById('dispatcher-auth-loading'),
    signedOut: document.getElementById('dispatcher-signed-out'),
    signedIn: document.getElementById('dispatcher-signed-in'),
    loginButton: document.getElementById('dispatcher-login-button'),
    logoutButton: document.getElementById('dispatcher-logout-button'),
    userPhoto: document.getElementById('dispatcher-user-photo'),
    userPlaceholder: document.getElementById('dispatcher-user-placeholder'),
    userName: document.getElementById('dispatcher-user-name'),
    userEmail: document.getElementById('dispatcher-user-email'),
    userUid: document.getElementById('dispatcher-user-uid'),
    copyUid: document.getElementById('dispatcher-copy-uid'),
    setup: document.getElementById('dispatcher-setup'),
    authMessage: document.getElementById('dispatcher-auth-message'),
    panel: document.getElementById('dispatcher-panel'),
    total: document.getElementById('stat-total'),
    active: document.getElementById('stat-active'),
    allowed: document.getElementById('stat-allowed'),
    blocked: document.getElementById('stat-blocked'),
    ordersSearching: document.getElementById('orders-stat-searching'),
    ordersActive: document.getElementById('orders-stat-active'),
    ordersCompleted: document.getElementById('orders-stat-completed'),
    onlineOrdersLoading: document.getElementById('online-orders-loading'),
    onlineOrdersEmpty: document.getElementById('online-orders-empty'),
    onlineOrdersList: document.getElementById('online-orders-list'),
    onlineOrdersMessage: document.getElementById('online-orders-message'),
    onlineOrdersContent: document.getElementById('online-orders-content'),
    toggleOnlineOrdersSection: document.getElementById('toggle-online-orders-section'),
    createPhoneOrderButton: document.getElementById('create-phone-order-button'),
    phoneOrderModal: document.getElementById('phone-order-modal'),
    phoneOrderClose: document.getElementById('phone-order-close'),
    phoneOrderForm: document.getElementById('phone-order-form'),
    phoneOrderServiceType: document.getElementById('phone-order-service-type'),
    phoneOrderServiceButtons: [...document.querySelectorAll('[data-phone-order-service]')],
    phoneOrderRouteSection: document.querySelector('[data-phone-order-section="route"]'),
    phoneOrderStopsSection: document.querySelector('[data-phone-order-section="stops"]'),
    phoneOrderDeliverySection: document.querySelector('[data-phone-order-section="delivery"]'),
    phoneOrderCargoSection: document.querySelector('[data-phone-order-section="cargo"]'),
    phoneOrderSoberDriverSection: document.querySelector('[data-phone-order-section="soberDriver"]'),
    phoneOrderAssistanceSection: document.querySelector('[data-phone-order-section="assistance"]'),
    phoneOrderFrom: document.getElementById('phone-order-from'),
    phoneOrderFromLabel: document.getElementById('phone-order-from-label'),
    phoneOrderTo: document.getElementById('phone-order-to'),
    phoneOrderToLabel: document.getElementById('phone-order-to-label'),
    phoneOrderStops: document.getElementById('phone-order-stops'),
    phoneOrderDeliveryStore: document.getElementById('phone-order-delivery-store'),
    phoneOrderDeliveryAddress: document.getElementById('phone-order-delivery-address'),
    phoneOrderDeliveryItems: document.getElementById('phone-order-delivery-items'),
    phoneOrderCargoDescription: document.getElementById('phone-order-cargo-description'),
    phoneOrderCargoMovers: document.getElementById('phone-order-cargo-movers'),
    phoneOrderSoberCar: document.getElementById('phone-order-sober-car'),
    phoneOrderAssistanceType: document.getElementById('phone-order-assistance-type'),
    phoneOrderAssistanceAddress: document.getElementById('phone-order-assistance-address'),
    phoneOrderAssistanceCar: document.getElementById('phone-order-assistance-car'),
    phoneOrderAssistancePlate: document.getElementById('phone-order-assistance-plate'),
    phoneOrderAssistanceTask: document.getElementById('phone-order-assistance-task'),
    phoneOrderCustomerName: document.getElementById('phone-order-customer-name'),
    phoneOrderCustomerPhone: document.getElementById('phone-order-customer-phone'),
    phoneOrderStandardPrice: document.getElementById('phone-order-standard-price'),
    phoneOrderPriceFromLabel: document.getElementById('phone-order-price-from-label'),
    phoneOrderPriceFrom: document.getElementById('phone-order-price-from'),
    phoneOrderPriceToLabel: document.getElementById('phone-order-price-to-label'),
    phoneOrderPriceTo: document.getElementById('phone-order-price-to'),
    phoneOrderAuctionPrice: document.getElementById('phone-order-auction-price'),
    phoneOrderAuctionPriceValue: document.getElementById('phone-order-auction-price-value'),
    phoneOrderPriceNote: document.getElementById('phone-order-price-note'),
    phoneOrderScheduledFor: document.getElementById('phone-order-scheduled-for'),
    phoneOrderDriver: document.getElementById('phone-order-driver'),
    phoneOrderWishes: document.getElementById('phone-order-wishes'),
    phoneOrderMessage: document.getElementById('phone-order-message'),
    phoneOrderCancel: document.getElementById('phone-order-cancel'),
    phoneOrderSubmit: document.getElementById('phone-order-submit'),
    driverStatsButtons: [...document.querySelectorAll('[data-driver-stat-filter]')],
    driverSummaryModal: document.getElementById('driver-summary-modal'),
    driverSummaryTitle: document.getElementById('driver-summary-title'),
    driverSummaryDescription: document.getElementById('driver-summary-description'),
    driverSummaryList: document.getElementById('driver-summary-list'),
    driverSummaryClose: document.getElementById('driver-summary-close'),
    dispatcherMessagesLoading: document.getElementById('dispatcher-messages-loading'),
    dispatcherMessagesEmpty: document.getElementById('dispatcher-messages-empty'),
    dispatcherMessagesContent: document.getElementById('dispatcher-messages-content'),
    dispatcherMessagesUnread: document.getElementById('dispatcher-messages-unread'),
    dispatcherMessagesSoundToggle: document.getElementById('dispatcher-messages-sound-toggle'),
    dispatcherMessagesConversations: document.getElementById('dispatcher-messages-conversations'),
    dispatcherMessagesConversationTitle: document.getElementById('dispatcher-messages-conversation-title'),
    dispatcherMessagesConversationDetail: document.getElementById('dispatcher-messages-conversation-detail'),
    dispatcherMessagesList: document.getElementById('dispatcher-messages-list'),
    dispatcherMessagesNoSelection: document.getElementById('dispatcher-messages-no-selection'),
    dispatcherMessagesForm: document.getElementById('dispatcher-messages-form'),
    dispatcherMessagesInput: document.getElementById('dispatcher-messages-input'),
    dispatcherMessagesSend: document.getElementById('dispatcher-messages-send'),
    dispatcherMessagesStatus: document.getElementById('dispatcher-messages-status'),
    mobileNavigation: document.getElementById('dispatcher-mobile-navigation'),
    mobileSectionButtons: [...document.querySelectorAll('[data-dispatcher-section-button]')],
    mobileSections: [...document.querySelectorAll('[data-dispatcher-mobile-section]')],
    mobileOrdersCurrentButton: document.getElementById('mobile-orders-current-button'),
    mobileOrdersHistoryButton: document.getElementById('mobile-orders-history-button'),
    mobileOrdersCurrentCount: document.getElementById('mobile-orders-current-count'),
    mobileOrdersHistoryCount: document.getElementById('mobile-orders-history-count'),
    mobileOrdersFilterMessage: document.getElementById('mobile-orders-filter-message'),
    addDriverForm: document.getElementById('add-driver-form'),
    addDriverButton: document.getElementById('add-driver-button'),
    addDriverMessage: document.getElementById('add-driver-message'),
    newDriverNumber: document.getElementById('new-driver-number'),
    newDriverName: document.getElementById('new-driver-name'),
    newDriverPhone: document.getElementById('new-driver-phone'),
    newDriverCar: document.getElementById('new-driver-car'),
    newDriverColor: document.getElementById('new-driver-color'),
    newDriverBalance: document.getElementById('new-driver-balance'),
    newDriverUid: document.getElementById('new-driver-uid'),
    newDriverStatus: document.getElementById('new-driver-status'),
    ordersLinkForm: document.getElementById('orders-link-form'),
    ordersChatUrl: document.getElementById('orders-chat-url'),
    saveOrdersLink: document.getElementById('save-orders-link'),
    ordersLinkMessage: document.getElementById('orders-link-message'),
    driversLoading: document.getElementById('drivers-loading'),
    driversEmpty: document.getElementById('drivers-empty'),
    driversList: document.getElementById('drivers-list'),
    driverSearch: document.getElementById('driver-search')
};

let currentUser = null;
let drivers = [];
let driverStates = new Map();
let orders = [];
let orderContacts = new Map();
let driverMessages = [];
const expandedOrderIds = new Set();
let mobileDispatcherSection = 'orders';
let mobileOrdersView = 'current';
let activeDriverSummaryFilter = '';
let onlineOrdersSectionCollapsed = false;
let unsubscribeDrivers = null;
let unsubscribeDriverStates = null;
let unsubscribeOrders = null;
let unsubscribeOrderContacts = null;
let unsubscribeDriverMessages = null;
let authActionInProgress = false;
let manualOrderAssignmentInProgress = false;
let phoneOrderSubmitInProgress = false;
let cancellationDecisionInProgress = false;
let dispatcherCompletionInProgress = false;
let dispatcherMessageSendInProgress = false;
let driverStatusRefreshTimer = null;
let selectedDriverMessageUid = '';
let dispatcherChatSoundEnabled = readDispatcherChatSoundPreference();
let dispatcherChatAudioContext = null;
let dispatcherMessagesInitialLoaded = false;
const DISPATCHER_CHAT_SOUND_KEY = 'taxi-uspeh-dispatcher-chat-sound';
const DRIVER_CONNECTION_TIMEOUT_MS = 3 * 60 * 1000;
const REQUEUE_REASON_LABELS = {
    car_issue: 'Неисправность автомобиля',
    cannot_continue: 'Водитель не может продолжить',
    other: 'Другая причина'
};
const CLIENT_CANCELLATION_REASON_LABELS = {
    plans_changed: 'Изменились планы',
    no_longer_needed: 'Такси больше не нужно',
    called_other_taxi: 'Заказал другое такси',
    other: 'Другая причина'
};

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
}

function isMobileViewport() {
    return window.matchMedia('(max-width: 767px)').matches;
}

function setMobileDispatcherSection(section, scrollToNavigation = true) {
    mobileDispatcherSection = section;
    for (const panelSection of elements.mobileSections) {
        panelSection.classList.toggle('mobile-dispatcher-hidden', panelSection.dataset.dispatcherMobileSection !== section);
    }
    for (const button of elements.mobileSectionButtons) {
        const active = button.dataset.dispatcherSectionButton === section;
        button.setAttribute('aria-current', active ? 'page' : 'false');
        button.classList.toggle('bg-blue-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('text-slate-600', !active);
        button.classList.toggle('dark:text-slate-300', !active);
    }
    if (scrollToNavigation && isMobileViewport() && elements.mobileNavigation) {
        const top = window.scrollY + elements.mobileNavigation.getBoundingClientRect().top - 82;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
}

function isOrderHistory(order) {
    return order.status === 'completed' || order.status === 'cancelled';
}

function setMobileOrdersView(view) {
    mobileOrdersView = view;
    renderOnlineOrders();
}

function updateMobileOrdersFilter(currentCount, historyCount) {
    elements.mobileOrdersCurrentCount.textContent = String(currentCount);
    elements.mobileOrdersHistoryCount.textContent = String(historyCount);
    const currentSelected = mobileOrdersView === 'current';
    elements.mobileOrdersCurrentButton.setAttribute('aria-selected', String(currentSelected));
    elements.mobileOrdersHistoryButton.setAttribute('aria-selected', String(!currentSelected));
    for (const [button, active] of [
        [elements.mobileOrdersCurrentButton, currentSelected],
        [elements.mobileOrdersHistoryButton, !currentSelected]
    ]) {
        button.classList.toggle('bg-white', active);
        button.classList.toggle('dark:bg-slate-900', active);
        button.classList.toggle('text-blue-700', active);
        button.classList.toggle('dark:text-blue-300', active);
        button.classList.toggle('shadow-sm', active);
        button.classList.toggle('text-slate-600', !active);
        button.classList.toggle('dark:text-slate-300', !active);
    }

    const count = currentSelected ? currentCount : historyCount;
    setHidden(elements.mobileOrdersFilterMessage, currentCount + historyCount === 0 || count !== 0);
    elements.mobileOrdersFilterMessage.textContent = currentSelected
        ? 'Сейчас нет текущих заказов. Завершённые и отменённые находятся во вкладке «История».'
        : 'История заказов пока пуста.';
}

function setMessage(element, text, success = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('hidden', !text);
    element.classList.remove('text-green-700', 'dark:text-green-400', 'text-red-700', 'dark:text-red-400');
    if (text) {
        element.classList.add(success ? 'text-green-700' : 'text-red-700');
        element.classList.add(success ? 'dark:text-green-400' : 'dark:text-red-400');
    }
}

function showAuthMessage(text) {
    elements.authMessage.textContent = text;
    setHidden(elements.authMessage, !text);
}

function setLoginBusy(busy) {
    authActionInProgress = busy;
    elements.loginButton.disabled = busy;
    elements.loginButton.querySelector('span').textContent = busy ? 'Открываем Google…' : 'Войти через Google';
}

function normalizeUid(value) {
    return value.trim();
}

function validateUid(uid) {
    return !uid || (/^[A-Za-z0-9_-]{10,128}$/.test(uid) && !/\s/.test(uid));
}

function parseBalance(value) {
    const balance = Number(String(value).replace(',', '.'));
    return Number.isFinite(balance) ? Math.round(balance) : null;
}

function formatMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat('ru-RU').format(amount) + ' ₸' : '—';
}

function statusLabel(status) {
    if (status === 'active') return 'Активен';
    if (status === 'blocked') return 'Заблокирован';
    return 'Приостановлен';
}

function canTakeOrders(driver) {
    return driver.status === 'active';
}

async function login() {
    if (authActionInProgress) return;
    showAuthMessage('');
    setLoginBusy(true);
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(error.code)) {
            await signInWithRedirect(auth, googleProvider);
            return;
        }
        if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            console.error('Ошибка входа диспетчера:', error);
            showAuthMessage('Не удалось войти через Google. Проверьте интернет и повторите попытку.');
        }
    } finally {
        setLoginBusy(false);
    }
}

async function copyUid() {
    const uid = elements.userUid.textContent.trim();
    if (!uid) return;
    try {
        await navigator.clipboard.writeText(uid);
        const icon = elements.copyUid.querySelector('i');
        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = 'fas fa-copy'; }, 1500);
    } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(elements.userUid);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function stopAdminPanel() {
    if (unsubscribeDrivers) unsubscribeDrivers();
    if (unsubscribeDriverStates) unsubscribeDriverStates();
    if (unsubscribeOrders) unsubscribeOrders();
    if (unsubscribeOrderContacts) unsubscribeOrderContacts();
    unsubscribeDrivers = null;
    unsubscribeDriverStates = null;
    unsubscribeOrders = null;
    unsubscribeOrderContacts = null;
    stopDriverMessagesListener();
    drivers = [];
    driverStates = new Map();
    orders = [];
    orderContacts = new Map();
    if (driverStatusRefreshTimer) clearInterval(driverStatusRefreshTimer);
    driverStatusRefreshTimer = null;
    closeDriverSummary();
    setOnlineOrdersSectionCollapsed(false);
    setHidden(elements.panel, true);
    setHidden(elements.driversList, true);
    setHidden(elements.driversEmpty, true);
    setHidden(elements.driversLoading, false);
    setHidden(elements.onlineOrdersList, true);
    setHidden(elements.onlineOrdersEmpty, true);
    setHidden(elements.onlineOrdersLoading, false);
    setMessage(elements.onlineOrdersMessage, '');
}

async function checkAdminAccess(user) {
    stopAdminPanel();
    setHidden(elements.setup, true);
    showAuthMessage('');

    try {
        const adminSnapshot = await getDoc(doc(db, 'admins', user.uid));
        if (!adminSnapshot.exists() || adminSnapshot.data().active === false) {
            setHidden(elements.setup, false);
            return;
        }

        setHidden(elements.panel, false);
        startDriversListener();
        startDriverStatesListener();
        startOrdersListeners();
        startDriverMessagesListener();
        driverStatusRefreshTimer = setInterval(refreshDriverStatusIndicators, 30 * 1000);
        await loadOrdersLink();
    } catch (error) {
        console.warn('Проверка администратора не выполнена:', error.code || error.message);
        setHidden(elements.setup, false);
        if (error.code !== 'permission-denied') {
            showAuthMessage('Не удалось проверить доступ. Проверьте интернет и обновите страницу.');
        }
    }
}

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    return 0;
}

function isDriverConnected(driver) {
    const uid = normalizeUid(driver.authUid || '');
    const state = uid ? driverStates.get(uid) : null;
    const lastSeen = timestampMillis(state?.lastSeen);
    return Boolean(
        uid
        && (state?.status === 'available' || state?.status === 'busy')
        && lastSeen > 0
        && Date.now() - lastSeen <= DRIVER_CONNECTION_TIMEOUT_MS
    );
}

function driverAvailabilityInfo(driver) {
    const uid = normalizeUid(driver.authUid || '');
    const state = uid ? driverStates.get(uid) : null;
    const connected = isDriverConnected(driver);

    if (state?.status === 'busy' && state.activeOrderId) {
        const order = orders.find((item) => item.id === state.activeOrderId);
        return {
            key: 'busy',
            label: '🟠 Занят',
            detail: order
                ? `Текущий заказ: ${order.orderNumber || order.id}${connected ? '' : ' · нет связи с кабинетом'}`
                : connected ? 'Выполняет заказ' : 'Выполняет заказ · нет связи с кабинетом',
            className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
        };
    }
    if (!uid) {
        return {
            key: 'unlinked',
            label: '⚪ Не подключён',
            detail: 'Google UID ещё не привязан',
            className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
        };
    }
    if (!canTakeOrders(driver)) {
        return {
            key: 'restricted',
            label: '🔴 Ограничено',
            detail: `${statusLabel(driver.status)} · работу с заказами ограничил диспетчер`,
            className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
        };
    }
    if (state?.status === 'available' && connected) {
        return {
            key: 'available',
            label: '🟢 Свободен',
            detail: 'Кабинет открыт · получает новые заказы',
            className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
        };
    }
    if (state?.status === 'available') {
        return {
            key: 'disconnected',
            label: '⚪ Нет связи',
            detail: 'Кабинет водителя не отвечает более 3 минут',
            className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
        };
    }
    return {
        key: 'offline',
        label: '⚪ Кабинет закрыт',
        detail: 'Новые онлайн-заказы не получает',
        className: 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
    };
}

function updateStats() {
    const states = drivers.map(driverAvailabilityInfo);
    const onLine = drivers.filter(isDriverConnected).length;
    const available = states.filter((state) => state.key === 'available').length;
    const busy = states.filter((state) => state.key === 'busy').length;
    elements.total.textContent = String(drivers.length);
    elements.active.textContent = String(onLine);
    elements.allowed.textContent = String(available);
    elements.blocked.textContent = String(busy);
    if (activeDriverSummaryFilter) renderDriverSummary(activeDriverSummaryFilter);
}

function driverSummaryFilterDetails(filter) {
    return ({
        all: {
            title: 'Все водители',
            description: 'Все карточки водителей в диспетчерской.',
            matches: () => true
        },
        connected: {
            title: 'Водители в кабинете',
            description: 'Кабинет открыт и связь с водителем есть сейчас.',
            matches: (_state, driver) => isDriverConnected(driver)
        },
        available: {
            title: 'Свободные водители',
            description: 'Могут принять следующий онлайн-заказ.',
            matches: (state) => state.key === 'available'
        },
        busy: {
            title: 'Занятые водители',
            description: 'Выполняют назначенный онлайн-заказ.',
            matches: (state) => state.key === 'busy'
        }
    })[filter] || null;
}

function driverBalanceSummary(driver) {
    const balance = Number(driver.balance);
    if (!Number.isFinite(balance) || balance === 0) {
        return {
            text: 'Баланс: 0 ₸',
            className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
        };
    }
    if (balance > 0) {
        return {
            text: `Долг: ${formatMoney(balance)}`,
            className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
        };
    }
    return {
        text: `На счёте: ${formatMoney(Math.abs(balance))}`,
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
    };
}

function renderDriverSummary(filter) {
    const config = driverSummaryFilterDetails(filter);
    if (!config) return;
    const matchingDrivers = drivers
        .map((driver) => ({ driver, state: driverAvailabilityInfo(driver) }))
        .filter(({ driver, state }) => config.matches(state, driver))
        .sort((first, second) => Number(first.driver.driverNumber ?? first.driver.id) - Number(second.driver.driverNumber ?? second.driver.id));

    elements.driverSummaryTitle.textContent = config.title;
    elements.driverSummaryDescription.textContent = matchingDrivers.length
        ? `${config.description} Сейчас: ${matchingDrivers.length}.`
        : `${config.description} Сейчас список пуст.`;
    elements.driverSummaryList.replaceChildren();

    if (!matchingDrivers.length) {
        elements.driverSummaryList.append(createOrderText(
            'p',
            'rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            'В этом списке пока нет водителей.'
        ));
        return;
    }

    for (const { driver, state } of matchingDrivers) {
        const item = document.createElement('article');
        item.className = 'rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60';
        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-3';
        const details = document.createElement('div');
        details.className = 'min-w-0';
        details.append(
            createOrderText('p', 'font-extrabold break-words', `ID ${driver.driverNumber ?? driver.id} · ${driver.name || 'Водитель'}`),
            createOrderText('p', 'mt-1 text-xs text-slate-500 dark:text-slate-400 break-words', [driver.car, driver.color].filter(Boolean).join(', ') || 'Автомобиль не указан')
        );
        const badge = createOrderText('span', state.className, state.label);
        const balance = driverBalanceSummary(driver);
        const badges = document.createElement('div');
        badges.className = 'flex flex-col items-end gap-1.5 text-right';
        badges.append(
            badge,
            createOrderText('span', `whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold ${balance.className}`, balance.text)
        );
        header.append(details, badges);
        item.append(header, createOrderText('p', 'mt-2 text-xs text-slate-600 dark:text-slate-300', state.detail));
        elements.driverSummaryList.append(item);
    }
}

function openDriverSummary(filter) {
    const config = driverSummaryFilterDetails(filter);
    if (!config) return;
    activeDriverSummaryFilter = filter;
    renderDriverSummary(filter);
    setHidden(elements.driverSummaryModal, false);
    document.body.classList.add('overflow-hidden');
}

function closeDriverSummary() {
    activeDriverSummaryFilter = '';
    setHidden(elements.driverSummaryModal, true);
    document.body.classList.remove('overflow-hidden');
}

function setOnlineOrdersSectionCollapsed(collapsed) {
    onlineOrdersSectionCollapsed = collapsed;
    setHidden(elements.onlineOrdersContent, collapsed);
    const toggle = elements.toggleOnlineOrdersSection;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.querySelector('i').className = `fas ${collapsed ? 'fa-expand-alt' : 'fa-compress-alt'} mr-1`;
    toggle.querySelector('span').textContent = collapsed ? 'Развернуть заказы' : 'Свернуть заказы';
}

function readDispatcherChatSoundPreference() {
    try {
        return localStorage.getItem('taxi-uspeh-dispatcher-chat-sound') === 'enabled';
    } catch {
        return false;
    }
}

function saveDispatcherChatSoundPreference() {
    try {
        localStorage.setItem(DISPATCHER_CHAT_SOUND_KEY, dispatcherChatSoundEnabled ? 'enabled' : 'disabled');
    } catch (error) {
        console.warn('Не удалось сохранить настройку звука чата:', error.message);
    }
}

function updateDispatcherChatSoundControl() {
    const toggle = elements.dispatcherMessagesSoundToggle;
    if (!toggle) return;
    const icon = toggle.querySelector('i');
    const label = toggle.querySelector('span');
    if (dispatcherChatSoundEnabled) {
        toggle.className = 'rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-extrabold text-red-700 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';
        icon.className = 'fas fa-volume-xmark mr-1';
        label.textContent = 'Отключить звук чата';
    } else {
        toggle.className = 'rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-extrabold text-sky-800 dark:border-sky-700 dark:bg-slate-800 dark:text-sky-200';
        icon.className = 'fas fa-volume-high mr-1';
        label.textContent = 'Включить звук чата';
    }
}

function getDispatcherChatAudioContext() {
    if (dispatcherChatAudioContext) return dispatcherChatAudioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    dispatcherChatAudioContext = new AudioContextClass();
    return dispatcherChatAudioContext;
}

async function prepareDispatcherChatSound() {
    const context = getDispatcherChatAudioContext();
    if (context?.state === 'suspended') await context.resume();
    return context;
}

async function playDispatcherChatSound() {
    try {
        const context = await prepareDispatcherChatSound();
        if (!context || context.state !== 'running') return;
        const startAt = context.currentTime;
        for (const [offset, frequency] of [[0, 740], [0.16, 880]]) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.12, startAt + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.13);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + 0.14);
        }
    } catch (error) {
        console.warn('Звуковой сигнал чата недоступен:', error.message);
    }
}

async function toggleDispatcherChatSound() {
    dispatcherChatSoundEnabled = !dispatcherChatSoundEnabled;
    saveDispatcherChatSoundPreference();
    if (dispatcherChatSoundEnabled) await prepareDispatcherChatSound().catch(() => null);
    updateDispatcherChatSoundControl();
}

function driverMessageMillis(message) {
    return message.createdAt?.toMillis ? message.createdAt.toMillis() : 0;
}

function driverMessageTime(message) {
    if (!message.createdAt?.toDate) return 'Только что';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(message.createdAt.toDate());
}

function driverMessageConversations() {
    const conversations = new Map();
    for (const message of driverMessages) {
        const driverUid = String(message.driverUid || '');
        if (!driverUid) continue;
        const conversation = conversations.get(driverUid) || {
            driverUid,
            driverId: String(message.driverId || ''),
            driverName: message.driverName || 'Водитель',
            driverCar: message.driverCar || '',
            messages: []
        };
        conversation.messages.push(message);
        if (driverMessageMillis(message) >= driverMessageMillis(conversation.latest || {})) {
            conversation.latest = message;
            conversation.driverId = String(message.driverId || conversation.driverId);
            conversation.driverName = message.driverName || conversation.driverName;
            conversation.driverCar = message.driverCar || conversation.driverCar;
        }
        conversations.set(driverUid, conversation);
    }
    return [...conversations.values()]
        .map((conversation) => ({
            ...conversation,
            messages: conversation.messages.sort((a, b) => driverMessageMillis(a) - driverMessageMillis(b)),
            unread: conversation.messages.filter((message) => message.sender === 'driver' && !message.readByDispatcher).length
        }))
        .sort((first, second) => driverMessageMillis(second.latest) - driverMessageMillis(first.latest));
}

function selectedDriverMessageConversation() {
    return driverMessageConversations().find((conversation) => conversation.driverUid === selectedDriverMessageUid) || null;
}

function renderSelectedDriverConversation() {
    const conversation = selectedDriverMessageConversation();
    const hasConversation = Boolean(conversation);
    elements.dispatcherMessagesConversationTitle.textContent = hasConversation
        ? `ID ${conversation.driverId || '—'} · ${conversation.driverName}`
        : 'Выберите водителя';
    elements.dispatcherMessagesConversationDetail.textContent = hasConversation
        ? [conversation.driverCar || 'Автомобиль не указан', 'Личная переписка с водителем'].join(' · ')
        : 'Здесь откроется личная переписка.';
    elements.dispatcherMessagesList.replaceChildren();

    if (conversation) {
        for (const message of conversation.messages) {
            const fromDispatcher = message.sender === 'dispatcher';
            const item = document.createElement('article');
            item.className = `max-w-[88%] rounded-2xl px-3 py-2 text-xs ${fromDispatcher
                ? 'ml-auto bg-sky-600 text-white'
                : 'mr-auto bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'}`;
            item.append(
                createOrderText('p', fromDispatcher ? 'font-extrabold text-sky-100' : 'font-extrabold text-sky-700 dark:text-sky-300', fromDispatcher ? 'Диспетчер' : conversation.driverName),
                createOrderText('p', 'mt-1 whitespace-pre-wrap break-words', message.text || ''),
                createOrderText('p', fromDispatcher ? 'mt-1 text-[10px] text-sky-100' : 'mt-1 text-[10px] text-slate-500 dark:text-slate-400', driverMessageTime(message))
            );
            elements.dispatcherMessagesList.append(item);
        }
    }

    setHidden(elements.dispatcherMessagesList, !hasConversation);
    setHidden(elements.dispatcherMessagesNoSelection, hasConversation);
    elements.dispatcherMessagesInput.disabled = !hasConversation;
    elements.dispatcherMessagesSend.disabled = !hasConversation || dispatcherMessageSendInProgress;
    elements.dispatcherMessagesInput.placeholder = hasConversation
        ? `Ответ для ID ${conversation.driverId || 'водителя'}`
        : 'Выберите водителя, чтобы написать ответ';
}

function renderDriverMessages() {
    const conversations = driverMessageConversations();
    if (!conversations.some((conversation) => conversation.driverUid === selectedDriverMessageUid)) {
        selectedDriverMessageUid = conversations[0]?.driverUid || '';
    }
    elements.dispatcherMessagesConversations.replaceChildren();
    for (const conversation of conversations) {
        const active = conversation.driverUid === selectedDriverMessageUid;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `w-full rounded-xl border p-3 text-left transition ${active
            ? 'border-sky-400 bg-sky-100/70 dark:border-sky-700 dark:bg-sky-900/30'
            : 'border-slate-200 bg-white hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900'}`;
        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-2';
        const title = createOrderText('p', 'min-w-0 font-extrabold break-words', `ID ${conversation.driverId || '—'} · ${conversation.driverName}`);
        header.append(title);
        if (conversation.unread) {
            header.append(createOrderText(
                'span',
                'flex-shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white',
                String(conversation.unread)
            ));
        }
        button.append(
            header,
            createOrderText('p', 'mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300', conversation.latest?.text || 'Сообщение'),
            createOrderText('p', 'mt-1 text-[10px] text-slate-500 dark:text-slate-400', driverMessageTime(conversation.latest || {}))
        );
        button.addEventListener('click', () => openDriverMessageConversation(conversation.driverUid));
        elements.dispatcherMessagesConversations.append(button);
    }

    const unread = driverMessages.filter((message) => message.sender === 'driver' && !message.readByDispatcher).length;
    elements.dispatcherMessagesUnread.textContent = unread ? `Новых: ${unread}` : '';
    setHidden(elements.dispatcherMessagesUnread, unread === 0);
    setHidden(elements.dispatcherMessagesLoading, true);
    setHidden(elements.dispatcherMessagesEmpty, conversations.length !== 0);
    setHidden(elements.dispatcherMessagesContent, conversations.length === 0);
    renderSelectedDriverConversation();
}

async function markDriverMessagesRead(driverUid) {
    if (!currentUser || !driverUid) return;
    const unread = driverMessages.filter((message) => message.driverUid === driverUid
        && message.sender === 'driver'
        && !message.readByDispatcher);
    if (!unread.length) return;
    try {
        const batch = writeBatch(db);
        for (const message of unread) {
            batch.update(doc(db, 'driverMessages', message.id), {
                readByDispatcher: true,
                dispatcherReadAt: serverTimestamp()
            });
        }
        await batch.commit();
    } catch (error) {
        console.warn('Не удалось отметить сообщения прочитанными:', error.code || error.message);
    }
}

function openDriverMessageConversation(driverUid) {
    selectedDriverMessageUid = driverUid;
    renderDriverMessages();
    void markDriverMessagesRead(driverUid);
}

function stopDriverMessagesListener() {
    if (unsubscribeDriverMessages) unsubscribeDriverMessages();
    unsubscribeDriverMessages = null;
    driverMessages = [];
    selectedDriverMessageUid = '';
    dispatcherMessageSendInProgress = false;
    dispatcherMessagesInitialLoaded = false;
    setHidden(elements.dispatcherMessagesLoading, false);
    setHidden(elements.dispatcherMessagesEmpty, true);
    setHidden(elements.dispatcherMessagesContent, true);
    setHidden(elements.dispatcherMessagesUnread, true);
    setMessage(elements.dispatcherMessagesStatus, '');
}

function startDriverMessagesListener() {
    setHidden(elements.dispatcherMessagesLoading, false);
    setMessage(elements.dispatcherMessagesStatus, '');
    dispatcherMessagesInitialLoaded = false;
    updateDispatcherChatSoundControl();
    unsubscribeDriverMessages = onSnapshot(
        query(collection(db, 'driverMessages'), orderBy('createdAt', 'desc'), limit(200)),
        (snapshot) => {
            const newDriverMessages = dispatcherMessagesInitialLoaded
                ? snapshot.docChanges().filter((change) => change.type === 'added' && change.doc.data().sender === 'driver')
                : [];
            driverMessages = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            renderDriverMessages();
            dispatcherMessagesInitialLoaded = true;
            if (newDriverMessages.length && dispatcherChatSoundEnabled) void playDispatcherChatSound();
            if (selectedDriverMessageUid) void markDriverMessagesRead(selectedDriverMessageUid);
        },
        (error) => {
            console.warn('Сообщения водителей не загрузились:', error.code || error.message);
            driverMessages = [];
            setHidden(elements.dispatcherMessagesLoading, true);
            setHidden(elements.dispatcherMessagesContent, true);
            setHidden(elements.dispatcherMessagesEmpty, false);
            const emptyText = elements.dispatcherMessagesEmpty.querySelector('p');
            if (emptyText) emptyText.textContent = error.code === 'permission-denied'
                ? 'Чат будет доступен после публикации новых правил Firebase'
                : 'Не удалось загрузить сообщения. Проверьте интернет.';
        }
    );
}

async function sendDispatcherMessage(event) {
    event.preventDefault();
    const conversation = selectedDriverMessageConversation();
    const text = elements.dispatcherMessagesInput.value.trim();
    if (!conversation) return setMessage(elements.dispatcherMessagesStatus, 'Сначала выберите водителя.');
    if (!text) return setMessage(elements.dispatcherMessagesStatus, 'Напишите ответ водителю.');
    if (!currentUser || dispatcherMessageSendInProgress) return;

    dispatcherMessageSendInProgress = true;
    elements.dispatcherMessagesSend.disabled = true;
    setMessage(elements.dispatcherMessagesStatus, '');
    try {
        await addDoc(collection(db, 'driverMessages'), {
            driverUid: conversation.driverUid,
            driverId: conversation.driverId,
            driverName: conversation.driverName,
            driverCar: conversation.driverCar,
            sender: 'dispatcher',
            text,
            createdAt: serverTimestamp(),
            readByDispatcher: true,
            dispatcherReadAt: serverTimestamp()
        });
        elements.dispatcherMessagesInput.value = '';
        setMessage(elements.dispatcherMessagesStatus, 'Ответ отправлен водителю.', true);
    } catch (error) {
        console.warn('Не удалось отправить ответ водителю:', error.code || error.message);
        setMessage(
            elements.dispatcherMessagesStatus,
            error.code === 'permission-denied'
                ? 'Чат ещё не включён в правилах Firebase. Обновите правила и опубликуйте их.'
                : 'Не удалось отправить ответ. Проверьте интернет.'
        );
    } finally {
        dispatcherMessageSendInProgress = false;
        renderSelectedDriverConversation();
    }
}

function applyDriverAvailability(card, driver) {
    const info = driverAvailabilityInfo(driver);
    const badge = card.querySelector('[data-driver-availability-badge]');
    const detail = card.querySelector('[data-driver-availability-detail]');
    if (badge) {
        badge.className = info.className;
        badge.textContent = info.label;
    }
    if (detail) detail.textContent = info.detail;
}

function refreshDriverStatusIndicators() {
    updateStats();
    for (const card of elements.driversList.querySelectorAll('[data-driver-id]')) {
        const driver = drivers.find((item) => item.id === card.dataset.driverId);
        if (driver) applyDriverAvailability(card, driver);
    }
}

function createInput(labelText, className, value, options = {}) {
    const label = document.createElement('label');
    label.className = 'text-xs font-semibold text-slate-600 dark:text-slate-300';
    label.textContent = labelText;

    const input = document.createElement(options.select ? 'select' : 'input');
    input.className = `form-control mt-1 ${className}`;
    if (options.select) {
        for (const [optionValue, optionText] of options.select) {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = optionText;
            input.append(option);
        }
        input.value = value;
    } else {
        input.type = options.type || 'text';
        input.value = value ?? '';
        if (options.step) input.step = options.step;
        if (options.inputMode) input.inputMode = options.inputMode;
        if (options.placeholder) input.placeholder = options.placeholder;
        input.autocomplete = 'off';
    }
    label.append(input);
    return { label, input };
}

function renderDriverCard(driver) {
    const card = document.createElement('article');
    card.className = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 p-4';
    card.dataset.driverId = driver.id;

    const header = document.createElement('div');
    header.className = 'flex items-start gap-3 mb-4';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0 flex-grow';
    const title = document.createElement('h3');
    title.className = 'font-extrabold truncate';
    title.textContent = `ID ${driver.driverNumber} · ${driver.name || 'Без имени'}`;
    const subtitle = document.createElement('p');
    subtitle.className = 'text-xs text-slate-500 dark:text-slate-400 truncate';
    subtitle.textContent = [driver.car, driver.color].filter(Boolean).join(', ') || 'Автомобиль не указан';
    titleWrap.append(title, subtitle);

    const badge = document.createElement('span');
    badge.dataset.driverAvailabilityBadge = '';
    header.append(titleWrap, badge);

    const availabilityDetail = document.createElement('p');
    availabilityDetail.dataset.driverAvailabilityDetail = '';
    availabilityDetail.className = 'mb-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300';

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3';
    const name = createInput('Имя', 'driver-name', driver.name);
    const phone = createInput('Телефон', 'driver-phone', driver.phone, { type: 'tel' });
    const car = createInput('Автомобиль', 'driver-car', driver.car);
    const color = createInput('Цвет', 'driver-color', driver.color);
    const balance = createInput('Баланс, ₸', 'driver-balance', driver.balance ?? 0, { type: 'number', step: '1', inputMode: 'numeric' });
    const status = createInput('Статус', 'driver-status', driver.status || 'paused', {
        select: [['active', 'Активен'], ['paused', 'Приостановлен'], ['blocked', 'Заблокирован']]
    });
    const uid = createInput('Google UID водителя', 'driver-uid font-mono text-xs', driver.authUid, { placeholder: 'Не привязан' });
    uid.label.classList.add('sm:col-span-2');
    grid.append(name.label, phone.label, car.label, color.label, balance.label, status.label, uid.label);

    const footer = document.createElement('div');
    footer.className = 'mt-4 flex flex-wrap items-center gap-3';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2.5 text-sm font-extrabold shadow-sm';
    saveButton.textContent = 'Сохранить изменения';
    const currentBalance = document.createElement('span');
    currentBalance.className = 'text-xs font-bold text-slate-500 dark:text-slate-400';
    currentBalance.textContent = `Текущий баланс: ${formatMoney(driver.balance)}`;
    const message = document.createElement('p');
    message.className = 'hidden text-xs w-full';
    message.setAttribute('role', 'status');
    footer.append(saveButton, currentBalance, message);
    card.append(header, availabilityDetail, grid, footer);
    applyDriverAvailability(card, driver);

    saveButton.addEventListener('click', () => saveDriver(driver, {
        name: name.input,
        phone: phone.input,
        car: car.input,
        color: color.input,
        balance: balance.input,
        status: status.input,
        uid: uid.input,
        button: saveButton,
        message
    }));

    return card;
}

function renderDrivers() {
    updateStats();
    const search = elements.driverSearch.value.trim().toLocaleLowerCase('ru');
    const filtered = search
        ? drivers.filter((driver) => [driver.driverNumber, driver.name, driver.car, driver.phone]
            .some((value) => String(value || '').toLocaleLowerCase('ru').includes(search)))
        : drivers;

    elements.driversList.replaceChildren();
    for (const driver of filtered) elements.driversList.append(renderDriverCard(driver));

    setHidden(elements.driversLoading, true);
    setHidden(elements.driversEmpty, filtered.length !== 0);
    setHidden(elements.driversList, filtered.length === 0);
    if (!filtered.length && search) {
        elements.driversEmpty.querySelector('p').textContent = 'По вашему запросу водитель не найден';
        elements.driversEmpty.querySelector('p + p').classList.add('hidden');
    } else {
        elements.driversEmpty.querySelector('p').textContent = 'Водителей пока нет';
        elements.driversEmpty.querySelector('p + p').classList.remove('hidden');
    }
}

function startDriversListener() {
    setHidden(elements.driversLoading, false);
    unsubscribeDrivers = onSnapshot(
        query(collection(db, 'drivers'), orderBy('driverNumber')),
        (snapshot) => {
            drivers = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            renderDrivers();
        },
        (error) => {
            console.error('Ошибка списка водителей:', error);
            setHidden(elements.driversLoading, true);
            setHidden(elements.driversList, true);
            setHidden(elements.driversEmpty, false);
            elements.driversEmpty.querySelector('p').textContent = 'Не удалось загрузить водителей';
        }
    );
}

function startDriverStatesListener() {
    unsubscribeDriverStates = onSnapshot(
        collection(db, 'driverStates'),
        (snapshot) => {
            driverStates = new Map(snapshot.docs.map((snapshotDoc) => [snapshotDoc.id, snapshotDoc.data()]));
            refreshDriverStatusIndicators();
        },
        (error) => {
            console.warn('Рабочие статусы водителей не загрузились:', error.code || error.message);
            driverStates = new Map();
            refreshDriverStatusIndicators();
        }
    );
}

const ACTIVE_ORDER_STATUSES = new Set(['accepted', 'en_route', 'arrived', 'in_trip']);
const CANCELLABLE_ORDER_STATUSES = new Set(['searching', ...ACTIVE_ORDER_STATUSES]);

function onlineOrderStatus(order) {
    const status = typeof order === 'string' ? order : order.status;
    if (order?.cancellationRequestStatus === 'pending') {
        return ['Клиент просит отмену', 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'];
    }
    if (status === 'cancelled' && order?.cancellationDecision === 'false_call_fee') {
        return ['Ложный вызов · 500 ₸', 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'];
    }
    return ({
        searching: ['Ищет водителя', 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'],
        accepted: ['Водитель принял', 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'],
        en_route: ['Водитель в пути', 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'],
        arrived: ['Водитель приехал', 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'],
        in_trip: ['Поездка выполняется', 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'],
        completed: ['Завершён', 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'],
        cancelled: ['Отменён', 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300']
    })[status] || ['Статус неизвестен', 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'];
}

function orderTime(order) {
    if (!order.createdAt?.toDate) return '';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(order.createdAt.toDate());
}

function createOrderText(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function orderDetailsId(orderId) {
    return `online-order-details-${String(orderId).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function setOrderExpanded(orderId, expanded) {
    if (expanded) expandedOrderIds.add(orderId);
    else expandedOrderIds.delete(orderId);
    renderOnlineOrders();
}

function manualAssignmentCandidates() {
    return drivers.filter((driver) => driver.status === 'active'
        && normalizeUid(driver.authUid || '')
        && driverAvailabilityInfo(driver).key !== 'busy');
}

function findManualAssignmentDriver(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return null;
    return drivers.find((driver) => String(driver.id) === normalizedValue
        || String(driver.driverNumber ?? '') === normalizedValue) || null;
}

function manualAssignmentOptionLabel(driver) {
    const availability = driverAvailabilityInfo(driver);
    const connectionLabel = availability.key === 'available'
        ? 'кабинет открыт'
        : availability.key === 'busy'
            ? 'занят'
            : 'кабинет закрыт';
    return `ID ${driver.driverNumber ?? driver.id} · ${driver.name || 'Водитель'}${driver.car ? ` · ${driver.car}` : ''} · ${connectionLabel}`;
}

function appendManualAssignmentControls(actions, order) {
    const candidates = manualAssignmentCandidates();
    const hint = createOrderText(
        'p',
        'w-full text-xs text-slate-500 dark:text-slate-400',
        candidates.length
            ? 'Введите ID или выберите водителя. Если кабинет закрыт, сначала свяжитесь с ним по телефону.'
            : 'Нет активных водителей, зарегистрированных в кабинете.'
    );
    actions.append(hint);
    if (!candidates.length) return;

    const driverIdInput = document.createElement('input');
    driverIdInput.type = 'text';
    driverIdInput.inputMode = 'numeric';
    driverIdInput.autocomplete = 'off';
    driverIdInput.placeholder = 'Введите ID водителя';
    driverIdInput.className = 'min-w-0 flex-grow rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-100';

    const select = document.createElement('select');
    select.className = 'min-w-0 flex-grow rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-100';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Выбрать из активных водителей';
    select.append(placeholder);
    for (const driver of candidates) {
        const option = document.createElement('option');
        option.value = driver.id;
        option.textContent = manualAssignmentOptionLabel(driver);
        select.append(option);
    }
    select.addEventListener('change', () => {
        if (select.value) driverIdInput.value = select.value;
    });

    const assign = document.createElement('button');
    assign.type = 'button';
    assign.className = 'rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-extrabold';
    assign.textContent = 'Назначить водителя';
    assign.disabled = manualOrderAssignmentInProgress;
    assign.addEventListener('click', () => void assignOrderManually(order.id, driverIdInput.value));
    actions.append(driverIdInput, select, assign);
}

const DISPATCHER_ORDER_SERVICES = {
    taxi: {
        label: 'Такси',
        route: true,
        stops: true,
        fromLabel: 'Откуда *',
        toLabel: 'Куда *',
        priceFromLabel: 'Цена от, ₸ *',
        priceToLabel: 'Цена до, ₸'
    },
    auction: {
        label: 'Аукцион',
        route: true,
        stops: true,
        auction: true,
        fromLabel: 'Откуда *',
        toLabel: 'Куда *'
    },
    delivery: {
        label: 'Доставка',
        delivery: true,
        priceFromLabel: 'Цена от, ₸ *',
        priceToLabel: 'Цена до, ₸'
    },
    cargo: {
        label: 'Грузовой',
        route: true,
        cargo: true,
        fromLabel: 'Адрес погрузки *',
        toLabel: 'Адрес выгрузки *',
        priceFromLabel: 'Стоимость от, ₸ *',
        priceToLabel: 'Стоимость до, ₸'
    },
    soberDriver: {
        label: 'Трезвый водитель',
        route: true,
        soberDriver: true,
        fromLabel: 'Где автомобиль *',
        toLabel: 'Куда отвезти *',
        priceFromLabel: 'Цена от, ₸ *',
        priceToLabel: 'Цена до, ₸'
    },
    assistance: {
        label: 'Помощь',
        assistance: true,
        priceFromLabel: 'Цена от, ₸ *',
        priceToLabel: 'Цена до, ₸'
    }
};

function createDispatcherOrderNumber() {
    const now = new Date();
    const date = [
        String(now.getFullYear()).slice(-2),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TU-${date}-${suffix}`;
}

function validCustomerPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function parseOrderPrice(value) {
    const amount = Number(String(value || '').replace(/\s/g, '').replace(',', '.'));
    return Number.isInteger(amount) && amount >= 0 && amount <= 10000000 ? amount : null;
}

function formatOrderPrice(minimum, maximum) {
    const formatNumber = (value) => new Intl.NumberFormat('ru-RU').format(value);
    return maximum > minimum
        ? `от ${formatNumber(minimum)}–${formatNumber(maximum)} ₸`
        : `${formatNumber(minimum)} ₸`;
}

function currentPhoneOrderService() {
    const value = elements.phoneOrderServiceType?.value || 'taxi';
    return DISPATCHER_ORDER_SERVICES[value] ? value : 'taxi';
}

function setPhoneOrderSection(section, visible) {
    if (section) section.hidden = !visible;
}

function setPhoneOrderRequired(input, required) {
    if (input) input.required = required;
}

function setPhoneOrderService(serviceType) {
    const normalizedType = DISPATCHER_ORDER_SERVICES[serviceType] ? serviceType : 'taxi';
    const service = DISPATCHER_ORDER_SERVICES[normalizedType];
    if (elements.phoneOrderServiceType) elements.phoneOrderServiceType.value = normalizedType;

    elements.phoneOrderServiceButtons.forEach((button) => {
        const selected = button.dataset.phoneOrderService === normalizedType;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('ring-2', selected);
        button.classList.toggle('ring-slate-700', selected);
        button.classList.toggle('dark:ring-white', selected);
    });

    setPhoneOrderSection(elements.phoneOrderRouteSection, service.route);
    setPhoneOrderSection(elements.phoneOrderStopsSection, service.stops);
    setPhoneOrderSection(elements.phoneOrderDeliverySection, service.delivery);
    setPhoneOrderSection(elements.phoneOrderCargoSection, service.cargo);
    setPhoneOrderSection(elements.phoneOrderSoberDriverSection, service.soberDriver);
    setPhoneOrderSection(elements.phoneOrderAssistanceSection, service.assistance);
    setPhoneOrderSection(elements.phoneOrderStandardPrice, !service.auction);
    setPhoneOrderSection(elements.phoneOrderAuctionPrice, Boolean(service.auction));

    if (elements.phoneOrderFromLabel) elements.phoneOrderFromLabel.textContent = service.fromLabel || 'Откуда *';
    if (elements.phoneOrderToLabel) elements.phoneOrderToLabel.textContent = service.toLabel || 'Куда *';
    if (elements.phoneOrderPriceFromLabel) elements.phoneOrderPriceFromLabel.textContent = service.priceFromLabel || 'Цена от, ₸ *';
    if (elements.phoneOrderPriceToLabel) elements.phoneOrderPriceToLabel.textContent = service.priceToLabel || 'Цена до, ₸';
    if (elements.phoneOrderPriceNote) {
        elements.phoneOrderPriceNote.textContent = service.cargo
            ? 'Укажите согласованную стоимость; при диапазоне комиссия рассчитается с верхней суммы.'
            : 'При диапазоне комиссия рассчитается с верхней суммы, как и у онлайн-заказа.';
    }

    setPhoneOrderRequired(elements.phoneOrderFrom, Boolean(service.route));
    setPhoneOrderRequired(elements.phoneOrderTo, Boolean(service.route));
    setPhoneOrderRequired(elements.phoneOrderDeliveryAddress, Boolean(service.delivery));
    setPhoneOrderRequired(elements.phoneOrderDeliveryItems, Boolean(service.delivery));
    setPhoneOrderRequired(elements.phoneOrderCargoDescription, Boolean(service.cargo));
    setPhoneOrderRequired(elements.phoneOrderSoberCar, Boolean(service.soberDriver));
    setPhoneOrderRequired(elements.phoneOrderAssistanceType, Boolean(service.assistance));
    setPhoneOrderRequired(elements.phoneOrderAssistanceAddress, Boolean(service.assistance));
    setPhoneOrderRequired(elements.phoneOrderPriceFrom, !service.auction);
    setPhoneOrderRequired(elements.phoneOrderAuctionPriceValue, Boolean(service.auction));
}

function populatePhoneOrderDrivers() {
    const select = elements.phoneOrderDriver;
    if (!select) return;
    const selected = select.value;
    select.replaceChildren();
    const searchOption = document.createElement('option');
    searchOption.value = '';
    searchOption.textContent = 'В поиск — всем водителям';
    select.append(searchOption);
    for (const driver of manualAssignmentCandidates()) {
        const option = document.createElement('option');
        option.value = driver.id;
        option.textContent = manualAssignmentOptionLabel(driver);
        select.append(option);
    }
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function setPhoneOrderBusy(busy) {
    phoneOrderSubmitInProgress = busy;
    if (elements.phoneOrderSubmit) {
        elements.phoneOrderSubmit.disabled = busy;
        elements.phoneOrderSubmit.innerHTML = busy
            ? '<i class="fas fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>Отправляем…'
            : '<i class="fas fa-paper-plane mr-2" aria-hidden="true"></i>Создать и отправить';
    }
    if (elements.phoneOrderCancel) elements.phoneOrderCancel.disabled = busy;
    if (elements.phoneOrderClose) elements.phoneOrderClose.disabled = busy;
}

function openPhoneOrderModal() {
    if (!elements.phoneOrderModal || !elements.phoneOrderForm) return;
    elements.phoneOrderForm.reset();
    setPhoneOrderService('taxi');
    populatePhoneOrderDrivers();
    setMessage(elements.phoneOrderMessage, '');
    setHidden(elements.phoneOrderModal, false);
    document.body.classList.add('overflow-hidden');
    setTimeout(() => elements.phoneOrderFrom?.focus(), 0);
}

function closePhoneOrderModal(force = false) {
    if (phoneOrderSubmitInProgress && !force) return;
    setHidden(elements.phoneOrderModal, true);
    document.body.classList.remove('overflow-hidden');
}

function phoneOrderStops() {
    return String(elements.phoneOrderStops?.value || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 5);
}

function phoneOrderContactData(customerName, customerPhone) {
    return {
        clientUid: '',
        customerName: customerName || 'Клиент',
        customerPhone,
        passengerPhone: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
}

function standardPhoneOrderPrice() {
    const minimumPrice = parseOrderPrice(elements.phoneOrderPriceFrom?.value);
    const upperPriceValue = elements.phoneOrderPriceTo?.value.trim() || '';
    const maximumPrice = upperPriceValue ? parseOrderPrice(upperPriceValue) : minimumPrice;
    if (minimumPrice === null || maximumPrice === null || minimumPrice <= 0 || maximumPrice < minimumPrice) {
        return { error: 'Проверьте стоимость: укажите положительную цену, а верхняя сумма не должна быть меньше нижней.' };
    }
    return {
        minimumPrice,
        maximumPrice,
        priceText: formatOrderPrice(minimumPrice, maximumPrice)
    };
}

function createPhoneOrderPayload() {
    const serviceType = currentPhoneOrderService();
    const service = DISPATCHER_ORDER_SERVICES[serviceType];
    const common = {
        serviceType,
        serviceLabel: service.label,
        stops: service.stops ? phoneOrderStops() : [],
        wishes: elements.phoneOrderWishes?.value.trim() || '',
        scheduledFor: elements.phoneOrderScheduledFor?.value || '',
        serviceDetails: {}
    };
    const fromAddress = elements.phoneOrderFrom?.value.trim() || '';
    const toAddress = elements.phoneOrderTo?.value.trim() || '';

    if (service.route && (!fromAddress || !toAddress)) {
        return { error: `Заполните поля «${service.fromLabel.replace(' *', '')}» и «${service.toLabel.replace(' *', '')}».` };
    }

    if (serviceType === 'auction') {
        const proposedPrice = parseOrderPrice(elements.phoneOrderAuctionPriceValue?.value);
        if (proposedPrice === null || proposedPrice < 500) {
            return { error: 'Для аукциона укажите цену клиента не меньше 500 ₸.' };
        }
        return {
            ...common,
            fromAddress,
            toAddress,
            priceText: `Аукцион: ${formatOrderPrice(proposedPrice, proposedPrice)}`,
            priceAmount: proposedPrice,
            serviceDetails: { proposedPrice, priceSource: 'customer_offer' }
        };
    }

    const price = standardPhoneOrderPrice();
    if (price.error) return price;

    if (serviceType === 'delivery') {
        const store = elements.phoneOrderDeliveryStore?.value.trim() || '';
        const deliveryAddress = elements.phoneOrderDeliveryAddress?.value.trim() || '';
        const items = elements.phoneOrderDeliveryItems?.value.trim() || '';
        if (!deliveryAddress || !items) return { error: 'Для доставки укажите адрес и что требуется доставить.' };
        return {
            ...common,
            fromAddress: store ? `Магазин: ${store}` : 'Доставка',
            toAddress: deliveryAddress,
            priceText: price.priceText,
            priceAmount: price.maximumPrice,
            serviceDetails: { store, items }
        };
    }

    if (serviceType === 'cargo') {
        const cargoDescription = elements.phoneOrderCargoDescription?.value.trim() || '';
        const movers = elements.phoneOrderCargoMovers?.value || '0';
        if (!cargoDescription) return { error: 'Опишите груз для водителя.' };
        return {
            ...common,
            fromAddress,
            toAddress,
            priceText: price.priceText,
            priceAmount: price.maximumPrice,
            serviceDetails: { cargoDescription, movers: Number(movers) || 0 }
        };
    }

    if (serviceType === 'soberDriver') {
        const carModel = elements.phoneOrderSoberCar?.value.trim() || '';
        if (!carModel) return { error: 'Укажите марку автомобиля клиента.' };
        return {
            ...common,
            fromAddress,
            toAddress,
            priceText: price.priceText,
            priceAmount: price.maximumPrice,
            serviceDetails: { carModel }
        };
    }

    if (serviceType === 'assistance') {
        const assistanceType = elements.phoneOrderAssistanceType?.value || '';
        const address = elements.phoneOrderAssistanceAddress?.value.trim() || '';
        if (!assistanceType || !address) return { error: 'Для помощи выберите тип и укажите адрес.' };
        return {
            ...common,
            fromAddress: address,
            toAddress: `Помощь: ${assistanceType}`,
            priceText: price.priceText,
            priceAmount: price.maximumPrice,
            serviceDetails: {
                assistanceType,
                carModel: elements.phoneOrderAssistanceCar?.value.trim() || '',
                licencePlate: elements.phoneOrderAssistancePlate?.value.trim() || '',
                task: elements.phoneOrderAssistanceTask?.value.trim() || ''
            }
        };
    }

    return {
        ...common,
        fromAddress,
        toAddress,
        priceText: price.priceText,
        priceAmount: price.maximumPrice
    };
}

async function createPhoneOrder(event) {
    event.preventDefault();
    if (!currentUser || phoneOrderSubmitInProgress) return;

    const customerName = elements.phoneOrderCustomerName.value.trim();
    const customerPhone = elements.phoneOrderCustomerPhone.value.trim();
    const payload = createPhoneOrderPayload();
    const selectedDriver = elements.phoneOrderDriver.value
        ? findManualAssignmentDriver(elements.phoneOrderDriver.value)
        : null;

    if (payload.error) return setMessage(elements.phoneOrderMessage, payload.error);
    if (!validCustomerPhone(customerPhone)) return setMessage(elements.phoneOrderMessage, 'Укажите номер телефона клиента: от 10 до 15 цифр.');
    if (elements.phoneOrderDriver.value && !selectedDriver) {
        return setMessage(elements.phoneOrderMessage, 'Выбранный водитель больше не доступен. Откройте форму ещё раз и выберите другого.');
    }

    let cabinetIsOpen = false;
    if (selectedDriver) {
        const availability = driverAvailabilityInfo(selectedDriver);
        if (availability.key === 'busy') return setMessage(elements.phoneOrderMessage, 'Этот водитель уже занят текущим заказом.');
        cabinetIsOpen = availability.key === 'available';
        if (!cabinetIsOpen) {
            const phone = selectedDriver.phone ? ` Телефон: ${selectedDriver.phone}.` : '';
            const confirmed = window.confirm(
                `Кабинет водителя ID ${selectedDriver.driverNumber ?? selectedDriver.id} сейчас не открыт.${phone} `
                + 'Ему будет отправлен пуш; если уведомления не включены, подтвердите заказ также по телефону. Назначить?'
            );
            if (!confirmed) return;
        }
    }

    const orderRef = doc(collection(db, 'orders'));
    const contactRef = doc(db, 'orderContacts', orderRef.id);
    const baseOrder = {
        orderNumber: createDispatcherOrderNumber(),
        ...payload,
        source: 'dispatcher',
        clientUid: '',
        direction: '',
        createdByUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    setPhoneOrderBusy(true);
    setMessage(elements.phoneOrderMessage, '');
    try {
        if (!selectedDriver) {
            const batch = writeBatch(db);
            batch.set(orderRef, {
                ...baseOrder,
                status: 'searching',
                assignedDriverUid: '',
                assignedDriverId: '',
                driverName: '',
                driverPhone: '',
                driverCar: '',
                driverColor: ''
            });
            batch.set(contactRef, phoneOrderContactData(customerName, customerPhone));
            await batch.commit();
            setMessage(elements.onlineOrdersMessage, `${baseOrder.serviceLabel}: заказ ${baseOrder.orderNumber} отправлен всем водителям.`, true);
        } else {
            await runTransaction(db, async (transaction) => {
                const driverRef = doc(db, 'drivers', selectedDriver.id);
                const driverSnapshot = await transaction.get(driverRef);
                if (!driverSnapshot.exists()) throw new Error('Карточка водителя не найдена.');
                const driver = driverSnapshot.data();
                const driverUid = normalizeUid(driver.authUid || '');
                if (!driverUid || driver.status !== 'active') throw new Error('Водитель недоступен для назначения.');

                const stateRef = doc(db, 'driverStates', driverUid);
                const stateSnapshot = await transaction.get(stateRef);
                const state = stateSnapshot.exists() ? stateSnapshot.data() : null;
                if (state?.status === 'busy' || state?.activeOrderId) throw new Error('Этот водитель уже занят текущим заказом.');

                transaction.set(orderRef, {
                    ...baseOrder,
                    status: 'accepted',
                    assignedDriverUid: driverUid,
                    assignedDriverId: selectedDriver.id,
                    driverName: driver.name || 'Водитель',
                    driverPhone: driver.phone || '',
                    driverCar: driver.car || '',
                    driverColor: driver.color || '',
                    assignmentSource: 'dispatcher',
                    acceptedAt: serverTimestamp()
                });
                transaction.set(contactRef, phoneOrderContactData(customerName, customerPhone));
                transaction.set(stateRef, {
                    driverId: String(selectedDriver.id),
                    status: 'busy',
                    activeOrderId: orderRef.id,
                    lastSeen: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            });
            setMessage(
                elements.onlineOrdersMessage,
                cabinetIsOpen
                    ? `${baseOrder.serviceLabel}: заказ ${baseOrder.orderNumber} назначен водителю ID ${selectedDriver.driverNumber ?? selectedDriver.id}.`
                    : `${baseOrder.serviceLabel}: заказ ${baseOrder.orderNumber} назначен водителю ID ${selectedDriver.driverNumber ?? selectedDriver.id}. Пуш отправлен; при необходимости подтвердите заказ звонком.`,
                true
            );
        }
        elements.phoneOrderForm.reset();
        setPhoneOrderService('taxi');
        closePhoneOrderModal(true);
    } catch (error) {
        console.error('Не удалось создать заказ по телефону:', error);
        setMessage(elements.phoneOrderMessage, error.message || 'Не удалось сохранить заказ. Проверьте интернет и повторите попытку.');
    } finally {
        setPhoneOrderBusy(false);
    }
}

function dispatcherOrderServiceLabel(order) {
    return order.serviceLabel || DISPATCHER_ORDER_SERVICES[order.serviceType]?.label || 'Такси';
}

function dispatcherOrderServiceDetailsText(order) {
    const details = order.serviceDetails || {};
    if (order.serviceType === 'auction' && Number.isFinite(Number(details.proposedPrice))) {
        return `Аукцион: клиент предлагает ${Number(details.proposedPrice).toLocaleString('ru-RU')} ₸.`;
    }
    if (order.serviceType === 'delivery') {
        return [
            details.store ? `Магазин: ${details.store}` : '',
            details.items ? `Что доставить: ${details.items}` : ''
        ].filter(Boolean).join(' · ');
    }
    if (order.serviceType === 'cargo') {
        return [
            details.cargoDescription ? `Груз: ${details.cargoDescription}` : '',
            Number(details.movers) > 0 ? `Грузчики: ${details.movers}` : 'Грузчики не требуются'
        ].filter(Boolean).join(' · ');
    }
    if (order.serviceType === 'soberDriver') {
        return details.carModel ? `Автомобиль клиента: ${details.carModel}` : '';
    }
    if (order.serviceType === 'assistance') {
        return [
            details.assistanceType || '',
            details.carModel ? `Автомобиль: ${details.carModel}` : '',
            details.licencePlate ? `Гос. номер: ${details.licencePlate}` : '',
            details.task ? `Детали: ${details.task}` : ''
        ].filter(Boolean).join(' · ');
    }
    return '';
}

function createOnlineOrderCard(order) {
    const card = document.createElement('article');
    card.className = 'overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60';
    card.dataset.orderId = order.id;
    card.dataset.orderHistory = String(isOrderHistory(order));
    const expanded = expandedOrderIds.has(order.id);
    const detailsId = orderDetailsId(order.id);

    const summary = document.createElement('div');
    summary.className = 'p-4';

    const header = document.createElement('div');
    header.className = 'flex items-start justify-between gap-3';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0';
    titleWrap.append(
        createOrderText('h3', 'font-extrabold', order.orderNumber || `Заказ ${order.id.slice(0, 8)}`),
        createOrderText('p', 'text-xs text-slate-500 dark:text-slate-400', orderTime(order))
    );
    const [statusText, statusClass] = onlineOrderStatus(order);
    const badge = createOrderText('span', `flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold ${statusClass}`, statusText);
    header.append(titleWrap, badge);

    const service = createOrderText('p', 'mt-2 text-[11px] font-extrabold uppercase tracking-wide text-blue-700 dark:text-blue-300', dispatcherOrderServiceLabel(order));
    const route = createOrderText('p', 'mt-3 font-bold break-words', `${order.fromAddress || '—'} → ${order.toAddress || '—'}`);
    const price = createOrderText('p', 'mt-2 text-sm font-black text-green-700 dark:text-green-300', order.priceText || 'Цена уточняется');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mt-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-extrabold text-blue-700 dark:border-slate-800 dark:bg-slate-900 dark:text-blue-300';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', detailsId);
    const toggleText = document.createElement('span');
    toggleText.textContent = expanded ? 'Свернуть детали' : 'Подробнее и действия';
    const toggleIcon = document.createElement('i');
    toggleIcon.className = `fas ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`;
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggle.append(toggleText, toggleIcon);
    toggle.addEventListener('click', () => setOrderExpanded(order.id, !expanded));
    summary.append(header, service, route, price, toggle);

    const detailsPanel = document.createElement('div');
    detailsPanel.id = detailsId;
    detailsPanel.className = 'border-t border-slate-200 p-4 dark:border-slate-800';
    detailsPanel.hidden = !expanded;
    card.append(summary, detailsPanel);

    if (order.source === 'dispatcher') {
        detailsPanel.append(createOrderText(
            'p',
            'mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 dark:bg-sky-900/30 dark:text-sky-200',
            'Заказ записан диспетчером по телефону.'
        ));
    }

    const serviceDetails = dispatcherOrderServiceDetailsText(order);
    if (serviceDetails) {
        detailsPanel.append(createOrderText(
            'p',
            'mb-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200',
            serviceDetails
        ));
    }

    const pendingCancellation = order.cancellationRequestStatus === 'pending';
    if (pendingCancellation) {
        detailsPanel.append(createOrderText(
            'p',
            'mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
            `Клиент просит отмену: ${CLIENT_CANCELLATION_REASON_LABELS[order.cancellationReason] || 'причина не указана'}. Подтвердите решение после проверки.`
        ));
    } else if (order.status === 'cancelled' && order.cancellationDecision === 'false_call_fee') {
        detailsPanel.append(createOrderText(
            'p',
            'mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200',
            `Зафиксирована компенсация за ложный вызов: ${formatMoney(order.cancellationFeeAmount || 500)}. Автоматического списания нет.`
        ));
    } else if (order.status === 'cancelled' && order.cancellationDecision === 'free') {
        detailsPanel.append(createOrderText(
            'p',
            'mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-bold text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200',
            'Отмена подтверждена диспетчером без компенсации.'
        ));
    }

    if (order.status === 'searching' && order.requeuedAt) {
        const returned = createOrderText(
            'p',
            'mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
            `Возвращён в поиск: ${REQUEUE_REASON_LABELS[order.requeueReason] || 'причина не указана'}${Number(order.requeueCount) > 1 ? ` · возвратов: ${order.requeueCount}` : ''}`
        );
        detailsPanel.append(returned);
    }

    if (order.status === 'completed' && Number.isFinite(Number(order.commissionAmount))) {
        const accounting = document.createElement('div');
        accounting.className = 'mt-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs';
        const rate = Number.isFinite(Number(order.commissionRate)) ? Number(order.commissionRate) : 20;
        accounting.append(createOrderText(
            'p',
            'font-extrabold text-emerald-900 dark:text-emerald-200',
            `Комиссия ${rate}%: +${formatMoney(order.commissionAmount)}`
        ));
        if (Number.isFinite(Number(order.commissionBaseAmount))) {
            accounting.append(createOrderText(
                'p',
                'mt-1 text-emerald-800 dark:text-emerald-300',
                `Расчёт: ${rate}% от максимальной цены ${formatMoney(order.commissionBaseAmount)}`
            ));
        }
        if (Number.isFinite(Number(order.commissionBalanceBefore)) && Number.isFinite(Number(order.commissionBalanceAfter))) {
            accounting.append(createOrderText(
                'p',
                'mt-1 text-emerald-800 dark:text-emerald-300',
                `Баланс: ${formatMoney(order.commissionBalanceBefore)} → ${formatMoney(order.commissionBalanceAfter)}`
            ));
        }
        detailsPanel.append(accounting);
    }

    if (Array.isArray(order.stops) && order.stops.length) {
        detailsPanel.append(createOrderText('p', 'mt-2 text-xs text-slate-600 dark:text-slate-300', `Остановки: ${order.stops.join(' → ')}`));
    }
    if (order.scheduledFor) {
        detailsPanel.append(createOrderText('p', 'mt-1 text-xs text-slate-600 dark:text-slate-300', `Время: ${order.scheduledFor.replace('T', ' ')}`));
    }
    if (order.wishes) {
        detailsPanel.append(createOrderText('p', 'mt-1 text-xs text-slate-600 dark:text-slate-300', `Пожелания: ${order.wishes}`));
    }

    const contact = orderContacts.get(order.id);
    const contactPhone = contact?.passengerPhone || contact?.customerPhone || '';
    const contactName = contact?.customerName || 'Клиент';
    const details = document.createElement('div');
    details.className = 'mt-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1';
    details.append(createOrderText('p', 'font-bold', contact ? `${contactName}${contactPhone ? ` · ${contactPhone}` : ''}` : 'Контакт загружается…'));
    details.append(createOrderText(
        'p',
        'text-slate-500 dark:text-slate-400',
        order.assignedDriverUid
            ? `Водитель: ${order.driverName || order.assignedDriverId || 'назначен'}${order.driverCar ? ` · ${order.driverCar}` : ''}`
            : 'Водитель ещё не назначен'
    ));
    detailsPanel.append(details);

    const actions = document.createElement('div');
    actions.className = 'mt-3 flex flex-wrap gap-2';
    if (contactPhone) {
        const call = document.createElement('a');
        call.href = `tel:${String(contactPhone).replace(/[^\d+]/g, '')}`;
        call.className = 'rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-xs font-extrabold';
        call.textContent = 'Позвонить клиенту';
        actions.append(call);
    }
    if (pendingCancellation) {
        const freeCancel = document.createElement('button');
        freeCancel.type = 'button';
        freeCancel.className = 'rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-xs font-extrabold';
        freeCancel.textContent = 'Подтвердить бесплатно';
        freeCancel.disabled = cancellationDecisionInProgress;
        freeCancel.addEventListener('click', () => void resolveClientCancellation(order, 'free'));

        const falseCall = document.createElement('button');
        falseCall.type = 'button';
        falseCall.className = 'rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-2 text-xs font-extrabold';
        falseCall.textContent = 'Ложный вызов · 500 ₸';
        falseCall.disabled = cancellationDecisionInProgress;
        falseCall.addEventListener('click', () => void resolveClientCancellation(order, 'false_call_fee'));
        actions.append(freeCancel, falseCall);
    } else if (CANCELLABLE_ORDER_STATUSES.has(order.status)) {
        if (order.assignedDriverId) {
            const complete = document.createElement('button');
            complete.type = 'button';
            complete.className = 'rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-extrabold';
            complete.textContent = 'Завершить заказ';
            complete.disabled = dispatcherCompletionInProgress;
            complete.addEventListener('click', () => void completeOnlineOrder(order));
            actions.append(complete);
        }
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-2 text-xs font-extrabold';
        cancel.textContent = 'Отменить заказ';
        cancel.addEventListener('click', () => cancelOnlineOrder(order));
        actions.append(cancel);
    }
    if (order.status === 'searching') appendManualAssignmentControls(actions, order);
    if (actions.childElementCount) detailsPanel.append(actions);
    return card;
}

function renderOnlineOrders() {
    const active = orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).length;
    elements.ordersSearching.textContent = String(orders.filter((order) => order.status === 'searching').length);
    elements.ordersActive.textContent = String(active);
    elements.ordersCompleted.textContent = String(orders.filter((order) => order.status === 'completed').length);

    const priority = { searching: 0, accepted: 1, en_route: 1, arrived: 1, in_trip: 1, completed: 2, cancelled: 3 };
    const sorted = [...orders].sort((a, b) => {
        const priorityDifference = (priority[a.status] ?? 4) - (priority[b.status] ?? 4);
        if (priorityDifference) return priorityDifference;
        const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
    }).slice(0, 50);
    const currentCount = sorted.filter((order) => !isOrderHistory(order)).length;
    const historyCount = sorted.length - currentCount;

    const visibleOrderIds = new Set(sorted.map((order) => order.id));
    for (const orderId of Array.from(expandedOrderIds)) {
        if (!visibleOrderIds.has(orderId)) expandedOrderIds.delete(orderId);
    }
    elements.onlineOrdersList.dataset.mobileOrderView = mobileOrdersView;
    updateMobileOrdersFilter(currentCount, historyCount);
    elements.onlineOrdersList.replaceChildren();
    for (const order of sorted) elements.onlineOrdersList.append(createOnlineOrderCard(order));
    setHidden(elements.onlineOrdersLoading, true);
    setHidden(elements.onlineOrdersEmpty, sorted.length !== 0);
    setHidden(elements.onlineOrdersList, sorted.length === 0);
}

function handleOnlineOrdersError(error) {
    console.warn('Онлайн-заказы не загрузились:', error.code || error.message);
    setHidden(elements.onlineOrdersLoading, true);
    setHidden(elements.onlineOrdersList, true);
    setHidden(elements.onlineOrdersEmpty, true);
    setMessage(
        elements.onlineOrdersMessage,
        error.code === 'permission-denied'
            ? 'Онлайн-заказы ещё не включены в правилах Firebase. Рабочий чат WhatsApp продолжает работать.'
            : 'Не удалось загрузить онлайн-заказы. Проверьте интернет.'
    );
}

function startOrdersListeners() {
    setHidden(elements.onlineOrdersLoading, false);
    setMessage(elements.onlineOrdersMessage, '');
    unsubscribeOrders = onSnapshot(collection(db, 'orders'), (snapshot) => {
        orders = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        renderOnlineOrders();
        refreshDriverStatusIndicators();
    }, handleOnlineOrdersError);

    unsubscribeOrderContacts = onSnapshot(collection(db, 'orderContacts'), (snapshot) => {
        orderContacts = new Map(snapshot.docs.map((snapshotDoc) => [snapshotDoc.id, snapshotDoc.data()]));
        if (orders.length) renderOnlineOrders();
    }, handleOnlineOrdersError);
}

async function assignOrderManually(orderId, driverId) {
    if (!currentUser || manualOrderAssignmentInProgress) return;
    const selectedDriver = findManualAssignmentDriver(driverId);
    if (!selectedDriver) {
        setMessage(elements.onlineOrdersMessage, 'Введите корректный ID активного водителя или выберите его из списка.');
        return;
    }

    const availability = driverAvailabilityInfo(selectedDriver);
    if (availability.key === 'busy') {
        setMessage(elements.onlineOrdersMessage, 'Этот водитель уже занят текущим заказом.');
        return;
    }
    const cabinetIsOpen = availability.key === 'available';
    if (!cabinetIsOpen) {
        const phone = selectedDriver.phone ? ` Телефон: ${selectedDriver.phone}.` : '';
        const confirmed = window.confirm(
            `Кабинет водителя ID ${selectedDriver.driverNumber ?? selectedDriver.id} сейчас не открыт. `
            + `Клиент увидит назначение, но водитель не получит бесплатный онлайн-сигнал.${phone} `
            + 'Сначала свяжитесь с водителем. Назначить его всё равно?'
        );
        if (!confirmed) return;
    }

    manualOrderAssignmentInProgress = true;
    setMessage(elements.onlineOrdersMessage, '');
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const driverRef = doc(db, 'drivers', selectedDriver.id);
            const orderSnapshot = await transaction.get(orderRef);
            const driverSnapshot = await transaction.get(driverRef);
            if (!orderSnapshot.exists() || orderSnapshot.data().status !== 'searching') {
                throw new Error('Этот заказ уже принят или отменён.');
            }
            if (!driverSnapshot.exists()) throw new Error('Карточка водителя не найдена.');
            const driver = driverSnapshot.data();
            const driverUid = normalizeUid(driver.authUid || '');
            if (!driverUid || driver.status !== 'active') {
                throw new Error('Водитель недоступен для онлайн-заказов.');
            }

            const stateRef = doc(db, 'driverStates', driverUid);
            const stateSnapshot = await transaction.get(stateRef);
            const state = stateSnapshot.exists() ? stateSnapshot.data() : null;
            if (state?.status === 'busy' || state?.activeOrderId) {
                throw new Error('Этот водитель уже занят текущим заказом.');
            }

            transaction.update(orderRef, {
                status: 'accepted',
                assignedDriverUid: driverUid,
                assignedDriverId: selectedDriver.id,
                driverName: driver.name || 'Водитель',
                driverPhone: driver.phone || '',
                driverCar: driver.car || '',
                driverColor: driver.color || '',
                assignmentSource: 'dispatcher',
                acceptedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            transaction.set(stateRef, {
                driverId: String(selectedDriver.id),
                status: 'busy',
                activeOrderId: orderId,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
        setMessage(
            elements.onlineOrdersMessage,
            cabinetIsOpen
                ? 'Водитель назначен вручную. Клиент и водитель увидят заказ.'
                : 'Водитель назначен. Клиент уже увидит его данные; обязательно подтвердите заказ водителю по телефону.',
            true
        );
    } catch (error) {
        console.warn('Не удалось назначить водителя вручную:', error.code || error.message);
        setMessage(elements.onlineOrdersMessage, error.message || 'Не удалось назначить водителя вручную.');
    } finally {
        manualOrderAssignmentInProgress = false;
        renderOnlineOrders();
    }
}

async function cancelOnlineOrder(order) {
    if (!currentUser || !CANCELLABLE_ORDER_STATUSES.has(order.status)) return;
    if (!window.confirm(`Отменить заказ ${order.orderNumber || order.id}? Клиент и водитель сразу увидят отмену.`)) return;
    setMessage(elements.onlineOrdersMessage, '');
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', order.id);
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists() || !CANCELLABLE_ORDER_STATUSES.has(orderSnapshot.data().status)) {
                throw new Error('Статус заказа уже изменился.');
            }
            const currentOrder = orderSnapshot.data();
            let stateRef = null;
            let stateSnapshot = null;
            if (currentOrder.assignedDriverUid) {
                stateRef = doc(db, 'driverStates', currentOrder.assignedDriverUid);
                stateSnapshot = await transaction.get(stateRef);
            }

            transaction.update(orderRef, {
                status: 'cancelled',
                updatedAt: serverTimestamp()
            });
            if (stateRef
                && stateSnapshot?.exists()
                && stateSnapshot.data().status === 'busy'
                && stateSnapshot.data().activeOrderId === order.id) {
                transaction.update(stateRef, {
                    status: 'available',
                    activeOrderId: '',
                    updatedAt: serverTimestamp()
                });
            }
        });
        setMessage(elements.onlineOrdersMessage, 'Заказ отменён.', true);
    } catch (error) {
        console.error('Не удалось отменить заказ:', error);
        setMessage(elements.onlineOrdersMessage, 'Не удалось отменить заказ. Обновите страницу и попробуйте ещё раз.');
    }
}

async function completeOnlineOrder(order) {
    if (!currentUser || dispatcherCompletionInProgress || !ACTIVE_ORDER_STATUSES.has(order.status)) return;
    if (!order.assignedDriverId) {
        setMessage(elements.onlineOrdersMessage, 'Нельзя завершить заказ: водитель не назначен.');
        return;
    }
    if (!window.confirm(`Завершить заказ ${order.orderNumber || order.id} от имени диспетчера? Комиссия будет учтена, а водитель снова станет свободным.`)) return;

    dispatcherCompletionInProgress = true;
    setMessage(elements.onlineOrdersMessage, '');
    renderOnlineOrders();
    try {
        let commissionAmount = 0;
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', order.id);
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists() || !ACTIVE_ORDER_STATUSES.has(orderSnapshot.data().status)) {
                throw new Error('Статус заказа уже изменился.');
            }
            const currentOrder = orderSnapshot.data();
            const driverId = String(currentOrder.assignedDriverId || '');
            if (!driverId) throw new Error('У заказа нет назначенного водителя.');

            const driverRef = doc(db, 'drivers', driverId);
            const historyRef = doc(db, 'balanceHistory', order.id);
            const driverSnapshot = await transaction.get(driverRef);
            const historySnapshot = await transaction.get(historyRef);
            const driverUid = normalizeUid(currentOrder.assignedDriverUid || '');
            const stateRef = driverUid ? doc(db, 'driverStates', driverUid) : null;
            const stateSnapshot = stateRef ? await transaction.get(stateRef) : null;
            if (!driverSnapshot.exists()) throw new Error('Карточка назначенного водителя не найдена.');

            let previousBalance = Number(driverSnapshot.data().balance);
            let newBalance = previousBalance;
            let commissionBaseAmount = Number(currentOrder.priceAmount);
            if (!Number.isFinite(previousBalance)) throw new Error('В карточке водителя указан некорректный баланс.');

            if (historySnapshot.exists()) {
                const history = historySnapshot.data();
                commissionAmount = Number(history.commissionAmount);
                commissionBaseAmount = Number(history.commissionBaseAmount);
                previousBalance = Number(history.previousBalance);
                newBalance = Number(history.newBalance);
                if (!Number.isFinite(commissionAmount) || !Number.isFinite(commissionBaseAmount)
                    || !Number.isFinite(previousBalance) || !Number.isFinite(newBalance)) {
                    throw new Error('История комиссии по заказу заполнена некорректно.');
                }
            } else {
                if (!Number.isFinite(commissionBaseAmount) || commissionBaseAmount < 0) {
                    throw new Error('В заказе нет корректной цены для комиссии.');
                }
                commissionAmount = commissionBaseAmount / 5;
                newBalance = previousBalance + commissionAmount;
                transaction.update(driverRef, {
                    balance: newBalance,
                    lastCommissionOrderId: order.id,
                    updatedAt: serverTimestamp()
                });
                transaction.set(historyRef, {
                    driverId,
                    driverNumber: driverSnapshot.data().driverNumber,
                    orderId: order.id,
                    orderNumber: currentOrder.orderNumber || '',
                    source: 'online',
                    commissionRate: 20,
                    commissionBaseAmount,
                    commissionAmount,
                    previousBalance,
                    newBalance,
                    difference: commissionAmount,
                    reason: 'Комиссия 20% от максимальной цены онлайн-заказа',
                    changedAt: serverTimestamp(),
                    changedBy: currentUser.uid
                });
            }

            transaction.update(orderRef, {
                status: 'completed',
                commissionRate: 20,
                commissionBaseAmount,
                commissionAmount,
                commissionBalanceBefore: previousBalance,
                commissionBalanceAfter: newBalance,
                commissionChargedAt: serverTimestamp(),
                completedByDispatcherUid: currentUser.uid,
                updatedAt: serverTimestamp()
            });

            if (stateRef && (!stateSnapshot.exists() || stateSnapshot.data().activeOrderId === order.id)) {
                transaction.set(stateRef, {
                    driverId,
                    status: 'available',
                    activeOrderId: '',
                    lastSeen: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }
        });
        setMessage(elements.onlineOrdersMessage, `Заказ завершён диспетчером. Комиссия ${formatMoney(commissionAmount)} учтена.`, true);
    } catch (error) {
        console.error('Не удалось завершить заказ диспетчером:', error);
        setMessage(elements.onlineOrdersMessage, error.message || 'Не удалось завершить заказ. Обновите страницу и повторите попытку.');
    } finally {
        dispatcherCompletionInProgress = false;
        renderOnlineOrders();
    }
}

async function resolveClientCancellation(order, decision) {
    if (!currentUser || cancellationDecisionInProgress || order.cancellationRequestStatus !== 'pending') return;
    const falseCall = decision === 'false_call_fee';
    const confirmation = falseCall
        ? `Подтвердить ложный вызов по заказу ${order.orderNumber || order.id}? Будет зафиксирована компенсация 500 ₸ без автоматического списания.`
        : `Подтвердить отмену заказа ${order.orderNumber || order.id} без компенсации?`;
    if (!window.confirm(confirmation)) return;

    cancellationDecisionInProgress = true;
    setMessage(elements.onlineOrdersMessage, '');
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', order.id);
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists()) throw new Error('Заказ не найден.');
            const currentOrder = orderSnapshot.data();
            if (!ACTIVE_ORDER_STATUSES.has(currentOrder.status)
                || currentOrder.cancellationRequestStatus !== 'pending') {
                throw new Error('Запрос на отмену уже обработан или статус заказа изменился.');
            }

            let stateRef = null;
            let stateSnapshot = null;
            if (currentOrder.assignedDriverUid) {
                stateRef = doc(db, 'driverStates', currentOrder.assignedDriverUid);
                stateSnapshot = await transaction.get(stateRef);
            }

            transaction.update(orderRef, {
                status: 'cancelled',
                cancellationRequestStatus: falseCall ? 'approved_false_call' : 'approved_free',
                cancellationDecision: falseCall ? 'false_call_fee' : 'free',
                cancellationFeeAmount: falseCall ? 500 : 0,
                cancellationReviewedAt: serverTimestamp(),
                cancellationReviewedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });
            if (stateRef
                && stateSnapshot?.exists()
                && stateSnapshot.data().status === 'busy'
                && stateSnapshot.data().activeOrderId === order.id) {
                transaction.update(stateRef, {
                    status: 'available',
                    activeOrderId: '',
                    lastSeen: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        });
        setMessage(
            elements.onlineOrdersMessage,
            falseCall
                ? 'Заказ отменён. Компенсация за ложный вызов 500 ₸ зафиксирована.'
                : 'Заказ отменён без компенсации.',
            true
        );
    } catch (error) {
        console.error('Не удалось обработать запрос на отмену:', error);
        setMessage(elements.onlineOrdersMessage, error.message || 'Не удалось обработать запрос на отмену.');
    } finally {
        cancellationDecisionInProgress = false;
        renderOnlineOrders();
    }
}

async function ensureUidAvailable(uid, driverId) {
    if (!uid) return;
    const accountSnapshot = await getDoc(doc(db, 'driverAccounts', uid));
    if (accountSnapshot.exists() && String(accountSnapshot.data().driverId) !== String(driverId)) {
        throw new Error('Этот Google UID уже привязан к другому водителю.');
    }
}

async function saveDriver(original, controls) {
    const name = controls.name.value.trim();
    const balance = parseBalance(controls.balance.value);
    const authUid = normalizeUid(controls.uid.value);
    const status = controls.status.value;
    if (!name) return setMessage(controls.message, 'Укажите имя водителя.');
    if (balance === null) return setMessage(controls.message, 'Баланс должен быть числом.');
    if (!validateUid(authUid)) return setMessage(controls.message, 'UID содержит недопустимые символы. Скопируйте его полностью из Firebase.');

    controls.button.disabled = true;
    setMessage(controls.message, '');
    try {
        await ensureUidAvailable(authUid, original.id);
        const batch = writeBatch(db);
        const driverRef = doc(db, 'drivers', original.id);
        const oldUid = normalizeUid(original.authUid || '');
        if (oldUid && oldUid !== authUid && driverStates.get(oldUid)?.status === 'busy') {
            throw new Error('Нельзя менять UID, пока водитель выполняет заказ.');
        }
        const updatedDriver = {
            name,
            phone: controls.phone.value.trim(),
            car: controls.car.value.trim(),
            color: controls.color.value.trim(),
            balance,
            status,
            authUid,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid
        };
        batch.update(driverRef, updatedDriver);

        if (oldUid && oldUid !== authUid) {
            batch.delete(doc(db, 'driverAccounts', oldUid));
            batch.delete(doc(db, 'driverStates', oldUid));
        }
        if (authUid) {
            batch.set(doc(db, 'driverAccounts', authUid), {
                driverId: original.id,
                active: status === 'active',
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid
            });
        }

        if (Number(original.balance) !== balance) {
            batch.set(doc(collection(db, 'balanceHistory')), {
                driverId: original.id,
                driverNumber: original.driverNumber,
                previousBalance: Number(original.balance) || 0,
                newBalance: balance,
                difference: balance - (Number(original.balance) || 0),
                reason: 'Изменение диспетчером',
                changedAt: serverTimestamp(),
                changedBy: currentUser.uid
            });
        }

        await batch.commit();
        setMessage(controls.message, 'Изменения сохранены.', true);
    } catch (error) {
        console.error('Не удалось сохранить водителя:', error);
        setMessage(controls.message, error.message || 'Не удалось сохранить изменения.');
    } finally {
        controls.button.disabled = false;
    }
}

async function addDriver(event) {
    event.preventDefault();
    const rawNumber = elements.newDriverNumber.value.trim();
    const driverNumber = Number(rawNumber);
    const name = elements.newDriverName.value.trim();
    const balance = parseBalance(elements.newDriverBalance.value);
    const authUid = normalizeUid(elements.newDriverUid.value);
    const status = elements.newDriverStatus.value;

    if (!/^\d+$/.test(rawNumber) || !Number.isInteger(driverNumber) || driverNumber <= 0) {
        return setMessage(elements.addDriverMessage, 'ID водителя должен быть положительным целым числом.');
    }
    if (!name) return setMessage(elements.addDriverMessage, 'Укажите имя водителя.');
    if (balance === null) return setMessage(elements.addDriverMessage, 'Баланс должен быть числом.');
    if (!validateUid(authUid)) return setMessage(elements.addDriverMessage, 'UID содержит недопустимые символы.');

    elements.addDriverButton.disabled = true;
    setMessage(elements.addDriverMessage, '');
    try {
        const driverId = String(driverNumber);
        const driverRef = doc(db, 'drivers', driverId);
        if ((await getDoc(driverRef)).exists()) throw new Error(`Водитель с ID ${driverNumber} уже существует.`);
        await ensureUidAvailable(authUid, driverId);

        const batch = writeBatch(db);
        batch.set(driverRef, {
            driverNumber,
            name,
            phone: elements.newDriverPhone.value.trim(),
            car: elements.newDriverCar.value.trim(),
            color: elements.newDriverColor.value.trim(),
            balance,
            status,
            authUid,
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid
        });
        if (authUid) {
            batch.set(doc(db, 'driverAccounts', authUid), {
                driverId,
                active: status === 'active',
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid
            });
        }
        batch.set(doc(collection(db, 'balanceHistory')), {
            driverId,
            driverNumber,
            previousBalance: 0,
            newBalance: balance,
            difference: balance,
            reason: 'Начальный баланс',
            changedAt: serverTimestamp(),
            changedBy: currentUser.uid
        });

        await batch.commit();
        elements.addDriverForm.reset();
        elements.newDriverBalance.value = '0';
        elements.newDriverStatus.value = 'active';
        setMessage(elements.addDriverMessage, `Водитель ID ${driverNumber} добавлен.`, true);
    } catch (error) {
        console.error('Не удалось добавить водителя:', error);
        setMessage(elements.addDriverMessage, error.message || 'Не удалось добавить водителя.');
    } finally {
        elements.addDriverButton.disabled = false;
    }
}

async function loadOrdersLink() {
    try {
        const snapshot = await getDoc(doc(db, 'settings', 'driverPortal'));
        elements.ordersChatUrl.value = snapshot.exists() ? snapshot.data().ordersChatUrl || '' : '';
    } catch (error) {
        console.warn('Не удалось загрузить ссылку заказов:', error.code || error.message);
    }
}

async function saveOrdersLink(event) {
    event.preventDefault();
    const url = elements.ordersChatUrl.value.trim();
    if (url && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+(?:\?.*)?$/i.test(url)) {
        return setMessage(elements.ordersLinkMessage, 'Укажите полную ссылку вида https://chat.whatsapp.com/...');
    }

    elements.saveOrdersLink.disabled = true;
    setMessage(elements.ordersLinkMessage, '');
    try {
        await setDoc(doc(db, 'settings', 'driverPortal'), {
            ordersChatUrl: url,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid
        }, { merge: true });
        setMessage(elements.ordersLinkMessage, 'Ссылка сохранена.', true);
    } catch (error) {
        console.error('Не удалось сохранить ссылку:', error);
        setMessage(elements.ordersLinkMessage, 'Не удалось сохранить ссылку.');
    } finally {
        elements.saveOrdersLink.disabled = false;
    }
}

elements.loginButton.addEventListener('click', login);
elements.logoutButton.addEventListener('click', () => signOut(auth));
elements.copyUid.addEventListener('click', copyUid);
elements.addDriverForm.addEventListener('submit', addDriver);
elements.ordersLinkForm.addEventListener('submit', saveOrdersLink);
elements.dispatcherMessagesForm.addEventListener('submit', (event) => void sendDispatcherMessage(event));
elements.createPhoneOrderButton?.addEventListener('click', openPhoneOrderModal);
elements.phoneOrderServiceButtons.forEach((button) => {
    button.addEventListener('click', () => setPhoneOrderService(button.dataset.phoneOrderService));
});
elements.phoneOrderForm?.addEventListener('submit', (event) => void createPhoneOrder(event));
elements.phoneOrderClose?.addEventListener('click', closePhoneOrderModal);
elements.phoneOrderCancel?.addEventListener('click', closePhoneOrderModal);
elements.phoneOrderModal?.addEventListener('click', (event) => {
    if (event.target === elements.phoneOrderModal) closePhoneOrderModal();
});
elements.driverSearch.addEventListener('input', renderDrivers);
elements.toggleOnlineOrdersSection.addEventListener('click', () => {
    setOnlineOrdersSectionCollapsed(!onlineOrdersSectionCollapsed);
});
elements.driverStatsButtons.forEach((button) => {
    button.addEventListener('click', () => openDriverSummary(button.dataset.driverStatFilter));
});
elements.driverSummaryClose.addEventListener('click', closeDriverSummary);
elements.driverSummaryModal.addEventListener('click', (event) => {
    if (event.target === elements.driverSummaryModal) closeDriverSummary();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.driverSummaryModal.classList.contains('hidden')) {
        closeDriverSummary();
    }
    if (event.key === 'Escape' && !elements.phoneOrderModal?.classList.contains('hidden')) {
        closePhoneOrderModal();
    }
});
elements.mobileSectionButtons.forEach((button) => {
    button.addEventListener('click', () => setMobileDispatcherSection(button.dataset.dispatcherSectionButton));
});
elements.mobileOrdersCurrentButton.addEventListener('click', () => setMobileOrdersView('current'));
elements.mobileOrdersHistoryButton.addEventListener('click', () => setMobileOrdersView('history'));
elements.dispatcherMessagesSoundToggle?.addEventListener('click', () => void toggleDispatcherChatSound());
setMobileDispatcherSection('orders', false);

if (dispatcherChatSoundEnabled) {
    document.addEventListener('pointerdown', () => void prepareDispatcherChatSound(), { once: true });
}
updateDispatcherChatSoundControl();

getRedirectResult(auth).catch((error) => {
    console.error('Ошибка возврата из Google:', error);
    showAuthMessage('Google не завершил вход. Попробуйте ещё раз.');
});

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    setHidden(elements.authLoading, true);
    setHidden(elements.signedOut, Boolean(user));
    setHidden(elements.signedIn, !user);
    stopAdminPanel();
    showAuthMessage('');

    if (!user) return;

    elements.userName.textContent = user.displayName || 'Администратор';
    elements.userEmail.textContent = user.email || '';
    elements.userUid.textContent = user.uid;
    if (user.photoURL) {
        elements.userPhoto.src = user.photoURL;
        setHidden(elements.userPhoto, false);
        setHidden(elements.userPlaceholder, true);
    } else {
        setHidden(elements.userPhoto, true);
        setHidden(elements.userPlaceholder, false);
    }

    await checkAdminAccess(user);
});
