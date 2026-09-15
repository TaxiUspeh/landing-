#!/usr/bin/env bash
set -euo pipefail

# Run from an authenticated terminal, such as Google Cloud Shell.
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npm ci --prefix functions --ignore-scripts
node --test functions/push-actions.test.cjs
npx --yes firebase-tools@14.16.0 deploy \
  --project taxiuspeh-76d55 \
  --only functions:driver_push:notifyDriversOfNewOnlineOrder,functions:driver_push:notifyDriversOfOrderAssignment,functions:driver_push:sendDriverTestPush
