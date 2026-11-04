'use strict';
// Beam service worker: offline app shell. The cache name follows version.js, so every release
// installs a fresh cache and activation deletes all older Beam caches (no stale leftovers).
importScripts('version.js');
const VERSION = 'beam-v' + self.BEAM_VERSION;
// version.js may be a stale copy during an upgrade (browsers cache imported scripts), so keep a fallback list.
const SHELL = self.BEAM_FILES || [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'version.js', 'opfs-worker.js', 'manifest.webmanifest',
  'vendor/peerjs.min.js', 'vendor/qrcode.js', 'vendor/jsqr.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

// Cache each file independently so one failure can never stop the new version from taking over.
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('beam-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first, always revalidating with the server so a release is never hidden behind the browser's
// HTTP cache (GitHub Pages lets browsers keep files for ~10 minutes). Cache is the offline fallback.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 3500);
      const res = await fetch(req.url, { cache: 'no-cache', signal: ctl.signal });
      clearTimeout(to);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : Response.error());
    }
  })());
});
