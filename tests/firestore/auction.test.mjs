import { complete } from './completion-fixture.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { selectAuctionOffer, auctionOfferId } from '../../auction-core.js';
const { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, writeBatch, serverTimestamp, Timestamp } = sdk;
const env = await initializeTestEnvironment({ projectId: 'demo-taxi-rules-check', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile('../../firestore.rules', 'utf8') } });
const db = uid => env.authenticatedContext(uid).firestore();
let passed = 0;
async function test(name, run) { await seed(); await run(); console.log(`PASS: ${name}`); passed++; }
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const batch = writeBatch(ctx.firestore());
    for (const who of ['a', 'b']) {
      batch.set(doc(ctx.firestore(), 'driverAccounts', `driver-${who}`), { driverId: `d-${who}`, active: true });
      batch.set(doc(ctx.firestore(), 'drivers', `d-${who}`), { driverNumber: who === 'a' ? 1 : 2, name: `Driver ${who}`, phone: '+77000000000', car: 'Test car', color: 'White', status: 'active', balance: -500 });
      batch.set(doc(ctx.firestore(), 'driverStates', `driver-${who}`), { driverId: `d-${who}`, status: 'available', activeOrderId: '', lastSeen: Timestamp.now(), updatedAt: Timestamp.now() });
    }
    await batch.commit();
  });
  await createOrder('order-a', 'client-a');
}
async function createOrder(id, uid, overrides = {}) {
  const database = db(uid), batch = writeBatch(database);
  batch.set(doc(database, 'orders', id), {
    orderNumber: 'TU-TEST', serviceType: 'auction', source: 'online', clientUid: uid,
    fromAddress: 'A', toAddress: 'B', stops: [], wishes: '', scheduledFor: '', direction: '',
    proposedPrice: 3000, priceAmount: 3000, priceText: '3000 ₸', auctionRound: 1, status: 'bidding',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides
  });
  batch.set(doc(database, 'orderContacts', id), { clientUid: uid, customerName: 'Client', customerPhone: '+77000000000', passengerPhone: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return batch.commit();
}
function offerData(who = 'a', orderId = 'order-a', overrides = {}) {
  return { orderId, driverUid: `driver-${who}`, driverId: `d-${who}`, driverName: `Driver ${who}`, driverPhone: '+77000000000', driverCar: 'Test car', driverColor: 'White', priceAmount: 3500, arrivalMinutes: 5, round: 1, status: 'active', expiresAt: Timestamp.fromMillis(Date.now() + 120000), updatedAt: serverTimestamp(), ...overrides };
}
const offerRef = (database, who = 'a', id = 'order-a') => doc(database, 'auctionOffers', auctionOfferId(id, `driver-${who}`));
async function offer(who = 'a', id = 'order-a', overrides = {}) {
  await setDoc(offerRef(db(`driver-${who}`), who, id), offerData(who, id, overrides));
  return (await getDoc(offerRef(db(`driver-${who}`), who, id))).data();
}
const choose = (displayed, id = 'order-a', uid = 'client-a') => selectAuctionOffer(db(uid), sdk, id, displayed, uid);
const state = (values) => env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'driverStates', 'driver-a'), values));
function selectionBatch(item, patch = {}, includeState = true) {
  const database = db('client-a'), batch = writeBatch(database);
  batch.update(doc(database, 'orders', 'order-a'), {
    status: 'accepted', assignedDriverUid: item.driverUid, assignedDriverId: item.driverId,
    driverName: item.driverName, driverPhone: item.driverPhone, driverCar: item.driverCar, driverColor: item.driverColor,
    priceAmount: item.priceAmount, priceText: `${item.priceAmount} ₸`, selectedOfferId: auctionOfferId('order-a', item.driverUid), arrivalMinutes: item.arrivalMinutes,
    acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch
  });
  if (includeState) batch.update(doc(database, 'driverStates', item.driverUid), { status: 'busy', activeOrderId: 'order-a', lastSeen: serverTimestamp(), updatedAt: serverTimestamp() });
  return batch.commit();
}
try {
  await test('bidding is visible to free drivers, contacts remain private', async () => {
    assert.equal((await getDocs(query(collection(db('driver-a'), 'orders'), where('status', 'in', ['searching', 'bidding'])))).size, 1);
    await assertFails(getDoc(doc(db('driver-a'), 'orderContacts', 'order-a')));
    await assertFails(getDoc(doc(db('client-b'), 'orders', 'order-a')));
    await assertFails(createOrder('invalid', 'client-b', { status: 'searching' }));
    await assertFails(createOrder('invalid-price', 'client-b', { proposedPrice: 100, priceAmount: 100, priceText: '100 ₸' }));
  });
  await test('offers belong to their author and order owner', async () => {
    await offer(); await offer('b');
    assert.equal((await getDocs(query(collection(db('client-a'), 'auctionOffers'), where('orderId', '==', 'order-a')))).size, 2);
    assert.equal((await getDocs(query(collection(db('driver-a'), 'auctionOffers'), where('driverUid', '==', 'driver-a')))).size, 1);
    await assertFails(getDoc(offerRef(db('driver-b'))));
    await assertFails(getDocs(query(collection(db('client-b'), 'auctionOffers'), where('orderId', '==', 'order-a'))));
    await assertFails(setDoc(offerRef(db('client-a')), offerData()));
    await assertFails(setDoc(offerRef(db('driver-b')), offerData()));
  });
  await test('invalid fare, ETA, expiry and spoofed profile are denied', async () => {
    for (const patch of [{ priceAmount: 300.5 }, { arrivalMinutes: 0 }, { driverName: 'Someone else' }, { expiresAt: Timestamp.fromMillis(Date.now() + 3600000) }, { round: 0 }]) await assertFails(offer('a', 'order-a', patch));
  });
  await test('selection fixes the fare and reserves the driver atomically', async () => {
    const item = await offer();
    await assertFails(getDoc(doc(db('client-a'), 'driverStates', 'driver-a')));
    await assertSucceeds(choose(item));
    const order = (await getDoc(doc(db('client-a'), 'orders', 'order-a'))).data();
    assert.equal(order.priceAmount, 3500); assert.equal(order.proposedPrice, 3000); assert.equal(order.status, 'accepted');
    assert.equal((await getDoc(doc(db('driver-a'), 'driverStates', 'driver-a'))).data().activeOrderId, 'order-a');
    await assertSucceeds(getDoc(doc(db('driver-a'), 'orderContacts', 'order-a')));
    await assertFails(updateDoc(doc(db('client-a'), 'orders', 'order-a'), { priceAmount: 1 }));
    await assertFails(updateDoc(doc(db('driver-a'), 'orders', 'order-a'), { priceAmount: 10000 }));
  });
  await test('price edits require review of the new offer', async () => {
    const old = await offer(); await offer('a', 'order-a', { priceAmount: 4000 });
    await assert.rejects(choose(old), /изменил предложение/);
    await assertFails(selectionBatch(old));
    await assertSucceeds(choose((await getDoc(offerRef(db('client-a')))).data()));
  });
  await test('withdrawn, expired, offline and busy offers cannot be selected', async () => {
    const item = await offer();
    await updateDoc(offerRef(db('driver-a')), { status: 'withdrawn', updatedAt: serverTimestamp() });
    await assertFails(selectionBatch(item)); await offer();
    for (const values of [{ status: 'busy', activeOrderId: 'other' }, { status: 'offline', activeOrderId: '' }, { status: 'available', activeOrderId: '', lastSeen: Timestamp.fromMillis(Date.now() - 300000) }]) {
      await state(values); await assertFails(selectionBatch(item));
    }
    await state({ status: 'available', activeOrderId: '', lastSeen: Timestamp.now() });
    await env.withSecurityRulesDisabled(ctx => updateDoc(offerRef(ctx.firestore()), { expiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
    await assertFails(selectionBatch(item));
  });
  await test('partial selection and direct acceptance cannot bypass negotiation', async () => {
    const item = await offer();
    await assertFails(selectionBatch(item, { priceAmount: 1, priceText: '1 ₸' }));
    await assertFails(selectionBatch(item, {}, false));
    await assertFails(updateDoc(doc(db('client-a'), 'driverStates', 'driver-a'), { status: 'busy', activeOrderId: 'order-a', lastSeen: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('driver-a'), 'orders', 'order-a'), { status: 'accepted', assignedDriverUid: 'driver-a', assignedDriverId: 'd-a', driverName: 'Driver a', driverPhone: '+77000000000', driverCar: 'Test car', driverColor: 'White', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  await test('two clients cannot select one driver concurrently', async () => {
    await createOrder('order-b', 'client-b');
    const a = await offer(), b = await offer('a', 'order-b');
    const results = await Promise.allSettled([choose(a), choose(b, 'order-b', 'client-b')]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  });
  await test('two offers for one order cannot both win', async () => {
    const a = await offer(), b = await offer('b');
    const results = await Promise.allSettled([choose(a), choose(b)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  });
  await test('cancellation closes bidding and blocks offers', async () => {
    const item = await offer();
    await updateDoc(doc(db('client-a'), 'orders', 'order-a'), { status: 'cancelled', cancelledBy: 'client', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(selectionBatch(item)); await assertFails(offer());
  });
  await test('return to search requires a new round and fresh offers', async () => {
    await offer('b'); await choose(await offer());
    const database = db('driver-a'), batch = writeBatch(database);
    batch.update(doc(database, 'orders', 'order-a'), { status: 'bidding', assignedDriverUid: '', assignedDriverId: '', driverName: '', driverPhone: '', driverCar: '', driverColor: '', auctionRound: 2, selectedOfferId: '', arrivalMinutes: 0, priceAmount: 3000, priceText: '3000 ₸', requeueReason: 'car_issue', requeuedBy: 'driver', requeuedByDriverId: 'd-a', requeuedAt: serverTimestamp(), requeueCount: 1, updatedAt: serverTimestamp() });
    batch.update(doc(database, 'driverStates', 'driver-a'), { status: 'available', activeOrderId: '', lastSeen: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
    await assertFails(selectionBatch((await getDoc(offerRef(db('client-a'), 'b'))).data()));
    await assertSucceeds(choose(await offer('b', 'order-a', { round: 2 })));
  });
  await test('selected auction arrives, completes, charges 20% once and frees the driver', async () => {
    await choose(await offer());
    await updateDoc(doc(db('driver-a'), 'orders', 'order-a'), { status: 'arrived', updatedAt: serverTimestamp() });
    await assertSucceeds(complete(db('driver-a'), { commission: 700 }));
    assert.equal((await getDoc(doc(db('driver-a'), 'drivers', 'd-a'))).data().balance, 200);
    assert.equal((await getDoc(doc(db('driver-a'), 'driverStates', 'driver-a'))).data().status, 'available');
    await assert.rejects(complete(db('driver-a'), { commission: 700 }), /already recorded/);
    await createOrder('order-b', 'client-b');
    await assertSucceeds(choose(await offer('a', 'order-b'), 'order-b', 'client-b'));
  });
  console.log(`ALL ${passed} AUCTION CHECKS PASSED`);
} finally { await env.cleanup(); }
