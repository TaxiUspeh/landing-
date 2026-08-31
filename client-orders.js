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
    newOrderButton: document.getElementById('taxi-online-new-order-button'),
    dispatcherCall: document.getElementById('taxi-online-dispatcher-call')
};

let activeOrderId = '';
let unsubscribeOrder = null;
let actionInProgress = false;

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
}

function setStatus(message, success = false) {
    const panelVisible = elements.panel && !elements.panel.classList.contains('hidden');
    const target = panelVisible ? elements.panelMessage : elements.status;
    const other = panelVisible ? elements.status : elements.panelMessage;
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

function setActionBusy(busy) {
    actionInProgress = busy;
    if (elements.onlineButton) {
        elements.onlineButton.disabled = busy;
        const label = elements.onlineButton.querySelector('[data-online-label]');
        if (label) label.textContent = busy ? 'Отправляем…' : 'Заказать онлайн';
    }
    if (elements.cancelButton) elements.cancelButton.disabled = busy;
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
    return Array.from(document.querySelectorAll('#additionalStops input'))
        .map((input) => input.value.trim())
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

function statusPresentation(status) {
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
    const [statusText, statusClasses] = statusPresentation(order.status);
    elements.orderNumber.textContent = order.orderNumber || activeOrderId;
    elements.orderRoute.textContent = `${order.fromAddress || '—'} → ${order.toAddress || '—'}`;
    elements.orderPrice.textContent = order.priceText || 'Цена уточняется';
    elements.orderStatus.className = `rounded-xl border p-3 text-sm font-extrabold ${statusClasses}`;
    elements.orderStatus.textContent = statusText;

    const hasDriver = Boolean(order.assignedDriverUid && order.driverName);
    setHidden(elements.driverBlock, !hasDriver);
    if (hasDriver) {
        elements.driverName.textContent = order.driverName || 'Водитель';
        elements.driverCar.textContent = [order.driverCar, order.driverColor].filter(Boolean).join(', ') || 'Автомобиль уточняется';
        elements.driverCall.href = telHref(order.driverPhone);
        setHidden(elements.driverCall, !order.driverPhone);
    }

    setHidden(elements.cancelButton, order.status !== 'searching');
    setHidden(elements.newOrderButton, ACTIVE_STATUSES.has(order.status));
    setHidden(elements.form, true);
    setHidden(elements.panel, false);
}

function clearOrderWatch() {
    if (unsubscribeOrder) unsubscribeOrder();
    unsubscribeOrder = null;
}

function startOrderWatch(orderId) {
    clearOrderWatch();
    activeOrderId = orderId;
    storeValue(ACTIVE_ORDER_STORAGE_KEY, orderId);

    unsubscribeOrder = onSnapshot(doc(db, 'orders', orderId), (snapshot) => {
        if (!snapshot.exists()) {
            resetToForm();
            setStatus('Заказ не найден. Можно оформить новый заказ.');
            return;
        }
        showOrderPanel(snapshot.data());
    }, (error) => {
        console.warn('Не удалось обновить статус заказа:', error.code || error.message);
        setStatus('Не удалось обновить статус. Проверьте интернет или позвоните диспетчеру.');
    });
}

function resetToForm() {
    clearOrderWatch();
    activeOrderId = '';
    storeValue(ACTIVE_ORDER_STORAGE_KEY, '');
    setHidden(elements.panel, true);
    setHidden(elements.form, false);
    setStatus('');
}

async function createOnlineOrder() {
    if (!ONLINE_ORDERS_ENABLED || actionInProgress) return;
    setStatus('');

    const fromAddress = combineAddress('taxiFrom', 'taxiHouse', 'taxiApt');
    const toAddress = document.getElementById('taxiTo')?.value.trim() || '';
    const customerName = elements.customerName?.value.trim() || '';
    const customerPhone = normalizePhone(elements.customerPhone?.value);
    const passengerPhone = normalizePhone(document.getElementById('passengerPhone')?.value);

    if (!fromAddress || !toAddress) {
        setStatus('Заполните адрес отправления и адрес назначения.');
        elements.form?.reportValidity();
        return;
    }
    if (!validPhone(customerPhone)) {
        setStatus('Для онлайн-заказа укажите корректный номер телефона.');
        elements.customerPhone?.focus();
        return;
    }
    if (passengerPhone && !validPhone(passengerPhone)) {
        setStatus('Проверьте номер телефона пассажира.');
        document.getElementById('passengerPhone')?.focus();
        return;
    }

    setActionBusy(true);
    try {
        const user = await ensureSignedIn();
        const orderRef = doc(collection(db, 'orders'));
        const contactRef = doc(db, 'orderContacts', orderRef.id);
        const priceText = document.getElementById('taxiPriceEstimate')?.textContent.trim() || 'Цена уточняется';
        const direction = document.getElementById('taxiCitySelect')?.value || '';
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
        setStatus(message);
    } finally {
        setActionBusy(false);
    }
}

async function cancelOnlineOrder() {
    if (!activeOrderId || actionInProgress) return;
    setActionBusy(true);
    try {
        await updateDoc(doc(db, 'orders', activeOrderId), {
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.warn('Заказ не отменён:', error.code || error.message);
        setStatus('Не удалось отменить заказ. Позвоните диспетчеру.');
    } finally {
        setActionBusy(false);
    }
}

function restoreSavedContact() {
    if (elements.customerName && !elements.customerName.value) {
        elements.customerName.value = readStoredValue(CUSTOMER_NAME_STORAGE_KEY);
    }
    if (elements.customerPhone && !elements.customerPhone.value) {
        elements.customerPhone.value = readStoredValue(CUSTOMER_PHONE_STORAGE_KEY);
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

if (!ONLINE_ORDERS_ENABLED) setHidden(elements.onlineButton, true);
restoreSavedContact();
elements.onlineButton?.addEventListener('click', createOnlineOrder);
elements.cancelButton?.addEventListener('click', cancelOnlineOrder);
elements.newOrderButton?.addEventListener('click', resetToForm);
elements.dispatcherCall?.setAttribute('href', 'tel:+77770649648');

void restoreActiveOrder();
