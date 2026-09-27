import { VEHICLE_CATEGORIES, driverCategories, driverPassengerSeats } from './vehicle-categories.js?v=78';
let controlNumber = 0;
export function createVehicleControls(driver = {}) {
  const id = `vehicle-profile-${++controlNumber}`;
  const fieldset = document.createElement('fieldset'); fieldset.className = 'vehicle-profile-controls';
  const legend = document.createElement('legend'); legend.textContent = 'Доступные заказы и пассажирские места'; fieldset.append(legend);
  const inputs = new Map();
  for (const [category, info] of Object.entries(VEHICLE_CATEGORIES)) {
    const label = document.createElement('label'); label.className = 'vehicle-category-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = category;
    input.checked = driverCategories(driver).includes(category); input.disabled = category === 'sedan';
    const text = document.createElement('span'); text.textContent = info.label;
    label.append(input, text); fieldset.append(label); inputs.set(category, input);
  }
  const seatLabel = document.createElement('label'); seatLabel.className = 'vehicle-seat-label'; seatLabel.htmlFor = `${id}-seats`;
  seatLabel.textContent = 'Пассажирских мест без водителя';
  const seats = document.createElement('input'); seats.id = `${id}-seats`; seats.type = 'number'; seats.inputMode = 'numeric'; seats.step = '1'; seats.max = '8'; seats.required = true;
  seats.value = driverPassengerSeats(driver) || '';
  const hint = document.createElement('small'); hint.textContent = 'Укажите фактическое число мест. Для минивэна — от 5 до 8.';
  const sync = () => { seats.min = inputs.get('minivan').checked ? '5' : '1'; };
  inputs.get('minivan').addEventListener('change', sync); sync();
  seatLabel.append(seats, hint); fieldset.append(seatLabel);
  const soberLabel = document.createElement('label'); soberLabel.className = 'vehicle-category-choice';
  const sober = document.createElement('input'); sober.type = 'checkbox'; sober.checked = driver.soberDriverEnabled === true;
  soberLabel.append(sober, document.createTextNode('Трезвый водитель — допуск к перегону автомобиля клиента')); fieldset.append(soberLabel);
  const assistanceLabel = document.createElement('label'); assistanceLabel.className = 'vehicle-category-choice';
  const assistance = document.createElement('input'); assistance.type = 'checkbox'; assistance.checked = driver.assistanceEnabled === true;
  assistanceLabel.append(assistance, document.createTextNode('Помощь на дороге — получать заявки на помощь')); fieldset.append(assistanceLabel);
  const carpoolLabel = document.createElement('label'); carpoolLabel.className = 'vehicle-category-choice';
  const carpool = document.createElement('input'); carpool.type = 'checkbox'; carpool.checked = driver.carpoolEnabled === true;
  carpoolLabel.append(carpool, document.createTextNode('Попутки — разрешить публикацию рейсов')); fieldset.append(carpoolLabel);
  const carpoolRateLabel = document.createElement('label'); carpoolRateLabel.textContent = 'Комиссия за попутки, % (пусто — как у такси)';
  const carpoolRate = document.createElement('input'); carpoolRate.type = 'number'; carpoolRate.min = '0'; carpoolRate.max = '100'; carpoolRate.step = '1'; carpoolRate.value = driver.carpoolCommissionRate ?? '';
  carpoolRateLabel.append(carpoolRate); fieldset.append(carpoolRateLabel);
  return { element: fieldset, read: () => ({ carpoolEnabled: carpool.checked, carpoolCommissionRate: carpoolRate.value === '' ? null : Number(carpoolRate.value), assistanceEnabled: assistance.checked, soberDriverEnabled: sober.checked, serviceCategories: [...inputs].filter(([, input]) => input.checked).map(([category]) => category), passengerSeats: Number(seats.value) }), reset: () => { carpool.checked = false; carpoolRate.value = ''; assistance.checked = false; sober.checked = false; inputs.get('wagon').checked = false; inputs.get('minivan').checked = false; seats.value = '4'; sync(); } };
}
