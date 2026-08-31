import { auth, db, googleProvider } from './firebase-config.js';
import {
    getRedirectResult,
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    startAfter,
    updateDoc,
    where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ACTIVE_ORDER_STATUSES = new Set(['accepted', 'en_route', 'arrived', 'in_trip']);
const NEXT_ORDER_STATUS = {
    accepted: ['en_route', 'Выехал к клиенту'],
    en_route: ['arrived', 'Я приехал'],
    arrived: ['in_trip', 'Начать поездку'],
    in_trip: ['completed', 'Завершить поездку']
};
const ORDER_ALERTS_PREFERENCE_KEY = 'taxi-uspeh-driver-order-alerts';
const DEFAULT_PAGE_TITLE = document.title;
const DRIVER_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const BALANCE_HISTORY_RESPONSE_TIMEOUT_MS = 6000;
const BALANCE_HISTORY_PAGE_SIZE = 20;
const OFFLINE_DRIVER_STATE = Object.freeze({ status: 'offline', activeOrderId: '' });

const elements = {
    loading: document.getElementById('driver-auth-loading'),
    signedOut: document.getElementById('driver-signed-out'),
    signedIn: document.getElementById('driver-signed-in'),
    loginButton: document.getElementById('driver-login-button'),
    logoutButton: document.getElementById('driver-logout-button'),
    userPhoto: document.getElementById('driver-user-photo'),
    userPlaceholder: document.getElementById('driver-user-placeholder'),
    userName: document.getElementById('driver-user-name'),
    userEmail: document.getElementById('driver-user-email'),
    userUid: document.getElementById('driver-user-uid'),
    copyUid: document.getElementById('driver-copy-uid'),
    pending: document.getElementById('driver-account-pending'),
    profile: document.getElementById('driver-profile'),
    profileName: document.getElementById('driver-profile-name'),
    profileCar: document.getElementById('driver-profile-car'),
    profileBalance: document.getElementById('driver-profile-balance'),
    shiftControl: document.getElementById('driver-shift-control'),
    shiftIcon: document.getElementById('driver-shift-icon'),
    workStatus: document.getElementById('driver-work-status'),
    workStatusDetail: document.getElementById('driver-work-status-detail'),
    shiftToggle: document.getElementById('driver-shift-toggle'),
    shiftMessage: document.getElementById('driver-shift-message'),
    balanceHistoryLoading: document.getElementById('driver-balance-history-loading'),
    balanceHistoryEmpty: document.getElementById('driver-balance-history-empty'),
    balanceHistoryList: document.getElementById('driver-balance-history-list'),
    balanceHistoryMore: document.getElementById('driver-balance-history-more'),
    ordersSection: document.getElementById('driver-online-orders'),
    ordersLoading: document.getElementById('driver-orders-loading'),
    ordersEmpty: document.getElementById('driver-online-orders-empty'),
    ordersList: document.getElementById('driver-online-orders-list'),
    ordersMessage: document.getElementById('driver-online-orders-message'),
    ordersLink: document.getElementById('driver-orders-link'),
    ordersUnavailable: document.getElementById('driver-orders-unavailable'),
    alertsToggle: document.getElementById('driver-order-alerts-toggle'),
    alertsTest: document.getElementById('driver-order-alerts-test'),
    alertsStatus: document.getElementById('driver-order-alerts-status'),
    alertsIcon: document.getElementById('driver-order-alerts-icon'),
    newOrderAlert: document.getElementById('driver-new-order-alert'),
    newOrderAlertTitle: document.getElementById('driver-new-order-alert-title'),
    newOrderAlertRoute: document.getElementById('driver-new-order-alert-route'),
    newOrderAlertPrice: document.getElementById('driver-new-order-alert-price'),
    newOrderAlertView: document.getElementById('driver-new-order-alert-view'),
    newOrderAlertClose: document.getElementById('driver-new-order-alert-close'),
    message: document.getElementById('driver-auth-message')
};

let authActionInProgress = false;
let orderActionInProgress = false;
let currentUser = null;
let currentDriverId = '';
let currentDriver = null;
let currentAccount = null;
let currentBaseEligible = false;
let currentDriverState = OFFLINE_DRIVER_STATE;
let currentCanTakeOrders = false;
let openOrders = [];
let assignedOrders = [];
let unsubscribeAccount = null;
let unsubscribeDriver = null;
let unsubscribeDriverState = null;
let unsubscribeBalanceHistory = null;
let unsubscribeOpenOrders = null;
let unsubscribeAssignedOrders = null;
let watchedOrdersUserUid = '';
let assignedOrdersLoaded = false;
let openOrdersLoaded = false;
let driverStateActionInProgress = false;
let heartbeatInProgress = false;
let heartbeatTimer = null;
let legacyStateRepairInProgress = false;
let orderAlertsEnabled = readOrderAlertsPreference();
let orderAudioContext = null;
let initialOpenOrdersLoaded = false;
let seenOpenOrderIds = new Set();
let currentAlertOrderId = '';
let newOrderAlertTimer = null;
let requestedOrderHandled = false;
let watchedHistoryDriverId = '';
let balanceHistory = [];
let balanceHistoryLoadTimer = null;
let balanceHistoryCursor = null;
let balanceHistoryHasMore = false;
let balanceHistoryLoadingMore = false;

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
}

function readOrderAlertsPreference() {
    try {
        return localStorage.getItem(ORDER_ALERTS_PREFERENCE_KEY) === 'enabled';
    } catch {
        return false;
    }
}

function saveOrderAlertsPreference() {
    try {
        localStorage.setItem(ORDER_ALERTS_PREFERENCE_KEY, orderAlertsEnabled ? 'enabled' : 'disabled');
    } catch (error) {
        console.warn('Не удалось сохранить настройку уведомлений:', error.message);
    }
}

function notificationPermission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
}

function updateOrderAlertsControls() {
    if (!elements.alertsToggle || !elements.alertsStatus || !elements.alertsIcon) return;
    const permission = notificationPermission();
    const toggleIcon = elements.alertsToggle.querySelector('i');
    const toggleLabel = elements.alertsToggle.querySelector('span');
    const statusIcon = elements.alertsIcon.querySelector('i');

    if (!orderAlertsEnabled) {
        elements.alertsToggle.className = 'rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 text-sm font-extrabold shadow-sm';
        toggleIcon.className = 'fas fa-bell mr-2';
        toggleLabel.textContent = 'Включить уведомления';
        statusIcon.className = 'fas fa-bell-slash';
        elements.alertsStatus.textContent = 'Нажмите кнопку, чтобы включить звук, вибрацию и уведомления телефона.';
        setHidden(elements.alertsTest, true);
        return;
    }

    elements.alertsToggle.className = 'rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 px-4 py-3 text-sm font-extrabold';
    toggleIcon.className = 'fas fa-bell-slash mr-2';
    toggleLabel.textContent = 'Отключить сигналы';
    statusIcon.className = 'fas fa-bell';
    setHidden(elements.alertsTest, false);

    if (permission === 'granted') {
        elements.alertsStatus.textContent = 'Включены звук, вибрация и уведомления в верхней панели телефона.';
    } else if (permission === 'denied') {
        elements.alertsStatus.textContent = 'Звук и вибрация включены. Системные уведомления заблокированы в настройках браузера.';
    } else if (permission === 'unsupported') {
        elements.alertsStatus.textContent = 'Звук и вибрация включены. Этот браузер не поддерживает системные уведомления.';
    } else {
        elements.alertsStatus.textContent = 'Звук и вибрация включены. Разрешите системные уведомления при следующем включении.';
    }
}

function getOrderAudioContext() {
    if (orderAudioContext) return orderAudioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    orderAudioContext = new AudioContextClass();
    return orderAudioContext;
}

async function prepareOrderSound() {
    const context = getOrderAudioContext();
    if (context?.state === 'suspended') await context.resume();
    return context;
}

async function playOrderSound() {
    try {
        const context = await prepareOrderSound();
        if (!context || context.state !== 'running') return;
        const startAt = context.currentTime;
        for (const [offset, frequency] of [[0, 880], [0.32, 1046]]) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.16, startAt + offset + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.24);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + 0.25);
        }
    } catch (error) {
        console.warn('Звуковой сигнал недоступен:', error.message);
    }
}

function vibrateForOrder() {
    if ('vibrate' in navigator) navigator.vibrate([180, 90, 180]);
}

function hideNewOrderAlert() {
    if (newOrderAlertTimer) clearTimeout(newOrderAlertTimer);
    newOrderAlertTimer = null;
    currentAlertOrderId = '';
    setHidden(elements.newOrderAlert, true);
}

function showNewOrderAlert({ title, route, price, orderId = '' }) {
    if (!elements.newOrderAlert) return;
    if (newOrderAlertTimer) clearTimeout(newOrderAlertTimer);
    currentAlertOrderId = orderId;
    elements.newOrderAlertTitle.textContent = title;
    elements.newOrderAlertRoute.textContent = route;
    elements.newOrderAlertPrice.textContent = price;
    elements.newOrderAlertView.textContent = orderId ? 'Посмотреть заказ' : 'Перейти к заказам';
    setHidden(elements.newOrderAlert, false);
    newOrderAlertTimer = setTimeout(hideNewOrderAlert, 15000);
}

function scrollToOrder(orderId = '') {
    const orderCard = orderId ? document.getElementById(`driver-order-${orderId}`) : null;
    const target = orderCard || elements.ordersSection;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (orderCard) {
        orderCard.classList.add('ring-4', 'ring-yellow-300');
        setTimeout(() => orderCard.classList.remove('ring-4', 'ring-yellow-300'), 2500);
    }
}

async function showSystemNotification({ title, body, tag, url }) {
    if (notificationPermission() !== 'granted') return false;
    const options = {
        body,
        icon: './favicon-192x192.png',
        badge: './favicon-32x32.png',
        vibrate: [180, 90, 180],
        tag,
        renotify: true,
        data: { url }
    };

    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration()
                || await navigator.serviceWorker.ready;
            if (registration) {
                await registration.showNotification(title, options);
                return true;
            }
        }
        const notification = new Notification(title, options);
        const notificationOrderId = new URL(url, window.location.href).searchParams.get('order') || '';
        notification.onclick = () => {
            window.focus();
            scrollToOrder(notificationOrderId);
            notification.close();
        };
        return true;
    } catch (error) {
        console.warn('Системное уведомление недоступно:', error.message);
        return false;
    }
}

function orderRoute(order) {
    return `${order.fromAddress || 'Адрес подачи не указан'} → ${order.toAddress || 'Адрес назначения не указан'}`;
}

function signalNewOrder(order) {
    if (!orderAlertsEnabled || !currentCanTakeOrders) return;
    const route = orderRoute(order);
    const price = order.priceText || 'Цена уточняется';
    showNewOrderAlert({ title: 'Новый онлайн-заказ', route, price, orderId: order.id });
    void playOrderSound();
    vibrateForOrder();
    void showSystemNotification({
        title: 'Новый заказ — Такси «Успех»',
        body: `${route}\n${price}`,
        tag: `taxi-uspeh-order-${order.id}`,
        url: `./drivers.html?order=${encodeURIComponent(order.id)}#driver-online-orders`
    });
}

async function testOrderAlerts() {
    if (!orderAlertsEnabled) return;
    await prepareOrderSound().catch(() => null);
    showNewOrderAlert({
        title: 'Проверка уведомлений',
        route: 'Звук, вибрация и сообщение в кабинете работают',
        price: 'Это не настоящий заказ'
    });
    void playOrderSound();
    vibrateForOrder();
    await showSystemNotification({
        title: 'Проверка — Такси «Успех»',
        body: 'Уведомления о новых заказах включены.',
        tag: 'taxi-uspeh-driver-alert-test',
        url: './drivers.html#driver-online-orders'
    });
}

async function toggleOrderAlerts() {
    if (orderAlertsEnabled) {
        orderAlertsEnabled = false;
        saveOrderAlertsPreference();
        hideNewOrderAlert();
        if ('vibrate' in navigator) navigator.vibrate(0);
        updateOrderAlertsControls();
        return;
    }

    orderAlertsEnabled = true;
    saveOrderAlertsPreference();
    await prepareOrderSound().catch(() => null);
    if (notificationPermission() === 'default') {
        try {
            await Notification.requestPermission();
        } catch (error) {
            console.warn('Не удалось запросить разрешение уведомлений:', error.message);
        }
    }
    updateOrderAlertsControls();
    await testOrderAlerts();
}

function updateOrdersPageTitle() {
    const availableCount = currentCanTakeOrders ? openOrders.length : 0;
    const assignedCount = assignedOrders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).length;
    const visibleCount = availableCount + assignedCount;
    document.title = visibleCount > 0 ? `(${visibleCount}) Заказы — Такси «Успех»` : DEFAULT_PAGE_TITLE;
}

function scrollRequestedOrderIntoView() {
    if (requestedOrderHandled) return;
    const requestedOrderId = new URLSearchParams(window.location.search).get('order');
    if (!requestedOrderId) {
        requestedOrderHandled = true;
        return;
    }
    const orderCard = document.getElementById(`driver-order-${requestedOrderId}`);
    if (!orderCard) return;
    requestedOrderHandled = true;
    requestAnimationFrame(() => scrollToOrder(requestedOrderId));
}

function showMessage(text) {
    if (!elements.message) return;
    elements.message.textContent = text;
    setHidden(elements.message, !text);
}

function showOrdersMessage(text, success = false) {
    if (!elements.ordersMessage) return;
    elements.ordersMessage.textContent = text;
    elements.ordersMessage.className = text
        ? `m-3 rounded-lg border p-3 text-xs ${success
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`
        : 'hidden m-3 rounded-lg border p-3 text-xs';
}

function setAuthButtonBusy(busy) {
    authActionInProgress = busy;
    if (!elements.loginButton) return;
    elements.loginButton.disabled = busy;
    elements.loginButton.classList.toggle('opacity-60', busy);
    elements.loginButton.querySelector('span').textContent = busy ? 'Открываем Google…' : 'Войти через Google';
}

function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'Не указан';
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
}

function formatSignedMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return `${amount > 0 ? '+' : ''}${formatMoney(amount)}`;
}

function balanceHistoryTime(entry) {
    if (!entry.changedAt?.toDate) return 'Только что';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(entry.changedAt.toDate());
}

function balanceHistoryMillis(entry) {
    return entry.changedAt?.toMillis ? entry.changedAt.toMillis() : 0;
}

function clearBalanceHistoryLoadTimer() {
    if (!balanceHistoryLoadTimer) return;
    clearTimeout(balanceHistoryLoadTimer);
    balanceHistoryLoadTimer = null;
}

function setBalanceHistoryEmptyMessage(message) {
    const text = elements.balanceHistoryEmpty?.querySelector('p');
    if (text) text.textContent = message;
}

function showBalanceHistoryUnavailable(message) {
    clearBalanceHistoryLoadTimer();
    setBalanceHistoryEmptyMessage(message);
    setHidden(elements.balanceHistoryLoading, true);
    setHidden(elements.balanceHistoryList, true);
    setHidden(elements.balanceHistoryEmpty, false);
    setHidden(elements.balanceHistoryMore, true);
}

function balanceHistoryQuery(driverId, cursor = null) {
    const constraints = [
        where('driverId', '==', driverId),
        orderBy('changedAt', 'desc'),
        limit(BALANCE_HISTORY_PAGE_SIZE)
    ];
    if (cursor) constraints.push(startAfter(cursor));
    return query(collection(db, 'balanceHistory'), ...constraints);
}

function mergeBalanceHistoryEntries(entries) {
    const byId = new Map(balanceHistory.map((entry) => [entry.id, entry]));
    entries.forEach((entry) => byId.set(entry.id, entry));
    balanceHistory = [...byId.values()];
}

function updateBalanceHistoryMoreButton(entries) {
    if (!elements.balanceHistoryMore) return;
    const visible = entries.length > 0 && balanceHistoryHasMore;
    setHidden(elements.balanceHistoryMore, !visible);
    if (!visible) return;
    elements.balanceHistoryMore.disabled = balanceHistoryLoadingMore;
    elements.balanceHistoryMore.classList.toggle('opacity-60', balanceHistoryLoadingMore);
    const icon = elements.balanceHistoryMore.querySelector('i');
    const label = elements.balanceHistoryMore.querySelector('span');
    if (icon) icon.className = balanceHistoryLoadingMore ? 'fas fa-circle-notch fa-spin mr-2' : 'fas fa-chevron-down mr-2';
    if (label) label.textContent = balanceHistoryLoadingMore ? 'Загружаем…' : 'Показать ещё';
}

function renderBalanceHistory() {
    if (!elements.balanceHistoryList) return;
    clearBalanceHistoryLoadTimer();
    setBalanceHistoryEmptyMessage('Изменений баланса пока нет');
    const entries = [...balanceHistory]
        .sort((a, b) => balanceHistoryMillis(b) - balanceHistoryMillis(a));

    elements.balanceHistoryList.replaceChildren();
    for (const entry of entries) {
        const item = document.createElement('article');
        item.className = 'px-4 py-3 text-xs';
        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-3';
        const details = document.createElement('div');
        details.className = 'min-w-0';
        details.append(
            createText('p', 'font-extrabold text-gray-900 dark:text-white', entry.reason || 'Изменение баланса'),
            createText(
                'p',
                'mt-1 text-[11px] text-gray-600 dark:text-gray-300',
                [entry.orderNumber ? `Заказ ${entry.orderNumber}` : '', balanceHistoryTime(entry)].filter(Boolean).join(' · ')
            )
        );
        const difference = createText(
            'p',
            `flex-shrink-0 font-black ${Number(entry.difference) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`,
            formatSignedMoney(entry.difference)
        );
        header.append(details, difference);
        item.append(header);

        if (Number.isFinite(Number(entry.previousBalance)) && Number.isFinite(Number(entry.newBalance))) {
            item.append(createText(
                'p',
                'mt-1 text-[11px] text-gray-500 dark:text-gray-400',
                `Баланс: ${formatMoney(entry.previousBalance)} → ${formatMoney(entry.newBalance)}`
            ));
        }
        if (entry.source === 'online' && Number.isFinite(Number(entry.commissionBaseAmount))) {
            item.append(createText(
                'p',
                'mt-1 text-[11px] text-gray-500 dark:text-gray-400',
                `Расчёт: 20% от ${formatMoney(entry.commissionBaseAmount)}`
            ));
        }
        elements.balanceHistoryList.append(item);
    }

    setHidden(elements.balanceHistoryLoading, true);
    setHidden(elements.balanceHistoryList, entries.length === 0);
    setHidden(elements.balanceHistoryEmpty, entries.length !== 0);
    updateBalanceHistoryMoreButton(entries);
}

async function loadMoreBalanceHistory() {
    if (balanceHistoryLoadingMore || !balanceHistoryHasMore || !balanceHistoryCursor || !watchedHistoryDriverId) return;
    const requestedDriverId = watchedHistoryDriverId;
    balanceHistoryLoadingMore = true;
    renderBalanceHistory();
    try {
        const snapshot = await getDocs(balanceHistoryQuery(requestedDriverId, balanceHistoryCursor));
        if (requestedDriverId !== watchedHistoryDriverId) return;
        const entries = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        mergeBalanceHistoryEntries(entries);
        balanceHistoryCursor = snapshot.docs.at(-1) || balanceHistoryCursor;
        balanceHistoryHasMore = snapshot.docs.length === BALANCE_HISTORY_PAGE_SIZE;
    } catch (error) {
        console.warn('Следующая страница истории не загрузилась:', error.code || error.message);
    } finally {
        if (requestedDriverId === watchedHistoryDriverId) {
            balanceHistoryLoadingMore = false;
            renderBalanceHistory();
        }
    }
}

function watchBalanceHistory(driverId) {
    const normalizedId = String(driverId || '');
    if (!normalizedId || watchedHistoryDriverId === normalizedId) return;
    if (unsubscribeBalanceHistory) unsubscribeBalanceHistory();
    unsubscribeBalanceHistory = null;
    clearBalanceHistoryLoadTimer();
    watchedHistoryDriverId = normalizedId;
    balanceHistory = [];
    balanceHistoryCursor = null;
    balanceHistoryHasMore = false;
    balanceHistoryLoadingMore = false;
    setBalanceHistoryEmptyMessage('Изменений баланса пока нет');
    setHidden(elements.balanceHistoryLoading, false);
    setHidden(elements.balanceHistoryEmpty, true);
    setHidden(elements.balanceHistoryList, true);

    unsubscribeBalanceHistory = onSnapshot(
        balanceHistoryQuery(normalizedId),
        (snapshot) => {
            const entries = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            mergeBalanceHistoryEntries(entries);
            if (!balanceHistoryCursor) balanceHistoryCursor = snapshot.docs.at(-1) || null;
            balanceHistoryHasMore = snapshot.docs.length === BALANCE_HISTORY_PAGE_SIZE;
            renderBalanceHistory();
        },
        (error) => {
            console.warn('История баланса не загрузилась:', error.code || error.message);
            balanceHistory = [];
            showBalanceHistoryUnavailable('История пока недоступна. Проверьте интернет и обновите страницу.');
        }
    );
    balanceHistoryLoadTimer = setTimeout(() => {
        showBalanceHistoryUnavailable('История пока не ответила. Проверьте интернет или обновите страницу.');
    }, BALANCE_HISTORY_RESPONSE_TIMEOUT_MS);
}

function carDescription(driver) {
    return [driver.car, driver.color].filter(Boolean).join(', ') || 'Автомобиль не указан';
}

function createdAtMillis(order) {
    return order.createdAt?.toMillis ? order.createdAt.toMillis() : 0;
}

function orderStatusLabel(status) {
    return ({
        accepted: 'Заказ принят',
        en_route: 'Еду к клиенту',
        arrived: 'Ожидаю клиента',
        in_trip: 'Поездка выполняется'
    })[status] || 'Свободный заказ';
}

function canAccessOrders(driver, account) {
    const balance = Number(driver.balance);
    const status = driver.status || 'paused';
    return account.active !== false
        && status === 'active'
        && Number.isFinite(balance)
        && balance < 0;
}

function showShiftMessage(text, success = false) {
    if (!elements.shiftMessage) return;
    elements.shiftMessage.textContent = text;
    elements.shiftMessage.className = text
        ? `mt-2 text-xs ${success
            ? 'text-green-700 dark:text-green-300'
            : 'text-red-700 dark:text-red-300'}`
        : 'hidden mt-2 text-xs';
}

function normalizedDriverState(snapshot, driverId) {
    if (!snapshot?.exists()) return { ...OFFLINE_DRIVER_STATE, driverId: String(driverId), exists: false };
    const state = snapshot.data();
    if (String(state.driverId || '') !== String(driverId)) {
        return { ...OFFLINE_DRIVER_STATE, driverId: String(driverId), exists: false };
    }
    if (!['offline', 'available', 'busy'].includes(state.status)) {
        return { ...OFFLINE_DRIVER_STATE, driverId: String(driverId), exists: false };
    }
    return {
        ...state,
        exists: true,
        status: state.status,
        activeOrderId: typeof state.activeOrderId === 'string' ? state.activeOrderId : '',
        driverId: String(driverId)
    };
}

function renderWorkStatus(driver, account, state = currentDriverState) {
    const eligible = canAccessOrders(driver, account);
    const status = state?.status || 'offline';
    let title = 'Не на линии';
    let detail = 'Выйдите на линию, чтобы видеть новые онлайн-заказы.';
    let icon = 'fas fa-power-off';
    let containerClass = 'rounded-2xl p-4 mb-4 border bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700';
    let iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center';
    let buttonClass = 'mt-3 w-full rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-3 text-sm font-extrabold shadow-sm';
    let buttonIcon = 'fas fa-play mr-2';
    let buttonText = 'Выйти на линию';
    let disabled = false;

    if (status === 'busy') {
        title = 'Занят — выполняется заказ';
        detail = 'Новые заказы скрыты. Завершите текущую поездку, чтобы снова стать свободным.';
        icon = 'fas fa-route';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 flex items-center justify-center';
        buttonClass = 'mt-3 w-full rounded-xl bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm font-extrabold cursor-not-allowed';
        buttonIcon = 'fas fa-lock mr-2';
        buttonText = 'Сначала завершите заказ';
        disabled = true;
    } else if (!eligible) {
        title = 'Доступ к заказам ограничен';
        detail = driver.status !== 'active' || account.active === false
            ? 'Работу с заказами приостановил диспетчер.'
            : 'При балансе 0 ₸ или выше новые заказы недоступны.';
        icon = 'fas fa-ban';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 flex items-center justify-center';
        buttonClass = 'mt-3 w-full rounded-xl bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm font-extrabold cursor-not-allowed';
        buttonIcon = 'fas fa-lock mr-2';
        buttonText = 'Доступ ограничен';
        disabled = true;
    } else if (status === 'offline' && !assignedOrdersLoaded) {
        title = 'Проверяем текущие заказы';
        detail = 'Подождите несколько секунд перед началом смены.';
        icon = 'fas fa-circle-notch fa-spin';
        buttonClass = 'mt-3 w-full rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-3 text-sm font-extrabold cursor-not-allowed';
        buttonIcon = 'fas fa-clock mr-2';
        buttonText = 'Проверяем…';
        disabled = true;
    } else if (status === 'offline'
        && state?.exists === false
        && assignedOrders.some((order) => ACTIVE_ORDER_STATUSES.has(order.status))) {
        title = 'Восстанавливаем текущий заказ';
        detail = 'Ранее начатая поездка останется у вас и не потеряется.';
        icon = 'fas fa-rotate';
        buttonClass = 'mt-3 w-full rounded-xl bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm font-extrabold cursor-not-allowed';
        buttonIcon = 'fas fa-clock mr-2';
        buttonText = 'Восстанавливаем…';
        disabled = true;
    } else if (status === 'available') {
        title = 'На линии — свободен';
        detail = 'Новые заказы и уведомления поступают автоматически.';
        icon = 'fas fa-circle-check';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 flex items-center justify-center';
        buttonClass = 'mt-3 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-4 py-3 text-sm font-extrabold';
        buttonIcon = 'fas fa-stop mr-2';
        buttonText = 'Уйти с линии';
    }

    elements.shiftControl.className = containerClass;
    elements.shiftIcon.className = iconClass;
    elements.shiftIcon.querySelector('i').className = icon;
    elements.workStatus.textContent = title;
    elements.workStatusDetail.textContent = detail;
    elements.shiftToggle.className = buttonClass;
    elements.shiftToggle.querySelector('i').className = buttonIcon;
    elements.shiftToggle.querySelector('span').textContent = driverStateActionInProgress ? 'Сохраняем…' : buttonText;
    elements.shiftToggle.disabled = disabled || driverStateActionInProgress;

    return eligible;
}

function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

async function touchDriverHeartbeat() {
    if (heartbeatInProgress || !currentUser || !currentDriverId || document.hidden) return;
    if (!['available', 'busy'].includes(currentDriverState.status)) return;
    heartbeatInProgress = true;
    try {
        await updateDoc(doc(db, 'driverStates', currentUser.uid), {
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.warn('Не удалось обновить связь с кабинетом:', error.code || error.message);
    } finally {
        heartbeatInProgress = false;
    }
}

function syncHeartbeat() {
    const shouldRun = Boolean(currentUser && ['available', 'busy'].includes(currentDriverState.status));
    if (!shouldRun) {
        stopHeartbeat();
        return;
    }
    if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => void touchDriverHeartbeat(), DRIVER_HEARTBEAT_INTERVAL_MS);
    }
}

async function setDriverShiftStatus(nextStatus, { silent = false } = {}) {
    if (!currentUser || !currentDriver || !currentAccount || driverStateActionInProgress) return false;
    if (!['offline', 'available'].includes(nextStatus)) return false;
    driverStateActionInProgress = true;
    if (!silent) showShiftMessage('');
    renderWorkStatus(currentDriver, currentAccount);

    try {
        if (nextStatus === 'available' && !currentBaseEligible) {
            throw new Error('Сейчас доступ к заказам ограничен. Проверьте статус и баланс.');
        }
        await runTransaction(db, async (transaction) => {
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const stateSnapshot = await transaction.get(stateRef);
            const existing = normalizedDriverState(stateSnapshot, currentDriverId);
            if (existing.status === 'busy') {
                throw new Error('Сначала завершите текущий заказ.');
            }
            transaction.set(stateRef, {
                driverId: currentDriverId,
                status: nextStatus,
                activeOrderId: '',
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
        if (!silent) {
            showShiftMessage(nextStatus === 'available' ? 'Вы вышли на линию.' : 'Вы ушли с линии.', true);
        }
        return true;
    } catch (error) {
        console.warn('Статус смены не изменён:', error.code || error.message);
        if (!silent) {
            showShiftMessage(
                error.code === 'permission-denied'
                    ? 'Не удалось изменить статус. Сначала опубликуйте новые правила Firebase.'
                    : error.message || 'Не удалось изменить статус смены.'
            );
        }
        return false;
    } finally {
        driverStateActionInProgress = false;
        if (currentDriver && currentAccount) renderWorkStatus(currentDriver, currentAccount);
    }
}

async function toggleDriverShift() {
    if (!assignedOrdersLoaded) {
        showShiftMessage('Подождите: проверяем текущие заказы.');
        return;
    }
    if (currentDriverState.exists === false
        && assignedOrders.some((order) => ACTIVE_ORDER_STATUSES.has(order.status))) {
        showShiftMessage('Восстанавливаем ранее начатый заказ.');
        await repairMissingBusyState();
        return;
    }
    const nextStatus = currentDriverState.status === 'available' ? 'offline' : 'available';
    await setDriverShiftStatus(nextStatus);
}

async function repairMissingBusyState() {
    if (legacyStateRepairInProgress || !currentUser || currentDriverState.exists !== false) return;
    const activeOrder = assignedOrders.find((order) => ACTIVE_ORDER_STATUSES.has(order.status));
    if (!activeOrder) return;
    legacyStateRepairInProgress = true;
    try {
        await runTransaction(db, async (transaction) => {
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const orderRef = doc(db, 'orders', activeOrder.id);
            const stateSnapshot = await transaction.get(stateRef);
            const orderSnapshot = await transaction.get(orderRef);
            if (stateSnapshot.exists()) return;
            if (!orderSnapshot.exists()
                || orderSnapshot.data().assignedDriverUid !== currentUser.uid
                || !ACTIVE_ORDER_STATUSES.has(orderSnapshot.data().status)) return;
            transaction.set(stateRef, {
                driverId: currentDriverId,
                status: 'busy',
                activeOrderId: activeOrder.id,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.warn('Не удалось восстановить рабочий статус:', error.code || error.message);
    } finally {
        legacyStateRepairInProgress = false;
    }
}

async function logoutDriver() {
    if (currentDriverState.status === 'available') {
        await setDriverShiftStatus('offline', { silent: true });
    }
    await signOut(auth);
}

async function loadOrdersLink(canTakeOrders) {
    setHidden(elements.ordersLink, true);
    setHidden(elements.ordersUnavailable, true);
    if (!canTakeOrders) return;

    try {
        const settingsSnapshot = await getDoc(doc(db, 'settings', 'driverPortal'));
        const url = settingsSnapshot.exists() ? settingsSnapshot.data().ordersChatUrl : '';
        if (typeof url === 'string' && /^https:\/\/chat\.whatsapp\.com\//i.test(url)) {
            elements.ordersLink.href = url;
            setHidden(elements.ordersLink, false);
        } else {
            setHidden(elements.ordersUnavailable, false);
        }
    } catch (error) {
        console.warn('Не удалось загрузить ссылку заказов:', error.code || error.message);
        setHidden(elements.ordersUnavailable, false);
    }
}

function stopOrderWatches() {
    if (unsubscribeOpenOrders) unsubscribeOpenOrders();
    if (unsubscribeAssignedOrders) unsubscribeAssignedOrders();
    unsubscribeOpenOrders = null;
    unsubscribeAssignedOrders = null;
    watchedOrdersUserUid = '';
    openOrders = [];
    assignedOrders = [];
    openOrdersLoaded = false;
    assignedOrdersLoaded = false;
    initialOpenOrdersLoaded = false;
    seenOpenOrderIds = new Set();
    hideNewOrderAlert();
    setHidden(elements.ordersSection, true);
    setHidden(elements.ordersList, true);
    setHidden(elements.ordersEmpty, true);
    setHidden(elements.ordersLoading, false);
    showOrdersMessage('');
    updateOrdersPageTitle();
}

function stopProfileWatches() {
    if (unsubscribeAccount) unsubscribeAccount();
    if (unsubscribeDriver) unsubscribeDriver();
    if (unsubscribeDriverState) unsubscribeDriverState();
    if (unsubscribeBalanceHistory) unsubscribeBalanceHistory();
    unsubscribeAccount = null;
    unsubscribeDriver = null;
    unsubscribeDriverState = null;
    unsubscribeBalanceHistory = null;
    clearBalanceHistoryLoadTimer();
    stopHeartbeat();
    currentDriverId = '';
    currentDriver = null;
    currentAccount = null;
    currentBaseEligible = false;
    currentDriverState = OFFLINE_DRIVER_STATE;
    currentCanTakeOrders = false;
    watchedHistoryDriverId = '';
    balanceHistory = [];
    balanceHistoryCursor = null;
    balanceHistoryHasMore = false;
    balanceHistoryLoadingMore = false;
    legacyStateRepairInProgress = false;
    stopOrderWatches();
}

function createText(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function createOrderCard(order, assigned) {
    const card = document.createElement('article');
    card.id = `driver-order-${order.id}`;
    card.dataset.orderId = order.id;
    card.className = assigned
        ? 'rounded-xl border-2 border-blue-300 dark:border-blue-700 bg-blue-50/70 dark:bg-blue-950/30 p-3'
        : 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3';

    const header = document.createElement('div');
    header.className = 'flex items-start justify-between gap-2';
    const title = createText('p', 'font-extrabold text-sm', order.orderNumber || `Заказ ${order.id.slice(0, 6)}`);
    const badge = createText(
        'span',
        assigned
            ? 'flex-shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-1 text-[10px] font-extrabold text-blue-800 dark:text-blue-200'
            : 'flex-shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-1 text-[10px] font-extrabold text-amber-800 dark:text-amber-200',
        orderStatusLabel(order.status)
    );
    header.append(title, badge);

    const route = createText('p', 'mt-2 text-sm font-bold break-words', `${order.fromAddress || '—'} → ${order.toAddress || '—'}`);
    const price = createText('p', 'mt-2 text-sm font-black text-green-700 dark:text-green-300', order.priceText || 'Цена уточняется');
    card.append(header, route, price);

    if (Array.isArray(order.stops) && order.stops.length) {
        card.append(createText('p', 'mt-2 text-xs text-gray-600 dark:text-gray-300', `Остановки: ${order.stops.join(' → ')}`));
    }
    if (order.scheduledFor) {
        card.append(createText('p', 'mt-1 text-xs text-gray-600 dark:text-gray-300', `Время: ${order.scheduledFor.replace('T', ' ')}`));
    }
    if (order.wishes) {
        card.append(createText('p', 'mt-1 text-xs text-gray-600 dark:text-gray-300', `Пожелания: ${order.wishes}`));
    }

    const actions = document.createElement('div');
    actions.className = 'mt-3 flex flex-wrap gap-2';
    const navigation = document.createElement('a');
    navigation.href = `https://yandex.kz/maps/?text=${encodeURIComponent(order.fromAddress || '')}`;
    navigation.target = '_blank';
    navigation.rel = 'noopener noreferrer';
    navigation.className = 'rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold';
    navigation.textContent = 'Маршрут';
    actions.append(navigation);

    if (!assigned) {
        const acceptButton = document.createElement('button');
        acceptButton.type = 'button';
        acceptButton.className = 'rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-xs font-extrabold';
        acceptButton.textContent = 'Принять';
        acceptButton.disabled = orderActionInProgress || !currentCanTakeOrders;
        acceptButton.addEventListener('click', () => acceptOrder(order.id));
        actions.append(acceptButton);
    } else {
        const contact = createText('p', 'w-full text-xs text-gray-600 dark:text-gray-300', 'Загружаем телефон клиента…');
        actions.append(contact);
        void loadOrderContact(order.id, contact, actions);

        const next = NEXT_ORDER_STATUS[order.status];
        if (next) {
            const statusButton = document.createElement('button');
            statusButton.type = 'button';
            statusButton.className = 'rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-extrabold';
            statusButton.textContent = next[1];
            statusButton.disabled = orderActionInProgress;
            statusButton.addEventListener('click', () => advanceOrder(order.id, order.status, next[0]));
            actions.append(statusButton);
        }
    }

    card.append(actions);
    return card;
}

async function loadOrderContact(orderId, contactElement, actionsElement) {
    try {
        const snapshot = await getDoc(doc(db, 'orderContacts', orderId));
        if (!snapshot.exists() || !contactElement.isConnected) return;
        const contact = snapshot.data();
        const phone = contact.passengerPhone || contact.customerPhone || '';
        const name = contact.customerName || 'Клиент';
        contactElement.textContent = phone ? `${name}: ${phone}` : name;
        if (phone) {
            const call = document.createElement('a');
            call.href = `tel:${String(phone).replace(/[^\d+]/g, '')}`;
            call.className = 'rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-xs font-extrabold';
            call.textContent = 'Позвонить клиенту';
            actionsElement.append(call);
        }
    } catch (error) {
        if (contactElement.isConnected) contactElement.textContent = 'Телефон не загрузился. Обновите страницу.';
        console.warn('Не удалось загрузить контакт клиента:', error.code || error.message);
    }
}

function renderOnlineOrders() {
    if (!elements.ordersList) return;
    const ready = assignedOrdersLoaded && (!currentCanTakeOrders || openOrdersLoaded);
    if (!ready) {
        setHidden(elements.ordersLoading, false);
        setHidden(elements.ordersList, true);
        setHidden(elements.ordersEmpty, true);
        updateOrdersPageTitle();
        return;
    }
    const assignedActive = assignedOrders
        .filter((order) => ACTIVE_ORDER_STATUSES.has(order.status))
        .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
    const available = currentCanTakeOrders
        ? [...openOrders].sort((a, b) => createdAtMillis(a) - createdAtMillis(b))
        : [];
    const allVisible = [
        ...assignedActive.map((order) => [order, true]),
        ...available.map((order) => [order, false])
    ];

    elements.ordersList.replaceChildren();
    for (const [order, assigned] of allVisible) {
        elements.ordersList.append(createOrderCard(order, assigned));
    }

    updateOrdersPageTitle();
    scrollRequestedOrderIntoView();

    setHidden(elements.ordersLoading, true);
    setHidden(elements.ordersList, allVisible.length === 0);
    setHidden(elements.ordersEmpty, allVisible.length !== 0);
    if (!allVisible.length && elements.ordersEmpty) {
        const title = elements.ordersEmpty.querySelector('p');
        const detail = elements.ordersEmpty.querySelector('p + p');
        if (currentCanTakeOrders) {
            title.textContent = 'Свободных заказов пока нет';
            detail.textContent = 'Список обновляется автоматически.';
        } else if (currentDriverState.status === 'busy') {
            title.textContent = 'Вы заняты текущим заказом';
            detail.textContent = 'После завершения поездки новые заказы появятся автоматически.';
        } else if (currentBaseEligible) {
            title.textContent = 'Вы сейчас не на линии';
            detail.textContent = 'Нажмите «Выйти на линию», чтобы получать новые заказы.';
        } else {
            title.textContent = 'Новые заказы сейчас недоступны';
            detail.textContent = 'Проверьте статус и баланс выше. Уже принятый заказ останется виден.';
        }
    }
}

function handleOrdersError(error) {
    console.warn('Онлайн-заказы не загрузились:', error.code || error.message);
    setHidden(elements.ordersLoading, true);
    showOrdersMessage(
        error.code === 'permission-denied'
            ? 'Онлайн-заказы ещё не включены в правилах Firebase. Пока используйте рабочий чат WhatsApp.'
            : 'Не удалось обновить онлайн-заказы. Проверьте интернет.'
    );
}

function startOpenOrdersWatch() {
    if (unsubscribeOpenOrders || !currentCanTakeOrders) return;
    openOrders = [];
    openOrdersLoaded = false;
    initialOpenOrdersLoaded = false;
    seenOpenOrderIds = new Set();
    unsubscribeOpenOrders = onSnapshot(
        query(collection(db, 'orders'), where('status', '==', 'searching')),
        (snapshot) => {
            showOrdersMessage('');
            const nextOpenOrders = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            const newlyAddedOrders = initialOpenOrdersLoaded
                ? snapshot.docChanges()
                    .filter((change) => change.type === 'added' && !seenOpenOrderIds.has(change.doc.id))
                    .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
                : [];

            for (const order of nextOpenOrders) seenOpenOrderIds.add(order.id);
            initialOpenOrdersLoaded = true;
            openOrders = nextOpenOrders;
            openOrdersLoaded = true;
            renderOnlineOrders();
            for (const order of newlyAddedOrders) signalNewOrder(order);
        },
        (error) => {
            unsubscribeOpenOrders = null;
            handleOrdersError(error);
        }
    );
}

function stopOpenOrdersWatch() {
    if (unsubscribeOpenOrders) unsubscribeOpenOrders();
    unsubscribeOpenOrders = null;
    openOrders = [];
    openOrdersLoaded = false;
    initialOpenOrdersLoaded = false;
    seenOpenOrderIds = new Set();
    hideNewOrderAlert();
}

function syncOrderWatches(user, driverId, driver, canTakeOrders) {
    const identityChanged = watchedOrdersUserUid !== user.uid;
    if (identityChanged) {
        stopOrderWatches();
        watchedOrdersUserUid = user.uid;
    }

    currentUser = user;
    currentDriverId = String(driverId);
    currentDriver = driver;
    currentCanTakeOrders = canTakeOrders;
    setHidden(elements.ordersSection, false);

    if (!unsubscribeAssignedOrders) {
        assignedOrdersLoaded = false;
        unsubscribeAssignedOrders = onSnapshot(
            query(collection(db, 'orders'), where('assignedDriverUid', '==', user.uid)),
            (snapshot) => {
                assignedOrders = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
                assignedOrdersLoaded = true;
                renderOnlineOrders();
                if (currentDriver && currentAccount) renderWorkStatus(currentDriver, currentAccount);
                void repairMissingBusyState();
            },
            (error) => {
                unsubscribeAssignedOrders = null;
                handleOrdersError(error);
            }
        );
    }

    if (canTakeOrders) startOpenOrdersWatch();
    else stopOpenOrdersWatch();
    renderOnlineOrders();
}

async function acceptOrder(orderId) {
    if (!currentUser || !currentDriver || !currentCanTakeOrders || orderActionInProgress) return;
    orderActionInProgress = true;
    showOrdersMessage('');
    renderOnlineOrders();
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const orderSnapshot = await transaction.get(orderRef);
            const stateSnapshot = await transaction.get(stateRef);
            if (!orderSnapshot.exists() || orderSnapshot.data().status !== 'searching') {
                throw new Error('Этот заказ уже принял другой водитель.');
            }
            const state = normalizedDriverState(stateSnapshot, currentDriverId);
            if (!stateSnapshot.exists() || state.status !== 'available' || state.activeOrderId) {
                throw new Error('Вы уже заняты или не вышли на линию.');
            }
            transaction.update(orderRef, {
                status: 'accepted',
                assignedDriverUid: currentUser.uid,
                assignedDriverId: currentDriverId,
                driverName: currentDriver.name || 'Водитель',
                driverPhone: currentDriver.phone || '',
                driverCar: currentDriver.car || '',
                driverColor: currentDriver.color || '',
                acceptedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            transaction.update(stateRef, {
                status: 'busy',
                activeOrderId: orderId,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
        showOrdersMessage('Заказ принят. Теперь вам доступен телефон клиента.', true);
    } catch (error) {
        console.warn('Заказ не принят:', error.code || error.message);
        showOrdersMessage(
            error.code === 'permission-denied'
                ? 'Заказ недоступен. Проверьте, что вы на линии, свободны и правила Firebase опубликованы.'
                : error.message || 'Не удалось принять заказ.'
        );
    } finally {
        orderActionInProgress = false;
        renderOnlineOrders();
    }
}

async function advanceOrder(orderId, expectedStatus, nextStatus) {
    if (!currentUser || orderActionInProgress) return;
    orderActionInProgress = true;
    showOrdersMessage('');
    renderOnlineOrders();
    try {
        let completedCommissionAmount = null;
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists()) throw new Error('Заказ не найден.');
            const order = orderSnapshot.data();
            if (order.assignedDriverUid !== currentUser.uid || order.status !== expectedStatus) {
                throw new Error('Статус заказа уже изменился.');
            }
            let stateSnapshot = null;
            let driverSnapshot = null;
            let historySnapshot = null;
            let commissionAmount = null;
            let commissionBaseAmount = null;
            let previousBalance = null;
            let newBalance = null;
            if (nextStatus === 'completed') {
                stateSnapshot = await transaction.get(stateRef);
                const state = normalizedDriverState(stateSnapshot, currentDriverId);
                if (!stateSnapshot.exists() || state.status !== 'busy' || state.activeOrderId !== orderId) {
                    throw new Error('Текущий заказ не совпадает со статусом водителя.');
                }
                const driverRef = doc(db, 'drivers', currentDriverId);
                // Используем ID заказа: так правила Firebase могут надёжно проверить одну запись комиссии.
                const historyRef = doc(db, 'balanceHistory', orderId);
                driverSnapshot = await transaction.get(driverRef);
                historySnapshot = await transaction.get(historyRef);
                if (!driverSnapshot.exists()) throw new Error('Карточка водителя не найдена.');
                if (historySnapshot.exists()) throw new Error('Комиссия по этому заказу уже учтена.');

                commissionBaseAmount = Number(order.priceAmount);
                previousBalance = Number(driverSnapshot.data().balance);
                if (!Number.isFinite(commissionBaseAmount) || commissionBaseAmount < 0) {
                    throw new Error('В заказе нет корректной цены для комиссии.');
                }
                if (!Number.isFinite(previousBalance)) {
                    throw new Error('В карточке водителя указан некорректный баланс.');
                }
                commissionAmount = commissionBaseAmount / 5;
                newBalance = previousBalance + commissionAmount;
                completedCommissionAmount = commissionAmount;

                transaction.update(doc(db, 'drivers', currentDriverId), {
                    balance: newBalance,
                    lastCommissionOrderId: orderId,
                    updatedAt: serverTimestamp()
                });
                transaction.set(historyRef, {
                    driverId: currentDriverId,
                    driverNumber: driverSnapshot.data().driverNumber,
                    orderId,
                    orderNumber: order.orderNumber || '',
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
            const orderUpdate = {
                status: nextStatus,
                updatedAt: serverTimestamp()
            };
            if (nextStatus === 'completed') {
                Object.assign(orderUpdate, {
                    commissionRate: 20,
                    commissionBaseAmount,
                    commissionAmount,
                    commissionBalanceBefore: previousBalance,
                    commissionBalanceAfter: newBalance,
                    commissionChargedAt: serverTimestamp()
                });
            }
            transaction.update(orderRef, orderUpdate);
            if (nextStatus === 'completed') {
                transaction.update(stateRef, {
                    status: 'available',
                    activeOrderId: '',
                    lastSeen: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        });
        showOrdersMessage(
            nextStatus === 'completed'
                ? `Поездка завершена. Комиссия ${formatMoney(completedCommissionAmount)} учтена.`
                : 'Статус заказа обновлён.',
            true
        );
    } catch (error) {
        console.warn('Статус заказа не изменён:', error.code || error.message);
        showOrdersMessage(error.message || 'Не удалось изменить статус заказа.');
    } finally {
        orderActionInProgress = false;
        renderOnlineOrders();
    }
}

function showProfileLoadError(error) {
    console.warn('Не удалось загрузить карточку водителя:', error.code || error.message);
    stopOrderWatches();
    setHidden(elements.profile, true);
    setHidden(elements.pending, false);
    if (error.code === 'permission-denied') {
        showMessage('Вход выполнен, но доступ к базе ещё не настроен. Передайте UID диспетчеру.');
    } else {
        showMessage('Не удалось загрузить кабинет. Проверьте интернет и попробуйте ещё раз.');
    }
}

function watchDriverState(user, account, driver) {
    if (unsubscribeDriverState) unsubscribeDriverState();
    unsubscribeDriverState = null;
    stopHeartbeat();

    currentUser = user;
    currentAccount = account;
    currentDriver = driver;
    currentDriverId = String(account.driverId);
    currentBaseEligible = canAccessOrders(driver, account);
    currentDriverState = { ...OFFLINE_DRIVER_STATE, driverId: currentDriverId, exists: false };
    currentCanTakeOrders = false;
    renderWorkStatus(driver, account, currentDriverState);
    syncOrderWatches(user, currentDriverId, driver, false);

    unsubscribeDriverState = onSnapshot(
        doc(db, 'driverStates', user.uid),
        (stateSnapshot) => {
            currentDriverState = normalizedDriverState(stateSnapshot, currentDriverId);
            currentCanTakeOrders = currentBaseEligible && currentDriverState.status === 'available';
            renderWorkStatus(driver, account, currentDriverState);
            syncHeartbeat();
            syncOrderWatches(user, currentDriverId, driver, currentCanTakeOrders);
            void repairMissingBusyState();
        },
        (error) => {
            console.warn('Рабочий статус не загрузился:', error.code || error.message);
            currentDriverState = { ...OFFLINE_DRIVER_STATE, driverId: currentDriverId, exists: false };
            currentCanTakeOrders = false;
            renderWorkStatus(driver, account, currentDriverState);
            syncOrderWatches(user, currentDriverId, driver, false);
            showShiftMessage(
                error.code === 'permission-denied'
                    ? 'Рабочая смена ещё не включена в правилах Firebase.'
                    : 'Не удалось загрузить рабочий статус. Проверьте интернет.'
            );
        }
    );
}

function watchDriverProfile(user) {
    stopProfileWatches();
    currentUser = user;
    setHidden(elements.pending, true);
    setHidden(elements.profile, true);
    showMessage('');

    unsubscribeAccount = onSnapshot(doc(db, 'driverAccounts', user.uid), (accountSnapshot) => {
        if (unsubscribeDriver) unsubscribeDriver();
        if (unsubscribeDriverState) unsubscribeDriverState();
        unsubscribeDriver = null;
        unsubscribeDriverState = null;
        stopHeartbeat();
        stopOrderWatches();
        setHidden(elements.profile, true);
        showMessage('');

        if (!accountSnapshot.exists() || !accountSnapshot.data().driverId) {
            setHidden(elements.pending, false);
            return;
        }

        const account = accountSnapshot.data();
        setHidden(elements.pending, true);
        unsubscribeDriver = onSnapshot(doc(db, 'drivers', String(account.driverId)), (driverSnapshot) => {
            if (!driverSnapshot.exists()) {
                stopOrderWatches();
                setHidden(elements.profile, true);
                setHidden(elements.pending, false);
                showMessage('Карточка водителя не найдена. Сообщите об этом диспетчеру.');
                return;
            }

            const driver = driverSnapshot.data();
            elements.profileName.textContent = `ID ${driver.driverNumber ?? account.driverId} · ${driver.name || 'Водитель'}`;
            elements.profileCar.textContent = carDescription(driver);
            elements.profileBalance.textContent = formatMoney(driver.balance);
            setHidden(elements.pending, true);
            setHidden(elements.profile, false);
            showMessage('');
            currentAccount = account;
            currentDriver = driver;
            currentDriverId = String(account.driverId);
            currentBaseEligible = canAccessOrders(driver, account);
            watchBalanceHistory(currentDriverId);
            renderWorkStatus(driver, account);
            void loadOrdersLink(currentBaseEligible);
            watchDriverState(user, account, driver);
        }, showProfileLoadError);
    }, showProfileLoadError);
}

async function login() {
    if (authActionInProgress) return;
    showMessage('');
    setAuthButtonBusy(true);
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(error.code)) {
            await signInWithRedirect(auth, googleProvider);
            return;
        }
        if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            console.error('Ошибка входа:', error);
            showMessage('Войти не получилось. Проверьте интернет и повторите попытку.');
        }
    } finally {
        setAuthButtonBusy(false);
    }
}

async function copyUid() {
    const uid = elements.userUid?.textContent?.trim();
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

elements.loginButton?.addEventListener('click', login);
elements.logoutButton?.addEventListener('click', () => void logoutDriver());
elements.copyUid?.addEventListener('click', copyUid);
elements.shiftToggle?.addEventListener('click', () => void toggleDriverShift());
elements.balanceHistoryMore?.addEventListener('click', () => void loadMoreBalanceHistory());
elements.alertsToggle?.addEventListener('click', () => void toggleOrderAlerts());
elements.alertsTest?.addEventListener('click', () => void testOrderAlerts());
elements.newOrderAlertClose?.addEventListener('click', hideNewOrderAlert);
elements.newOrderAlertView?.addEventListener('click', () => {
    const orderId = currentAlertOrderId;
    hideNewOrderAlert();
    scrollToOrder(orderId);
});

window.addEventListener('focus', updateOrderAlertsControls);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        updateOrderAlertsControls();
        void touchDriverHeartbeat();
    }
});
if (orderAlertsEnabled) {
    document.addEventListener('pointerdown', () => void prepareOrderSound(), { once: true });
}
updateOrderAlertsControls();

getRedirectResult(auth).catch((error) => {
    console.error('Ошибка возврата из Google:', error);
    showMessage('Google не завершил вход. Попробуйте ещё раз.');
});

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    stopProfileWatches();
    setHidden(elements.loading, true);
    setHidden(elements.signedOut, Boolean(user));
    setHidden(elements.signedIn, !user);
    showMessage('');

    if (!user) return;

    elements.userName.textContent = user.displayName || 'Водитель';
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

    watchDriverProfile(user);
});
