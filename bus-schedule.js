import { localBusRoute, localBusDepartures, localBusStopTimes, busTime, belousovkaBusClock } from './local-bus-schedule.js?v=76';

export function initBusSchedule({ document = globalThis.document, now = () => new Date() } = {}) {
  const modal = document.getElementById('busScheduleModal');
  if (!modal) return null;
  const view = document.defaultView;
  const tabs = [...modal.querySelectorAll('[data-bus-route]')];
  const panels = { uka: 'routeUkaContent', glub: 'routeGlubContent', local: 'routeLocalContent' };
  const find = id => document.getElementById(id);
  const day = find('localBusDay'), direction = find('localBusDirection'), stop = find('localBusStop');
  const trip = find('localBusTrip'), rows = find('localBusRows'), next = find('localBusNext');
  let selectionKey = '';
  const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };

  function fillStops() {
    const previous = stop.value;
    // The arrival terminal is shown in the full route, but is not a boarding stop in this direction.
    const stops = localBusRoute(direction.value).slice(0, -1);
    stop.replaceChildren(...stops.map(item => option(item.id, item.name)));
    stop.value = stops.some(item => item.id === previous) ? previous : stops[0].id;
  }
  function renderRoute() {
    const departure = Number(trip.value);
    rows.replaceChildren(...localBusRoute(direction.value).map(item => {
      const row = document.createElement('tr');
      if (item.id === stop.value) row.className = 'bus-selected-stop';
      const time = document.createElement('td'); time.textContent = busTime(departure + item.offset);
      const name = document.createElement('th'); name.scope = 'row'; name.textContent = item.name;
      row.append(time, name); return row;
    }));
  }
  function refresh() {
    const clock = belousovkaBusClock(now()), today = day.value === 'today';
    const type = today ? clock.dayType : day.value;
    const route = localBusRoute(direction.value), departures = localBusDepartures(type, direction.value);
    const times = localBusStopTimes(type, direction.value, stop.value);
    const upcoming = today ? times.filter(item => item.time >= clock.minutes) : times;
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    find('localBusDayInfo').textContent = today
      ? `Сегодня ${days[clock.weekday]}${clock.holiday ? `, ${clock.holiday}` : ''}. ${type === 'weekend' ? 'Выходной' : 'Будний'} график. В Белоусовке ${busTime(clock.minutes)}.`
      : `${type === 'weekend' ? 'Выходной и праздничный' : 'Будний'} график. Показаны все рейсы выбранного графика.`;
    find('localBusRange').textContent = `Отправления ${direction.value === 'inbound' ? 'от Тереховки' : 'от Колледжа'}: ${busTime(departures[0])}–${busTime(departures.at(-1))}, каждый час.`;
    find('localBusEnd').textContent = type === 'weekend'
      ? 'Последний обратный рейс — 14:30. Прибытие к Колледжу в 15:00, движение завершено.'
      : 'Последний обратный рейс — 19:30. Рейса от Тереховки в 20:30 нет.';
    find('localBusNextTitle').textContent = today ? 'Ближайшие рейсы на вашей остановке' : 'Первые рейсы выбранного графика';
    next.replaceChildren();
    if (!upcoming.length) {
      const text = document.createElement('p'); text.className = 'bus-empty';
      text.textContent = 'На сегодня рейсов с этой остановки в выбранном направлении больше нет.';
      next.append(text);
    } else {
      for (const item of upcoming.slice(0, 3)) {
        const card = document.createElement('div'); card.className = 'bus-time-card';
        const time = document.createElement('strong'); time.textContent = busTime(item.time);
        const label = document.createElement('small');
        label.textContent = today ? (item.time === clock.minutes ? 'сейчас по графику' : `через ${item.time - clock.minutes} мин`) : 'по расписанию';
        card.append(time, label); next.append(card);
      }
    }
    find('localBusStopTimes').textContent = times.map(item => busTime(item.time)).join(' · ');
    const key = `${clock.dateKey}:${day.value}:${type}:${direction.value}:${stop.value}`;
    if (selectionKey !== key) {
      selectionKey = key;
      trip.replaceChildren(...departures.map(time => option(String(time), `${busTime(time)} — ${busTime(time + 30)}`)));
      trip.value = String(upcoming[0]?.departure ?? departures[0]);
    }
    find('localBusTripLabel').textContent = `Рейс ${direction.value === 'inbound' ? 'от Тереховки' : 'от Колледжа'}`;
    find('localBusTable').setAttribute('aria-label', `${route[0].name} — ${route.at(-1).name}`);
    renderRoute();
  }
  function selectRoute(route) {
    if (!panels[route]) return;
    for (const tab of tabs) {
      const active = tab.dataset.busRoute === route;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      const panel = find(panels[tab.dataset.busRoute]);
      panel.hidden = !active; panel.classList.toggle('hidden', !active);
    }
    if (route === 'local') refresh();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectRoute(tab.dataset.busRoute));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const selected = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectRoute(tabs[selected].dataset.busRoute); tabs[selected].focus();
    });
  }
  direction.addEventListener('change', () => { fillStops(); refresh(); });
  day.addEventListener('change', refresh); stop.addEventListener('change', refresh);
  trip.addEventListener('change', renderRoute);
  fillStops(); selectRoute('uka'); refresh();
  const visibleRefresh = () => { if (modal.classList.contains('active') && !find('routeLocalContent').hidden) refresh(); };
  const timer = view.setInterval(visibleRefresh, 30000);
  const observer = new view.MutationObserver(visibleRefresh);
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', visibleRefresh);
  return { selectRoute, refresh, destroy() { view.clearInterval(timer); observer.disconnect(); document.removeEventListener('visibilitychange', visibleRefresh); } };
}
