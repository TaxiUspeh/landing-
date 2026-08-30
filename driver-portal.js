import { auth, db, googleProvider } from './firebase-config.js';
import {
    getRedirectResult,
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    doc,
    getDoc,
    onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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
    ordersLink: document.getElementById('driver-orders-link'),
    ordersUnavailable: document.getElementById('driver-orders-unavailable'),
    message: document.getElementById('driver-auth-message')
};

let authActionInProgress = false;
let unsubscribeAccount = null;
let unsubscribeDriver = null;

function setHidden(element, hidden) {
    if (element) element.classList.toggle('hidden', hidden);
}

function showMessage(text) {
    if (!elements.message) return;
    elements.message.textContent = text;
    setHidden(elements.message, !text);
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

function renderWorkStatus(driver) {
    const balance = Number(driver.balance);
    const status = driver.status || 'paused';
    const canTakeOrders = status === 'active' && Number.isFinite(balance) && balance < 0;

    elements.workStatus.className = canTakeOrders
        ? 'rounded-xl p-3 mb-4 text-sm font-bold bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
        : 'rounded-xl p-3 mb-4 text-sm font-bold bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300';
    elements.workStatus.textContent = canTakeOrders
        ? '✅ Можно принимать заказы'
        : status !== 'active'
            ? '🔴 Доступ к заказам приостановлен диспетчером'
            : '🔴 При балансе 0 ₸ или выше заказы недоступны';

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

function stopProfileWatches() {
    if (unsubscribeAccount) unsubscribeAccount();
    if (unsubscribeDriver) unsubscribeDriver();
    unsubscribeAccount = null;
    unsubscribeDriver = null;
}

function showProfileLoadError(error) {
    console.warn('Не удалось загрузить карточку водителя:', error.code || error.message);
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
    setHidden(elements.pending, true);
    setHidden(elements.profile, true);
    showMessage('');

    unsubscribeAccount = onSnapshot(doc(db, 'driverAccounts', user.uid), (accountSnapshot) => {
        if (unsubscribeDriver) unsubscribeDriver();
        unsubscribeDriver = null;
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
            loadOrdersLink(renderWorkStatus(driver));
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

getRedirectResult(auth).catch((error) => {
    console.error('Ошибка возврата из Google:', error);
    showMessage('Google не завершил вход. Попробуйте ещё раз.');
});

onAuthStateChanged(auth, (user) => {
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
