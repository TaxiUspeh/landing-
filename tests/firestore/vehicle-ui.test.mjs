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
assert.equal(get('bookingSubmit').hidden, false); assert.equal(get('bookingWhatsapp').hidden, false);
select('taxi'); assert.equal(window.bookingScreen.vehicleRequest().passengerCount, 1); assert.equal(get('bookingPassengerCountField').hidden, true);
select('auction'); assert.equal(get('bookingWhatsapp').hidden, true);
const controls = createVehicleControls(); document.body.append(controls.element);
const checks = controls.element.querySelectorAll('input[type=checkbox]'); assert.equal(checks[0].disabled, true); assert.equal(checks[0].checked, true);
checks[2].checked = true; checks[2].dispatchEvent(new window.Event('change'));
const seats = controls.element.querySelector('input[type=number]'); assert.equal(seats.min, '5');
assert.equal(validVehicleProfile(controls.read().serviceCategories, controls.read().passengerSeats), false);
seats.value = '7'; assert.equal(validVehicleProfile(controls.read().serviceCategories, controls.read().passengerSeats), true);
controls.reset(); assert.equal(controls.read().passengerSeats, 4); assert.equal(checks[2].checked, false);
await new Promise(resolve => setTimeout(resolve, 200)); dom.window.close();
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
const context = vm.createContext({ document: dispatcher.window.document, elements, calculateCategoryFare, formatCategoryFare, categoryLabel, driverCanServeOrder,
 drivers: [{ id:'1',authUid:'uid1',status:'active',name:'Sedan' }, { id:'2',authUid:'uid2',status:'active',name:'Minivan',serviceCategories:['sedan','minivan'],passengerSeats:7 }],
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
