const CACHE_NAME = 'taxi-uspeh-v73-manual-address-price';
const APP_SHELL = [
  './',
  './driver-finance.js?v=69',
  './functions/driver-services.mjs?v=69',
  './cargo-profile-controls.js?v=69',
  './driver-finance-controls.js?v=69',
  './index.html',
  './customer-pricing.js?v=67',
  './customer-price-control.js?v=73',
  './customer-pricing-settings.js?v=67',
  './styles/customer-pricing.css?v=67',
  './client-home.js?v=60',
  './styles/client-home.css?v=56',
  './vehicle-categories.js?v=69',
  './vehicle-category-controls.js?v=69',
  './styles/vehicle-categories.css?v=69',
  './auction-core.js?v=69',
  './styles/auction.css?v=51',
  './styles/tailwind.css',
  './styles/booking-screen.css?v=68',
  './booking-screen.js?v=73',
  './booking-route.js?v=73',
  './booking-sheet.js?v=54',
  './booking-core.js?v=60',
  './taxi-pricing.js?v=67',
  './pricing-adjustments.js?v=63',
  './delivery-pricing.js?v=73',
  './client-orders.js?v=73',
  './holiday-calendar.js',
  './drivers.html',
  './drivers.webmanifest',
  './driver-install.js?v=61',
  './driver-portal.js?v=73',
  './order-time.js?v=71',
  './driver-cabinet.js?v=69',
  './styles/driver-cabinet.css?v=72',
  './dispatcher.html',
  './dispatcher.js?v=69',
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
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    APP_SHELL.map(url => new Request(url, { cache: 'reload' }))
  )));
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

self.addEventListener('notificationclick', event => {
  if (!event.notification.data?.url) return;
  event.stopImmediatePropagation();
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
    // FCM already displays notification payloads (including console test messages).
    if (payload?.notification) return;
    const data = payload?.data || {};
    const url = data.url || './drivers.html#driver-online-orders';
    return self.registration.showNotification(data.title || 'Новый онлайн-заказ', {
      body: data.body || 'Откройте кабинет, чтобы посмотреть маршрут и цену.',
      icon: './pwa-icon-512x512.png',
      badge: './favicon-192x192.png',
      tag: data.type === 'push_test' ? 'taxi-uspeh-push-test' : data.orderId ? `taxi-uspeh-order-${data.orderId}` : 'taxi-uspeh-order',
      renotify: true,
      vibrate: [180, 90, 180],
      data: { url }
    });
  });
} catch (error) {
  console.warn('Firebase Messaging недоступен в service worker:', error.message);
}
