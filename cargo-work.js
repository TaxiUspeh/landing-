import { isMeteredCargo, cargoAmount, cargoTimestamp, CARGO_HOUR_MS } from './cargo-fare.js?v=77';
import { commissionFor } from './driver-finance.js?v=78';

export async function updateCargoWork(db, sdk, { orderId, uid, action, meters, expectedReportedMeters }) {
  const { doc, runTransaction, serverTimestamp } = sdk;
  return runTransaction(db, async transaction => {
    const ref = doc(db, 'orders', orderId), snapshot = await transaction.get(ref), order = snapshot.data();
    if (!snapshot.exists() || !isMeteredCargo(order) || order.cancellationRequestStatus === 'pending') throw new Error('Обновите карточку: заказ изменился.');
    const update = { updatedAt: serverTimestamp() };
    if (action === 'start') {
      if (order.assignedDriverUid !== uid || order.status !== 'arrived' || order.cargoStartedAt) throw new Error('Начать работу можно после прибытия к клиенту.');
      Object.assign(update, { status: 'in_trip', cargoStartedAt: serverTimestamp() });
    } else if (action === 'report') {
      if (order.assignedDriverUid !== uid || order.status !== 'in_trip' || !order.cargoStartedAt || order.cargoFinishedAt) throw new Error('Пробег уже отправлен или работа ещё не начата.');
      cargoAmount(order.cargoFare, meters);
      if (meters > 0 && Date.now() <= cargoTimestamp(order.cargoStartedAt) + CARGO_HOUR_MS) throw new Error('Первый час ещё не закончился. За работу в пределах часа дополнительный пробег — 0 км.');
      Object.assign(update, { cargoReportedMeters: meters, cargoFinishedAt: serverTimestamp() });
    } else if (action === 'confirm') {
      if (order.status !== 'in_trip' || !order.cargoFinishedAt || order.cargoConfirmedAt || order.cargoReportedMeters !== expectedReportedMeters) throw new Error('Пробег уже подтверждён или изменился. Обновите карточку.');
      if (meters > 0 && cargoTimestamp(order.cargoFinishedAt) <= cargoTimestamp(order.cargoStartedAt) + CARGO_HOUR_MS) throw new Error('Работа завершена в пределах первого часа: дополнительный пробег должен быть 0 км.');
      const priceAmount = cargoAmount(order.cargoFare, meters), rate = order.commissionTerms?.rate;
      Object.assign(update, { cargoConfirmedMeters: meters, cargoConfirmedAt: serverTimestamp(), cargoConfirmedBy: uid,
        priceAmount, priceText: `${priceAmount} ₸`, commissionTerms: { rate, baseAmount: priceAmount, amount: commissionFor(priceAmount, rate) } });
    } else throw new Error('Неизвестное действие.');
    transaction.update(ref, update);
  });
}
