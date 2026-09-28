const activeStatuses = new Set(['confirmed', 'boarded', 'disputed']);
const millis = value => value?.toMillis?.() ?? ((value?.seconds || 0) * 1000);
export const activeCarpoolBookings = bookings => bookings.filter(booking => activeStatuses.has(booking.status))
  .sort((a, b) => millis(a.departureAt) - millis(b.departureAt));

// One authenticated subscription feeds the home page and the full booking view.
// Nothing is copied to localStorage; changing accounts clears all private rows.
export function createCarpoolBookings() {
  let api, stopAuth, stopMine, generation = 0;
  let state = { uid: '', bookings: [], loading: false, error: '', ready: false };
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  async function connect(uid = '', retry = false) {
    if (uid === state.uid && !retry && (state.loading || stopMine || !uid)) return;
    const request = ++generation;
    stopMine?.(); stopMine = null;
    publish({ uid, bookings: uid === state.uid ? state.bookings : [], loading: Boolean(uid), error: '', ready: false });
    if (!uid) return;
    try {
      const ready = await api.ready();
      if (request !== generation) return;
      if (!ready) { publish({ loading: false, error: 'Не удалось подключить попутки. Проверьте интернет и повторите попытку.' }); return; }
      publish({ ready: true });
      stopMine = api.watchMine(uid, bookings => {
        if (request === generation) publish({ bookings, loading: false, error: '' });
      }, () => {
        if (request === generation) publish({ loading: false, error: 'Не удалось обновить бронирования. Показаны последние полученные данные.' });
      });
    } catch {
      if (request === generation) publish({ loading: false, error: 'Не удалось загрузить бронирования. Проверьте интернет и повторите попытку.' });
    }
  }
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    start(source) {
      if (api) return;
      api = source;
      stopAuth = api.onUser(user => { void connect(user?.uid || ''); });
    },
    async refresh(user) {
      if (!api) return;
      const before = generation;
      const current = user === undefined ? await api.user(false) : user;
      if (before !== generation && user === undefined) return;
      await connect(current?.uid || '', Boolean(state.error));
    },
    destroy() {
      generation++; stopMine?.(); stopAuth?.(); stopMine = stopAuth = api = null;
      publish({ uid: '', bookings: [], loading: false, error: '', ready: false });
    },
  };
}
export const carpoolBookings = createCarpoolBookings();
