import { financeSettings, validFinanceSettings, DEFAULT_FINANCE } from './driver-finance.js?v=53';
export function createFinanceControls(driver = DEFAULT_FINANCE) {
    const element = document.createElement('fieldset'); element.className = 'vehicle-profile-controls';
    const legend = document.createElement('legend'); legend.textContent = 'Комиссия и лимит долга'; element.append(legend);
    const field = (title, control) => { const label = document.createElement('label'); label.className = 'vehicle-seat-label'; label.append(document.createTextNode(title), control); element.append(label); return label; };
    const rate = document.createElement('input'); rate.type = 'number'; rate.min = '0'; rate.max = '100'; rate.step = '1'; rate.required = true; rate.inputMode = 'numeric'; field('Комиссия, %', rate);
    const mode = document.createElement('select');
    for (const [value, text] of [['none', 'Долг запрещён'], ['limited', 'Установить лимит долга'], ['unlimited', 'Без лимита долга']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; mode.append(option); }
    field('Работа с долгом', mode);
    const limit = document.createElement('input'); limit.type = 'number'; limit.min = '1'; limit.max = '10000000'; limit.step = '1'; limit.inputMode = 'numeric'; limit.required = true;
    const limitLabel = field('Максимальный долг, ₸', limit);
    const hint = document.createElement('p'); hint.textContent = 'Новый процент действует для следующих принятых заказов. Уже начатая поездка завершится на сохранённых условиях.'; element.append(hint);
    const sync = () => { limitLabel.hidden = mode.value !== 'limited'; limit.disabled = limitLabel.hidden; };
    mode.addEventListener('change', sync);
    const reset = () => { const settings = financeSettings(driver); rate.value = settings.commissionRate; mode.value = settings.debtMode; limit.value = settings.debtLimit || 1000; sync(); };
    reset();
    return { element, reset, read() { const settings = { commissionRate: Number(rate.value), debtMode: mode.value, debtLimit: mode.value === 'limited' ? Number(limit.value) : 0 }; if (!rate.value || !validFinanceSettings(settings)) throw new Error('Укажите целый процент от 0 до 100 и корректный лимит долга.'); return settings; } };
}
