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
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
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
    workStatus: document.getElementById('driver-work-status'),
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
let currentCanTakeOrders = false;
let openOrders = [];
let assignedOrders = [];
let unsubscribeAccount = null;
let unsubscribeDriver = null;
let unsubscribeOpenOrders = null;
let unsubscribeAssignedOrders = null;
let orderAlertsEnabled = readOrderAlertsPreference();
let orderAudioContext = null;
let initialOpenOrdersLoaded = false;
let seenOpenOrderIds = new Set();
let currentAlertOrderId = '';
let newOrderAlertTimer = null;
let requestedOrderHandled = false;

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

function renderWorkStatus(driver, account) {
    const balance = Number(driver.balance);
    const status = driver.status || 'paused';
    const canTakeOrders = account.active !== false
        && status === 'active'
        && Number.isFinite(balance)
        && balance < 0;

    elements.workStatus.className = canTakeOrders
        ? 'rounded-xl p-3 mb-4 text-sm font-bold bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
        : 'rounded-xl p-3 mb-4 text-sm font-bold bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300';
    elements.workStatus.textContent = canTakeOrders
        ? '✅ Можно принимать заказы'
        : status !== 'active' || account.active === false
            ? '🔴 Доступ к заказам приостановлен диспетчером'
            : '🔴 При балансе 0 ₸ или выше новые заказы недоступны';

    return canTakeOrders;
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
    openOrders = [];
    assignedOrders = [];
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
    unsubscribeAccount = null;
    unsubscribeDriver = null;
    currentDriverId = '';
    currentDriver = null;
    currentCanTakeOrders = false;
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
    const assignedActive = assignedOrders
        .filter((order) => ACTIVE_ORDER_STATUSES.has(order.status))
        .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
    const available = currentCanTakeOrders
        ? openOrders.sort((a, b) => createdAtMillis(a) - createdAtMillis(b))
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

function startOrderWatches(user, driverId, driver, canTakeOrders) {
    stopOrderWatches();
    currentUser = user;
    currentDriverId = String(driverId);
    currentDriver = driver;
    currentCanTakeOrders = canTakeOrders;
    setHidden(elements.ordersSection, false);
    setHidden(elements.ordersLoading, false);

    let openLoaded = !canTakeOrders;
    let assignedLoaded = false;
    const renderWhenReady = () => {
        if (openLoaded && assignedLoaded) renderOnlineOrders();
    };

    if (canTakeOrders) {
        unsubscribeOpenOrders = onSnapshot(
            query(collection(db, 'orders'), where('status', '==', 'searching')),
            (snapshot) => {
                const nextOpenOrders = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
                const newlyAddedOrders = initialOpenOrdersLoaded
                    ? snapshot.docChanges()
                        .filter((change) => change.type === 'added' && !seenOpenOrderIds.has(change.doc.id))
                        .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
                    : [];

                for (const order of nextOpenOrders) seenOpenOrderIds.add(order.id);
                initialOpenOrdersLoaded = true;
                openOrders = nextOpenOrders;
                openLoaded = true;
                renderWhenReady();
                for (const order of newlyAddedOrders) signalNewOrder(order);
            },
            handleOrdersError
        );
    }

    unsubscribeAssignedOrders = onSnapshot(
        query(collection(db, 'orders'), where('assignedDriverUid', '==', user.uid)),
        (snapshot) => {
            assignedOrders = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            assignedLoaded = true;
            renderWhenReady();
        },
        handleOrdersError
    );
}

async function acceptOrder(orderId) {
    if (!currentUser || !currentDriver || !currentCanTakeOrders || orderActionInProgress) return;
    orderActionInProgress = true;
    showOrdersMessage('');
    renderOnlineOrders();
    try {
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists() || snapshot.data().status !== 'searching') {
                throw new Error('Этот заказ уже принял другой водитель.');
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
        });
        showOrdersMessage('Заказ принят. Теперь вам доступен телефон клиента.', true);
    } catch (error) {
        console.warn('Заказ не принят:', error.code || error.message);
        showOrdersMessage(
            error.code === 'permission-denied'
                ? 'Доступ к заказу изменился. Проверьте баланс и статус.'
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
        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', orderId);
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists()) throw new Error('Заказ не найден.');
            const order = snapshot.data();
            if (order.assignedDriverUid !== currentUser.uid || order.status !== expectedStatus) {
                throw new Error('Статус заказа уже изменился.');
            }
            transaction.update(orderRef, {
                status: nextStatus,
                updatedAt: serverTimestamp()
            });
        });
        showOrdersMessage(nextStatus === 'completed' ? 'Поездка завершена.' : 'Статус заказа обновлён.', true);
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

function watchDriverProfile(user) {
    stopProfileWatches();
    currentUser = user;
    setHidden(elements.pending, true);
    setHidden(elements.profile, true);
    showMessage('');

    unsubscribeAccount = onSnapshot(doc(db, 'driverAccounts', user.uid), (accountSnapshot) => {
        if (unsubscribeDriver) unsubscribeDriver();
        unsubscribeDriver = null;
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
            const canTakeOrders = renderWorkStatus(driver, account);
            void loadOrdersLink(canTakeOrders);
            startOrderWatches(user, account.driverId, driver, canTakeOrders);
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
elements.logoutButton?.addEventListener('click', () => signOut(auth));
elements.copyUid?.addEventListener('click', copyUid);
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
    if (!document.hidden) updateOrderAlertsControls();
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
