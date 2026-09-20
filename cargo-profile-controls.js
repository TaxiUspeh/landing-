import { validCargoProfile } from './functions/driver-services.mjs?v=69';

export function createCargoControls(profile = {}) {
  const element = document.createElement('fieldset'); element.className = 'vehicle-profile-wide grid grid-cols-1 sm:grid-cols-2 gap-3';
  const legend = document.createElement('legend'); legend.textContent = 'Грузовой автомобиль'; element.append(legend);
  const controls = {};
  for (const [key, title, type] of [['plate', 'Госномер', 'text'], ['bodyType', 'Тип кузова', 'text'],
    ['payloadKg', 'Грузоподъёмность, кг', 'number'], ['dimensions', 'Размеры кузова (Д × Ш × В), м', 'text']]) {
    const label = document.createElement('label'); label.className = 'text-xs font-semibold'; label.textContent = title;
    const input = document.createElement('input'); input.type = type; input.className = 'form-control mt-1'; input.value = profile[key] ?? '';
    input.dataset.cargoField = key; input.maxLength = 120;
    if (type === 'number') { input.min = '1'; input.max = '100000'; input.step = '1'; }
    label.append(input); element.append(label); controls[key] = input;
  }
  return { element, reset() { for (const input of Object.values(controls)) input.value = ''; },
    read(base) {
      const profile = { ...base, ...Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, key === 'payloadKg' ? Number(input.value) : input.value.trim()])) };
      if (!validCargoProfile(profile)) throw new Error('Укажите грузовой автомобиль, грузоподъёмность от 1 до 100 000 кг и комиссию от 0 до 100%.');
      return profile;
    }
  };
}
