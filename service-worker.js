const CACHE_NAME = 'taxi-uspeh-v33-driver-sticky-chat';
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
