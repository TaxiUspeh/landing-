import { createCarpoolFeed } from './carpool-feed.js?v=82';
export const requestMillis = value => value?.toMillis?.() ?? ((value?.seconds || 0) * 1000);
export const activePassengerRequests = rows => rows.filter(row => row.status === 'open' && requestMillis(row.departureAt) > Date.now())
  .sort((a, b) => requestMillis(a.departureAt) - requestMillis(b.departureAt));
export const createPassengerRequests = () => createCarpoolFeed({ field: 'requests', readyMethod: 'hubReady', watchMethod: 'watchMyRequests', label: 'заявки', unavailable: 'Заявки попутчиков пока не подключены. Обновите страницу после подключения.' });
export const passengerRequests = createPassengerRequests();
