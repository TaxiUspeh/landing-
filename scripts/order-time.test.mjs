import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTimeInfo } from '../order-time.js';
const millis = value => Date.parse(value);
const timestamp = value => ({ toMillis: () => millis(value) });
const now = millis('2026-09-20T05:47:00Z');
const base = { status: 'searching', createdAt: timestamp('2026-09-20T05:42:00Z') };

test('creation time uses the service clock and age changes at minute boundaries', () => {
  assert.equal(orderTimeInfo(base, now).createdText, 'Создан в 10:42 · 5 мин назад');
  const created = millis('2026-09-20T05:42:00Z');
  assert.match(orderTimeInfo(base, created + 59999).createdText, /только что$/);
  assert.match(orderTimeInfo(base, created + 60000).createdText, /1 мин назад$/);
  assert.match(orderTimeInfo(base, created + 61 * 60000).createdText, /1 ч 1 мин назад$/);
});
test('midnight, old dates and previous years retain an unambiguous creation date', () => {
  const midnight = millis('2026-09-20T19:02:00Z');
  assert.match(orderTimeInfo({ ...base, createdAt: timestamp('2026-09-20T18:59:00Z') }, midnight).createdText, /20 сентября, 23:59 · 3 мин назад/);
  const old = orderTimeInfo({ ...base, createdAt: timestamp('2025-12-31T10:00:00Z') }, now);
  assert.match(old.createdText, /31 декабря 2025/); assert.match(old.createdText, /15:00/);
});
test('warning is only for still searching orders after ten minutes and excludes future pickup', () => {
  const created = millis('2026-09-20T05:42:00Z');
  assert.equal(orderTimeInfo(base, created + 599999).waiting, false);
  assert.equal(orderTimeInfo(base, created + 600000).waiting, true);
  for (const status of ['accepted', 'arrived', 'completed', 'cancelled']) assert.equal(orderTimeInfo({ ...base, status }, created + 3600000).waiting, false);
  const future = orderTimeInfo({ ...base, scheduledFor: '2026-09-20T15:00' }, created + 3600000);
  assert.equal(future.scheduledText, 'Подача сегодня в 15:00'); assert.equal(future.waiting, false);
});
test('price increase and requeue never replace creation time; absent timestamps are not invented', () => {
  const changed = Object.freeze({ ...base, updatedAt: timestamp('2026-09-20T05:47:00Z'), requeuedAt: timestamp('2026-09-20T05:47:00Z'), priceAmount: 9000 });
  assert.equal(orderTimeInfo(changed, now).createdText, orderTimeInfo(base, now).createdText);
  for (const createdAt of [undefined, null, { toMillis: () => NaN }]) {
    const info = orderTimeInfo({ ...base, createdAt }, now);
    assert.equal(info.createdText, 'Время создания не указано'); assert.equal(info.dateTime, ''); assert.equal(info.waiting, false);
  }
  const invalid = orderTimeInfo({ ...base, scheduledFor: '2026-02-30T25:00' }, now);
  assert.match(invalid.scheduledText, /уточнить/); assert.equal(invalid.waiting, false);
});
