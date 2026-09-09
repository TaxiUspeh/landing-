import { BOOKING_SERVICES } from './booking-core.js?v=51';

// Presentation only: existing booking forms and Firebase order panels stay in place.
export function initClientHome() {
  const root = document.getElementById('clientHome');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const byId = id => document.getElementById(id);
  const visible = node => node && !node.hidden && !node.classList.contains('hidden');
  const text = id => byId(id)?.textContent.trim() || '';
  const panels = ['taxi', 'delivery', 'auction'].map(service => ({
    service, node: byId(`${service}-online-order-panel`)
  })).filter(item => item.node);
  let page = 'home';

  function openService(id) {
    const service = BOOKING_SERVICES.find(item => item.id === id);
    if (!service) return;
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
      empty.textContent = 'Сохранённых поездок пока нет. Текущий онлайн-заказ появится выше после оформления.';
      container.append(empty);
      return;
    }
    const hint = document.createElement('p');
    hint.className = 'home-muted';
    hint.textContent = 'Нажмите на маршрут, чтобы повторить поездку.';
    container.append(hint);
    for (const order of orders) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-trip';
      const date = document.createElement('small');
      date.textContent = [order.date, order.time].filter(Boolean).join(' · ');
      const route = document.createElement('strong');
      route.textContent = `${String(order.from || '—')} → ${String(order.to || '—')}`;
      const price = document.createElement('span');
      price.textContent = String(order.price || 'Цена уточняется');
      button.append(date, route, price);
      button.addEventListener('click', () => window.repeatOrder?.(String(order.from || ''), String(order.to || '')));
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
}
