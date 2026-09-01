const { logger } = require('firebase-functions');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

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

async function eligibleDriverPushSubscriptions() {
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
    return Boolean(
      typeof subscription.token === 'string'
      && subscription.token.length > 0
      && account?.active === true
      && String(account.driverId || '') === driverId
      && driver?.status === 'active'
    );
  });
}

exports.notifyDriversOfNewOnlineOrder = onDocumentCreated('orders/{orderId}', async event => {
  const order = event.data?.data();
  if (!order || order.status !== 'searching' || order.source !== 'online') return;

  const subscriptions = await eligibleDriverPushSubscriptions();
  if (!subscriptions.length) {
    logger.info('Нет активных устройств для пуша нового заказа.', { orderId: event.params.orderId });
    return;
  }

  const orderId = String(event.params.orderId);
  const url = `${DRIVER_PORTAL_URL}?order=${encodeURIComponent(orderId)}#driver-online-orders`;
  const message = {
    data: {
      type: 'new_order',
      orderId,
      title: 'Новый онлайн-заказ',
      body: 'Откройте кабинет, чтобы посмотреть маршрут и цену.',
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
    logger.info('Пуш нового заказа обработан.', {
      orderId,
      sent: response.successCount,
      failed: response.failureCount
    });
  }
  if (invalidSubscriptions.length) await Promise.all(invalidSubscriptions.map(ref => ref.delete()));
});
