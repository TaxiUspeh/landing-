import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activateCarpool } from './activate-carpool-booking.mjs';

const wanted = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url))).indexes
  .filter(index => index.collectionGroup.startsWith('carpool'));
const deployed = wanted.map((index, i) => ({
  name: `projects/test/databases/(default)/collectionGroups/${index.collectionGroup}/indexes/${i}`,
  queryScope: index.queryScope,
  fields: [...index.fields, { fieldPath: '__name__', order: index.fields.at(-1).order }],
  state: 'READY',
}));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fixture(handler) {
  const calls = [], logs = [], sleeps = [];
  const run = overrides => activateCarpool({
    token: 'test-private-token', wanted, attempts: 2,
    log: text => logs.push(text), sleep: async ms => sleeps.push(ms),
    fetchImpl: async (url, options) => {
      const request = { url: new URL(url), ...options };
      calls.push(request);
      return handler(request, calls);
    }, ...overrides,
  });
  return { run, calls, logs, sleeps };
}
function indexResponse(url, indexes = deployed) {
  return json({ indexes: indexes.filter(index => new URL('https://example.test/' + index.name).pathname
    .includes(`/collectionGroups/${url.pathname.split('/collectionGroups/')[1].split('/')[0]}/`)) });
}

test('default page size and all pages are used before activating; update preserves other settings', async () => {
  const f = fixture(({ url, method, body }) => {
    assert.equal(url.searchParams.has('pageSize'), false);
    if (method === 'PATCH') {
      assert.deepEqual(url.searchParams.getAll('updateMask.fieldPaths'), ['schemaVersion', 'updatedAt']);
      assert.equal(JSON.parse(body).fields.schemaVersion.integerValue, '1');
      return json({});
    }
    if (url.pathname.includes('/carpoolTrips/')) {
      if (!url.searchParams.has('pageToken')) return json({ indexes: [deployed[0]], nextPageToken: 'next+page/&' });
      assert.equal(url.searchParams.get('pageToken'), 'next+page/&');
      return json({ indexes: [deployed[1]] });
    }
    return indexResponse(url);
  });
  await f.run();
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls.at(-1).method, 'PATCH');
  assert.match(f.logs.at(-1), /Попутки подключены/);
});

test('waits for BUILDING indexes and never enables early', async () => {
  let reads = 0;
  const f = fixture(({ url, method }) => {
    if (method === 'PATCH') { assert.equal(reads, 4); return json({}); }
    reads++;
    return indexResponse(url, deployed.map(index => ({ ...index, state: reads <= 2 ? 'CREATING' : 'READY' })));
  });
  await f.run();
  assert.deepEqual(f.sleeps, [5000]);
});

test('missing indexes, incorrect scope/order and extra indexed fields do not activate', async () => {
  for (const indexes of [
    deployed.slice(1),
    deployed.map(index => ({ ...index, queryScope: 'COLLECTION_GROUP' })),
    deployed.map(index => ({ ...index, fields: [...index.fields].reverse() })),
    deployed.map(index => ({ ...index, fields: [...index.fields.slice(0, -1), { fieldPath: 'extra', order: 'ASCENDING' }, index.fields.at(-1)] })),
  ]) {
    const f = fixture(({ url }) => indexResponse(url, indexes));
    await assert.rejects(f.run({ attempts: 1 }), /не включены/);
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
  }
});

test('index API error reports real Google reason and status without token; no activation', async () => {
  const f = fixture(() => json({ error: { message: 'Invalid page size test-private-token' } }, 400));
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /HTTP 400.*Invalid page size/);
    assert.equal(error.message.includes('test-private-token'), false);
    return true;
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.logs.some(line => line.includes('подключены')), false);
});

test('repair-required indexes stop immediately without activation', async () => {
  const f = fixture(({ url }) => indexResponse(url, deployed.map(index => ({ ...index, state: 'NEEDS_REPAIR' }))));
  await assert.rejects(f.run(), /требует восстановления/);
  assert.equal(f.sleeps.length, 0);
  assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
});

test('activation permission error is surfaced and success is not printed', async () => {
  const f = fixture(({ url, method }) => method === 'PATCH'
    ? json({ error: { message: 'Permission denied' } }, 403) : indexResponse(url));
  await assert.rejects(f.run(), /Не удалось включить.*HTTP 403.*Permission denied/);
  assert.equal(f.logs.some(line => line.includes('подключены')), false);
});

test('empty requirements and repeated pagination fail closed', async () => {
  const empty = fixture(() => { throw new Error('No request expected'); });
  await assert.rejects(empty.run({ wanted: [] }), /не найдены индексы/);
  assert.equal(empty.calls.length, 0);
  const f = fixture(() => json({ indexes: [], nextPageToken: 'same' }));
  await assert.rejects(f.run(), /повторил страницу/);
  assert.equal(f.calls.length, 2);
});
