const CACHE_NAME = 'taxi-uspeh-v44-driver-three-step-order';
const APP_SHELL = [
  './',
  './index.html',
  './client-orders.js',
  './holiday-calendar.js',
  './drivers.html',
  './drivers.webmanifest',
  './driver-portal.js',
  './dispatcher.html',
  './dispatcher.js',
  './firebase-config.js',
  './food.html',
  './SHASHDVOR.html',
  './food.webmanifest',
  './shashlyk.webmanifest',
  './food-icon-192.png',
  './food-icon-512.png',
  './shashlyk-icon-192.png',
  './shashlyk-icon-512.png',
  './site.webmanifest',
  './favicon-32x32.png',
  './favicon-192x192.png',
  './apple-touch-icon.png',
  './pwa-icon-512x512.png',
  './pwa-maskable-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedPage = await caches.match(event.request);
        return cachedPage || caches.match('./index.html');
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});

// FCM использует этот уже зарегистрированный PWA service worker. В пуш не кладём
// адрес или телефон клиента: водитель увидит детали только после входа в кабинет.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyDD9akfhmRpCwyWBRx1FJd-2mSjoItLLjE',
    authDomain: 'taxiuspeh-76d55.firebaseapp.com',
    projectId: 'taxiuspeh-76d55',
    storageBucket: 'taxiuspeh-76d55.firebasestorage.app',
    messagingSenderId: '678422371368',
    appId: '1:678422371368:web:64c7b4b48c102b3efda91d'
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const data = payload?.data || {};
    const url = data.url || './drivers.html#driver-online-orders';
    return self.registration.showNotification(data.title || 'Новый онлайн-заказ', {
      body: data.body || 'Откройте кабинет, чтобы посмотреть маршрут и цену.',
      icon: './pwa-icon-512x512.png',
      badge: './favicon-192x192.png',
      tag: data.orderId ? `taxi-uspeh-order-${data.orderId}` : 'taxi-uspeh-order',
      renotify: true,
      vibrate: [180, 90, 180],
      data: { url }
    });
  });
} catch (error) {
  console.warn('Firebase Messaging недоступен в service worker:', error.message);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : './';
  const targetUrl = new URL(requestedUrl, self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const appClient = windowClients.find(client => client.url.startsWith(self.registration.scope));
      if (appClient) {
        if ('navigate' in appClient) {
          return appClient.navigate(targetUrl).then(navigatedClient => {
            return navigatedClient && 'focus' in navigatedClient ? navigatedClient.focus() : appClient.focus();
          });
        }
        return appClient.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});
