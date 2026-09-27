import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialCargoFare, cargoAmount, cargoMeters, cargoFareDescription, cargoCanComplete } from '../cargo-fare.js';
const fare = initialCargoFare();
test('first hour is 6000, only post-hour mileage increases the final amount', () => {
  assert.equal(cargoAmount(fare), 6000);
  assert.equal(cargoAmount(fare, 5000), 7250);
  assert.equal(cargoAmount(fare, 5200), 7300);
  assert.equal(cargoAmount(initialCargoFare(1), 5000), 10250);
});
test('manual mileage requires explicit zero or a finite non-negative decimal with 0.1 km precision', () => {
  assert.equal(cargoMeters('0'), 0); assert.equal(cargoMeters('5,2'), 5200);
  for (const value of ['', null, ' ', '-1', '1e3', 'Infinity', '1.23', '10001', '<script>']) assert.throws(() => cargoMeters(value));
});
test('tariff cannot silently change or accept invalid distance', () => {
  for (const field of ['schemaVersion', 'baseAmount', 'includedMinutes', 'kmRate', 'moverAmount']) assert.throws(() => cargoAmount({ ...fare, [field]: 2 }));
  for (const meters of [-1, NaN, Infinity, 50, 10000001]) assert.throws(() => cargoAmount(fare, meters));
  assert.throws(() => initialCargoFare(3));
  assert.equal(cargoAmount(Object.fromEntries(Object.entries(fare).reverse()), 100), 6025);
});
test('completion requires submitted mileage and dispatcher confirmation, legacy jobs keep their flow', () => {
  const order = { serviceType: 'cargo', cargoFare: fare, status: 'in_trip' };
  assert.equal(cargoCanComplete(order), false);
  assert.equal(cargoCanComplete({ ...order, cargoFinishedAt: {} }), false);
  assert.equal(cargoCanComplete({ ...order, cargoFinishedAt: {}, cargoConfirmedAt: {} }), true);
  assert.equal(cargoCanComplete({ serviceType: 'cargo', status: 'arrived' }), true);
});
test('pending mileage is visibly provisional; confirmed fare includes breakdown', () => {
  const order = { serviceType: 'cargo', cargoFare: fare, priceAmount: 6000 };
  assert.match(cargoFareDescription(order), /Стоимость предварительная/);
  assert.match(cargoFareDescription({ ...order, cargoFinishedAt: {}, cargoReportedMeters: 5000 }), /Ожидаем подтверждения/);
  assert.match(cargoFareDescription({ ...order, cargoFinishedAt: {}, cargoConfirmedAt: {}, cargoConfirmedMeters: 5000, priceAmount: 7250 }).replace(/\s/g, ''), /Итого:7250₸/);
});
