export const CARGO_BASE = 6000;
export const CARGO_KM_RATE = 250;
export const CARGO_HOUR_MS = 60 * 60 * 1000;
export const CARGO_MOVER_RATE = 3000;
export const isMeteredCargo = order => order?.serviceType === 'cargo' && order.cargoFare?.schemaVersion === 1;
export const cargoTimestamp = value => typeof value?.toMillis === 'function' ? value.toMillis() : typeof value?.seconds === 'number' ? value.seconds * 1000 : NaN;
export function initialCargoFare(moversCount = 0) {
  if (!Number.isInteger(moversCount) || moversCount < 0 || moversCount > 2) throw new Error('Выберите количество грузчиков.');
  return { schemaVersion: 1, baseAmount: CARGO_BASE, includedMinutes: 60, kmRate: CARGO_KM_RATE, moversCount, moverAmount: moversCount * CARGO_MOVER_RATE };
}
export function cargoMeters(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d)?$/.test(text)) throw new Error('Укажите километры после первого часа, например 5 или 5,2. Если доплаты нет — 0.');
  const meters = Math.round(Number(text) * 1000);
  if (!Number.isSafeInteger(meters) || meters < 0 || meters > 10000000) throw new Error('Укажите пробег от 0 до 10 000 км.');
  return meters;
}
export function cargoAmount(fare, extraMeters = 0) {
  if (!fare || Object.entries(initialCargoFare(fare.moversCount)).some(([key, value]) => fare[key] !== value)
    || !Number.isSafeInteger(extraMeters) || extraMeters < 0 || extraMeters > 10000000 || extraMeters % 100 !== 0) throw new Error('Некорректный тариф или пробег грузового заказа.');
  return fare.baseAmount + fare.moverAmount + extraMeters / 1000 * fare.kmRate;
}
export function cargoCanComplete(order) {
  return !isMeteredCargo(order) || (order.cargoConfirmedAt != null && order.cargoFinishedAt != null && order.status === 'in_trip');
}
const money = value => `${value.toLocaleString('ru-RU')} ₸`;
export function cargoFareDescription(order) {
  if (!isMeteredCargo(order)) return '';
  const fare = order.cargoFare;
  const base = `Первый час — ${money(fare.baseAmount)}: дорога и время погрузки включены.`;
  const movers = fare.moversCount ? ` Отдельные грузчики: ${fare.moversCount} чел. — ${money(fare.moverAmount)}.` : '';
  if (order.cargoConfirmedAt) return `${base}${movers} После часа: ${(order.cargoConfirmedMeters / 1000).toLocaleString('ru-RU')} км × ${fare.kmRate} ₸ = ${money(order.cargoConfirmedMeters / 1000 * fare.kmRate)}. Итого: ${money(order.priceAmount)}. Пробег подтверждён диспетчером.`;
  if (order.cargoFinishedAt) return `${base}${movers} Водитель указал после часа: ${(order.cargoReportedMeters / 1000).toLocaleString('ru-RU')} км. Ожидаем подтверждения диспетчера; итоговая цена ещё не установлена.`;
  return `${base}${movers} После первого часа — ${fare.kmRate} ₸/км по фактическому пробегу, который подтвердит диспетчер. Стоимость предварительная.`;
}
