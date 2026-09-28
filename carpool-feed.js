export function createCarpoolFeed({ field, readyMethod, watchMethod, label, unavailable }) {
  let api, stopAuth, stopMine, generation = 0;
  let state = { uid: '', [field]: [], loading: false, error: '', ready: false };
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  async function connect(uid = '', retry = false) {
    if (uid === state.uid && !retry && (state.loading || stopMine || !uid)) return;
    const request = ++generation;
    stopMine?.(); stopMine = null;
    publish({ uid, [field]: uid === state.uid ? state[field] : [], loading: Boolean(uid), error: '', ready: false });
    if (!uid) return;
    try {
      const ready = await api[readyMethod]();
      if (request !== generation) return;
      if (!ready) { publish({ loading: false, error: unavailable }); return; }
      publish({ ready: true });
      stopMine = api[watchMethod](uid, rows => {
        if (request === generation) publish({ [field]: rows, loading: false, error: '' });
      }, () => {
        if (request === generation) publish({ loading: false, error: `Не удалось обновить ${label}. Показаны последние полученные данные.` });
      });
    } catch {
      if (request === generation) publish({ loading: false, error: `Не удалось загрузить ${label}. Проверьте интернет и повторите попытку.` });
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
      publish({ uid: '', [field]: [], loading: false, error: '', ready: false });
    },
  };
}
