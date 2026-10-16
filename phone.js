"use strict";

/* =========================================================
   The phone buzzer (buzz.html)
   Join a game by its room code, pick your podium, then buzz.
   ========================================================= */
const $ = id => document.getElementById(id);
const screen = $("screen"), connLine = $("conn");
const STORE = "bearcat-jeopardy-phone";
const params = new URLSearchParams(location.search);

let server = null;
try { const s = JSON.parse(params.get("srv")); if (s && typeof s.host === "string") server = s; } catch (e) {}

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {} };

let room = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
let peer = null, conn = null, retry = null;
let joined = false, ended = false;                   // joined: we've reached this game before; ended: the host turned buzzers off
let players = [], me = null;                         // me = my player index
let arm = { id: 0, open: false, locked: [], note: "" };
let result = null;                                   // the latest buzz-in result for the open round
let pressed = null;                                  // the round id I buzzed in
let offset = 0, bestRtt = Infinity, syncTimer = null; // game clock = my clock + offset

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString();
const okColor = c => /^#[0-9a-f]{6}$/i.test(c) ? c : "#4361ee";
const okPattern = p => /^[a-z]+$/.test(p) ? p : "solid";
const look = p => `class="pp pl pat-${okPattern(p.pattern)}" style="--pc:${okColor(p.color)}"`;
const secs = ms => (ms / 1000).toFixed(2);
const buzz = n => { try { navigator.vibrate && navigator.vibrate(n); } catch (e) {} };

/* ---------- Connecting ---------- */
async function connect() {
  clearTimeout(retry);
  ended = false;
  if (!room) return showJoin();
  setConn("Connecting to game " + room + "…");
  try { await loadScript(BUZZ.lib); }
  catch (e) { return setConn("Couldn't load the buzzer. Check your internet connection.", true); }
  if (!peer || peer.destroyed) {
    peer = new Peer(peerOptions(server));
    peer.on("error", err => {
      if (err.type === "peer-unavailable") {
        if (joined && !ended) { setConn("Waiting for the game to come back…", true); return again(); }   // e.g. the game page reloaded
        setConn(`Can't find game ${room}. Check the code on the game screen.`, true); showJoin(true);
      }
      else { setConn("Connection trouble. Retrying…", true); again(); }
    });
    peer.on("disconnected", () => { if (!peer.destroyed) setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500); });
    await new Promise(res => peer.open ? res() : peer.once("open", res));
  }
  conn = peer.connect(BUZZ.prefix + room, { reliable: true });
  conn.on("open", () => {
    joined = true;
    me = null;            // a new connection starts unlinked; the player list that follows re-links our saved player
    setConn("Connected to game " + room);
    saved.room = room; persist();
    bestRtt = Infinity; syncClock(6);
    clearInterval(syncTimer); syncTimer = setInterval(() => syncClock(1), 10000);
    send({ t: "hello" });   // ask for the players and buzzer state, in case they arrived before this point
    render();
  });
  conn.on("data", onMessage);
  conn.on("close", () => { if (ended) return; setConn("Lost the game. Reconnecting…", true); again(); });
  conn.on("error", () => {});
}
function again() { clearTimeout(retry); retry = setTimeout(connect, 2500); }
function setConn(text, bad) { connLine.textContent = text; connLine.classList.toggle("bad", !!bad); }
function send(msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) {} }

/* Keep a clock offset to the game, NTP style: keep the sample with the shortest round trip */
function syncClock(n) {
  for (let k = 0; k < n; k++) setTimeout(() => send({ t: "ping", c: performance.now() }), k * 120);
}

/* ---------- Messages from the game ---------- */
function onMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "pong") {
    const now = performance.now(), rtt = now - m.c;
    if (rtt >= 0 && rtt <= bestRtt * 1.5 + 5) { bestRtt = Math.min(bestRtt, rtt); offset = m.h + rtt / 2 - now; }
    return;
  }
  if (m.t === "players") {
    players = Array.isArray(m.list) ? m.list : [];
    // rejoin as the same player after a reload, if they're still in the game
    if (me === null && saved.room === room && players[saved.player] && players[saved.player].name === saved.name) send({ t: "claim", player: saved.player });
    return render();
  }
  if (m.t === "you") {
    me = Number.isInteger(m.player) ? m.player : null;
    if (me !== null && players[me]) { saved.player = me; saved.name = players[me].name; persist(); }
    if (m.reason === "taken") setConn("Someone else picked that player on another phone.", true);
    return render();
  }
  if (m.t === "arm") {
    if (m.id !== arm.id) { result = null; pressed = null; }
    arm = { id: m.id, open: !!m.open, locked: Array.isArray(m.locked) ? m.locked : [], note: String(m.note || "") };
    if (arm.open && !arm.locked.includes(me)) buzz(15);
    return render();
  }
  if (m.t === "result" && m.id === arm.id) {
    const wasFirst = result && result.first === me;
    result = m;
    if (m.first === me && !wasFirst) buzz([60, 40, 120]);
    return render();
  }
  if (m.t === "bye") {
    ended = true; joined = false;
    clearTimeout(retry); clearInterval(syncTimer);
    conn && conn.close();
    showJoin(true);
    setConn("The host turned buzzers off. Join again when they're back on.", true);
  }
}

/* ---------- Screens ---------- */
function render() {
  if (!conn || !conn.open) return;
  if (me === null || !players[me]) return showPick();
  showBuzzer();
}

function showJoin(failed) {
  screen.innerHTML = `
    <p class="msg">Enter the 4-letter code shown on the game screen.</p>
    <input id="code" class="code-in" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(room)}" aria-label="Game code">
    <button class="btn primary" id="go">Join game</button>`;
  const go = () => { room = $("code").value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); if (room.length === 4) { history.replaceState(null, "", "?room=" + room + (server ? "&srv=" + encodeURIComponent(JSON.stringify(server)) : "")); connect(); } };
  $("go").onclick = go;
  $("code").onkeydown = e => { if (e.key === "Enter") go(); };
  if (!failed) setConn("");
}

function showPick() {
  screen.innerHTML = `
    <p class="msg">Which player are you?</p>
    <div class="pick">${players.map((p, i) =>
      `<button ${look(p)} data-claim="${i}"><span class="nm">${esc(p.name)}</span><span class="sc">${fmt(p.score)}</span></button>`).join("")}
    </div>
    <p class="msg">Not on the board yet?</p>
    <div class="new-player"><input id="newName" maxlength="24" placeholder="Your name" aria-label="Your name"><button class="btn" id="add">Add me</button></div>`;
  screen.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => send({ t: "claim", player: +b.dataset.claim }));
  const add = () => { const n = $("newName").value.trim(); if (n) send({ t: "join", name: n }); };
  $("add").onclick = add;
  $("newName").onkeydown = e => { if (e.key === "Enter") add(); };
}

function buzzerState() {
  if (arm.note) return ["note", arm.note, ""];
  if (result && result.first !== null && result.first !== undefined) {
    const first = players[result.first], mine = result.list.find(e => e.player === me);
    if (result.first === me) return ["first", "You're first!", "Answer now"];
    if (mine) return ["late", `${first ? first.name : "Someone"} was first`, `You were ${secs(mine.delta)} s slower`];
    if (arm.locked.includes(me)) return ["locked", "Locked out", "You already answered this one"];
    return [arm.open ? "armed" : "idle", `${first ? first.name : "Someone"} buzzed first`, arm.open ? "You can still buzz in" : ""];
  }
  if (arm.locked.includes(me)) return ["locked", "Locked out", "You already answered this one"];
  if (pressed === arm.id) return ["sent", "Buzzed!", "Waiting for the others…"];
  if (arm.open) return ["armed", "Buzz in!", ""];
  return ["idle", "Get ready", "Buzzers open when a clue is on screen"];
}

function showBuzzer() {
  const p = players[me];
  const [state, status, detail] = buzzerState();
  let btn = $("buzzBtn");
  if (!btn) {
    screen.innerHTML = `
      <div class="me"><span class="nm" id="meName"></span><span class="sc" id="meScore"></span><button id="switch">Switch player</button></div>
      <button id="buzzBtn" class="buzz pl" aria-label="Buzz in">BUZZ</button>
      <p id="status" class="status"></p>
      <p id="detail" class="detail"></p>
      <ol id="order" class="order" aria-label="Buzz order"></ol>`;
    btn = $("buzzBtn");
    btn.addEventListener("pointerdown", e => { e.preventDefault(); press(); });
    btn.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); press(); } });
    $("switch").onclick = () => { send({ t: "leave" }); saved.player = null; persist(); };
  }
  btn.className = `buzz pl pat-${okPattern(p.pattern)}`;
  btn.style.setProperty("--pc", okColor(p.color));
  btn.dataset.state = state;
  $("meName").textContent = p.name;
  $("meScore").textContent = fmt(p.score);
  $("status").textContent = status;
  $("status").className = "status" + (state === "locked" || state === "late" ? " bad" : state === "idle" || state === "note" ? " dim" : "");
  $("detail").textContent = detail;
  const order = result && Array.isArray(result.list) ? result.list : [];
  $("order").innerHTML = order.map((e, k) => `<li class="${e.player === me ? "mine" : ""}"><span>${k + 1}. ${esc(players[e.player] ? players[e.player].name : "?")}</span><span>${k ? "+" + secs(e.delta) + " s" : "first"}</span></li>`).join("");
}

function press() {
  const t = performance.now();
  const btn = $("buzzBtn");
  btn.classList.add("pressed"); setTimeout(() => btn.classList.remove("pressed"), 120);
  if (!arm.open || arm.locked.includes(me) || pressed === arm.id || arm.note) return buzz(8);
  pressed = arm.id;
  send({ t: "buzz", id: arm.id, at: t + offset });
  buzz(40);
  render();
}

/* Keep the screen awake while the buzzer is open */
async function stayAwake() { try { if (navigator.wakeLock && document.visibilityState === "visible") await navigator.wakeLock.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { stayAwake(); if (!conn || !conn.open) connect(); } });
stayAwake();

if (room) connect(); else showJoin();
