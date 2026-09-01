import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getHolidayForDate } from '../holiday-calendar.js';

const htmlFiles = ['index.html', 'drivers.html', 'dispatcher.html', 'food.html', 'SHASHDVOR.html'];
const failures = [];
const htmlByFile = new Map();
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  htmlByFile.set(file, html);
  for (const match of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noopener[^"']*["']/i.test(match[0])) failures.push(file + ': target=_blank without noopener');
  }

  for (const scriptMatch of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = scriptMatch[1];
    const source = scriptMatch[2];
    if (/\bsrc\s*=/i.test(attributes)) continue;
    if (/type=["']application\/ld\+json["']/i.test(attributes)) {
      try {
        JSON.parse(source);
      } catch (error) {
        failures.push(file + ': invalid JSON-LD: ' + error.message);
      }
      continue;
    }
    const parseableSource = /type=["']module["']/i.test(attributes)
      ? source.replace(/^\s*import\s+[^;]+;\s*$/gm, '')
      : source;
    try {
      Function(parseableSource);
    } catch (error) {
      failures.push(file + ': inline script syntax error: ' + error.message);
    }
  }
}
const index = htmlByFile.get('index.html');
const drivers = htmlByFile.get('drivers.html');
const dispatcher = htmlByFile.get('dispatcher.html');
const food = htmlByFile.get('food.html');
const shashlyk = htmlByFile.get('SHASHDVOR.html');
for (const expected of ['BASE_PRICE: 800', 'от <strong>800 тенге</strong>', "register('./service-worker.js', { updateViaCache: 'none' })", 'нажмите «Отправить»']) {
  if (!index.includes(expected)) failures.push('index.html: missing ' + expected);
}
for (const expected of [
  'id="taxiCustomerPhone"',
  'id="taxiWishes"',
  'id="taxiFromCitySelect"',
  'Город отправления:',
  'Город назначения:',
  'id="taxi-wishes-toggle"',
  'id="taxiWishesContent"',
  'toggleTaxiWishes()',
  'resetTaxiWishesPanel',
  'Пожелания к заказу',
  "addWish('Нужен универсал')",
  'id="taxi-online-order-button"',
  'id="taxi-whatsapp-order-button"',
  'id="taxi-online-order-panel"',
  'id="taxi-online-order-message"',
  'id="driver-cabinet-link"',
  'href="./drivers.html"',
  'Заказать онлайн',
  'Через WhatsApp',
  'src="./client-orders.js"'
]) {
  if (!index.includes(expected)) failures.push('index.html: missing hybrid online order behavior ' + expected);
}
for (const expected of [
  "selectedIntercityRate('taxiFromCitySelect')",
  "selectedIntercityRate('taxiCitySelect')",
  'Цена уточняется диспетчером',
  'INTERCITY_PRICE_PER_KM: 230',
  'buildTaxiGeocodingQuery(address, city)',
  'fetchWithTimeout(url, timeoutMs = 8000)',
  'getCoordinates(fromInput, fromCity)',
  'getCoordinates(toInput, toCity)',
  'Показываем тариф из базы'
]) {
  if (!index.includes(expected)) failures.push('index.html: city-based taxi pricing is missing ' + expected);
}
if (index.includes('findIntercityRate(destination)') || index.includes('findIntercityRate(origin)')) {
  failures.push('index.html: taxi pricing still infers a city from street text');
}

const carouselStart = index.indexOf('<!-- MAIN ORDER, SERVICES AND QUICK ACTIONS CAROUSEL -->');
const carouselEnd = index.indexOf('<!-- BUS SCHEDULE BLOCK -->', carouselStart);
if (carouselStart === -1 || carouselEnd === -1) {
  failures.push('index.html: services/actions carousel block is missing');
} else {
  const carousel = index.slice(carouselStart, carouselEnd);
  for (const expected of [
    'id="servicesActionsCarousel"',
    'Доставка',
    'Грузовой',
    'Трезвый водитель',
    'Помощь',
    'Автострахование',
    'main-order-panel',
    'Заказать Taxi',
    'Оставить отзыв',
    'Перезвонить',
    'Партнеры',
    'На экран'
  ]) {
    if (!carousel.includes(expected)) failures.push('index.html: carousel missing ' + expected);
  }

  const panelCount = (carousel.match(/data-carousel-panel role=/g) || []).length;
  const dotCount = (carousel.match(/data-carousel-dot="/g) || []).length;
  if (panelCount !== 3) failures.push('index.html: expected 3 carousel panels, found ' + panelCount);
  if (dotCount !== 3) failures.push('index.html: expected 3 carousel dots, found ' + dotCount);

  const additionalIndex = carousel.indexOf('services-actions-additional-panel');
  const mainIndex = carousel.indexOf('services-actions-main-panel');
  const quickIndex = carousel.indexOf('services-actions-quick-panel');
  if (!(additionalIndex < mainIndex && mainIndex < quickIndex)) {
    failures.push('index.html: carousel panels must be ordered additional, main order, quick actions');
  }
}

for (const expected of [
  'touch-action: pan-y pinch-zoom',
  'transform: translate3d(-100%, 0, 0)',
  'transition: transform 220ms',
  'will-change: transform',
  '.services-actions-track.is-dragging',
  '.services-actions-track.is-instant',
  'data-carousel-prev',
  'data-carousel-next',
  'initServicesActionsCarousel()',
  "addEventListener('pointerdown'",
  "addEventListener('pointermove'",
  "addEventListener('pointerup'",
  "addEventListener('pointercancel'",
  "gestureAxis = 'horizontal'",
  'const threshold = Math.max(42',
  "const panelNames = ['Дополнительные услуги', 'Заказ такси', 'Быстрые действия']",
  'const initialIndex = 1',
  'measureStableHeight()',
  'setTrackOffset(baseOffset(activeIndex) + dragOffset, false)',
  '.mobile-compact-main {'
]) {
  if (!index.includes(expected)) failures.push('index.html: missing carousel behavior ' + expected);
}
if (/transition:\s*height/.test(index)) failures.push('index.html: carousel height must not animate during a swipe');
if (/scroll-snap-type/.test(index)) failures.push('index.html: native scroll-snap carousel remains');
if (/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/s.test(index)) failures.push('index.html: root overflow-x hidden can block page scrolling on mobile');
if (!/body\s*\{[^}]*overflow-x:\s*clip/s.test(index)) failures.push('index.html: safe body horizontal overflow guard is missing');
if (/addEventListener\(\s*['"]touchmove/.test(index)) failures.push('index.html: carousel must not block vertical touch scrolling');

for (const expected of [
  'id="holidayBanner"',
  'id="holidayBannerTitle"',
  'id="holidayBannerText"',
  'updateHolidayBanner()',
  'const holidayMultiplier = holiday ? CONFIG.TAXI.MULTIPLIERS.HOLIDAY : 1',
  'priceMultiplier = Math.max(priceMultiplier, holidayMultiplier)',
  "holiday: 'taxi_last_holiday_notification'",
  "weather: 'taxi_last_weather_notification'",
  "night: 'taxi_last_night_notification'",
  "document.addEventListener('visibilitychange', handleAppVisibilityChange)",
  '15 * 60 * 1000',
  'data: { url: \'./\' }'
]) {
  if (!index.includes(expected)) failures.push('index.html: missing holiday behavior ' + expected);
}

const holidayBannerIndex = index.indexOf('id="holidayBanner"');
const lineStatusIndex = index.indexOf('id="lineStatus"');
if (holidayBannerIndex === -1 || lineStatusIndex === -1 || holidayBannerIndex > lineStatusIndex) {
  failures.push('index.html: holiday banner must be separate and placed before line status');
}

const lineStatusStart = index.indexOf('window.checkLineStatus = async function()');
const lineStatusEnd = index.indexOf('function debounce(', lineStatusStart);
if (lineStatusStart === -1 || lineStatusEnd === -1) {
  failures.push('index.html: line status logic is missing');
} else {
  const lineStatusScript = index.slice(lineStatusStart, lineStatusEnd);
  for (const expected of [
    "statusEl.setAttribute('onclick', 'window.openMapModal()')",
    'СВОБОДНЫХ МАШИН',
    'МАЛО МАШИН',
    'updateHolidayBanner()'
  ]) {
    if (!lineStatusScript.includes(expected)) failures.push('index.html: line status behavior changed: ' + expected);
  }
  if (lineStatusScript.includes('ПРАЗДНИЧНЫЙ ДЕНЬ')) failures.push('index.html: holiday text still replaces the car status card');
}

const carouselScriptStart = index.indexOf('function initServicesActionsCarousel()');
const carouselScriptEnd = index.indexOf('initServicesActionsCarousel();', carouselScriptStart);
if (carouselScriptStart === -1 || carouselScriptEnd === -1) {
  failures.push('index.html: carousel script is missing');
} else {
  const carouselScript = index.slice(carouselScriptStart, carouselScriptEnd);
  for (const forbidden of ['scrollLeft', 'viewport.scrollTo', "addEventListener('scroll'"]) {
    if (carouselScript.includes(forbidden)) failures.push('index.html: native horizontal scrolling remains: ' + forbidden);
  }
}
const mapStart = index.indexOf('window.simMap = null;');
const mapEnd = index.indexOf('window.togglePreorder = function()', mapStart);
if (mapStart === -1 || mapEnd === -1) {
  failures.push('index.html: map simulation block is missing');
} else {
  const mapSimulation = index.slice(mapStart, mapEnd);
  for (const expected of [
    'Центр и магазины',
    'Школа и южная часть',
    'Западная часть Белоусовки',
    'Северная и восточная часть',
    'Белоусовка — Белокаменка',
    'Белоусовка — Секисовка',
    'Белоусовка — Прогресс',
    'Белоусовка — Черногорка',
    'Белоусовка — Краснопартизанское',
    'overview=full&geometries=geojson',
    'haversineMeters',
    'requestAnimationFrame(animateCars)',
    'initToken !== window.simInitToken',
    'data-map-view="district"',
    'navigator.geolocation.watchPosition',
    'navigator.geolocation.clearWatch',
    'enableHighAccuracy: true',
    'stopSimulationLocationTracking',
    'planApproachToUser',
    'approachRemainingMeters',
    'Ориентировочная машина',
    'водитель ещё не назначен',
    'L.polyline(approachPoints',
    'routeData.duration',
    'approachLastRouteRequestAt',
    'Расчёт, водитель ещё не назначен',
    "const motionStateKey = 'taxi_sim_motion_v2'",
    'const desiredLocalCarCount = cars <= 2',
    'Math.round(cars * 0.65)',
    'persistSimulationMotionState()',
    'const restoredElapsedMs = restoredMotionState',
    'pauseAtKnownStop',
    'switchCarToRoute',
    'selectApproachCarByRoadTime',
    'table/v1/driving/',
    'minimumDuration',
    'findRouteStopIndexes'
  ]) {
    if (!mapSimulation.includes(expected)) failures.push('index.html: map simulation missing ' + expected);
  }

  const districtRouteCount = (mapSimulation.match(/kind: 'district'/g) || []).length;
  const localRouteCount = (mapSimulation.match(/kind: 'local'/g) || []).length;
  if (districtRouteCount !== 5) failures.push('index.html: expected 5 district routes, found ' + districtRouteCount);
  if (localRouteCount !== 4) failures.push('index.html: expected 4 local routes, found ' + localRouteCount);
  if (/const roadNodes\s*=/.test(mapSimulation)) failures.push('index.html: old straight-line road graph remains');
  if (/simInterval|setInterval/.test(mapSimulation)) failures.push('index.html: old interval map animation remains');
  if (/navigator\.geolocation\.getCurrentPosition/.test(mapSimulation)) failures.push('index.html: map still uses one-time geolocation instead of live tracking');
  if (/Водитель назначен/.test(mapSimulation)) failures.push('index.html: simulated car must not be presented as an assigned real driver');
  if (/id: 'local-places'/.test(mapSimulation)) failures.push('index.html: old single local route remains');
  if (/selectApproachCar\s*\(/.test(mapSimulation)) failures.push('index.html: random nearest-car selection remains');
}

const mapOverlayTag = index.match(/<div id="mapOverlayText"[^>]*>/)?.[0] || '';
if (!mapOverlayTag || /whitespace-nowrap/.test(mapOverlayTag)) failures.push('index.html: mobile map status can overflow the screen');

if (/WhatsApp Image 2026-08-24/.test(index)) failures.push('index.html: broken StroyDom image remains');
if (/chip\.innerHTML\s*=/.test(index)) failures.push('index.html: address history uses innerHTML');

for (const expected of [
  'id="driver-account"',
  'id="driver-install-app-button"',
  'id="driver-install-app-message"',
  'id="driver-documents-modal"',
  'id="driver-documents-open"',
  'Отправить документы в WhatsApp',
  'openDriverDocumentsModal',
  'closeDriverDocumentsModal',
  "addEventListener('beforeinstallprompt'",
  "addEventListener('appinstalled'",
  'id="driver-login-button"',
  'id="driver-account-pending"',
  'id="driver-profile-balance"',
  'id="driver-work-status-card"',
  'id="driver-work-status-detail"',
  'id="driver-balance-history"',
  'id="driver-balance-history-list"',
  'id="driver-balance-history-more"',
  'id="driver-dispatcher-chat"',
  'id="driver-dispatcher-chat-form"',
  'id="driver-dispatcher-chat-list"',
  'Сигналы заказов и чата',
  'id="driver-order-alerts-toggle"',
  'id="driver-order-alerts-test"',
  'id="driver-new-order-alert"',
  'id="driver-online-orders"',
  'id="driver-online-orders-list"',
  'Рабочий чат WhatsApp',
  'src="./driver-portal.js"',
  '<link rel="manifest" href="./drivers.webmanifest">',
  "register('./service-worker.js', { updateViaCache: 'none' })"
]) {
  if (!drivers.includes(expected)) failures.push('drivers.html: missing protected driver portal ' + expected);
}
if (drivers.includes('id="driver-shift-toggle"') || drivers.includes('Выйти на линию')) {
  failures.push('drivers.html: manual driver shift controls must not return');
}
if (/https:\/\/chat\.whatsapp\.com\//i.test(drivers)) failures.push('drivers.html: public orders-chat invite remains in page source');
if (/user-scalable=no|maximum-scale=1(?:\.0)?/i.test(drivers)) failures.push('drivers.html: browser zoom is disabled');

for (const expected of [
  '<meta name="robots" content="noindex, nofollow, noarchive">',
  'id="dispatcher-login-button"',
  'id="dispatcher-user-uid"',
  'id="add-driver-form"',
  'id="online-orders-title"',
  'id="online-orders-list"',
  'id="toggle-online-orders-section"',
  'id="online-orders-content"',
  'data-driver-stat-filter="all"',
  'data-driver-stat-filter="connected"',
  'id="driver-summary-modal"',
  'data-dispatcher-mobile-section="messages"',
  'id="dispatcher-messages-content"',
  'id="dispatcher-messages-form"',
  'id="dispatcher-messages-sound-toggle"',
  'id="dispatcher-mobile-navigation"',
  'data-dispatcher-mobile-section="orders"',
  'data-dispatcher-mobile-section="drivers"',
  'data-dispatcher-mobile-section="settings"',
  'id="mobile-orders-current-button"',
  'id="mobile-orders-history-button"',
  'id="orders-stat-searching"',
  'В кабинете',
  'Свободны',
  'Заняты',
  'id="drivers-list"',
  'src="./dispatcher.js"'
]) {
  if (!dispatcher.includes(expected)) failures.push('dispatcher.html: missing protected dispatcher behavior ' + expected);
}

for (const [file, html, expected] of [
  ['food.html', food, {
    manifest: '<link rel="manifest" href="./food.webmanifest">',
    canonical: 'https://taxiuspeh.github.io/landing-/food.html'
  }],
  ['SHASHDVOR.html', shashlyk, {
    manifest: '<link rel="manifest" href="./shashlyk.webmanifest">',
    canonical: 'https://taxiuspeh.github.io/landing-/SHASHDVOR.html'
  }]
]) {
  if (/user-scalable=no|maximum-scale=1(?:\.0)?/i.test(html)) failures.push(file + ': browser zoom is disabled');
  if (!html.includes(expected.manifest)) failures.push(file + ': dedicated manifest is missing');
  if (!html.includes(`rel="canonical" href="${expected.canonical}"`)) failures.push(file + ': canonical URL is missing');
  if (!html.includes("register('./service-worker.js', { updateViaCache: 'none' })")) failures.push(file + ': service worker registration is missing');
  for (const expectedText of [
    'function openWhatsAppUrl(url)',
    "const opened = window.open(url, '_blank')",
    'window.location.assign(url)',
    "status: 'prepared'",
    'Подтвердите отправку сообщения в WhatsApp'
  ]) {
    if (!html.includes(expectedText)) failures.push(file + ': missing reliable order behavior ' + expectedText);
  }
}

const foodOrderStart = food.indexOf('function placeOrder()');
const foodOrderEnd = food.indexOf('// --- Helpers ---', foodOrderStart);
const foodOrder = food.slice(foodOrderStart, foodOrderEnd);
if (!foodOrder.includes('openWhatsAppUrl(`https://api.whatsapp.com/send')) failures.push('food.html: order does not open WhatsApp directly');
if (!foodOrder.includes("phoneDigits.length !== 11")) failures.push('food.html: phone validation is missing');
if (!food.includes('Предзаказ подготовлен!') || !food.includes('Заказ подготовлен!')) failures.push('food.html: prepared order wording is missing');
if ((food.match(/function installApp\s*\(/g) || []).length !== 1) failures.push('food.html: installApp must be defined exactly once');

const shashOrderStart = shashlyk.indexOf('function proceedWithOrder()');
const shashOrderEnd = shashlyk.indexOf('// --- Standard Logic', shashOrderStart);
const shashOrder = shashlyk.slice(shashOrderStart, shashOrderEnd);
if (!shashlyk.includes('id="order-phone"')) failures.push('SHASHDVOR.html: customer phone field is missing');
if (!shashOrder.includes('openWhatsAppUrl(`https://wa.me/77055071640')) failures.push('SHASHDVOR.html: order does not open WhatsApp directly');
if (!shashOrder.includes("document.getElementById('order-phone').value = ''")) failures.push('SHASHDVOR.html: order phone cleanup is missing');
if (!shashlyk.includes('Бронь подготовлена!') || !shashlyk.includes('Заявка подготовлена!')) failures.push('SHASHDVOR.html: prepared request wording is missing');

const manifest = JSON.parse(await readFile('site.webmanifest', 'utf8'));
const driversManifest = JSON.parse(await readFile('drivers.webmanifest', 'utf8'));
const foodManifest = JSON.parse(await readFile('food.webmanifest', 'utf8'));
const shashlykManifest = JSON.parse(await readFile('shashlyk.webmanifest', 'utf8'));
const serviceWorker = await readFile('service-worker.js', 'utf8');
const holidayCalendar = await readFile('holiday-calendar.js', 'utf8');
if (!serviceWorker.includes("const CACHE_NAME = 'taxi-uspeh-v31-osrm-route-fallback'")) failures.push('service-worker.js: OSRM route cache version was not updated');
if (!serviceWorker.includes("'./holiday-calendar.js'")) failures.push('service-worker.js: holiday calendar is missing from the app shell');
if (!serviceWorker.includes("addEventListener('notificationclick'")) failures.push('service-worker.js: notification clicks do not open the app');
if (/taxi-uspeh-v(?:[1-9]|1[0-9]|20)(?:-|')/.test(serviceWorker)) failures.push('service-worker.js: stale cache name remains');
for (const expected of [
  "'./food.webmanifest'",
  "'./shashlyk.webmanifest'",
  "'./food-icon-192.png'",
  "'./food-icon-512.png'",
  "'./shashlyk-icon-192.png'",
  "'./shashlyk-icon-512.png'",
  "'./driver-portal.js'",
  "'./drivers.webmanifest'",
  "'./dispatcher.html'",
  "'./dispatcher.js'",
  "'./firebase-config.js'",
  "'./client-orders.js'",
  'const cachedPage = await caches.match(event.request)'
]) {
  if (!serviceWorker.includes(expected)) failures.push('service-worker.js: missing ' + expected);
}
for (const expected of ['2026-03-09', '2026-03-24', '2026-03-25', '2026-05-11', '2026-05-27', '2026-10-26', "start: '03-15'", 'fromYear: 2026']) {
  if (!holidayCalendar.includes(expected)) failures.push('holiday-calendar.js: missing official 2026 date ' + expected);
}
if (/\bduration\s*:/.test(holidayCalendar)) failures.push('holiday-calendar.js: duration-based holiday calculation remains');

function localDate(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0);
}

for (const testCase of [
  [2026, 1, 1, 'Новый год', false],
  [2026, 1, 2, 'Новый год', false],
  [2026, 1, 3, null, false],
  [2026, 3, 8, 'Международный женский день', false],
  [2026, 3, 9, 'Международный женский день', true],
  [2026, 3, 10, null, false],
  [2026, 3, 15, 'День Конституции Республики Казахстан', false],
  [2026, 3, 21, 'Наурыз мейрамы', false],
  [2026, 3, 23, 'Наурыз мейрамы', false],
  [2026, 3, 24, 'Наурыз мейрамы', true],
  [2026, 3, 25, 'Наурыз мейрамы', true],
  [2026, 3, 26, null, false],
  [2026, 5, 9, 'День Победы', false],
  [2026, 5, 10, null, false],
  [2026, 5, 11, 'День Победы', true],
  [2026, 5, 27, 'Курбан айт', false],
  [2026, 5, 28, null, false],
  [2026, 8, 30, null, false],
  [2026, 10, 25, 'День Республики', false],
  [2026, 10, 26, 'День Республики', true],
  [2026, 10, 27, null, false],
  [2026, 12, 16, 'День Независимости', false],
  [2027, 3, 15, 'День Конституции Республики Казахстан', false]
]) {
  const [year, month, day, expectedName, expectedObserved] = testCase;
  const holiday = getHolidayForDate(localDate(year, month, day));
  const actualName = holiday ? holiday.name : null;
  if (actualName !== expectedName) failures.push(`holiday-calendar.js: ${year}-${month}-${day} expected ${expectedName}, found ${actualName}`);
  if (holiday && holiday.observed !== expectedObserved) failures.push(`holiday-calendar.js: ${year}-${month}-${day} observed flag is incorrect`);
}
for (const [name, appManifest, expectedStart] of [
  ['site.webmanifest', manifest, '/landing-/'],
  ['drivers.webmanifest', driversManifest, './drivers.html'],
  ['food.webmanifest', foodManifest, './food.html'],
  ['shashlyk.webmanifest', shashlykManifest, './SHASHDVOR.html']
]) {
  if (appManifest.start_url !== expectedStart) failures.push(name + ': incorrect start_url');
  if (name !== 'site.webmanifest' && appManifest.id !== expectedStart) failures.push(name + ': incorrect app id');
  for (const icon of appManifest.icons) {
    await access(resolve(icon.src.replace(/^\.\//, '').replace(/^\/landing-\//, '')))
      .catch(() => failures.push('missing icon: ' + icon.src));
  }
}
for (const file of ['service-worker.js', 'holiday-calendar.js', 'drivers.webmanifest', 'firebase-config.js', 'client-orders.js', 'driver-portal.js', 'dispatcher.js', 'firestore.rules', 'firestore.indexes.json', 'robots.txt', 'sitemap.xml']) await access(file).catch(() => failures.push('missing ' + file));

for (const file of ['client-orders.js', 'driver-portal.js', 'dispatcher.js', 'firebase-config.js']) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${file}: syntax error: ${result.stderr.trim()}`);
}

const clientOrders = await readFile('client-orders.js', 'utf8');
const driverPortal = await readFile('driver-portal.js', 'utf8');
const dispatcherScript = await readFile('dispatcher.js', 'utf8');
const firestoreRules = await readFile('firestore.rules', 'utf8');
const firestoreIndexes = JSON.parse(await readFile('firestore.indexes.json', 'utf8'));
if (!firestoreIndexes.indexes.some((index) => index.collectionGroup === 'balanceHistory'
  && index.queryScope === 'COLLECTION'
  && index.fields?.[0]?.fieldPath === 'driverId'
  && index.fields?.[1]?.fieldPath === 'changedAt'
  && index.fields?.[1]?.order === 'DESCENDING')) {
  failures.push('firestore.indexes.json: balance history index is missing');
}
if (!firestoreIndexes.indexes.some((index) => index.collectionGroup === 'driverMessages'
  && index.queryScope === 'COLLECTION'
  && index.fields?.[0]?.fieldPath === 'driverUid'
  && index.fields?.[1]?.fieldPath === 'driverId'
  && index.fields?.[2]?.fieldPath === 'createdAt'
  && index.fields?.[2]?.order === 'DESCENDING')) {
  failures.push('firestore.indexes.json: driver messages index is missing');
}
for (const expected of [
  'signInAnonymously', "collection(db, 'orders')", "doc(db, 'orderContacts'", "status: 'searching'",
  'parseMaximumPrice(priceText)', 'Подбираем другого водителя', 'CANCELLATION_REQUEST_STATUSES',
  'prepareClientOrderSound()', 'playClientOrderStatusSound(status)', 'signalClientOrderStatusChange(previousStatus, activeOrder)',
  "['accepted', 'arrived']",
  "cancellationRequestStatus: 'pending'", 'компенсацию 500 ₸'
]) {
  if (!clientOrders.includes(expected)) failures.push('client-orders.js: missing ' + expected);
}
for (const expected of [
  'runTransaction',
  "where('status', '==', 'searching')",
  "where('assignedDriverUid', '==', user.uid)",
  'Позвонить клиенту',
  'Notification.requestPermission()',
  'registration.showNotification(title, options)',
  'navigator.vibrate([180, 90, 180])',
  'window.AudioContext || window.webkitAudioContext',
  'snapshot.docChanges()',
  'initialOpenOrdersLoaded',
  'signalNewOrder(order)',
  'updateOrdersPageTitle()',
  "doc(db, 'driverStates', currentUser.uid)",
  "status: 'busy'",
  "status: 'available'",
  'touchDriverHeartbeat()',
  'repairMissingBusyState()',
  "collection(db, 'balanceHistory')",
  'watchBalanceHistory(currentDriverId)',
  'commissionRate: 20',
  'commissionBaseAmount',
  'BALANCE_HISTORY_RESPONSE_TIMEOUT_MS',
  'BALANCE_HISTORY_PAGE_SIZE = 20',
  'BALANCE_HISTORY_EXPANDED_PREFERENCE_KEY',
  'toggleBalanceHistory',
  'stopBalanceHistoryWatch',
  'Нажмите, чтобы показать',
  'loadMoreBalanceHistory',
  "orderBy('changedAt', 'desc')",
  "collection(db, 'driverMessages')",
  "orderBy('createdAt', 'desc')",
  'watchDriverChat(user, driverId)',
  'sendDriverChatMessage(event)',
  'playChatSound()',
  'signalDispatcherChatReply()',
  "sender: 'driver'",
  'showBalanceHistoryUnavailable',
  'lastCommissionOrderId',
  "doc(db, 'balanceHistory', orderId)",
  'REQUEUEABLE_ORDER_STATUSES',
  'returnOrderToSearch(orderId, expectedStatus, reason)',
  "requeueReason: REQUEUE_REASONS.some",
  'cancellationRequestStatus === \'pending\'',
  'Ожидайте решения диспетчера'
]) {
  if (!driverPortal.includes(expected)) failures.push('driver-portal.js: missing ' + expected);
}
for (const expected of [
  "collection(db, 'orders')",
  "collection(db, 'orderContacts')",
  "collection(db, 'driverStates')",
  'runTransaction',
  'driverAvailabilityInfo(driver)',
  'Отменить заказ',
  'commissionAmount',
  'commissionBaseAmount',
  'Комиссия ${rate}%',
  'assignOrderManually(orderId, driverId)',
  'manualAssignmentCandidates()',
  'Введите ID водителя',
  'Назначить водителя',
  'Кабинет водителя ID',
  'Подробнее и действия',
  'setOrderExpanded(orderId, expanded)',
  'openDriverSummary(filter)',
  'driverSummaryFilterDetails(filter)',
  'setOnlineOrdersSectionCollapsed(collapsed)',
  "collection(db, 'driverMessages')",
  'startDriverMessagesListener()',
  'openDriverMessageConversation(driverUid)',
  'sendDispatcherMessage(event)',
  'toggleDispatcherChatSound()',
  'playDispatcherChatSound()',
  'expandedOrderIds',
  "mobileDispatcherSection = 'orders'",
  "mobileOrdersView = 'current'",
  'setMobileDispatcherSection(section',
  'setMobileOrdersView(view)',
  'updateMobileOrdersFilter(currentCount, historyCount)',
  'dataset.orderHistory',
  "resolveClientCancellation(order, 'free')",
  "resolveClientCancellation(order, 'false_call_fee')",
  'Ложный вызов · 500 ₸'
]) {
  if (!dispatcherScript.includes(expected)) failures.push('dispatcher.js: missing ' + expected);
}
for (const expected of [
  'match /orders/{orderId}',
  'match /orderContacts/{orderId}',
  'validClientOrderCreate()',
  'clientRequestsCancellationAfterAssignment()',
  'driverAcceptsSearchingOrder(orderId)',
  'assignedDriverAdvancesOrder(orderId)',
  'assignedDriverReturnsOrderToSearch(orderId)',
  'match /driverStates/{accountUid}',
  'match /driverMessages/{messageId}',
  'validOwnDriverMessageCreate()',
  'validAdminDriverMessageCreate()',
  'adminMarksDriverMessageRead()',
  'driverIsAvailable()',
  'driverBecomesBusyWithOrder(orderId)',
  'driverBecomesAvailableAfter(orderId)',
  'driverBecomesAvailableAfterRequeue(orderId)',
  'validCommissionSettlement(orderId, driverId)',
  'validOwnOnlineCommissionHistoryCreate(entryId)',
  'driverAppliesOwnOnlineCommission(driverId)',
  "resource.data.get('cancellationRequestStatus', '') != 'pending'",
  "'commissionRate', 'commissionBaseAmount', 'commissionAmount'",
  "resource.data.status == 'searching'"
]) {
  if (!firestoreRules.includes(expected)) failures.push('firestore.rules: missing ' + expected);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Site checks passed (' + htmlFiles.length + ' HTML pages).');
