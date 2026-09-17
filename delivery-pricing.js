import { normalizeCity } from './booking-core.js?v=60';
import { deliveryQuote } from './pricing-adjustments.js?v=63';

export function deliveryCityKey(city) {
  const value = normalizeCity(city).toLocaleLowerCase('ru-RU').replace(/^(?:село|с\.|деревня|д\.)\s+/u, '');
  const aliases = {progress:'прогресс',progres:'прогресс',chernogorka:'черногорка',
    maloubinka:'малоубинка','malaya ubinka':'малоубинка','малая убинка':'малоубинка'};
  return aliases[value] || value;
}
const hasCoordinates = point => Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90
  && Number.isFinite(point?.lon) && Math.abs(point.lon) <= 180;
const validPoints = points => Array.isArray(points) && points.length >= 2 && points.length <= 5
  && points.every(point => typeof point.address === 'string' && point.address.trim().length >= 3
    && typeof point.city === 'string' && point.city.trim());
export function deliveryPickupMode(point) {
  const address = point?.address?.trim() || '';
  if (!address) return 'missing';
  if (hasCoordinates(point)) return 'address';
  return /^(?:(?:из|в)\s+)?(?:(?:любой|любого|любом)\s+)?магазин(?:а|е)?$/iu.test(address)
    ? 'anyStore' : 'address';
}
export function randomMapCar(cars, random = Math.random) {
  const available = (Array.isArray(cars) ? cars : []).filter(hasCoordinates);
  if (!available.length) return null;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) return null;
  const car = available[Math.floor(sample * available.length)];
  return { lat: car.lat, lon: car.lon };
}
export const isLocalDelivery = points => validPoints(points) && points.every(point => deliveryCityKey(point.city) === deliveryCityKey(points[0].city));

export function deliveryRouteQuote(points, meters, tariff, adjustment) {
  if (!validPoints(points)) return null;
  const local = isLocalDelivery(points);
  if (!local && (!Number.isFinite(meters) || meters <= 0)) return null;
  const extraKm = local ? 0 : Math.max(0, meters / 1000 - tariff.BASE_DISTANCE_KM);
  const baseAmount = tariff.BASE_PRICE + extraKm * tariff.PRICE_PER_KM;
  const quote = deliveryQuote(baseAmount, adjustment);
  if (!quote) return null;
  const number = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const distanceText = local ? '' : `≈ ${number(meters / 1000)} км по дороге`;
  const formula = local ? `В пределах одного населённого пункта — ${tariff.BASE_PRICE} ₸.`
    : `${distanceText}. База ${tariff.BASE_PRICE} ₸ включает первые ${tariff.BASE_DISTANCE_KM} км; далее ${tariff.PRICE_PER_KM} ₸/км, включая неполный километр.`;
  return { ...quote, local, distanceMeters: local ? null : meters, baseAmount, distanceText,
    calculation: `${formula} После применения одного коэффициента итог округляется вверх до 50 ₸.` };
}

// Keep route and tariff input snapshots separate from asynchronous geocoding.
// A late route cannot replace a newer quote or change a submitted order's price.
export function createDeliveryPricing({ tariff, readInput, locate, routeDistance, onChange,
  readCars = () => [], locateCarCity = async () => null, random = Math.random,
  wait = () => new Promise(resolve => setTimeout(resolve, 350)) }) {
  let state = 'incomplete', quote = null, key = '', revision = 0, pending = null;
  let selectedCar = null;
  const distances = new Map();
  function input() {
    const data = readInput();
    return {
      points: (data.points || []).map(point => ({ address: point.address?.trim() || '', city: point.city?.trim() || '',
        lat: hasCoordinates(point) ? point.lat : null, lon: hasCoordinates(point) ? point.lon : null })),
      adjustment: data.adjustment && { code: data.adjustment.code, label: data.adjustment.label, multiplier: data.adjustment.multiplier }
    };
  }
  function publish(nextState, nextQuote = null) {
    state = nextState; quote = nextQuote;
    onChange({ state, quote: quote && { ...quote } });
  }
  async function measure(points) {
    const routeKey = JSON.stringify(points);
    if (distances.has(routeKey)) return distances.get(routeKey);
    const request = (async () => {
      try {
        const coordinates = await Promise.all(points.map(point => hasCoordinates(point) ? {lat:point.lat,lon:point.lon} : locate(point.address,point.city)));
        if (!coordinates.every(hasCoordinates)) return null;
        const meters = await routeDistance(coordinates);
        return Number.isFinite(meters) && meters > 0 ? meters : null;
      } catch { return null; }
    })();
    distances.set(routeKey,request);
    if (distances.size > 30) distances.delete(distances.keys().next().value);
    const meters = await request;
    if (meters === null && distances.get(routeKey) === request) distances.delete(routeKey);
    return meters;
  }
  function update() {
    const data = input(), nextKey = JSON.stringify(data);
    if (nextKey === key && state !== 'unavailable') return pending || Promise.resolve();
    key = nextKey;
    const requestId = ++revision;
    pending = null;
    const pickupMode = deliveryPickupMode(data.points[0]);
    const fromCar = pickupMode !== 'address';
    const preview = pickupMode === 'missing';
    if (!fromCar || !data.points.length) selectedCar = null;
    const routeReady = fromCar
      ? validPoints([{ address: 'Машина на карте', city: 'Модель' }, ...data.points.slice(1)])
      : validPoints(data.points);
    if (!routeReady) { publish('incomplete'); return Promise.resolve(); }
    if (!data.adjustment) { publish('pending'); return Promise.resolve(); }
    if (!fromCar && isLocalDelivery(data.points)) {
      const result = deliveryRouteQuote(data.points,null,tariff,data.adjustment);
      publish(result ? 'ready' : 'unavailable',result);
      return Promise.resolve();
    }
    publish('pending');
    pending = (async () => {
      await wait();
      if (revision !== requestId) return;
      let points = data.points;
      if (fromCar) {
        try {
          // Pin one randomly selected position, including across tariff changes and
          // missing pickup -> any store. Map animation must not silently reprice it.
          if (!selectedCar) {
            const car = randomMapCar(readCars(),random);
            if (car) selectedCar = { ...car, city: null };
          }
          const car = selectedCar;
          const city = car && (car.city || await locateCarCity(car));
          if (revision !== requestId || JSON.stringify(input()) !== nextKey) return;
          if (!car || !city) { publish('unavailable'); return; }
          car.city = city;
          points = [{...car,city,address:'Онлайн-машина на карте (модель)'},...points.slice(1)];
        } catch {
          if (revision === requestId) publish('unavailable');
          return;
        }
      }
      const meters = await measure(points);
      if (revision !== requestId || JSON.stringify(input()) !== nextKey) return;
      let result = deliveryRouteQuote(points,meters,tariff,data.adjustment);
      if (fromCar) {
        result = result && meters !== null ? {...result,preview,anyStore:!preview,origin:points[0],distanceMeters:meters,
          calculation: `${preview ? 'Предварительный расчёт' : 'Любой магазин — расчёт'} от случайной онлайн-машины на карте (движение смоделировано): ≈ ${(meters/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})} км по дороге. Точка расчёта закреплена; это не назначение водителя. ${result.calculation}` } : null;
      }
      publish(result ? (preview ? 'preview' : 'ready') : 'unavailable',result);
    })();
    return pending;
  }
  return { update,
    getState: () => JSON.stringify(input()) === key ? state : 'pending',
    getEstimate: () => ['ready','preview'].includes(state) && JSON.stringify(input()) === key && quote ? { ...quote } : null,
    getQuote: () => state === 'ready' && JSON.stringify(input()) === key && quote ? { ...quote } : null
  };
}
