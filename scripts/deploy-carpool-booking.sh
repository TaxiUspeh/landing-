#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
if [[ "${1:-}" == "--activate-only" && "$#" == 1 ]]; then
  # Resume only after functions, rules and indexes were successfully deployed.
  exec node scripts/activate-carpool-booking.mjs
fi
if [[ "$#" != 0 ]]; then
  echo 'Использование: deploy-carpool-booking.sh [--activate-only]' >&2
  exit 2
fi
npm ci --prefix functions --ignore-scripts
node --test scripts/driver-finance.test.mjs functions/carpool-push.test.cjs functions/push-actions.test.cjs
# Publish callable booking, notifications, indexes and rules before enabling carpool booking.
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only functions:driver_push
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules,firestore:indexes
node scripts/activate-carpool-booking.mjs --simple-journey --passenger-hub
