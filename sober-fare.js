export const SOBER_MINIMUM = 3800;
export const SOBER_KM_RATE = 230;
export const SOBER_BASE = Object.freeze({ city: 'Белоусовка', address: 'Базовая точка Белоусовки', lat: 50.132, lon: 82.533 });
const expense = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;
export function soberWorkAmount(order, total = order.priceAmount) {
  const fare = order.soberFare;
  if (order.serviceType !== 'soberDriver' || !fare) return total; // Older dispatcher orders.
  if (fare.schemaVersion !== 1 || fare.base !== SOBER_BASE.city || !expense(fare.pickupAmount) || !expense(fare.returnAmount)) return null;
  const work = total - fare.pickupAmount - fare.returnAmount;
  return Number.isSafeInteger(work) && work > 0 ? work : null;
}
export function soberFareForPrice(expenses, total) {
  const fare = { schemaVersion: 1, base: SOBER_BASE.city, pickupAmount: expenses?.pickupAmount ?? null, returnAmount: expenses?.returnAmount ?? null };
  return soberWorkAmount({ serviceType: 'soberDriver', soberFare: fare, priceAmount: total }) !== null
    ? fare : { ...fare, pickupAmount: null, returnAmount: null };
}
export function soberFareDescription(order) {
  if (order.serviceType !== 'soberDriver' || !order.soberFare) return '';
  const work = soberWorkAmount(order), format = value => `${value.toLocaleString('ru-RU')} ₸`;
  if (work === null) return 'Расходы на подачу и возвращение уточнит диспетчер перед назначением водителя.';
  return `Подача из Белоусовки: ${format(order.soberFare.pickupAmount)} · Перегон: ${format(work)} · Обратное такси в Белоусовку: ${format(order.soberFare.returnAmount)}.`;
}
