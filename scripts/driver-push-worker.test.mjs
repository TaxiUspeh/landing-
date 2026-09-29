import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
function fixture() {
    const handlers = {}; const notifications = []; const opened = []; let background;
    const context = vm.createContext({
        URL, console, importScripts() {},
        firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: fn => { background = fn; } }) },
        self: {
            registration: { scope:'https://example.test/landing-/', showNotification: async (...args) => notifications.push(args),
                getNotifications: async ({tag}) => notifications.filter(([,options]) => options.tag === tag) },
            addEventListener: (name, fn) => { handlers[name] = fn; },
            clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }
        }
    });
    vm.runInContext(source, context);
    return { handlers, notifications, opened, receive: payload => background(payload) };
}
test('background order data produces one visible notification linked to its order', async () => {
    const f = fixture();
    await f.receive({ data: { orderId:'order-7', title:'Новый онлайн-заказ', body:'Откройте кабинет', url:'./drivers.html?order=order-7#driver-online-orders' } });
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0][1].tag, 'taxi-uspeh-order-order-7');
    let completion; let closed = false; let stopped = false;
    f.handlers.notificationclick({ notification: { data:f.notifications[0][1].data, close:()=>{closed=true;} },
        stopImmediatePropagation:()=>{stopped=true;}, waitUntil:promise=>{completion=promise;} });
    await completion;
    assert.ok(closed && stopped);
    assert.deepEqual(f.opened, ['https://example.test/landing-/drivers.html?order=order-7#driver-online-orders']);
});
test('FCM notification payloads are not displayed twice and keep the SDK click handler', async () => {
    const f = fixture();
    await f.receive({ notification: { title:'Контрольный пуш', body:'Проверка доставки' }, data:{url:'./drivers.html'} });
    assert.equal(f.notifications.length, 0, 'FCM itself displays notification payloads');
    f.handlers.notificationclick({ notification:{data:{FCM_MSG:{notification:{title:'test'}}}},
        stopImmediatePropagation:()=>assert.fail('Do not swallow the Firebase click'), waitUntil:()=>assert.fail('Firebase owns this click') });
});
test('test push uses a separate tag and opens notification settings', async () => {
    const f = fixture();
    await f.receive({ data: { type:'push_test', title:'Тестовый пуш', url:'./drivers.html#driver-order-alerts' } });
    assert.equal(f.notifications[0][1].tag, 'taxi-uspeh-push-test');
    assert.match(f.notifications[0][1].data.url, /driver-order-alerts/);
});
test('passenger request push is fresh, deduplicated and linked to the request', async () => {
    const f = fixture();
    const data = { type:'passenger_request', requestId:'r1', orderId:'passenger_request_r1', createdAt:String(Date.now()),
        url:'./drivers.html?carpool=1&request=r1#driver-online-orders' };
    await f.receive({data});
    await f.receive({data});
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0][1].renotify, false);
    assert.equal(f.notifications[0][1].tag, 'taxi-uspeh-order-passenger_request_r1');
    let completion;
    f.handlers.notificationclick({notification:{data:f.notifications[0][1].data,close(){}},stopImmediatePropagation(){},waitUntil:p=>{completion=p;}});
    await completion;
    assert.equal(f.opened[0], 'https://example.test/landing-/drivers.html?carpool=1&request=r1#driver-online-orders');
    await f.receive({data:{...data, orderId:'expired',createdAt:String(Date.now()-360000)}});
    await f.receive({data:{...data, orderId:'future',createdAt:String(Date.now()+120000)}});
    assert.equal(f.notifications.length, 1);
});
