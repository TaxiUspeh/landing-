import { BOOKING_SERVICES } from './booking-core.js?v=78';
import { carpoolBookings, activeCarpoolBookings } from './carpool-bookings.js?v=80';
import { carpoolDate, carpoolMoney, carpoolStatus, carpoolMillis } from './carpool-ui.js?v=80';

// Presentation only: existing booking forms and Firebase order panels stay in place.
export function initClientHome({ bookingsStore = carpoolBookings } = {}) {
  const root = document.getElementById('clientHome');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const byId = id => document.getElementById(id);
  const visible = node => node && !node.hidden && !node.classList.contains('hidden');
  const text = id => byId(id)?.textContent.trim() || '';
  const panels = ['taxi', 'delivery', 'auction', 'soberDriver', 'cargo', 'assistance'].map(service => ({
    service, node: byId(`${service}-online-order-panel`)
  })).filter(item => item.node);
  let page = 'home';
  let carpoolState = bookingsStore.getState(), taxiActive = 0, cancellation = null;
  const node = (tag, copy, cls = '') => { const element = document.createElement(tag); element.textContent = copy; element.className = cls; return element; };

  function openBooking(booking) { window.bookingScreen?.openCarpool?.(booking.id); }

  function bookingCard(booking, featured = false) {
    const card = node('button', '', featured ? 'home-current home-carpool' : 'home-trip home-carpool');
    card.type = 'button'; card.dataset.carpoolBooking = booking.id;
    card.append(node('small', `${featured ? 'Ваша попутка' : 'Попутка'} · ${carpoolStatus(booking.status)}`),
      node('strong', `${booking.fromCity} → ${booking.toCity}`),
      node('span', carpoolDate(booking.departureAt)),
      node('span', `Мест: ${booking.seats} · Итого ${carpoolMoney(booking.amount)}`),
      node('b', 'Открыть бронь →'));
    card.addEventListener('click', () => openBooking(booking));
    return card;
  }

  function syncTripCount() {
    const count = taxiActive + activeCarpoolBookings(carpoolState.bookings).length;
    const nav = document.querySelector('.home-nav [data-home-go="trips"]');
    const badge = nav?.querySelector('[data-home-trip-count]');
    if (badge) { badge.hidden = count === 0; badge.textContent = String(count); }
    nav?.setAttribute('aria-label', count ? `Мои поездки. Активных: ${count}` : 'Мои поездки');
    const all = root.querySelector('[data-home-all-trips]');
    if (all) { all.hidden = count < 2; all.textContent = `Все мои поездки · ${count}`; }
  }

  function renderCarpool() {
    const active = activeCarpoolBookings(carpoolState.bookings);
    const home = root.querySelector('[data-home-carpool]');
    home.replaceChildren(); home.hidden = !active.length;
    if (active.length) {
      home.append(bookingCard(active[0], true));
      const all = node('button', '', 'home-all-trips'); all.type = 'button'; all.dataset.homeAllTrips = '';
      all.addEventListener('click', () => showPage('trips')); home.append(all);
    }
    const message = root.querySelector('[data-home-carpool-message]'); message.replaceChildren();
    message.hidden = !cancellation && !(carpoolState.error && active.length);
    if (cancellation) {
      message.append(node('p', `Попутка ${cancellation.fromCity} → ${cancellation.toCity}: бронь отменена.`));
      const details = node('button', 'Посмотреть бронь'); details.type = 'button'; details.onclick = () => openBooking(cancellation);
      const dismiss = node('button', 'Понятно'); dismiss.type = 'button'; dismiss.onclick = () => { cancellation = null; renderCarpool(); };
      message.append(details, dismiss);
    }
    if (carpoolState.error && active.length) message.append(node('p', carpoolState.error));
    const trips = root.querySelector('[data-home-carpool-trips]');
    const expanded = trips.querySelector('details')?.open || false;
    trips.replaceChildren(); trips.hidden = !carpoolState.uid;
    if (carpoolState.uid) {
      trips.append(node('h3', 'Бронирования попуток', 'home-section-title'));
      if (carpoolState.loading || carpoolState.error) {
        const info = node('p', carpoolState.error || 'Загружаем бронирования…', 'home-muted'); info.setAttribute('role', 'status'); trips.append(info);
        if (carpoolState.error) {
          const retry = node('button', 'Обновить бронирования', 'home-all-trips'); retry.type = 'button'; retry.onclick = () => void bookingsStore.refresh(); trips.append(retry);
        }
      }
      active.forEach(booking => trips.append(bookingCard(booking)));
      if (!active.length && !carpoolState.loading && !carpoolState.error) trips.append(node('p', 'Активных броней попуток пока нет.', 'home-muted'));
      const activeIds = new Set(active.map(booking => booking.id));
      const history = carpoolState.bookings.filter(booking => !activeIds.has(booking.id))
        .sort((a, b) => carpoolMillis(b.updatedAt || b.createdAt || b.departureAt) - carpoolMillis(a.updatedAt || a.createdAt || a.departureAt));
      if (history.length) {
        const details = document.createElement('details'); details.className = 'home-carpool-history'; details.open = expanded;
        details.append(node('summary', `История попуток · ${history.length}`));
        history.forEach(booking => details.append(bookingCard(booking))); trips.append(details);
      }
    }
    syncTripCount();
  }

  function openService(id) {
    const service = BOOKING_SERVICES.find(item => item.id === id);
    if (!service) return;
    if (window.bookingScreen?.openService) { window.bookingScreen.openService(id); return; }
    window.openModal?.(`${service.form}Modal`);
    // Use the existing category selector so pricing, seats and wishes stay in sync.
    document.querySelector(`[data-booking-service="${id}"]`)?.click();
  }

  function renderHistory() {
    const container = byId('homeHistory');
    container.replaceChildren();
    let orders = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem('taxi_full_orders_history') || '[]');
      if (Array.isArray(stored)) orders = stored.filter(item => item && typeof item === 'object').slice(0, 50);
    } catch { /* An unavailable or damaged local history must not block ordering. */ }
    if (!orders.length) {
      const empty = document.createElement('p');
      empty.className = 'home-empty';
      empty.textContent = 'Сохранённых заказов такси и других услуг пока нет. Текущий онлайн-заказ появится выше после оформления.';
      container.append(empty);
      return;
    }
    const hint = document.createElement('p');
    hint.className = 'home-muted';
    hint.textContent = 'Нажмите на запись, чтобы повторить заказ.';
    container.append(hint);
    for (const order of orders) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-trip';
      const date = document.createElement('small');
      date.textContent = [order.date, order.time].filter(Boolean).join(' · ');
      const route = document.createElement('strong');
      route.textContent = order.serviceType === 'assistance' ? `${String(order.from || '—')} · Помощь на дороге` : `${String(order.from || '—')} → ${String(order.to || '—')}`;
      const price = document.createElement('span');
      price.textContent = String(order.price || 'Цена уточняется');
      button.append(date, route, price);
      button.addEventListener('click', () => order.serviceType === 'assistance'
        ? window.repeatOrder?.(String(order.from || ''), '', 'assistance')
        : window.repeatOrder?.(String(order.from || ''), String(order.to || '')));
      container.append(button);
    }
  }

  function showPage(name, focus = true) {
    if (!root.querySelector(`[data-home-page="${name}"]`)) return;
    page = name;
    root.querySelectorAll('[data-home-page]').forEach(node => { node.hidden = node.dataset.homePage !== name; });
    document.querySelectorAll('.home-nav [data-home-go]').forEach(button => {
      const selected = button.dataset.homeGo === name || name === 'services' && button.dataset.homeGo === 'home';
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (name === 'trips') renderHistory();
    if (focus) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      const heading = root.querySelector(`[data-home-page="${name}"] h2`);
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    }
  }

  function syncOrder() {
    // The new-order action is hidden by client-orders.js exactly while an order is active.
    const available = panels.filter(item => visible(item.node));
    const isActive = item => !visible(byId(`${item.service}-online-new-order-button`));
    const order = available.find(isActive) || available[0];
    taxiActive = order && isActive(order) ? 1 : 0;
    syncTripCount();
    for (const container of root.querySelectorAll('[data-home-current], [data-home-latest]')) {
      const show = order && (!container.hasAttribute('data-home-current') || isActive(order));
      container.hidden = !show;
      if (!show) { container.replaceChildren(); continue; }
      const prefix = `${order.service}-online-order-`;
      const signature = [order.service, text(prefix + 'status'), text(prefix + 'route'), text(prefix + 'price')].join('\n');
      if (container.dataset.signature === signature && container.firstChild) continue;
      container.dataset.signature = signature;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'home-current';
      const caption = document.createElement('small');
      caption.textContent = isActive(order) ? 'Ваш текущий заказ' : 'Последний онлайн-заказ';
      const status = document.createElement('strong'); status.textContent = text(prefix + 'status');
      const route = document.createElement('span'); route.textContent = text(prefix + 'route');
      const action = document.createElement('b'); action.textContent = 'Открыть заказ →';
      button.append(caption, status, route, action);
      button.addEventListener('click', () => window.openModal?.(`${order.service}Modal`));
      container.replaceChildren(button);
    }
  }

  document.querySelectorAll('[data-home-go]').forEach(button => button.addEventListener('click', () => {
    showPage(button.dataset.homeGo);
    if (button.hasAttribute('data-home-partners')) byId('partnerServices')?.scrollIntoView({ block: 'start' });
  }));
  document.querySelectorAll('[data-home-service]').forEach(button => button.addEventListener('click', () => openService(button.dataset.homeService)));
  root.querySelectorAll('[data-home-modal]').forEach(button => button.addEventListener('click', () => window.openModal?.(button.dataset.homeModal)));
  const actions = {
    install: () => window.installApp?.(), share: () => window.shareApp?.(),
    theme: () => window.toggleTheme?.(), notifications: () => window.togglePushNotifications?.(),
    location: () => window.getCurrentLocation?.('main'), weather: () => window.fetchRealWeather?.()
  };
  root.querySelectorAll('[data-home-action]').forEach(button => button.addEventListener('click', () => actions[button.dataset.homeAction]?.()));
  root.querySelector('[data-home-city]')?.addEventListener('click', () => { openService('taxi'); byId('bookingCity')?.click(); });
  byId('lineStatus')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.openMapModal?.(); }
  });
  const city = byId('bookingCity')?.querySelector('span');
  if (city) {
    const syncCity = () => { byId('homeCityName').textContent = city.textContent; };
    new MutationObserver(syncCity).observe(city, { childList: true, characterData: true, subtree: true });
    syncCity();
  }
  const observer = new MutationObserver(syncOrder);
  panels.forEach(item => observer.observe(item.node, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, characterData: true, subtree: true }));
  window.addEventListener('storage', event => { if (event.key === 'taxi_full_orders_history' && page === 'trips') renderHistory(); });
  showPage('home', false);
  syncOrder();
  bookingsStore.subscribe(next => {
    if (next.uid !== carpoolState.uid) cancellation = null;
    else {
      const previous = new Set(activeCarpoolBookings(carpoolState.bookings).map(booking => booking.id));
      const cancelled = next.bookings.find(booking => previous.has(booking.id) && booking.status === 'cancelled');
      if (cancelled) cancellation = cancelled;
    }
    carpoolState = next; renderCarpool();
  });
}
