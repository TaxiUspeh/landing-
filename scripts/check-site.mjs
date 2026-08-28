import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getHolidayForDate } from '../holiday-calendar.js';

const htmlFiles = ['index.html', 'drivers.html', 'food.html', 'SHASHDVOR.html'];
const failures = [];
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noopener[^"']*["']/i.test(match[0])) failures.push(file + ': target=_blank without noopener');
  }
}
const index = await readFile('index.html', 'utf8');
const inlineModule = index.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
if (!inlineModule) {
  failures.push('index.html: inline module script is missing');
} else {
  const parseableModule = inlineModule.replace(/^\s*import\s+[^;]+;\s*$/gm, '');
  try {
    Function(parseableModule);
  } catch (error) {
    failures.push('index.html: inline module syntax error: ' + error.message);
  }
}
for (const expected of ['BASE_PRICE: 800', 'от <strong>800 тенге</strong>', "register('./service-worker.js', { updateViaCache: 'none' })", 'нажмите «Отправить»']) {
  if (!index.includes(expected)) failures.push('index.html: missing ' + expected);
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
    'Магазины и школа',
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
    'Расчёт, водитель ещё не назначен'
  ]) {
    if (!mapSimulation.includes(expected)) failures.push('index.html: map simulation missing ' + expected);
  }

  const districtRouteCount = (mapSimulation.match(/kind: 'district'/g) || []).length;
  const localRouteCount = (mapSimulation.match(/kind: 'local'/g) || []).length;
  if (districtRouteCount !== 5) failures.push('index.html: expected 5 district routes, found ' + districtRouteCount);
  if (localRouteCount !== 1) failures.push('index.html: expected 1 local route, found ' + localRouteCount);
  if (/const roadNodes\s*=/.test(mapSimulation)) failures.push('index.html: old straight-line road graph remains');
  if (/simInterval|setInterval/.test(mapSimulation)) failures.push('index.html: old interval map animation remains');
  if (/navigator\.geolocation\.getCurrentPosition/.test(mapSimulation)) failures.push('index.html: map still uses one-time geolocation instead of live tracking');
  if (/Водитель назначен/.test(mapSimulation)) failures.push('index.html: simulated car must not be presented as an assigned real driver');
}

const mapOverlayTag = index.match(/<div id="mapOverlayText"[^>]*>/)?.[0] || '';
if (!mapOverlayTag || /whitespace-nowrap/.test(mapOverlayTag)) failures.push('index.html: mobile map status can overflow the screen');

if (/WhatsApp Image 2026-08-24/.test(index)) failures.push('index.html: broken StroyDom image remains');
if (/chip\.innerHTML\s*=/.test(index)) failures.push('index.html: address history uses innerHTML');
const manifest = JSON.parse(await readFile('site.webmanifest', 'utf8'));
const serviceWorker = await readFile('service-worker.js', 'utf8');
const holidayCalendar = await readFile('holiday-calendar.js', 'utf8');
if (!serviceWorker.includes("const CACHE_NAME = 'taxi-uspeh-v4-live-map'")) failures.push('service-worker.js: live map cache version was not updated');
if (!serviceWorker.includes("'./holiday-calendar.js'")) failures.push('service-worker.js: holiday calendar is missing from the app shell');
if (!serviceWorker.includes("addEventListener('notificationclick'")) failures.push('service-worker.js: notification clicks do not open the app');
if (/taxi-uspeh-v[123](?:-|')/.test(serviceWorker)) failures.push('service-worker.js: stale cache name remains');
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
for (const icon of manifest.icons) await access(resolve(icon.src.replace(/^\/landing-\//, ''))).catch(() => failures.push('missing icon: ' + icon.src));
for (const file of ['service-worker.js', 'holiday-calendar.js', 'robots.txt', 'sitemap.xml']) await access(file).catch(() => failures.push('missing ' + file));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Site checks passed (' + htmlFiles.length + ' HTML pages).');
