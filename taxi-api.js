import { ensureFirebaseUser } from './firebase-config.js';

// Production Taxi API. Проверка выполняется через Firebase Preview.
const TAXI_API_BASE_URL =
  'https://taxi-api-prod-310166868868.asia-south1.run.app';

async function getTaxiIdToken() {
  const user = await ensureFirebaseUser();

  if (!user) {
    throw new Error('Не удалось авторизоваться в сервисе Taxi.');
  }

  return user.getIdToken();
}

async function postTaxiApi(path, payload, signal) {
  const token = await getTaxiIdToken();

  const response = await fetch(`${TAXI_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.error || `Taxi API: HTTP ${response.status}`
    );
  }

  return data;
}

export async function taxiRoute(
  coordinates,
  {
    overview = 'full',
    geometries = 'geojson',
    steps = false,
    signal
  } = {}
) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Для построения маршрута нужны минимум две точки.');
  }

  return postTaxiApi('/api/taxi/route', {
    coordinates,
    overview,
    geometries,
    steps
  }, signal);
}

export async function taxiTable(
  coordinates,
  {
    sources,
    destinations,
    signal
  } = {}
) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Для расчёта времени нужны минимум две точки.');
  }

  return postTaxiApi('/api/taxi/table', {
    coordinates,
    sources,
    destinations
  }, signal);
}
