import { app, auth, db } from './firebase-config.js';
import { signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { collection, doc, getDocFromServer, onSnapshot, query, where, orderBy, limit, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const invoke = httpsCallable(getFunctions(app, 'us-central1'), 'carpoolCommand');
const pending = new Map();
export function createCarpoolApi() {
  const listen = (name, constraints, next, error) => onSnapshot(query(collection(db, name), ...constraints),
    snapshot => next(snapshot.docs.map(row => ({ id: row.id, ...row.data() }))), error);
  return {
    onUser(callback) { return onAuthStateChanged(auth, callback); },
    async user(anonymous = false) { await auth.authStateReady(); if (!auth.currentUser && anonymous) await signInAnonymously(auth); return auth.currentUser; },
    async ready() { try { const snap = await getDocFromServer(doc(db, 'settings', 'carpoolBooking')); return snap.data()?.schemaVersion === 1; } catch { return false; } },
    async read(name, id) { const snap = await getDocFromServer(doc(db, name, id)); return snap.exists() ? { id: snap.id, ...snap.data() } : null; },
    watchTrips(filters, next, error) {
      return listen('carpoolTrips', [where('status', '==', 'open'), where('fromKey', '==', filters.fromKey), where('toKey', '==', filters.toKey),
        where('departureAt', '>=', Timestamp.fromMillis(Math.max(Date.now(), filters.start))), where('departureAt', '<', Timestamp.fromMillis(filters.end)), orderBy('departureAt'), limit(50)], next, error);
    },
    watchDriverTrips(uid, next, error) { return listen('carpoolTrips', [where('driverUid', '==', uid), orderBy('createdAt', 'desc'), limit(30)], next, error); },
    watchAdminTrips(next, error) { return listen('carpoolTrips', [orderBy('createdAt', 'desc'), limit(100)], next, error); },
    watchMine(uid, next, error) { return listen('carpoolBookings', [where('clientUid', '==', uid), orderBy('createdAt', 'desc'), limit(50)], next, error); },
    watchPassengers(trip, admin, next, error) { return listen('carpoolBookings', [where('tripId', '==', trip.id), ...(admin ? [] : [where('driverUid', '==', trip.driverUid)])], next, error); },
    async command(data) {
      if (window.bookingScreen?.isPreview?.()) throw new Error('В режиме просмотра заказы не отправляются.');
      const user = await this.user();
      if (!user) throw new Error('Войдите в приложение.');
      const key = `${user.uid}:${JSON.stringify(data)}`;
      let operationId = pending.get(key);
      if (!operationId) { operationId = crypto.randomUUID(); pending.set(key, operationId); }
      try {
        const response = (await invoke({ ...data, operationId })).data;
        pending.delete(key);
        if (response.error) throw new Error(response.error);
        return response;
      } catch (error) {
        if (!['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal'].includes(error.code)) pending.delete(key);
        if (['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal'].includes(error.code)) throw new Error('Не удалось получить подтверждение. Проверьте список броней и повторите действие: повтор не создаст вторую бронь.');
        throw error;
      }
    }
  };
}
