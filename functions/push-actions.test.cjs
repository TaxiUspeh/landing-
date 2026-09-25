const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPushActions, TEST_DELAY_MS } = require('./push-actions');

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const stamp = value => ({ toMillis: () => value });
const snapshot = (ref, value) => ({ ref, exists: value !== undefined, data: () => value });
function fixture() {
  const records = new Map([
    ['driverPushTokens/phone', { uid: 'driver-a', driverId: '32', enabled: true, token: 'token-a' }],
    ['driverPushTokens/other', { uid: 'driver-b', driverId: '53', enabled: true, token: 'token-b' }],
    ['driverAccounts/driver-a', { active: true, driverId: '32' }],
    ['drivers/32', { status: 'active', authUid: 'driver-a' }]
  ]);
  const messages = [], delays = [], targets = [];
  let clock = 1000000, sendError, multicastResults, afterDelay;
  let queue = Promise.resolve();
  const db = {
    doc(path) { return { path, get: async () => snapshot(db.doc(path), records.get(path)),
      set: async (data, options) => records.set(path, options?.merge ? { ...records.get(path), ...data } : data) }; },
    getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
    runTransaction(fn) {
      const operation = queue.then(async () => {
        const writes = [];
        const result = await fn({ get: ref => ref.get(),
          set: (ref, value) => writes.push(() => records.set(ref.path, value)),
          delete: ref => writes.push(() => records.delete(ref.path)) });
        writes.forEach(write => write()); return result;
      });
      queue = operation.catch(() => {}); return operation;
    }
  };
  const actions = createPushActions({ db, HttpsError, Timestamp: { fromMillis: stamp },
    logger: { info() {}, warn() {} }, now: () => clock,
    delay: async ms => { delays.push(ms); if (afterDelay) afterDelay(); },
    messaging: {
      send: async message => { if (sendError) throw sendError; messages.push(message); return 'message-1'; },
      sendEachForMulticast: async message => { messages.push(message); const responses = multicastResults || message.tokens.map(() => ({ success: true }));
        return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length }; }
    },
    eligibleSubscriptions: async uid => {
      targets.push(uid);
      return [...records].filter(([path, data]) => path.startsWith('driverPushTokens/') && (!uid || data.uid === uid) && data.enabled)
        .map(([path, data]) => snapshot(db.doc(path), data));
    }
  });
  const after = { status: 'accepted', assignedDriverUid: 'driver-a', assignmentSource: 'dispatcher', acceptedAt: stamp(777) };
  records.set('orders/order-1', after);
  return { ...actions, records, messages, delays, targets,
    request: { auth: { uid: 'driver-a' }, data: { subscriptionId: 'phone' } },
    event: { id: 'event-1', params: { orderId: 'order-1' }, data: {
      before: { data: () => ({ status: 'searching', assignedDriverUid: '' }) }, after: { data: () => after } } },
    advance: ms => { clock += ms; }, failSend: error => { sendError = error; },
    setResults: value => { multicastResults = value; }, afterDelay: fn => { afterDelay = fn; }
  };
}

test('test push targets only the authenticated device after a server delay and never creates orders', async () => {
  const f = fixture();
  const result = await f.sendTest(f.request);
  assert.equal(result.accepted, true); assert.ok(result.testId);
  assert.deepEqual(f.delays, [TEST_DELAY_MS]); assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].token, 'token-a'); assert.equal(f.messages[0].data.type, 'push_test');
  assert.equal(f.messages[0].data.orderId, undefined);
  assert.equal([...f.records.keys()].filter(k => k.startsWith('orders/')).length, 1);
});
test('authentication, ownership, active card and path validation are enforced', async () => {
  for (const modify of [
    f => { f.request.auth = null; },
    f => { f.request.data.subscriptionId = 'other'; },
    f => { f.request.data.subscriptionId = '../other'; },
    f => { f.records.get('drivers/32').authUid = 'other-user'; },
    f => { f.records.get('driverAccounts/driver-a').active = false; },
    f => { f.records.get('driverAccounts/driver-a').driverId = '53'; },
    f => { f.records.get('driverPushTokens/phone').enabled = false; }
  ]) {
    const f = fixture(); modify(f); await assert.rejects(f.sendTest(f.request), HttpsError);
    assert.equal(f.messages.length, 0); assert.equal(f.delays.length, 0);
  }
});
test('parallel tests share a server cooldown, which expires after a minute', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.sendTest(f.request), f.sendTest(f.request)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'resource-exhausted');
  f.advance(60001); await f.sendTest(f.request); assert.equal(f.messages.length, 2);
});
test('disabling or rebinding during the delay cancels the send', async () => {
  for (const change of [f => { f.records.get('driverPushTokens/phone').enabled = false; },
    f => { f.records.get('drivers/32').authUid = 'replacement-user'; }]) {
    const f = fixture(); f.afterDelay(() => change(f));
    await assert.rejects(f.sendTest(f.request), HttpsError); assert.equal(f.messages.length, 0);
  }
});
test('invalid tokens require reconnection; raw FCM errors are not returned', async () => {
  const f = fixture(); f.failSend({ code: 'messaging/registration-token-not-registered', message: 'private-token' });
  await assert.rejects(f.sendTest(f.request), error => error.code === 'failed-precondition' && !error.message.includes('private-token'));
  assert.equal(f.records.has('driverPushTokens/phone'), false);
});
test('existing order assignment targets the selected driver once across duplicate events', async () => {
  const f = fixture(); await f.notifyAssignment(f.event); await f.notifyAssignment(f.event);
  assert.equal(f.messages.length, 1); assert.deepEqual(f.messages[0].tokens, ['token-a']);
  assert.equal(f.messages[0].data.type, 'order_assigned'); assert.match(f.messages[0].data.url, /order=order-1/);
  assert.deepEqual(Object.keys(f.messages[0].data).sort(), ['body','orderId','title','type','url']);
});
test('status edits, self acceptance and stale assignments do not notify', async () => {
  for (const change of [
    f => { f.event.data.before.data = () => ({ ...f.event.data.after.data() }); },
    f => { f.event.data.after.data().assignmentSource = 'driver'; },
    f => { f.records.set('orders/order-1', { ...f.event.data.after.data(), status: 'cancelled' }); },
    f => { f.records.set('orders/order-1', { ...f.event.data.after.data(), assignedDriverUid: 'driver-b' }); },
    f => { f.records.set('orders/order-1', { ...f.event.data.after.data(), acceptedAt: stamp(999) }); }
  ]) {
    const f = fixture(); change(f); await f.notifyAssignment(f.event); assert.equal(f.messages.length, 0);
  }
});
test('partial retries skip already sent tokens and deduplicate device records', async () => {
  const f = fixture();
  f.records.set('driverPushTokens/duplicate', { ...f.records.get('driverPushTokens/phone') });
  f.records.set('driverPushTokens/tablet', { ...f.records.get('driverPushTokens/phone'), token: 'tablet-token' });
  f.setResults([{ success: true }, { success: false, error: { code: 'messaging/internal-error' } }]);
  await assert.rejects(f.notifyAssignment(f.event));
  assert.deepEqual(f.messages[0].tokens, ['token-a', 'tablet-token']);
  f.setResults([{ success: true }]); await f.notifyAssignment(f.event);
  assert.deepEqual(f.messages[1].tokens, ['tablet-token']);
});

function priceEvent(f, revision = 1, oldPrice = 4000, newPrice = 4500) {
  const after = {status:'searching',customerIncreasedPrice:true,priceRevision:revision,priceAmount:newPrice};
  f.records.set('orders/order-1', after);
  return {id:`price-${revision}`,params:{orderId:'order-1'},data:{before:{data:()=>({status:'searching',priceRevision:revision-1,priceAmount:oldPrice})},after:{data:()=>after}}};
}
test('price increase notifications target all drivers, deduplicate and suppress stale or accepted events',async()=>{
  const f=fixture(),e=priceEvent(f);await f.notifyPriceIncrease(e);await f.notifyPriceIncrease(e);assert.equal(f.messages.length,1);assert.equal(f.messages[0].data.type,'order_price_increased');assert.deepEqual(f.targets,['','']);
  f.records.get('orders/order-1').status='accepted';await f.notifyPriceIncrease(e);assert.equal(f.messages.length,1);
  const newer=priceEvent(f,2,4500,5000);await f.notifyPriceIncrease(newer);assert.equal(f.messages.length,1,'cooldown suppresses rapid repeats');
  f.advance(60001);const latest=priceEvent(f,3,5000,5500);await f.notifyPriceIncrease(e);assert.equal(f.messages.length,1);await f.notifyPriceIncrease(latest);assert.equal(f.messages.length,2);
});

test('sober expense confirmation notifies once, only while still searching, never on pending expenses', async () => {
  const f=fixture();
  const before={serviceType:'soberDriver',status:'searching',priceAmount:5000,soberFare:{schemaVersion:1,pickupAmount:null,returnAmount:null}};
  const after={...before,soberFare:{schemaVersion:1,pickupAmount:800,returnAmount:1200}};
  const event={id:'sober-event',params:{orderId:'order-1'},data:{before:{data:()=>before},after:{data:()=>after}}};
  f.records.set('orders/order-1',after);
  await f.notifySoberReady(event);await f.notifySoberReady(event);
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].data.type,'new_order');assert.equal(f.targets[0],'');
  const closed=fixture();closed.records.set('orders/order-1',{...after,status:'cancelled'});await closed.notifySoberReady(event);assert.equal(closed.messages.length,0);
  const pending=fixture();pending.records.set('orders/order-1',before);await pending.notifySoberReady(event);assert.equal(pending.messages.length,0);
  const noChange=fixture();noChange.records.set('orders/order-1',after);await noChange.notifySoberReady({...event,data:{before:{data:()=>after},after:{data:()=>after}}});assert.equal(noChange.messages.length,0);
});
