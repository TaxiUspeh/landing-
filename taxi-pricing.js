import { normalizeCity } from './booking-core.js?v=74';

// The published list contains hub ↔ settlement prices. Never invent a trip
// through the hub or silently omit an unknown leg of a multi-stop route.
export function publishedRouteFare(points, rates, hub = 'Белоусовка') {
  let min = 0, max = 0, legs = 0;
  for (let index = 1; index < points.length; index++) {
    const from = normalizeCity(points[index - 1].city), to = normalizeCity(points[index].city);
    if (from === to) continue;
    if (from !== hub && to !== hub) return null;
    const rate = rates.find(item => normalizeCity(item.name) === (from === hub ? to : from));
    if (!rate || !Number.isInteger(rate.min) || rate.min <= 0 || rate.max < rate.min) return null;
    min += rate.min; max += rate.max; legs++;
  }
  return legs ? { min, max, usesSeveralBaseRates: legs > 1, routeLabel: points.map(point => normalizeCity(point.city)).join(' → ') } : null;
}

export function distanceFare(meters, tariff, multiplier, intercity) {
  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) return null;
  const km = meters / 1000;
  const base = Math.max(tariff.BASE_PRICE, km * tariff.INTERCITY_PRICE_PER_KM);
  const amount = Math.round(base * multiplier);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 10000000 ? amount : null;
}

export function formatTaxiFare(fare) {
  return fare.priceMin === fare.priceMax ? `${fare.priceMax} ₸` : `${fare.priceMin}–${fare.priceMax} ₸`;
}
