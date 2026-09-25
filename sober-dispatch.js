import { soberWorkAmount, soberFareForPrice } from './sober-fare.js?v=74';

export async function confirmSoberExpenses(db, sdk, { orderId, uid, pickupAmount, returnAmount }) {
  if (![pickupAmount, returnAmount].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Укажите целые суммы расходов от 0 ₸.');
  const { doc, runTransaction, serverTimestamp } = sdk;
  return runTransaction(db, async transaction => {
    const ref = doc(db, 'orders', orderId), snapshot = await transaction.get(ref), order = snapshot.data();
    if (!snapshot.exists() || order.serviceType !== 'soberDriver' || !order.soberFare
      || order.status !== 'searching' || order.assignedDriverUid) throw new Error('Заказ уже назначен или закрыт. Обновите карточку.');
    const soberFare = soberFareForPrice({ pickupAmount, returnAmount }, order.priceAmount);
    if (soberWorkAmount({ ...order, soberFare }) === null) throw new Error('Расходы должны быть меньше полной цены: оставьте оплату работы водителя. Согласуйте повышение цены с клиентом, если суммы недостаточно.');
    transaction.update(ref, { soberFare, soberFareUpdatedBy: uid, soberFareUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}

export function createSoberExpenseEditor(order, save) {
  const form = document.createElement('form'); form.className = 'mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700';
  const title = document.createElement('p'); title.className = 'text-sm font-bold'; title.textContent = 'Расходы трезвого водителя'; form.append(title);
  const hint = document.createElement('p'); hint.className = 'text-xs'; hint.textContent = `Уточните стоимость двух поездок на такси. Цена клиента ${order.priceAmount.toLocaleString('ru-RU')} ₸ сохранится; остаток — оплата перегона.`; form.append(hint);
  const fields = {};
  for (const [key, caption] of [['pickupAmount', 'Подача из Белоусовки, ₸'], ['returnAmount', 'Обратное такси в Белоусовку, ₸']]) {
    const label = document.createElement('label'); label.className = 'block mt-2 text-xs'; label.textContent = caption;
    const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.step = '1'; input.max = String(order.priceAmount - 1); input.required = true;
    input.value = order.soberFare[key] ?? ''; input.className = 'block w-full rounded-xl border border-slate-200 bg-white p-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
    label.append(input); form.append(label); fields[key] = input;
  }
  const button = document.createElement('button'); button.type = 'submit'; button.className = 'mt-3 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white'; button.textContent = 'Подтвердить расходы';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.className = 'mt-2 text-xs'; form.append(button, status);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (button.disabled || !form.reportValidity()) return;
    button.disabled = true; status.textContent = 'Сохраняем…';
    try { await save({ pickupAmount: Number(fields.pickupAmount.value), returnAmount: Number(fields.returnAmount.value) }); status.textContent = 'Расходы подтверждены. Заказ доступен для приёма.'; }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  return form;
}
