'use strict';
/* =====================================================================
   Beam: private, install-free iPhone <-> desktop clipboard and file sync.
   WebRTC data channel (via PeerJS signaling), end-to-end encrypted.
   ===================================================================== */

/* ======================= CONFIG ======================= */
const CFG = Object.assign({ useDefaultStun: true, iceServers: [], turnCredentialsUrl: '', peer: {} }, window.BEAM_CONFIG || {});
const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];
const CH = 64 * 1024;                    // data channel chunk size
const READ = 1024 * 1024;                // disk read size
const HIGH = 1024 * 1024, LOW = 256 * 1024; // backpressure thresholds
const MAX_TEXT = 400000;                 // longer text is sent as a .txt file
const PING_MS = 4000, DEAD_MS = 16000;
const TOKEN_MS = 5 * 60 * 1000;          // pairing QR lifetime
const HINT_MS = 20000;                   // show a "can't connect" hint after this long
const HIST_MAX = 20, HIST_TEXT = 20000;  // clipboard history limits
const PROTO = 2;                         // protocol level: 2 adds sender flow control for big files
const WIN = 32 * 1024 * 1024;            // max unacknowledged bytes in flight per file
const APP_VERSION = self.BEAM_VERSION || 'dev';
const UNSAFE_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|jar|app|dmg|pkg|sh|lnk|hta|reg|apk)$/i;

/* ======================= HELPERS ======================= */
const $ = s => document.querySelector(s);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }
};
const rand = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(36).padStart(2, '0')).join('');
const UA = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android/.test(UA);
const label = /iPhone/.test(UA) ? 'iPhone' : isIOS ? 'iPad' : /Android/.test(UA) ? 'Android' : /Mac/.test(navigator.platform) ? 'Mac' : /Win/.test(navigator.platform) ? 'Windows PC' : 'Computer';
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const cleanName = n => (String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120)) || 'file';
const parse = d => { if (typeof d !== 'string') return null; try { const o = JSON.parse(d); return o && typeof o === 'object' ? o : null; } catch { return null; } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
let timer;
function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }
const timeStr = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
async function codeOf(token) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('beam:' + token)));
  return String(((d[0] << 24 | d[1] << 16 | d[2] << 8 | d[3]) >>> 0) % 10000).padStart(4, '0');
}

/* ======================= STATE ======================= */
let role, hostId, peer, active = null, activeKey = null, pending = null, lastRx = 0, pingIv = null, wake = null;
let denied = false, backoff = 1000, gen = 0, hintT = null, peerName = '', peerProto = 1;
const deviceKey = ls.get('beam.dk') || (() => { const k = rand(16); ls.set('beam.dk', k); return k; })();

// Paired devices: key -> { name, added }. Migrates the old array format.
const trusted = (() => {
  let m = new Map();
  try { m = new Map(Object.entries(JSON.parse(ls.get('beam.trusted2') || '{}') || {})); } catch { /* ignore corrupt data */ }
  try {
    const old = JSON.parse(ls.get('beam.trusted') || '[]');
    if (Array.isArray(old)) for (const k of old) if (typeof k === 'string' && !m.has(k)) m.set(k, { name: 'Paired device', added: 0 });
    ls.del('beam.trusted');
    ls.set('beam.trusted2', JSON.stringify(Object.fromEntries(m)));
  } catch { /* ignore */ }
  return m;
})();
const saveTrusted = () => ls.set('beam.trusted2', JSON.stringify(Object.fromEntries(trusted)));

function setStatus(state, text) {
  document.body.dataset.state = state;
  $('#statusText').textContent = text;
  const on = state === 'connected';
  $('#mainCard').classList.toggle('hide', !on);
  $('#pairCard').classList.toggle('hide', on);
  $('#pairHost').classList.toggle('hide', role !== 'host');
  $('#pairJoin').classList.toggle('hide', role !== 'join');
  $('#pairScan').classList.toggle('hide', role !== 'scan');
  $('#btnHost').classList.toggle('hide', role === 'host');
  $('#btnDevices').classList.toggle('hide', role !== 'host');
  $('#autoSaveWrap').classList.toggle('hide', isIOS);
}

/* ======================= ROLE ======================= */
// Accepts a pairing link/hash and stores it. Returns true if it contained a pairing code.
function acceptLink(text) {
  const p = String(text).match(/[#&?]p=([A-Za-z0-9_-]{16,80})/);
  if (!p) return false;
  const t = String(text).match(/[#&?]t=([A-Za-z0-9]{8,64})/);
  ls.set('beam.join', p[1]);
  if (t) ls.set('beam.tok', t[1]); else ls.del('beam.tok');
  return true;
}
function resolveRole() {
  if (location.hash && acceptLink(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  const j = ls.get('beam.join');
  if (j) { role = 'join'; hostId = j; return; }
  if (isMobile && !ls.get('beam.forcehost')) { role = 'scan'; return; }
  role = 'host';
  hostId = ls.get('beam.host') || (() => { const k = 'bm' + rand(16); ls.set('beam.host', k); return k; })();
}

/* ======================= ICE (STUN / TURN) ======================= */
let iceCache = null;
async function getIce() {
  if (iceCache && Date.now() - iceCache.t < 50 * 60 * 1000) return iceCache.servers;
  const servers = [...(CFG.useDefaultStun ? DEFAULT_STUN : []), ...CFG.iceServers];
  if (CFG.turnCredentialsUrl) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(CFG.turnCredentialsUrl, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      if (r.ok) { const j = await r.json(); const extra = [].concat(j.iceServers || []); servers.push(...extra); }
    } catch { /* TURN is optional; continue with STUN */ }
  }
  iceCache = { t: Date.now(), servers };
  return servers;
}

/* ======================= PEER LIFECYCLE ======================= */
function killPeer() {
  clearTimeout(timer); clearTimeout(hintT);
  try { active && active.close(); } catch { /* already closed */ }
  try { pending && pending.close(); } catch { /* already closed */ }
  active = pending = null; activeKey = null; stopPing();
  try { peer && peer.destroy(); } catch { /* already destroyed */ }
  peer = null;
}
async function start() {
  killPeer(); denied = false;
  const my = ++gen;
  if (role === 'scan') { setStatus('waiting', 'Not paired yet'); return; }
  if (typeof Peer === 'undefined') { setStatus('error', 'Offline'); warn('Couldn’t load the connection library. Reload the page.'); return; }
  setStatus('connecting', 'Starting…');
  const iceServers = await getIce();
  if (my !== gen) return;
  const opts = { ...CFG.peer, config: { iceServers }, debug: 0 };
  peer = role === 'host' ? new Peer(hostId, opts) : new Peer(opts);
  const p = peer;
  p.on('open', () => {
    backoff = 1000;
    if (role === 'host') { setStatus('waiting', active ? 'Connected' : 'Ready — waiting for a device'); renderQR(); } else joinNow();
  });
  p.on('connection', onIncoming);
  p.on('disconnected', () => { if (p.destroyed) return; setTimeout(() => { try { p.reconnect(); } catch { /* retry later */ } }, 800); });
  p.on('error', e => {
    if (p !== peer) return;
    if (e.type === 'peer-unavailable') { if (!active) { setStatus('waiting', 'Waiting for your computer…'); later(joinNow, Math.min(backoff *= 1.5, 6000)); } return; }
    if (e.type === 'unavailable-id') { setStatus('connecting', 'Taking over from an old session…'); later(start, 3000); return; }
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc', 'browser-incompatible'].includes(e.type)) { setStatus('error', 'Reconnecting…'); later(start, Math.min(backoff *= 1.6, 8000)); return; }
    console.warn('peer error', e);
  });
  if (role === 'join') armHint();
}
function armHint() {
  clearTimeout(hintT); hideWarn();
  hintT = setTimeout(() => {
    if (!active && !denied) warn('Still can’t reach your computer. Make sure Beam is open on it. On strict Wi-Fi or some cellular networks a relay (TURN) server may be needed. See the README.');
  }, HINT_MS);
}

/* ---------- joiner ---------- */
async function joinNow() {
  if (role !== 'join' || !peer || peer.destroyed || active || denied) return;
  if (pending) { try { pending.close(); } catch { /* ignore */ } pending = null; }
  setStatus('connecting', 'Connecting…');
  const tok = ls.get('beam.tok') || '';
  if (tok) { $('#joinCode').textContent = await codeOf(tok); $('#joinCodeWrap').classList.remove('hide'); } else $('#joinCodeWrap').classList.add('hide');
  if (role !== 'join' || !peer || active) return;
  const c = peer.connect(hostId, { serialization: 'raw', reliable: true });
  pending = c;
  c.on('open', () => { c.send(JSON.stringify({ t: 'hello', key: deviceKey, name: label, tok, p: PROTO })); });
  c.on('data', d => {
    const m = parse(d);
    if (c !== active) {
      if (m && m.t === 'welcome') {
        active = c; pending = null; peerProto = Number(m.p) || 1; ls.del('beam.tok'); $('#joinCodeWrap').classList.add('hide');
        onConnected(String(m.name || 'Computer').slice(0, 40), c);
      } else if (m && m.t === 'denied') {
        denied = true; clearTimeout(hintT);
        const why = m.reason === 'unpaired' ? 'Scan the QR code on your computer again.' : 'The computer denied this device.';
        setStatus('error', m.reason === 'unpaired' ? 'Pairing expired' : 'Denied by computer');
        warn(why);
      } else if (m && m.t === 'busy') {
        try { c.close(); } catch { /* ignore */ } pending = null;
        setStatus('waiting', 'Computer is busy with another device…'); later(joinNow, 8000);
      }
      return;
    }
    onData(c, d);
  });
  c.on('close', () => onClosed(c)); c.on('error', () => onClosed(c));
  later(() => { if (pending === c && c !== active) { try { c.close(); } catch { /* ignore */ } onClosed(c); } }, 12000);
}

/* ---------- host: pairing token ---------- */
let tok = null, tokExp = 0, tokTimer = null, badTries = 0;
function newToken() {
  tok = rand(8); tokExp = Date.now() + TOKEN_MS; badTries = 0;
  clearTimeout(tokTimer);
  tokTimer = setTimeout(() => { newToken(); renderQR(); }, TOKEN_MS);
}

/* ---------- host: incoming connections ---------- */
function deny(c, reason) {
  try { c.dataChannel.send(JSON.stringify({ t: 'denied', reason })); } catch { /* channel gone */ }
  setTimeout(() => { try { c.close(); } catch { /* ignore */ } }, 400);
}
let approving = false;
// Resolves to null when allowed, or a denial reason string.
async function admit(m) {
  const known = trusted.has(m.key);
  if (!known) {
    if (Date.now() > tokExp || typeof m.tok !== 'string' || m.tok !== tok) {
      if (++badTries >= 5) { newToken(); renderQR(); }
      return 'unpaired';
    }
  }
  if (active && activeKey !== m.key && Date.now() - lastRx < DEAD_MS) return 'busy';
  if (known) { const t = trusted.get(m.key); t.name = String(m.name || t.name || 'Device').slice(0, 40); t.seen = Date.now(); saveTrusted(); return null; }
  if (approving) return 'busy';
  approving = true;
  const dlg = $('#approve');
  const used = tok;
  $('#approveText').textContent = `“${String(m.name || 'A device').slice(0, 40)}” wants to pair with this computer.`;
  $('#approveCode').textContent = await codeOf(used);
  const ok = await new Promise(res => {
    dlg.addEventListener('close', () => res(dlg.returnValue === 'yes'), { once: true });
    dlg.returnValue = 'no';
    try { dlg.showModal(); } catch { res(false); }
  });
  approving = false;
  if (!ok) return 'denied';
  if (used !== tok) return 'unpaired'; // code rotated while the dialog was open
  trusted.set(m.key, { name: String(m.name || 'Device').slice(0, 40), added: Date.now() });
  saveTrusted();
  newToken(); // single use: the QR code that just paired is now dead
  return null;
}
function onIncoming(c) {
  let ok = false, deciding = false;
  const to = setTimeout(() => { if (!ok) try { c.close(); } catch { /* ignore */ } }, 90000);
  c.on('data', async d => {
    if (ok) { if (c === active) onData(c, d); return; }
    if (deciding) return;
    const m = parse(d);
    if (!m || m.t !== 'hello' || !/^[a-z0-9]{8,64}$/.test(String(m.key))) { try { c.close(); } catch { /* ignore */ } return; }
    deciding = true;
    const reason = await admit(m);
    if (reason) { deny(c, reason); return; }
    ok = true; clearTimeout(to);
    if (active && active !== c) { const old = active; active = null; try { old.close(); } catch { /* ignore */ } }
    active = c; activeKey = m.key; peerProto = Number(m.p) || 1;
    try { c.dataChannel.send(JSON.stringify({ t: 'welcome', name: label, p: PROTO })); } catch { /* channel gone */ }
    onConnected(String(m.name || 'Device').slice(0, 40), c);
    renderDevices();
  });
  c.on('close', () => { clearTimeout(to); onClosed(c); });
  c.on('error', () => { clearTimeout(to); onClosed(c); });
}

/* ---------- shared ---------- */
async function connType(c) {
  try {
    const pc = c.peerConnection; if (!pc) return '';
    const stats = await pc.getStats(); const byId = {};
    stats.forEach(r => { byId[r.id] = r; });
    let pair = null;
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId[r.selectedCandidatePairId]; });
    if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r; });
    if (!pair) return '';
    const l = byId[pair.localCandidateId], rm = byId[pair.remoteCandidateId];
    return (l && l.candidateType === 'relay') || (rm && rm.candidateType === 'relay') ? 'Relay' : 'Direct';
  } catch { return ''; }
}
function onConnected(name, c) {
  lastRx = Date.now(); peerName = name; clearTimeout(hintT); hideWarn();
  setStatus('connected', 'Connected to ' + name); startPing(); keepAwake();
  toast('Connected to ' + name);
  const upd = async () => { if (active !== c) return; const t = await connType(c); if (t && active === c) $('#statusText').textContent = `Connected to ${name} · ${t}`; };
  setTimeout(upd, 1500); setTimeout(upd, 8000);
}
function onClosed(c) {
  if (pending === c) pending = null;
  if (c !== active) return;
  active = null; activeKey = null; stopPing(); releaseWake();
  failTransfers('Connection lost');
  renderDevices();
  if (role === 'host') { setStatus('waiting', 'Ready — waiting for a device'); renderQR(); }
  else { setStatus('connecting', 'Reconnecting…'); later(joinNow, 800); armHint(); }
}
function startPing() {
  stopPing();
  pingIv = setInterval(() => {
    if (!active) return;
    if (Date.now() - lastRx > DEAD_MS) { const c = active; try { c.close(); } catch { /* ignore */ } onClosed(c); return; }
    tx({ t: 'ping' });
  }, PING_MS);
}
function stopPing() { clearInterval(pingIv); pingIv = null; }
async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ } }
function releaseWake() { try { wake && wake.release(); } catch { /* ignore */ } wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (active) { keepAwake(); tx({ t: 'ping' }); }
  else if (role === 'join' && !denied) { if (!peer || peer.destroyed || peer.disconnected) start(); else joinNow(); }
});
addEventListener('online', () => { if (!active && !denied && role !== 'scan') start(); });
addEventListener('pageshow', e => { if (e.persisted && !active && role !== 'scan') start(); });

/* ======================= TRANSPORT ======================= */
function tx(obj) { try { if (active && active.dataChannel.readyState === 'open') { active.dataChannel.send(JSON.stringify(obj)); return true; } } catch { /* channel gone */ } return false; }
function drain(dc) {
  if (dc.bufferedAmount <= HIGH) return null;
  return new Promise(res => {
    dc.bufferedAmountLowThreshold = LOW;
    const done = () => { dc.removeEventListener('bufferedamountlow', done); clearInterval(iv); res(); };
    const iv = setInterval(() => { if (dc.readyState !== 'open' || dc.bufferedAmount <= LOW) done(); }, 250);
    dc.addEventListener('bufferedamountlow', done);
  });
}

/* ======================= CLIPBOARD HISTORY ======================= */
let hist = (() => { try { const a = JSON.parse(ls.get('beam.hist') || '[]'); return Array.isArray(a) ? a.filter(h => h && typeof h.text === 'string') : []; } catch { return []; } })();
const histEnabled = () => $('#histOn').checked;
const saveHist = () => ls.set('beam.hist', JSON.stringify(hist));
function histAdd(dir, text) {
  if (!histEnabled() || !text.trim()) return;
  text = text.slice(0, HIST_TEXT);
  const i = hist.findIndex(h => h.text === text);
  const prev = i >= 0 ? hist.splice(i, 1)[0] : null;
  hist.unshift({ id: rand(4), text, dir, ts: Date.now(), pin: prev ? !!prev.pin : false });
  let unpinned = 0;
  hist = hist.filter(h => h.pin || ++unpinned <= HIST_MAX);
  saveHist(); renderHist();
}
function renderHist() {
  const q = $('#histSearch').value.trim().toLowerCase();
  const list = $('#histList'); list.replaceChildren();
  const items = hist.filter(h => !q || h.text.toLowerCase().includes(q)).sort((a, b) => (b.pin - a.pin) || (b.ts - a.ts));
  $('#histSummary').textContent = `Clipboard history${hist.length ? ' (' + hist.length + ')' : ''}`;
  if (!items.length) { list.append(el('div', 'mute', hist.length ? 'No matches.' : 'Nothing yet. Items you send or receive show up here.')); return; }
  for (const h of items) {
    const row = el('div', 'hitem' + (h.pin ? ' pinned' : ''));
    row.append(el('div', 'htxt', h.text.length > 600 ? h.text.slice(0, 600) + '…' : h.text));
    row.append(el('div', 'meta', `${h.dir === 'out' ? 'Sent' : 'Received'} · ${new Date(h.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr(h.ts)}`));
    const acts = el('div', 'acts');
    const copy = el('button', 'sec sm', 'Copy'); copy.onclick = async () => { try { await navigator.clipboard.writeText(h.text); toast('Copied'); } catch { toast('Copy blocked'); } };
    const send = el('button', 'sec sm', 'Send again'); send.onclick = () => sendText(h.text);
    const pin = el('button', 'sec sm', h.pin ? 'Unpin' : 'Pin'); pin.onclick = () => { h.pin = !h.pin; saveHist(); renderHist(); };
    const del = el('button', 'sec sm', 'Delete'); del.onclick = () => { hist = hist.filter(x => x.id !== h.id); saveHist(); renderHist(); };
    acts.append(copy, send, pin, del); row.append(acts); list.append(row);
  }
}

/* ======================= FEED UI ======================= */
function addItem(dir) {
  const it = el('div', 'item'); const meta = el('div', 'meta');
  const l = el('span', null, (dir === 'out' ? 'Sent' : 'Received') + ' · ' + timeStr(Date.now()));
  const st = el('span', null, ''); meta.append(l, st); it.append(meta); $('#feed').prepend(it);
  while ($('#feed').children.length > 60) { const old = $('#feed').lastChild; if (old.__cleanup) old.__cleanup(); old.remove(); }
  return { it, st, set(t) { st.textContent = t; } };
}
function showText(dir, text) {
  const x = addItem(dir); const body = el('div', 'body', text.length > 3000 ? text.slice(0, 3000) + '…' : text); const acts = el('div', 'acts');
  const b = el('button', 'sec sm', 'Copy'); b.onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy blocked — long-press the text'); } }; acts.append(b);
  if (/^https?:\/\/\S+$/i.test(text.trim())) { const a = el('a', 'btn sec sm', 'Open'); a.href = text.trim(); a.target = '_blank'; a.rel = 'noopener noreferrer'; acts.append(a); }
  x.it.append(body, acts); return x;
}

/* ======================= SEND ======================= */
const outText = new Map(), outFiles = new Map();
function sendText(text) {
  if (!active) return toast('Not connected yet');
  text = String(text); if (!text) return toast('Nothing to send');
  if (text.length > MAX_TEXT) return sendFiles([new File([text], 'text.txt', { type: 'text/plain' })]);
  const id = rand(6); const x = showText('out', text); x.set('Sending…'); x.pending = true; outText.set(id, x);
  if (!tx({ t: 'text', id, text })) { x.set('Failed'); x.it.classList.add('err'); outText.delete(id); return; }
  histAdd('out', text);
}
async function sendClipboard() {
  if (!active) return toast('Not connected yet');
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); if (t) return sendText(t); }
      for (const it of items) { const ty = it.types.find(x => x.startsWith('image/')); if (ty) { const b = await it.getType(ty); return sendFiles([new File([b], 'clipboard.' + (ty.split('/')[1] || 'png').replace(/\+.*/, ''), { type: ty })]); } }
      return toast('Clipboard is empty');
    }
    const t = await navigator.clipboard.readText(); if (t) return sendText(t); toast('Clipboard is empty');
  } catch {
    try { const t = await navigator.clipboard.readText(); if (t) return sendText(t); } catch { /* fall through */ }
    toast('Paste into the box, then tap Send'); $('#txt').focus();
  }
}
const queue = []; let sending = false; const aborted = new Set(); let curSend = null;
function sendFiles(list) {
  if (!active) return toast('Not connected yet');
  for (const f of list) if (f && typeof f.size === 'number') queue.push(f);
  pump();
}
async function pump() {
  if (sending) return; sending = true;
  while (queue.length && active) await sendOne(queue.shift());
  if (!active) queue.length = 0;
  sending = false;
}
async function sendOne(f) {
  const id = rand(6), name = cleanName(f.name), x = addItem('out'); const bar = el('div', 'bar'); const fill = el('i'); bar.append(fill);
  x.it.append(el('div', 'name', name), el('div', 'mute', fmt(f.size)), bar);
  const cs = { id, x, sent: 0, acked: 0, wake: null };
  curSend = cs;
  x.set('Sending…');
  const dc = active.dataChannel; const t0 = Date.now(); let off = 0;
  const windowed = peerProto >= 2; // receiver reports progress, so we never outrun its disk
  try {
    if (!tx({ t: 'file', id, name, size: f.size, mime: f.type || '' })) throw new Error('closed');
    while (off < f.size) {
      const buf = await f.slice(off, off + READ).arrayBuffer();
      for (let o = 0; o < buf.byteLength; o += CH) {
        if (aborted.has(id)) throw new Error('rejected');
        if (!active || dc.readyState !== 'open') throw new Error('Connection lost');
        const w = drain(dc); if (w) await w;
        while (windowed && cs.sent - cs.acked > WIN && active && !aborted.has(id)) await new Promise(r => { cs.wake = r; setTimeout(r, 500); });
        if (aborted.has(id)) throw new Error('rejected');
        const len = Math.min(CH, buf.byteLength - o);
        dc.send(new Uint8Array(buf, o, len)); cs.sent += len;
      }
      off += buf.byteLength; fill.style.width = (off / f.size * 100) + '%';
      x.set(`${Math.round(off / f.size * 100)}% · ${fmt(off / Math.max(.2, (Date.now() - t0) / 1000))}/s`);
    }
    if (f.size === 0) fill.style.width = '100%';
    tx({ t: 'end', id }); x.set('Finishing…'); x.pending = true;
    outFiles.set(id, x);
  } catch {
    x.it.classList.add('err'); x.set(aborted.has(id) ? 'Rejected by receiver' : 'Failed'); aborted.delete(id);
  }
  curSend = null;
}
function failTransfers(why) {
  if (curSend) { curSend.x.it.classList.add('err'); curSend.x.set(why); }
  for (const x of outFiles.values()) if (x.pending) { x.it.classList.add('err'); x.set(why); }
  outFiles.clear();
  for (const x of outText.values()) if (x.pending) x.set('Not confirmed');
  outText.clear();
  if (inc) { inc.x.it.classList.add('err'); inc.x.set(why); if (inc.disk) removeTemp(inc.id); inc = null; }
}

/* ======================= DISK-BACKED RECEIVE (OPFS worker) ======================= */
// Incoming files stream to the browser's private storage, so the size limit is free space, not memory.
// If the browser can't do that, we fall back to in-memory buffering with a conservative cap.
const rx = { w: null, ok: false, calls: new Map(), n: 0, avail: 0, temp: 0 };
const memCap = () => isIOS ? 500e6 : 2e9;
const maxRx = () => rx.ok ? Math.max(0, rx.avail - 64e6) : memCap();
function wcall(msg, transfer) {
  return new Promise((res, rej) => {
    const rid = ++rx.n; rx.calls.set(rid, { res, rej });
    rx.w.postMessage({ ...msg, rid }, transfer || []);
    setTimeout(() => { if (rx.calls.delete(rid)) rej(new Error('timeout')); }, 60000);
  });
}
async function refreshQuota() {
  try { const e = await navigator.storage.estimate(); rx.avail = Math.max(0, (e.quota || 0) - (e.usage || 0)) || 4e9; } catch { rx.avail = 4e9; }
}
function removeTemp(id) { if (rx.ok) wcall({ op: 'remove', id }).catch(() => { /* already gone */ }); }
async function refreshTemp() {
  if (!rx.ok) return;
  try { rx.temp = (await wcall({ op: 'usage' })).bytes; } catch { return; }
  const b = $('#btnTemp'); b.textContent = `Clear received files (${fmt(rx.temp)})`; b.classList.toggle('hide', rx.temp < 1);
}
function initDisk() {
  if (!window.Worker || !navigator.storage || !navigator.storage.getDirectory) return;
  try { rx.w = new Worker('opfs-worker.js'); } catch { return; }
  rx.w.onerror = () => { rx.ok = false; };
  rx.w.onmessage = e => {
    const m = e.data;
    if (m.rid && rx.calls.has(m.rid)) { const c = rx.calls.get(m.rid); rx.calls.delete(m.rid); if (m.error) c.rej(new Error(m.error)); else c.res(m); return; }
    if (m.op === 'wrote' && inc && inc.id === m.id && peerProto >= 2) tx({ t: 'prog', id: m.id, got: m.total });
    else if (m.op === 'error' && inc && inc.id === m.id) { tx({ t: 'rej', id: inc.id, reason: 'Could not write to storage' }); inc.x.it.classList.add('err'); inc.x.set('Storage error: ' + String(m.error).slice(0, 60)); inc = null; }
  };
  wcall({ op: 'probe' })
    .then(() => wcall({ op: 'wipe' }))   // clear anything left by a previous session
    .then(() => { rx.ok = true; return refreshQuota(); })
    .then(refreshTemp)
    .catch(() => { rx.ok = false; });
}
$('#btnTemp').onclick = async () => {
  if (!rx.ok) return;
  if (!confirm('Delete all received files stored by Beam? Files you already saved elsewhere are not affected.')) return;
  try { await wcall({ op: 'wipe', keep: inc ? inc.id : '' }); for (const it of document.querySelectorAll('#feed .item')) { if (it.__cleanup) { it.__cleanup = null; it.querySelector('.acts')?.remove(); it.classList.add('err'); } } } catch { /* ignore */ }
  refreshQuota(); refreshTemp(); toast('Cleared');
};

/* ======================= RECEIVE ======================= */
let inc = null;
function onData(c, d) {
  lastRx = Date.now();
  if (typeof d !== 'string') { // binary chunk
    if (!inc) return;
    const buf = d instanceof ArrayBuffer ? d : ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : null;
    if (!buf) return;
    inc.got += buf.byteLength;
    if (inc.got > inc.size) { rejectIncoming('Too much data'); return; }
    if (inc.disk) rx.w.postMessage({ op: 'write', id: inc.id, buf }, [buf]);
    else {
      inc.chunks.push(buf);
      if (peerProto >= 2 && inc.got - inc.acked >= 4 * 1024 * 1024) { inc.acked = inc.got; tx({ t: 'prog', id: inc.id, got: inc.got }); }
    }
    const n = Date.now();
    if (n - inc.last > 120) {
      inc.last = n; inc.fill.style.width = (inc.got / Math.max(1, inc.size) * 100) + '%';
      inc.x.set(`${Math.round(inc.got / Math.max(1, inc.size) * 100)}% · ${fmt(inc.got / Math.max(.2, (n - inc.t0) / 1000))}/s`);
    }
    return;
  }
  const m = parse(d); if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'ping': tx({ t: 'pong' }); break;
    case 'pong': break;
    case 'text': {
      if (typeof m.text !== 'string' || m.text.length > MAX_TEXT * 2) return;
      const x = showText('in', m.text); x.set('');
      histAdd('in', m.text);
      if ($('#autoCopy').checked) navigator.clipboard.writeText(m.text).then(() => { x.set('Copied ✓'); toast('Copied to clipboard'); }).catch(() => { toast('Text received — tap Copy'); });
      else toast('Text received');
      tx({ t: 'ack', id: m.id }); break;
    }
    case 'ack': { const x = outText.get(m.id); if (x) { x.pending = false; x.set('Delivered ✓'); outText.delete(m.id); } break; }
    case 'file': {
      if (inc) rejectIncoming('Superseded');
      const size = Number(m.size);
      if (!Number.isFinite(size) || size < 0 || typeof m.id !== 'string' || !/^[a-z0-9]{4,32}$/.test(m.id)) return;
      const cap = maxRx();
      if (size > cap) {
        const why = rx.ok ? 'Not enough free space on this device (' + fmt(cap) + ' available)' : 'Too large for this browser (' + fmt(cap) + ' max)';
        tx({ t: 'rej', id: m.id, reason: why }); toast(why); return;
      }
      const x = addItem('in'), bar = el('div', 'bar'), fill = el('i'); bar.append(fill);
      const name = cleanName(m.name); x.it.append(el('div', 'name', name), el('div', 'mute', fmt(size)), bar);
      const disk = rx.ok && size > 0;
      inc = { id: m.id, name, size, mime: String(m.mime || '').slice(0, 100), chunks: [], got: 0, acked: 0, disk, x, fill, bar, t0: Date.now(), last: 0 };
      if (disk) rx.w.postMessage({ op: 'open', id: m.id, name });
      x.set('Receiving…');
      break;
    }
    case 'end': {
      if (!inc || inc.id !== m.id) return;
      const f = inc; inc = null;
      finishIncoming(f);
      break;
    }
    case 'prog': { if (curSend && curSend.id === m.id) { curSend.acked = Number(m.got) || 0; if (curSend.wake) curSend.wake(); } break; }
    case 'done': { const x = outFiles.get(m.id); if (x) { x.pending = false; x.set(m.ok ? 'Delivered ✓' : 'Failed'); if (!m.ok) x.it.classList.add('err'); outFiles.delete(m.id); } break; }
    case 'rej': { aborted.add(m.id); toast(String(m.reason || 'Rejected').slice(0, 80)); break; }
  }
}
function rejectIncoming(r) {
  if (!inc) return;
  tx({ t: 'rej', id: inc.id, reason: r }); inc.x.it.classList.add('err'); inc.x.set(r);
  if (inc.disk) removeTemp(inc.id);
  inc = null;
}
async function finishIncoming(f) {
  const fail = (why) => { f.x.it.classList.add('err'); f.x.set(why); tx({ t: 'done', id: f.id, ok: false }); if (f.disk) removeTemp(f.id); };
  if (f.got !== f.size) return fail('Incomplete');
  let blob;
  if (f.disk) {
    try {
      const r = await wcall({ op: 'close', id: f.id });
      if (r.size !== f.size) return fail('Incomplete');
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('beam-rx')).getDirectoryHandle(f.id);
      let fh; try { fh = await dir.getFileHandle(f.name); } catch { fh = await dir.getFileHandle('file'); }
      blob = (await fh.getFile()).slice(0, f.size, f.mime || 'application/octet-stream'); // disk-backed, not loaded into memory
    } catch (e) { return fail('Could not save: ' + String((e && e.message) || e).slice(0, 60)); }
  } else {
    blob = new Blob(f.chunks, { type: f.mime || 'application/octet-stream' }); f.chunks = null;
  }
  f.fill.style.width = '100%'; f.x.set('Received ✓'); finishFile(f, blob); tx({ t: 'done', id: f.id, ok: true });
  refreshQuota(); refreshTemp();
}
function finishFile(f, blob) {
  const url = URL.createObjectURL(blob), acts = el('div', 'acts');
  const save = () => { const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.append(a); a.click(); a.remove(); };
  const b = el('button', 'sm', isIOS ? 'Save / Share' : 'Save'); acts.append(b);
  b.onclick = async () => {
    if (isIOS && navigator.canShare) {
      try {
        const file = new File([blob], f.name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    save();
  };
  const rm = el('button', 'sec sm', 'Remove');
  const cleanup = () => { URL.revokeObjectURL(url); if (f.disk) removeTemp(f.id); };
  rm.onclick = () => { cleanup(); f.x.it.classList.add('err'); f.x.set('Removed'); acts.remove(); f.x.it.querySelector('img')?.remove(); refreshTemp(); };
  acts.append(rm);
  f.x.it.__cleanup = cleanup;
  if (blob.type.startsWith('image/') && f.size < 25e6) { const im = el('img'); im.src = url; im.alt = f.name; im.style.cssText = 'max-width:100%;max-height:220px;border-radius:10px;align-self:flex-start'; f.x.it.append(im); }
  f.x.it.append(acts);
  if (!isIOS && $('#autoSave').checked && !UNSAFE_EXT.test(f.name)) save();
  else if (!isIOS && UNSAFE_EXT.test(f.name)) toast('Executable file — not auto-saved');
  else toast('File received — tap ' + (isIOS ? 'Save / Share' : 'Save'));
}

/* ======================= PAIRING UI ======================= */
const pairUrl = () => location.origin + location.pathname + '#p=' + hostId + '&t=' + tok;
async function renderQR() {
  if (role !== 'host') return;
  if (!tok || Date.now() > tokExp) newToken();
  try {
    if (typeof qrcode === 'undefined') throw new Error('no qr lib');
    const q = qrcode(0, 'M'); q.addData(pairUrl()); q.make();
    $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { $('#qr').textContent = 'QR unavailable — use “Copy pairing link”'; }
  $('#verify').textContent = await codeOf(tok);
}
function warn(msg) { const w = $('#warn'); w.textContent = msg; w.classList.remove('hide'); }
function hideWarn() { $('#warn').classList.add('hide'); }

function renderDevices() {
  const box = $('#devList'); box.replaceChildren();
  if (!trusted.size) { box.append(el('div', 'mute', 'No devices paired yet.')); return; }
  for (const [key, t] of trusted) {
    const row = el('div', 'dev'); const info = el('div');
    info.append(el('div', null, t.name || 'Device'));
    const live = activeKey === key;
    info.append(el('div', 'mute', live ? 'Connected now' : t.added ? 'Paired ' + new Date(t.added).toLocaleDateString() : 'Paired earlier'));
    const b = el('button', 'sm danger', 'Revoke');
    b.onclick = () => {
      if (!confirm(`Revoke "${t.name || 'this device'}"? It will need to scan a new QR code to pair again.`)) return;
      trusted.delete(key); saveTrusted();
      if (activeKey === key && active) { const c = active; try { c.close(); } catch { /* ignore */ } onClosed(c); }
      renderDevices(); toast('Device revoked');
    };
    row.append(info, b); box.append(row);
  }
}

/* ---------- QR scanner (for the phone, works inside the installed app too) ---------- */
let scanStream = null, scanT = 0;
function closeScanner() {
  clearTimeout(scanT); scanT = 0;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const v = $('#scanVideo'); v.srcObject = null;
  try { $('#scanDlg').close(); } catch { /* not open */ }
}
async function openScanner() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof jsQR === 'undefined') { toast('Camera scanning isn’t available — paste the pairing link instead'); return; }
  try { $('#scanDlg').showModal(); } catch { /* already open */ }
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
  catch { closeScanner(); toast('Camera blocked — allow it, or paste the pairing link'); return; }
  const v = $('#scanVideo'); v.srcObject = scanStream;
  try { await v.play(); } catch { /* autoplay quirks */ }
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!scanStream) return;
    if (v.readyState >= 2 && v.videoWidth) {
      const w = Math.min(640, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
      cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
      const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (r && acceptLink(r.data)) { closeScanner(); resolveRole(); start(); toast('Pairing…'); return; }
    }
    scanT = setTimeout(tick, 120);
  };
  tick();
}

$('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(pairUrl()); toast('Link copied — send it to your iPhone'); } catch { prompt('Copy this link:', pairUrl()); } };
$('#shareLink').onclick = async () => { try { if (navigator.share) await navigator.share({ url: pairUrl() }); else $('#copyLink').click(); } catch { /* cancelled */ } };
$('#useLink').onclick = () => {
  if (!acceptLink($('#pasteLink').value)) return toast('That doesn’t look like a pairing link');
  $('#pasteLink').value = ''; resolveRole(); start();
};
$('#btnScan').onclick = openScanner;
$('#scanClose').onclick = closeScanner;
$('#scanDlg').addEventListener('close', closeScanner);
$('#btnHost').onclick = () => { ls.del('beam.join'); ls.del('beam.tok'); ls.set('beam.forcehost', '1'); resolveRole(); start(); };
$('#btnDevices').onclick = () => { renderDevices(); try { $('#devDlg').showModal(); } catch { /* ignore */ } };
$('#devClose').onclick = () => $('#devDlg').close();
$('#btnReset').onclick = () => {
  if (!confirm('Reset pairing? All devices will need to pair again.')) return;
  ls.del('beam.join'); ls.del('beam.tok'); ls.del('beam.host'); ls.del('beam.forcehost'); trusted.clear(); saveTrusted();
  resolveRole(); start(); toast('Pairing reset');
};

/* ======================= INPUT WIRING ======================= */
$('#btnClip').onclick = sendClipboard;
$('#btnFiles').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { sendFiles([...e.target.files]); e.target.value = ''; };
$('#sendTxt').onclick = () => { const t = $('#txt').value; if (!t.trim()) return; sendText(t); $('#txt').value = ''; };
$('#txt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#sendTxt').click(); } });
for (const k of ['autoCopy', 'autoSave', 'histOn']) { const c = $('#' + k), v = ls.get('beam.' + k); if (v !== null) c.checked = v === '1'; c.onchange = () => ls.set('beam.' + k, c.checked ? '1' : '0'); }
$('#histSearch').addEventListener('input', renderHist);
$('#histClear').onclick = () => { if (!confirm('Clear clipboard history? Pinned items are kept.')) return; hist = hist.filter(h => h.pin); saveHist(); renderHist(); };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(n => addEventListener(n, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
['dragleave', 'drop'].forEach(n => addEventListener(n, e => { if (n === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files].filter(f => f.size > 0 || f.type)); });
addEventListener('paste', e => {
  if (!active || ['TEXTAREA', 'INPUT'].includes(document.activeElement && document.activeElement.tagName)) return;
  const cd = e.clipboardData; if (!cd) return;
  if (cd.files && cd.files.length) { e.preventDefault(); sendFiles([...cd.files]); }
  else { const t = cd.getData('text'); if (t) { e.preventDefault(); sendText(t); } }
});
addEventListener('beforeunload', e => { if (sending || inc) { e.preventDefault(); e.returnValue = ''; } });

// A pairing link opened in a tab that is already running Beam only changes the hash.
addEventListener('hashchange', () => {
  if (!acceptLink(location.hash)) return;
  history.replaceState(null, '', location.pathname + location.search);
  resolveRole(); start();
});

/* ======================= PWA ======================= */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ }); });
}

/* ======================= VERSION / UPDATES ======================= */
const verBtn = $('#ver');
verBtn.textContent = 'Beam v' + APP_VERSION;
async function latestVersion() {
  const r = await fetch('version.js', { cache: 'no-store' });
  const m = (await r.text()).match(/BEAM_VERSION\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}
async function applyUpdate() {
  if (sending || inc) { toast('Finish the current transfer first'); return; }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* ignore */ }
  location.reload();
}
async function checkUpdate(manual) {
  try {
    const v = await latestVersion();
    if (v && v !== APP_VERSION) {
      verBtn.textContent = `Beam v${APP_VERSION} · v${v} available, tap to update`;
      verBtn.dataset.update = '1';
      if (manual) { toast('Updating to v' + v + '…'); applyUpdate(); }
    } else if (manual) toast('Beam is up to date (v' + APP_VERSION + ')');
  } catch { if (manual) toast('Couldn’t check for updates. Are you online?'); }
}
verBtn.onclick = () => (verBtn.dataset.update ? applyUpdate() : checkUpdate(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(false); });

/* ======================= BOOT ======================= */
if (!isSecureContext || location.protocol === 'file:') warn('Beam must be opened over HTTPS (not as a local file). Clipboard and connections need it. See the README.');
renderHist();
resolveRole();
start();
initDisk();
setTimeout(() => checkUpdate(false), 3000);
