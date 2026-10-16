"use strict";

/* =========================================================
   Phone buzzers: players buzz in from their own phones.

   The game page and each phone talk directly over WebRTC (PeerJS).
   A free public PeerJS server only introduces them, and PeerJS relays
   the connection when a network blocks direct links.
   Loaded by the game (the host) and by buzz.html (the phones).
   ========================================================= */
const BUZZ = {
  // Where phones open the buzzer page when the game is opened as a file on this computer.
  // (When the game is served from a web address, phones use buzz.html next to it instead.)
  page: "https://grumpygumby.github.io/Jeopardy/buzz.html",
  // The PeerJS server that introduces phones to the game. null = the free public PeerJS cloud.
  // To use your own: { host: "peer.example.com", port: 443, path: "/", secure: true }
  server: null,
  grace: 200,              // ms to wait after the first buzz arrives, in case an earlier press is still on its way
  prefix: "bearcat-jeopardy-",
  lib: "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
  qrLib: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"
};

const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error("Couldn't load " + src)); };
    document.head.appendChild(s);
  }));
}

function peerOptions(server) {
  const s = server || BUZZ.server;
  return s ? { host: String(s.host), port: +s.port || 443, path: String(s.path || "/"), secure: s.secure !== false } : {};
}

/* =========================================================
   Host side (the game page)
   ========================================================= */
const Buzzers = (() => {
  const STORE = "bearcat-jeopardy-buzzers";
  const CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";   // no vowels, so codes never spell words
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}

  let peer = null, status = "off", error = "", room = /^[A-Z]{4}$/.test(saved.room) ? saved.room : "", hooks = {};
  let retry = null;
  const phones = new Map();       // connection id → { conn, player: index or null }
  let round = { id: 0, open: false, openedAt: 0, entries: [], winner: null, locked: [], note: "", timer: null };

  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ on: status !== "off", room })); } catch (e) {} };
  const changed = () => hooks.changed && hooks.changed();
  const send = (conn, msg) => { try { if (conn.open) conn.send(msg); } catch (e) {} };
  const broadcast = msg => phones.forEach(p => send(p.conn, msg));
  const makeCode = () => Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");

  function init(h) { hooks = h; if (saved.on) start(); }

  async function start() {
    if (peer) return;
    clearTimeout(retry);
    status = "connecting"; error = ""; persist(); changed();
    try { await loadScript(BUZZ.lib); }
    catch (e) { return trouble("Couldn't load the buzzer library. Phone buzzers need an internet connection."); }
    if (status === "off") return;
    if (!room) room = makeCode();
    peer = new Peer(BUZZ.prefix + room, peerOptions());
    peer.on("open", () => { status = "ready"; error = ""; persist(); changed(); });
    peer.on("connection", attach);
    peer.on("disconnected", () => {          // lost the introduction server; phones already linked keep working
      if (status === "off" || !peer || peer.destroyed) return;
      status = "connecting"; changed();
      retry = setTimeout(() => { if (peer && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on("error", err => {
      if (err.type === "unavailable-id") {   // another game already has this code
        destroyPeer(); room = makeCode(); return start();
      }
      if (err.type === "peer-unavailable") return;
      trouble(status === "ready" ? "Lost the buzzer server. Retrying…" : "Can't reach the buzzer server. Retrying…");
    });
  }

  function trouble(msg) {
    error = msg;
    if (status === "off") return;
    status = "connecting";
    destroyPeer();
    changed();
    retry = setTimeout(start, 4000);
  }

  // `later` gives a goodbye message time to reach the phones first
  function destroyPeer(later) {
    const old = peer;
    peer = null;
    if (old) setTimeout(() => { try { old.destroy(); } catch (e) {} }, later ? 400 : 0);
  }

  function stop() {
    clearTimeout(retry); clearTimeout(round.timer);
    broadcast({ t: "bye" });
    status = "off"; error = "";
    destroyPeer(true); phones.clear();
    persist(); changed();
  }

  function newRoom() {
    broadcast({ t: "bye" });
    destroyPeer(true); phones.clear();
    room = makeCode();
    status = "off";
    start();
  }

  function attach(conn) {
    conn.on("open", () => {
      phones.set(conn.connectionId, { conn, player: null });
      send(conn, playersMsg());
      send(conn, armMsg());
      changed();
    });
    conn.on("data", msg => onMessage(conn, msg));
    conn.on("close", () => { phones.delete(conn.connectionId); changed(); });
    conn.on("error", () => {});
  }

  function claim(ph, i) {
    for (const other of phones.values()) {
      if (other !== ph && other.player === i) { other.player = null; send(other.conn, { t: "you", player: null, reason: "taken" }); }
    }
    ph.player = i;
    send(ph.conn, { t: "you", player: i });
    send(ph.conn, armMsg());
    changed();
  }

  function onMessage(conn, m) {
    const ph = phones.get(conn.connectionId);
    if (!ph || !m || typeof m !== "object") return;
    if (m.t === "ping") return send(conn, { t: "pong", c: +m.c || 0, h: performance.now() });
    if (m.t === "hello") { send(conn, playersMsg()); if (ph.player !== null) send(conn, { t: "you", player: ph.player }); return send(conn, armMsg()); }
    if (m.t === "claim") {
      const i = Math.floor(+m.player);
      if (i >= 0 && i < hooks.players().length) claim(ph, i);
      return;
    }
    if (m.t === "join") {                    // a new player, made from the phone
      const name = String(m.name || "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (name) claim(ph, hooks.addPlayer(name));
      return;
    }
    if (m.t === "leave") { ph.player = null; send(conn, { t: "you", player: null }); return changed(); }
    if (m.t === "buzz") return onBuzz(ph, m);
  }

  /* ---------- Buzz-in rounds ----------
     open() arms every phone; the earliest press wins, measured on the game's clock.
     Phones keep their clocks in sync with the game, so a slow network doesn't cost a player the buzz. */
  function open(locked = []) {
    clearTimeout(round.timer);
    round = { id: round.id + 1, open: true, openedAt: performance.now(), entries: [], winner: null, locked: [...new Set(locked)], note: "", timer: null };
    broadcast(armMsg()); changed();
  }

  function close(note = "") {
    clearTimeout(round.timer);
    round = { ...round, id: round.id + 1, open: false, entries: [], winner: null, locked: [], note, timer: null };
    broadcast(armMsg()); changed();
  }

  // The host marked player j wrong: lock them out; if they held the buzz, open it up for everyone else
  function wrong(j) {
    if (!round.open && round.winner === null) return;
    const locked = [...round.locked, j];
    if (round.winner === j) open(locked);
    else { round.locked = [...new Set(locked)]; broadcast(armMsg()); changed(); }
  }
  function unlock(j) {
    if (!round.locked.includes(j)) return;
    round.locked = round.locked.filter(x => x !== j);
    broadcast(armMsg()); changed();
  }

  function onBuzz(ph, m) {
    if (ph.player === null || !round.open || m.id !== round.id) return;
    if (round.locked.includes(ph.player) || round.entries.some(e => e.player === ph.player)) return;
    const now = performance.now();
    // m.at is the press time on the game's clock; it can't be before the buzzers opened or after it arrived
    const at = Number.isFinite(m.at) ? Math.min(now, Math.max(round.openedAt, m.at)) : now;
    round.entries.push({ player: ph.player, at });
    if (round.winner === null) { if (!round.timer) round.timer = setTimeout(decide, BUZZ.grace); }
    else results();
  }

  function decide() {
    round.timer = null;
    if (!round.entries.length) return;
    round.entries.sort((a, b) => a.at - b.at);
    round.winner = round.entries[0].player;
    hooks.first && hooks.first(round.winner);
    results();
  }

  function standings() {
    if (round.winner === null) return [];
    const first = round.entries.find(e => e.player === round.winner);
    return [first, ...round.entries.filter(e => e !== first).sort((a, b) => a.at - b.at)]
      .map(e => ({ player: e.player, delta: Math.max(0, Math.round(e.at - first.at)) }));
  }

  function results() {
    broadcast({ t: "result", id: round.id, first: round.winner, list: standings() });
    changed();
  }

  const armMsg = () => ({ t: "arm", id: round.id, open: round.open, locked: round.locked, note: round.note });
  const playersMsg = () => ({ t: "players", list: hooks.players() });

  // Scores or names changed
  function sync() { if (phones.size) broadcast(playersMsg()); }

  // Player i was removed: later players move down one place
  function removed(i) {
    phones.forEach(ph => {
      if (ph.player === i) { ph.player = null; send(ph.conn, { t: "you", player: null, reason: "removed" }); }
      else if (ph.player > i) { ph.player--; send(ph.conn, { t: "you", player: ph.player }); }
    });
    round.locked = round.locked.filter(x => x !== i).map(x => x > i ? x - 1 : x);
    round.entries = round.entries.filter(e => e.player !== i).map(e => ({ ...e, player: e.player > i ? e.player - 1 : e.player }));
    if (round.winner === i) round.winner = null; else if (round.winner > i) round.winner--;
    sync(); changed();
  }

  function link() {
    const base = /^https?:$/.test(location.protocol) ? new URL("buzz.html", location.href).href : BUZZ.page;
    return `${base}?room=${room}${BUZZ.server ? "&srv=" + encodeURIComponent(JSON.stringify(BUZZ.server)) : ""}`;
  }

  return {
    init, start, stop, newRoom, open, close, wrong, unlock, sync, removed, link,
    get status() { return status; }, get error() { return error; }, get room() { return room; },
    get active() { return status !== "off"; },
    get phones() { return [...phones.values()].map(p => p.player); },
    get round() { return { open: round.open, winner: round.winner, locked: [...round.locked], waiting: !!round.timer, list: standings() }; }
  };
})();
