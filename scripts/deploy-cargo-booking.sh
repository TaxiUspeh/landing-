#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test scripts/cargo-fare.test.mjs scripts/driver-services.test.mjs functions/push-actions.test.cjs
# Publish direction-aware push and immutable cargo settlement rules before opening booking.
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const response = await fetch('https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)/documents/settings/cargoBooking', {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({fields:{schemaVersion:{integerValue:'1'},updatedAt:{timestampValue:new Date().toISOString()}}})
});
if (!response.ok) throw new Error(`Не удалось включить грузоперевозки (${response.status}). Проверьте Google-аккаунт Cloud Shell и повторите команду.`);
console.log('Грузоперевозки подключены. Обновите страницы клиента, водителя и диспетчера. Первый час — 6 000 ₸, затем 250 ₸/км. Пробег подтверждает диспетчер.');
NODE
