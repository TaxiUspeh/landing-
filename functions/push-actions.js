const { createHash, randomUUID } = require('node:crypto');

const PORTAL_URL = 'https://taxiuspeh.github.io/landing-/drivers.html';
const TEST_DELAY_MS = 10000;
const TEST_COOLDOWN_MS = 60000;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token', 'messaging/registration-token-not-registered'
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const millis = value => value?.toMillis?.() ?? 0;

function isDispatcherAssignment(before, after) {
  return Boolean(after?.status === 'accepted' && after.assignmentSource === 'dispatcher'
    && typeof after.assignedDriverUid === 'string' && after.assignedDriverUid
    && (before?.assignedDriverUid !== after.assignedDriverUid
      || before?.status !== 'accepted' || before?.assignmentSource !== 'dispatcher'));
}

function createPushActions({ db, messaging, Timestamp, HttpsError, logger, eligibleSubscriptions,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  async function ownSubscription(uid, subscriptionId) {
    const ref = db.doc(`driverPushTokens/${subscriptionId}`);
    const snapshot = await ref.get();
    const subscription = snapshot.data();
    if (!snapshot.exists || subscription.uid !== uid) throw new HttpsError('permission-denied', 'Это устройство не принадлежит текущему аккаунту.');
    if (subscription.enabled !== true || typeof subscription.token !== 'string' || !subscription.token) throw new HttpsError('failed-precondition', 'Подключите уведомления ещё раз.');
    const driverId = String(subscription.driverId || '');
    if (!driverId || driverId.includes('/')) throw new HttpsError('failed-precondition', 'Проверьте карточку водителя.');
    const [accountSnapshot, driverSnapshot] = await db.getAll(db.doc(`driverAccounts/${uid}`), db.doc(`drivers/${driverId}`));
    const account = accountSnapshot.data(); const driver = driverSnapshot.data();
    if (account?.active !== true || String(account.driverId) !== driverId
      || driver?.status !== 'active' || driver.authUid !== uid) {
      throw new HttpsError('permission-denied', 'Аккаунт не привязан к активной карточке водителя.');
    }
    return { ref, ...subscription };
  }

  async function removeInvalidSubscription(ref, token) {
    // A reconnection may already have replaced this token while FCM was responding.
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists && snapshot.data().token === token) transaction.delete(ref);
    });
  }

  async function sendTest(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Войдите в кабинет водителя.');
    const subscriptionId = request.data?.subscriptionId;
    if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > 256
      || subscriptionId.includes('/') || /[\x00-\x1f]/.test(subscriptionId)) {
      throw new HttpsError('invalid-argument', 'Некорректное устройство.');
    }
    await ownSubscription(uid, subscriptionId);
    // Server-only collection: clients cannot reset the cooldown through Firestore rules.
    const limitRef = db.doc(`driverPushTestLimits/${uid}`);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(limitRef);
      const lastTestAt = snapshot.data()?.lastTestAt;
      if (lastTestAt && now() - millis(lastTestAt) < TEST_COOLDOWN_MS) {
        throw new HttpsError('resource-exhausted', 'Повторить тест можно через минуту.');
      }
      transaction.set(limitRef, { lastTestAt: Timestamp.fromMillis(now()) });
    });
    // Keep the callable open until send completes; never schedule work after returning.
    await delay(TEST_DELAY_MS);
    const subscription = await ownSubscription(uid, subscriptionId);
    const testId = randomUUID();
    try {
      await messaging.send({ token: subscription.token, data: {
        type: 'push_test', testId, title: 'Тестовое уведомление «Такси Успех»',
        body: 'Если вы видите это уведомление, пуш на это устройство получен.',
        url: `${PORTAL_URL}?pushTest=${testId}#driver-order-alerts`
      }, webpush: { headers: { TTL: '60', Urgency: 'high' } } });
    } catch (error) {
      logger.warn('Не удалось отправить тестовый пуш.', { code: error.code || 'unknown' });
      if (INVALID_TOKEN_CODES.has(error.code)) {
        await removeInvalidSubscription(subscription.ref, subscription.token);
        throw new HttpsError('failed-precondition', 'Подключите уведомления ещё раз.');
      }
      throw new HttpsError('unavailable', 'Сервис уведомлений временно недоступен.');
    }
    // FCM acceptance is not a device delivery receipt.
    return { accepted: true, testId };
  }

  async function notifyAssignment(event, priceIncrease = false) {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (priceIncrease ? !(before?.status === 'searching' && after?.status === 'searching' && after.customerIncreasedPrice === true && after.priceAmount > before.priceAmount && after.priceRevision === (before.priceRevision || 0) + 1) : !isDispatcherAssignment(before, after)) return;
    const eventTime = Date.parse(event.time || '');
    if (Number.isFinite(eventTime) && now() - eventTime > 300000) return;
    const orderId = event.params.orderId;
    const uid = priceIncrease ? '' : after.assignedDriverUid;
    const current = (await db.doc(`orders/${orderId}`).get()).data();
    if (priceIncrease ? current?.status !== 'searching' || current.priceRevision !== after.priceRevision || current.priceAmount !== after.priceAmount
      : current?.status !== 'accepted' || current.assignedDriverUid !== uid || current.assignmentSource !== 'dispatcher' || millis(current.acceptedAt) !== millis(after.acceptedAt)) return;
    const subscriptions = await eligibleSubscriptions(uid, current);
    if (!subscriptions.length) {
      logger.info('Нет устройств для пуша назначения.', { orderId });
      return;
    }
    // Firestore can redeliver one event. Track successful tokens and lease in a
    // server-only record so a retry only attempts the remaining destinations.
    const eventRef = db.doc(`driverPushDeliveries/${hash(priceIncrease ? `price:${orderId}:${after.priceRevision}` : event.id)}`);
    const limitRef = db.doc(`driverPricePushLimits/${orderId}`);
    const delivered = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(eventRef);
      const record = snapshot.data() || {};
      if (record.complete) return null;
      if (priceIncrease && !snapshot.exists) {
        const limit = (await transaction.get(limitRef)).data();
        if (limit && now() - millis(limit.lastPushAt) < 60000) return null;
        transaction.set(limitRef, { lastPushAt: Timestamp.fromMillis(now()), revision: after.priceRevision });
      }
      if (millis(record.leaseUntil) > now()) throw new Error('Push delivery is already running');
      transaction.set(eventRef, { ...record, orderId,
        leaseUntil: Timestamp.fromMillis(now() + 90000),
        expiresAt: Timestamp.fromMillis(now() + 7 * 86400000) });
      return record.delivered || [];
    });
    if (!delivered) return;
    const done = new Set(delivered);
    const unique = new Map(subscriptions.map(snapshot => [snapshot.data().token, snapshot]));
    const pending = [...unique.values()].filter(snapshot => !done.has(hash(snapshot.data().token)));
    try {
      for (let index = 0; index < pending.length; index += 500) {
        if (priceIncrease) { const latest = (await db.doc(`orders/${orderId}`).get()).data(); if (latest?.status !== 'searching' || latest.priceRevision !== after.priceRevision) break; }
        const group = pending.slice(index, index + 500);
        const response = await messaging.sendEachForMulticast({
          tokens: group.map(snapshot => snapshot.data().token),
          data: { type: priceIncrease ? 'order_price_increased' : 'order_assigned', orderId, title: priceIncrease ? 'Клиент повысил цену заказа' : 'Диспетчер назначил заказ',
            body: priceIncrease ? `Новая цена: ${after.priceAmount} ₸. Откройте кабинет, чтобы посмотреть заказ.` : 'Откройте кабинет, чтобы посмотреть маршрут и цену.',
            url: `${PORTAL_URL}?order=${encodeURIComponent(orderId)}#driver-online-orders` },
          webpush: { headers: { TTL: '300', Urgency: 'high' } }
        });
        let failed = false;
        for (let i = 0; i < response.responses.length; i += 1) {
          const result = response.responses[i]; const snapshot = group[i];
          const token = snapshot.data().token;
          if (result.success || INVALID_TOKEN_CODES.has(result.error?.code)) done.add(hash(token));
          else failed = true;
          if (INVALID_TOKEN_CODES.has(result.error?.code)) await removeInvalidSubscription(snapshot.ref, token);
        }
        await eventRef.set({ delivered: [...done] }, { merge: true });
        logger.info('Пуш назначения обработан.', { orderId, sent: response.successCount, failed: response.failureCount });
        if (failed) throw new Error('Some assignment pushes need retry');
      }
      await eventRef.set({ complete: true }, { merge: true });
    } finally {
      await eventRef.set({ leaseUntil: Timestamp.fromMillis(0) }, { merge: true });
    }
  }
  return { sendTest, notifyAssignment, notifyPriceIncrease: event => notifyAssignment(event, true) };
}

module.exports = { createPushActions, isDispatcherAssignment, TEST_DELAY_MS, TEST_COOLDOWN_MS };
