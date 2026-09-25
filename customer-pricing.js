import { soberFareDescription } from './sober-fare.js?v=74';
// Amounts are integer KZT. Offers are final fares, never input to surge again.
export const DEFAULT_CUSTOMER_PRICING = Object.freeze({ enabled: true, quickPercentages: [10, 20, 30], minimumIncrease: 1, maximumPrice: 1000000, taxiMinimum: 800, deliveryMinimum: 1200 });
export function priceSettings(value = {}) {
  const config = { ...DEFAULT_CUSTOMER_PRICING, ...value };
  for (const key of ['minimumIncrease', 'maximumPrice', 'taxiMinimum', 'deliveryMinimum']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > 10000000) throw new Error('Проверьте пределы цены в настройках.');
  }
  if (typeof config.enabled !== 'boolean' || !Array.isArray(config.quickPercentages) || config.quickPercentages.length > 5
    || config.quickPercentages.some(p => !Number.isInteger(p) || p < 1 || p > 100)
    || config.maximumPrice < Math.max(config.taxiMinimum, config.deliveryMinimum)) throw new Error('Проверьте настройки предложения цены.');
  return config;
}
export function minimumOffer(service, calculated, config, current = null) {
  if (current !== null) return current + config.minimumIncrease;
  return calculated ?? (service === 'soberDriver' ? 3800 : service === 'delivery' ? config.deliveryMinimum : config.taxiMinimum);
}
export function validOffer(amount, minimum, config) {
  return Number.isSafeInteger(amount) && amount >= minimum && amount <= config.maximumPrice;
}
export const priceLabel = amount => `${amount.toLocaleString('ru-RU')} ₸`;
export function offerFields(calculated, offered, service, config, calculationType = 'tariff') {
  if (calculated !== null && (!Number.isSafeInteger(calculated) || calculated <= 0)) throw new Error('Расчётная цена недействительна.');
  const amount = offered ?? calculated;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000
    || (offered !== null && (!config.enabled || !validOffer(offered, minimumOffer(service, calculated, config), config)))) throw new Error('Проверьте предложенную сумму.');
  return { calculatedPrice: calculated, customerOfferPrice: offered, finalDisplayedPrice: amount,
    priceAmount: amount, priceText: `${amount} ₸`, pricingType: calculated === null ? 'customer_offer_unavailable' : offered !== null && offered > calculated ? 'customer_offer' : 'calculated',
    calculationType: calculated === null ? 'unavailable' : calculationType,
    customerIncreasedPrice: calculated !== null && amount > calculated, priceRevision: 0 };
}
export function priceDescription(order) {
  if (!order.pricingType) return '';
  const original = order.calculatedPrice === null ? 'Автоматическая стоимость недоступна' : `Расчётная цена: ${priceLabel(order.calculatedPrice)}`;
  const offer = order.customerOfferPrice !== null ? `${order.customerIncreasedPrice ? '🔥 ' : ''}Клиент предлагает: ${priceLabel(order.priceAmount)}` : '';
  const raised = order.priceRevision > 0 ? `Цена повышена: ${priceLabel(order.previousPrice)} → ${priceLabel(order.priceAmount)}` : '';
  return [soberFareDescription(order), original, offer, raised, order.routeDistanceMeters > 0 ? `По дорогам: ${(order.routeDistanceMeters / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км` : order.calculatedPrice === null ? 'Расстояние не рассчитано' : ''].filter(Boolean).join(' · ');
}
// Security rules can see a concurrent price before the SDK retries its precondition.
// One fresh transaction re-reads all fields; it never reuses a stale commission.
export async function retryPriceConflict(operation) {
  try { return await operation(); }
  catch (error) { if (error.code !== 'permission-denied') throw error; return operation(); }
}
// A fixed operation id makes retry after a timeout safe, even when the order has since been accepted.
export async function increaseOrderPrice(db, sdk, { orderId, uid, amount, operationId }) {
  const { doc, runTransaction, serverTimestamp } = sdk;
  return retryPriceConflict(() => runTransaction(db, async transaction => {
    const ref = doc(db, 'orders', orderId), changeRef = doc(db, 'orders', orderId, 'priceChanges', operationId);
    const orderSnap = await transaction.get(ref), changeSnap = await transaction.get(changeRef);
    if (changeSnap.exists()) {
      const existing = changeSnap.data();
      if (existing.clientUid !== uid || existing.newPrice !== amount) throw new Error('Другая операция уже использует этот номер.');
      return existing.newPrice;
    }
    const configSnap = await transaction.get(doc(db, 'settings', 'customerPricing'));
    const config = priceSettings(configSnap.exists() ? configSnap.data() : {});
    const order = orderSnap.data();
    if (!orderSnap.exists() || order.clientUid !== uid) throw new Error('Этот заказ недоступен.');
    if (order.status !== 'searching' || order.assignedDriverUid) throw new Error('Водитель уже принял заказ или поиск завершён. Цена не изменена.');
    if (!['taxi', 'delivery', 'soberDriver'].includes(order.serviceType) || !config.enabled || !validOffer(amount, minimumOffer(order.serviceType, null, config, order.priceAmount), config)) throw new Error('Новая цена должна быть выше текущей и в пределах настроенного лимита.');
    const calculated = order.pricingType ? order.calculatedPrice : order.priceAmount;
    const fields = offerFields(calculated, amount, order.serviceType, config, order.calculationType || 'tariff');
    const revision = (order.priceRevision || 0) + 1;
    transaction.update(ref, { ...fields, customerIncreasedPrice: true, previousPrice: order.priceAmount, priceRevision: revision,
      lastPriceOperationId: operationId, priceUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(changeRef, { clientUid: uid, oldPrice: order.priceAmount, newPrice: amount, revision, changedAt: serverTimestamp() });
    return amount;
  }));
}
