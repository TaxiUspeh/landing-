import { el, button, field, report, run, callLink, carpoolDate, carpoolMillis } from './carpool-common.js?v=82';
import { passengerRequests, activePassengerRequests } from './passenger-request-store.js?v=82';

export function passengerRequestStatus(row) {
  if (row.status === 'open') return carpoolMillis(row.departureAt) > Date.now() ? 'Ищу машину' : 'Время выезда прошло';
  return { found: 'Машина найдена', matched: 'Места забронированы', cancelled: 'Отменена', expired: 'Время выезда прошло' }[row.status] || row.status;
}
function requestCard(row) {
  const card = el('article', '', 'carpool-card'); card.dataset.requestId = row.id; card.tabIndex = -1;
  card.append(el('p', passengerRequestStatus(row), 'carpool-badge'), el('h3', `${row.fromCity} → ${row.toCity}`),
    el('p', carpoolDate(row.departureAt), 'carpool-time'), el('p', `Нужно мест: ${row.seats}`));
  return card;
}
export function initPassengerRequests(host, api, { store = passengerRequests, onFind = () => {} } = {}) {
  const create = el('details'), form = el('form', '', 'carpool-form'); create.className = 'carpool-request-create';
  create.append(el('summary', 'Создать заявку · Ищу машину'), el('p', 'Не нашли рейс? Оставьте заявку: водители увидят маршрут и смогут позвонить. Заявка не бронирует места; цену согласуйте или выберите рейс ниже.'), form);
  const from = field(form, 'Откуда · населённый пункт или адрес', 'fromCity'), to = field(form, 'Куда · населённый пункт или адрес', 'toCity');
  from.maxLength = to.maxLength = 150; from.placeholder = 'Например, Белоусовка'; to.placeholder = 'Например, Усть-Каменогорск';
  const departure = field(form, 'Дата и время · Казахстан (UTC+5)', 'departure', '', 'datetime-local');
  const seats = field(form, 'Количество мест', 'seats', '1', 'number'); seats.min = '1'; seats.max = '8'; seats.step = '1';
  const name = field(form, 'Ваше имя', 'name'); name.maxLength = 80; name.autocomplete = 'name';
  const phone = field(form, 'Телефон', 'phone', '', 'tel'); phone.maxLength = 32; phone.autocomplete = 'tel';
  const message = el('p'); message.setAttribute('role', 'status');
  const submit = el('button', 'Опубликовать заявку', 'carpool-primary'); submit.type = 'submit'; submit.disabled = true;
  form.append(el('p', 'Телефон увидят только водители с допуском к попуткам и диспетчер.'), submit, message);
  const mine = el('div'); mine.id = 'carpoolMyRequests';
  const info = el('p'); info.setAttribute('role', 'status');
  const retry = button('Обновить заявки', () => void store.refresh()); retry.hidden = true;
  const own = el('details'); own.className = 'carpool-own-requests'; own.append(el('summary', 'Мои заявки'), info, retry, mine);
  host.append(create, own);
  let current = store.getState(), generation = 0, target = '';
  function focusTarget(attempt = 0) {
    if (!target) return;
    const card = [...mine.querySelectorAll('[data-request-id]')].find(card => card.dataset.requestId === target);
    if (!card) return;
    own.open = true; card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (document.activeElement === card) target = '';
    else if (attempt < 20) { const id = target; window.requestAnimationFrame(() => { if (id === target) focusTarget(attempt + 1); }); }
  }
  function render() {
    const expanded = mine.querySelector('details')?.open || false; mine.replaceChildren();
    const active = activePassengerRequests(current.requests);
    own.querySelector('summary').textContent = `Мои заявки${active.length ? ` · ${active.length}` : ''}`;
    const history = el('details'); history.open = expanded; history.append(el('summary', 'История заявок'));
    for (const row of [...active, ...current.requests.filter(row => !active.includes(row))]) {
      const card = requestCard(row), status = el('p'); status.setAttribute('role', 'status');
      if (row.status === 'open' && carpoolMillis(row.departureAt) > Date.now()) {
        card.append(button('Посмотреть рейсы', () => onFind(row)));
        for (const [outcome, title] of [['found', 'Машина найдена'], ['cancelled', 'Отменить заявку']]) card.append(button(title, event => {
          if (!window.confirm(outcome === 'found' ? 'Вы договорились с водителем? Заявка исчезнет из списка поиска.' : 'Закрыть эту заявку?')) return;
          void run(event.currentTarget, status, () => api.command({ action: 'closeRequest', requestId: row.id, outcome }));
        }));
        mine.append(card);
      } else { history.append(card); }
      card.append(status);
    }
    if (!active.length) mine.append(el('p', 'Активных заявок пока нет.'));
    if (history.children.length > 1) mine.append(history);
    focusTarget();
  }
  create.addEventListener('toggle', () => { if (create.open) { departure.min = new Date(Date.now() + 5 * 3600000 + 5 * 60000).toISOString().slice(0,16); departure.max = new Date(Date.now() + 5 * 3600000 + 30 * 86400000).toISOString().slice(0,16); } });
  form.onsubmit = event => {
    event.preventDefault(); if (submit.disabled || !form.reportValidity()) return;
    const revision = generation;
    const data = { action: 'createRequest', fromCity: from.value.trim(), toCity: to.value.trim(), departureMs: Date.parse(departure.value + ':00+05:00'), seats: Number(seats.value), name: name.value.trim(), phone: phone.value.trim() };
    void run(submit, message, async () => {
      const result = await api.command(data); if (revision !== generation) return;
      form.reset(); seats.value = '1'; create.open = false; own.open = true; target = result.requestId;
      report(info, 'Заявка опубликована. Водители смогут связаться с вами.'); focusTarget();
    }).finally(() => { submit.disabled = !current.ready; });
  };
  const stop = store.subscribe(next => {
    if (next.uid !== current.uid) { generation++; form.reset(); seats.value = '1'; target = ''; create.open = own.open = false; }
    current = next; submit.disabled = !next.ready; retry.hidden = !next.error;
    report(info, next.error || (next.loading ? 'Загружаем заявки…' : ''), Boolean(next.error)); render();
  });
  store.start(api);
  const timer = window.setInterval(render, 60000);
  return {
    async open() { await store.refresh(); },
    focus(id) { target = id; focusTarget(); },
    destroy() { generation++; stop(); window.clearInterval(timer); host.replaceChildren(); },
  };
}

export function initPassengerDemand(host, api, admin = false) {
  const message = el('p'); message.setAttribute('role', 'status');
  const list = el('div'), more = button('Показать ещё заявки', () => { count += 50; void connect(); }); more.hidden = true;
  const retry = button('Обновить заявки', () => void connect());
  host.append(el('h2', 'Заявки от пассажиров'), el('p', 'Свяжитесь с пассажиром и согласуйте поездку. Для бронирования и расчёта комиссии опубликуйте рейс; пассажир выберет его и забронирует места.'), message, retry, list, more);
  let target = '', targetRow, focusPending = false, stopTarget;
  let uid = '', allowed = false, visible = false, stop, generation = 0, count = 50, rows = [];
  function render() {
    const revision = ++generation; list.replaceChildren();
    const combined = target && targetRow !== undefined ? [...rows.filter(row => row.id !== target), ...(targetRow ? [targetRow] : [])] : rows;
    const active = activePassengerRequests(combined); more.hidden = rows.length < count;
    for (const row of active) {
      const card = requestCard(row), status = el('p'); status.setAttribute('role', 'status');
      const contact = button('Связаться с пассажиром', async event => {
        const control = event.currentTarget; if (control.disabled) return;
        control.disabled = true; report(status, 'Открываем контакт…');
        try {
          const data = await api.read('passenger_request_contacts', row.id);
          if (revision !== generation || !allowed || !visible) return;
          if (!data) throw new Error('Заявка закрыта.');
          card.append(el('p', data.name), callLink(data.phone, 'Позвонить пассажиру')); contact.hidden = true; report(status, '');
        } catch { if (revision === generation) report(status, 'Контакт недоступен. Обновите список: заявка могла закрыться или время выезда уже прошло.', true); }
        finally { control.disabled = false; }
      });
      card.append(contact, status);
      if (admin) card.append(button('Закрыть заявку', event => {
        if (window.confirm('Убрать заявку из поиска?')) void run(event.currentTarget, status, () => api.command({ action: 'closeRequest', requestId: row.id, outcome: 'cancelled' }));
      }));
      list.append(card);
    }
    if (!active.length) list.append(el('p', 'Открытых заявок пока нет. Новые появятся здесь автоматически.'));
    if (focusPending) { const card = [...list.children].find(card => card.dataset.requestId === target); if (card) { card.focus({preventScroll:true}); card.scrollIntoView({block:'center',behavior:'smooth'}); focusPending = false; } }
  }
  let connection = 0;
  async function connect() {
    const request = ++connection; stop?.(); stop = null; stopTarget?.(); stopTarget = null; targetRow = undefined; generation++; rows = []; list.replaceChildren(); more.hidden = true;
    if (!visible || !uid) return;
    if (!allowed) { report(message, 'Доступ к заявкам включает диспетчер в карточке водителя: «Попутки».'); return; }
    report(message, 'Загружаем заявки…');
    try {
      const ready = await api.hubReady(); if (request !== connection) return;
      if (!ready) { report(message, 'Заявки пассажиров пока не подключены. Обновите страницу после подключения.'); return; }
      stop = api.watchRequests(count, next => {
        if (request !== connection) return;
        rows = next; render(); report(message, 'Заявки обновляются автоматически.');
      }, () => { if (request === connection) { generation++; rows = []; list.replaceChildren(); more.hidden = true; report(message, 'Не удалось получить заявки. Проверьте подключение и допуск к попуткам.', true); } });
      if (target && api.watchRequest) stopTarget = api.watchRequest(target, row => {
        if (request !== connection) return;
        targetRow = row; render();
        if (!activePassengerRequests(row ? [row] : []).length) report(message, 'Эта заявка закрыта или время выезда уже прошло. Ниже — актуальные заявки.');
      }, () => { if (request === connection) { targetRow = null; render(); report(message, 'Заявка больше недоступна. Ниже — актуальные заявки.'); } });
    } catch { if (request === connection) report(message, 'Не удалось загрузить заявки. Повторите попытку.', true); }
  }
  const timer = window.setInterval(() => { if (visible && allowed) render(); }, 60000);
  return {
    setContext(user, enabled) { const next = user?.uid || ''; if (next === uid && enabled === allowed) return; if (uid !== next) { target = ''; targetRow = undefined; focusPending = false; } uid = next; allowed = enabled; count = 50; void connect(); },
    focus(id) { if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) return; target = id; focusPending = true; void connect(); },
    show(value) { if (visible === value) return; visible = value; void connect(); },
    destroy() { connection++; generation++; stop?.(); stopTarget?.(); window.clearInterval(timer); host.replaceChildren(); },
  };
}
