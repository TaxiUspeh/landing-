import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initBookingScreen } from '../../booking-screen.js';
import { initClientHome } from '../../client-home.js';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'MutationObserver', 'Option', 'HTMLElement']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const opened = [];
window.openModal = id => { opened.push(id); document.getElementById(id)?.classList.add('active'); };
window.closeModal = id => document.getElementById(id)?.classList.remove('active');
window.initSimulationMap = async () => {};
window.updateTaxiPrice = () => {}; window.updateDeliveryPrice = () => {}; window.updateCargoPrice = () => {};
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
const get = id => document.getElementById(id);
const click = selector => { const node = document.querySelector(selector); assert.ok(node, selector); node.click(); };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const originals = ['taxiForm', 'taxiCustomerPhone', 'deliveryForm', 'auctionForm', 'busScheduleModal', 'stroyDomModal', 'techInspectionModal', 'insuranceModal'].map(id => [id, get(id)]);
initBookingScreen(); initClientHome(); initClientHome();
assert.equal(document.querySelectorAll('.home-nav').length, 1);
for (const [id, node] of originals) assert.equal(get(id), node, `Preserve ${id}`);
const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
assert.equal(new Set(ids).size, ids.length, 'No duplicate form or control IDs');
assert.equal(document.querySelector('[data-home-current]').hidden, true);
click('.home-primary'); assert.equal(window.bookingScreen.isOpen(), true);
get('taxiCustomerPhone').value = '+7 700 000 00 00';
window.closeModal('mapModal');
click('[data-home-go="services"]');
assert.equal(document.querySelector('[data-home-page="home"]').hidden, true);
assert.equal(document.querySelector('[data-home-page="services"]').hidden, false);
for (const [service, expected] of [['wagon','wagon'], ['minivan','minivan'], ['taxi','sedan']]) {
  click(`[data-home-service="${service}"]`);
  assert.equal(window.bookingScreen.vehicleRequest().vehicleCategory, expected);
  assert.equal(get('taxiCustomerPhone').value, '+7 700 000 00 00');
  window.closeModal('mapModal');
}
for (const service of ['auction', 'delivery', 'cargo', 'soberDriver', 'assistance']) {
  click(`[data-home-service="${service}"]`);
  assert.equal(window.bookingScreen.isOpen(), true);
  assert.equal(get('bookingSubmit').disabled, ['cargo', 'soberDriver', 'assistance'].includes(service));
  assert.equal(get('bookingWhatsapp'), null);
  window.closeModal('mapModal');
}
click('[data-home-city]'); assert.equal(get('bookingPicker').hidden, false);
get('bookingCity').querySelector('span').textContent = 'Глубокое'; await flush();
assert.equal(get('homeCityName').textContent, 'Глубокое');
window.closeModal('mapModal');
for (const modal of ['busScheduleModal', 'stroyDomModal', 'techInspectionModal', 'insuranceModal', 'foodModal']) {
  click(`[data-home-modal="${modal}"]`); assert.equal(opened.at(-1), modal); window.closeModal(modal);
}

// A Firestore update is reflected from the real existing order panel, without writes.
for (const service of ['taxi', 'delivery', 'auction']) {
  const panel = get(`${service}-online-order-panel`);
  get(`${service}-online-order-status`).textContent = 'Водитель подъехал';
  get(`${service}-online-order-route`).textContent = 'Жукова, 20 → Карла Маркса, 76';
  get(`${service}-online-new-order-button`).classList.add('hidden'); panel.classList.remove('hidden');
  await flush();
  assert.equal(document.querySelector('[data-home-current]').hidden, false);
  assert.match(document.querySelector('[data-home-current]').textContent, /Водитель подъехал/);
  click('[data-home-current] button'); assert.equal(window.bookingScreen.isOpen(), true); window.closeModal('mapModal');
  get(`${service}-online-order-status`).textContent = 'Поездка завершена';
  get(`${service}-online-new-order-button`).classList.remove('hidden'); await flush();
  assert.equal(document.querySelector('[data-home-current]').hidden, true);
  assert.match(document.querySelector('[data-home-latest]').textContent, /Поездка завершена/);
  panel.classList.add('hidden'); await flush();
}
assert.equal(document.querySelector('[data-home-latest]').hidden, true);
window.localStorage.setItem('taxi_full_orders_history', 'invalid');
click('.home-nav [data-home-go="trips"]'); assert.match(get('homeHistory').textContent, /пока нет/);
window.localStorage.setItem('taxi_full_orders_history', JSON.stringify([{ from:'<img src=x onerror=alert(1)>', to:'Глубокое', price:'1 000 ₸', date:'9 сентября', time:'14:00' }]));
click('.home-nav [data-home-go="trips"]'); assert.equal(get('homeHistory').querySelector('img'), null);
let repeated = null; window.repeatOrder = (...args) => { repeated = args; };
click('#homeHistory .home-trip'); assert.deepEqual(repeated, ['<img src=x onerror=alert(1)>', 'Глубокое']);
click('.home-nav [data-home-go="more"]');
assert.equal(document.querySelector('.home-nav [aria-current="page"]').dataset.homeGo, 'more');
for (const [action, method] of [['install','installApp'], ['share','shareApp'], ['theme','toggleTheme'], ['notifications','togglePushNotifications']]) {
  let calls = 0; window[method] = () => calls++; click(`[data-home-action="${action}"]`); assert.equal(calls, 1);
}
assert.equal(document.querySelector('.home-header a').getAttribute('href'), 'tel:+77770649648');
assert.equal(document.querySelector('.home-nav a[href*="wa.me"]'), null);
assert.ok(document.querySelector('[data-home-page="more"] a[href="./drivers.html"]'));
console.log('PASS: home navigation, original map forms, service categories, partners, live order summaries, local history and secondary actions');
dom.window.close();
