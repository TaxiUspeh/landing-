import { BOOKING_SERVICES, normalizeCity, parseHouseDetails, addressWithCity, serviceWishes, createGeocoder } from './booking-core.js';

export function initBookingScreen({ preview = false } = {}) {
  const $ = id => document.getElementById(id);
  const overlay = $('mapModal');
  if (!overlay || window.bookingScreen) return;
  const originalOpen = window.openModal;
  const originalClose = window.closeModal;
  const mapElement = $('simulationMap');
  const mapMessage = $('mapOverlayText');
  const geocoder = createGeocoder();
  const emptyPoint = () => ({ address: '', city: 'Белоусовка', lat: null, lon: null });
  const state = { from: emptyPoint(), to: emptyPoint(), stops: [], details: '', note: '', service: BOOKING_SERVICES[0], channel: 'online', revision: 0 };
  let opened = false, returnFocus = null, pickerTarget = null, pickerRevision = 0;
  let locating = false, initialLocationRequested = false, locationRevision = 0, searchRevision = 0;
  let routeRevision = 0, routeLayer = null, routeMarkers = [], pickedPoint = null, pickMarker = null;
  let refreshQueued = false, submitting = false;
  const pointCache = new Map(), routeCache = new Map();
  const panels = new Map();
  const sourcePointFields = ['taxiFrom', 'taxiTo', 'auctionFrom', 'auctionTo', 'cargoFrom', 'cargoTo', 'soberDriverFrom', 'soberDriverTo', 'assistanceAddress', 'deliveryAddress'];

  overlay.classList.add('booking-screen');
  overlay.setAttribute('aria-label', 'Заказ Такси Успех');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="booking-shell">
      <header class="booking-header">
        <button type="button" class="booking-icon-button" id="bookingClose" aria-label="Вернуться на главную"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
        <h2>Такси «Успех»</h2>
        <button type="button" class="booking-icon-button" id="bookingHistory" aria-label="История заказов"><i class="fas fa-history" aria-hidden="true"></i></button>
      </header>
      <div class="booking-body">
        <div class="booking-map" id="bookingMapHost">
          <button type="button" class="booking-icon-button booking-location" id="bookingLocate" aria-label="Моё местоположение"><i class="fas fa-location-arrow" aria-hidden="true"></i></button>
          <button type="button" class="booking-pick-confirm" id="bookingPickConfirm" hidden>Передвиньте карту и нажмите здесь</button>
          <a class="booking-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap · поиск Photon</a>
        </div>
        <section class="booking-sheet" aria-label="Маршрут и услуга">
          <button type="button" id="bookingGrip" class="booking-grip" aria-label="Развернуть форму заказа" aria-expanded="false"></button>
          <div class="booking-scroll" id="bookingScroll">
            <div id="bookingCommon">
              <button type="button" class="booking-city" id="bookingCity"><i class="fas fa-map-marker-alt" aria-hidden="true"></i><span>Белоусовка</span><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
              <div class="booking-address">
                <button type="button" class="booking-address-button" id="bookingFrom"><span class="booking-marker">А</span><span class="booking-address-copy"><small id="bookingFromLabel">Откуда</small><strong id="bookingFromValue">Укажите место подачи</strong></span></button>
                <button type="button" class="booking-icon-button" id="bookingAddStop" aria-label="Добавить остановку">+</button>
              </div>
              <label for="bookingDetails" class="sr-only">Дом и подъезд</label>
              <input id="bookingDetails" class="booking-detail" placeholder="Дом, подъезд — например: 8, подъезд 2" maxlength="100" autocomplete="off">
              <div id="bookingStops"></div>
              <div class="booking-address" id="bookingToRow">
                <button type="button" class="booking-address-button" id="bookingTo"><span class="booking-marker booking-marker-destination">Б</span><span class="booking-address-copy"><small>Куда</small><strong id="bookingToValue">Укажите адрес назначения</strong></span></button>
                <button type="button" class="booking-icon-button" id="bookingSwap" aria-label="Поменять адреса местами"><i class="fas fa-exchange-alt" aria-hidden="true"></i></button>
              </div>
              <label for="bookingNote" class="sr-only">Примечание</label>
              <textarea id="bookingNote" rows="1" class="booking-detail booking-note" maxlength="400" placeholder="Примечание к заказу"></textarea>
              <p id="bookingLocationStatus" class="booking-status" role="status"></p>
              <div class="booking-service-nav">
                <button type="button" class="booking-icon-button booking-service-arrow" id="bookingServicesPrev" aria-label="Предыдущие услуги">‹</button>
                <div id="bookingServices" class="booking-services" role="group" aria-label="Выберите услугу"></div>
                <button type="button" class="booking-icon-button booking-service-arrow" id="bookingServicesNext" aria-label="Следующие услуги">›</button>
              </div>
              <p id="bookingServiceHelp" class="booking-help"></p>
            </div>
            <div id="bookingPanels"></div>
            <p id="bookingStatus" class="booking-status" role="alert"></p>
          </div>
          <footer class="booking-footer" id="bookingFooter">
            <div class="booking-price-row">
              <div><span class="booking-price-caption" id="bookingPriceCaption">Примерная стоимость</span><div class="booking-price" id="bookingPrice">Укажите маршрут</div></div>
              <div class="booking-channel" role="group" aria-label="Способ заказа"><button type="button" id="bookingOnline" aria-pressed="true">Онлайн</button><button type="button" id="bookingWhatsapp" aria-pressed="false">WhatsApp</button></div>
            </div>
            <button type="button" class="booking-submit" id="bookingSubmit">Заказать онлайн</button>
          </footer>
        </section>
      </div>
      <section class="booking-picker" id="bookingPicker" aria-label="Выбор адреса" hidden>
        <div class="booking-picker-heading"><button type="button" id="bookingPickerBack" class="booking-icon-button" aria-label="Назад к заказу">‹</button><h3 id="bookingPickerTitle">Куда</h3><button type="button" id="bookingOnMap" class="booking-city">На карте</button></div>
        <label for="bookingSearchCity">Город или посёлок</label><input id="bookingSearchCity" list="bookingCityList" autocomplete="off" maxlength="100"><datalist id="bookingCityList"></datalist>
        <label for="bookingSearchInput">Улица, дом или название места</label><div class="booking-search-row"><input id="bookingSearchInput" autocomplete="off" maxlength="200" placeholder="Например: Гоголя" enterkeyhint="search"><button type="button" id="bookingSearchButton">Найти</button></div>
        <p id="bookingSearchStatus" class="booking-status" role="status">Введите адрес или выберите точку на карте.</p>
        <div id="bookingSearchResults" aria-label="Найденные адреса"></div>
        <button type="button" class="booking-picker-done" id="bookingManualAddress">Использовать введённый адрес</button>
      </section>
    </div>`;
  $('bookingMapHost').prepend(mapElement, mapMessage);

  // Move the existing nodes, retaining Firebase references, validators and submit handlers.
  for (const key of new Set(BOOKING_SERVICES.map(service => service.form))) {
    const form = $(`${key}Form`);
    const panel = document.createElement('div');
    panel.className = 'booking-panel';
    panel.dataset.form = key;
    panel.hidden = key !== 'taxi';
    panel.append(form);
    const orderCard = $(`${key}-online-order-panel`);
    if (orderCard) panel.append(orderCard);
    $('bookingPanels').append(panel);
    panels.set(key, panel);
    // Hide only common address fields, the old price/buttons, and duplicated controls.
    for (const child of Array.from(form.children)) {
      if (sourcePointFields.some(id => child.contains($(id))) || child.contains($(`${key}-online-order-button`)) || child.querySelector('button[type="submit"]')) child.classList.add('booking-source-hidden');
    }
    form.noValidate = true; // Visible common fields are validated before invoking the legacy form.
    form.addEventListener('submit', event => {
      if (!opened) return;
      if (preview) { event.preventDefault(); event.stopImmediatePropagation(); showError('Режим просмотра: заказ не отправляется.'); return; }
      if (!validate()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    for (const input of form.querySelectorAll('[required]')) {
      if (input.closest('.booking-source-hidden')) input.required = false;
    }
    const phone = $(`${key}CustomerPhone`);
    if (phone) {
      const contact = Array.from(form.children).find(child => child.contains(phone));
      contact?.classList.add('booking-contact');
    }
  }
  $('taxiWishes').closest('section').classList.add('booking-source-hidden');
  Array.from($('deliveryForm').children).find(child => child.contains($('deliveryStore')))?.classList.add('booking-source-hidden');
  const preorderSection = Array.from($('taxiForm').children).find(child => child.contains($('taxiDateTime')));
  preorderSection.querySelector('button').hidden = true;
  $('preorderContent').classList.remove('hidden');
  const passengerSection = Array.from($('taxiForm').children).find(child => child.contains($('passengerPhone')));
  // Keep ordering for somebody else as an optional details section.
  passengerSection.querySelector('button').textContent = 'Заказать другому человеку';
  const initialCityOptions = Array.from($('taxiCitySelect').options).map(option => option.value || 'Белоусовка');
  for (const city of new Set(initialCityOptions)) { const option = document.createElement('option'); option.value = city; $('bookingCityList').append(option); }

  for (const service of BOOKING_SERVICES) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'booking-service'; button.dataset.bookingService = service.id;
    button.setAttribute('aria-pressed', String(service.id === state.service.id));
    button.innerHTML = `<i class="fas fa-${service.icon}" aria-hidden="true"></i><span>${service.label}</span>`;
    button.addEventListener('click', () => selectService(service.id));
    $('bookingServices').append(button);
  }

  const pointKey = (address, city) => `${normalizeCity(city || 'Белоусовка')}|${address.trim()}`.toLowerCase();
  const currentPoint = target => target === 'from' ? state.from : target === 'to' ? state.to : state.stops[Number(target)];
  const setValue = (id, value) => { if ($(id)) $(id).value = value; };
  function setCity(id, city) {
    const select = $(id); if (!select) return;
    const normalized = normalizeCity(city);
    const value = normalized === 'Белоусовка' ? '' : normalized;
    if (!Array.from(select.options).some(option => option.value === value)) select.add(new Option(normalized, value));
    select.value = value;
  }
  function remember(point, address = point.address) {
    if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) pointCache.set(pointKey(address, point.city), { lat: point.lat, lon: point.lon });
  }
  function syncStops(containerId, taxi) {
    const container = $(containerId); container.replaceChildren();
    state.stops.forEach(point => {
      const row = document.createElement('div'); row.className = 'additional-stop-item';
      const input = document.createElement('input'); input.value = taxi ? point.address : addressWithCity(point); input.dataset.taxiStopAddress = '';
      row.append(input);
      if (taxi) { const select = document.createElement('select'); select.dataset.taxiStopCity = ''; select.add(new Option(point.city, point.city === 'Белоусовка' ? '' : point.city)); row.append(select); }
      container.append(row);
      remember(point);
    });
  }
  function sync() {
    if (state.service.id !== 'preorder') $('taxiDateTime').value = '';
    const { house, entrance } = parseHouseDetails(state.details);
    setValue('taxiFrom', state.from.address); setValue('taxiTo', state.to.address);
    setValue('taxiHouse', house); setValue('taxiApt', entrance);
    setCity('taxiFromCitySelect', state.from.city); setCity('taxiCitySelect', state.to.city);
    setValue('taxiWishes', serviceWishes(state.note, state.service));
    remember(state.from); remember(state.to);
    syncStops('additionalStops', true); syncStops('additionalStopsAuction', false);
    for (const key of ['auction', 'cargo', 'soberDriver']) {
      setValue(`${key}From`, addressWithCity(state.from)); setValue(`${key}To`, addressWithCity(state.to));
      setValue(`${key}House`, house); setValue(`${key}Apt`, entrance);
    }
    setValue('assistanceAddress', addressWithCity(state.from)); setValue('assistanceHouse', house); setValue('assistanceApt', entrance);
    setValue('deliveryAddress', state.to.address); setCity('deliveryCitySelect', state.to.city);
    setValue('deliveryHouse', ''); setValue('deliveryApt', '');
    if (state.from.address) setValue('deliveryStore', addressWithCity(state.from, state.details));
    $('bookingFromValue').textContent = state.from.address || 'Укажите место подачи';
    $('bookingFromLabel').textContent = state.service.form === 'delivery' ? 'Откуда забрать' : state.service.form === 'assistance' ? 'Где нужна помощь' : 'Откуда';
    $('bookingToValue').textContent = state.to.address ? addressWithCity(state.to) : 'Укажите адрес назначения';
    $('bookingCity').querySelector('span').textContent = state.from.city || 'Выберите населённый пункт';
    $('bookingDetails').value = state.details;
    $('bookingNote').value = state.note;
    const singleAddress = state.service.form === 'assistance';
    $('bookingToRow').hidden = singleAddress;
    $('bookingSwap').hidden = singleAddress;
    $('bookingAddStop').hidden = singleAddress;
    $('bookingAddStop').disabled = state.stops.length >= 3;
    $('bookingStops').hidden = singleAddress;
    renderStops();
    window.updateTaxiPrice?.(); window.updateDeliveryPrice?.(); window.updateCargoPrice?.();
    refresh();
  }
  function renderStops() {
    $('bookingStops').replaceChildren();
    state.stops.forEach((point, index) => {
      const row = document.createElement('div'); row.className = 'booking-address';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'booking-address-button';
      const mark = document.createElement('span'); mark.className = 'booking-marker'; mark.textContent = String(index + 1);
      const copy = document.createElement('span'); copy.className = 'booking-address-copy';
      const label = document.createElement('small'); label.textContent = `Остановка ${index + 1}`;
      const text = document.createElement('strong'); text.textContent = addressWithCity(point) || 'Укажите промежуточный адрес';
      copy.append(label, text); button.append(mark, copy); button.onclick = () => openPicker(index);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'booking-icon-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Удалить остановку ${index + 1}`);
      remove.onclick = () => { state.stops.splice(index, 1); changed(); };
      row.append(button, remove); $('bookingStops').append(row);
    });
  }
  function changed() { state.revision++; sync(); void drawRoute(); }

  function selectService(id) {
    state.service = BOOKING_SERVICES.find(service => service.id === id) || BOOKING_SERVICES[0];
    if (!state.service.online) state.channel = 'whatsapp';
    for (const [key, panel] of panels) panel.hidden = key !== state.service.form;
    for (const button of $('bookingServices').children) button.setAttribute('aria-pressed', String(button.dataset.bookingService === state.service.id));
    const scheduled = id === 'preorder';
    preorderSection.hidden = !scheduled;
    $('taxiDateTime').required = scheduled;
    $('taxiDateTime').disabled = !scheduled;
    if (!scheduled) {
      if ($('taxiDateTime').value) $('taxiDateTime').dataset.draft = $('taxiDateTime').value;
      $('taxiDateTime').value = '';
    } else {
      $('taxiDateTime').value = $('taxiDateTime').dataset.draft || '';
      const local = new Date(Date.now() + 60000); local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
      $('taxiDateTime').min = local.toISOString().slice(0, 16);
    }
    $('bookingServiceHelp').textContent = state.service.wish ? 'Пожелание увидят водитель и диспетчер. Подходящий автомобиль подтвердят при принятии заказа.' : id === 'intercity' ? 'Укажите населённый пункт назначения в поле «Куда».' : id === 'delivery' ? '«Откуда» — магазин или место получения, «Куда» — адрес доставки. Перечислите товары ниже.' : !state.service.online ? 'Эта услуга оформляется через WhatsApp.' : '';
    changed();
  }
  function activeCard() {
    const card = $(`${state.service.form}-online-order-panel`);
    return card && !card.classList.contains('hidden');
  }
  function refresh() {
    const service = state.service;
    const hasCard = activeCard();
    $('bookingCommon').hidden = hasCard;
    $('bookingFooter').hidden = hasCard;
    const contact = panels.get(service.form).querySelector('.booking-contact');
    if (contact) contact.hidden = state.channel !== 'online';
    $('bookingOnline').hidden = !service.online;
    $('bookingOnline').setAttribute('aria-pressed', String(state.channel === 'online'));
    $('bookingWhatsapp').setAttribute('aria-pressed', String(state.channel === 'whatsapp'));
    const onlineButton = $(`${service.form}-online-order-button`);
    const busy = submitting || (state.channel === 'online' && onlineButton?.disabled);
    $('bookingCommon').inert = Boolean(busy);
    $('bookingPanels').inert = Boolean(busy && !hasCard);
    $('bookingSubmit').disabled = busy || (state.channel === 'online' && (!onlineButton || onlineButton.classList.contains('hidden')));
    $('bookingSubmit').textContent = submitting ? 'Оформляем…' : state.channel === 'online' ? 'Заказать онлайн' : 'Заказать через WhatsApp';
    const full = state.from.address && (service.form === 'assistance' || state.to.address);
    let price = service.form === 'taxi' ? $('taxiPriceEstimate').textContent : service.form === 'delivery' ? $('deliveryPriceEstimate').textContent : service.form === 'cargo' ? $('cargoTotalPrice').textContent : service.form === 'auction' ? ($('auctionPrice').value ? `${$('auctionPrice').value} ₸` : 'Ваша цена') : service.form === 'assistance' ? 'от 1500 тг' : 'от 3800 тг';
    $('bookingPrice').textContent = full ? price : 'Укажите адрес';
    $('bookingPriceCaption').textContent = service.form === 'cargo' ? 'Стоимость за 1 час' : service.form === 'auction' ? 'Предложение водителю' : 'Примерная стоимость';
  }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; refresh(); });
  }
  const observer = new MutationObserver(queueRefresh);
  for (const id of ['taxiPriceEstimate', 'deliveryPriceEstimate', 'cargoTotalPrice']) observer.observe($(id), { childList: true, subtree: true, characterData: true });
  for (const key of ['taxi', 'delivery']) {
    observer.observe($(`${key}-online-order-panel`), { attributes: true, attributeFilter: ['class'] });
    observer.observe($(`${key}-online-order-button`), { attributes: true, attributeFilter: ['disabled', 'class'] });
  }

  function showError(message, focus) { $('bookingStatus').textContent = message; focus?.focus(); return false; }
  function validate() {
    $('bookingStatus').textContent = '';
    if (!state.from.address || !state.from.city) { openPicker('from'); return showError('Укажите адрес и населённый пункт отправления.'); }
    if (state.service.form !== 'assistance' && (!state.to.address || !state.to.city)) { openPicker('to'); return showError('Укажите адрес и населённый пункт назначения.'); }
    const missing = state.stops.findIndex(point => !point.address || !point.city);
    if (state.service.form !== 'assistance' && missing >= 0) { openPicker(missing); return showError('Заполните остановку или удалите её.'); }
    if (state.service.id === 'preorder' && (!Number.isFinite(new Date($('taxiDateTime').value).getTime()) || new Date($('taxiDateTime').value) <= new Date())) return showError('Выберите будущую дату и время поездки.', $('taxiDateTime'));
    const form = $(`${state.service.form}Form`);
    if (state.channel === 'online') {
      if (addressWithCity(state.from, state.details).length > 230 || addressWithCity(state.to).length > 230) return showError('Сократите адрес до 230 символов. Дополнительные указания можно написать в примечании.');
      if (state.service.form === 'delivery' && $('deliveryStore').value.length > 160) return showError('Сократите место получения до 160 символов.');
      if (state.service.form === 'delivery' && $('deliveryItems').value.length > 700) return showError('Сократите список товаров до 700 символов.', $('deliveryItems'));
    }
    const invalid = Array.from(form.elements).find(input => !input.disabled && !input.closest('.booking-source-hidden') && !input.closest('[hidden]') && typeof input.checkValidity === 'function' && !input.checkValidity());
    if (invalid) { invalid.reportValidity(); return false; }
    return true;
  }
  async function submit() {
    if (submitting || !validate()) return;
    if (preview) { showError('Режим просмотра: адреса и услуга выбраны. Заказ не отправляется.'); return; }
    sync();
    // Add common notes and stops to services whose legacy forms have no wishes field.
    const extra = [state.note && `Примечание: ${state.note}`, ...state.stops.map((p, i) => `Остановка ${i + 1}: ${addressWithCity(p)}`)].filter(Boolean).join('\n');
    const key = state.service.form;
    const temporarilyChanged = [];
    const append = (id, suffix) => { const input = $(id); temporarilyChanged.push([input, input.value]); input.value = [input.value, suffix].filter(Boolean).join('\n'); };
    if (key === 'delivery' && extra && state.channel === 'whatsapp') append('deliveryItems', extra);
    if (key === 'cargo' && extra) append('cargoDescription', extra);
    if (key === 'assistance' && state.note) append('assistanceTask', state.note);
    if (key === 'soberDriver' && extra) append('soberDriverTo', extra);
    if (key === 'auction' && state.note) append('auctionTo', `Примечание: ${state.note}`);
    submitting = true; refresh();
    if (state.channel === 'online') $(`${key}-online-order-button`).click();
    else $(`${key}Form`).requestSubmit();
    // Legacy handlers snapshot fields synchronously before any network awaits.
    for (const [input, value] of temporarilyChanged) input.value = value;
    setTimeout(() => { submitting = false; refresh(); }, 1000);
  }

  function openPicker(target) {
    pickerTarget = target; pickerRevision++; searchRevision++;
    const point = currentPoint(target); if (!point) return;
    $('bookingPickerTitle').textContent = target === 'from' ? 'Откуда' : target === 'to' ? 'Куда' : 'Остановка';
    $('bookingSearchCity').value = point.city || state.from.city;
    $('bookingSearchInput').value = point.address;
    $('bookingSearchResults').replaceChildren();
    $('bookingSearchStatus').textContent = 'Введите адрес и нажмите «Найти» или укажите его вручную.';
    $('bookingPicker').hidden = false;
    $('bookingSearchInput').focus();
  }
  function closePicker() {
    $('bookingPicker').hidden = true; searchRevision++; pickerRevision++;
    overlay.classList.remove('booking-picking');
    $('bookingPickConfirm').hidden = true;
    if (pickMarker && window.simMap) window.simMap.removeLayer(pickMarker);
    pickMarker = null; pickedPoint = null;
    const button = pickerTarget === 'to' ? $('bookingTo') : $('bookingFrom');
    button.focus(); window.simMap?.invalidateSize();
  }
  function applyPoint(point) {
    if (!point.address) return;
    if (pickerTarget === 'from') {
      state.from = point;
      // House is kept once, in the shared detail field for the origin.
      state.details = point.house ? point.house : '';
      if (point.house && point.street) state.from = { ...point, address: point.street };
      if (!state.to.address) state.to.city = point.city;
    } else if (pickerTarget === 'to') state.to = point;
    else state.stops[Number(pickerTarget)] = point;
    changed(); closePicker();
  }
  async function search() {
    const query = $('bookingSearchInput').value.trim();
    const city = normalizeCity($('bookingSearchCity').value);
    if (query.length < 2) { $('bookingSearchStatus').textContent = 'Введите хотя бы две буквы.'; return; }
    const revision = ++searchRevision;
    $('bookingSearchStatus').textContent = 'Ищем адрес…';
    $('bookingSearchResults').replaceChildren();
    try {
      const center = Number.isFinite(state.from.lat) ? state.from : undefined;
      // Include selected locality, but do not duplicate a city already written in the query.
      const text = city && !query.toLowerCase().includes(city.toLowerCase()) ? `${query}, ${city}, Казахстан` : `${query}, Казахстан`;
      let results = await geocoder.search(text, center);
      if (revision !== searchRevision || $('bookingPicker').hidden) return;
      if (!query.toLowerCase().includes(city.toLowerCase())) {
        const nearby = await geocoder.search(`${query}, Казахстан`, center);
        const seen = new Set(results.map(point => pointKey(point.address, point.city)));
        for (const point of nearby) if (!seen.has(pointKey(point.address, point.city))) { results.push(point); seen.add(pointKey(point.address, point.city)); }
      }
      if (revision !== searchRevision || $('bookingPicker').hidden) return;
      results = results.filter(p => !p.country || p.country.toUpperCase() === 'KZ').sort((a, b) => Number(b.city === city) - Number(a.city === city)).slice(0, 10);
      $('bookingSearchStatus').textContent = results.length ? 'Выберите адрес. Проверьте населённый пункт.' : 'Адрес не найден. Уточните название или используйте ручной ввод.';
      for (const point of results) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'booking-result';
        const icon = document.createElement('i'); icon.className = 'fas fa-map-marker-alt'; icon.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = point.address;
        const context = document.createElement('small'); context.textContent = [point.city || 'Уточните населённый пункт', point.context].filter(Boolean).join(' · ');
        copy.append(title, context); button.append(icon, copy);
        button.onclick = () => {
          if (!point.city) { $('bookingSearchStatus').textContent = 'Для этого места не указан населённый пункт. Введите его и подтвердите адрес вручную.'; $('bookingSearchInput').value = point.address; return; }
          applyPoint(point);
        };
        $('bookingSearchResults').append(button);
      }
    } catch { if (revision === searchRevision) $('bookingSearchStatus').textContent = 'Поиск временно недоступен. Можно ввести адрес вручную или выбрать точку на карте.'; }
  }
  function manualAddress() {
    const address = $('bookingSearchInput').value.trim(); const city = normalizeCity($('bookingSearchCity').value);
    if (!address || !city) { $('bookingSearchStatus').textContent = 'Укажите населённый пункт и адрес.'; return; }
    applyPoint({ address, city, lat: null, lon: null });
  }
  function pickOnMap() {
    if (!window.simMap) { $('bookingSearchStatus').textContent = 'Карта загружается. Пока можно ввести адрес вручную.'; return; }
    $('bookingPicker').hidden = true; overlay.classList.add('booking-picking');
    $('bookingPickConfirm').hidden = false;
    $('bookingPickConfirm').textContent = 'Выбрать эту точку';
    window.simMap.invalidateSize();
    const point = currentPoint(pickerTarget);
    if (Number.isFinite(point?.lat)) window.simMap.setView([point.lat, point.lon], 17);
    movePickMarker(); $('bookingPickConfirm').focus();
  }
  function movePickMarker() {
    if (!overlay.classList.contains('booking-picking') || !window.simMap || !window.L) return;
    const center = window.simMap.getCenter(); pickedPoint = { lat: center.lat, lon: center.lng };
    if (pickMarker) pickMarker.setLatLng(center);
    else pickMarker = window.L.marker(center, { icon: window.L.divIcon({ className: 'booking-pin', html: '+', iconSize: [36, 36] }), interactive: false }).addTo(window.simMap);
  }
  async function confirmMapPoint() {
    if (!pickedPoint) return;
    const revision = pickerRevision, target = pickerTarget, coordinates = { ...pickedPoint };
    $('bookingPickConfirm').textContent = 'Определяем адрес…';
    try {
      const results = await geocoder.reverse(coordinates.lat, coordinates.lon);
      if (revision !== pickerRevision || target !== pickerTarget || !opened) return;
      const point = results[0];
      if (!point?.city) throw new Error('No locality');
      applyPoint({ ...point, ...coordinates });
      $('bookingLocationStatus').textContent = 'Проверьте адрес выбранной точки и уточните дом.';
    } catch {
      if (revision !== pickerRevision || !opened) return;
      $('bookingPicker').hidden = false;
      $('bookingSearchStatus').textContent = 'Адрес точки не найден. Введите населённый пункт и адрес вручную.';
    } finally { $('bookingPickConfirm').textContent = 'Выбрать эту точку'; }
  }

  async function onLocation(position) {
    if (!opened || !locating || state.revision !== locationRevision) return;
    locating = false;
    const revision = state.revision;
    const { latitude: lat, longitude: lon, accuracy } = position.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (accuracy > 200) { $('bookingLocationStatus').textContent = 'Местоположение определено приблизительно. Уточните точку подачи на карте или введите адрес.'; return; }
    $('bookingLocationStatus').textContent = 'Определяем населённый пункт и улицу…';
    try {
      const results = await geocoder.reverse(lat, lon);
      if (!opened || revision !== state.revision) return;
      const point = results[0];
      if (!point?.city) throw new Error('No locality');
      if (point.isSettlement) {
        state.from = { ...emptyPoint(), city: point.city };
        if (!state.to.address) state.to.city = point.city;
        $('bookingLocationStatus').textContent = `Определён населённый пункт: ${point.city}. Укажите улицу и дом.`;
        changed(); return;
      }
      state.from = { ...point, lat, lon, address: point.street || point.address };
      state.details = point.house || '';
      if (!state.to.address) state.to.city = point.city;
      $('bookingLocationStatus').textContent = 'Адрес определён. Проверьте дом и уточните подъезд.';
      changed(); window.simMap?.setView([lat, lon], 16);
    } catch { if (revision === state.revision) $('bookingLocationStatus').textContent = 'Точка найдена, но адрес определить не удалось. Укажите улицу и населённый пункт вручную.'; }
  }
  function locationError() { locating = false; if (opened) $('bookingLocationStatus').textContent = 'Местоположение недоступно. Укажите адрес вручную или выберите точку на карте.'; }
  function locate() {
    if (!navigator.geolocation) { locationError(); return; }
    locating = true; locationRevision = state.revision;
    $('bookingLocationStatus').textContent = 'Определяем местоположение…';
    navigator.geolocation.getCurrentPosition(onLocation, locationError, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  }
  async function coordinates(address, city) {
    const key = pointKey(address, city); if (pointCache.has(key)) return pointCache.get(key);
    const result = await geocoder.search(`${address}, ${city || 'Белоусовка'}, Казахстан`).catch(() => []);
    // Do not silently route to a similarly named street in another settlement.
    const point = result.find(p => normalizeCity(p.city) === normalizeCity(city || 'Белоусовка'));
    if (!point) return null;
    const value = { lat: point.lat, lon: point.lon }; pointCache.set(key, value); return value;
  }
  async function getRoute(points) {
    const key = points.map(p => `${p.lon},${p.lat}`).join(';');
    if (routeCache.has(key)) return routeCache.get(key);
    const promise = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson`, { signal: controller.signal });
        if (!response.ok) return null;
        const data = await response.json(); return data.code === 'Ok' ? data.routes?.[0] || null : null;
      } catch { return null; } finally { clearTimeout(timer); }
    })();
    routeCache.set(key, promise);
    const route = await promise; if (!route) routeCache.delete(key);
    if (routeCache.size > 30) routeCache.delete(routeCache.keys().next().value);
    return route;
  }
  function clearRoute() {
    if (routeLayer && window.simMap) window.simMap.removeLayer(routeLayer);
    routeLayer = null;
    routeMarkers.forEach(marker => window.simMap?.removeLayer(marker)); routeMarkers = [];
  }
  async function drawRoute() {
    const revision = ++routeRevision;
    clearRoute();
    if (!opened || !window.simMap || !window.L || state.service.form === 'assistance') return;
    const points = [state.from, ...state.stops, state.to];
    if (points.some(point => !point.address || !point.city)) return;
    const coords = await Promise.all(points.map(point => coordinates(point.address, point.city)));
    if (revision !== routeRevision || !opened || coords.some(point => !point)) return;
    const route = await getRoute(coords);
    if (revision !== routeRevision || !opened) return;
    const L = window.L;
    coords.forEach((point, i) => {
      const label = i === 0 ? 'А' : i === coords.length - 1 ? 'Б' : String(i);
      routeMarkers.push(L.marker([point.lat, point.lon], { icon: L.divIcon({ className: 'booking-pin', html: label, iconSize: [32, 32] }) }).addTo(window.simMap));
    });
    if (route?.geometry) {
      routeLayer = L.geoJSON(route.geometry, { style: { color: '#1d4ed8', weight: 6, opacity: .85 } }).addTo(window.simMap);
      if (!overlay.classList.contains('booking-picking')) window.simMap.fitBounds(routeLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
    }
  }
  function open(id = state.service.id) {
    const currentOrder = ['taxi', 'delivery'].find(key => !$(`${key}-online-order-panel`).classList.contains('hidden'));
    if (currentOrder) id = currentOrder;
    if (!opened) {
      returnFocus = document.activeElement; opened = true;
      overlay.classList.add('active'); overlay.setAttribute('aria-hidden', 'false'); document.body.classList.add('booking-open');
      selectService(id);
      if (!initialLocationRequested && !state.from.address) { initialLocationRequested = true; locating = true; locationRevision = state.revision; }
      setTimeout(() => {
        if (!opened) return;
        void window.initSimulationMap().then(() => {
          if (!opened) return;
          window.simMap?.off('move', movePickMarker); window.simMap?.on('move', movePickMarker);
          window.simMap?.invalidateSize(); void drawRoute();
        }).catch(() => { mapMessage.textContent = 'Карта временно недоступна. Адрес можно ввести вручную.'; });
      }, 150);
    } else selectService(id);
    $('bookingClose').focus();
  }
  function close() {
    if (preview) return;
    opened = false; locating = false; state.revision++; searchRevision++; pickerRevision++; routeRevision++;
    clearRoute(); closePicker();
    originalClose('mapModal'); document.body.classList.remove('booking-open');
    returnFocus?.focus();
  }
  window.openModal = id => {
    const service = BOOKING_SERVICES.find(item => `${item.form}Modal` === id);
    if (service) { open(service.id); return; }
    if (id === 'mapModal') { open(); return; }
    originalOpen(id);
  };
  window.closeModal = id => {
    if (id === 'mapModal' || (opened && BOOKING_SERVICES.some(item => `${item.form}Modal` === id))) { close(); return; }
    originalClose(id);
  };
  window.openMapModal = () => open();
  window.bookingScreen = {
    onLocation, locationError, coordinates,
    getRouteDistance: async points => (await getRoute(points))?.distance ?? null,
    isOpen: () => opened, isPreview: () => preview,
    deliveryData: () => opened && state.service.form === 'delivery' ? { stops: state.stops.map(p => addressWithCity(p)), wishes: state.note } : null
  };
  window.repeatOrder = (from, to) => {
    const readPoint = value => {
      const match = value.match(/\s*\(([^()]+)\)\s*$/u);
      return { ...emptyPoint(), address: match ? value.slice(0, match.index) : value, city: match ? normalizeCity(match[1]) : 'Белоусовка' };
    };
    state.from = readPoint(from); state.to = readPoint(to); state.details = ''; state.stops = [];
    originalClose('historyModal'); open('taxi'); changed();
  };

  $('bookingClose').onclick = close;
  $('bookingHistory').onclick = () => { close(); originalOpen('historyModal'); window.renderOrderHistory?.(); };
  $('bookingLocate').onclick = locate;
  $('bookingFrom').onclick = () => openPicker('from'); $('bookingCity').onclick = () => { openPicker('from'); $('bookingSearchCity').focus(); };
  $('bookingTo').onclick = () => openPicker('to');
  $('bookingDetails').oninput = event => { state.details = event.target.value; state.revision++; sync(); };
  $('bookingNote').oninput = event => { state.note = event.target.value; state.revision++; sync(); };
  $('bookingAddStop').onclick = () => { if (state.stops.length >= 3) return; state.stops.push({ ...emptyPoint(), city: state.from.city }); changed(); openPicker(state.stops.length - 1); };
  $('bookingSwap').onclick = () => { const formerFrom = { ...state.from, address: [state.from.address, state.details].filter(Boolean).join(', ') }; state.from = state.to; state.to = formerFrom; state.details = ''; changed(); };
  $('bookingOnline').onclick = () => { state.channel = 'online'; refresh(); };
  $('bookingWhatsapp').onclick = () => { state.channel = 'whatsapp'; refresh(); };
  $('bookingSubmit').onclick = submit;
  $('auctionPrice').addEventListener('input', refresh);
  $('bookingPickerBack').onclick = closePicker;
  $('bookingSearchButton').onclick = search;
  $('bookingSearchInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } });
  for (const id of ['bookingSearchInput', 'bookingSearchCity']) $(id).addEventListener('input', () => { searchRevision++; $('bookingSearchResults').replaceChildren(); });
  $('bookingManualAddress').onclick = manualAddress;
  $('bookingOnMap').onclick = pickOnMap;
  $('bookingPickConfirm').onclick = confirmMapPoint;
  for (const [id, direction] of [['bookingServicesPrev', -1], ['bookingServicesNext', 1]]) $(id).onclick = () => $('bookingServices').scrollBy({ left: direction * 220, behavior: 'smooth' });
  let dragStart = null;
  function expand(value) { overlay.classList.toggle('booking-expanded', value); $('bookingGrip').setAttribute('aria-expanded', String(value)); window.simMap?.invalidateSize(); }
  $('bookingGrip').onclick = () => expand(!overlay.classList.contains('booking-expanded'));
  $('bookingGrip').onpointerdown = event => { dragStart = event.clientY; $('bookingGrip').setPointerCapture(event.pointerId); };
  $('bookingGrip').onpointerup = event => { if (dragStart !== null && Math.abs(event.clientY - dragStart) > 20) { expand(event.clientY < dragStart); $('bookingGrip').onclick = null; setTimeout(() => { $('bookingGrip').onclick = () => expand(!overlay.classList.contains('booking-expanded')); }, 0); } dragStart = null; };
  document.addEventListener('keydown', event => {
    if (!opened || $('alertModal')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!$('bookingPicker').hidden || overlay.classList.contains('booking-picking')) closePicker(); else close(); }
    if (event.key === 'Tab') {
      const scope = $('bookingPicker').hidden ? overlay : $('bookingPicker');
      const focusable = Array.from(scope.querySelectorAll('button, input, textarea, select, a[href]')).filter(el => !el.disabled && el.offsetParent !== null);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  window.addEventListener('resize', () => { if (opened) window.simMap?.invalidateSize(); });
  // Do not auto-open: the home page remains available until the customer chooses to order.
  selectService('taxi');
  if (preview) {
    $('bookingClose').hidden = true;
    $('bookingHistory').hidden = true;
    $('bookingLocationStatus').textContent = 'Режим просмотра — без отправки заказов.';
    $('bookingPriceCaption').textContent = 'Режим просмотра';
    const label = document.createElement('p'); label.className = 'booking-help'; label.textContent = 'Режим просмотра — заказы не отправляются.';
    $('bookingFooter').prepend(label);
    open('taxi');
  }
}
