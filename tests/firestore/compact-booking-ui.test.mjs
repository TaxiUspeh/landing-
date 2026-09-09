import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url:'https://example.test/', pretendToBeVisual:true });
for (const key of ['window','document','MutationObserver','Option','HTMLElement']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value:dom.window.navigator, configurable:true });
const requests = [];
Object.defineProperty(navigator, 'geolocation', { value:{ getCurrentPosition:(success,error)=>requests.push({success,error}) }, configurable:true });
window.openModal = () => {}; window.closeModal = () => {};
window.initSimulationMap = async () => {};
window.updateTaxiPrice = () => {}; window.updateDeliveryPrice = () => {}; window.updateCargoPrice = () => {};
const point = { type:'Feature', geometry:{type:'Point',coordinates:[82.53,50.13]}, properties:{city:'Белоусовка',street:'Жукова',housenumber:'20',countrycode:'KZ'} };
let reverseResolve;
globalThis.fetch = async () => new Promise(resolve => { reverseResolve = () => resolve({ ok:true, json:async()=>({features:[point]}) }); });
const get = id => document.getElementById(id);
const select = id => document.querySelector('[data-booking-service="' + id + '"]').click();
const flush = () => new Promise(resolve=>setTimeout(resolve,0));
const position = {coords:{latitude:50.13,longitude:82.53,accuracy:20}};
get('taxiCustomerPhone').value = '+7 700 000 00 00';
const originalPhone = get('taxiCustomerPhone'), originalOtherPhone = get('passengerPhone');
initBookingScreen(); window.openModal('taxiModal');
assert.equal(get('taxiCustomerPhone'),originalPhone);
assert.equal(get('passengerPhone'),originalOtherPhone);
assert.equal(get('passengerPhone').form,get('taxiForm'));
assert.equal(originalPhone.closest('details').open,false,'Valid saved contact is compact');
assert.equal(get('taxiCustomerName').closest('details').open,false);
assert.equal(get('bookingExtras').open,false);
assert.equal(get('bookingServiceTypes').children.length,4);
assert.equal(get('bookingCarCategories').children.length,3);
assert.equal(get('bookingMoreServices').hidden,true);
assert.equal(get('bookingSubmit').textContent,'Указать маршрут');
get('bookingSubmit').click();
assert.equal(get('bookingPicker').hidden,false);
assert.equal(get('bookingPickerTitle').textContent,'Откуда');
get('bookingPickerBack').click();

// Changing a category must not invalidate geolocation; only editing the origin does.
select('minivan');
requests[0].success(position); await flush(); reverseResolve(); await flush();
assert.match(get('bookingFromValue').textContent,/Жукова/);
assert.match(get('bookingLocationStatus').textContent,/Адрес определён/);
requests[0].error(); await flush();
assert.match(get('bookingLocationStatus').textContent,/Адрес определён/,'Late location error must not erase a good address');
assert.equal(get('mapOverlayText').textContent,'Подбор водителя после заказа');
assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory,'minivan');

// Independent mode and category: a scheduled minivan remains both scheduled and minivan.
get('bookingMoreToggle').click(); assert.equal(get('bookingMoreServices').hidden,false);
select('preorder');
const date = new Date(Date.now()+86400000); date.setMinutes(date.getMinutes()-date.getTimezoneOffset());
get('taxiDateTime').value = date.toISOString().slice(0,16);
select('wagon'); assert.equal(get('taxiDateTime').disabled,false);
assert.ok(get('taxiDateTime').value);
assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory,'wagon');
select('minivan'); get('bookingPassengerCount').value = '7'; get('bookingPassengerCount').dispatchEvent(new window.Event('input'));
assert.equal(window.bookingScreen.vehicleRequest().passengerCount,7);
assert.equal(get('taxiDateTime').disabled,false);
select('delivery'); assert.equal(get('bookingCarCategories').hidden,true);
assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory,'sedan');
assert.equal(get('taxiDateTime').disabled,true);
select('auction'); assert.equal(get('bookingCarCategories').hidden,true);
get('bookingTaxiType').click(); assert.equal(get('bookingCarCategories').hidden,false);

// Do not let an older reverse-geocoder response replace a manually entered origin.
get('bookingLocate').click();
requests.at(-1).success({coords:{latitude:50.14,longitude:82.54,accuracy:20}}); await flush();
const lateResolve = reverseResolve;
get('bookingFrom').click(); get('bookingSearchCity').value='Глубокое'; get('bookingSearchInput').value='Центральная, 8'; get('bookingManualAddress').click();
lateResolve(); await flush();
assert.equal(get('bookingFromValue').textContent,'Центральная, 8');
assert.match(get('bookingLocationStatus').textContent,/Место подачи выбрано/);

// Required phone opens before any online handler is called.
window.repeatOrder('Жукова, 20 (Белоусовка)','Центральная, 8 (Глубокое)');
originalPhone.value = ''; originalPhone.dispatchEvent(new window.Event('input'));
assert.equal(originalPhone.closest('details').open,true);
assert.equal(get('bookingSubmit').textContent,'Указать телефон');
let sent = 0; get('taxi-online-order-button').addEventListener('click',()=>sent++);
get('bookingSubmit').click(); assert.equal(sent,0);
assert.equal(document.activeElement,originalPhone);
originalPhone.value='+7 700 000 00 00'; originalPhone.dispatchEvent(new window.Event('input'));
get('bookingExtras').open=true; get('bookingNote').value='У второго подъезда'; get('bookingNote').dispatchEvent(new window.Event('input'));
get('bookingExtras').open=false;
select('delivery'); select('taxi');
assert.equal(get('bookingNote').value,'У второго подъезда');
assert.match(get('taxiWishes').value,/У второго подъезда/);
assert.equal(get('bookingSubmit').textContent,'Заказать онлайн');
get('bookingSubmit').click(); assert.equal(sent,1);
assert.equal(get('bookingFooter').parentElement,get('bookingBody'));
assert.equal(get('bookingWhatsapp'),null);
const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
assert.equal(ids.length,new Set(ids).size);
console.log('PASS: compact contact, categories with preorder, location races, first missing field, retained wishes and online handler');
await new Promise(resolve => setTimeout(resolve,1100));
assert.equal(get('bookingSubmit').disabled,false,'Online button is released after submission');
dom.window.close();
