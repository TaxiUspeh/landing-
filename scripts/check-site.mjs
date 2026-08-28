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
for (const expected of ['BASE_PRICE: 800', 'от <strong>800 тенге</strong>', "register('./service-worker.js')", 'нажмите «Отправить»']) {
  if (!index.includes(expected)) failures.push('index.html: missing ' + expected);
}

const carouselStart = index.indexOf('<!-- SERVICES AND QUICK ACTIONS CAROUSEL -->');
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
    'Оставить отзыв',
    'Перезвонить',
    'Партнеры',
    'На экран'
  ]) {
    if (!carousel.includes(expected)) failures.push('index.html: carousel missing ' + expected);
  }

  const panelCount = (carousel.match(/data-carousel-panel role=/g) || []).length;
  const dotCount = (carousel.match(/data-carousel-dot="/g) || []).length;
  if (panelCount !== 2) failures.push('index.html: expected 2 carousel panels, found ' + panelCount);
  if (dotCount !== 2) failures.push('index.html: expected 2 carousel dots, found ' + dotCount);
}

for (const expected of [
  'scroll-snap-type: x mandatory',
  'touch-action: pan-x pan-y',
  'data-carousel-prev',
  'data-carousel-next',
  'initServicesActionsCarousel()',
  'viewport.scrollTo({'
]) {
  if (!index.includes(expected)) failures.push('index.html: missing carousel behavior ' + expected);
}
if (/addEventListener\(\s*['"]touchmove/.test(index)) failures.push('index.html: carousel must not block vertical touch scrolling');
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
for (const icon of manifest.icons) await access(resolve(icon.src.replace(/^\/landing-\//, ''))).catch(() => failures.push('missing icon: ' + icon.src));
for (const file of ['service-worker.js', 'robots.txt', 'sitemap.xml']) await access(file).catch(() => failures.push('missing ' + file));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Site checks passed (' + htmlFiles.length + ' HTML pages).');
