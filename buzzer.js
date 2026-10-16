"use strict";

/* =========================================================
   Phone buzzers: players buzz in from their own phones.

   The game page and the phones pass small messages through a free public
   MQTT broker (a message relay), over an ordinary secure WebSocket like a
   chat app uses. Nothing has to connect device to device, so it works on
   home Wi-Fi, cellular data, and networks that block direct links.
   Messages on a public broker aren't private: don't put anything secret in the game.

   Loaded by the game (the host) and by buzz.html (the phones).
   ========================================================= */
const BUZZ = {
  // Where phones open the buzzer page when the game is opened as a file on this computer.
  // (When the game is served from a web address, phones use buzz.html next to it instead.)
  page: "https://grumpygumby.github.io/Jeopardy/buzz.html",
  // Public MQTT brokers to try, in order. The game tells the phones which one it's using.
  brokers: [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
    "wss://broker.hivemq.com:8884/mqtt"
  ],
  topic: "bearcat-jeopardy/v1",
  grace: 400,              // ms to wait after the first buzz arrives, in case an earlier press is still on its way
  lib: "https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js",
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

const randomId = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/* Connect to the first broker that answers. Tries `first` (an index into urls) before the rest.
   Resolves { client, index }; rejects if none of them answer. */
async function connectRelay(urls, { will, first = 0, onTry } = {}) {
  await loadScript(BUZZ.lib);
  const order = urls.map((u, i) => i).sort((a, b) => (a === first ? -1 : b === first ? 1 : a - b));
  for (const [n, index] of order.entries()) {
    if (onTry) onTry(n + 1, order.length);
    try { return { client: await tryBroker(urls[index], will), index }; } catch (e) {}
  }
  throw new Error("No broker answered");
}
function tryBroker(url, will) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      clientId: "bj_" + randomId(12), keepalive: 20, connectTimeout: 6000, reconnectPeriod: 2000,
      clean: true, protocolVersion: 4, will
    });
    const fail = () => { clearTimeout(timer); client.end(true); reject(new Error("Couldn't reach " + url)); };
    const timer = setTimeout(fail, 7000);
    client.once("connect", () => { clearTimeout(timer); client.removeListener("error", fail); resolve(client); });
    client.once("error", fail);
  });
}
/* Private messages (Final Jeopardy wagers and answers).
   The broker is public, so these are end-to-end encrypted between one phone and the game:
   the game has a key pair for its room, and the QR link carries a fingerprint of its public key.
   A phone checks the key it's sent against that fingerprint (so nobody on the broker can swap
   in their own), makes its own key pair, and both sides derive a shared AES-GCM key (ECDH P-256).
   Anyone reading the broker sees only ciphertext. Built into every modern browser (Web Crypto). */
const Secret = (() => {
  const ok = () => !!(window.crypto && crypto.subtle);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const pair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const pubRaw = async keyPair => b64(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const fingerprint = async raw => b64(await crypto.subtle.digest("SHA-256", unb64(raw))).slice(0, 22);
  async function shared(privateKey, otherRaw) {
    const pub = await crypto.subtle.importKey("raw", unb64(otherRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return crypto.subtle.deriveKey({ name: "ECDH", public: pub }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, obj, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function open(key, msg, aad) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(msg.iv), additionalData: enc.encode(aad) }, key, unb64(msg.ct));
    return JSON.parse(dec.decode(pt));
  }
  return { ok, b64, unb64, pair, pubRaw, fingerprint, shared, seal, open };
})();

// Parse a message from the relay; anything odd is dropped
function parseMsg(payload) {
  if (!payload || payload.length > 4000) return null;
  try { const m = JSON.parse(payload.toString()); return m && typeof m === "object" ? m : null; } catch (e) { return null; }
}

/* =========================================================
   Host side (the game page)
   ========================================================= */
const Buzzers = (() => {
  const STORE = "bearcat-jeopardy-buzzers";
  const CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";   // no vowels, so codes never spell words
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}

  let client = null, broker = 0, status = "off", error = "", hooks = {}, retry = null, sweep = null;
  let room = /^[A-Z]{4}$/.test(saved.room) ? saved.room : "";
  const phones = new Map();       // phone id → { player: index or null, seen: time of its last message, key: its private-message key }
  let hostKey = null;             // { room, priv, pub, fp, jwk }: this room's key pair for private messages
  let round = { id: 0, open: false, openedAt: 0, entries: [], winner: null, locked: [], note: "", timer: null };

  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ on: status !== "off", room, key: hostKey && hostKey.room === room ? { jwk: hostKey.jwk, pub: hostKey.pub } : saved.key && saved.room === room ? saved.key : null })); } catch (e) {} };

  // The room's key pair, kept across reloads so phone links stay valid
  async function ensureKey() {
    if (!Secret.ok() || (hostKey && hostKey.room === room)) return;
    try {
      if (saved.key && saved.room === room && saved.key.jwk) {
        const priv = await crypto.subtle.importKey("jwk", saved.key.jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
        hostKey = { room, priv, pub: saved.key.pub, jwk: saved.key.jwk, fp: await Secret.fingerprint(saved.key.pub) };
      } else {
        const kp = await Secret.pair();
        const pub = await Secret.pubRaw(kp), jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
        hostKey = { room, priv: kp.privateKey, pub, jwk, fp: await Secret.fingerprint(pub) };
      }
      saved = { ...saved, room, key: { jwk: hostKey.jwk, pub: hostKey.pub } };
      persist();
    } catch (e) { hostKey = null; }
  }
  const changed = () => hooks.changed && hooks.changed();
  const base = () => `${BUZZ.topic}/${room}`;
  const publish = (topic, msg, opts = { qos: 1 }) => { if (client && client.connected) client.publish(topic, JSON.stringify(msg), opts); };
  const send = (id, msg) => publish(`${base()}/p/${id}`, msg, msg.t === "pong" ? { qos: 0 } : { qos: 1 });
  const broadcast = msg => { if (phones.size) publish(`${base()}/all`, msg); };
  const makeCode = () => Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");

  function init(h) { hooks = h; if (saved.on) start(); }

  async function start() {
    if (client) return;
    clearTimeout(retry);
    status = "connecting"; error = ""; persist(); changed();
    if (!room) room = makeCode();
    const stateTopic = () => `${base()}/state`;
    let c;
    try {
      ({ client: c, index: broker } = await connectRelay(BUZZ.brokers, { will: { topic: stateTopic(), payload: "off", qos: 1, retain: true } }));
    } catch (e) {
      if (status === "off") return;
      error = /load/.test(e.message) ? "Couldn't load the buzzer library. Phone buzzers need an internet connection."
                                     : "Can't reach the buzzer server. Retrying…";
      changed();
      retry = setTimeout(start, 5000);
      return;
    }
    if (status === "off") { c.end(true); return; }
    await ensureKey();
    client = c;
    const online = () => {
      client.subscribe(`${base()}/up`, { qos: 1 });
      client.publish(stateTopic(), "on", { qos: 1, retain: true });
      status = "ready"; error = ""; persist(); changed();
      broadcast(playersMsg()); broadcast(armMsg());
    };
    client.on("connect", online);                    // after a reconnect too
    client.on("offline", () => { if (status !== "off") { status = "connecting"; error = "Reconnecting to the buzzer server…"; changed(); } });
    client.on("message", (topic, payload) => { const m = parseMsg(payload); if (m) onMessage(m); });
    online();
    clearInterval(sweep);
    sweep = setInterval(() => {                      // forget phones that have gone quiet
      const now = Date.now(); let gone = false;
      phones.forEach((p, id) => { if (now - p.seen > 20000) { phones.delete(id); gone = true; } });
      if (gone) changed();
    }, 5000);
  }

  // Mark the room offline and hang up; waits a moment so a goodbye sent just before goes out first
  function disconnect() {
    clearInterval(sweep);
    if (!client) return;
    const c = client, stateTopic = `${base()}/state`;
    client = null;
    c.removeAllListeners("connect"); c.removeAllListeners("offline"); c.removeAllListeners("message");
    setTimeout(() => {
      c.publish(stateTopic, "off", { qos: 1, retain: true }, () => c.end());
      setTimeout(() => c.end(true), 1500);
    }, 400);
  }

  function stop() {
    clearTimeout(retry); clearTimeout(round.timer);
    broadcast({ t: "bye" });
    status = "off"; error = "";
    disconnect(); phones.clear();
    persist(); changed();
  }

  function newRoom() {
    broadcast({ t: "bye" });
    disconnect(); phones.clear();
    room = makeCode();
    hostKey = null; saved = { ...saved, key: null };
    status = "off";
    start();
  }

  function claim(id, i) {
    phones.forEach((other, otherId) => {
      if (otherId !== id && other.player === i) { other.player = null; send(otherId, { t: "you", player: null, reason: "taken" }); }
    });
    phones.get(id).player = i;
    send(id, { t: "you", player: i });
    send(id, armMsg());
    finaleTo(id);
    changed();
  }

  function onMessage(m) {
    const id = typeof m.from === "string" && /^[a-z0-9]{8,16}$/.test(m.from) ? m.from : null;
    if (!id) return;
    const isNew = !phones.has(id);
    if (isNew) phones.set(id, { player: null, seen: 0 });
    const ph = phones.get(id);
    ph.seen = Date.now();
    if (isNew) changed();
    if (m.t === "ping") return send(id, { t: "pong", c: +m.c || 0, h: performance.now() });
    if (m.t === "hello") {
      send(id, playersMsg());
      if (ph.player !== null) send(id, { t: "you", player: ph.player });
      if (hostKey) send(id, { t: "key", pub: hostKey.pub });   // public; the phone checks it against the link's fingerprint
      send(id, armMsg());
      return finaleTo(id);
    }
    if (m.t === "pkey" && hostKey && typeof m.pub === "string" && m.pub.length < 200) {
      Secret.shared(hostKey.priv, m.pub).then(key => { ph.key = key; changed(); finaleTo(id); }).catch(() => {});
      return;
    }
    if (m.t === "sec" && ph.key && typeof m.iv === "string" && typeof m.ct === "string" && m.ct.length < 3000) {
      Secret.open(ph.key, m, `${room}|${id}`)
        .then(data => { if (data && typeof data === "object" && hooks.secret) hooks.secret(ph.player, data, id); })
        .catch(() => {});
      return;
    }
    if (m.t === "claim") {
      const i = Math.floor(+m.player);
      if (i >= 0 && i < hooks.players().length) claim(id, i);
      return;
    }
    if (m.t === "join") {                    // a new player, made from the phone
      const name = String(m.name || "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (name) claim(id, hooks.addPlayer(name));
      return;
    }
    if (m.t === "leave") { ph.player = null; send(id, { t: "you", player: null }); return changed(); }
    if (m.t === "bye") { phones.delete(id); return changed(); }
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
  function sync() { broadcast(playersMsg()); }

  // Player i was removed: later players move down one place
  function removed(i) {
    phones.forEach((ph, id) => {
      if (ph.player === i) { ph.player = null; send(id, { t: "you", player: null, reason: "removed" }); }
      else if (ph.player > i) { ph.player--; send(id, { t: "you", player: ph.player }); }
    });
    round.locked = round.locked.filter(x => x !== i).map(x => x > i ? x - 1 : x);
    round.entries = round.entries.filter(e => e.player !== i).map(e => ({ ...e, player: e.player > i ? e.player - 1 : e.player }));
    if (round.winner === i) round.winner = null; else if (round.winner > i) round.winner--;
    sync(); changed();
  }

  /* ---------- Final Jeopardy on the phones ----------
     Only public facts go out here (the stage, whether a wager is locked); amounts and answers never do. */
  function finaleTo(id) {
    const ph = phones.get(id);
    if (!ph || !hooks.finaleInfo) return;
    send(id, { t: "fj", ...hooks.finaleInfo(ph.player, !!ph.key) });
  }
  function finale() { phones.forEach((ph, id) => finaleTo(id)); }
  const securePlayers = () => [...phones.values()].filter(p => p.key && p.player !== null).map(p => p.player);

  // The phone link carries the room, which broker the game is on, and the fingerprint of the room's key
  function link() {
    const page = /^https?:$/.test(location.protocol) ? new URL("buzz.html", location.href).href : BUZZ.page;
    const custom = BUZZ.brokers[broker] !== defaultBrokers[broker];
    return `${page}?room=${room}&b=${broker}${custom ? "&relay=" + encodeURIComponent(BUZZ.brokers[broker]) : ""}${hostKey && hostKey.room === room ? "&k=" + hostKey.fp : ""}`;
  }
  const defaultBrokers = [...BUZZ.brokers];

  return {
    init, start, stop, newRoom, open, close, wrong, unlock, sync, removed, link, finale, securePlayers,
    get status() { return status; }, get error() { return error; }, get room() { return room; },
    get active() { return status !== "off"; },
    get phones() { return [...phones.values()].map(p => p.player); },
    get round() { return { open: round.open, winner: round.winner, locked: [...round.locked], waiting: !!round.timer, list: standings() }; }
  };
})();
