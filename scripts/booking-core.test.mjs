import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_SERVICES, photonPoint, parseHouseDetails, normalizeCity, serviceWishes, createGeocoder, addressWithCity } from '../booking-core.js';

const feature = (city = 'Белоусовка', street = 'Юбилейная улица') => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [82.533, 50.132] }, properties: { city, street, housenumber: '8', countrycode: 'KZ' } });

test('origin keeps the settlement, street and house separate; settlements cannot silently become streets', () => {
  const point = photonPoint(feature());
  assert.equal(point.city, 'Белоусовка'); assert.equal(point.address, 'Юбилейная улица, 8');
  assert.equal(point.street, 'Юбилейная улица'); assert.equal(point.house, '8');
  assert.equal(photonPoint({ geometry: { coordinates: [82, 50] }, properties: { osm_key: 'place', name: 'Белоусовка' } }).isSettlement, true);
  assert.equal(photonPoint({ geometry: { coordinates: ['82', 50] } }), null);
  assert.equal(photonPoint({ geometry: { coordinates: [82, 190] } }), null);
});

test('same street in different cities remains distinguishable', () => {
  const first = photonPoint(feature('Белоусовка', 'Гоголя'));
  const second = photonPoint(feature('Усть-Каменогорск', 'Гоголя'));
  assert.notEqual(addressWithCity(first), addressWithCity(second));
  assert.equal(normalizeCity('Өскемен'), 'Усть-Каменогорск');
  assert.equal(normalizeCity('посёлок Белоусовка'), 'Белоусовка');
  assert.equal(normalizeCity('Уварово'), 'Уварово');
});

test('combined house and entrance are sent to the existing separate fields', () => {
  assert.deepEqual(parseHouseDetails('Дом 8А, подъезд 2'), { house: '8А', entrance: '2' });
  assert.deepEqual(parseHouseDetails('8/1'), { house: '8/1', entrance: '' });
  assert.deepEqual(parseHouseDetails('подъезд 3'), { house: '', entrance: '3' });
});

test('car category is an explicit wish; changing the service does not carry the former category', () => {
  const wagon = BOOKING_SERVICES.find(service => service.id === 'wagon');
  const minivan = BOOKING_SERVICES.find(service => service.id === 'minivan');
  assert.equal(serviceWishes('С багажом', wagon), 'Нужен универсал. С багажом');
  assert.equal(serviceWishes('С багажом', minivan), 'Нужен минивэн. С багажом');
  assert.equal(serviceWishes('С багажом', BOOKING_SERVICES[0]), 'С багажом');
  assert.equal(BOOKING_SERVICES.length, 10);
});

test('concurrent identical lookups are deduplicated and cities are included in cache keys', async () => {
  const urls = [];
  const geocoder = createGeocoder({ interval: 0, fetcher: async url => { urls.push(url); return { ok: true, json: async () => ({ features: [feature()] }) }; } });
  const [a, b] = await Promise.all([geocoder.search('Гоголя, Белоусовка'), geocoder.search('Гоголя, Белоусовка')]);
  assert.deepEqual(a, b); assert.equal(urls.length, 1);
  await geocoder.search('Гоголя, Усть-Каменогорск'); assert.equal(urls.length, 2);
  await geocoder.reverse(50.132, 82.533);
  assert.equal(new URL(urls[2]).searchParams.get('lat'), '50.132');
});

test('temporary geocoder failures can be retried and do not poison the request queue', async () => {
  let attempts = 0;
  const geocoder = createGeocoder({ interval: 0, fetcher: async () => ({ ok: ++attempts > 1, json: async () => ({ features: [feature()] }) }) });
  await assert.rejects(geocoder.search('Юбилейная, Белоусовка'));
  assert.equal((await geocoder.search('Юбилейная, Белоусовка')).length, 1);
  assert.equal(attempts, 2);
});

test('settlement and city-only results retain a readable address without duplicating the city', () => {
  const place = photonPoint({ geometry:{coordinates:[82,50]}, properties:{osm_key:'place',name:'Belousovka'} });
  assert.equal(addressWithCity(place),'Belousovka');
  const cityOnly = photonPoint({ geometry:{coordinates:[82,50]}, properties:{city:'Белоусовка'} });
  assert.equal(cityOnly.address,'Белоусовка');assert.equal(addressWithCity(cityOnly),'Белоусовка');
  assert.equal(addressWithCity({address:'Жукова',city:'Белоусовка'}),'Жукова, Белоусовка');
});

test('stalled and queued requests have a total deadline, are evicted and can be retried', async () => {
  let fail=true, calls=0;
  const geocoder=createGeocoder({interval:0,timeout:30,fetcher:async()=>{
    calls++;if(fail)return new Promise(()=>{});return {ok:true,json:async()=>({features:[feature()]})};
  }});
  const results=await Promise.allSettled([geocoder.search('first'),geocoder.search('second')]);
  assert.ok(results.every(result=>result.status==='rejected'));
  fail=false;
  assert.equal((await geocoder.search('first')).length,1,'expired cached promise is replaced');
  assert.ok(calls<=3);
});
