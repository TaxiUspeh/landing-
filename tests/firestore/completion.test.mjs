import { complete } from './completion-fixture.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp, Timestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';

const projectId = 'demo-taxi-rules-check';
const fixed = await readFile('../../firestore.rules', 'utf8');
const config = rules => ({ projectId, firestore: { host: '127.0.0.1', port: 8088, rules } });
let env;
let passed = 0;
async function check(name, fn) { await fn(); console.log(`PASS: ${name}`); passed++; }
async function seed(status = 'arrived', extra = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const time = Timestamp.fromMillis(Date.now() - 86400000);
    await Promise.all([
      setDoc(doc(db, 'driverAccounts', 'driver-a'), { driverId: 'd-a', active: true }),
      setDoc(doc(db, 'driverAccounts', 'driver-b'), { driverId: 'd-b', active: true }),
      setDoc(doc(db, 'drivers', 'd-a'), { driverNumber: 1, balance: -500, status: 'active' }),
      setDoc(doc(db, 'drivers', 'd-b'), { driverNumber: 2, balance: -500, status: 'active' }),
      setDoc(doc(db, 'driverStates', 'driver-a'), { driverId: 'd-a', status: 'busy', activeOrderId: 'order-a', lastSeen: time, updatedAt: time }),
      setDoc(doc(db, 'driverStates', 'driver-b'), { driverId: 'd-b', status: 'available', activeOrderId: '', lastSeen: time, updatedAt: time }),
      setDoc(doc(db, 'orders', 'order-a'), { clientUid: 'client-a', orderNumber: 'TEST-1', serviceType: 'taxi', status, assignedDriverUid: 'driver-a', assignedDriverId: 'd-a', priceAmount: 1100, updatedAt: time, ...extra })
    ]);
  });
}
function driverDb(uid = 'driver-a') { return env.authenticatedContext(uid).firestore(); }


try {
  env = await initializeTestEnvironment(config(fixed));
  await seed();
  await check('assigned driver can check missing commission', async () => assert.equal((await assertSucceeds(getDoc(doc(driverDb(), 'balanceHistory', 'order-a')))).exists(), false));
  await check('other driver and client cannot check this missing commission', async () => {
    await assertFails(getDoc(doc(driverDb('driver-b'), 'balanceHistory', 'order-a')));
    await assertFails(getDoc(doc(driverDb('client-a'), 'balanceHistory', 'order-a')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'balanceHistory', 'order-a')));
  });
  await check('arrived order completes atomically despite old heartbeat', async () => {
    await assertSucceeds(complete(driverDb()));
    const db = driverDb();
    assert.equal((await getDoc(doc(db, 'orders', 'order-a'))).data().status, 'completed');
    assert.equal((await getDoc(doc(db, 'drivers', 'd-a'))).data().balance, -280);
    assert.equal((await getDoc(doc(db, 'balanceHistory', 'order-a'))).data().commissionAmount, 220);
    assert.equal((await getDoc(doc(db, 'driverStates', 'driver-a'))).data().activeOrderId, '');
  });
  await check('commission cannot be charged twice or edited', async () => {
    await assert.rejects(complete(driverDb()), /already recorded/);
    await assertFails(updateDoc(doc(driverDb(), 'balanceHistory', 'order-a'), { commissionAmount: 0 }));
    await assertFails(updateDoc(doc(driverDb(), 'drivers', 'd-a'), { balance: -60, updatedAt: serverTimestamp() }));
  });
  await check('history queries remain private and working', async () => {
    assert.equal((await assertSucceeds(getDocs(query(collection(driverDb(), 'balanceHistory'), where('driverId', '==', 'd-a'))))).size, 1);
    await assertFails(getDocs(collection(driverDb(), 'balanceHistory')));
    await assertFails(getDoc(doc(driverDb('driver-b'), 'balanceHistory', 'order-a')));
  });
  for (const omit of ['history', 'balance', 'state']) {
    await seed();
    await check(`completion without ${omit} is denied`, () => assertFails(complete(driverDb(), { omit })));
  }
  await seed();
  await check('incorrect commission is denied', () => assertFails(complete(driverDb(), { commission: 1 })));
  await seed('in_trip');
  await check('in-trip order also completes', () => assertSucceeds(complete(driverDb())));
  await seed('arrived', { cancellationRequestStatus: 'pending' });
  await check('pending client cancellation still blocks completion', () => assertFails(complete(driverDb())));
  await seed();
  await check('another driver cannot complete the assigned order', () => assertFails(complete(driverDb('driver-b'))));
  await seed('arrived', { serviceType: 'auction', auctionRound: 1, proposedPrice: 3000, priceAmount: 3500 });
  await check('auction commission uses agreed 3500, not proposed 3000', async () => {
    await assertSucceeds(complete(driverDb(), { commission: 700 }));
    assert.equal((await getDoc(doc(driverDb(), 'drivers', 'd-a'))).data().balance, 200);
    await assert.rejects(complete(driverDb(), { commission: 700 }), /already recorded/);
  });
  console.log(`ALL ${passed} COMPLETION CHECKS PASSED`);
} finally {
  await env?.cleanup();
}
