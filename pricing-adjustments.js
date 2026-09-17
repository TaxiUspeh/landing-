// One winning factor, with stable tie order. Counts are simulated, never live fleet data.
export function selectPriceAdjustment({ hour, modeledCars, weather, holiday }, multipliers) {
  const candidates = [];
  const add = (active, code, label, multiplier) => {
    if (active && Number.isFinite(multiplier) && multiplier > 1) candidates.push({ code, label, multiplier });
  };
  add(Number.isFinite(weather?.temperature) && weather.temperature <= -25,
    'cold', 'Сильный мороз', multipliers.EXTREME_COLD);
  add([73, 75, 85, 86].includes(weather?.weathercode), 'snow', 'Снегопад', multipliers.SNOW);
  // Scarcity wins a tie with the night tariff so the model's role remains visible.
  add(Number.isInteger(modeledCars) && modeledCars >= 0 && modeledCars < 4,
    'modeled_scarcity', 'Мало машин (модель)', multipliers.SCARCE_CARS);
  add(hour >= 0 && hour < 6, 'night', 'Ночной тариф', multipliers.NIGHT);
  add((hour >= 7 && hour < 10) || (hour >= 17 && hour < 20),
    'rush_hour', 'Час пик (модель спроса)', multipliers.HIGH_DEMAND);
  add(Boolean(holiday), 'holiday', 'Праздничный тариф', multipliers.HOLIDAY);
  const winner = candidates.reduce((best, candidate) => candidate.multiplier > best.multiplier ? candidate : best,
    { code: 'standard', label: 'Без надбавки', multiplier: 1 });
  return { ...winner, active: candidates };
}

export function adjustmentText(adjustment) {
  if (!adjustment || adjustment.multiplier === 1) return 'Без надбавки';
  return `×${String(adjustment.multiplier).replace('.', ',')} — ${adjustment.label}`;
}

export function deliveryQuote(baseAmount, adjustment) {
  if (!adjustment || !Number.isFinite(baseAmount) || baseAmount <= 0
      || !Number.isFinite(adjustment.multiplier) || adjustment.multiplier < 1) return null;
  // Preserve the existing rounding increment. Multiply once, then round once.
  const priceAmount = Math.ceil(baseAmount * adjustment.multiplier / 50) * 50;
  if (!Number.isSafeInteger(priceAmount) || priceAmount <= 0 || priceAmount > 10000000) return null;
  const reason = adjustmentText(adjustment);
  return { priceAmount, amountText: `${priceAmount} ₸`, reason,
    priceText: `${priceAmount} ₸ · ${reason}` };
}
