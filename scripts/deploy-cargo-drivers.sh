#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test scripts/driver-services.test.mjs functions/push-actions.test.cjs
# Update routing before opening the new registration controls.
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:indexes
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const response = await fetch('https://firestore.googleapis.com/v1/projects/taxiuspeh-76d55/databases/(default)/documents/settings/driverServices', {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({fields:{schemaVersion:{integerValue:'1'},updatedAt:{timestampValue:new Date().toISOString()}}})
});
if (!response.ok) throw new Error(`Не удалось включить грузовые карточки (${response.status}). Проверьте Google-аккаунт Cloud Shell и повторите команду.`);
console.log('Грузовые карточки подключены. Обновите страницу диспетчера.');
NODE
