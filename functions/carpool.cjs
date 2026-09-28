const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const money = value => Math.round(value * 100) / 100;
const activeBooking = b => ['confirmed', 'in_trip', 'boarded', 'disputed'].includes(b.status);
const activeTrip = t => ['open', 'closed', 'in_trip'].includes(t.status);

// All seat, reservation and settlement changes share one server transaction.
// Admin SDK writes are protected here; clients have read-only Firestore access.
function createCarpoolActions({ db, Timestamp, HttpsError, now = () => Date.now() }) {
  const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message); };
  const text = (value, max, label, optional = false) => {
    if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) fail(`Проверьте поле «${label}».`, 'invalid-argument');
    return value.trim();
  };
  const integer = (value, min, max, label) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Проверьте поле «${label}».`, 'invalid-argument');
    return value;
  };
  const phone = value => {
    const result = text(value, 32, 'Телефон').replace(/[\s()-]/g, '');
    if (!/^\+?\d{10,15}$/.test(result)) fail('Укажите корректный телефон.', 'invalid-argument');
    return result;
  };
  const fields = (data, driver, timestamp, cityKey) => {
    const fromCity = text(data.fromCity, 100, 'Откуда'), toCity = text(data.toCity, 100, 'Куда');
    if (cityKey(fromCity) === cityKey(toCity)) fail('Выберите разные населённые пункты.');
    const departure = integer(data.departureMs, timestamp + 5 * 60000, timestamp + 30 * 86400000, 'Выезд в ближайшие 30 дней, не ранее чем через 5 минут');
    return { fromCity, toCity, fromKey: cityKey(fromCity), toKey: cityKey(toCity), departureAt: Timestamp.fromMillis(departure),
      pickup: text(data.pickup, 200, 'Место посадки'), dropoff: text(data.dropoff, 200, 'Место высадки'),
      totalSeats: integer(data.totalSeats, 1, Math.min(8, driver.passengerSeats || 4), 'Пассажирские места'),
      seatPrice: integer(data.seatPrice, 1, 1000000, 'Цена за место'), luggage: text(data.luggage || '', 300, 'Багаж', true) };
  };
  const eligible = (driver, account, uid, id) => driver?.status === 'active' && driver.authUid === uid
    && account?.active === true && String(account.driverId) === id && driver.passengerEnabled !== false
    && (driver.passengerStatus || 'active') === 'active' && driver.carpoolEnabled === true;
  async function command(request) {
    const { carpoolCityKey: cityKey } = await import('./carpool-cities.mjs');
    const uid = request.auth?.uid;
    if (!uid) fail('Войдите в приложение.', 'unauthenticated');
    const input = request.data || {}, action = input.action;
    if (!['publish', 'edit', 'book', 'cancelBooking', 'dispute', 'resolve', 'close', 'reopen', 'start', 'complete', 'cancelTrip'].includes(action)) fail('Неизвестное действие.', 'invalid-argument');
    if (typeof input.operationId !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(input.operationId)) fail('Обновите страницу и повторите действие.', 'invalid-argument');
    const receiptRef = db.doc(`carpoolOperations/${digest(uid + ':' + input.operationId)}`);
    const fingerprint = digest(JSON.stringify(input));
    return db.runTransaction(async tx => {
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data().fingerprint !== fingerprint) fail('Номер операции уже использован. Обновите данные.');
        return receipt.data().result;
      }
      const at = Timestamp.fromMillis(now());
      const adminSnap = await tx.get(db.doc(`admins/${uid}`)), admin = adminSnap.data()?.active === true;
      const finish = result => { tx.set(receiptRef, { uid, action, fingerprint, result, createdAt: at }); return result; };
      if (['publish', 'edit', 'book'].includes(action)) {
        const settings = await tx.get(db.doc('settings/carpoolBooking'));
        if (settings.data()?.schemaVersion !== 1) fail('Попутки пока не подключены. Позвоните диспетчеру.');
      }
      if (action === 'publish') {
        const account = (await tx.get(db.doc(`driverAccounts/${uid}`))).data();
        const driverId = String(account?.driverId || '');
        if (!driverId || driverId.includes('/')) fail('Карточка водителя не подключена.', 'permission-denied');
        const driverRef = db.doc(`drivers/${driverId}`), driver = (await tx.get(driverRef)).data();
        if (!eligible(driver, account, uid, driverId)) fail('Диспетчер должен включить допуск «Попутки».', 'permission-denied');
        if (driver.carpoolActiveTripId) fail('Сначала завершите или отмените текущий рейс.');
        const values = fields(input, driver, at.toMillis(), cityKey);
        const rate = integer(driver.carpoolCommissionRate ?? driver.commissionRate ?? 20, 0, 100, 'Комиссия');
        const tripId = digest(uid + ':' + input.operationId).slice(0, 32), tripRef = db.doc(`carpoolTrips/${tripId}`);
        tx.set(tripRef, { ...values, driverId, driverUid: uid, driverName: String(driver.name || 'Водитель'),
          car: [driver.car, driver.plate].filter(Boolean).join(' · '), color: String(driver.color || ''),
          availableSeats: values.totalSeats, bookedSeats: 0, bookingCount: 0, priceLocked: false,
          commissionRate: rate, reservedAmount: 0, status: 'open', closedReason: '', createdAt: at, updatedAt: at });
        tx.set(db.doc(`carpoolTripContacts/${tripId}`), { driverUid: uid, phone: phone(input.phone), updatedAt: at });
        tx.update(driverRef, { carpoolActiveTripId: tripId });
        return finish({ tripId });
      }
      const tripId = text(input.tripId, 64, 'Рейс');
      if (!/^[a-zA-Z0-9_-]+$/.test(tripId)) fail('Неверный рейс.', 'invalid-argument');
      const tripRef = db.doc(`carpoolTrips/${tripId}`), trip = (await tx.get(tripRef)).data();
      if (!trip) fail('Рейс не найден.', 'not-found');
      const owner = trip.driverUid === uid;
      const driverRef = db.doc(`drivers/${trip.driverId}`), driver = (await tx.get(driverRef)).data();
      if (!driver) fail('Карточка водителя недоступна. Обратитесь к диспетчеру.');
      const account = (await tx.get(db.doc(`driverAccounts/${trip.driverUid}`))).data();
      const stateRef = db.doc(`driverStates/${trip.driverUid}`), state = (await tx.get(stateRef)).data();
      if (['edit', 'close', 'reopen', 'start', 'complete', 'cancelTrip', 'dispute'].includes(action) && !owner && !admin) fail('Этот рейс принадлежит другому водителю.', 'permission-denied');
      if (['edit', 'reopen', 'start', 'book'].includes(action) && !eligible(driver, account, trip.driverUid, trip.driverId)) fail('Рейс временно недоступен: водитель не допущен к попуткам.');
      if (action === 'edit') {
        if (!['open', 'closed'].includes(trip.status) || trip.priceLocked) fail('После первой брони маршрут, время и цена зафиксированы.');
        const values = fields(input, driver, at.toMillis(), cityKey);
        tx.update(tripRef, { ...values, availableSeats: values.totalSeats, updatedAt: at });
        tx.set(db.doc(`carpoolTripContacts/${tripId}`), { driverUid: trip.driverUid, phone: phone(input.phone), updatedAt: at });
        return finish({ tripId });
      }
      const bookingId = action === 'book' ? digest(tripId + ':' + uid).slice(0, 40) : input.bookingId;
      if (['book', 'cancelBooking', 'dispute', 'resolve'].includes(action)) {
        if (typeof bookingId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(bookingId)) fail('Неверная бронь.', 'invalid-argument');
        const bookingRef = db.doc(`carpoolBookings/${bookingId}`), previous = (await tx.get(bookingRef)).data();
        if (action !== 'book' && (!previous || previous.tripId !== tripId)) fail('Бронь не найдена.', 'not-found');
        const clientUid = action === 'book' ? uid : previous.clientUid;
        const clientRef = db.doc(`carpoolClientState/${clientUid}`), clientState = (await tx.get(clientRef)).data() || { activeCount: 0 };
        if (action === 'book') {
          if (owner) fail('Нельзя бронировать места в своём рейсе.');
          if (trip.status !== 'open' || trip.departureAt.toMillis() <= at.toMillis()) fail('Бронирование этого рейса закрыто.');
          if (previous && activeBooking(previous)) fail('У вас уже есть бронь в этом рейсе.');
          if (clientState.activeCount >= 3) fail('У вас уже три активные брони. Отмените ненужную.');
          if (!previous && trip.bookingCount >= 64) fail('Бронирование этого рейса доступно через диспетчера.');
          const seats = integer(input.seats, 1, 8, 'Количество мест');
          if (seats > trip.availableSeats) fail(`Осталось только ${trip.availableSeats} мест.`);
          if (input.expectedSeatPrice !== trip.seatPrice) fail('Цена рейса изменилась. Проверьте новую цену.');
          const amount = seats * trip.seatPrice, commission = money(amount * trip.commissionRate / 100);
          let ordinaryReserved = 0;
          if (state?.status === 'busy' && state.activeOrderId && !state.activeOrderId.startsWith('carpool_')) {
            const order = (await tx.get(db.doc(`orders/${state.activeOrderId}`))).data();
            if (!order) fail('Диспетчер должен проверить текущий заказ водителя.');
            ordinaryReserved = order.commissionTerms?.amount ?? money(Number(order.priceAmount) * (driver.commissionRate ?? 20) / 100);
          }
          const held = money((driver.carpoolReservedAmount || 0) + commission);
          if (!Number.isFinite(driver.balance) || !Number.isFinite(ordinaryReserved)) fail('Диспетчер должен проверить баланс водителя.');
          const mode = driver.debtMode || 'unlimited', ceiling = mode === 'none' ? 0 : driver.debtLimit || 0;
          if (mode !== 'unlimited' && money(driver.balance + held + ordinaryReserved) > ceiling) fail('У водителя недостаточно доступного баланса для новой брони. Выберите другую машину.');
          const tripContact = (await tx.get(db.doc(`carpoolTripContacts/${tripId}`))).data();
          const booking = { tripId, clientUid: uid, driverUid: trip.driverUid, driverId: trip.driverId, seats, seatPrice: trip.seatPrice,
            amount, commissionRate: trip.commissionRate, commissionAmount: commission, status: 'confirmed',
            fromCity: trip.fromCity, toCity: trip.toCity, departureAt: trip.departureAt, pickup: trip.pickup, dropoff: trip.dropoff,
            driverName: trip.driverName, car: trip.car, createdAt: at, updatedAt: at };
          tx.set(bookingRef, booking);
          tx.set(db.doc(`carpoolContacts/${bookingId}`), { clientUid: uid, driverUid: trip.driverUid,
            name: text(input.name, 80, 'Имя'), phone: phone(input.phone), driverPhone: tripContact?.phone || '' });
          tx.delete(db.doc(`carpoolBoardingCodes/${bookingId}`)); // Remove an obsolete code if a legacy booking is renewed.
          tx.update(tripRef, { availableSeats: trip.availableSeats - seats, bookedSeats: trip.bookedSeats + seats,
            bookingCount: trip.bookingCount + (previous ? 0 : 1), priceLocked: true, reservedAmount: money(trip.reservedAmount + commission),
            status: seats === trip.availableSeats ? 'closed' : 'open', closedReason: seats === trip.availableSeats ? 'full' : '', updatedAt: at });
          tx.update(driverRef, { carpoolReservedAmount: held });
          tx.set(clientRef, { activeCount: clientState.activeCount + 1 });
          return finish({ tripId, bookingId });
        }
        if (action === 'dispute') {
          if (previous.status !== 'confirmed' || !activeTrip(trip)) fail('Эту бронь уже обработали.');
          tx.update(bookingRef, { status: 'disputed', reason: text(input.reason, 300, 'Причина'), updatedAt: at });
          return finish({ bookingId });
        }
        if (action === 'resolve') {
          if (!admin) fail('Решение принимает диспетчер.', 'permission-denied');
          if (!activeBooking(previous) || !activeTrip(trip)) fail('Бронь уже закрыта.');
          const reason = text(input.reason, 300, 'Решение диспетчера');
          if (['participating', 'boarded'].includes(input.outcome)) {
            tx.update(bookingRef, { status: trip.status === 'in_trip' ? 'in_trip' : 'confirmed', reason, resolvedBy: uid, updatedAt: at });
            tx.delete(db.doc(`carpoolBoardingCodes/${bookingId}`));
            return finish({ bookingId });
          }
          if (input.outcome !== 'cancelled') fail('Выберите решение диспетчера.');
        } else if (action === 'cancelBooking') {
          if (previous.clientUid !== uid) fail('Можно отменить только свою бронь.', 'permission-denied');
          if (previous.status === 'cancelled') return finish({ bookingId });
          if (previous.status !== 'confirmed' || !['open', 'closed'].includes(trip.status)) fail('Для отмены после начала поездки свяжитесь с диспетчером.');
        }
        tx.delete(db.doc(`carpoolBoardingCodes/${bookingId}`));
        const released = previous.commissionAmount;
        tx.update(bookingRef, { status: 'cancelled', cancelledBy: uid, reason: action === 'resolve' ? input.reason.trim() : 'Отмена пассажиром', updatedAt: at });
        tx.update(tripRef, { availableSeats: trip.availableSeats + previous.seats, bookedSeats: trip.bookedSeats - previous.seats,
          reservedAmount: money(trip.reservedAmount - released),
          ...(trip.status === 'closed' && trip.closedReason === 'full' && trip.departureAt.toMillis() > at.toMillis() ? { status: 'open', closedReason: '' } : {}), updatedAt: at });
        tx.update(driverRef, { carpoolReservedAmount: money((driver.carpoolReservedAmount || 0) - released) });
        tx.set(clientRef, { activeCount: Math.max(0, clientState.activeCount - 1) });
        return finish({ bookingId });
      }
      if (action === 'close' || action === 'reopen') {
        if (!['open', 'closed'].includes(trip.status)) fail('Набор мест уже завершён.');
        if (action === 'reopen' && (!trip.availableSeats || trip.departureAt.toMillis() <= at.toMillis())) fail('Нет свободных мест или время выезда уже прошло.');
        tx.update(tripRef, { status: action === 'close' ? 'closed' : 'open', closedReason: action === 'close' ? 'manual' : '', updatedAt: at });
        return finish({ tripId });
      }
      const bookings = (await tx.get(db.collection('carpoolBookings').where('tripId', '==', tripId))).docs;
      const active = bookings.filter(s => activeBooking(s.data()));
      if (action === 'start') {
        if (trip.status === 'in_trip') {
          if (state?.activeOrderId !== `carpool_${tripId}`) fail('Диспетчер должен проверить статус водителя.');
          return finish({ tripId });
        }
        if (!['open', 'closed'].includes(trip.status)) fail('Рейс уже отправлен или закрыт.');
        if (at.toMillis() < trip.departureAt.toMillis() - 15 * 60000) fail('Выезд доступен за 15 минут до указанного времени.');
        if (state?.status === 'busy') fail('Сначала завершите текущий заказ.');
        const travelling = active.filter(s => ['confirmed', 'boarded'].includes(s.data().status));
        if (!travelling.length) fail('Нет действующих броней для начала поездки.');
        for (const booking of travelling) {
          tx.update(booking.ref, { status: 'in_trip', startedAt: at, updatedAt: at });
          tx.delete(db.doc(`carpoolBoardingCodes/${booking.id}`));
        }
        tx.update(tripRef, { status: 'in_trip', startedAt: at, updatedAt: at });
        tx.set(stateRef, { driverId: trip.driverId, status: 'busy', activeOrderId: `carpool_${tripId}`, lastSeen: at, updatedAt: at });
        return finish({ tripId });
      }
      if (action === 'complete') {
        if (trip.status === 'completed') return finish({ tripId });
        if (trip.status !== 'in_trip') fail('Сначала начните поездку.');
        if (active.some(s => !['in_trip', 'boarded'].includes(s.data().status))) fail('Диспетчер должен разрешить спорные брони перед завершением.');
        if (state?.activeOrderId !== `carpool_${tripId}`) fail('Диспетчер должен проверить статус водителя.');
      } else if (action === 'cancelTrip') {
        if (trip.status === 'cancelled') return finish({ tripId });
        if (!['open', 'closed'].includes(trip.status) && !(admin && trip.status === 'in_trip')) fail('Поездку в пути может отменить диспетчер.');
        text(input.reason, 300, 'Причина отмены');
      }
      const clients = new Map();
      for (const s of active) {
        const clientUid = s.data().clientUid;
        if (!clients.has(clientUid)) clients.set(clientUid, (await tx.get(db.doc(`carpoolClientState/${clientUid}`))).data()?.activeCount || 0);
      }
      const historyRef = db.doc(`balanceHistory/carpool_${tripId}`), history = await tx.get(historyRef);
      if (history.exists) fail('Расчёт по этому рейсу уже сохранён.');
      const completed = action === 'complete';
      const amount = money(active.reduce((sum, s) => sum + s.data().commissionAmount, 0));
      const revenue = active.reduce((sum, s) => sum + s.data().amount, 0);
      if (money(trip.reservedAmount) !== amount) fail('Резерв комиссии не совпадает. Нужна проверка диспетчера.');
      const newBalance = money(driver.balance + (completed ? amount : 0));
      tx.update(driverRef, { carpoolReservedAmount: money((driver.carpoolReservedAmount || 0) - amount),
        carpoolActiveTripId: '', ...(completed ? { balance: newBalance } : {}) });
      for (const s of active) {
        tx.update(s.ref, { status: completed ? 'completed' : 'cancelled', updatedAt: at,
          ...(completed ? { completedAt: at } : { cancelledBy: uid, reason: input.reason.trim() }) });
        tx.delete(db.doc(`carpoolBoardingCodes/${s.id}`));
      }
      for (const [clientUid, count] of clients) tx.set(db.doc(`carpoolClientState/${clientUid}`), { activeCount: Math.max(0, count - 1) });
      tx.update(tripRef, { status: completed ? 'completed' : 'cancelled', reservedAmount: 0, updatedAt: at,
        ...(completed ? { completedAt: at, commissionAmount: amount, revenue } : { cancelledAt: at, cancelledBy: uid, reason: input.reason.trim() }) });
      if (state?.activeOrderId === `carpool_${tripId}`) tx.set(stateRef, { driverId: trip.driverId, status: 'available', activeOrderId: '', lastSeen: at, updatedAt: at });
      if (completed) tx.set(historyRef, { driverId: trip.driverId, driverUid: trip.driverUid, orderId: `carpool_${tripId}`, type: 'commission',
        driverNumber: driver.driverNumber ?? trip.driverId, previousBalance: driver.balance, newBalance, difference: amount, amount, commissionAmount: amount, commissionRate: trip.commissionRate,
        commissionBaseAmount: revenue, reason: `Попутки: ${trip.fromCity} → ${trip.toCity} · ${active.reduce((n,s)=>n+s.data().seats,0)} мест · комиссия ${trip.commissionRate}%`,
        changedAt: at, changedBy: uid, source: 'carpool' });
      return finish({ tripId });
    });
  }
  return { command };
}
module.exports = { createCarpoolActions };
