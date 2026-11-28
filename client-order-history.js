import { auth, db, ensureFirebaseUser } from './firebase-config.js';
import {
  collection, getDocs, limit, orderBy, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const HISTORY_LIMIT = 50;

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  return 0;
}

export async function loadMyClientOrders() {
  const user = auth.currentUser || await ensureFirebaseUser();
  if (!user?.uid) return [];

  const ordersQuery = query(
    collection(db, 'orders'),
    where('clientUid', '==', user.uid),
    orderBy('createdAt', 'desc'),
    limit(HISTORY_LIMIT)
  );
  const snapshot = await getDocs(ordersQuery);

  return snapshot.docs.map(orderDoc => {
    const data = orderDoc.data() || {};
    const createdAtMillis = timestampMillis(data.createdAt);
    const date = createdAtMillis
      ? new Date(createdAtMillis).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : '';
    const time = createdAtMillis
      ? new Date(createdAtMillis).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';

    return {
      firestoreId: orderDoc.id,
      serviceType: data.serviceType || '',
      from: data.fromAddress || '',
      to: data.toAddress || '',
      price: data.priceText || (Number.isFinite(data.priceAmount) ? `${data.priceAmount} ₸` : 'Цена уточняется'),
      date,
      time,
      createdAtMillis
    };
  });
}
