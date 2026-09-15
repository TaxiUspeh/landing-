import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initDriverCabinet } from '../../driver-cabinet.js';
import * as finance from '../../driver-finance.js';
import * as categories from '../../vehicle-categories.js';
import * as auction from '../../auction-core.js';

const html = await readFile(new URL('../../drivers.html', import.meta.url), 'utf8');
const original = await readFile(new URL('../../driver-portal.js', import.meta.url), 'utf8');
const vapid = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
    for (let i = 0; i < 200; i++) { if (check()) return; await tick(); }
    assert.fail('Operation did not settle');
}
function fixture({ timeout = 15000 } = {}) {
    const dom = new JSDOM(html, { url: 'https://example.test/landing-/drivers.html', pretendToBeVisual: true });
    globalThis.window = dom.window; globalThis.document = dom.window.document;
    const records = new Map(); const writes = []; const calls = []; const messages = [];
    const settings = { webPushVapidKey: vapid };
    const fail = {};
    let endpoint = 'legacy-token'; let nextToken = 0; let authListener;
    const permission = { permission: 'granted', requestPermission: async () => { calls.push('permission'); return (permission.permission = 'granted'); } };
    dom.window.Notification = permission;
    Object.defineProperty(dom.window, 'isSecureContext', { value: true });
    const registration = {
        pushManager: { getSubscription: async () => endpoint ? { unsubscribe: async () => { calls.push('unsubscribe'); endpoint = ''; return true; } } : null },
        showNotification: async (...args) => messages.push(args)
    };
    const serviceWorker = {
        register: async () => { calls.push('worker'); if (fail.worker) throw fail.worker; return registration; },
        ready: Promise.resolve(registration), getRegistration: async () => registration
    };
    Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: serviceWorker });
    dom.window.localStorage.setItem('taxi-uspeh-driver-push-device-id-v1', 'phone-1');
    const context = vm.createContext({
        ...finance, ...categories, ...auction, initDriverCabinet,
        window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
        localStorage: dom.window.localStorage, Notification: permission, atob, URLSearchParams,
        console: { warn: (...args) => calls.push(['warn', ...args]), error: (...args) => calls.push(['error', ...args]), log() {} },
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: callback => callback(),
        app: {}, auth: {}, db: {}, googleProvider: {},
        getRedirectResult: async () => null, onAuthStateChanged: (_auth, fn) => { authListener = fn; },
        signOut: async () => { authListener(null); }, onSnapshot: () => () => {},
        doc: (_db, ...path) => path.join('/'), serverTimestamp: () => 'server-time',
        getDoc: async path => { calls.push('settings'); if (fail.settings) throw fail.settings; return { exists: () => true, data: () => settings }; },
        isMessagingSupported: async () => true,
        getMessaging: () => ({}),
        getToken: async (_messaging, options) => {
            calls.push('token'); assert.equal(options.serviceWorkerRegistration, registration);
            if (fail.token) return typeof fail.token === 'function' ? fail.token() : Promise.reject(fail.token);
            endpoint ||= 'new-token-' + ++nextToken;
            return endpoint;
        },
        setDoc: async (path, data, options) => {
            if (fail.save) throw fail.save;
            const old = records.get(path);
            const uid = vm.runInContext('currentUser?.uid', context);
            assert.ok(path.startsWith('driverPushTokens/'));
            // Model the existing immutable ownership constraints, including corrupt legacy records.
            if (old && (old.uid !== uid || old.driverId !== vm.runInContext('currentDriverId', context))) {
                throw Object.assign(new Error('Denied'), { code: 'permission-denied' });
            }
            if (!old) assert.deepEqual(Object.keys(data).sort(), ['driverId','enabled','token','uid','updatedAt']);
            const updated = options?.merge ? { ...old, ...data } : { ...data };
            records.set(path, updated); writes.push({ path, data: updated });
        }
    });
    vm.runInContext(original.replace('const DRIVER_PUSH_TIMEOUT_MS = 15000;', `const DRIVER_PUSH_TIMEOUT_MS = ${timeout};`).replace(/^import[\s\S]*?;\n/gm, ''), context);
    const run = code => vm.runInContext(code, context);
    const select = (uid = 'me', driverId = '32') => run(`currentUser={uid:${JSON.stringify(uid)}};currentDriverId=${JSON.stringify(driverId)};currentDriver={status:'active'};currentBaseEligible=true;orderAlertsEnabled=true;`);
    select();
    return { dom, run, select, records, writes, calls, messages, settings, fail, permission, serviceWorker, registration,
        get: id => dom.window.document.getElementById(id), close: () => dom.window.close() };
}

// A legacy document with a mismatched owner is never overwritten; the same browser
// receives a fresh endpoint and a registration for the actual signed-in card.
{
    const f = fixture();
    const legacy = { uid: 'someone-else', driverId: '666', token: 'legacy-token', enabled: true };
    f.records.set('driverPushTokens/me-phone-1', legacy);
    assert.equal(await f.run('enableDriverPushSubscription()'), true);
    assert.equal(f.records.get('driverPushTokens/me-phone-1'), legacy);
    assert.equal(f.writes[0].path, 'driverPushTokens/me-phone-1-v2-32');
    assert.equal(f.writes[0].data.uid, 'me'); assert.equal(f.writes[0].data.driverId, '32');
    assert.notEqual(f.writes[0].data.token, 'legacy-token');
    assert.match(f.get('driver-order-alerts-status').textContent, /Телефон подключён/);
    const token1 = f.writes[0].data.token;
    await f.run('enableDriverPushSubscription()');
    assert.equal(f.writes.at(-1).data.token, token1, 'ordinary reload reuses this binding');
    f.select('me', '53');
    await f.run('enableDriverPushSubscription()');
    assert.equal(f.writes.at(-1).path, 'driverPushTokens/me-phone-1-v2-53');
    assert.notEqual(f.writes.at(-1).data.token, token1, 'card change retires the old endpoint');
    f.select('other-account', '54');
    await f.run('enableDriverPushSubscription()');
    assert.equal(f.writes.at(-1).data.uid, 'other-account');
    f.close();
}

// Retry is its own UI action; it keeps sound enabled and reloads corrected settings.
{
    const f = fixture();
    f.fail.settings = Object.assign(new Error('private-token-DO-NOT-EXPOSE'), { code: 'permission-denied' });
    await f.run('enableDriverPushSubscription()');
    assert.match(f.get('driver-order-alerts-diagnostic').textContent, /загрузка настроек.*permission-denied/);
    assert.equal(f.dom.window.document.body.textContent.includes('DO-NOT-EXPOSE'), false);
    delete f.fail.settings;
    f.get('driver-order-alerts-retry').click();
    await until(() => f.run('driverPushState') === 'enabled');
    assert.equal(f.run('orderAlertsEnabled'), true);
    assert.equal(f.get('driver-order-alerts-toggle').querySelector('span').textContent, 'Отключить сигналы');
    f.fail.save = Object.assign(new Error('private-endpoint'), { code: 'permission-denied' });
    await f.run('retryDriverPushSubscription()');
    assert.match(f.get('driver-order-alerts-diagnostic').textContent, /сохранение подключения.*permission-denied/);
    assert.equal(f.get('driver-order-alerts-retry').disabled, false);
    f.close();
}

// Missing/invalid keys, denied permission, worker failure, and token failure are distinguished.
for (const [kind, expected] of [
    ['missing', 'not_configured'], ['invalid', 'ключ Web Push'], ['denied', 'denied'],
    ['worker', 'фоновый обработчик'], ['token', 'регистрация в Firebase']
]) {
    const f = fixture();
    if (kind === 'missing') f.settings.webPushVapidKey = '';
    if (kind === 'invalid') f.settings.webPushVapidKey = 'copied incorrectly';
    if (kind === 'denied') f.permission.permission = 'denied';
    if (kind === 'worker' || kind === 'token') f.fail[kind] = Object.assign(new Error('private'), { code: 'messaging/test-error' });
    await f.run('enableDriverPushSubscription()');
    if (['missing', 'denied'].includes(kind)) assert.equal(f.run('driverPushState'), expected);
    else assert.ok(f.get('driver-order-alerts-diagnostic').textContent.includes(expected));
    assert.equal(f.writes.length, 0); f.close();
}
{
    const f = fixture(); f.permission.permission = 'default'; f.run('orderAlertsEnabled=false');
    const result = f.run('toggleOrderAlerts()');
    assert.equal(f.calls[0], 'permission', 'permission is requested before asynchronous network work');
    await result; assert.equal(f.run('driverPushState'), 'enabled');
    await f.run('toggleOrderAlerts()');
    assert.equal(f.run('orderAlertsEnabled'), false);
    assert.equal(f.writes.at(-1).data.enabled, false);
    assert.ok(f.calls.includes('unsubscribe'));
    f.close();
}

// A quick second click cannot reconnect while the previous endpoint is being removed.
{
    const f = fixture(); await f.run('enableDriverPushSubscription()');
    let release;
    f.registration.pushManager.getSubscription = async () => ({ unsubscribe: () => new Promise(resolve => { release = resolve; }) });
    const disabling = f.run('toggleOrderAlerts()');
    await until(() => Boolean(release));
    assert.equal(f.get('driver-order-alerts-toggle').disabled, true);
    const count = f.writes.length;
    await f.run('toggleOrderAlerts()');
    assert.equal(f.run('orderAlertsEnabled'), false);
    assert.equal(f.writes.length, count);
    release(true); await disabling;
    assert.equal(f.writes.at(-1).data.enabled, false);
    f.close();
}

// A slow response from the old account cannot overwrite the new account's registration.
{
    const f = fixture(); let release;
    f.fail.token = () => new Promise(resolve => { release = resolve; });
    const first = f.run('enableDriverPushSubscription()');
    await until(() => Boolean(release));
    f.select('new-account', '80'); delete f.fail.token;
    await f.run('enableDriverPushSubscription()');
    release('stale-token'); await first;
    await until(() => f.run('driverPushState') === 'enabled');
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].data.uid, 'new-account');
    assert.equal(f.writes[0].data.driverId, '80'); assert.notEqual(f.writes[0].data.token, 'stale-token');
    f.close();
}
{
    const f = fixture({ timeout: 15 }); let release;
    f.fail.token = () => new Promise(resolve => { release = resolve; });
    await f.run('enableDriverPushSubscription()');
    assert.match(f.get('driver-order-alerts-diagnostic').textContent, /регистрация в Firebase.*push\/timeout/);
    release('late-token'); await tick(); assert.equal(f.writes.length, 0);
    assert.equal(f.get('driver-order-alerts-retry').disabled, false);
    f.close();
}
console.log('PASS: push migration, card/account changes, retry UI, permission gesture, staged errors, disconnect, races and timeouts');
