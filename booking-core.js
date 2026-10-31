import { STREET_ALIASES_KZ } from './data/street-aliases-kz.js';

export const BOOKING_SERVICES = [
  { id: 'taxi', label: 'Легковой', icon: 'taxi', form: 'taxi', online: true },
  { id: 'auction', label: 'Аукцион', icon: 'gavel', form: 'auction', online: true },
  { id: 'intercity', label: 'Межгород', icon: 'route', form: 'taxi', online: true },
  { id: 'delivery', label: 'Доставка', icon: 'box-open', form: 'delivery', online: true },
  { id: 'wagon', label: 'Универсал', icon: 'car-side', form: 'taxi', online: true, wish: 'Нужен универсал' },
  { id: 'minivan', label: 'Минивэн', icon: 'shuttle-van', form: 'taxi', online: true, wish: 'Нужен минивэн' },
  { id: 'cargo', label: 'Грузовой', icon: 'truck', form: 'cargo', online: true },
  { id: 'soberDriver', label: 'Трезвый водитель', icon: 'key', form: 'soberDriver', online: true },
  { id: 'assistance', label: 'Помощь на дороге', icon: 'tools', form: 'assistance', online: true },
  { id: 'preorder', label: 'Предварительный заказ', icon: 'calendar-alt', form: 'taxi', online: true }
];

const cityKey = value => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-яәіңғүұқөһö0-9]+/giu, '');

export function normalizeCity(city = '') {
  const value = String(city).trim();
  const key = cityKey(value.replace(/^(пос[её]лок|п\.|город|г\.)\s+/iu, ''));

  const aliases = {
    'белоусовка': 'Белоусовка',
    'белoусовка': 'Белоусовка',
    'belousovka': 'Белоусовка',
    'belousovkavillage': 'Белоусовка',

    'өскемен': 'Усть-Каменогорск',
    'öskemen': 'Усть-Каменогорск',
    'оскемен': 'Усть-Каменогорск',
    'oskemen': 'Усть-Каменогорск',
    'oskemenq': 'Усть-Каменогорск',
    'ustkamenogorsk': 'Усть-Каменогорск',
    'усткаменогорск': 'Усть-Каменогорск',
    'устъкаменогорск': 'Усть-Каменогорск',
    'усткамен': 'Усть-Каменогорск',
    'устькамен': 'Усть-Каменогорск',
    'устькаменогор': 'Усть-Каменогорск',
    'каменогорск': 'Усть-Каменогорск',

    'семей': 'Семей',
    'семипалатинск': 'Семей',
    'semey': 'Семей',
    'semipalatinsk': 'Семей',

    'белокаменка': 'Белокаменка',
    'belokamenka': 'Белокаменка',
    'глубокое': 'Глубокое',
    'glubokoe': 'Глубокое',
    'glubokoye': 'Глубокое',
    'секисовка': 'Секисовка',
    'sekisovka': 'Секисовка',
    'уварово': 'Уварово',
    'uvarovo': 'Уварово',
    'прапорщиково': 'Прапорщиково',
    'praporshchikovo': 'Прапорщиково',
    'риддер': 'Риддер',
    'ridder': 'Риддер'
  };

  return aliases[key] || value;
}

function geocoderQueryVariants(query) {
  const original = String(query || '').trim();
  if (!original) return [];

  const variants = [original];
  const parts = original.split(',').map(part => part.trim());

  if (parts.length > 1) {
    const hasCountry = /^(казахстан|қазақстан)$/iu.test(parts[parts.length - 1]);
    const cityIndex = hasCountry ? parts.length - 2 : parts.length - 1;
    const cityValue = parts[cityIndex];
    const canonicalCity = normalizeCity(cityValue);

    if (canonicalCity !== cityValue) {
      const canonicalParts = [...parts];
      canonicalParts[cityIndex] = canonicalCity;
      variants.push(canonicalParts.join(', '));
    }

    if (canonicalCity === 'Усть-Каменогорск') {
      const kazakhParts = [...parts];
      kazakhParts[cityIndex] = 'Өскемен';
      if (hasCountry) {
        kazakhParts[kazakhParts.length - 1] = 'Қазақстан';
      } else {
        kazakhParts.push('Қазақстан');
      }
      variants.push(kazakhParts.join(', '));
    }
  } else {
    const canonical = normalizeCity(original);
    if (canonical !== original) variants.push(canonical);
  }

  return [...new Set(variants)];
}

export function photonPoint(feature) {
  const p = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(Number.isFinite)) return null;
  const [lon, lat] = coordinates;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const rawCity = String(p.city || p.town || p.village || p.locality || '').trim();
  const settlementName = p.osm_key === 'place' ? String(p.name || '').trim() : '';
  const city = normalizeCity(rawCity || settlementName);
  const displayCity = rawCity || settlementName || city;
  // A feature name is a street only when OSM identifies it as a road.
  // Names of schools, shops and other POIs must not become street names.
  const street = p.street || (p.osm_key === 'highway' ? p.name : '') || '';
  if (!street && !city) return null;
  const isSettlement = !p.housenumber && (!street || (p.osm_key === 'place' && !p.street));
  return { city, address: [street, p.housenumber].filter(Boolean).join(', ') || displayCity, street, house: p.housenumber || '', lat, lon, country: p.countrycode || '', isSettlement, context: [p.district, p.state].filter(Boolean).join(', ') };
}

export function parseHouseDetails(value = '') {
  const parts = value.trim().split(/\s*,?\s*(?:подъезд|под[ьъ]езд|под\.|п-д)\s*/iu);
  return { house: parts[0].replace(/^(?:дом|д\.)\s*/iu, '').replace(/[,\s]+$/u, ''), entrance: parts.slice(1).join(' ').trim() };
}

// Обновляет дом, сохраняя подъезд при повторном выборе той же улицы.
export function mergeHouseDetails(currentDetails = '', nextHouse = '', sameStreet = false) {
  const current = parseHouseDetails(String(currentDetails || ''));
  const house = String(nextHouse || '').trim();

  if (!sameStreet) return house;

  return [
    house || current.house,
    current.entrance ? `подъезд ${current.entrance}` : ''
  ].filter(Boolean).join(', ');
}

export function completeAddress(point, details = '') {
  return [point.address, details].filter(Boolean).join(', ');
}

export function addressWithCity(point, details = '') {
  const address = completeAddress(point, details);
  if (normalizeCity(address).toLowerCase() === normalizeCity(point.city || '').toLowerCase()) return address;
  return address ? [address, point.city].filter(Boolean).join(', ') : '';
}

export function serviceWishes(note, service) {
  return [service.wish, note.trim()].filter(Boolean).join('. ').slice(0, 500);
}

// Only geography is sent to Photon; passenger contacts, entrance and notes stay out of requests.
// Requests are serialized, deduplicated and kept in memory for this page session.
function normalizeStreetAliasKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/(?:^|\s)(?:улица|ул\.?|көше|көшесі|проспект|пр-т|переулок|пер\.?)(?=\s|$)/giu, ' ')
    .replace(/\d+[а-яa-z]?/giu, ' ')
    .replace(/[^a-zа-яәіңғүұқөһ]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveStreetAlias(query, selectedCity) {
  const firstPart = String(query || '').split(',')[0].trim();
  const normalized = normalizeStreetAliasKey(firstPart);
  if (!normalized || !selectedCity) return null;

  const selectedKey = cityKey(normalizeCity(selectedCity));

  for (const entry of STREET_ALIASES_KZ) {
    if (cityKey(normalizeCity(entry.city)) !== selectedKey) continue;

    const matched = entry.aliases.some(alias => {
      const key = normalizeStreetAliasKey(alias);
      return key && (
        key === normalized ||
        key.startsWith(normalized) ||
        normalized.startsWith(key)
      );
    });

    if (matched) return entry;
  }

  return null;
}

export function createGeocoder({ fetcher = globalThis.fetch, baseUrl = 'https://photon.komoot.io', interval = 1100, timeout = 8000 } = {}) {
  const cache = new Map();
  let tail = Promise.resolve();
  let lastRequest = 0;

  function request(path, params) {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    if (cache.has(url)) return cache.get(url);

    const controller = new AbortController();
    let timer;

    const expiration = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Address lookup timed out'));
      }, timeout);
    });

    const work = tail.catch(() => {}).then(async () => {
      const delay = interval - (Date.now() - lastRequest);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      if (controller.signal.aborted) throw new Error('Address lookup expired in queue');

      lastRequest = Date.now();
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Address service unavailable');

      const body = await response.json();
      return (body.features || []).map(photonPoint).filter(Boolean);
    });

    const promise = Promise.race([work, expiration]).finally(() => clearTimeout(timer));
    cache.set(url, promise);
    tail = promise;
    promise.catch(() => cache.delete(url));

    if (cache.size > 120) cache.delete(cache.keys().next().value);
    return promise;
  }

  return {
    search: async (query, center = { lat: 50.132, lon: 82.533 }, selectedCity = '') => {
      let batches;
      let alias = null;

      if (selectedCity) {
        const canonicalCity = normalizeCity(selectedCity);
        alias = resolveStreetAlias(query, canonicalCity);

        const streetQuery = alias
          ? alias.canonical
          : String(query || '').trim();

        const cityVariants = canonicalCity === 'Усть-Каменогорск'
          ? ['Өскемен', 'Усть-Каменогорск']
          : [canonicalCity];

        batches = await Promise.all([...new Set(cityVariants)].map(city =>
          request('/structured', {
            city,
            street: streetQuery,
            countrycode: 'KZ',
            limit: '8'
          })
        ));
      } else {
        const variants = geocoderQueryVariants(query);
        batches = await Promise.all(variants.map(q => request('/api/', {
          q,
          limit: '8',
          lat: String(center.lat),
          lon: String(center.lon)
        })));
      }

      const seen = new Set();
      const merged = [];

      for (const point of batches.flat()) {
        // Для известного альтернативного названия оставляем только
        // реальные совпадения по названию улицы, а не соседние улицы.
        if (alias) {
          const allowedNames = [alias.canonical, ...alias.aliases]
            .map(normalizeStreetAliasKey)
            .filter(Boolean);

          if (!allowedNames.includes(normalizeStreetAliasKey(point.street))) {
            continue;
          }
        }

        const key = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(point);
        }
      }

      return merged.slice(0, 16);
    },

    reverse: (lat, lon) => request('/reverse', {
      lat: String(lat),
      lon: String(lon),
      limit: '1'
    })
  };
}
