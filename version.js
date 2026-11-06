// Single source of truth for the Beam version and the list of shipped files.
// Bump BEAM_VERSION on every release (and add a CHANGELOG.md entry): the header shows it, the service
// worker keys its cache to it, and the update check compares it. Add any new file to BEAM_FILES.
self.BEAM_VERSION = '3.0.0';
self.BEAM_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'version.js', 'opfs-worker.js', 'manifest.webmanifest',
  'vendor/peerjs.min.js', 'vendor/qrcode.js', 'vendor/jsqr.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
