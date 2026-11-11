# Changelog

All notable changes to Beam are listed here, newest first. Beam uses [semantic versioning](https://semver.org):
MAJOR for breaking changes, MINOR for new features, PATCH for fixes and cosmetic tweaks. Versions only go up and are
never reused; a revert ships as a new patch. Entries before 3.0.0 were written afterwards from the commit history.

## [3.1.0]

### Added
- Short grace period when you switch tabs or apps: the pairing is kept for up to 2 minutes (`awayWindowMs` in `config.js`) and the other device shows "· away". Coming back resumes instantly.

### Changed
- Closing or reloading a page no longer ends the pairing instantly; it ends after the grace period (reload reconnects by itself). **Disconnect** still ends it immediately.
- A backgrounded device is no longer declared dead by the connection check while it is away.

### Fixed
- Switching tabs on iPhone Safari reset the connection immediately and required a new QR scan.

## [3.0.0] - 2026-11-05
### Changed
- **Breaking:** pairing is now session-only. Nothing about it is saved to disk. Closing the page on either device, tapping Disconnect, or losing the connection for longer than the reconnect window (60 seconds by default) ends the pairing, and connecting again needs a fresh QR scan. Devices paired with earlier versions must be paired again.
- The computer's pairing address is new every time Beam opens, so old QR codes and links are dead.
- The phone keeps its pairing link in session storage only (cleared when the tab or app closes).
- "Reset pairing" now ends the current session instead of wiping saved data.
### Added
- **Disconnect** button (shown while connected). Both sides forget each other immediately.
- Closing or reloading the page notifies the other device, which then ends the pairing right away.
- Brief drops (for example switching apps for a moment) still reconnect by themselves inside the reconnect window; `reconnectWindowMs` in `config.js` sets its length.
### Removed
- Saved paired-device list (the "Paired devices" list now shows the current session only).
- Pairing data stored by earlier versions is deleted from the device the first time 3.0.0 opens.

## [2.2.1] - 2026-11-04
### Fixed
- Tapping the version to update sometimes just refreshed the page. The update now refreshes the browser cache, waits for the new version to install, then reloads, and confirms with "Updated to vX".
- The service worker always revalidates files with the server, and tolerates a stale version file during an upgrade.

## [2.2.0] - 2026-11-04
### Added
- Every item shows which device sent it and where it went (for example "Sent · iPhone → Windows PC"), in the list and in history.
- A ✕ on every item removes it (and cancels a transfer in progress, freeing the stored file); "Clear list" removes everything.
### Changed
- Auto-copy incoming text, auto-save incoming files, and text history are all off by default.

## [2.1.1] - 2026-11-04
### Changed
- The version tag moved next to the Beam title in the header and is smaller.

## [2.1.0] - 2026-11-04
### Added
- Incoming files stream to private storage instead of memory, so the limit is free space rather than RAM; sender flow control; free-space check; "Clear received files".
- Version shown in the app, with tap-to-check for updates.

## [2.0.0] - 2026-11-04
### Added
- Installable app (PWA) with offline support, one-time expiring pairing codes with a matching verification code, paired-devices list with Revoke, in-app QR scanner, TURN relay support (including an optional Cloudflare Worker), Direct/Relay indicator, and clipboard history with search and pin.
### Changed
- Split the single file into `index.html`, `style.css` and `app.js`; libraries are bundled locally; strict Content Security Policy.
- **Breaking:** pairing links from 1.0.0 no longer work (they now include a one-time token).

## [1.0.0] - 2026-11-01
### Added
- First release: install-free iPhone to desktop clipboard, text and file transfer over an encrypted peer-to-peer connection, QR pairing with device approval, automatic reconnect, and drag-and-drop.
