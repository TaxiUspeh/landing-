#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
npx --yes firebase-tools@14.16.0 deploy --project taxiuspeh-76d55 --only firestore:rules
echo 'Координаты заказов подключены. Обновите клиентскую страницу и кабинет водителя.'
