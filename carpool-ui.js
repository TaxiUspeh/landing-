import { carpoolBookings } from './carpool-bookings.js?v=82';
import { el, button, field, report, run, tripCard, callLink, carpoolDate, carpoolMoney, carpoolStatus, carpoolMillis, carpoolDay, carpoolCityKey } from './carpool-common.js?v=82';
import { passengerRequests } from './passenger-request-store.js?v=82';
import { initPassengerRequests } from './carpool-requests.js?v=82';
export * from './carpool-common.js?v=82';
export function initCarpoolClient(host, api, bookingsStore = carpoolBookings, requestsStore = passengerRequests) {
  if (!host || host.dataset.ready) return;
  host.dataset.ready = 'true'; host.classList.add('carpool');
  const status = el('p', '', 'carpool-status'); status.setAttribute('role', 'status');
  const search = el('form', '', 'carpool-form carpool-search');
  const from = field(search, 'Откуда', 'fromCity', '', 'text', false), to = field(search, 'Куда', 'toCity', '', 'text', false);
  from.maxLength = to.maxLength = 100; from.setAttribute('list', 'bookingCityList'); to.setAttribute('list', 'bookingCityList');
  const day = field(search, 'Дата выезда', 'date', '', 'date', false); day.min = carpoolDay();
  const seats = field(search, 'Нужно мест', 'seats', '1', 'number'); seats.min = '1'; seats.max = '8'; seats.step = '1';
  const find = el('button', 'Найти машины', 'carpool-primary'); find.type = 'submit'; search.append(find, button('Все направления и даты', () => { from.value = to.value = day.value = ''; seats.value = '1'; selectedRequest = null; pageSize = 50; void searchTrips(); }));
  const list = el('div'), mine = el('div'); mine.id = 'carpoolMyBookings';
  const mineStatus = el('p'); mineStatus.setAttribute('role', 'status');
  const filters = el('details'); filters.append(el('summary', 'Направление, дата и места'), search);
  const requestsHost = el('section');
  const more = button('Показать ещё рейсы', () => { pageSize += 50; void searchTrips(); }); more.hidden = true;
  const linked = el('p'); linked.hidden = true; linked.setAttribute('role', 'status');
  host.append(el('h2', 'Межгород / Попутки'), el('p', 'Ближайшие рейсы по всем направлениям. Цена за место, время Казахстана, оплата водителю.'), requestsHost, filters, linked, el('h2', 'Доступные машины'), status, list, more, el('h2', 'Мои бронирования'), mineStatus, mine);
  let selectedRequest = null, pageSize = 50, searchRevision = 0;
  const requests = initPassengerRequests(requestsHost, api, { store: requestsStore, onFind(row) {
    selectedRequest = row; from.value = row.fromCity; to.value = row.toCity; day.value = carpoolDay(carpoolMillis(row.departureAt)); seats.value = String(row.seats); pageSize = 50;
    void searchTrips(); status.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } });
  let stopTrips = null, started = false, revision = 0, ready = false, rows = [], clientUid = '', selectedBooking = '';
  let lastBookings = null, openRevision = 0, focusRevision = 0;
  const drafts = new Map();
  const error = e => report(status, e.code === 'permission-denied' ? 'Доступ к попуткам пока не подключён. Обновите страницу или позвоните диспетчеру.' : 'Не удалось обновить данные. Проверьте интернет.', true);
  async function open() {
    if (started) return;
    const request = ++openRevision;
    started = true; report(status, 'Подключаем попутки…');
    try {
      const user = await api.user(true); const enabled = await api.ready() && await api.hubReady();
      if (request !== openRevision) return;
      clientUid = user?.uid || ''; ready = enabled;
      if (!ready) { report(status, 'Онлайн-бронирование попуток подключается. Пока позвоните диспетчеру.'); find.disabled = true; started = false; return; }
      find.disabled = false; await bookingsStore.refresh(user);
      if (request !== openRevision) return;
      await requests.open(); if (request !== openRevision) return; await searchTrips();
    } catch (e) { if (request === openRevision) { started = false; error(e); } }
  }
  async function searchTrips() {
    if (!search.reportValidity()) return;
    if (Boolean(from.value.trim()) !== Boolean(to.value.trim())) { report(status, 'Для поиска по маршруту укажите и «Откуда», и «Куда», либо оставьте оба поля пустыми.', true); return; }
    if (!ready) { await open(); return; }
    stopTrips?.(); list.replaceChildren(); more.hidden = true; report(status, 'Ищем подходящие машины…');
    const request = ++searchRevision;
    linked.hidden = !selectedRequest;
    linked.textContent = selectedRequest ? 'Вы выбираете рейс для своей заявки. После подтверждения брони заявка закроется автоматически.' : '';
    const start = day.value ? Date.parse(day.value + 'T00:00:00+05:00') : Date.now();
    stopTrips = api.watchTrips({ ...(from.value.trim() ? { fromKey: carpoolCityKey(from.value), toKey: carpoolCityKey(to.value) } : {}), start, ...(day.value ? { end: start + 86400000 } : {}), limit: pageSize }, trips => {
      if (request !== searchRevision) return;
      rows = trips; renderTrips(); more.hidden = trips.length < pageSize;
      report(status, trips.length ? 'Места обновляются автоматически.' : 'Подходящих машин пока нет. Создайте заявку «Ищу машину» — водители смогут связаться с вами.');
    }, e => { if (request === searchRevision) error(e); });
  }

  function renderTrips() {
    for (const form of list.querySelectorAll('form[data-trip]')) drafts.set(form.dataset.trip, { visible: !form.hidden, ...Object.fromEntries(new FormData(form)) });
    const focused = document.activeElement?.closest('form[data-trip]') ? [document.activeElement.closest('form[data-trip]').dataset.trip, document.activeElement.name] : null;
    list.replaceChildren();
    for (const trip of rows.filter(t => t.availableSeats >= Number(seats.value) && carpoolMillis(t.departureAt) > Date.now())) {
      const card = tripCard(trip), form = el('form', '', 'carpool-form'), draft = drafts.get(trip.id); form.dataset.trip = trip.id; form.hidden = !draft?.visible;
      const count = field(form, 'Количество мест', 'count', draft?.count || seats.value, 'number'); count.min = '1'; count.max = String(trip.availableSeats); count.step = '1';
      if (selectedRequest) { count.value = String(selectedRequest.seats); count.readOnly = true; }
      const name = field(form, 'Ваше имя', 'name', draft?.name || ''); name.maxLength = 80; name.autocomplete = 'name';
      const phone = field(form, 'Телефон', 'phone', draft?.phone || '', 'tel'); phone.maxLength = 32; phone.autocomplete = 'tel';
      const total = el('strong', '', 'carpool-price'), confirm = el('button', '', 'carpool-primary'); confirm.type = 'submit';
      const update = () => { total.textContent = `Итого: ${carpoolMoney(Number(count.value) * trip.seatPrice)}`; confirm.textContent = `Подтвердить за ${carpoolMoney(Number(count.value) * trip.seatPrice)}`; }; count.oninput = update; update();
      const message = el('p'); message.setAttribute('role', 'status'); form.append(total, el('p', 'Бронирование подтвердится после проверки свободных мест.'), confirm, message);
      form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return;
        const data = { action: 'book', tripId: trip.id, seats: Number(count.value), expectedSeatPrice: trip.seatPrice, name: name.value.trim(), phone: phone.value.trim(), ...(selectedRequest ? { requestId: selectedRequest.id } : {}) };
        void run(confirm, message, async () => { await api.command(data); selectedRequest = null; linked.hidden = true; drafts.delete(trip.id); form.hidden = true; report(status, 'Места забронированы. Ваша бронь — ниже.'); mine.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
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
      if (['confirmed', 'in_trip', 'boarded', 'disputed'].includes(booking.status)) void loadContact(booking, card, message, request);
    }
  }
  async function loadContact(booking, card, message, request) {
    try {
      const contact = await api.read('carpoolContacts', booking.id);
      if (request !== revision) return;
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
    void open(); focusBooking(); if (event.detail?.requestId) requests.focus(event.detail.requestId);
  };
  const online = () => { void bookingsStore.refresh(); if (!started && window.bookingScreen?.isCarpool?.()) void open(); };
  search.onsubmit = event => { event.preventDefault(); selectedRequest = null; pageSize = 50; void searchTrips(); };
  bookingsStore.start(api);
  const stopBookings = bookingsStore.subscribe(state => {
    if (clientUid && state.uid !== clientUid) {
      stopTrips?.(); openRevision++; revision++; focusRevision++; started = false; ready = false; selectedBooking = '';
      searchRevision++; selectedRequest = null; linked.hidden = true; rows = []; drafts.clear(); list.replaceChildren(); mine.replaceChildren();
    }
    clientUid = state.uid;
    if (lastBookings !== state.bookings) { lastBookings = state.bookings; void renderMine(state.bookings); }
    report(mineStatus, state.error || (state.loading ? 'Загружаем бронирования…' : ''), Boolean(state.error));
    mine.hidden = !state.bookings.length && Boolean(state.loading || state.error);
  });
  window.addEventListener('carpool-open', openFromEvent);
  window.addEventListener('online', online);
  if (window.bookingScreen?.isCarpool?.()) void open();
  const timer = window.setInterval(() => { if (ready && window.bookingScreen?.isCarpool?.()) renderTrips(); }, 60000);
  return { open, destroy() { searchRevision++; window.clearInterval(timer); requests.destroy(); stopTrips?.(); stopBookings(); revision++; openRevision++; focusRevision++; window.removeEventListener('carpool-open', openFromEvent); window.removeEventListener('online', online); } };
}
