#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test scripts/assistance-booking.test.mjs scripts/driver-services.test.mjs functions/push-actions.test.cjs
# Publish opted-in driver matching and order rules before opening booking.
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const response = await fetch('https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)/documents/settings/assistanceBooking', {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({fields:{schemaVersion:{integerValue:'1'},updatedAt:{timestampValue:new Date().toISOString()}}})
});
if (!response.ok) throw new Error(`Не удалось включить помощь на дороге (${response.status}). Проверьте Google-аккаунт Cloud Shell и повторите команду.`);
console.log('Помощь на дороге подключена. Обновите страницы клиента, водителя и диспетчера. В карточках нужных легковых водителей включите «Помощь на дороге». Клиент предлагает цену от 1 500 ₸.');
NODE
