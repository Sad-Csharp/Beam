'use strict';
// Beam service worker: offline app shell. The cache name follows version.js, so every release
// installs a fresh cache and activation deletes all older Beam caches (no stale leftovers).
importScripts('version.js');
const VERSION = 'beam-v' + self.BEAM_VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'version.js', 'opfs-worker.js', 'manifest.webmanifest',
  'vendor/peerjs.min.js', 'vendor/qrcode.js', 'vendor/jsqr.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('beam-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first (fresh code when online), cache fallback (works offline or on a bad connection).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 3500);
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(to);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : Response.error());
    }
  })());
});
