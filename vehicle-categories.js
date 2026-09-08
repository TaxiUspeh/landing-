export const VEHICLE_CATEGORIES = Object.freeze({
  sedan: Object.freeze({ label: 'Легковой', surchargePercent: 0 }),
  wagon: Object.freeze({ label: 'Универсал', surchargePercent: 20 }),
  minivan: Object.freeze({ label: 'Минивэн', surchargePercent: 50 })
});
export const categoryForService = service => ['wagon', 'minivan'].includes(service) ? service : 'sedan';
export const categoryLabel = category => VEHICLE_CATEGORIES[category]?.label || 'Категория не указана';
export const categoryCaption = category => {
  const info = VEHICLE_CATEGORIES[category];
  return info ? `${info.label}${info.surchargePercent ? ` · +${info.surchargePercent}%` : ''}` : '';
};
export function calculateCategoryFare(basePriceMin, basePriceMax, vehicleCategory = 'sedan') {
  const info = VEHICLE_CATEGORIES[vehicleCategory];
  if (!info || !Number.isInteger(basePriceMin) || !Number.isInteger(basePriceMax)
      || basePriceMin < 0 || basePriceMax < basePriceMin || basePriceMax > 10000000) return null;
  // Integer arithmetic: surcharge is applied to the base, never to a previous quote.
  const amount = base => info.surchargePercent ? Math.ceil(base * (100 + info.surchargePercent) / 10000) * 100 : base;
  const priceMin = amount(basePriceMin), priceMax = amount(basePriceMax);
  if (priceMax > 10000000) return null;
  return { vehicleCategory, basePriceMin, basePriceMax, priceMin, priceMax };
}
export const formatCategoryFare = fare => fare.priceMin === fare.priceMax
  ? `~ ${fare.priceMax} ₸` : `от ${fare.priceMin}–${fare.priceMax} ₸`;
export function driverCategories(driver = {}) {
  const extra = Array.isArray(driver.serviceCategories) ? driver.serviceCategories : [];
  return ['sedan', ...['wagon', 'minivan'].filter(category => extra.includes(category))];
}
export function driverPassengerSeats(driver = {}) {
  if (driver.passengerSeats === undefined) return 4;
  return Number.isInteger(driver.passengerSeats) && driver.passengerSeats >= 1 && driver.passengerSeats <= 8 ? driver.passengerSeats : 0;
}
export function validVehicleProfile(serviceCategories, passengerSeats) {
  return Array.isArray(serviceCategories) && serviceCategories.includes('sedan')
    && serviceCategories.length === new Set(serviceCategories).size
    && serviceCategories.every(category => Object.hasOwn(VEHICLE_CATEGORIES, category))
    && Number.isInteger(passengerSeats) && passengerSeats >= 1 && passengerSeats <= 8
    && (!serviceCategories.includes('minivan') || passengerSeats >= 5);
}
export function driverCanServeOrder(driver, order = {}) {
  if (order.serviceType && order.serviceType !== 'taxi') return true;
  const category = order.vehicleCategory ?? 'sedan';
  const count = order.passengerCount ?? 1;
  return driverCategories(driver).includes(category) && Number.isInteger(count) && count >= 1
    && count <= driverPassengerSeats(driver)
    && (category !== 'minivan' || driverPassengerSeats(driver) >= 5);
}
export const driverCategorySummary = driver => `${driverCategories(driver).map(categoryLabel).join(' · ')} · мест: ${driverPassengerSeats(driver)}`;
export const orderCategorySummary = order => order.serviceType === 'taxi' && order.vehicleCategory
  ? `${categoryLabel(order.vehicleCategory)}${order.vehicleCategory === 'minivan' ? ` · пассажиров: ${order.passengerCount}` : ''}` : '';
