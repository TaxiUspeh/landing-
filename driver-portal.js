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
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    startAfter,
    updateDoc,
    where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
    getMessaging,
    getToken,
    isSupported as isMessagingSupported
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

const ACTIVE_ORDER_STATUSES = new Set(['accepted', 'en_route', 'arrived', 'in_trip']);
const REQUEUEABLE_ORDER_STATUSES = new Set(['accepted', 'en_route', 'arrived']);
const REQUEUE_REASONS = [
    ['car_issue', 'Неисправность автомобиля'],
    ['cannot_continue', 'Не могу продолжить заказ'],
    ['other', 'Другая причина']
];
const CLIENT_CANCELLATION_REASON_LABELS = {
    plans_changed: 'Изменились планы',
    no_longer_needed: 'Такси больше не нужно',
    called_other_taxi: 'Заказал другое такси',
    other: 'Другая причина'
};
const NEXT_ORDER_STATUS = {
    accepted: ['arrived', 'Я подъехал'],
    // Старый промежуточный статус оставлен только для заказов, созданных до упрощения.
    en_route: ['arrived', 'Я подъехал'],
    arrived: ['completed', 'Завершить заказ'],
    in_trip: ['completed', 'Завершить поездку']
};
const ORDER_ALERTS_PREFERENCE_KEY = 'taxi-uspeh-driver-order-alerts';
const DEFAULT_PAGE_TITLE = document.title;
const DRIVER_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const BALANCE_HISTORY_RESPONSE_TIMEOUT_MS = 6000;
const BALANCE_HISTORY_PAGE_SIZE = 20;
const BALANCE_HISTORY_EXPANDED_PREFERENCE_KEY = 'taxi-uspeh-driver-balance-history-expanded';
const DRIVER_PUSH_DEVICE_ID_KEY = 'taxi-uspeh-driver-push-device-id-v1';
const OFFLINE_DRIVER_STATE = Object.freeze({ status: 'offline', activeOrderId: '' });
const AVAILABLE_DRIVER_STATE = Object.freeze({ status: 'available', activeOrderId: '' });

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
    workStatusCard: document.getElementById('driver-work-status-card'),
    workStatusIcon: document.getElementById('driver-work-status-icon'),
    workStatus: document.getElementById('driver-work-status'),
    workStatusDetail: document.getElementById('driver-work-status-detail'),
    balanceHistoryToggle: document.getElementById('driver-balance-history-toggle'),
    balanceHistoryContent: document.getElementById('driver-balance-history-content'),
    balanceHistorySummary: document.getElementById('driver-balance-history-summary'),
    balanceHistoryIcon: document.getElementById('driver-balance-history-icon'),
    balanceHistoryLoading: document.getElementById('driver-balance-history-loading'),
    balanceHistoryEmpty: document.getElementById('driver-balance-history-empty'),
    balanceHistoryList: document.getElementById('driver-balance-history-list'),
    balanceHistoryMore: document.getElementById('driver-balance-history-more'),
    dispatcherChatToggle: document.getElementById('driver-dispatcher-chat-toggle'),
    dispatcherChatContent: document.getElementById('driver-dispatcher-chat-content'),
    dispatcherChatSummary: document.getElementById('driver-dispatcher-chat-summary'),
    dispatcherChatIcon: document.getElementById('driver-dispatcher-chat-icon'),
    dispatcherChatLoading: document.getElementById('driver-dispatcher-chat-loading'),
    dispatcherChatEmpty: document.getElementById('driver-dispatcher-chat-empty'),
    dispatcherChatList: document.getElementById('driver-dispatcher-chat-list'),
    dispatcherChatForm: document.getElementById('driver-dispatcher-chat-form'),
    dispatcherChatInput: document.getElementById('driver-dispatcher-chat-input'),
    dispatcherChatSend: document.getElementById('driver-dispatcher-chat-send'),
    dispatcherChatMessage: document.getElementById('driver-dispatcher-chat-message'),
    mobileShare: document.getElementById('driver-mobile-share'),
    mobileShareIcon: document.getElementById('driver-mobile-share-icon'),
    mobileShareLabel: document.getElementById('driver-mobile-share-label'),
    mobilePrimaryAction: document.getElementById('driver-mobile-primary-action'),
    mobilePrimaryIcon: document.getElementById('driver-mobile-primary-icon'),
    mobilePrimaryLabel: document.getElementById('driver-mobile-primary-label'),
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
    alertsNote: document.getElementById('driver-order-alerts-note'),
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
let unsubscribeDispatcherChat = null;
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
let balanceHistoryInitialLoaded = false;
let balanceHistoryExpanded = readBalanceHistoryExpandedPreference();
let dispatcherChatExpanded = false;
let driverChatMessages = [];
let driverChatLoaded = false;
let driverChatSendInProgress = false;
let driverChatInitialLoaded = false;
let dispatcherChatHasNewReply = false;
let mobileShareResetTimer = null;
let driverPushVapidKey = '';
let driverPushState = 'not_configured';
let driverPushSyncInProgress = false;

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

function readBalanceHistoryExpandedPreference() {
    try {
        return localStorage.getItem(BALANCE_HISTORY_EXPANDED_PREFERENCE_KEY) === 'expanded';
    } catch {
        return false;
    }
}

function saveBalanceHistoryExpandedPreference() {
    try {
        localStorage.setItem(BALANCE_HISTORY_EXPANDED_PREFERENCE_KEY, balanceHistoryExpanded ? 'expanded' : 'collapsed');
    } catch (error) {
        console.warn('Не удалось сохранить вид истории баланса:', error.message);
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

function canConfigureDriverPush() {
    return Boolean(currentUser && currentDriver && currentDriverId && currentBaseEligible);
}

function getDriverPushDeviceId() {
    try {
        const stored = localStorage.getItem(DRIVER_PUSH_DEVICE_ID_KEY);
        if (stored) return stored;
        const generated = globalThis.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(DRIVER_PUSH_DEVICE_ID_KEY, generated);
        return generated;
    } catch {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
}

function driverPushTokenRef() {
    if (!currentUser) return null;
    return doc(db, 'driverPushTokens', `${currentUser.uid}-${getDriverPushDeviceId()}`);
}

function setDriverPushState(state) {
    driverPushState = state;
    updateOrderAlertsControls();
}

async function enableDriverPushSubscription({ requestPermission = false } = {}) {
    if (!canConfigureDriverPush()) return false;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
        setDriverPushState('unsupported');
        return false;
    }
    if (!driverPushVapidKey) {
        setDriverPushState('not_configured');
        return false;
    }
    if (driverPushSyncInProgress) return false;
    driverPushSyncInProgress = true;
    try {
        const supported = await isMessagingSupported();
        if (!supported) {
            setDriverPushState('unsupported');
            return false;
        }

        let permission = notificationPermission();
        if (permission === 'default' && requestPermission) permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            setDriverPushState(permission === 'denied' ? 'denied' : 'permission_needed');
            return false;
        }

        const registration = await navigator.serviceWorker.ready;
        const token = await getToken(getMessaging(), {
            vapidKey: driverPushVapidKey,
            serviceWorkerRegistration: registration
        });
        if (!token) {
            setDriverPushState('token_missing');
            return false;
        }

        const tokenRef = driverPushTokenRef();
        if (!tokenRef) return false;
        await setDoc(tokenRef, {
            uid: currentUser.uid,
            driverId: currentDriverId,
            token,
            enabled: true,
            updatedAt: serverTimestamp()
        }, { merge: true });
        setDriverPushState('enabled');
        return true;
    } catch (error) {
        console.warn('Не удалось подключить Firebase-пуш:', error.code || error.message);
        setDriverPushState('error');
        return false;
    } finally {
        driverPushSyncInProgress = false;
        updateOrderAlertsControls();
    }
}

async function disableDriverPushSubscription() {
    const tokenRef = driverPushTokenRef();
    if (!tokenRef) return;
    try {
        await setDoc(tokenRef, {
            enabled: false,
            updatedAt: serverTimestamp()
        }, { merge: true });
        setDriverPushState('disabled');
    } catch (error) {
        console.warn('Не удалось отключить Firebase-пуш:', error.code || error.message);
        setDriverPushState('error');
    }
}

async function loadDriverPushSettings() {
    if (!canConfigureDriverPush()) return;
    try {
        const settingsSnapshot = await getDoc(doc(db, 'settings', 'driverPortal'));
        const vapidKey = settingsSnapshot.exists() ? settingsSnapshot.data().webPushVapidKey : '';
        driverPushVapidKey = typeof vapidKey === 'string' ? vapidKey.trim() : '';
        if (!driverPushVapidKey) {
            setDriverPushState('not_configured');
            return;
        }
        if (orderAlertsEnabled && notificationPermission() === 'granted') {
            await enableDriverPushSubscription();
        } else if (notificationPermission() === 'denied') {
            setDriverPushState('denied');
        } else {
            setDriverPushState('permission_needed');
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки Firebase-пуша:', error.code || error.message);
        setDriverPushState('error');
    }
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
        elements.alertsStatus.textContent = 'Нажмите кнопку, чтобы включить сигналы новых заказов и сообщений диспетчера.';
        if (elements.alertsNote) elements.alertsNote.textContent = 'После подключения Firebase пуши новых заказов придут и при закрытом браузере.';
        setHidden(elements.alertsTest, true);
        return;
    }

    elements.alertsToggle.className = 'rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 px-4 py-3 text-sm font-extrabold';
    toggleIcon.className = 'fas fa-bell-slash mr-2';
    toggleLabel.textContent = 'Отключить сигналы';
    statusIcon.className = 'fas fa-bell';
    setHidden(elements.alertsTest, false);

    if (permission === 'granted') {
        if (driverPushState === 'enabled') {
            elements.alertsStatus.textContent = 'Включены звук, вибрация и Firebase-пуши. Новые заказы придут даже при закрытом браузере.';
            if (elements.alertsNote) elements.alertsNote.textContent = 'Пуш подключён для этого телефона. При смене телефона включите его заново.';
        } else if (driverPushState === 'not_configured') {
            elements.alertsStatus.textContent = 'Звук и уведомления в открытом кабинете включены. Firebase-пуш пока настраивается диспетчером.';
            if (elements.alertsNote) elements.alertsNote.textContent = 'После настройки Firebase нажмите «Включить уведомления» ещё раз.';
        } else if (driverPushState === 'unsupported') {
            elements.alertsStatus.textContent = 'Звук и уведомления в открытом кабинете включены. Этот браузер не поддерживает Firebase-пуши.';
            if (elements.alertsNote) elements.alertsNote.textContent = 'Попробуйте открыть кабинет в актуальном Chrome или установить приложение на телефон.';
        } else if (driverPushState === 'error' || driverPushState === 'token_missing') {
            elements.alertsStatus.textContent = 'Звук включён, но Firebase-пуш пока не подключился. Нажмите кнопку ещё раз.';
            if (elements.alertsNote) elements.alertsNote.textContent = 'Проверьте интернет и разрешение уведомлений в настройках браузера.';
        } else {
            elements.alertsStatus.textContent = 'Звук и вибрация заказов и чата включены. Нажмите кнопку ещё раз, чтобы подключить Firebase-пуши.';
            if (elements.alertsNote) elements.alertsNote.textContent = 'На каждом телефоне пуш‑уведомления включаются отдельно.';
        }
    } else if (permission === 'denied') {
        elements.alertsStatus.textContent = 'Звук и вибрация заказов и чата включены. Системные уведомления заблокированы в настройках браузера.';
        if (elements.alertsNote) elements.alertsNote.textContent = 'Разрешите уведомления для сайта Такси «Успех» в настройках браузера, затем включите их снова.';
    } else if (permission === 'unsupported') {
        elements.alertsStatus.textContent = 'Звук и вибрация заказов и чата включены. Этот браузер не поддерживает системные уведомления.';
        if (elements.alertsNote) elements.alertsNote.textContent = 'Используйте актуальный Chrome на Android или установленное приложение.';
    } else {
        elements.alertsStatus.textContent = 'Звук и вибрация заказов и чата включены. Разрешите системные уведомления при следующем включении.';
        if (elements.alertsNote) elements.alertsNote.textContent = 'После разрешения система зарегистрирует этот телефон для Firebase-пушей.';
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

async function playChatSound() {
    try {
        const context = await prepareOrderSound();
        if (!context || context.state !== 'running') return;
        const startAt = context.currentTime;
        for (const [offset, frequency] of [[0, 659], [0.16, 784]]) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.11, startAt + offset + 0.02);
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

function vibrateForOrder() {
    if ('vibrate' in navigator) navigator.vibrate([180, 90, 180]);
}

function vibrateForChat() {
    if ('vibrate' in navigator) navigator.vibrate([90, 70, 90]);
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

function orderRoutePoints(order) {
    const start = order.fromAddress || 'Адрес подачи не указан';
    const stops = Array.isArray(order.stops)
        ? order.stops.map((stop) => String(stop || '').trim()).filter(Boolean)
        : [];
    const destination = order.toAddress || 'Адрес назначения не указан';
    return [start, ...stops, destination];
}

function orderRoute(order) {
    return orderRoutePoints(order).join(' → ');
}

function orderNavigationUrl(order) {
    const routeText = orderRoutePoints(order).join('~');
    return `https://yandex.kz/maps/?mode=routes&rtext=${encodeURIComponent(routeText)}&rtt=auto`;
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
        route: 'Звук, вибрация и сообщения о заказах и чате работают',
        price: 'Это не настоящий заказ'
    });
    void playOrderSound();
    vibrateForOrder();
    await showSystemNotification({
        title: 'Проверка — Такси «Успех»',
        body: 'Уведомления о новых заказах и сообщениях включены.',
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
        await disableDriverPushSubscription();
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
    await enableDriverPushSubscription({ requestPermission: true });
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

function driverChatMillis(message) {
    return message.createdAt?.toMillis ? message.createdAt.toMillis() : 0;
}

function driverChatTime(message) {
    if (!message.createdAt?.toDate) return 'Отправляем…';
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(message.createdAt.toDate());
}

function showDispatcherChatMessage(text, success = false) {
    const message = elements.dispatcherChatMessage;
    if (!message) return;
    message.textContent = text;
    message.className = text
        ? `text-xs ${success ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`
        : 'hidden text-xs';
}

function updateDriverChatControls() {
    setHidden(elements.dispatcherChatContent, !dispatcherChatExpanded);
    if (elements.dispatcherChatToggle) {
        elements.dispatcherChatToggle.setAttribute('aria-expanded', String(dispatcherChatExpanded));
    }
    if (elements.dispatcherChatIcon) {
        elements.dispatcherChatIcon.className = dispatcherChatExpanded
            ? 'fas fa-chevron-up flex-shrink-0 text-sky-700 dark:text-sky-300 transition-transform'
            : 'fas fa-chevron-down flex-shrink-0 text-sky-700 dark:text-sky-300 transition-transform';
    }
    if (elements.dispatcherChatSummary) {
        const latest = [...driverChatMessages].sort((a, b) => driverChatMillis(b) - driverChatMillis(a))[0];
        if (dispatcherChatExpanded) elements.dispatcherChatSummary.textContent = 'Свернуть переписку';
        else if (dispatcherChatHasNewReply) elements.dispatcherChatSummary.textContent = 'Новое сообщение от диспетчера';
        else if (latest) elements.dispatcherChatSummary.textContent = `Последнее: ${latest.sender === 'dispatcher' ? 'диспетчер' : 'вы'} · ${driverChatTime(latest)}`;
        else if (driverChatLoaded) elements.dispatcherChatSummary.textContent = 'Переписка пока пуста';
        else elements.dispatcherChatSummary.textContent = 'Нажмите, чтобы написать диспетчеру';
    }
}

function updateMobilePrimaryAction() {
    const action = elements.mobilePrimaryAction;
    if (!action || !elements.mobilePrimaryIcon || !elements.mobilePrimaryLabel) return;

    const hasDriverCabinet = Boolean(currentUser && currentDriver && currentDriverId);
    action.dataset.driverMobileAction = hasDriverCabinet ? 'chat' : 'documents';
    action.className = hasDriverCabinet
        ? 'bg-sky-600 hover:bg-sky-700 text-white flex-grow min-w-0 py-3 rounded-xl text-sm font-bold shadow-md flex items-center justify-center gap-1'
        : 'bg-green-600 hover:bg-green-700 text-white flex-grow min-w-0 py-3 rounded-xl text-sm font-bold shadow-md flex items-center justify-center gap-1';
    elements.mobilePrimaryIcon.className = hasDriverCabinet
        ? 'fas fa-comments text-lg'
        : 'fab fa-whatsapp text-lg';
    elements.mobilePrimaryLabel.textContent = hasDriverCabinet ? 'Написать диспетчеру' : 'Стать водителем';
    action.setAttribute('aria-label', hasDriverCabinet ? 'Написать диспетчеру' : 'Стать водителем');
}

function setMobileShareFeedback(label, iconClass = 'fas fa-check text-lg') {
    if (!elements.mobileShareLabel || !elements.mobileShareIcon) return;
    elements.mobileShareLabel.textContent = label;
    elements.mobileShareIcon.className = iconClass;
    if (mobileShareResetTimer) window.clearTimeout(mobileShareResetTimer);
    mobileShareResetTimer = window.setTimeout(() => {
        elements.mobileShareLabel.textContent = 'Поделиться';
        elements.mobileShareIcon.className = 'fas fa-share-nodes text-lg';
    }, 2200);
}

async function copyTaxiUspehWorkLink(url) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return true;
    }
    const temporaryInput = document.createElement('textarea');
    temporaryInput.value = url;
    temporaryInput.setAttribute('readonly', '');
    temporaryInput.style.position = 'fixed';
    temporaryInput.style.opacity = '0';
    document.body.append(temporaryInput);
    temporaryInput.select();
    const copied = document.execCommand('copy');
    temporaryInput.remove();
    return copied;
}

async function shareTaxiUspehWorkLink() {
    const url = 'https://taxiuspeh.github.io/landing-/drivers.html';
    const shareData = {
        title: 'Работа в такси «Успех»',
        text: 'Присоединяйтесь к водителям Такси «Успех»',
        url
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
            return;
        }
        await copyTaxiUspehWorkLink(url);
        setMobileShareFeedback('Готово');
    } catch (error) {
        if (error?.name === 'AbortError') return;
        try {
            const copied = await copyTaxiUspehWorkLink(url);
            setMobileShareFeedback(copied ? 'Готово' : 'Ошибка', copied ? 'fas fa-check text-lg' : 'fas fa-triangle-exclamation text-lg');
        } catch {
            setMobileShareFeedback('Ошибка', 'fas fa-triangle-exclamation text-lg');
        }
    }
}

function openDispatcherChatFromMobile() {
    if (!currentUser || !currentDriver || !currentDriverId) return;
    dispatcherChatExpanded = true;
    dispatcherChatHasNewReply = false;
    updateDriverChatControls();
    const chatSection = document.getElementById('driver-dispatcher-chat');
    chatSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => elements.dispatcherChatInput?.focus(), 350);
}

function renderDriverChat() {
    const messages = [...driverChatMessages].sort((a, b) => driverChatMillis(a) - driverChatMillis(b));
    elements.dispatcherChatList.replaceChildren();
    for (const message of messages) {
        const own = message.sender === 'driver';
        const item = document.createElement('article');
        item.className = `max-w-[88%] rounded-2xl px-3 py-2 text-xs ${own
            ? 'ml-auto bg-sky-600 text-white'
            : 'mr-auto bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100'}`;
        item.append(
            createText('p', own ? 'font-extrabold text-sky-100' : 'font-extrabold text-sky-700 dark:text-sky-300', own ? 'Вы' : 'Диспетчер'),
            createText('p', 'mt-1 whitespace-pre-wrap break-words', message.text || ''),
            createText('p', own ? 'mt-1 text-[10px] text-sky-100' : 'mt-1 text-[10px] text-slate-500 dark:text-slate-400', driverChatTime(message))
        );
        elements.dispatcherChatList.append(item);
    }
    setHidden(elements.dispatcherChatLoading, true);
    setHidden(elements.dispatcherChatEmpty, messages.length !== 0);
    setHidden(elements.dispatcherChatList, messages.length === 0);
    updateDriverChatControls();
}

function stopDriverChatWatch(clearData = false) {
    if (unsubscribeDispatcherChat) unsubscribeDispatcherChat();
    unsubscribeDispatcherChat = null;
    if (clearData) {
        driverChatMessages = [];
        driverChatLoaded = false;
        driverChatInitialLoaded = false;
        dispatcherChatHasNewReply = false;
    }
    driverChatSendInProgress = false;
    setHidden(elements.dispatcherChatLoading, false);
    setHidden(elements.dispatcherChatEmpty, true);
    setHidden(elements.dispatcherChatList, true);
    showDispatcherChatMessage('');
    updateDriverChatControls();
}

function watchDriverChat(user, driverId) {
    const normalizedDriverId = String(driverId || '');
    if (!user || !normalizedDriverId || unsubscribeDispatcherChat) return;
    driverChatLoaded = false;
    driverChatInitialLoaded = false;
    setHidden(elements.dispatcherChatLoading, false);
    unsubscribeDispatcherChat = onSnapshot(
        query(
            collection(db, 'driverMessages'),
            where('driverUid', '==', user.uid),
            where('driverId', '==', normalizedDriverId),
            orderBy('createdAt', 'desc'),
            limit(100)
        ),
        (snapshot) => {
            const incomingReplies = driverChatInitialLoaded
                ? snapshot.docChanges()
                    .filter((change) => change.type === 'added' && change.doc.data().sender === 'dispatcher')
                    .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
                : [];
            driverChatMessages = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            driverChatLoaded = true;
            renderDriverChat();
            driverChatInitialLoaded = true;
            if (incomingReplies.length) signalDispatcherChatReply();
        },
        (error) => {
            console.warn('Чат с диспетчером не загрузился:', error.code || error.message);
            driverChatMessages = [];
            driverChatLoaded = true;
            setHidden(elements.dispatcherChatLoading, true);
            setHidden(elements.dispatcherChatList, true);
            setHidden(elements.dispatcherChatEmpty, false);
            const emptyText = elements.dispatcherChatEmpty?.querySelector('p');
            if (emptyText) emptyText.textContent = error.code === 'permission-denied'
                ? 'Чат будет доступен после публикации новых правил Firebase'
                : 'Не удалось загрузить переписку. Проверьте интернет.';
            updateDriverChatControls();
        }
    );
}

function toggleDispatcherChat() {
    dispatcherChatExpanded = !dispatcherChatExpanded;
    if (dispatcherChatExpanded) dispatcherChatHasNewReply = false;
    updateDriverChatControls();
}

function signalDispatcherChatReply() {
    dispatcherChatHasNewReply = true;
    updateDriverChatControls();
    if (!orderAlertsEnabled) return;
    void playChatSound();
    vibrateForChat();
}

async function sendDriverChatMessage(event) {
    event.preventDefault();
    const text = elements.dispatcherChatInput?.value.trim() || '';
    if (!text) return showDispatcherChatMessage('Напишите сообщение для диспетчера.');
    if (!currentUser || !currentDriver || !currentDriverId || driverChatSendInProgress) {
        return showDispatcherChatMessage('Кабинет водителя ещё не подключён.');
    }

    driverChatSendInProgress = true;
    elements.dispatcherChatSend.disabled = true;
    showDispatcherChatMessage('');
    try {
        await addDoc(collection(db, 'driverMessages'), {
            driverUid: currentUser.uid,
            driverId: currentDriverId,
            driverName: currentDriver.name || 'Водитель',
            driverCar: currentDriver.car || '',
            sender: 'driver',
            text,
            createdAt: serverTimestamp(),
            readByDispatcher: false,
            dispatcherReadAt: null
        });
        elements.dispatcherChatInput.value = '';
        showDispatcherChatMessage('Сообщение отправлено диспетчеру.', true);
    } catch (error) {
        console.warn('Не удалось отправить сообщение диспетчеру:', error.code || error.message);
        showDispatcherChatMessage(
            error.code === 'permission-denied'
                ? 'Чат ещё не включён в правилах Firebase. Обновите правила и опубликуйте их.'
                : 'Не удалось отправить сообщение. Проверьте интернет.'
        );
    } finally {
        driverChatSendInProgress = false;
        elements.dispatcherChatSend.disabled = false;
    }
}

function updateBalanceHistoryControls() {
    const latest = [...balanceHistory]
        .sort((a, b) => balanceHistoryMillis(b) - balanceHistoryMillis(a))[0];
    setHidden(elements.balanceHistoryContent, !balanceHistoryExpanded);
    if (elements.balanceHistoryToggle) {
        elements.balanceHistoryToggle.setAttribute('aria-expanded', String(balanceHistoryExpanded));
    }
    if (elements.balanceHistoryIcon) {
        elements.balanceHistoryIcon.className = balanceHistoryExpanded
            ? 'fas fa-chevron-up flex-shrink-0 text-emerald-700 dark:text-emerald-300 transition-transform'
            : 'fas fa-chevron-down flex-shrink-0 text-emerald-700 dark:text-emerald-300 transition-transform';
    }
    if (elements.balanceHistorySummary) {
        if (balanceHistoryExpanded) {
            elements.balanceHistorySummary.textContent = 'Свернуть историю';
        } else if (latest) {
            elements.balanceHistorySummary.textContent = `Последнее: ${formatSignedMoney(latest.difference)} · ${balanceHistoryTime(latest)}`;
        } else if (balanceHistoryInitialLoaded) {
            elements.balanceHistorySummary.textContent = 'Изменений баланса пока нет';
        } else {
            elements.balanceHistorySummary.textContent = 'Нажмите, чтобы показать';
        }
    }
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
    balanceHistoryInitialLoaded = true;
    updateBalanceHistoryControls();
    if (!balanceHistoryExpanded) return;
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
    const visible = balanceHistoryExpanded && entries.length > 0 && balanceHistoryHasMore;
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
    updateBalanceHistoryControls();
    if (!balanceHistoryExpanded) return;
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
    if (!balanceHistoryExpanded || balanceHistoryLoadingMore || !balanceHistoryHasMore || !balanceHistoryCursor || !watchedHistoryDriverId) return;
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

function stopBalanceHistoryWatch(clearData = false) {
    if (unsubscribeBalanceHistory) unsubscribeBalanceHistory();
    unsubscribeBalanceHistory = null;
    clearBalanceHistoryLoadTimer();
    watchedHistoryDriverId = '';
    balanceHistoryLoadingMore = false;
    if (clearData) {
        balanceHistory = [];
        balanceHistoryCursor = null;
        balanceHistoryHasMore = false;
        balanceHistoryInitialLoaded = false;
    }
    updateBalanceHistoryControls();
}

function toggleBalanceHistory() {
    balanceHistoryExpanded = !balanceHistoryExpanded;
    saveBalanceHistoryExpandedPreference();
    updateBalanceHistoryControls();
    if (balanceHistoryExpanded) {
        watchBalanceHistory(currentDriverId);
    } else {
        stopBalanceHistoryWatch();
    }
}

function watchBalanceHistory(driverId) {
    const normalizedId = String(driverId || '');
    if (!balanceHistoryExpanded) {
        updateBalanceHistoryControls();
        return;
    }
    if (!normalizedId || watchedHistoryDriverId === normalizedId) return;
    stopBalanceHistoryWatch(true);
    watchedHistoryDriverId = normalizedId;
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
            balanceHistoryInitialLoaded = true;
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
        arrived: 'Подъехал к клиенту',
        in_trip: 'Поездка выполняется'
    })[status] || 'Свободный заказ';
}

function canAccessOrders(driver, account) {
    const status = driver.status || 'paused';
    return account.active !== false
        && status === 'active';
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
    let title = 'Подключаем заказы';
    let detail = 'Кабинет автоматически подключается к новым заказам.';
    let icon = 'fas fa-circle-notch fa-spin';
    let containerClass = 'rounded-2xl p-4 mb-4 border bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700';
    let iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center';

    if (status === 'busy') {
        title = 'Занят — выполняется заказ';
        detail = 'Новые заказы временно скрыты. После завершения поездки они появятся автоматически.';
        icon = 'fas fa-route';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 flex items-center justify-center';
    } else if (!eligible) {
        title = 'Доступ к заказам ограничен';
        detail = 'Работу с заказами приостановил диспетчер.';
        icon = 'fas fa-ban';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 flex items-center justify-center';
    } else if (!assignedOrdersLoaded) {
        title = 'Проверяем текущие заказы';
        detail = 'Подождите несколько секунд: проверяем ранее начатые поездки.';
        icon = 'fas fa-circle-notch fa-spin';
    } else if (status === 'offline'
        && state?.exists === false
        && assignedOrders.some((order) => ACTIVE_ORDER_STATUSES.has(order.status))) {
        title = 'Восстанавливаем текущий заказ';
        detail = 'Ранее начатая поездка останется у вас и не потеряется.';
        icon = 'fas fa-rotate';
    } else if (status === 'available') {
        title = 'Онлайн-заказы доступны';
        detail = 'Пока кабинет открыт, новые заказы и бесплатные сигналы приходят автоматически.';
        icon = 'fas fa-circle-check';
        containerClass = 'rounded-2xl p-4 mb-4 border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
        iconClass = 'flex-shrink-0 w-11 h-11 rounded-xl bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 flex items-center justify-center';
    }

    elements.workStatusCard.className = containerClass;
    elements.workStatusIcon.className = iconClass;
    elements.workStatusIcon.querySelector('i').className = icon;
    elements.workStatus.textContent = title;
    elements.workStatusDetail.textContent = detail;

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

async function ensureDriverAvailable() {
    if (driverStateActionInProgress
        || !currentUser
        || !currentDriver
        || !currentAccount
        || !currentBaseEligible
        || !assignedOrdersLoaded) return false;
    if (['available', 'busy'].includes(currentDriverState.status)) return true;
    if (assignedOrders.some((order) => ACTIVE_ORDER_STATUSES.has(order.status))) {
        await repairMissingBusyState();
        return false;
    }

    driverStateActionInProgress = true;
    renderWorkStatus(currentDriver, currentAccount);
    try {
        await runTransaction(db, async (transaction) => {
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const stateSnapshot = await transaction.get(stateRef);
            const existing = normalizedDriverState(stateSnapshot, currentDriverId);
            if (existing.status === 'busy') return;
            transaction.set(stateRef, {
                driverId: currentDriverId,
                ...AVAILABLE_DRIVER_STATE,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
        return true;
    } catch (error) {
        console.warn('Не удалось автоматически подключить заказы:', error.code || error.message);
        if (error.code === 'permission-denied') {
            showOrdersMessage('Онлайн-заказы ещё не включены в правилах Firebase. Обновите правила и опубликуйте их.');
        }
        return false;
    } finally {
        driverStateActionInProgress = false;
        if (currentDriver && currentAccount) renderWorkStatus(currentDriver, currentAccount);
    }
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
    if (currentUser && currentDriverState.status === 'available') {
        try {
            await updateDoc(doc(db, 'driverStates', currentUser.uid), {
                ...OFFLINE_DRIVER_STATE,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.warn('Не удалось отметить выход из кабинета:', error.code || error.message);
        }
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
    unsubscribeAccount = null;
    unsubscribeDriver = null;
    unsubscribeDriverState = null;
    stopBalanceHistoryWatch(true);
    stopDriverChatWatch(true);
    stopHeartbeat();
    currentDriverId = '';
    currentDriver = null;
    currentAccount = null;
    currentBaseEligible = false;
    currentDriverState = OFFLINE_DRIVER_STATE;
    currentCanTakeOrders = false;
    driverPushVapidKey = '';
    driverPushState = 'not_configured';
    legacyStateRepairInProgress = false;
    stopOrderWatches();
    updateMobilePrimaryAction();
}

function createText(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function orderServiceLabel(order) {
    const labels = {
        taxi: 'Такси',
        auction: 'Аукцион',
        delivery: 'Доставка',
        cargo: 'Грузовой',
        soberDriver: 'Трезвый водитель',
        assistance: 'Помощь'
    };
    return order.serviceLabel || labels[order.serviceType] || 'Такси';
}

function orderServiceDetailsText(order) {
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

    const service = createText('p', 'mt-2 text-[11px] font-extrabold uppercase tracking-wide text-blue-700 dark:text-blue-300', orderServiceLabel(order));
    const route = createText('p', 'mt-2 text-sm font-bold break-words', orderRoute(order));
    const price = createText('p', 'mt-2 text-sm font-black text-green-700 dark:text-green-300', order.priceText || 'Цена уточняется');
    card.append(header, service, route, price);

    const serviceDetails = orderServiceDetailsText(order);
    if (serviceDetails) {
        card.append(createText('p', 'mt-2 rounded-lg bg-slate-100 p-2 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200', serviceDetails));
    }

    const cancellationPending = assigned && order.cancellationRequestStatus === 'pending';
    if (cancellationPending) {
        card.append(createText(
            'p',
            'mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100',
            `Клиент просит отменить заказ: ${CLIENT_CANCELLATION_REASON_LABELS[order.cancellationReason] || 'причина не указана'}. Ожидайте решения диспетчера и не продолжайте маршрут.`
        ));
    }

    if (Array.isArray(order.stops) && order.stops.length) {
        card.append(createText('p', 'mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300', 'Маршрут включает промежуточные остановки.'));
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
    navigation.href = orderNavigationUrl(order);
    navigation.target = '_blank';
    navigation.rel = 'noopener noreferrer';
    navigation.className = 'rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold';
    navigation.textContent = Array.isArray(order.stops) && order.stops.length ? 'Маршрут с остановками' : 'Маршрут';
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

        const next = cancellationPending ? null : NEXT_ORDER_STATUS[order.status];
        if (next) {
            const statusButton = document.createElement('button');
            statusButton.type = 'button';
            statusButton.className = 'rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-extrabold';
            statusButton.textContent = next[1];
            statusButton.disabled = orderActionInProgress;
            statusButton.addEventListener('click', () => advanceOrder(order.id, order.status, next[0]));
            actions.append(statusButton);
        }

        if (!cancellationPending && REQUEUEABLE_ORDER_STATUSES.has(order.status)) {
            const requeueReason = document.createElement('select');
            requeueReason.className = 'w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100';
            for (const [value, label] of REQUEUE_REASONS) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                requeueReason.append(option);
            }
            const requeueButton = document.createElement('button');
            requeueButton.type = 'button';
            requeueButton.className = 'rounded-lg border border-amber-500 text-amber-800 hover:bg-amber-100 px-4 py-2 text-xs font-extrabold dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900/30';
            requeueButton.textContent = 'Вернуть в поиск';
            requeueButton.disabled = orderActionInProgress;
            requeueButton.addEventListener('click', () => returnOrderToSearch(order.id, order.status, requeueReason.value));
            actions.append(requeueReason, requeueButton);
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
            title.textContent = 'Подключаем новые заказы';
            detail.textContent = 'Кабинет автоматически подключается. Подождите несколько секунд.';
        } else {
            title.textContent = 'Новые заказы сейчас недоступны';
            detail.textContent = 'Работу с заказами приостановил диспетчер. Уже принятый заказ останется виден.';
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
                void ensureDriverAvailable();
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
                throw new Error('Вы уже заняты или кабинет ещё подключается к заказам.');
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
        const balance = Number(currentDriver.balance);
        showOrdersMessage(
            Number.isFinite(balance) && balance >= 0
                ? `Заказ принят. Напоминание: пополните баланс. Текущий баланс: ${formatMoney(balance)}.`
                : 'Заказ принят. Теперь вам доступен телефон клиента.',
            true
        );
    } catch (error) {
        console.warn('Заказ не принят:', error.code || error.message);
        showOrdersMessage(
            error.code === 'permission-denied'
                ? 'Заказ недоступен. Проверьте, что кабинет открыт, вы свободны и правила Firebase опубликованы.'
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

async function returnOrderToSearch(orderId, expectedStatus, reason) {
    if (!currentUser || orderActionInProgress || !REQUEUEABLE_ORDER_STATUSES.has(expectedStatus)) return;
    const reasonLabel = REQUEUE_REASONS.find(([value]) => value === reason)?.[1] || 'Другая причина';
    if (!window.confirm(`Вернуть заказ в поиск? Клиент увидит, что подбирается другой водитель. Причина для диспетчера: ${reasonLabel}.`)) return;

    orderActionInProgress = true;
    showOrdersMessage('');
    renderOnlineOrders();
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const stateRef = doc(db, 'driverStates', currentUser.uid);
            const orderSnapshot = await transaction.get(orderRef);
            const stateSnapshot = await transaction.get(stateRef);
            if (!orderSnapshot.exists()) throw new Error('Заказ не найден.');
            const order = orderSnapshot.data();
            const state = normalizedDriverState(stateSnapshot, currentDriverId);
            if (order.assignedDriverUid !== currentUser.uid || order.status !== expectedStatus) {
                throw new Error('Статус заказа уже изменился.');
            }
            if (!stateSnapshot.exists() || state.status !== 'busy' || state.activeOrderId !== orderId) {
                throw new Error('Текущий заказ не совпадает со статусом водителя.');
            }

            transaction.update(orderRef, {
                status: 'searching',
                assignedDriverUid: '',
                assignedDriverId: '',
                driverName: '',
                driverPhone: '',
                driverCar: '',
                driverColor: '',
                requeueReason: REQUEUE_REASONS.some(([value]) => value === reason) ? reason : 'other',
                requeuedAt: serverTimestamp(),
                requeueCount: Number(order.requeueCount || 0) + 1,
                updatedAt: serverTimestamp()
            });
            transaction.update(stateRef, {
                ...AVAILABLE_DRIVER_STATE,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
        showOrdersMessage('Заказ возвращён в поиск. Новые заказы снова доступны автоматически.', true);
    } catch (error) {
        console.warn('Не удалось вернуть заказ в поиск:', error.code || error.message);
        showOrdersMessage(
            error.code === 'permission-denied'
                ? 'Не удалось вернуть заказ. Проверьте, что опубликованы новые правила Firebase.'
                : error.message || 'Не удалось вернуть заказ в поиск.'
        );
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
    updateMobilePrimaryAction();
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
            void ensureDriverAvailable();
        },
        (error) => {
            console.warn('Рабочий статус не загрузился:', error.code || error.message);
            currentDriverState = { ...OFFLINE_DRIVER_STATE, driverId: currentDriverId, exists: false };
            currentCanTakeOrders = false;
            renderWorkStatus(driver, account, currentDriverState);
            syncOrderWatches(user, currentDriverId, driver, false);
            showOrdersMessage(
                error.code === 'permission-denied'
                    ? 'Онлайн-заказы ещё не включены в правилах Firebase. Обновите правила и опубликуйте их.'
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
        stopDriverChatWatch(true);
        setHidden(elements.profile, true);
        showMessage('');

        if (!accountSnapshot.exists() || !accountSnapshot.data().driverId) {
            currentDriver = null;
            currentDriverId = '';
            updateMobilePrimaryAction();
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
                currentDriver = null;
                currentDriverId = '';
                updateMobilePrimaryAction();
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
            updateMobilePrimaryAction();
            void loadDriverPushSettings();
            watchBalanceHistory(currentDriverId);
            watchDriverChat(user, currentDriverId);
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
elements.balanceHistoryToggle?.addEventListener('click', toggleBalanceHistory);
elements.balanceHistoryMore?.addEventListener('click', () => void loadMoreBalanceHistory());
elements.dispatcherChatToggle?.addEventListener('click', toggleDispatcherChat);
elements.dispatcherChatForm?.addEventListener('submit', (event) => void sendDriverChatMessage(event));
elements.mobileShare?.addEventListener('click', () => void shareTaxiUspehWorkLink());
elements.mobilePrimaryAction?.addEventListener('click', () => {
    if (elements.mobilePrimaryAction?.dataset.driverMobileAction === 'chat') openDispatcherChatFromMobile();
});
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
updateMobilePrimaryAction();

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
