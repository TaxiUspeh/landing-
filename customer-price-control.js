import { minimumOffer, validOffer, priceLabel } from './customer-pricing.js?v=67';
export function createPriceControl({ host, id, onChange = () => {}, onConfirm = null }) {
  host.classList.add('customer-price-control');
  host.innerHTML = `<button type="button" class="customer-price-toggle" aria-expanded="false" aria-controls="${id}-editor">Предложить свою цену</button>
    <div id="${id}-editor" class="customer-price-editor" hidden><p class="customer-price-base"></p>
      <p>Хотите сделать заказ привлекательнее для водителей? Вы можете предложить свою цену.</p>
      <div class="customer-price-quick" role="group" aria-label="Увеличить цену"></div>
      <label for="${id}-amount">Ваша цена, ₸</label><input id="${id}-amount" type="number" inputmode="numeric" step="1" autocomplete="off">
      <p class="customer-price-error" role="status"></p><button type="button" class="customer-price-confirm" hidden></button>
      <button type="button" class="customer-price-reset">Оставить расчётную цену</button></div>`;
  const toggle = host.querySelector('.customer-price-toggle'), editor = host.querySelector('.customer-price-editor');
  const input = host.querySelector('input'), error = host.querySelector('.customer-price-error'), confirm = host.querySelector('.customer-price-confirm');
  const quick = host.querySelector('.customer-price-quick'), reset = host.querySelector('.customer-price-reset');
  let context = null, expanded = false, busy = false, lastKey = '';
  function value() { return expanded && input.value !== '' ? Number(input.value) : null; }
  function refresh() {
    if (!context) return;
    const { calculated, current, service, config } = context;
    const minimum = minimumOffer(service, calculated, config, current);
    const amount = value();
    input.min = minimum; input.max = config.maximumPrice;
    error.textContent = amount !== null && !validOffer(amount, minimum, config) ? `Введите целую сумму от ${priceLabel(minimum)} до ${priceLabel(config.maximumPrice)}.` : '';
    confirm.hidden = !onConfirm; confirm.disabled = busy || amount === null || !!error.textContent;
    confirm.textContent = !onConfirm ? '' : busy ? 'Сохраняем…' : amount === null ? 'Укажите новую цену' : `Изменить цену с ${priceLabel(current)} на ${priceLabel(amount)}`;
    input.disabled = busy; toggle.disabled = busy; reset.disabled = busy;
    quick.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  toggle.onclick = () => { expanded = !expanded; editor.hidden = !expanded; toggle.setAttribute('aria-expanded', String(expanded)); refresh(); if (expanded) input.focus(); onChange(); };
  reset.onclick = () => { expanded = false; editor.hidden = true; input.value = ''; toggle.setAttribute('aria-expanded', 'false'); refresh(); onChange(); };
  input.oninput = () => { refresh(); onChange(); };
  confirm.onclick = async () => { if (confirm.disabled) return; const amount = value(); busy = true; refresh(); let failure = ''; try { await onConfirm(amount); expanded = false; input.value = ''; editor.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } catch (e) { failure = e.message; } finally { busy = false; refresh(); if (failure) { error.textContent = failure; confirm.textContent = 'Повторить изменение цены'; } } };
  return { value, active: () => expanded, valid: () => !!context && context.visible && value() !== null && validOffer(value(), minimumOffer(context.service, context.calculated, context.config, context.current), context.config),
    update(next) {
      context = { current: null, ...next }; host.hidden = !next.visible;
      const key = JSON.stringify([next.key, next.calculated, context.current, next.config]);
      if (key !== lastKey) {
        lastKey = key; input.value = ''; expanded = false; editor.hidden = true; toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = onConfirm ? 'Повысить цену' : 'Предложить свою цену';
        host.querySelector('.customer-price-base').textContent = context.current !== null ? `Текущая цена: ${priceLabel(context.current)}` : next.calculated === null ? 'Автоматическая стоимость недоступна.' : `Расчётная цена: ${priceLabel(next.calculated)}`;
        reset.textContent = onConfirm || next.calculated === null ? 'Отмена' : 'Оставить расчётную цену';
        quick.replaceChildren();
        const base = context.current ?? next.calculated;
        if (base !== null) for (const p of next.config.quickPercentages) {
          const amount = Math.max(minimumOffer(next.service, next.calculated, next.config, context.current), Math.ceil(base * (100 + p) / 100));
          if (amount > next.config.maximumPrice) continue;
          const b = document.createElement('button'); b.type = 'button'; b.textContent = `+${p}%`; b.title = priceLabel(amount);
          b.onclick = () => { input.value = String(amount); refresh(); onChange(); }; quick.append(b);
        }
        refresh();
      }
    } };
}
