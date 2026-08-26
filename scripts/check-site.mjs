import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const htmlFiles = ['index.html', 'drivers.html', 'food.html', 'SHASHDVOR.html'];
const failures = [];
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noopener[^"']*["']/i.test(match[0])) failures.push(`${file}: target=_blank without noopener`);
  }
}
const index = await readFile('index.html', 'utf8');
for (const expected of ['BASE_PRICE: 800', 'от <strong>800 тенге</strong>', "register('./service-worker.js')", 'нажмите «Отправить»']) {
  if (!index.includes(expected)) failures.push(`index.html: missing ${expected}`);
}
if (/WhatsApp Image 2026-08-24/.test(index)) failures.push('index.html: broken StroyDom image remains');
if (/chip\.innerHTML\s*=/.test(index)) failures.push('index.html: address history uses innerHTML');
const manifest = JSON.parse(await readFile('site.webmanifest', 'utf8'));
for (const icon of manifest.icons) await access(resolve(icon.src.replace(/^\/landing-\//, ''))).catch(() => failures.push(`missing icon: ${icon.src}`));
for (const file of ['service-worker.js', 'robots.txt', 'sitemap.xml']) await access(file).catch(() => failures.push(`missing ${file}`));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Site checks passed (${htmlFiles.length} HTML pages).`);
