import { priceSettings, DEFAULT_CUSTOMER_PRICING } from './customer-pricing.js?v=67';
export function initCustomerPricingSettings({ db, doc, getDoc, setDoc, serverTimestamp, uid }) {
  const form = document.getElementById('customer-pricing-settings');
  if (!form) return;
  const status = form.querySelector('[role=status]');
  const ref = doc(db, 'settings', 'customerPricing');
  function show(config) {
    form.elements.enabled.checked = config.enabled;
    form.elements.quickPercentages.value = config.quickPercentages.join(', ');
    for (const key of ['minimumIncrease','maximumPrice','taxiMinimum','deliveryMinimum']) form.elements[key].value = config[key];
  }
  show(DEFAULT_CUSTOMER_PRICING);
  getDoc(ref).then(snap => show(priceSettings(snap.exists() ? snap.data() : {}))).catch(() => { status.textContent = 'Настройки не загружены. Проверьте соединение.'; });
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const config = priceSettings({ enabled: form.elements.enabled.checked,
        quickPercentages: form.elements.quickPercentages.value.trim() ? form.elements.quickPercentages.value.split(',').map(s => Number(s.trim())) : [],
        ...Object.fromEntries(['minimumIncrease','maximumPrice','taxiMinimum','deliveryMinimum'].map(key => [key, Number(form.elements[key].value)])) });
      await setDoc(ref, { ...config, updatedAt: serverTimestamp(), updatedBy: uid });
      status.textContent = 'Настройки сохранены.';
    } catch(e) { status.textContent = e.message || 'Не удалось сохранить настройки.'; }
    finally { button.disabled = false; }
  };
}
