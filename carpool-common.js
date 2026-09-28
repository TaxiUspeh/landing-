import { carpoolCityKey } from './functions/carpool-cities.mjs?v=79';
export { carpoolCityKey };
export const carpoolMillis = value => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
export const carpoolMoney = value => `${Number(value).toLocaleString('ru-RU')} ₸`;
export const carpoolDate = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(carpoolMillis(value));
export const carpoolDay = (now = Date.now()) => new Date(now + 5 * 3600000).toISOString().slice(0, 10);
export const carpoolStatus = status => ({open:'Идёт набор',closed:'Бронирование закрыто',in_trip:'В пути',completed:'Поездка завершена',cancelled:'Отменено',confirmed:'Места забронированы',boarded:'Бронь подтверждена',disputed:'Проверяет диспетчер'})[status] || status;
export function el(tag, text = '', cls = '') { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
export function button(text, action, cls = '') { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', action); return node; }
export function field(form, title, name, value = '', type = 'text', required = true) {
  const label = el('label', title), input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.name = name; input.value = value; input.required = required; label.append(input); form.append(label); return input;
}
export function report(host, text, error = false) { host.textContent = text; host.classList.toggle('carpool-error', error); }
export async function run(control, status, task) {
  if (control.disabled) return;
  control.disabled = true; report(status, 'Сохраняем…');
  try { await task(); report(status, 'Сохранено.'); } catch (error) { report(status, error.message || 'Не удалось сохранить. Повторите попытку.', true); }
  finally { control.disabled = false; }
}
export function tripCard(trip) {
  const card = el('article', '', 'carpool-card');
  card.append(el('p', carpoolStatus(trip.status), 'carpool-badge'), el('h3', `${trip.fromCity} → ${trip.toCity}`),
    el('p', carpoolDate(trip.departureAt), 'carpool-time'), el('p', `${trip.driverName} · ID ${trip.driverId} · ${trip.car || 'Автомобиль'}`),
    el('p', `Посадка: ${trip.pickup}`), el('p', `Высадка: ${trip.dropoff}`),
    el('p', `Свободно ${trip.availableSeats} из ${trip.totalSeats} мест`), el('strong', `${carpoolMoney(trip.seatPrice)} за место`, 'carpool-price'));
  if (trip.luggage) card.append(el('p', `Багаж: ${trip.luggage}`));
  return card;
}
export function callLink(phone, label = 'Позвонить') {
  const link = el('a', label, 'carpool-call');
  if (/^\+?\d{10,15}$/.test(phone || '')) link.href = 'tel:' + phone;
  else { link.href = 'tel:+77770649648'; link.textContent = 'Позвонить диспетчеру'; }
  return link;
}
