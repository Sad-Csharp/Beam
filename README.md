# Beam

Send your iPhone clipboard, text, photos and files to a Windows PC (or any desktop browser) and back, with **nothing to install on either device**. Peer-to-peer and end-to-end encrypted.

## Quick start
1. Open Beam on your PC. It shows a QR code and a 4-digit verification code.
2. Scan the QR with the iPhone Camera and tap the banner. The iPhone shows the same 4-digit code.
3. On the PC, check the codes match and click **Allow**.

**Pairing lasts only for the current session.** Closing the page on either device, tapping **Disconnect**, or losing the connection for more than a minute ends it, and the next connection needs a fresh QR scan. Brief drops (like switching apps for a moment) reconnect by themselves.

### Add it to your Home Screen (recommended)
In Safari tap **Share → Add to Home Screen**. Beam then opens full-screen like an app and loads instantly, even offline.

> Pairing belongs to whichever one you pair in: Safari and the Home Screen app keep separate sessions. Open the Home Screen app and tap **Scan QR code** to pair it directly, no Safari needed.

No camera handy? Use **Copy pairing link** on the PC and paste it into **Have a pairing link?** on the iPhone (AirDrop or Messages work well).

## Features
- **Clipboard:** **Send clipboard** pushes text or a copied image. Optionally auto-copy incoming text (off by default). Links get an **Open** button.
- **Text box:** type or paste, then send with the button or Ctrl/⌘+Enter. Very long text (over ~400,000 characters) is sent as a `.txt` file.
- **Files:** any type, several at once. On iPhone pick from Files (including Downloads), Photos or Camera. On desktop drag and drop, or press Ctrl/⌘+V anywhere to send the clipboard.
- **Receiving files:** desktop can auto-save to Downloads (off by default). iPhone gets **Save / Share** for Files or Photos. Images show a preview.
- **Huge files:** incoming files stream straight to the device's private storage (not memory), so the limit is free space, not RAM. Tested with a 200 MB transfer using about 3 MB of memory on the receiver. A built-in flow control keeps the sender from outrunning the receiver's disk.
- **Both directions**, with progress, speed and "Delivered ✓" confirmation. Every item shows which device sent it and where it went (for example `Sent · iPhone → Windows PC`).
- **Remove anything:** every item in the list has a ✕ (it also cancels a transfer in progress and frees the stored file), and **Clear list** removes everything.
- **Everything is opt-in:** *Auto-copy incoming text*, *Auto-save incoming files* and *Save text history* are all off by default.
- **Clipboard history:** the last 20 text items you sent or received, with search, **Pin**, **Send again**, **Delete** and **Clear**. Off by default; turn it on with *Save text history on this device*. Stored only on that device.
- **Connection indicator:** shows **Direct** (device to device) or **Relay** (through a TURN server).
- **Version display:** the header shows the running version (small, next to the title, for example `v2.1.1`). Tap it to check for a newer release; if one is live it shows `v2.2.1 → v2.2.2`, and one tap updates (it refreshes the browser cache and installs the new version before reloading, then confirms with "Updated to v…").
- **Installable app (PWA):** Home Screen icon, offline app shell, automatic updates that remove the old cached version.

## Settings
The three toggles are saved **per device and per browser** (in that browser's local storage). They do not sync between your phone and PC, and Safari and the Home Screen app each keep their own. Resetting pairing does not change them.

## Security
- Data travels over an encrypted WebRTC channel directly between your two devices. File contents never touch a server.
- **One-time pairing codes:** the QR/link works once and expires after 5 minutes. A screenshot of an old code is useless, and repeated bad guesses rotate the code.
- **Verification code:** both screens show the same 4-digit code. Only allow the device if they match.
- **Session-only pairing:** nothing about pairing is saved to disk. The computer's address changes every time Beam opens, so old QR codes are dead. **Disconnect**, closing the page or a long outage ends it on both sides.
- **Paired devices list** (this session) with a **Revoke** button per device.
- A second device can't hijack an active connection; it is told the computer is busy.
- File names are sanitized, received text is never rendered as HTML, executable file types are never auto-saved, and a strict Content Security Policy blocks injected scripts.
- All libraries are bundled locally (`vendor/`), so Beam does not load third-party scripts.
- The public PeerJS broker is used only for the first handshake (see `peer` in `config.js` to self-host).

## Hosting
Beam needs HTTPS. With GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**. It is then served at `https://<your-username>.github.io/Beam/`.

## Strict networks (TURN relay)
Most networks connect directly. Some corporate or guest Wi-Fi and cellular networks block that, and Beam shows a hint after 20 seconds. Fix it with a TURN relay, still end-to-end encrypted. Edit `config.js`:

- **Own TURN server:** add it to `iceServers` (`{ urls: 'turn:host:3478', username: '…', credential: '…' }`).
- **Cloudflare (free tier):** deploy `turn-worker/worker.js` as a Cloudflare Worker (setup steps are at the top of the file) and put its URL in `turnCredentialsUrl`. Credentials are short-lived and only handed to your site's origin.

## Updating
Push changes to `main` and bump `BEAM_VERSION` in `version.js` (the one place the version lives; it also lists the shipped files, so add any new file to `BEAM_FILES`). GitHub Pages lets browsers cache files for about 10 minutes; Beam's service worker always revalidates, so releases show up on next open. Devices pick up the new version on next open (network first, cache fallback) and the header shows the new number once it is live. The service worker keys its cache to that version, and activation deletes every older Beam cache so nothing stale is left behind.

## Limits
- **File size:** limited by free storage on the receiving device (Beam refuses a file up front if it won't fit). On browsers without disk streaming it falls back to memory with a cap of 500 MB on iPhone and 2 GB on desktop. Sending has no limit.
- **Received files are temporary.** They live in Beam's private storage until you tap **Remove**, tap **Clear received files** in the footer, or reopen Beam (which clears leftovers from earlier sessions). Save them to Files/Downloads first. This avoids leaving junk behind, but a large file that is saved and not removed uses disk space twice until then.
- iOS suspends web pages in the background, so keep Beam on screen during big transfers (it keeps the screen awake). An interrupted transfer fails cleanly and can be resent.
- iOS shows a "Paste" bubble whenever a web page reads the clipboard. Apple does not allow removing it. Receiving text on iPhone also needs a tap on **Copy** unless the page is in the foreground and allowed.
- iOS Safari cannot add web apps to the Share Sheet, and nothing syncs while Beam is closed. Both devices need it open.
- One device is connected to the computer at a time. No folder sync; sends are manual.
- Needs internet for the first connection.

## Files
- `index.html`, `style.css`, `app.js`: the app
- `opfs-worker.js`: background worker that streams incoming files to storage
- `version.js`: the version number (single source of truth)
- `config.js`: your settings (STUN/TURN, signaling server)
- `sw.js`, `manifest.webmanifest`, `icons/`: installable app and offline support
- `vendor/`: bundled libraries (PeerJS, qrcode-generator, jsQR) with licenses in `NOTICE.md`
- `turn-worker/worker.js`: optional Cloudflare Worker for TURN credentials
