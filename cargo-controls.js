import { cargoAmount, cargoMeters, cargoTimestamp, CARGO_HOUR_MS } from './cargo-fare.js?v=77';

export function createCargoWorkControls(order, run, dispatcher = false) {
  const box = document.createElement('div'); box.className = 'cargo-work';
  const text = (tag, content) => { const el = document.createElement(tag); el.textContent = content; box.append(el); return el; };
  if (order.cargoStartedAt) {
    const time = ms => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    text('p', `Работа начата в ${time(cargoTimestamp(order.cargoStartedAt))}. Первый час включён до ${time(cargoTimestamp(order.cargoStartedAt) + CARGO_HOUR_MS)}.`);
  }
  if (order.cargoConfirmedAt) { text('p', 'Итоговая стоимость подтверждена. Можно завершить заказ.'); return box; }
  let action = null;
  if (!dispatcher && order.status === 'arrived') action = 'start';
  if (!dispatcher && order.status === 'in_trip' && !order.cargoFinishedAt) action = 'report';
  if (dispatcher && order.status === 'in_trip' && order.cargoFinishedAt) action = 'confirm';
  if (!action) {
    if (order.cargoFinishedAt) text('p', 'Пробег отправлен. Ожидаем подтверждения диспетчера.');
    return box;
  }
  const form = document.createElement('form'); box.append(form);
  let input;
  if (action !== 'start') {
    const label = document.createElement('label'); label.textContent = 'Километры только после первого часа';
    input = document.createElement('input'); input.type = 'text'; input.inputMode = 'decimal'; input.required = true; input.maxLength = 7;
    input.placeholder = 'Например: 5,2 или 0'; input.value = dispatcher ? String(order.cargoReportedMeters / 1000) : '';
    label.append(input); form.append(label);
    const hint = document.createElement('p'); hint.textContent = dispatcher
      ? `Водитель указал ${(order.cargoReportedMeters / 1000).toLocaleString('ru-RU')} км. Проверьте пробег; при необходимости исправьте. Первые 60 минут в доплату не входят.`
      : 'Укажите фактическое расстояние после 60-й минуты с точностью до 0,1 км. Если уложились в час или после часа не ехали — 0. Отправляйте после окончания работы.';
    form.append(hint);
  } else text('p', 'Нажмите у клиента в момент начала работы, включая погрузку. С этого момента начинается оплаченный час.');
  const preview = document.createElement('p'); preview.setAttribute('aria-live', 'polite');
  const button = document.createElement('button'); button.type = 'submit';
  button.textContent = action === 'start' ? 'Начать работу · 1 час включён' : action === 'report' ? 'Отправить пробег диспетчеру' : 'Подтвердить пробег и стоимость';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  form.append(preview, button, status);
  const updatePreview = () => { try { preview.textContent = `Итого${dispatcher ? '' : ' после подтверждения'}: ${cargoAmount(order.cargoFare, cargoMeters(input.value)).toLocaleString('ru-RU')} ₸`; } catch { preview.textContent = ''; } };
  input?.addEventListener('input', updatePreview); if (input) updatePreview();
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (button.disabled || !form.reportValidity()) return;
    button.disabled = true; status.textContent = 'Сохраняем…';
    try { await run({ action, ...(input ? { meters: cargoMeters(input.value) } : {}), expectedReportedMeters: order.cargoReportedMeters }); status.textContent = 'Сохранено.'; }
    catch (error) { status.textContent = error.code === 'permission-denied' ? 'Действие недоступно. Обновите карточку; если ошибка повторится, сообщите диспетчеру.' : error.message; button.disabled = false; }
  });
  return box;
}
