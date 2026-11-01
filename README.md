# Beam

Send your iPhone clipboard, text, photos and files to a Windows PC (or any desktop browser) and back, with **nothing to install on either device**. One page, peer-to-peer, encrypted.

## Quick start
1. Open the hosted page on your PC. It shows a QR code.
2. Scan it with the iPhone Camera and tap the banner. Click **Allow** on the PC.
3. Done. After the first pairing, open the page on both devices and they reconnect automatically.

No camera handy? Use **Copy pairing link** or **Share link** on the PC and open the link on the iPhone (AirDrop or Messages work well).

## Features
- **Clipboard:** **Send clipboard** pushes text or a copied image. Incoming text is auto-copied on the receiving device (can be turned off). Links get an **Open** button.
- **Text box:** type or paste, then send with the button or Ctrl/⌘+Enter. Very long text (over ~400,000 characters) is sent as a `.txt` file.
- **Files:** any type, several at once. On iPhone, pick from Files (including Downloads), Photos or Camera. On desktop, drag and drop onto the page, or press Ctrl/⌘+V anywhere to send the clipboard (files included).
- **Receiving files:** desktop auto-saves to Downloads (can be turned off); iPhone gets a **Save / Share** button for Files or Photos. Images show a preview.
- **Both directions:** the PC can send to the iPhone just as easily.
- **Live status:** progress and speed per file, plus "Delivered ✓" confirmation.

## Hosting
Beam needs HTTPS (clipboard access and secure connections require it). With GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**. The page is then served at `https://<your-username>.github.io/Beam/`.

## Reliability
- Auto-reconnect after sleep, Wi-Fi changes and tab switches; heartbeat detects dead links.
- Screen wake lock during transfers; interrupted transfers are marked failed instead of hanging.
- Files stream in 64 KB chunks with backpressure, so large files do not exhaust phone memory.
- Duplicate tabs and stale sessions are taken over cleanly.

## Security
- Data travels over an encrypted WebRTC channel directly between your two devices. File contents never touch a server.
- Pairing uses a random 128-bit code. New devices must be approved on the PC. **Reset pairing** revokes everything.
- File names are sanitized, received text is never rendered as HTML, and executable file types are never auto-saved.
- The public PeerJS broker is used only for the first handshake. To avoid third parties entirely, self-host a PeerJS server and set `PEER_OPTS` in `index.html`.

## Limits
- iOS shows a "Paste" bubble whenever a web page reads the clipboard. Apple does not allow removing it. Receiving text on iPhone also needs a tap on **Copy**.
- iOS Safari cannot add web apps to the Share Sheet, and nothing syncs while the page is closed. Both devices need Beam open.
- Receive size caps: 500 MB on iPhone, 2 GB on desktop.
- No folder sync or continuous mirroring. Sends are manual.
- Strict corporate or guest networks may block direct connections. Add a TURN server to the `ICE` list in `index.html`.
- Needs internet for the first connection.

## Files
- `index.html`: the entire app (HTML, CSS and JavaScript in one file).
