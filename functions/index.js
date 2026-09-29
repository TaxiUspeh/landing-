const { logger } = require('firebase-functions');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { createPushActions, soberExpensesReady } = require('./push-actions');

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 2 });

const db = getFirestore();
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);
const DRIVER_PORTAL_URL = 'https://taxiuspeh.github.io/landing-/drivers.html';

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function eligibleDriverPushSubscriptions(targetDriverUid = '', order = null, acceptsDriver = () => true) {
  const { eligiblePushDevice } = await import('./driver-services.mjs');
  const tokenSnapshot = await db.collection('driverPushTokens').where('enabled', '==', true).get();
  if (tokenSnapshot.empty) return [];

  const accountRefs = new Map();
  for (const snapshot of tokenSnapshot.docs) {
    const uid = String(snapshot.data().uid || '');
    if (uid) accountRefs.set(uid, db.doc(`driverAccounts/${uid}`));
  }
  const accountSnapshots = accountRefs.size ? await db.getAll(...accountRefs.values()) : [];
  const accountsByUid = new Map(accountSnapshots.filter(snapshot => snapshot.exists).map(snapshot => [snapshot.id, snapshot.data()]));

  const driverRefs = new Map();
  for (const account of accountsByUid.values()) {
    const driverId = String(account.driverId || '');
    if (driverId) driverRefs.set(driverId, db.doc(`drivers/${driverId}`));
  }
  const driverSnapshots = driverRefs.size ? await db.getAll(...driverRefs.values()) : [];
  const driversById = new Map(driverSnapshots.filter(snapshot => snapshot.exists).map(snapshot => [snapshot.id, snapshot.data()]));

  return tokenSnapshot.docs.filter(snapshot => {
    const subscription = snapshot.data();
    const uid = String(subscription.uid || '');
    const driverId = String(subscription.driverId || '');
    const account = accountsByUid.get(uid);
    const driver = driversById.get(driverId);
    return eligiblePushDevice(subscription, account, driver, targetDriverUid, order) && acceptsDriver(driver);
  });
}

exports.notifyDriversOfNewOnlineOrder = onDocumentCreated('orders/{orderId}', async event => {
  const order = event.data?.data();
  if (!order || (order.serviceType === 'soberDriver' && order.soberFare && !soberExpensesReady(order))) return;

  const sendToAllDrivers = order.status === 'searching'
    && ['online', 'dispatcher'].includes(order.source);
  const assignedDriverUid = String(order.assignedDriverUid || '');
  const sendToAssignedDriver = order.source === 'dispatcher'
    && order.status === 'accepted'
    && order.assignmentSource === 'dispatcher'
    && assignedDriverUid;
  if (!sendToAllDrivers && !sendToAssignedDriver) return;

  const subscriptions = await eligibleDriverPushSubscriptions(sendToAssignedDriver ? assignedDriverUid : '', order);
  if (!subscriptions.length) {
    logger.info('Нет активных устройств для пуша заказа.', { orderId: event.params.orderId });
    return;
  }

  const orderId = String(event.params.orderId);
  const url = `${DRIVER_PORTAL_URL}?order=${encodeURIComponent(orderId)}#driver-online-orders`;
  const message = {
    data: {
      type: 'new_order',
      orderId,
      title: sendToAssignedDriver
        ? 'Диспетчер назначил заказ'
        : order.source === 'dispatcher' ? 'Новый заказ от диспетчера' : 'Новый онлайн-заказ',
      body: order.serviceType === 'cargo' ? 'Грузоперевозка: откройте кабинет, чтобы посмотреть маршрут и цену.' : 'Откройте кабинет, чтобы посмотреть маршрут и цену.',
      url
    },
    webpush: {
      headers: { TTL: '300', Urgency: 'high' },
      fcmOptions: { link: url }
    }
  };

  const invalidSubscriptions = [];
  for (const group of chunks(subscriptions, 500)) {
    const response = await getMessaging().sendEachForMulticast({
      ...message,
      tokens: group.map(snapshot => snapshot.data().token)
    });
    response.responses.forEach((result, index) => {
      if (!result.success && INVALID_TOKEN_CODES.has(result.error?.code)) invalidSubscriptions.push(group[index].ref);
    });
    logger.info('Пуш заказа обработан.', {
      orderId,
      delivery: sendToAssignedDriver ? 'assigned_driver' : 'all_drivers',
      sent: response.successCount,
      failed: response.failureCount
    });
  }
  if (invalidSubscriptions.length) await Promise.all(invalidSubscriptions.map(ref => ref.delete()));
});

const pushActions = createPushActions({ db, messaging: getMessaging(), Timestamp, HttpsError, logger,
  eligibleSubscriptions: eligibleDriverPushSubscriptions });
exports.sendDriverTestPush = onCall({ timeoutSeconds: 60 }, pushActions.sendTest);
exports.notifyDriversOfOrderAssignment = onDocumentUpdated(
  { document: 'orders/{orderId}', retry: true, timeoutSeconds: 60 }, pushActions.notifyAssignment
);

exports.notifyDriversOfPriceIncrease = onDocumentUpdated(
  { document: 'orders/{orderId}', retry: true, timeoutSeconds: 60 }, pushActions.notifyPriceIncrease
);

exports.notifyDriversOfSoberReady = onDocumentUpdated(
  { document: 'orders/{orderId}', retry: true, timeoutSeconds: 60 }, pushActions.notifySoberReady
);

const { createCarpoolActions } = require('./carpool.cjs');
const carpoolActions = createCarpoolActions({ db, Timestamp, HttpsError });
exports.carpoolCommand = onCall({ timeoutSeconds: 60 }, carpoolActions.command);


const { carpoolBookingMessage, createPassengerRequestPush } = require('./carpool-push.cjs');
exports.notifyDriversOfPassengerRequest = onDocumentCreated(
  { document: 'passenger_requests/{requestId}', retry: true, timeoutSeconds: 60 },
  createPassengerRequestPush({ db, messaging: getMessaging(), Timestamp, eligibleSubscriptions: eligibleDriverPushSubscriptions })
);
exports.notifyCarpoolBooking = onDocumentWritten({ document: 'carpoolBookings/{bookingId}', retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  const data = carpoolBookingMessage(before, after, event.params.bookingId);
  if (!data) return;
  const subscriptions = await eligibleDriverPushSubscriptions(after.driverUid);
  for (const group of chunks(subscriptions, 500)) {
    const response = await getMessaging().sendEachForMulticast({ data, tokens: group.map(s => s.data().token), webpush: { headers: { TTL: '300', Urgency: 'high' }, fcmOptions: { link: data.url } } });
    await Promise.all(response.responses.map((r, i) => !r.success && INVALID_TOKEN_CODES.has(r.error?.code) ? group[i].ref.delete() : null));
    if (response.responses.some(r => !r.success && !INVALID_TOKEN_CODES.has(r.error?.code))) throw new Error('Carpool push temporarily unavailable');
  }
});
exports.pauseCarpoolWhenDriverDisabled = onDocumentUpdated('drivers/{driverId}', async event => {
  const driver = event.data?.after.data();
  if (!driver?.carpoolActiveTripId || (driver.status === 'active' && driver.carpoolEnabled === true && driver.passengerEnabled !== false && (driver.passengerStatus || 'active') === 'active')) return;
  await db.runTransaction(async tx => {
    const fresh = (await tx.get(db.doc(`drivers/${event.params.driverId}`))).data();
    if (!fresh?.carpoolActiveTripId || (fresh.status === 'active' && fresh.carpoolEnabled === true && fresh.passengerEnabled !== false && (fresh.passengerStatus || 'active') === 'active')) return;
    const ref = db.doc(`carpoolTrips/${fresh.carpoolActiveTripId}`);
    const trip = (await tx.get(ref)).data();
    if (trip?.status === 'open') tx.update(ref, { status: 'closed', closedReason: 'access', updatedAt: Timestamp.now() });
  });
});
