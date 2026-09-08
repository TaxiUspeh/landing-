export const BOOKING_SERVICES = [
  { id: 'taxi', label: 'Легковой', icon: 'taxi', form: 'taxi', online: true },
  { id: 'auction', label: 'Аукцион', icon: 'gavel', form: 'auction', online: true },
  { id: 'intercity', label: 'Межгород', icon: 'route', form: 'taxi', online: true },
  { id: 'delivery', label: 'Доставка', icon: 'box-open', form: 'delivery', online: true },
  { id: 'wagon', label: 'Универсал', icon: 'car-side', form: 'taxi', online: true, wish: 'Нужен универсал' },
  { id: 'minivan', label: 'Минивэн', icon: 'shuttle-van', form: 'taxi', online: true, wish: 'Нужен минивэн' },
  { id: 'cargo', label: 'Грузовой', icon: 'truck', form: 'cargo' },
  { id: 'soberDriver', label: 'Трезвый водитель', icon: 'key', form: 'soberDriver' },
  { id: 'assistance', label: 'Помощь на дороге', icon: 'tools', form: 'assistance' },
  { id: 'preorder', label: 'Предварительный заказ', icon: 'calendar-alt', form: 'taxi', online: true }
];

export function normalizeCity(city = '') {
  const value = city.trim();
  const aliases = { 'белоусовка': 'Белоусовка', 'белoусовка': 'Белоусовка', 'belousovka': 'Белоусовка', 'belousovka village': 'Белоусовка', 'өскемен': 'Усть-Каменогорск', 'oskemen': 'Усть-Каменогорск', 'ust-kamenogorsk': 'Усть-Каменогорск', 'устъ-каменогорск': 'Усть-Каменогорск' };
  return aliases[value.toLowerCase().replace(/^(пос[её]лок|п\.|город|г\.)\s+/u, '')] || value;
}

export function photonPoint(feature) {
  const p = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(Number.isFinite)) return null;
  const [lon, lat] = coordinates;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const city = normalizeCity(p.city || p.town || p.village || p.locality || (p.osm_key === 'place' ? p.name : '') || '');
  const street = p.street || p.name || '';
  if (!street && !city) return null;
  return { city, address: [street, p.housenumber].filter(Boolean).join(', '), street, house: p.housenumber || '', lat, lon, country: p.countrycode || '', isSettlement: p.osm_key === 'place', context: [p.district, p.state].filter(Boolean).join(', ') };
}

export function parseHouseDetails(value = '') {
  const parts = value.trim().split(/\s*,?\s*(?:подъезд|под[ьъ]езд|под\.|п-д)\s*/iu);
  return { house: parts[0].replace(/^(?:дом|д\.)\s*/iu, '').replace(/[,\s]+$/u, ''), entrance: parts.slice(1).join(' ').trim() };
}

export function completeAddress(point, details = '') {
  return [point.address, details].filter(Boolean).join(', ');
}

export function addressWithCity(point, details = '') {
  const address = completeAddress(point, details);
  return address ? [address, point.city].filter(Boolean).join(', ') : '';
}

export function serviceWishes(note, service) {
  return [service.wish, note.trim()].filter(Boolean).join('. ').slice(0, 500);
}

// Only geography is sent to Photon; passenger contacts, entrance and notes stay out of requests.
// Requests are serialized, deduplicated and kept in memory for this page session.
export function createGeocoder({ fetcher = globalThis.fetch, baseUrl = 'https://photon.komoot.io', interval = 1100 } = {}) {
  const cache = new Map();
  let tail = Promise.resolve();
  let lastRequest = 0;
  function request(path, params) {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    if (cache.has(url)) return cache.get(url);
    const promise = tail.catch(() => {}).then(async () => {
      const delay = interval - (Date.now() - lastRequest);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Address service unavailable');
        const body = await response.json();
        return (body.features || []).map(photonPoint).filter(Boolean);
      } finally { clearTimeout(timeout); }
    });
    cache.set(url, promise);
    tail = promise;
    promise.catch(() => cache.delete(url));
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    return promise;
  }
  return {
    search: (query, center = { lat: 50.132, lon: 82.533 }) => request('/api/', { q: query, limit: '8', lat: String(center.lat), lon: String(center.lon) }),
    reverse: (lat, lon) => request('/reverse', { lat: String(lat), lon: String(lon), limit: '1' })
  };
}
