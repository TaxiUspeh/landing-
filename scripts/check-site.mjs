import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const htmlFiles = ['index.html', 'drivers.html', 'food.html', 'SHASHDVOR.html'];
const failures = [];
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noopener[^"']*["']/i.test(match[0])) failures.push(file + ': target=_blank without noopener');
  }
}
const index = await readFile('index.html', 'utf8');
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
    'data-map-view="district"'
  ]) {
    if (!mapSimulation.includes(expected)) failures.push('index.html: map simulation missing ' + expected);
  }

  const districtRouteCount = (mapSimulation.match(/kind: 'district'/g) || []).length;
  const localRouteCount = (mapSimulation.match(/kind: 'local'/g) || []).length;
  if (districtRouteCount !== 5) failures.push('index.html: expected 5 district routes, found ' + districtRouteCount);
  if (localRouteCount !== 1) failures.push('index.html: expected 1 local route, found ' + localRouteCount);
  if (/const roadNodes\s*=/.test(mapSimulation)) failures.push('index.html: old straight-line road graph remains');
  if (/simInterval|setInterval/.test(mapSimulation)) failures.push('index.html: old interval map animation remains');
}

if (/WhatsApp Image 2026-08-24/.test(index)) failures.push('index.html: broken StroyDom image remains');
if (/chip\.innerHTML\s*=/.test(index)) failures.push('index.html: address history uses innerHTML');
const manifest = JSON.parse(await readFile('site.webmanifest', 'utf8'));
const serviceWorker = await readFile('service-worker.js', 'utf8');
if (!serviceWorker.includes("const CACHE_NAME = 'taxi-uspeh-v2-carousel'")) failures.push('service-worker.js: carousel cache version was not updated');
if (serviceWorker.includes('taxi-uspeh-v1')) failures.push('service-worker.js: stale v1 cache name remains');
for (const icon of manifest.icons) await access(resolve(icon.src.replace(/^\/landing-\//, ''))).catch(() => failures.push('missing icon: ' + icon.src));
for (const file of ['service-worker.js', 'robots.txt', 'sitemap.xml']) await access(file).catch(() => failures.push('missing ' + file));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Site checks passed (' + htmlFiles.length + ' HTML pages).');
