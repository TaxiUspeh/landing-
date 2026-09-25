import { SOBER_BASE, SOBER_MINIMUM, SOBER_KM_RATE } from './sober-fare.js?v=74';
import { publishedRouteFare, distanceFare } from './taxi-pricing.js?v=74';
const located = p => Number.isFinite(p?.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p?.lon) && Math.abs(p.lon) <= 180;

export function soberQuote(pickupAmount, returnAmount, meters) {
  if (![pickupAmount, returnAmount].every(n => Number.isSafeInteger(n) && n >= 0)
    || !Number.isFinite(meters) || meters < 0) return null;
  const workAmount = Math.max(1, Math.ceil(meters / 1000 * SOBER_KM_RATE), SOBER_MINIMUM - pickupAmount - returnAmount);
  const priceAmount = pickupAmount + returnAmount + workAmount;
  if (priceAmount > 10000000) return null;
  return { pickupAmount, returnAmount, workAmount, priceAmount, distanceMeters: meters, priceText: `${priceAmount} ₸` };
}

// Route revisions and immutable snapshots keep a late geocoder response out of a new order.
export function createSoberPricing({ readInput, locate, routeDistance, taxiTariff, rates, onChange,
  wait = () => new Promise(resolve => setTimeout(resolve, 350)) }) {
  let key = '', revision = 0, state = 'incomplete', quote = null, expenses = null, pending = null;
  const input = () => structuredClone(readInput());
  function publish(next, result = null) { state = next; quote = result; onChange({ state, quote }); }
  async function measure(points) {
    try {
      const coords = await Promise.all(points.map(p => located(p) ? p : locate(p.address, p.city)));
      if (!coords.every(located)) return null;
      if (coords.every(p => p.lat === coords[0].lat && p.lon === coords[0].lon)) return 0;
      const meters = await routeDistance(coords);
      return Number.isFinite(meters) && meters >= 0 ? meters : null;
    } catch { return null; }
  }
  async function taxiLeg(points, multiplier) {
    const published = publishedRouteFare(points, rates);
    if (published) return Math.round(published.max * multiplier);
    const meters = await measure(points);
    return meters === 0 ? 0 : distanceFare(meters, taxiTariff, multiplier);
  }
  function update() {
    const data = input(), nextKey = JSON.stringify(data);
    if (key === nextKey && state !== 'unavailable') return pending || Promise.resolve();
    key = nextKey; const request = ++revision; expenses = null; pending = null;
    const points = data.points || [];
    if (points.length < 2 || points.some(p => !p.address?.trim())) { publish('incomplete'); return Promise.resolve(); }
    if (!Number.isFinite(data.multiplier) || data.multiplier <= 0) { publish('pending'); return Promise.resolve(); }
    publish('pending');
    pending = (async () => {
      await wait();
      if (request !== revision) return;
      const [pickupAmount, returnAmount, meters] = await Promise.all([
        taxiLeg([SOBER_BASE, points[0]], data.multiplier),
        taxiLeg([points.at(-1), SOBER_BASE], data.multiplier), measure(points)
      ]);
      if (request !== revision || JSON.stringify(input()) !== nextKey) return;
      expenses = { pickupAmount, returnAmount };
      const result = soberQuote(pickupAmount, returnAmount, meters);
      publish(result ? 'ready' : 'unavailable', result);
    })();
    return pending;
  }
  const current = () => key === JSON.stringify(input());
  return { update, getState: () => current() ? state : 'pending',
    getQuote: () => current() && quote ? { ...quote } : null,
    getExpenses: () => current() && expenses ? { ...expenses } : null };
}
