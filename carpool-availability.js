import { carpoolMillis } from './carpool-common.js?v=82';

export const availableCarpoolTrips = (rows, now = Date.now()) => rows.filter(row => row.status === 'open' && row.availableSeats > 0 && carpoolMillis(row.departureAt) > now);
export function createCarpoolAvailability() {
  let api, stop, stopAuth, generation = 0, uid = '', timer;
  let state = { trips: [], loading: false, error: false, signal: 0 };
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
  async function connect(user) {
    const revision = ++generation; stop?.(); stop = null; uid = user?.uid || '';
    publish({ trips: [], loading: Boolean(uid), error: false });
    if (!uid) return;
    try {
      const ready = await api.ready(); if (revision !== generation) return;
      if (!ready) { publish({ loading: false }); return; }
      let known = new Set();
      stop = api.watchAvailableTrips((rows, meta = {}) => {
        if (revision !== generation) return;
        if (meta.fromCache) { publish({ trips: [], loading: true }); return; }
        const trips = availableCarpoolTrips(rows), added = trips.some(trip => !known.has(trip.id));
        known = new Set(trips.map(trip => trip.id));
        publish({ trips, loading: false, error: false, signal: state.signal + Number(added) });
      }, () => { if (revision === generation) publish({ trips: [], loading: false, error: true }); });
    } catch { if (revision === generation) publish({ trips: [], loading: false, error: true }); }
  }
  const tick = () => publish({ trips: availableCarpoolTrips(state.trips) });
  const online = async () => {
    if (!state.error || !api) { tick(); return; }
    try { const user = await api.user(true); if (!api) return; if (!stopAuth) stopAuth = api.onUser(next => { void connect(next); }); else await connect(user); } catch { publish({ trips: [], loading: false, error: true }); }
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async start(source) {
      if (api) return;
      api = source; const revision = ++generation; publish({ loading: true });
      window.addEventListener('online', online); window.addEventListener('focus', tick);
      timer = window.setInterval(tick, 30000);
      try {
        await api.user(true); if (revision !== generation) return;
        stopAuth = api.onUser(user => { void connect(user); });
      } catch { if (revision === generation) publish({ trips: [], loading: false, error: true }); }
    },
    destroy() { generation++; stop?.(); stopAuth?.(); stop = stopAuth = api = null; uid = ''; window.clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('focus', tick); publish({ trips: [], loading: false, error: false }); },
  };
}
export const carpoolAvailability = createCarpoolAvailability();
