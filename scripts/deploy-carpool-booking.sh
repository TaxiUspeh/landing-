#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test scripts/driver-finance.test.mjs functions/carpool-push.test.cjs functions/push-actions.test.cjs
# Publish callable booking, notifications, indexes and rules before enabling carpool booking.
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules,firestore:indexes
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const wanted = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes.filter(index => index.collectionGroup.startsWith('carpool'));
let indexesReady = false;
for (let attempt = 0; attempt < 120; attempt++) {
  const response = await fetch('https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)/collectionGroups/-/indexes?pageSize=1000', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Не удалось проверить индексы (${response.status}). Повторите команду после проверки доступа Cloud Shell.`);
  const indexes = (await response.json()).indexes || [];
  indexesReady = wanted.every(expected => indexes.some(index => index.name.includes(`/collectionGroups/${expected.collectionGroup}/`)
    && index.state === 'READY' && expected.fields.every(field => index.fields.some(f => f.fieldPath === field.fieldPath && f.order === field.order))));
  if (indexesReady) break;
  if (attempt % 6 === 0) console.log('Ожидаем готовности индексов попуток…');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!indexesReady) throw new Error('Индексы ещё строятся. Попутки пока не включены. Повторите эту же команду через несколько минут.');
const response = await fetch('https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)/documents/settings/carpoolBooking', {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({fields:{schemaVersion:{integerValue:'1'},updatedAt:{timestampValue:new Date().toISOString()}}})
});
if (!response.ok) throw new Error(`Не удалось включить попутки (${response.status}). Проверьте Google-аккаунт Cloud Shell и повторите команду.`);
console.log('Попутки подключены. Обновите страницы. В карточках легковых водителей включите «Попутки» и задайте комиссию, если она отличается от такси.');
NODE
