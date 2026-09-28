import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const database = 'https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)';

export function matchesIndex(expected, actual) {
  const fields = actual.fields || [];
  return actual.name?.includes(`/collectionGroups/${expected.collectionGroup}/`)
    && actual.queryScope === expected.queryScope
    && (fields.length === expected.fields.length
      || (fields.length === expected.fields.length + 1 && fields.at(-1).fieldPath === '__name__'))
    && expected.fields.every((field, i) => field.fieldPath === fields[i]?.fieldPath
      && field.order === fields[i]?.order && field.arrayConfig === fields[i]?.arrayConfig);
}

export async function activateCarpool({
  token, wanted, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log, attempts = 120, simpleJourney = false,
}) {
  if (!token) throw new Error('Не получен доступ Google Cloud Shell. Проверьте вход в Google-аккаунт.');
  if (!wanted?.length) throw new Error('В файле firestore.indexes.json не найдены индексы попуток.');
  const headers = { Authorization: `Bearer ${token}` };
  async function request(url, options, label) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Never print the access token, including in unexpected upstream error messages.
      const detail = String(body.error?.message || body.error?.status || '')
        .split(token).join('[скрыто]').slice(0, 1000);
      throw new Error(`${label} (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    return body;
  }
  let ready = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const indexes = [];
    for (const collection of new Set(wanted.map(index => index.collectionGroup))) {
      let pageToken;
      const seenTokens = new Set();
      do {
        const url = new URL(`${database}/collectionGroups/${encodeURIComponent(collection)}/indexes`);
        // Let Firestore select a supported page size; follow every returned page.
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const body = await request(url, { headers }, `Не удалось проверить индексы ${collection}`);
        indexes.push(...(body.indexes || []));
        pageToken = body.nextPageToken;
        if (pageToken && seenTokens.has(pageToken)) throw new Error('Firestore повторил страницу индексов. Повторите подключение позже.');
        if (pageToken) seenTokens.add(pageToken);
      } while (pageToken);
    }
    const failed = wanted.find(expected => indexes.some(index => matchesIndex(expected, index) && index.state === 'NEEDS_REPAIR'));
    if (failed) throw new Error(`Индекс ${failed.collectionGroup} требует восстановления в Firebase. Попутки не включены.`);
    ready = wanted.every(expected => indexes.some(index => matchesIndex(expected, index) && index.state === 'READY'));
    if (ready) break;
    if (attempt % 6 === 0) log('Ожидаем готовности индексов попуток…');
    if (attempt + 1 < attempts) await sleep(5000);
  }
  if (!ready) throw new Error(simpleJourney
    ? 'Индексы ещё строятся или отсутствуют. Поездки без кода не включены. Повторите полный deploy-carpool-booking.sh через несколько минут.'
    : 'Индексы ещё строятся или отсутствуют. Попутки не включены. После успешной публикации повторите команду с --activate-only через несколько минут.');
  const url = new URL(`${database}/documents/settings/carpoolBooking`);
  url.searchParams.append('updateMask.fieldPaths', 'schemaVersion');
  url.searchParams.append('updateMask.fieldPaths', 'updatedAt');
  if (simpleJourney) url.searchParams.append('updateMask.fieldPaths', 'journeyVersion');
  await request(url, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { schemaVersion: { integerValue: '1' }, updatedAt: { timestampValue: new Date().toISOString() },
      ...(simpleJourney ? { journeyVersion: { integerValue: '2' } } : {}) } }),
  }, 'Не удалось включить попутки');
  log('Попутки подключены. Обновите страницы. В карточках легковых водителей включите «Попутки» и задайте комиссию, если она отличается от такси.');
  if (simpleJourney) log('Поездки без кода подключены: «Начать поездку» → «Завершить поездку».');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
    const spec = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
    if (process.argv.slice(2).some(arg => arg !== '--simple-journey')) throw new Error('Неизвестный параметр подключения.');
    await activateCarpool({ token, wanted: spec.indexes.filter(index => index.collectionGroup.startsWith('carpool')),
      simpleJourney: process.argv.includes('--simple-journey') });
  } catch (error) {
    console.error(`Ошибка подключения попуток: ${error.message}`);
    process.exitCode = 1;
  }
}
