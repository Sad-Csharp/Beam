// Beam settings. Edit this file to customise connections; no other file needs changing.
window.BEAM_CONFIG = {
  // Use Beam's built-in free public STUN servers (recommended).
  useDefaultStun: true,

  // Extra ICE servers, e.g. your own TURN server so Beam works on strict networks:
  //   { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
  iceServers: [],

  // Optional: URL of a tiny service that returns fresh TURN credentials as
  //   { "iceServers": [ { urls, username, credential } ] }
  // See turn-worker/ for a ready-made Cloudflare Worker.
  turnCredentialsUrl: '',

  // How long (ms) a dropped connection may reconnect by itself before the pairing ends and a new
  // QR scan is required. Closing the page or tapping Disconnect always ends the pairing immediately.
  reconnectWindowMs: 60000,

  // Optional: your own PeerJS signaling server (otherwise the free public one is used):
  //   { host: 'peer.example.com', port: 443, secure: true, path: '/' }
  peer: {}
};
