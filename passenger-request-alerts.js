import { carpoolMillis } from './carpool-common.js?v=82';

export function createPassengerRequestAlerts({ api, onAlert, now = Date.now, storage, visible = () => !globalThis.document?.hidden } = {}) {
  let uid = '', enabled = false, stop, revision = 0;
  const seen = new Map();
  function remember(id, created) {
    const key = `taxi-uspeh-request-alert:${uid}:${id}`;
    if (seen.has(key)) return false;
    try { if (storage?.getItem(key)) return false; storage?.setItem(key, String(created)); } catch { /* Memory still prevents duplicate signals in this session. */ }
    seen.set(key, created); if (seen.size > 300) seen.delete(seen.keys().next().value);
    return true;
  }
  function receive(data) {
    const id = data?.requestId, created = Number(data?.createdAt);
    if (!enabled || !uid || !/^[A-Za-z0-9_-]{1,150}$/.test(id || '') || !Number.isFinite(created)
      || created > now() + 60000 || now() - created > 300000 || !remember(id, created)) return false;
    onAlert({ requestId: id, title: 'Новая заявка · Ищу машину', body: 'Пассажир ищет попутку. Откройте заявку, чтобы посмотреть маршрут и связаться.' });
    return true;
  }
  return {
    receive,
    async setContext(user, allowed) {
      const nextUid = user?.uid || '', nextEnabled = Boolean(nextUid && allowed);
      if (nextUid === uid && nextEnabled === enabled && (stop || !enabled)) return;
      uid = nextUid; enabled = nextEnabled; const current = ++revision; stop?.(); stop = null;
      if (!enabled || !api.watchRequestAlerts) return;
      try {
        if (!await api.hubReady() || current !== revision) return;
        let initial = true, known = new Set();
        stop = api.watchRequestAlerts((rows, meta = {}) => {
          if (current !== revision || meta.fromCache) return;
          for (const row of rows) if (visible() && !initial && !known.has(row.id) && row.status === 'open' && carpoolMillis(row.departureAt) > now()) {
            receive({ requestId: row.id, createdAt: carpoolMillis(row.createdAt) });
          }
          initial = false; known = new Set(rows.map(row => row.id));
        }, () => { if (current === revision) { stop?.(); stop = null; } });
      } catch { /* Push can still deliver; normal requests tab shows its own connection status. */ }
    },
    destroy() { revision++; stop?.(); stop = null; enabled = false; uid = ''; },
  };
}
