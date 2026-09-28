import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarpoolBookings, activeCarpoolBookings } from '../carpool-bookings.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(ready = async () => true) {
  let authChanged, current = null, unsubscribed = 0;
  const streams = [], seen = [], anonymous = [];
  const store = createCarpoolBookings();
  const api = {
    ready,
    onUser(callback) { authChanged = callback; callback(current); return () => {}; },
    async user(value) { anonymous.push(value); return current; },
    watchMine(uid, next, error) { streams.push({ uid, next, error }); return () => unsubscribed++; },
  };
  store.subscribe(state => seen.push(state)); store.start(api);
  return { store, api, streams, seen, anonymous, get unsubscribed() { return unsubscribed; },
    login(uid) { current = uid ? { uid } : null; authChanged(current); } };
}

test('starts reading restored account without opening carpool; shares one live stream', async () => {
  const f = fixture(); f.login('passenger'); await flush();
  assert.equal(f.streams.length, 1);
  f.streams[0].next([{ id: 'b1', status: 'confirmed' }]);
  let replay; f.store.subscribe(state => { replay = state; });
  assert.equal(replay.bookings[0].id, 'b1');
  f.store.start(f.api); await f.store.refresh();
  assert.equal(f.streams.length, 1); assert.deepEqual(f.anonymous, [false]);
  f.store.destroy();
});

test('logout clears private rows synchronously and ignores late account snapshots', async () => {
  const f = fixture(); f.login('first'); await flush();
  f.streams[0].next([{ id: 'private' }]);
  f.login('second'); assert.deepEqual(f.store.getState().bookings, []); await flush();
  f.streams[0].next([{ id: 'stale' }]); assert.deepEqual(f.store.getState().bookings, []);
  f.streams[1].next([{ id: 'second-booking' }]);
  f.login(null); assert.equal(f.store.getState().uid, ''); assert.deepEqual(f.store.getState().bookings, []);
  assert.equal(f.unsubscribed, 2); f.store.destroy();
});

test('delayed readiness for previous account cannot install a private subscription', async () => {
  const waiting = []; const f = fixture(() => new Promise(resolve => waiting.push(resolve)));
  f.login('first'); f.login('second'); waiting[0](true); await flush();
  assert.equal(f.streams.length, 0);
  waiting[1](true); await flush(); assert.equal(f.streams[0].uid, 'second');
  f.store.destroy();
});

test('subscription failure preserves rows with warning; retry reconnects and clears warning', async () => {
  const f = fixture(); f.login('passenger'); await flush();
  f.streams[0].next([{ id: 'booking' }]); f.streams[0].error(new Error('offline'));
  assert.equal(f.store.getState().bookings.length, 1); assert.match(f.store.getState().error, /последние/);
  await f.store.refresh(); assert.equal(f.unsubscribed, 1); assert.equal(f.streams.length, 2);
  f.streams[1].next([]); assert.equal(f.store.getState().error, ''); f.store.destroy();
});

test('failed readiness can be retried and does not create an anonymous account', async () => {
  let enabled = false; const f = fixture(async () => enabled); f.login('passenger'); await flush();
  assert.equal(f.streams.length, 0); assert.ok(f.store.getState().error);
  enabled = true; await f.store.refresh(); assert.equal(f.streams.length, 1);
  f.login(null); await f.store.refresh(); assert.deepEqual(f.anonymous, [false, false]); f.store.destroy();
});

test('active bookings sort by departure and retain overdue uncompleted bookings', () => {
  const bookings = [{ id: 'later', status: 'confirmed', departureAt: { seconds: 30 } },
    { id: 'done', status: 'completed', departureAt: { seconds: 2 } },
    { id: 'earlier', status: 'boarded', departureAt: { seconds: 10 } },
    { id: 'dispute', status: 'disputed', departureAt: { seconds: 20 } },
    { id: 'cancel', status: 'cancelled', departureAt: { seconds: 1 } }];
  assert.deepEqual(activeCarpoolBookings(bookings).map(booking => booking.id), ['earlier', 'dispute', 'later']);
  assert.equal(bookings[0].id, 'later');
});
