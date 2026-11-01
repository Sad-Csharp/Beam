# Beam

**Beam** sends your iPhone clipboard, text, photos and files to a Windows PC (or any desktop browser) and back, with **nothing to install on either device**. One page, peer-to-peer, encrypted.

## Use it
1. Open the hosted page on your PC (see *Hosting* below). It shows a QR code.
2. Scan it with the iPhone Camera and tap the banner. Click **Allow** on the PC.
3. Done. After the first pairing, just open the page on both devices and they reconnect automatically.

**Send clipboard** pushes whatever you copied. **Send files** picks from Files, Photos or Camera. On the PC you can drag and drop, or press Ctrl+V anywhere on the page.

## Hosting
Needs HTTPS. Enable GitHub Pages: *Settings -> Pages -> Deploy from branch -> main / root*. Your page will be at `https://<user>.github.io/EzSync/`.

## How it works
- WebRTC data channel between the two browsers; file contents never touch a server.
- PeerJS public broker is used only for the first handshake. Self-host one via `PEER_OPTS` in `index.html`.
- Pairing uses a random 128-bit code; new devices must be approved on the PC; *Reset pairing* revokes everything.
- Files stream in 64 KB chunks with backpressure; auto-reconnect, heartbeat, wake lock.

## Limits
- iOS shows a "Paste" bubble whenever a web page reads the clipboard; Apple does not allow removing it.
- iOS Safari cannot add web apps to the Share Sheet.
- Strict networks may need a TURN server (`ICE` list in `index.html`).
- Receive caps: 500 MB on iOS, 2 GB on desktop.
