// Shared by the browser and push functions. One driver identity, two vehicle cards.
export const PASSENGER_SERVICES = Object.freeze(['taxi', 'delivery', 'auction', 'soberDriver', 'assistance']);
export const serviceDirection = order => order?.serviceType === 'cargo' ? 'cargo' : 'passenger';
export function serviceEnabled(driver = {}, direction = 'passenger') {
  return direction === 'cargo' ? driver.cargoProfile?.status === 'active'
    : driver.passengerEnabled !== false && (driver.passengerStatus ?? 'active') === 'active';
}
export function allowedOrderServices(driver = {}) {
  return [...(serviceEnabled(driver) ? PASSENGER_SERVICES.filter(service => service !== 'soberDriver' || driver.soberDriverEnabled === true) : []), ...(serviceEnabled(driver, 'cargo') ? ['cargo'] : [])];
}
export function profileForOrder(driver = {}, order = {}) {
  if (serviceDirection(order) !== 'cargo') return driver;
  const cargo = driver.cargoProfile || {};
  return { ...driver, car: cargo.car || '', color: cargo.color || '', plate: cargo.plate || '',
    commissionRate: cargo.commissionRate ?? driver.commissionRate ?? 20 };
}
export function assignmentVehicle(driver, order) {
  const profile = profileForOrder(driver, order);
  return { driverCar: [profile.car, profile.plate].filter(Boolean).join(' · '), driverColor: profile.color || '' };
}
export function eligiblePushDevice(subscription, account, driver, targetUid = '', order = null) {
  const uid = String(subscription.uid || ''), driverId = String(subscription.driverId || '');
  return typeof subscription.token === 'string' && subscription.token.length > 0
    && (!targetUid || uid === targetUid) && account?.active === true
    && String(account.driverId || '') === driverId && driver?.status === 'active' && driver.authUid === uid
    && (!order || allowedOrderServices(driver).includes(order.serviceType));
}
export function validCargoProfile(profile) {
  return !!profile && ['active', 'paused', 'blocked'].includes(profile.status)
    && typeof profile.car === 'string' && profile.car.length <= 120
    && ['color', 'plate', 'bodyType', 'dimensions'].every(key => typeof profile[key] === 'string' && profile[key].length <= 120)
    && Number.isFinite(profile.payloadKg) && profile.payloadKg >= 0 && profile.payloadKg <= 100000
    && (profile.status !== 'active' || (profile.car.trim().length > 0 && profile.payloadKg > 0))
    && Number.isInteger(profile.commissionRate) && profile.commissionRate >= 0 && profile.commissionRate <= 100;
}
