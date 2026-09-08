import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { calculateCategoryFare, driverCanServeOrder, validVehicleProfile, formatCategoryFare } from '../vehicle-categories.js';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const from = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const pricingSource = from('        let taxiFareSnapshot = null;', '        const debouncedOSRM = debounce(')
  + from('        window.updateTaxiPrice = function()', '        window.updateDeliveryPrice = function()');
function harness(category = 'wagon') {
  const state = { category, fallback: { min: 800, max: 1000, routeLabel: 'Test' }, points: [{ address: 'Street A', city: 'Белоусовка' }, { address: 'Street B', city: 'Белоусовка' }], distance: 1000, textContent: '' };
  const window = { bookingScreen: { vehicleRequest: () => ({ vehicleCategory: state.category }) } };
  const context = vm.createContext({ window, console, calculateCategoryFare, formatCategoryFare,
    document: { getElementById: id => id === 'taxiPriceEstimate' ? state : null },
    calculateTaxiDatabaseFallback: () => state.fallback, getTaxiRoutePoints: () => state.points, getTaxiRatePoints: () => state.points,
    setTaxiRouteHint: () => {}, debouncedOSRM: () => {}, countFilledAddresses: () => state.points.length,
    getCoordinates: async () => state.waitCoordinates ? state.waitCoordinates : ({ lat: 50, lon: 82 }), getRouteDistance: async () => { state.routeStarted?.(); return state.waitDistance || state.distance; },
    CONFIG: { TAXI: { BASE_PRICE: 800, BASE_DISTANCE_KM: 2, PRICE_PER_KM: 100, INTERCITY_PRICE_PER_KM: 230, MANY_STOPS_MIN: 1200, MANY_STOPS_MAX: 1500, MIN_PRICE_RANGE_OFFSET: 200 } }
  });
  vm.runInContext('let taxiRouteCalculationId = 0; let priceMultiplier = 1; let isLuckyDiscount = false;\n' + pricingSource, context);
  return { state, update: () => window.updateTaxiPrice(), route: () => vm.runInContext('calculateTaxiPriceOSRM()', context), quote: () => window.getTaxiFareForOrder(), demand: value => vm.runInContext(`priceMultiplier = ${value}`, context) };
}
test('approved examples and rounding at 100-tenge boundaries', () => {
  for (const [base, wagon, minivan] of [[800, 1000, 1200], [1000, 1200, 1500], [5000, 6000, 7500], [501, 700, 800]]) {
    assert.equal(calculateCategoryFare(base, base, 'sedan').priceMax, base);
    assert.equal(calculateCategoryFare(base, base, 'wagon').priceMax, wagon);
    assert.equal(calculateCategoryFare(base, base, 'minivan').priceMax, minivan);
  }
  assert.equal(calculateCategoryFare(1.5, 10, 'wagon'), null);
  assert.equal(calculateCategoryFare(1000, 800, 'wagon'), null);
  assert.equal(calculateCategoryFare(800, 800, 'unknown'), null);
});
test('actual database quote uses both bounds and switching never compounds surcharge', () => {
  const h = harness(); h.update(); assert.equal(h.state.textContent, 'от 1000–1200 ₸');
  h.update(); assert.equal(h.quote().priceMax, 1200);
  h.state.category = 'minivan'; h.update(); assert.equal(h.state.textContent, 'от 1200–1500 ₸');
  h.state.category = 'sedan'; h.update(); assert.equal(h.quote().priceMax, 1000);
  assert.equal(h.quote().basePriceMax, 1000);
});
test('actual local route and intercity route apply category after the ordinary tariff', async () => {
  const h = harness(); h.update(); await h.route(); assert.equal(h.quote().priceMax, 1000); assert.equal(h.quote().basePriceMax, 800);
  h.state.category = 'minivan'; h.state.points[1].city = 'Усть-Каменогорск'; h.state.distance = 20000;
  h.update(); await h.route(); assert.equal(h.quote().basePriceMax, 4600); assert.equal(h.quote().priceMax, 6900);
});
test('multi-stop fallback and existing demand multiplier each apply once', () => {
  const h = harness(); h.state.fallback = null; h.state.points.push({ address: 'Stop', city: 'Белоусовка' });
  h.update(); assert.equal(h.quote().basePriceMax, 1500); assert.equal(h.quote().priceMax, 1800);
  h.demand(1.5); h.update(); assert.equal(h.quote().basePriceMax, 2250); assert.equal(h.quote().priceMax, 2700);
});
test('late route response cannot restore the price of a previous category', async () => {
  const h = harness(); h.update(); let resolve;
  h.state.waitCoordinates = new Promise(done => { resolve = done; }); const pending = h.route();
  h.state.category = 'minivan'; h.update(); const expected = h.state.textContent;
  resolve({ lat: 50, lon: 82 }); await pending;
  assert.equal(h.state.textContent, expected); assert.equal(h.quote().vehicleCategory, 'minivan');
});
test('unknown intercity fare clears the previous premium quote', () => {
  const h = harness(); h.update(); assert.ok(h.quote());
  h.state.fallback = null; h.state.points[1].city = 'Unknown'; h.update();
  assert.equal(h.quote(), null); assert.equal(h.state.textContent, 'Стоимость уточняется');
});
test('profiles retain regular service and enforce real minivan capacity', () => {
  assert.ok(driverCanServeOrder({}, { serviceType: 'taxi' }));
  assert.equal(driverCanServeOrder({}, { serviceType: 'taxi', vehicleCategory: 'wagon' }), false);
  const driver = { serviceCategories: ['sedan', 'minivan'], passengerSeats: 6 };
  assert.ok(driverCanServeOrder(driver, { serviceType: 'taxi', vehicleCategory: 'sedan' }));
  assert.equal(driverCanServeOrder(driver, { serviceType: 'taxi', vehicleCategory: 'minivan', passengerCount: 7 }), false);
  assert.ok(driverCanServeOrder(driver, { serviceType: 'taxi', vehicleCategory: 'minivan', passengerCount: 6 }));
  assert.equal(validVehicleProfile(['sedan', 'minivan'], 4), false);
  assert.equal(validVehicleProfile(['sedan', 'sedan'], 4), false);
});

test('late routing response cannot overwrite a newer route quote', async () => {
  const h = harness(); h.update(); let resolveDistance, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  h.state.routeStarted = markStarted;
  h.state.waitDistance = new Promise(resolve => { resolveDistance = resolve; });
  const pending = h.route(); await started;
  h.state.category = 'minivan';
  h.state.fallback = { min: 5000, max: 5000, routeLabel: 'New route' };
  h.update();
  resolveDistance(1000); await pending;
  assert.equal(h.quote().priceMax, 7500);
  assert.equal(h.quote().basePriceMax, 5000);
});
