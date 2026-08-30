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
    orderBy,
    query,
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
let unsubscribeDrivers = null;
let authActionInProgress = false;

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
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
    return driver.status === 'active' && Number(driver.balance) < 0;
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
    unsubscribeDrivers = null;
    drivers = [];
    setHidden(elements.panel, true);
    setHidden(elements.driversList, true);
    setHidden(elements.driversEmpty, true);
    setHidden(elements.driversLoading, false);
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
        await loadOrdersLink();
    } catch (error) {
        console.warn('Проверка администратора не выполнена:', error.code || error.message);
        setHidden(elements.setup, false);
        if (error.code !== 'permission-denied') {
            showAuthMessage('Не удалось проверить доступ. Проверьте интернет и обновите страницу.');
        }
    }
}

function updateStats() {
    const active = drivers.filter((driver) => driver.status === 'active').length;
    const allowed = drivers.filter(canTakeOrders).length;
    elements.total.textContent = String(drivers.length);
    elements.active.textContent = String(active);
    elements.allowed.textContent = String(allowed);
    elements.blocked.textContent = String(drivers.length - allowed);
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
    badge.className = canTakeOrders(driver)
        ? 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
        : 'flex-shrink-0 text-xs font-extrabold rounded-full px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    badge.textContent = canTakeOrders(driver) ? '✅ Можно брать' : '🔴 Ограничено';
    header.append(titleWrap, badge);

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
    card.append(header, grid, footer);

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

        if (oldUid && oldUid !== authUid) batch.delete(doc(db, 'driverAccounts', oldUid));
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
elements.driverSearch.addEventListener('input', renderDrivers);

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
