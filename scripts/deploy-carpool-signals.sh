#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test functions/carpool-push.test.cjs
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push:notifyDriversOfPassengerRequest
printf '%s\n' 'Уведомления о заявках «Ищу машину» подключены. Обновите кабинет водителя.'
