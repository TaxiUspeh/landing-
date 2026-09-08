import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { calculateCategoryFare, formatCategoryFare } from '../../vehicle-categories.js';
import { complete } from './completion-fixture.mjs';
const env = await initializeTestEnvironment({ projectId: 'demo-taxi-rules-check', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile('../../firestore.rules', 'utf8') } });
const db = uid => env.authenticatedContext(uid).firestore();
let passed = 0;
async function test(name, fn) { await seed(); await fn(); console.log(`PASS: ${name}`); passed++; }
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const database = ctx.firestore(), batch = writeBatch(database);
    batch.set(doc(database, 'admins', 'admin'), { active: true });
    for (const [who, profile] of [['a', {}], ['w', { serviceCategories: ['sedan', 'wagon'], passengerSeats: 4 }], ['m', { serviceCategories: ['sedan', 'minivan'], passengerSeats: 6 }]]) {
      batch.set(doc(database, 'driverAccounts', `driver-${who}`), { driverId: `d-${who}`, active: true });
      batch.set(doc(database, 'drivers', `d-${who}`), { driverNumber: who === 'a' ? 1 : 2, name: `Driver ${who}`, phone: '', car: '', color: '', status: 'active', balance: -500, ...profile });
      batch.set(doc(database, 'driverStates', `driver-${who}`), { driverId: `d-${who}`, status: 'available', activeOrderId: '', lastSeen: Timestamp.now(), updatedAt: Timestamp.now() });
    }
    await batch.commit();
  });
}
function orderData(category = 'wagon', passengers = 1) {
  const fare = calculateCategoryFare(800, 1000, category);
  return { orderNumber: 'TU-CATEGORY', serviceType: 'taxi', source: 'online', clientUid: 'client', fromAddress: 'A', toAddress: 'B', stops: [], wishes: '', scheduledFor: '', direction: '', vehicleCategory: category, passengerCount: passengers, basePriceMin: 800, basePriceMax: 1000, priceAmount: fare.priceMax, priceText: formatCategoryFare(fare), status: 'searching', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}
const create = (category, count, overrides = {}) => setDoc(doc(db('client'), 'orders', 'order-a'), { ...orderData(category, count), ...overrides });
async function accept(who = 'a', actingUid = `driver-${who}`, overrides = {}) {
  const database = db(actingUid), batch = writeBatch(database);
  batch.update(doc(database, 'orders', 'order-a'), { status: 'accepted', assignedDriverUid: `driver-${who}`, assignedDriverId: `d-${who}`, driverName: `Driver ${who}`, driverPhone: '', driverCar: '', driverColor: '', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides });
  batch.update(doc(database, 'driverStates', `driver-${who}`), { status: 'busy', activeOrderId: 'order-a', lastSeen: serverTimestamp(), updatedAt: serverTimestamp() });
  return batch.commit();
}
try {
  await test('only dispatcher can set category and valid seating', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'drivers', 'd-a'), { serviceCategories: ['sedan', 'wagon'], passengerSeats: 4 }));
    await assertFails(updateDoc(doc(db('driver-a'), 'drivers', 'd-a'), { serviceCategories: ['sedan', 'minivan'], passengerSeats: 8 }));
    for (const profile of [{ serviceCategories: ['sedan', 'minivan'], passengerSeats: 4 }, { serviceCategories: ['sedan', 'wagon'], passengerSeats: 9 }, { serviceCategories: ['sedan', 'helicopter'], passengerSeats: 4 }, { serviceCategories: ['sedan', 'sedan'], passengerSeats: 4 }]) await assertFails(updateDoc(doc(db('admin'), 'drivers', 'd-a'), profile));
  });
  await test('client fare must match category and rounding', async () => {
    await assertSucceeds(create('wagon', 1));
    for (const patch of [{ priceAmount: 1000 }, { priceAmount: 1300 }, { vehicleCategory: 'unknown' }, { passengerCount: 0 }, { passengerCount: 9 }, { basePriceMax: 799 }, { serviceType: 'delivery' }]) {
      await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'orders', 'order-a'), {}));
      await assertFails(setDoc(doc(db('client'), 'orders', 'invalid-' + Math.random().toString(36).slice(2)), { ...orderData(), ...patch }));
    }
    await assertSucceeds(setDoc(doc(db('client'), 'orders', 'minivan'), orderData('minivan', 7)));
  });
  await test('sedan cannot accept wagon, eligible wagon can', async () => {
    await create('wagon', 1);
    await assertFails(accept('a'));
    assert.equal((await getDoc(doc(db('driver-a'), 'driverStates', 'driver-a'))).data().status, 'available');
    await assertSucceeds(accept('w'));
    assert.equal((await getDoc(doc(db('client'), 'orders', 'order-a'))).data().priceAmount, 1200);
  });
  await test('minivan seating is checked on acceptance', async () => {
    await create('minivan', 7);
    await assertFails(accept('w')); await assertFails(accept('m'));
    await updateDoc(doc(db('admin'), 'drivers', 'd-m'), { passengerSeats: 8 });
    await assertSucceeds(accept('m'));
  });
  await test('manual assignment cannot bypass category or seating', async () => {
    await create('minivan', 7);
    await assertFails(accept('a', 'admin')); await assertFails(accept('m', 'admin'));
    await updateDoc(doc(db('admin'), 'drivers', 'd-m'), { passengerSeats: 8 });
    await assertSucceeds(accept('m', 'admin'));
  });
  await test('dispatcher-created assigned orders also check the vehicle', async () => {
    const payload = { ...orderData('wagon'), source: 'dispatcher', clientUid: '', status: 'accepted', assignedDriverUid: 'driver-a', assignedDriverId: 'd-a' };
    await assertFails(setDoc(doc(db('admin'), 'orders', 'phone-a'), payload));
    await assertSucceeds(setDoc(doc(db('admin'), 'orders', 'phone-b'), { ...payload, assignedDriverUid: 'driver-w', assignedDriverId: 'd-w' }));
  });
  await test('legacy cars keep ordinary orders and minivan may accept an ordinary fare', async () => {
    await create('sedan', 1); await assertSucceeds(accept('a'));
    await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'orders', 'order-a'), { status: 'searching', assignedDriverUid: '', assignedDriverId: '' }));
    await assertSucceeds(accept('m'));
    assert.equal((await getDoc(doc(db('client'), 'orders', 'order-a'))).data().priceAmount, 1000);
  });
  await test('legacy unclassified orders remain compatible', async () => {
    const data = orderData('sedan');
    for (const key of ['vehicleCategory', 'passengerCount', 'basePriceMin', 'basePriceMax']) delete data[key];
    await setDoc(doc(db('client'), 'orders', 'order-a'), data);
    await assertSucceeds(accept('a'));
  });
  await test('category cannot be removed or changed by a driver or client', async () => {
    await create('wagon', 1);
    await assertFails(updateDoc(doc(db('driver-a'), 'orders', 'order-a'), { vehicleCategory: 'sedan' }));
    await assertFails(updateDoc(doc(db('client'), 'orders', 'order-a'), { vehicleCategory: 'sedan', priceAmount: 1000 }));
    await updateDoc(doc(db('admin'), 'drivers', 'd-w'), { serviceCategories: ['sedan'] });
    await assertFails(accept('w'));
  });
  await test('premium trip completes and charges once even if category later removed', async () => {
    await updateDoc(doc(db('admin'), 'drivers', 'd-a'), { serviceCategories: ['sedan', 'wagon'], passengerSeats: 4 });
    await create('wagon', 1); await accept('a');
    await updateDoc(doc(db('admin'), 'drivers', 'd-a'), { serviceCategories: ['sedan'] });
    await updateDoc(doc(db('driver-a'), 'orders', 'order-a'), { status: 'arrived', updatedAt: serverTimestamp() });
    await assertSucceeds(complete(db('driver-a'), { commission: 240 }));
    assert.equal((await getDoc(doc(db('driver-a'), 'drivers', 'd-a'))).data().balance, -260);
    assert.equal((await getDoc(doc(db('driver-a'), 'driverStates', 'driver-a'))).data().status, 'available');
    await assert.rejects(complete(db('driver-a'), { commission: 240 }), /already recorded/);
  });
  console.log(`ALL ${passed} VEHICLE CATEGORY CHECKS PASSED`);
} finally { await env.cleanup(); }
