import { auth, db } from './firebase-config.js';
import {
    onAuthStateChanged,
    signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    collection,
    doc,
    onSnapshot,
    serverTimestamp,
    updateDoc,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ONLINE_ORDERS_ENABLED = true;
const ACTIVE_ORDER_STORAGE_KEY = 'taxi_uspeh_active_online_order_v1';
const CUSTOMER_NAME_STORAGE_KEY = 'taxi_uspeh_customer_name_v1';
const CUSTOMER_PHONE_STORAGE_KEY = 'taxi_uspeh_customer_phone_v1';
const ACTIVE_STATUSES = new Set(['searching', 'accepted', 'en_route', 'arrived', 'in_trip']);
const CANCELLATION_REQUEST_STATUSES = new Set(['accepted', 'en_route', 'arrived']);
const CANCELLATION_REASONS = new Set(['plans_changed', 'no_longer_needed', 'called_other_taxi', 'other']);

const elements = {
    form: document.getElementById('taxiForm'),
    onlineButton: document.getElementById('taxi-online-order-button'),
    whatsappButton: document.getElementById('taxi-whatsapp-order-button'),
    customerName: document.getElementById('taxiCustomerName'),
    customerPhone: document.getElementById('taxiCustomerPhone'),
    status: document.getElementById('taxiStatus'),
    panel: document.getElementById('taxi-online-order-panel'),
    orderNumber: document.getElementById('taxi-online-order-number'),
    orderStatus: document.getElementById('taxi-online-order-status'),
    panelMessage: document.getElementById('taxi-online-order-message'),
    orderRoute: document.getElementById('taxi-online-order-route'),
    orderPrice: document.getElementById('taxi-online-order-price'),
    driverBlock: document.getElementById('taxi-online-driver'),
    driverName: document.getElementById('taxi-online-driver-name'),
    driverCar: document.getElementById('taxi-online-driver-car'),
    driverCall: document.getElementById('taxi-online-driver-call'),
    cancelButton: document.getElementById('taxi-online-cancel-button'),
    cancelReason: document.getElementById('taxi-online-cancel-reason'),
    cancellationNotice: document.getElementById('taxi-online-cancellation-notice'),
    newOrderButton: document.getElementById('taxi-online-new-order-button'),
    dispatcherCall: document.getElementById('taxi-online-dispatcher-call'),
    deliveryForm: document.getElementById('deliveryForm'),
    deliveryOnlineButton: document.getElementById('delivery-online-order-button'),
    deliveryWhatsappButton: document.getElementById('delivery-whatsapp-order-button'),
    deliveryCustomerName: document.getElementById('deliveryCustomerName'),
    deliveryCustomerPhone: document.getElementById('deliveryCustomerPhone'),
    deliveryStatus: document.getElementById('deliveryStatus'),
    deliveryPanel: document.getElementById('delivery-online-order-panel'),
    deliveryOrderNumber: document.getElementById('delivery-online-order-number'),
    deliveryOrderStatus: document.getElementById('delivery-online-order-status'),
    deliveryPanelMessage: document.getElementById('delivery-online-order-message'),
    deliveryOrderRoute: document.getElementById('delivery-online-order-route'),
    deliveryOrderPrice: document.getElementById('delivery-online-order-price'),
    deliveryDriverBlock: document.getElementById('delivery-online-driver'),
    deliveryDriverName: document.getElementById('delivery-online-driver-name'),
    deliveryDriverCar: document.getElementById('delivery-online-driver-car'),
    deliveryDriverCall: document.getElementById('delivery-online-driver-call'),
    deliveryCancelButton: document.getElementById('delivery-online-cancel-button'),
    deliveryCancelReason: document.getElementById('delivery-online-cancel-reason'),
    deliveryCancellationNotice: document.getElementById('delivery-online-cancellation-notice'),
    deliveryNewOrderButton: document.getElementById('delivery-online-new-order-button'),
    deliveryDispatcherCall: document.getElementById('delivery-online-dispatcher-call')
};

let activeOrderId = '';
let activeOrder = null;
let unsubscribeOrder = null;
let actionInProgress = false;
let clientOrderSoundContext = null;
let clientOrderWatchInitialLoaded = false;
let lastObservedOrderStatus = '';
let activeOrderView = 'taxi';

function normalizedOrderService(serviceType) {
    return serviceType === 'delivery' ? 'delivery' : 'taxi';
}

function orderView(serviceType = activeOrderView) {
    if (normalizedOrderService(serviceType) === 'delivery') {
        return {
            serviceType: 'delivery',
            form: elements.deliveryForm,
            onlineButton: elements.deliveryOnlineButton,
            customerName: elements.deliveryCustomerName,
            customerPhone: elements.deliveryCustomerPhone,
            status: elements.deliveryStatus,
            panel: elements.deliveryPanel,
            orderNumber: elements.deliveryOrderNumber,
            orderStatus: elements.deliveryOrderStatus,
            panelMessage: elements.deliveryPanelMessage,
            orderRoute: elements.deliveryOrderRoute,
            orderPrice: elements.deliveryOrderPrice,
            driverBlock: elements.deliveryDriverBlock,
            driverName: elements.deliveryDriverName,
            driverCar: elements.deliveryDriverCar,
            driverCall: elements.deliveryDriverCall,
            cancelButton: elements.deliveryCancelButton,
            cancelReason: elements.deliveryCancelReason,
            cancellationNotice: elements.deliveryCancellationNotice,
            newOrderButton: elements.deliveryNewOrderButton,
            dispatcherCall: elements.deliveryDispatcherCall
        };
    }
    return {
        serviceType: 'taxi',
        form: elements.form,
        onlineButton: elements.onlineButton,
        customerName: elements.customerName,
        customerPhone: elements.customerPhone,
        status: elements.status,
        panel: elements.panel,
        orderNumber: elements.orderNumber,
        orderStatus: elements.orderStatus,
        panelMessage: elements.panelMessage,
        orderRoute: elements.orderRoute,
        orderPrice: elements.orderPrice,
        driverBlock: elements.driverBlock,
        driverName: elements.driverName,
        driverCar: elements.driverCar,
        driverCall: elements.driverCall,
        cancelButton: elements.cancelButton,
        cancelReason: elements.cancelReason,
        cancellationNotice: elements.cancellationNotice,
        newOrderButton: elements.newOrderButton,
        dispatcherCall: elements.dispatcherCall
    };
}

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
}

function getClientOrderSoundContext() {
    if (clientOrderSoundContext) return clientOrderSoundContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    clientOrderSoundContext = new AudioContextClass();
    return clientOrderSoundContext;
}

async function prepareClientOrderSound() {
    const context = getClientOrderSoundContext();
    if (context?.state === 'suspended') await context.resume();
    return context;
}

async function playClientOrderStatusSound(status) {
    const tones = status === 'arrived'
        ? [[0, 784], [0.2, 988], [0.4, 1175]]
        : [[0, 659], [0.18, 784]];
    try {
        const context = await prepareClientOrderSound();
        if (!context || context.state !== 'running') return;
        const startAt = context.currentTime;
        for (const [offset, frequency] of tones) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.13, startAt + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.15);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + 0.16);
        }
    } catch (error) {
        console.warn('Звук статуса заказа недоступен:', error.message);
    }
}

function signalClientOrderStatusChange(previousStatus, order) {
    const nextStatus = order?.status || '';
    if (previousStatus === nextStatus || !['accepted', 'arrived'].includes(nextStatus)) return;
    void playClientOrderStatusSound(nextStatus);
}

function setStatus(message, success = false, serviceType = activeOrderView) {
    const view = orderView(serviceType);
    const panelVisible = view.panel && !view.panel.classList.contains('hidden');
    const target = panelVisible ? view.panelMessage : view.status;
    const other = panelVisible ? view.status : view.panelMessage;
    if (other) {
        other.textContent = '';
        other.classList.add('hidden');
    }
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('hidden', !message);
    target.classList.toggle('active', Boolean(message));
    target.classList.remove(
        'bg-red-100', 'border-red-400', 'text-red-700',
        'bg-green-100', 'border-green-400', 'text-green-700'
    );
    if (message) {
        target.classList.add(
            success ? 'bg-green-100' : 'bg-red-100',
            success ? 'border-green-400' : 'border-red-400',
            success ? 'text-green-700' : 'text-red-700'
        );
    }
}

function setActionBusy(busy, serviceType = activeOrderView) {
    actionInProgress = busy;
    const view = orderView(serviceType);
    if (view.onlineButton) {
        view.onlineButton.disabled = busy;
        const label = view.onlineButton.querySelector('[data-online-label], [data-delivery-online-label]');
        if (label) label.textContent = busy ? 'Отправляем…' : 'Заказать онлайн';
    }
    if (view.cancelButton) view.cancelButton.disabled = busy;
    if (view.cancelReason) view.cancelReason.disabled = busy;
}

function normalizePhone(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function validPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function telHref(value) {
    const normalized = String(value || '').replace(/[^\d+]/g, '');
    return normalized ? `tel:${normalized}` : '#';
}

function combineAddress(baseId, houseId, aptId) {
    const base = document.getElementById(baseId)?.value.trim() || '';
    const house = document.getElementById(houseId)?.value.trim() || '';
    const apt = document.getElementById(aptId)?.value.trim() || '';
    let result = base;
    if (house) result += `, д. ${house}`;
    if (apt) result += `, подъезд ${apt}`;
    return result;
}

function collectStops() {
    return Array.from(document.querySelectorAll('#additionalStops .additional-stop-item'))
        .map((stop) => {
            const address = stop.querySelector('[data-taxi-stop-address], input')?.value.trim() || '';
            const city = stop.querySelector('[data-taxi-stop-city]')?.value || 'Белоусовка';
            return address ? `${address} (${city})` : '';
        })
        .filter(Boolean)
        .slice(0, 5);
}

function parseMaximumPrice(text) {
    const amounts = (String(text || '').match(/\d[\d\s\u00A0]*/g) || [])
        .map((value) => Number(value.replace(/\D/g, '')))
        .filter((value) => Number.isFinite(value));
    return amounts.length ? Math.max(...amounts) : 0;
}

function createOrderNumber() {
    const now = new Date();
    const date = [
        String(now.getFullYear()).slice(-2),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TU-${date}-${suffix}`;
}

function readStoredValue(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

function storeValue(key, value) {
    try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    } catch {
        // Блокировка localStorage не должна мешать оформлению заказа.
    }
}

async function ensureSignedIn() {
    if (auth.currentUser) return auth.currentUser;

    return new Promise((resolve, reject) => {
        let settled = false;
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user || settled) return;
            settled = true;
            unsubscribe();
            resolve(user);
        }, (error) => {
            if (settled) return;
            settled = true;
            unsubscribe();
            reject(error);
        });

        signInAnonymously(auth).catch((error) => {
            if (settled) return;
            settled = true;
            unsubscribe();
            reject(error);
        });
    });
}

function statusPresentation(order) {
    const status = typeof order === 'string' ? order : order.status;
    if (order?.cancellationRequestStatus === 'pending') {
        return ['Запрос отмены отправлен диспетчеру', 'bg-amber-100 text-amber-900 border-amber-300'];
    }
    if (status === 'cancelled' && order?.cancellationDecision === 'false_call_fee') {
        return ['Заказ отменён · компенсация 500 ₸', 'bg-red-100 text-red-900 border-red-300'];
    }
    if (status === 'searching' && order?.requeuedAt) {
        return ['Подбираем другого водителя', 'bg-amber-100 text-amber-900 border-amber-300'];
    }
    const statuses = {
        searching: ['Ищем свободного водителя', 'bg-amber-100 text-amber-900 border-amber-300'],
        accepted: ['Водитель принял заказ', 'bg-blue-100 text-blue-900 border-blue-300'],
        en_route: ['Водитель едет к вам', 'bg-blue-100 text-blue-900 border-blue-300'],
        arrived: ['Водитель подъехал', 'bg-green-100 text-green-900 border-green-300'],
        in_trip: ['Поездка началась', 'bg-indigo-100 text-indigo-900 border-indigo-300'],
        completed: ['Поездка завершена', 'bg-green-100 text-green-900 border-green-300'],
        cancelled: ['Заказ отменён', 'bg-red-100 text-red-900 border-red-300']
    };
    return statuses[status] || ['Статус обновляется', 'bg-gray-100 text-gray-900 border-gray-300'];
}

function showOrderPanel(order) {
    activeOrderView = normalizedOrderService(order.serviceType);
    const view = orderView(activeOrderView);
    const [statusText, statusClasses] = statusPresentation(order);
    if (view.orderNumber) view.orderNumber.textContent = order.orderNumber || activeOrderId;
    const deliveryItems = order.serviceType === 'delivery' ? String(order.serviceDetails?.items || '').trim() : '';
    if (view.orderRoute) {
        view.orderRoute.textContent = [
            `${order.fromAddress || '—'} → ${order.toAddress || '—'}`,
            deliveryItems ? `Что доставить: ${deliveryItems}` : ''
        ].filter(Boolean).join(' · ');
    }
    if (view.orderPrice) view.orderPrice.textContent = order.priceText || 'Цена уточняется';
    if (view.orderStatus) {
        view.orderStatus.className = `rounded-xl border p-3 text-sm font-extrabold ${statusClasses}`;
        view.orderStatus.textContent = statusText;
    }

    const hasDriver = Boolean(order.assignedDriverUid && order.driverName);
    setHidden(view.driverBlock, !hasDriver);
    if (hasDriver) {
        if (view.driverName) view.driverName.textContent = order.driverName || 'Водитель';
        if (view.driverCar) view.driverCar.textContent = [order.driverCar, order.driverColor].filter(Boolean).join(', ') || 'Автомобиль уточняется';
        if (view.driverCall) view.driverCall.href = telHref(order.driverPhone);
        setHidden(view.driverCall, !order.driverPhone);
    }

    const pendingCancellation = order.cancellationRequestStatus === 'pending';
    const canRequestCancellation = CANCELLATION_REQUEST_STATUSES.has(order.status) && !pendingCancellation;
    const canCancelImmediately = order.status === 'searching';
    setHidden(view.cancelButton, !canCancelImmediately && !canRequestCancellation);
    if (view.cancelButton) {
        view.cancelButton.textContent = canRequestCancellation ? 'Запросить отмену' : 'Отменить заказ';
    }
    setHidden(view.cancelReason, !canRequestCancellation);
    if (view.cancellationNotice) {
        let notice = '';
        if (pendingCancellation) {
            notice = 'Водитель уже назначен. Диспетчер рассматривает запрос на отмену. Не оформляйте новый заказ, пока не получите решение.';
        } else if (order.cancellationDecision === 'false_call_fee') {
            notice = 'Диспетчер отметил компенсацию за ложный вызов: 500 ₸. Для уточнения позвоните диспетчеру.';
        } else if (order.cancellationDecision === 'free') {
            notice = 'Диспетчер подтвердил отмену без компенсации.';
        }
        view.cancellationNotice.textContent = notice;
        setHidden(view.cancellationNotice, !notice);
    }
    setHidden(view.newOrderButton, ACTIVE_STATUSES.has(order.status));
    setHidden(view.form, true);
    setHidden(view.panel, false);
}

function clearOrderWatch() {
    if (unsubscribeOrder) unsubscribeOrder();
    unsubscribeOrder = null;
}

function startOrderWatch(orderId) {
    clearOrderWatch();
    activeOrderId = orderId;
    clientOrderWatchInitialLoaded = false;
    lastObservedOrderStatus = '';
    storeValue(ACTIVE_ORDER_STORAGE_KEY, orderId);

    unsubscribeOrder = onSnapshot(doc(db, 'orders', orderId), (snapshot) => {
        if (!snapshot.exists()) {
            resetToForm();
            setStatus('Заказ не найден. Можно оформить новый заказ.');
            return;
        }
        const nextOrder = snapshot.data();
        const previousStatus = lastObservedOrderStatus;
        activeOrder = nextOrder;
        showOrderPanel(activeOrder);
        if (clientOrderWatchInitialLoaded) signalClientOrderStatusChange(previousStatus, activeOrder);
        lastObservedOrderStatus = activeOrder.status || '';
        clientOrderWatchInitialLoaded = true;
    }, (error) => {
        console.warn('Не удалось обновить статус заказа:', error.code || error.message);
        setStatus('Не удалось обновить статус. Проверьте интернет или позвоните диспетчеру.');
    });
}

function resetToForm() {
    const view = orderView(activeOrderView);
    clearOrderWatch();
    activeOrderId = '';
    activeOrder = null;
    clientOrderWatchInitialLoaded = false;
    lastObservedOrderStatus = '';
    storeValue(ACTIVE_ORDER_STORAGE_KEY, '');
    setHidden(view.panel, true);
    setHidden(view.form, false);
    setStatus('', false, activeOrderView);
}

async function createOnlineOrder() {
    if (!ONLINE_ORDERS_ENABLED || actionInProgress) return;
    activeOrderView = 'taxi';
    setStatus('', false, 'taxi');

    const rawFromAddress = combineAddress('taxiFrom', 'taxiHouse', 'taxiApt');
    const rawToAddress = document.getElementById('taxiTo')?.value.trim() || '';
    const customerName = elements.customerName?.value.trim() || '';
    const customerPhone = normalizePhone(elements.customerPhone?.value);
    const passengerPhone = normalizePhone(document.getElementById('passengerPhone')?.value);

    if (!rawFromAddress || !rawToAddress) {
        setStatus('Заполните адрес отправления и адрес назначения.', false, 'taxi');
        elements.form?.reportValidity();
        return;
    }
    if (!validPhone(customerPhone)) {
        setStatus('Для онлайн-заказа укажите корректный номер телефона.', false, 'taxi');
        elements.customerPhone?.focus();
        return;
    }
    if (passengerPhone && !validPhone(passengerPhone)) {
        setStatus('Проверьте номер телефона пассажира.', false, 'taxi');
        document.getElementById('passengerPhone')?.focus();
        return;
    }

    // Вызывается прямо из нажатия «Заказать онлайн»: браузер разрешает звук
    // для последующих смен статуса без дополнительной кнопки для клиента.
    void prepareClientOrderSound();
    setActionBusy(true, 'taxi');
    try {
        const fromCity = document.getElementById('taxiFromCitySelect')?.value || 'Белоусовка';
        const toCity = document.getElementById('taxiCitySelect')?.value || 'Белоусовка';
        const fromAddress = `${rawFromAddress} (${fromCity})`;
        const toAddress = `${rawToAddress} (${toCity})`;
        const user = await ensureSignedIn();
        const orderRef = doc(collection(db, 'orders'));
        const contactRef = doc(db, 'orderContacts', orderRef.id);
        const priceText = document.getElementById('taxiPriceEstimate')?.textContent.trim() || 'Цена уточняется';
        const direction = toCity === 'Белоусовка' ? '' : toCity;
        const scheduledFor = document.getElementById('taxiDateTime')?.value || '';
        const wishes = document.getElementById('taxiWishes')?.value.trim() || '';
        const batch = writeBatch(db);

        batch.set(orderRef, {
            orderNumber: createOrderNumber(),
            serviceType: 'taxi',
            source: 'online',
            clientUid: user.uid,
            fromAddress,
            toAddress,
            stops: collectStops(),
            wishes,
            scheduledFor,
            direction,
            priceText,
            // Для диапазона «800–1000 ₸» расчётной суммой является 1000 ₸.
            priceAmount: parseMaximumPrice(priceText),
            status: 'searching',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        batch.set(contactRef, {
            clientUid: user.uid,
            customerName: customerName || 'Клиент',
            customerPhone,
            passengerPhone,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        await batch.commit();
        storeValue(CUSTOMER_NAME_STORAGE_KEY, customerName);
        storeValue(CUSTOMER_PHONE_STORAGE_KEY, customerPhone);
        if (typeof window.saveOrderToFullHistory === 'function') {
            window.saveOrderToFullHistory(fromAddress, toAddress, priceText);
        }
        startOrderWatch(orderRef.id);
    } catch (error) {
        console.error('Онлайн-заказ не создан:', error);
        const message = error.code === 'permission-denied'
            ? 'Онлайн-заказы ещё не включены в правилах Firebase. Пока используйте WhatsApp.'
            : 'Не удалось отправить онлайн-заказ. Проверьте интернет или используйте WhatsApp.';
        setStatus(message, false, 'taxi');
    } finally {
        setActionBusy(false, 'taxi');
    }
}

function containsRestrictedDeliveryItems(value) {
    return /(алкогол|пиво|вино|водк|сигар|табак|никотин|вейп)/i.test(String(value || ''));
}

async function createOnlineDeliveryOrder() {
    if (!ONLINE_ORDERS_ENABLED || actionInProgress) return;
    activeOrderView = 'delivery';
    setStatus('', false, 'delivery');

    const items = document.getElementById('deliveryItems')?.value.trim() || '';
    const store = document.getElementById('deliveryStore')?.value.trim() || '';
    const rawDeliveryAddress = combineAddress('deliveryAddress', 'deliveryHouse', 'deliveryApt');
    const customerName = elements.deliveryCustomerName?.value.trim() || '';
    const customerPhone = normalizePhone(elements.deliveryCustomerPhone?.value);

    if (!items || !rawDeliveryAddress) {
        setStatus('Заполните список товаров и адрес доставки.', false, 'delivery');
        elements.deliveryForm?.reportValidity();
        return;
    }
    if (containsRestrictedDeliveryItems(items)) {
        setStatus('Онлайн-заказ доступен только для товаров без возрастных ограничений.', false, 'delivery');
        return;
    }
    if (!validPhone(customerPhone)) {
        setStatus('Для онлайн-заказа укажите корректный номер телефона.', false, 'delivery');
        elements.deliveryCustomerPhone?.focus();
        return;
    }

    void prepareClientOrderSound();
    setActionBusy(true, 'delivery');
    try {
        const deliveryCity = document.getElementById('deliveryCitySelect')?.value || 'Белоусовка';
        const toAddress = `${rawDeliveryAddress} (${deliveryCity})`;
        const fromAddress = store ? `Магазин: ${store}` : 'Доставка';
        const user = await ensureSignedIn();
        const orderRef = doc(collection(db, 'orders'));
        const contactRef = doc(db, 'orderContacts', orderRef.id);
        const priceText = document.getElementById('deliveryPriceEstimate')?.textContent.trim() || 'Цена уточняется';
        const batch = writeBatch(db);

        batch.set(orderRef, {
            orderNumber: createOrderNumber(),
            serviceType: 'delivery',
            source: 'online',
            clientUid: user.uid,
            fromAddress,
            toAddress,
            stops: [],
            wishes: '',
            scheduledFor: '',
            direction: deliveryCity === 'Белоусовка' ? '' : deliveryCity,
            priceText,
            priceAmount: parseMaximumPrice(priceText),
            serviceDetails: { store, items },
            status: 'searching',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        batch.set(contactRef, {
            clientUid: user.uid,
            customerName: customerName || 'Клиент',
            customerPhone,
            passengerPhone: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        await batch.commit();
        storeValue(CUSTOMER_NAME_STORAGE_KEY, customerName);
        storeValue(CUSTOMER_PHONE_STORAGE_KEY, customerPhone);
        if (typeof window.saveOrderToFullHistory === 'function') {
            window.saveOrderToFullHistory(fromAddress, toAddress, priceText);
        }
        startOrderWatch(orderRef.id);
    } catch (error) {
        console.error('Онлайн-доставка не создана:', error);
        const message = error.code === 'permission-denied'
            ? 'Онлайн-доставка ещё не включена в правилах Firebase. Пока используйте WhatsApp.'
            : 'Не удалось отправить онлайн-доставку. Проверьте интернет или используйте WhatsApp.';
        setStatus(message, false, 'delivery');
    } finally {
        setActionBusy(false, 'delivery');
    }
}

async function cancelOnlineOrder() {
    if (!activeOrderId || !activeOrder || actionInProgress) return;
    const view = orderView(activeOrderView);
    const status = activeOrder.status;
    if (status === 'searching') {
        if (!window.confirm('Отменить заказ? Водитель ещё не назначен.')) return;
    } else if (CANCELLATION_REQUEST_STATUSES.has(status)) {
        const reason = view.cancelReason?.value || '';
        if (!CANCELLATION_REASONS.has(reason)) {
            setStatus('Выберите причину отмены.', false, activeOrderView);
            return;
        }
        if (!window.confirm('Водитель уже назначен. При ложном вызове диспетчер может отметить компенсацию 500 ₸. Отправить запрос на отмену?')) return;
        setActionBusy(true, activeOrderView);
        try {
            await updateDoc(doc(db, 'orders', activeOrderId), {
                cancellationRequestStatus: 'pending',
                cancellationReason: reason,
                cancellationRequestedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            setStatus('Запрос на отмену отправлен диспетчеру.', true, activeOrderView);
        } catch (error) {
            console.warn('Запрос на отмену не отправлен:', error.code || error.message);
            setStatus('Не удалось отправить запрос. Позвоните диспетчеру.', false, activeOrderView);
        } finally {
            setActionBusy(false, activeOrderView);
        }
        return;
    } else {
        setStatus('Этот заказ уже нельзя отменить через сайт. Позвоните диспетчеру.', false, activeOrderView);
        return;
    }
    setActionBusy(true, activeOrderView);
    try {
        await updateDoc(doc(db, 'orders', activeOrderId), {
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.warn('Заказ не отменён:', error.code || error.message);
        setStatus('Не удалось отменить заказ. Позвоните диспетчеру.', false, activeOrderView);
    } finally {
        setActionBusy(false, activeOrderView);
    }
}

function restoreSavedContact() {
    for (const view of [orderView('taxi'), orderView('delivery')]) {
        if (view.customerName && !view.customerName.value) {
            view.customerName.value = readStoredValue(CUSTOMER_NAME_STORAGE_KEY);
        }
        if (view.customerPhone && !view.customerPhone.value) {
            view.customerPhone.value = readStoredValue(CUSTOMER_PHONE_STORAGE_KEY);
        }
    }
}

async function restoreActiveOrder() {
    const savedOrderId = readStoredValue(ACTIVE_ORDER_STORAGE_KEY);
    if (!savedOrderId) return;
    try {
        await ensureSignedIn();
        startOrderWatch(savedOrderId);
    } catch (error) {
        console.warn('Не удалось восстановить заказ:', error.code || error.message);
    }
}

if (!ONLINE_ORDERS_ENABLED) {
    setHidden(elements.onlineButton, true);
    setHidden(elements.deliveryOnlineButton, true);
}
restoreSavedContact();
elements.onlineButton?.addEventListener('click', createOnlineOrder);
elements.deliveryOnlineButton?.addEventListener('click', createOnlineDeliveryOrder);
elements.cancelButton?.addEventListener('click', cancelOnlineOrder);
elements.deliveryCancelButton?.addEventListener('click', cancelOnlineOrder);
elements.newOrderButton?.addEventListener('click', resetToForm);
elements.deliveryNewOrderButton?.addEventListener('click', resetToForm);
elements.dispatcherCall?.setAttribute('href', 'tel:+77770649648');
elements.deliveryDispatcherCall?.setAttribute('href', 'tel:+77770649648');

void restoreActiveOrder();
