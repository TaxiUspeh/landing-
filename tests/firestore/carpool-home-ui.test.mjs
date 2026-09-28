import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { initClientHome } from '../../client-home.js';
import { initCarpoolClient } from '../../carpool-ui.js';
import { createCarpoolBookings } from '../../carpool-bookings.js';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const stamp = offset => ({ seconds: (Date.now() + offset * 60000) / 1000 });
const booking = { id: 'near', tripId: 't1', clientUid: 'passenger', status: 'confirmed',
  fromCity: 'Белоусовка', toCity: 'Усть-Каменогорск', departureAt: stamp(60), createdAt: stamp(-10),
  seats: 2, amount: 3000, driverName: 'Водитель', car: 'Лада', pickup: 'Автостанция', dropoff: 'Центр' };
const later = { ...booking, id: 'later', tripId: 't2', departureAt: stamp(120) };
const past = { ...booking, id: 'past', tripId: 't0', status: 'completed', departureAt: stamp(-60) };

async function setup() {
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'MutationObserver', 'Option', 'HTMLElement', 'FormData', 'Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) });
  window.openModal = id => document.getElementById(id)?.classList.add('active');
  window.closeModal = id => document.getElementById(id)?.classList.remove('active'); window.initSimulationMap = async () => {};
  window.scrollTo = () => {}; window.confirm = () => true; window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const name of ['Taxi', 'Delivery', 'Cargo', 'Sober']) window[`update${name}Price`] = () => {};
  let next, authChanged, fail, watches = 0;
  const api = {
    onUser(callback) { authChanged = callback; callback({ uid: 'passenger' }); return () => {}; },
    user: async () => ({ uid: 'passenger' }), ready: async () => true,
    watchMine(uid, callback, error) { assert.equal(uid, 'passenger'); watches++; next = callback; fail = error; return () => {}; },
    watchTrips(filters, callback) { callback([]); return () => {}; },
    read: async name => { assert.notEqual(name, 'carpoolBoardingCodes'); return { driverPhone: '+77000000001' }; },
    command: async () => ({}),
  };
  const store = createCarpoolBookings(); initBookingScreen();
  const ui = initCarpoolClient(document.getElementById('carpoolClient'), api, store);
  await flush(); next([later, past, booking]); await flush();
  // Home initializes after the initial snapshot: it must replay it immediately.
  initClientHome({ bookingsStore: store });
  return { dom, ui, store, get watches() { return watches; }, next: rows => next(rows), fail: () => fail(new Error('offline')),
    logout: () => authChanged(null),
    async close() { ui.destroy(); store.destroy(); await new Promise(resolve => setTimeout(resolve, 180)); dom.window.close(); } };
}

let f = await setup();
const query = selector => document.querySelector(selector), get = id => document.getElementById(id);
assert.equal(window.bookingScreen.isOpen(), false);
assert.equal(f.watches, 1, 'Already watches bookings before carpool section is opened');
assert.equal(query('[data-home-carpool]').hidden, false);
assert.equal(query('[data-home-carpool-booking]'), null);
assert.equal(query('[data-home-carpool] [data-carpool-booking]').dataset.carpoolBooking, 'near');
assert.equal(query('[data-home-trip-count]').textContent, '2');
assert.equal(query('[data-home-trip-count]').hidden, false);
assert.doesNotMatch(get('carpoolClient').textContent, /Код посадки/);
const services = [...document.querySelectorAll('.home-service-grid [data-home-service]')].map(node => node.dataset.homeService);
assert.deepEqual(services.slice(0, 4), ['taxi', 'wagon', 'intercity', 'minivan']);
query('[data-home-all-trips]').click();
assert.equal(query('[data-home-page="trips"]').hidden, false);
assert.deepEqual([...query('[data-home-carpool-trips]').children].filter(node => node.dataset.carpoolBooking).map(node => node.dataset.carpoolBooking), ['near', 'later']);
assert.match(query('[data-home-carpool-trips] summary').textContent, /История попуток · 1/);

// A normal taxi order must coexist with carpool and remain accessible afterward.
get('taxi-online-order-panel').classList.remove('hidden'); get('taxi-online-new-order-button').classList.add('hidden');
get('taxi-online-order-status').textContent = 'Ищем водителя'; await flush();
assert.equal(query('[data-home-trip-count]').textContent, '3');
const detail = query('#carpoolMyBookings [data-booking-id="later"]');
let focusAttempts = 0;
detail.focus = options => { if (focusAttempts++ > 0) window.HTMLElement.prototype.focus.call(detail, options); };
query('[data-home-carpool-trips] [data-carpool-booking="later"]').click(); await new Promise(resolve => setTimeout(resolve, 50));
assert.equal(window.bookingScreen.isCarpool(), true);
assert.equal(document.activeElement.dataset.bookingId, 'later', 'Opens the selected booking directly');
assert.ok(focusAttempts > 1, 'Retries focus after the opening visibility transition');
assert.equal(get('bookingFooter').hidden, true);
assert.equal(f.watches, 1);
get('bookingClose').click(); query('[data-home-current] button').click();
assert.equal(window.bookingScreen.isCarpool(), false, 'Taxi summary opens the ordinary order');
assert.equal(get('carpoolClient').hidden, true); get('bookingClose').click();

f.next([{ ...booking, status: 'in_trip' }, later, past]); await flush();
assert.match(query('[data-home-carpool]').textContent, /В пути/);
assert.equal(query('[data-home-trip-count]').textContent, '3');
f.next([{ ...booking, status: 'cancelled' }, later, past]); await flush();
assert.equal(query('[data-home-carpool] [data-carpool-booking]').dataset.carpoolBooking, 'later');
assert.equal(query('[data-home-trip-count]').textContent, '2');
assert.match(query('[data-home-carpool-message]').textContent, /бронь отменена/);
assert.match(query('[data-home-carpool-trips] summary').textContent, /История попуток · 2/);
f.fail(); await flush(); assert.match(query('[data-home-carpool-message]').textContent, /последние полученные/);
assert.equal(query('[data-home-carpool]').hidden, false, 'Connection failure does not silently erase booking');
f.logout(); await flush();
assert.equal(query('[data-home-carpool]').hidden, true);
assert.equal(query('[data-home-carpool-message]').hidden, true);
assert.equal(query('[data-home-carpool-trips]').hidden, true);
assert.equal(query('[data-home-trip-count]').textContent, '1', 'Only ordinary order remains');
await f.close();

// Simulate a fresh page with the same restored account: no section click is needed.
f = await setup();
assert.equal(query('[data-home-carpool] [data-carpool-booking]').dataset.carpoolBooking, 'near');
query('[data-home-carpool] [data-carpool-booking]').click(); await flush(); get('bookingClose').click();
query('[data-home-service="minivan"]').click();
assert.equal(window.bookingScreen.isCarpool(), false, 'Minivan tile returns to its own form after carpool details');
assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory, 'minivan'); get('bookingClose').click();
f.next([{ ...booking, fromCity: '<img src=x onerror=alert(1)>', status: 'completed' }]); await flush();
assert.equal(query('[data-home-carpool]').hidden, true);
assert.equal(query('[data-home-trip-count]').hidden, true);
assert.equal(query('[data-home-carpool-trips] img'), null);
assert.match(query('[data-home-carpool-trips]').textContent, /Поездка завершена/);
await f.close();
console.log('PASS: restored bookings on home, nearest-first cards, combined trip count, direct details, cancellations, history, privacy and service order');
