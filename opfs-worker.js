'use strict';
// Beam disk writer. Runs in a Worker so incoming files stream straight into the browser's private
// storage (OPFS) instead of piling up in memory. Works in Safari/iOS 15.2+, Chrome, Edge and Firefox.
// Layout: beam-rx/<transfer id>/<file name>. Messages are processed strictly in order.

const ACK_EVERY = 4 * 1024 * 1024;       // report progress to the page every 4 MB written
const open = new Map();                  // id -> { h: SyncAccessHandle, pos, unacked }
let rootP = null;
const root = () => rootP || (rootP = navigator.storage.getDirectory().then(r => r.getDirectoryHandle('beam-rx', { create: true })));
const post = (m) => self.postMessage(m);

async function closeHandle(id) {
  const s = open.get(id); if (!s) return null;
  open.delete(id);
  try { s.h.flush(); } catch { /* ignore */ }
  try { s.h.close(); } catch { /* ignore */ }
  return s;
}
async function removeDir(id) {
  await closeHandle(id);
  try { await (await root()).removeEntry(id, { recursive: true }); } catch { /* already gone */ }
}
async function sizeOf(dir) {
  let total = 0;
  for await (const e of dir.values()) {
    if (e.kind === 'file') { try { total += (await e.getFile()).size; } catch { /* ignore */ } }
    else total += await sizeOf(e);
  }
  return total;
}

async function handle(m) {
  switch (m.op) {
    case 'probe': { // can this browser really write files from a worker?
      const d = await root(); const dd = await d.getDirectoryHandle('_probe', { create: true });
      const h = await (await dd.getFileHandle('p', { create: true })).createSyncAccessHandle();
      h.write(new Uint8Array(1), { at: 0 }); h.close();
      await d.removeEntry('_probe', { recursive: true });
      return post({ rid: m.rid, ok: true });
    }
    case 'open': {
      await removeDir(m.id);
      const dd = await (await root()).getDirectoryHandle(m.id, { create: true });
      let fh;
      try { fh = await dd.getFileHandle(m.name, { create: true }); } catch { fh = await dd.getFileHandle('file', { create: true }); }
      const h = await fh.createSyncAccessHandle(); h.truncate(0);
      open.set(m.id, { h, pos: 0, unacked: 0 });
      return;
    }
    case 'write': {
      const s = open.get(m.id); if (!s) return;
      const u = new Uint8Array(m.buf); let w = 0;
      while (w < u.length) {
        const n = s.h.write(w ? u.subarray(w) : u, { at: s.pos + w });
        if (!n) throw new Error('Disk full or write failed');
        w += n;
      }
      s.pos += u.length; s.unacked += u.length;
      if (s.unacked >= ACK_EVERY) { s.unacked = 0; post({ op: 'wrote', id: m.id, total: s.pos }); }
      return;
    }
    case 'close': {
      const s = await closeHandle(m.id);
      return post({ rid: m.rid, size: s ? s.pos : -1 });
    }
    case 'remove': await removeDir(m.id); return post({ rid: m.rid, ok: true });
    case 'wipe': { // delete everything except the transfer that is still in progress
      const d = await root(); const names = [];
      for await (const e of d.values()) names.push(e.name);
      for (const n of names) if (n !== m.keep) await removeDir(n);
      return post({ rid: m.rid, ok: true });
    }
    case 'usage': return post({ rid: m.rid, bytes: await sizeOf(await root()) });
  }
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  chain = chain.then(() => handle(m)).catch(err => {
    if (m.rid) post({ rid: m.rid, error: String((err && err.message) || err) });
    else { post({ op: 'error', id: m.id, error: String((err && err.message) || err) }); removeDir(m.id); }
  });
};
