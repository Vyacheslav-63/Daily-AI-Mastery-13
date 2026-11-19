/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  day?: number;
  tag?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload;
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Daily AI Mastery — Новый урок открыт';
  const body =
    payload.body ||
    'Подошло время следующего урока. Откройте приложение, чтобы продолжить серию.';
  const targetUrl = payload.url || '/';
  const tag = payload.tag || `daily-ai-mastery-day-${payload.day ?? 'next'}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag,
      renotify: true,
      data: { url: targetUrl, day: payload.day },
    } as NotificationOptions)
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = (event.notification.data || {}) as { url?: string };
  const targetUrl = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const msg = event.data as
    | { type?: string; payload?: PushPayload }
    | undefined;
  if (!msg || msg.type !== 'SHOW_LOCAL_NOTIFICATION' || !msg.payload) return;

  const { title, body, url, day, tag } = msg.payload;
  event.waitUntil(
    self.registration.showNotification(title || 'Daily AI Mastery', {
      body: body || 'Новый урок готов к изучению.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: tag || `daily-ai-mastery-day-${day ?? 'local'}`,
      data: { url: url || '/', day },
    } as NotificationOptions)
  );
});
