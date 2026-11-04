// Cloudflare Worker that hands Beam short-lived TURN credentials.
// Lets Beam connect on strict networks (corporate / guest Wi-Fi, some cellular) via an encrypted relay.
//
// Setup (free tier is plenty):
//   1. Cloudflare dashboard -> Realtime -> TURN -> create a TURN key. Note the Key ID and API token.
//   2. Workers -> create a Worker and paste this file.
//   3. Add Worker variables:  TURN_KEY_ID (text)  and  TURN_API_TOKEN (secret),
//      and  ALLOWED_ORIGIN = https://<your-username>.github.io  (your Beam site's origin).
//   4. Put the Worker URL in config.js as  turnCredentialsUrl.
//
// Beam traffic stays end-to-end encrypted (DTLS); the relay only forwards ciphertext.

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed && origin === allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' || !allowed || origin !== allowed) return new Response('Forbidden', { status: 403, headers: cors });

    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 })
    });
    if (!r.ok) return new Response('Upstream error', { status: 502, headers: cors });
    return new Response(await r.text(), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
};
