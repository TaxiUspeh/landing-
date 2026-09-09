import { createFinanceControls } from '../../driver-finance-controls.js';
import { NEW_DRIVER_FINANCE } from '../../driver-finance.js';
import { hasOrderFunds, fundingFor } from '../../driver-finance.js';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createVehicleControls } from '../../vehicle-category-controls.js';
import { initBookingScreen } from '../../booking-screen.js';
import { driverCanServeOrder, validVehicleProfile, calculateCategoryFare, formatCategoryFare, categoryLabel } from '../../vehicle-categories.js';
const dom = new JSDOM(await readFile('../../index.html', 'utf8'), { url: 'https://example.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'MutationObserver', 'Option', 'HTMLElement']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.openModal = () => {}; window.closeModal = () => {}; window.initSimulationMap = async () => {};
window.updateTaxiPrice = () => {}; window.updateDeliveryPrice = () => {}; window.updateCargoPrice = () => {};
initBookingScreen(); window.openModal('taxiModal');
const get = id => document.getElementById(id);
const select = category => document.querySelector(`[data-booking-service="${category}"]`).click();
select('wagon'); assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory, 'wagon');
assert.ok(get('bookingServiceHelp').textContent.includes('+20%')); assert.equal(get('bookingPassengerCountField').hidden, true);
select('minivan'); assert.equal(get('bookingPassengerCountField').hidden, false); assert.ok(get('bookingServiceHelp').textContent.includes('+50%'));
get('bookingPassengerCount').value = '7'; get('bookingPassengerCount').dispatchEvent(new window.Event('input'));
assert.equal(window.bookingScreen.vehicleRequest().passengerCount, 7);
assert.ok(get('taxiCustomerPhone').closest('label').textContent.trim().length);
assert.equal(get('bookingSubmit').hidden, false); assert.equal(get('bookingWhatsapp'), null);
select('taxi'); assert.equal(window.bookingScreen.vehicleRequest().passengerCount, 1); assert.equal(get('bookingPassengerCountField').hidden, true);
select('auction'); assert.equal(get('bookingWhatsapp'), null);

// Gesture bounds use the footer's measured height, including wrapped text.
window.innerWidth = 360; window.innerHeight = 760;
const overlay = get('mapModal'), grip = get('bookingGrip'), scroll = get('bookingScroll');
get('bookingBody').getBoundingClientRect = () => ({ height:704 });
get('bookingFooter').getBoundingClientRect = () => ({ height:130 });
grip.getBoundingClientRect = () => ({ height:44 });
get('bookingMapHost').getBoundingClientRect = () => ({ height:overlay.classList.contains('booking-collapsed') ? 530 : 183 });
window.dispatchEvent(new window.Event('resize'));
get('bookingDetails').value = '20, подъезд 4'; get('bookingDetails').dispatchEvent(new window.Event('input'));
get('taxiCustomerPhone').value = '+7 700 000 00 00';
function pointer(type, y) {
 const event = new window.Event(type, { bubbles:true, cancelable:true });
 Object.assign(event, { pointerId:1, clientY:y, isPrimary:true, button:0 }); grip.dispatchEvent(event);
}
pointer('pointerdown',200); pointer('pointermove',1100);
assert.equal(get('bookingBody').style.getPropertyValue('--booking-map-size'), '530px');
pointer('pointerup',1100);
assert.equal(grip.getAttribute('aria-expanded'),'false'); assert.equal(scroll.inert,true);
assert.equal(get('bookingFooter').parentElement,get('bookingBody'));
assert.equal(get('bookingFooter').hidden,false);
grip.dispatchEvent(new window.MouseEvent('click',{detail:1}));
assert.equal(grip.getAttribute('aria-expanded'),'false', 'synthetic click must not undo the drag');
pointer('pointerdown',590); pointer('pointermove',210); pointer('pointerup',210);
assert.equal(grip.getAttribute('aria-expanded'),'true'); assert.equal(scroll.inert,false);
assert.equal(get('bookingDetails').value,'20, подъезд 4');
assert.equal(get('taxiCustomerPhone').value,'+7 700 000 00 00');
pointer('pointerdown',200); pointer('pointermove',650); pointer('pointercancel',650);
assert.equal(grip.getAttribute('aria-expanded'),'true');
get('taxiCustomerPhone').focus(); grip.click();
assert.equal(document.activeElement,grip); assert.equal(scroll.inert,true);
window.innerWidth = 1024; window.dispatchEvent(new window.Event('resize'));
assert.equal(grip.hidden,true); assert.equal(scroll.inert,false);
window.innerWidth = 360; window.dispatchEvent(new window.Event('resize'));
assert.equal(grip.hidden,false); grip.click();
console.log('PASS: drag bounds, cancelled gestures, keyboard, retained fields and desktop resize');

// A real form submission (including Enter) must never reach the legacy WhatsApp handler.
select('taxi');
window.repeatOrder('Жукова, 20 (Белоусовка)', 'Карла Маркса, 76 (Белоусовка)');
get('taxiCustomerPhone').value = '+7 700 000 00 00';
let onlineRequests = 0, legacyRequests = 0;
get('taxi-online-order-button').addEventListener('click', () => onlineRequests++);
get('taxiForm').addEventListener('submit', () => legacyRequests++);
const submitEvent = new window.Event('submit', { bubbles:true, cancelable:true });
get('taxiForm').dispatchEvent(submitEvent);
assert.equal(submitEvent.defaultPrevented, true);
assert.equal(onlineRequests, 1); assert.equal(legacyRequests, 0);
for (const service of ['cargo', 'soberDriver', 'assistance']) {
 select(service);
 assert.equal(get('bookingSubmit').disabled, true);
 assert.equal(get('bookingSubmit').textContent, 'Онлайн-заказ пока недоступен');
 assert.equal(get('bookingWhatsapp'), null);
}
console.log('PASS: online-only booking and Enter; unavailable services are explicit');

const controls = createVehicleControls(); document.body.append(controls.element);
const checks = controls.element.querySelectorAll('input[type=checkbox]'); assert.equal(checks[0].disabled, true); assert.equal(checks[0].checked, true);
checks[2].checked = true; checks[2].dispatchEvent(new window.Event('change'));
const seats = controls.element.querySelector('input[type=number]'); assert.equal(seats.min, '5');
assert.equal(validVehicleProfile(controls.read().serviceCategories, controls.read().passengerSeats), false);
seats.value = '7'; assert.equal(validVehicleProfile(controls.read().serviceCategories, controls.read().passengerSeats), true);
controls.reset(); assert.equal(controls.read().passengerSeats, 4); assert.equal(checks[2].checked, false);
const financial = createFinanceControls(NEW_DRIVER_FINANCE); document.body.append(financial.element);
assert.deepEqual(financial.read(), { commissionRate:20, debtMode:'none', debtLimit:0 });
const rate = financial.element.querySelector('input'); const mode = financial.element.querySelector('select'); const limit = financial.element.querySelectorAll('input')[1];
rate.value='5'; mode.value='limited'; mode.dispatchEvent(new window.Event('change')); limit.value='500';
assert.deepEqual(financial.read(), { commissionRate:5, debtMode:'limited', debtLimit:500 }); assert.equal(limit.disabled,false);
rate.value='101'; assert.throws(()=>financial.read()); rate.value='0'; assert.equal(financial.read().commissionRate,0);
mode.value='unlimited'; mode.dispatchEvent(new window.Event('change')); assert.equal(limit.disabled,true); assert.equal(financial.read().debtLimit,0);
financial.reset(); assert.equal(financial.read().commissionRate,20); assert.equal(financial.read().debtMode,'none');
console.log('PASS: editable finance controls, limits and defaults');
await new Promise(resolve => setTimeout(resolve, 1100)); dom.window.close();
console.log('PASS: category labels, passenger field, channels and dispatcher profile controls');
const dispatcher = new JSDOM(await readFile('../../dispatcher.html', 'utf8'));
const source = await readFile('../../dispatcher.js', 'utf8');
function extract(name) {
 const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
 const tail = source.slice(start), next = tail.slice(1).search(/\n(?:async )?function /);
 return next < 0 ? tail : tail.slice(0, next + 1);
}
const keys = ['ServiceType','PriceFrom','PriceTo','PriceFromLabel','PriceToLabel','Driver','From','To','Stops','Wishes','ScheduledFor'];
const elements = Object.fromEntries(keys.map(key => ['phoneOrder'+key, dispatcher.window.document.getElementById('phone-order-'+key.replace(/[A-Z]/g, (c, i) => (i ? '-' : '')+c.toLowerCase()))]));
for (const [key, el] of Object.entries(elements)) assert.ok(el, key);
const context = vm.createContext({ document: dispatcher.window.document, elements, hasOrderFunds, fundingFor, calculateCategoryFare, formatCategoryFare, categoryLabel, driverCanServeOrder,
 drivers: [{ id:'1',authUid:'uid1',status:'active',balance:0,name:'Sedan' }, { id:'2',authUid:'uid2',status:'active',balance:0,name:'Minivan',serviceCategories:['sedan','minivan'],passengerSeats:7 }],
 normalizeUid: x => x, driverAvailabilityInfo: () => ({key:'available'}),
 DISPATCHER_ORDER_SERVICES: {taxi:{label:'Такси',route:true,stops:true,fromLabel:'Откуда *',toLabel:'Куда *'}}
});
const names = ['phoneVehicleRequest','syncPhoneVehicleCategory','currentPhoneOrderService','populatePhoneOrderDrivers','manualAssignmentCandidates','manualAssignmentOptionLabel','phoneOrderStops','parseOrderPrice','formatOrderPrice','standardPhoneOrderPrice','createPhoneOrderPayload'];
vm.runInContext(names.map(extract).join('\n'), context);
elements.phoneOrderServiceType.value='taxi'; elements.phoneOrderFrom.value='A'; elements.phoneOrderTo.value='B'; elements.phoneOrderPriceFrom.value='800'; elements.phoneOrderPriceTo.value='1000';
dispatcher.window.document.getElementById('phone-order-vehicle-category').value='minivan'; dispatcher.window.document.getElementById('phone-order-passenger-count').value='7';
vm.runInContext('syncPhoneVehicleCategory()',context);
assert.equal(elements.phoneOrderDriver.options.length,2);
const payload=vm.runInContext('createPhoneOrderPayload()',context);
assert.equal(payload.priceAmount,1500); assert.equal(payload.basePriceMax,1000); assert.equal(payload.passengerCount,7); assert.equal(payload.vehicleCategory,'minivan');
assert.ok(dispatcher.window.document.getElementById('phone-order-category-quote').textContent.includes('1500'));
assert.equal(elements.phoneOrderPriceTo.value,'1000');
dispatcher.window.document.getElementById('phone-order-passenger-count').value='8'; vm.runInContext('syncPhoneVehicleCategory()',context); assert.equal(elements.phoneOrderDriver.options.length,1);
dispatcher.window.close(); console.log('PASS: dispatcher quote, payload and seating filter');
