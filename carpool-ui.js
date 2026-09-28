import { carpoolCityKey } from './functions/carpool-cities.mjs?v=79';
import { carpoolBookings } from './carpool-bookings.js?v=80';
export { carpoolCityKey };
export const carpoolMillis = value => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
export const carpoolMoney = value => `${Number(value).toLocaleString('ru-RU')} ₸`;
export const carpoolDate = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(carpoolMillis(value));
export const carpoolDay = (now = Date.now()) => new Date(now + 5 * 3600000).toISOString().slice(0, 10);
export const carpoolStatus = status => ({open:'Идёт набор',closed:'Бронирование закрыто',in_trip:'В пути',completed:'Поездка завершена',cancelled:'Отменено',confirmed:'Места забронированы',boarded:'Посадка подтверждена',disputed:'Проверяет диспетчер'})[status] || status;
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
export function initCarpoolClient(host, api, bookingsStore = carpoolBookings) {
  if (!host || host.dataset.ready) return;
  host.dataset.ready = 'true'; host.classList.add('carpool');
  const status = el('p', '', 'carpool-status'); status.setAttribute('role', 'status');
  const search = el('form', '', 'carpool-form carpool-search');
  const from = field(search, 'Откуда', 'fromCity', 'Белоусовка'), to = field(search, 'Куда', 'toCity', 'Усть-Каменогорск');
  from.maxLength = to.maxLength = 100; from.setAttribute('list', 'bookingCityList'); to.setAttribute('list', 'bookingCityList');
  const day = field(search, 'Дата выезда', 'date', carpoolDay(), 'date'); day.min = carpoolDay();
  const seats = field(search, 'Нужно мест', 'seats', '1', 'number'); seats.min = '1'; seats.max = '8'; seats.step = '1';
  const find = el('button', 'Найти машины', 'carpool-primary'); find.type = 'submit'; search.append(find);
  const list = el('div'), mine = el('div'); mine.id = 'carpoolMyBookings';
  const mineStatus = el('p'); mineStatus.setAttribute('role', 'status');
  host.append(el('h2', 'Попутки'), el('p', 'Цена за одно место. Время Казахстана. Оплата водителю.'), search, status, list, el('h2', 'Мои бронирования'), mineStatus, mine);
  let stopTrips = null, started = false, revision = 0, ready = false, rows = [], clientUid = '', selectedBooking = '';
  let lastBookings = null, openRevision = 0, focusRevision = 0;
  const drafts = new Map();
  const error = e => report(status, e.code === 'permission-denied' ? 'Доступ к попуткам пока не подключён. Обновите страницу или позвоните диспетчеру.' : 'Не удалось обновить данные. Проверьте интернет.', true);
  async function open() {
    if (started) return;
    const request = ++openRevision;
    started = true; report(status, 'Подключаем попутки…');
    try {
      const user = await api.user(true); const enabled = await api.ready();
      if (request !== openRevision) return;
      clientUid = user?.uid || ''; ready = enabled;
      if (!ready) { report(status, 'Онлайн-бронирование попуток подключается. Пока позвоните диспетчеру.'); find.disabled = true; started = false; return; }
      find.disabled = false; await bookingsStore.refresh(user);
      if (request !== openRevision) return;
      await searchTrips();
    } catch (e) { if (request === openRevision) { started = false; error(e); } }
  }
  async function searchTrips() {
    if (!search.reportValidity()) return;
    if (!ready) { await open(); return; }
    stopTrips?.(); list.replaceChildren(); report(status, 'Ищем подходящие машины…');
    const start = Date.parse(day.value + 'T00:00:00+05:00');
    stopTrips = api.watchTrips({ fromKey: carpoolCityKey(from.value), toKey: carpoolCityKey(to.value), start, end: start + 86400000 }, trips => {
      rows = trips; renderTrips(); report(status, trips.length ? 'Места обновляются автоматически.' : 'На эту дату подходящих машин пока нет. Выберите другой день или закажите машину целиком.');
    }, error);
  }
  function renderTrips() {
    for (const form of list.querySelectorAll('form[data-trip]')) drafts.set(form.dataset.trip, { visible: !form.hidden, ...Object.fromEntries(new FormData(form)) });
    const focused = document.activeElement?.closest('form[data-trip]') ? [document.activeElement.closest('form[data-trip]').dataset.trip, document.activeElement.name] : null;
    list.replaceChildren();
    for (const trip of rows.filter(t => t.availableSeats >= Number(seats.value) && carpoolMillis(t.departureAt) > Date.now())) {
      const card = tripCard(trip), form = el('form', '', 'carpool-form'), draft = drafts.get(trip.id); form.dataset.trip = trip.id; form.hidden = !draft?.visible;
      const count = field(form, 'Количество мест', 'count', draft?.count || seats.value, 'number'); count.min = '1'; count.max = String(trip.availableSeats); count.step = '1';
      const name = field(form, 'Ваше имя', 'name', draft?.name || ''); name.maxLength = 80; name.autocomplete = 'name';
      const phone = field(form, 'Телефон', 'phone', draft?.phone || '', 'tel'); phone.maxLength = 32; phone.autocomplete = 'tel';
      const total = el('strong', '', 'carpool-price'), confirm = el('button', '', 'carpool-primary'); confirm.type = 'submit';
      const update = () => { total.textContent = `Итого: ${carpoolMoney(Number(count.value) * trip.seatPrice)}`; confirm.textContent = `Подтвердить за ${carpoolMoney(Number(count.value) * trip.seatPrice)}`; }; count.oninput = update; update();
      const message = el('p'); message.setAttribute('role', 'status'); form.append(total, el('p', 'Бронирование подтвердится после проверки свободных мест.'), confirm, message);
      form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return;
        const data = { action: 'book', tripId: trip.id, seats: Number(count.value), expectedSeatPrice: trip.seatPrice, name: name.value.trim(), phone: phone.value.trim() };
        void run(confirm, message, async () => { await api.command(data); drafts.delete(trip.id); form.hidden = true; report(status, 'Места забронированы. Ваша бронь — ниже.'); mine.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      };
      card.append(button('Забронировать места', () => { form.hidden = !form.hidden; if (!form.hidden) name.focus(); }, 'carpool-primary'), form); list.append(card);
    }
    if (focused) for (const form of list.querySelectorAll('form[data-trip]')) if (form.dataset.trip === focused[0]) form.elements[focused[1]]?.focus({ preventScroll: true });
    if (!list.children.length) list.append(el('p', 'Машин с нужным количеством мест пока нет.'));
  }
  async function renderMine(bookings) {
    const request = ++revision; mine.replaceChildren();
    if (!bookings.length) { mine.append(el('p', 'У вас пока нет бронирований.')); return; }
    for (const booking of bookings) {
      const card = el('article', '', 'carpool-card'); card.dataset.bookingId = booking.id; card.tabIndex = -1;
      card.append(el('p', carpoolStatus(booking.status), 'carpool-badge'), el('h3', `${booking.fromCity} → ${booking.toCity}`),
        el('p', carpoolDate(booking.departureAt)), el('p', `${booking.seats} мест · ${carpoolMoney(booking.amount)}`), el('p', `${booking.driverName} · ${booking.car}`),
        el('p', `Посадка: ${booking.pickup}`), el('p', `Высадка: ${booking.dropoff}`));
      const message = el('p'); message.setAttribute('role', 'status');
      if (booking.reason) card.append(el('p', booking.reason));
      if (booking.status === 'confirmed') card.append(button('Отменить бронь', event => {
        if (!window.confirm('Отменить все места в этой брони?')) return;
        void run(event.currentTarget, message, () => api.command({ action: 'cancelBooking', tripId: booking.tripId, bookingId: booking.id }));
      }));
      card.append(message); mine.append(card);
      focusBooking();
      if (['confirmed', 'boarded', 'disputed'].includes(booking.status)) void loadContact(booking, card, message, request);
    }
  }
  async function loadContact(booking, card, message, request) {
    try {
      const [contact, secret] = await Promise.all([api.read('carpoolContacts', booking.id), booking.status === 'confirmed' ? api.read('carpoolBoardingCodes', booking.id) : null]);
      if (request !== revision) return;
      if (secret) card.append(el('strong', `Код посадки: ${secret.code}`, 'carpool-code'), el('p', 'Сообщите код водителю при посадке.'));
      card.append(callLink(contact?.driverPhone, 'Позвонить водителю'), callLink('', 'Позвонить диспетчеру'));
    } catch { if (request === revision) report(message, 'Контакты временно недоступны. Позвоните диспетчеру.', true); }
  }
  function focusBooking() {
    if (!selectedBooking || !window.bookingScreen?.isCarpool?.()) return;
    const card = [...mine.children].find(node => node.dataset.bookingId === selectedBooking);
    if (!card) return;
    selectedBooking = '';
    const request = ++focusRevision;
    const focus = (attempt = 0) => {
      if (request !== focusRevision || !card.isConnected || !window.bookingScreen?.isCarpool?.()) return;
      card.focus({ preventScroll: true });
      if (document.activeElement === card) card.scrollIntoView({ block: 'start', behavior: 'instant' });
      // The modal becomes focusable on the next animation frame, after visibility changes.
      else if (attempt < 20) window.requestAnimationFrame(() => focus(attempt + 1));
    };
    focus();
  }
  const openFromEvent = event => {
    selectedBooking = event.detail?.bookingId || '';
    void open(); focusBooking();
  };
  const online = () => { void bookingsStore.refresh(); if (!started && window.bookingScreen?.isCarpool?.()) void open(); };
  search.onsubmit = event => { event.preventDefault(); void searchTrips(); };
  bookingsStore.start(api);
  const stopBookings = bookingsStore.subscribe(state => {
    if (clientUid && state.uid !== clientUid) {
      stopTrips?.(); openRevision++; revision++; focusRevision++; started = false; ready = false; selectedBooking = '';
      drafts.clear(); list.replaceChildren(); mine.replaceChildren();
    }
    clientUid = state.uid;
    if (lastBookings !== state.bookings) { lastBookings = state.bookings; void renderMine(state.bookings); }
    report(mineStatus, state.error || (state.loading ? 'Загружаем бронирования…' : ''), Boolean(state.error));
    mine.hidden = !state.bookings.length && Boolean(state.loading || state.error);
  });
  window.addEventListener('carpool-open', openFromEvent);
  window.addEventListener('online', online);
  if (window.bookingScreen?.isCarpool?.()) void open();
  return { open, destroy() { stopTrips?.(); stopBookings(); revision++; openRevision++; focusRevision++; window.removeEventListener('carpool-open', openFromEvent); window.removeEventListener('online', online); } };
}
