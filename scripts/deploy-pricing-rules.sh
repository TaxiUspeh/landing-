#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
node --test scripts/taxi-pricing.test.mjs scripts/driver-finance.test.mjs
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules
