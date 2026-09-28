import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { initClientHome } from '../../client-home.js';
import { initCarpoolClient } from '../../carpool-ui.js';
import { initCarpoolWork } from '../../carpool-work.js';
import { createCarpoolBookings } from '../../carpool-bookings.js';
import { createPassengerRequests } from '../../passenger-request-store.js';
const dom = new JSDOM(await readFile('../../index.html', 'utf8'), { url: 'https://example.test/', pretendToBeVisual: true });
for (const key of ['window','document','MutationObserver','Option','HTMLElement','FormData','Event']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) });
window.openModal = id => document.getElementById(id)?.classList.add('active'); window.closeModal = id => document.getElementById(id)?.classList.remove('active');
window.initSimulationMap = async () => {}; window.scrollTo = () => {}; window.confirm = () => true; window.HTMLElement.prototype.scrollIntoView = () => {};
for (const name of ['Taxi','Delivery','Cargo','Sober']) window[`update${name}Price`] = () => {};
const flush = () => new Promise(resolve => setTimeout(resolve, 25)), stamp = minutes => ({ seconds: (Date.now() + minutes * 60000) / 1000 });
const click = (root, text) => { const control = [...root.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(control, text); control.click(); };
const trip = { id: 'ride1', status: 'open', fromCity: 'Белоусовка', toCity: 'Усть-Каменогорск', driverName: 'Александр', driverId: '30', car: 'Лада Веста', departureAt: stamp(90), pickup: 'Автостанция', dropoff: 'Центр', availableSeats: 4, totalSeats: 4, seatPrice: 1500 };
let requestRows = [], publishRequests, publishBookings, publishDemand, tripFilters, demandCount, readContact, authUser = { uid: 'client' };
const authListeners = new Set(), commands = [], reads = [];
const api = {
 onUser(cb) { authListeners.add(cb); cb(authUser); return () => authListeners.delete(cb); }, user: async () => authUser,
 ready: async () => true, hubReady: async () => true, simpleJourneyReady: async () => true,
 watchMyRequests(uid, cb) { publishRequests = cb; cb(requestRows); return () => {}; },
 watchMine(uid, cb) { publishBookings = cb; cb([]); return () => {}; },
 watchTrips(filters, cb) { tripFilters = filters; cb(filters.fromKey ? [trip] : [trip, { ...trip, id: 'ride2', fromCity: 'Глубокое', toCity: 'Риддер', departureAt: stamp(1440) }]); return () => {}; },
 watchDriverTrips(uid, cb) { cb([]); return () => {}; }, watchPassengers(trip, admin, cb) { cb([]); return () => {}; },
 watchRequests(count, cb) { demandCount = count; publishDemand = cb; cb(requestRows); return () => {}; },
 async read(name, id) { reads.push(name); return readContact ? await new Promise(resolve => { readContact = resolve; }) : { name: '<img src=x onerror=alert(1)>', phone: '+77000000002', driverPhone: '+77000000001' }; },
 async command(data) { commands.push(data); if (data.action === 'createRequest') { requestRows = [{ ...data, id: 'request1', clientUid: authUser.uid, status: 'open', departureAt: { seconds: data.departureMs / 1000 } }]; publishRequests(requestRows); return { requestId: 'request1' }; }
  if (data.action === 'book') { requestRows = requestRows.map(row => ({ ...row, status: 'matched', bookingId: 'b1' })); publishRequests(requestRows); publishBookings([{ ...trip, id: 'b1', status: 'confirmed', tripId: trip.id, clientUid: authUser.uid, seats: data.seats, amount: data.seats * 1500 }]); return { bookingId: 'b1' }; }
  return {}; }
};
const bookings = createCarpoolBookings(), requests = createPassengerRequests();
initBookingScreen(); initClientHome({ bookingsStore: bookings, requestsStore: requests });
const host = document.getElementById('carpoolClient'), ui = initCarpoolClient(host, api, bookings, requests);
try {
 document.querySelector('[data-home-carpool-open]').click(); await flush();
 assert.equal(window.bookingScreen.isCarpool(), true); assert.equal(tripFilters.fromKey, undefined); assert.equal(tripFilters.end, undefined);
 assert.equal(host.querySelectorAll('form[data-trip]').length, 2);
 const form = host.querySelector('.carpool-request-create form'); form.closest('details').open = true;
 const local = new Date(Date.now() + 6 * 3600000).toISOString().slice(0,16);
 for (const [name, value] of Object.entries({ fromCity: 'Белоусовка', toCity: 'Усть-Каменогорск', departure: local, seats: '2', name: '<img src=x onerror=alert(1)>', phone: '+77000000002' })) form.elements[name].value = value;
 form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
 assert.equal(commands[0].action, 'createRequest'); assert.equal(commands[0].seats, 2); assert.equal(commands[0].departureMs, Date.parse(local + ':00+05:00'));
 assert.ok(document.querySelector('[data-home-requests] [data-passenger-request="request1"]')); assert.equal(host.querySelector('img'), null);
 assert.equal(document.querySelector('[data-home-trip-count]').textContent, '1');
 document.getElementById('bookingClose').click(); document.querySelector('[data-home-requests] button').click(); await flush();
 assert.equal(document.activeElement.dataset.requestId, 'request1');
 click(host.querySelector('#carpoolMyRequests'), 'Посмотреть рейсы'); await flush();
 assert.equal(tripFilters.fromKey, 'белоусовка'); assert.equal(tripFilters.toKey, 'усть каменогорск'); assert.ok(tripFilters.end > tripFilters.start);
 click(host, 'Забронировать места'); const book = host.querySelector('form[data-trip]'); assert.equal(book.elements.count.value, '2');
 book.elements.name.value = 'Пассажир'; book.elements.phone.value = '+77000000002'; book.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
 assert.equal(commands.at(-1).requestId, 'request1'); assert.equal(commands.at(-1).action, 'book'); assert.equal(document.querySelector('[data-home-requests]').hidden, true);
 assert.equal(document.querySelector('[data-home-trip-count]').textContent, '1'); assert.ok(document.querySelector('[data-home-carpool] button'));
 const late = publishRequests; authUser = null; for (const cb of authListeners) cb(null); await flush(); late([{ ...requestRows[0], status: 'open' }]);
 assert.equal(requests.getState().requests.length, 0); assert.equal(document.querySelector('[data-home-requests]').hidden, true);
 requestRows = [{ id: 'd1', status: 'open', fromCity: 'Глубокое', toCity: 'Усть-Каменогорск', departureAt: stamp(60), seats: 2 }];
 const workHost = document.createElement('section'); document.body.append(workHost); const work = initCarpoolWork(workHost, api);
 const profile = { status: 'active', carpoolEnabled: true, passengerEnabled: true, name: 'Водитель', passengerSeats: 4 };
 await work.setContext({ uid: 'driver' }, profile); click(workHost, 'Заявки от пассажиров'); await flush();
 assert.equal(demandCount, 50); assert.ok(workHost.querySelector('[data-request-id="d1"]')); assert.equal(reads.includes('passenger_request_contacts'), false);
 click(workHost, 'Связаться с пассажиром'); await flush(); assert.ok(workHost.querySelector('a[href="tel:+77000000002"]')); assert.equal(workHost.querySelector('img'), null);
 publishDemand([]); assert.equal(workHost.querySelector('a[href="tel:+77000000002"]'), null);
 publishDemand(requestRows); readContact = true; click(workHost, 'Связаться с пассажиром'); await flush(); const resolve = readContact;
 await work.setContext({ uid: 'driver' }, { ...profile, carpoolEnabled: false }); resolve({ name: 'Private', phone: '+77000000003' }); await flush();
 assert.equal(workHost.querySelector('[data-request-id]'), null); assert.equal(workHost.querySelector('a[href="tel:+77000000003"]'), null); work.destroy();
 // Dispatcher access checks also reuse their module after stopAdminPanel().
 const adminHost=document.createElement('section');document.body.append(adminHost);
 const adminWork=initCarpoolWork(adminHost,{...api,watchAdminTrips(cb){cb([]);return()=>{};}},true);
 const dispatcherSource=await readFile('../../dispatcher.js','utf8');
 const stopSource=dispatcherSource.slice(dispatcherSource.indexOf('function stopAdminPanel()'),dispatcherSource.indexOf('async function checkAdminAccess('));
 const noOp=()=>{};
 const adminContext=vm.createContext({dispatcherCarpool:adminWork,unsubscribeDrivers:null,unsubscribeDriverStates:null,unsubscribeOrders:null,unsubscribeOrderContacts:null,
   stopDriverMessagesListener:noOp,driverStatusRefreshTimer:null,closeDriverSummary:noOp,closeDriverOrdersReport:noOp,setOnlineOrdersSectionCollapsed:noOp,
   setHidden:noOp,setMessage:noOp,elements:{},clearInterval});
 vm.runInContext(stopSource,adminContext);
 for(const uid of ['admin-a','admin-a','admin-b']){
   vm.runInContext('stopAdminPanel()',adminContext);
   await adminWork.setContext({uid});click(adminHost,'Заявки от пассажиров');await flush();
   assert.ok(adminHost.querySelector('h2'),'admin access check preserves demand UI');
   assert.ok(adminHost.querySelector('[data-request-id="d1"]'),'admin sees passenger demand after access check');
   const late=publishDemand;vm.runInContext('stopAdminPanel()',adminContext);late(requestRows);
   assert.equal(adminHost.querySelector('[data-request-id]'),null,'admin logout clears demand and rejects late data');
 }
 adminWork.destroy();
 console.log('PASS: all-direction live feed, request creation, Kazakhstan time, visible home request, linked booking, private driver demand, revoked access and account changes');
} finally { ui.destroy(); bookings.destroy(); requests.destroy(); await new Promise(resolve => setTimeout(resolve, 180)); dom.window.close(); }
