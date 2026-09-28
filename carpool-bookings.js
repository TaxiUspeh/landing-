import { createCarpoolFeed } from './carpool-feed.js?v=82';
const activeStatuses = new Set(['confirmed', 'in_trip', 'boarded', 'disputed']);
const millis = value => value?.toMillis?.() ?? ((value?.seconds || 0) * 1000);
export const activeCarpoolBookings = bookings => bookings.filter(booking => activeStatuses.has(booking.status))
  .sort((a, b) => millis(a.departureAt) - millis(b.departureAt));

// One authenticated subscription feeds the home page and the full booking view.
// Nothing is copied to localStorage; changing accounts clears all private rows.
export const createCarpoolBookings = () => createCarpoolFeed({ field: 'bookings', readyMethod: 'ready', watchMethod: 'watchMine', label: 'бронирования', unavailable: 'Не удалось подключить попутки. Проверьте интернет и повторите попытку.' });
export const carpoolBookings = createCarpoolBookings();
