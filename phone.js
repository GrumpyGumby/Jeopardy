"use strict";

/* =========================================================
   The phone buzzer (buzz.html)
   Join a game by its room code, pick your podium, then buzz.
   ========================================================= */
const $ = id => document.getElementById(id);
const screen = $("screen"), connLine = $("conn");
const STORE = "bearcat-jeopardy-phone";
const params = new URLSearchParams(location.search);

// Which broker the game is on (from the link); a custom broker address can come along too
const brokerIndex = Math.max(0, Math.min(BUZZ.brokers.length - 1, parseInt(params.get("b"), 10) || 0));
const relay = /^wss?:\/\/[^\s"'<>]+$/.test(params.get("relay") || "") ? params.get("relay") : null;

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {} };
if (!/^[a-z0-9]{12}$/.test(saved.id || "")) { saved.id = randomId(12); persist(); }
const myId = saved.id;                               // this phone, so the game knows it after a reload

let room = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
let client = null, connecting = false, retry = null, findTimer = null, beat = null, subscribedRoom = "";
let linked = false;                                  // the game is on and answering
let joined = false, ended = false;                   // joined: we've reached this game before; ended: the host turned buzzers off
let players = [], me = null;                         // me = my player index
let arm = { id: 0, open: false, locked: [], note: "" };
let result = null;                                   // the latest buzz-in result for the open round
let pressed = null;                                  // the round id I buzzed in
let offset = 0, samples = [], lastPong = 0;          // game clock = my clock + offset

/* Final Jeopardy. Wagers and answers go to the game encrypted (see Secret in buzzer.js);
   only a phone that opened the QR link has the fingerprint to check the game's key. */
let fingerprint = /^[A-Za-z0-9_-]{22}$/.test(params.get("k") || "") ? params.get("k") : null;
let secretKey = null;                                // shared with the game once the key checks out
let secure = false, keyProblem = "";
let fin = { stage: "off" };                          // what the game says about the finale
let myWager = null, myAnswer = "";                   // kept on this phone only, to show back to the player

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString();
const okColor = c => /^#[0-9a-f]{6}$/i.test(c) ? c : "#4361ee";
const okPattern = p => /^[a-z]+$/.test(p) ? p : "solid";
const look = p => `class="pp pl pat-${okPattern(p.pattern)}" style="--pc:${okColor(p.color)}"`;
const secs = ms => (ms / 1000).toFixed(2);
const buzz = n => { try { navigator.vibrate && navigator.vibrate(n); } catch (e) {} };
const base = r => `${BUZZ.topic}/${r || room}`;

/* ---------- Connecting ----------
   Every step has a timeout and a message, so the phone never just sits on "Connecting…" */
async function connect() {
  clearTimeout(retry);
  ended = false;
  if (!room) return showJoin();
  if (!client) {
    if (connecting) return;
    connecting = true;
    setConn(`Connecting to game ${room}…`);
    try {
      ({ client } = await connectRelay(relay ? [relay] : BUZZ.brokers, {
        first: relay ? 0 : brokerIndex,
        onTry: (n, of) => { if (n > 1) setConn(`Connecting to game ${room}… (trying server ${n} of ${of})`); }
      }));
    } catch (e) {
      connecting = false;
      setConn(/load/.test(e.message) ? "Couldn't load the buzzer. Check your internet connection. Retrying…"
                                     : "Can't reach the buzzer server. Check your internet connection. Retrying…", true);
      retry = setTimeout(connect, 5000);
      return;
    }
    connecting = false;
    client.on("message", onRelay);
    client.on("connect", listen);                          // after a reconnect too
    client.on("offline", () => { linked = false; setConn("Connection lost. Reconnecting…", true); });
  }
  listen();
}

// Listen to this room: messages for everyone, messages for this phone, and whether the game is on
function listen() {
  if (!client || !room) return;
  if (subscribedRoom && subscribedRoom !== room) client.unsubscribe([`${base(subscribedRoom)}/all`, `${base(subscribedRoom)}/p/${myId}`, `${base(subscribedRoom)}/state`]);
  subscribedRoom = room;
  setConn(`Looking for game ${room}…`);
  client.subscribe([`${base()}/all`, `${base()}/p/${myId}`, `${base()}/state`], { qos: 1 });
  clearTimeout(findTimer);
  findTimer = setTimeout(() => {                         // the game posts "on" as soon as we listen, if it's running
    if (linked || ended) return;
    if (joined) setConn("Waiting for the game to come back…", true);
    else { showJoin(true); setConn(`Can't find game ${room}. Check the code on the game screen.`, true); }
  }, 6000);
}

function onRelay(topic, payload) {
  if (!topic.startsWith(base() + "/")) return;
  if (topic.endsWith("/state")) {
    if (payload.toString() === "on") return hello();
    linked = false;
    clearTimeout(findTimer);
    if (joined) setConn("The game is offline. Waiting for it to come back…", true);
    else { showJoin(true); setConn(`Game ${room} isn't running right now. Check the code on the game screen.`, true); }
    return;
  }
  const m = parseMsg(payload);
  if (m) onMessage(m);
}

// The game is on: introduce ourselves, sync clocks, and keep a heartbeat going
function hello() {
  if (ended) return;
  linked = true; clearTimeout(findTimer);
  me = null;                                             // the game re-links our saved player from the list it sends
  samples = []; lastPong = performance.now();
  send({ t: "hello" });
  syncClock(10);
  clearInterval(beat);
  beat = setInterval(() => {
    syncClock(2);
    if (linked && performance.now() - lastPong > 15000) setConn("The game isn't answering. Waiting…", true);
  }, 4000);
}

function setConn(text, bad) { connLine.textContent = text; connLine.classList.toggle("bad", !!bad); }
function send(msg) {
  if (client && client.connected && room) client.publish(`${base()}/up`, JSON.stringify({ ...msg, from: myId }), { qos: msg.t === "ping" ? 0 : 1 });
}

/* Keep a clock offset to the game, NTP style: trust the samples with the shortest round trip */
function syncClock(n) {
  for (let k = 0; k < n; k++) setTimeout(() => send({ t: "ping", c: performance.now() }), k * 150);
}

/* ---------- Messages from the game ---------- */
function onMessage(m) {
  if (m.t === "pong") {
    const now = performance.now(), rtt = now - m.c;
    if (!(rtt >= 0 && rtt < 10000) || !Number.isFinite(m.h)) return;
    lastPong = now;
    if (!joined) { joined = true; saved.room = room; persist(); }
    if (connLine.textContent !== "Connected to game " + room) setConn("Connected to game " + room);
    // the quickest round trips are the least skewed by network delay: average the best three
    samples.push({ rtt, offset: m.h + rtt / 2 - now });
    if (samples.length > 20) samples.shift();
    const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    offset = best.reduce((sum, x) => sum + x.offset, 0) / best.length;
    return;
  }
  if (m.t === "players") {
    players = Array.isArray(m.list) ? m.list : [];
    // "you are player N" can arrive before the list that has player N in it: remember who we are now
    if (me !== null && players[me]) { saved.player = me; saved.name = players[me].name; persist(); }
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
  if (m.t === "key") return checkKey(m.pub);
  if (m.t === "fj") {
    fin = { stage: String(m.stage || "off"), eligible: !!m.eligible, cap: Math.max(0, +m.cap || 0), mode: String(m.mode || "paper"),
            wager: String(m.wager || "none"), answer: String(m.answer || "none"), secure: !!m.secure };
    return render();
  }
  if (m.t === "bye") {
    ended = true; joined = false; linked = false;
    clearInterval(beat); clearTimeout(findTimer);
    showJoin(true);
    setConn("The host turned buzzers off. Join again when they're back on.", true);
  }
}

/* ---------- Screens ---------- */
function render() {
  if (!linked) return;
  if (me === null || !players[me]) return showPick();
  if (fin.stage !== "off") return showFinale();
  if (!$("buzzBtn")) screen.innerHTML = "";
  showBuzzer();
}

/* ---------- Private messages ---------- */
async function checkKey(pub) {
  secretKey = null; secure = false;
  if (!fingerprint) { keyProblem = "link"; return render(); }
  if (!Secret.ok()) { keyProblem = "browser"; return render(); }
  try {
    if (await Secret.fingerprint(pub) !== fingerprint) { keyProblem = "mismatch"; return render(); }
    const kp = await Secret.pair();
    secretKey = await Secret.shared(kp.privateKey, pub);
    send({ t: "pkey", pub: await Secret.pubRaw(kp) });
    secure = true; keyProblem = "";
  } catch (e) { keyProblem = "browser"; }
  render();
}
async function sendSecret(obj) {
  if (!secretKey) return false;
  send({ t: "sec", ...(await Secret.seal(secretKey, obj, `${room}|${myId}`)) });
  return true;
}

/* ---------- Final Jeopardy screen ---------- */
function showFinale() {
  const p = players[me];
  const head = `<div class="me"><span class="nm">${esc(p.name)}</span><span class="sc">${fmt(p.score)}</span></div>
    <h2 class="fj-title">Final Jeopardy</h2>`;
  let body = "";
  const paperNote = why => `<p class="msg">${why}</p><p class="fj-big">✍️ Write your ${fin.stage === "wager" ? "wager" : "answer"} on paper and hand it to the host.</p>`;
  if (fin.stage === "reveal") body = `<p class="fj-big">👀 Watch the big screen!</p><p class="msg">The results are being revealed one player at a time.</p>`;
  else if (!fin.eligible) body = `<p class="fj-big">You're sitting this one out.</p><p class="msg">Only players with a score above $0 can wager. Cheer everyone on!</p>`;
  else if (keyProblem) body = paperNote(keyProblem === "link" ? "Private answers only work from the QR code or full link. Scan it to send your wager and answer from this phone."
    : keyProblem === "mismatch" ? "This phone couldn't confirm it's talking to the real game, so it won't send anything private."
    : "This browser can't send private answers.");
  else if (fin.mode !== "phone") body = paperNote("The host is collecting wagers and answers on paper for you.");
  else if (!secure || !fin.secure) body = paperNote("Setting up a private connection…");
  else if (fin.stage === "wager") {
    if (fin.wager === "locked") body = `<p class="fj-big">🔒 Wager locked${myWager !== null ? `: <strong>${fmt(myWager)}</strong>` : ""}</p><p class="msg">Only you and the host can see it. Wait for the clue!</p>`;
    else body = `<p class="msg">Read the category on the big screen, then pick your wager. Only the host's game will see it.</p>
      <label class="fj-label">Your wager ($0 to ${fmt(fin.cap)})
        <input id="fjWager" class="fj-input" type="number" inputmode="numeric" min="0" max="${fin.cap}" step="1" placeholder="0" value="${myWager ?? ""}"></label>
      <button class="btn primary" id="fjLock">🔒 Lock my wager</button><p id="fjMsg" class="detail"></p>`;
  } else if (fin.stage === "answer" || fin.stage === "closed") {
    if (fin.answer === "submitted") body = `<p class="fj-big">✓ Answer submitted</p>${myAnswer ? `<p class="fj-mine">${esc(myAnswer)}</p>` : ""}<p class="msg">It stays hidden until your reveal.</p>`;
    else if (fin.stage === "closed") body = `<p class="fj-big">✏️ Pens down!</p><p class="msg">Time ran out before an answer was sent.</p>`;
    else body = `<label class="fj-label">Your answer (one try)
        <textarea id="fjAnswer" class="fj-input" rows="3" maxlength="200" placeholder="What is…">${esc(myAnswer)}</textarea></label>
      <button class="btn primary" id="fjSend">Submit my answer</button><p id="fjMsg" class="detail"></p>`;
  } else body = `<p class="fj-big">Get ready for Final Jeopardy!</p>`;
  const active = document.activeElement && document.activeElement.id;
  const typing = active === "fjWager" || active === "fjAnswer" ? { id: active, value: document.activeElement.value } : null;
  screen.innerHTML = `<div class="fj">${head}${body}</div>`;
  if (typing && $(typing.id)) { $(typing.id).value = typing.value; $(typing.id).focus(); }
  if ($("fjLock")) $("fjLock").onclick = async () => {
    const v = Math.floor(+$("fjWager").value);
    if (!($("fjWager").value !== "" && v >= 0 && v <= fin.cap)) { $("fjMsg").textContent = `Pick a whole number from 0 to ${fin.cap}.`; return buzz(80); }
    myWager = v;
    $("fjMsg").textContent = (await sendSecret({ t: "wager", amount: v })) ? "Sending…" : "Not connected privately yet.";
    buzz(30);
  };
  if ($("fjSend")) $("fjSend").onclick = async () => {
    const text = $("fjAnswer").value.trim().slice(0, 200);
    if (!text) { $("fjMsg").textContent = "Type an answer first."; return buzz(80); }
    if (!confirm("Submit this answer? You only get one.")) return;
    myAnswer = text;
    $("fjMsg").textContent = (await sendSecret({ t: "answer", text })) ? "Sending…" : "Not connected privately yet.";
    buzz(30);
  };
}

function showJoin(failed) {
  screen.innerHTML = `
    <p class="msg">Enter the 4-letter code shown on the game screen.</p>
    <input id="code" class="code-in" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(room)}" aria-label="Game code">
    <button class="btn primary" id="go">Join game</button>`;
  const go = () => {
    const code = $("code").value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (code.length !== 4) return;
    if (code !== room) { fingerprint = null; params.delete("k"); }   // a typed code has no key fingerprint
    room = code; linked = false; joined = false;
    params.set("room", room); history.replaceState(null, "", "?" + params);
    connect();
  };
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  stayAwake();
  if (!client) connect();
  else if (linked) hello();          // after the phone slept: say hello again and re-sync the clock
});
stayAwake();

if (room) connect(); else showJoin();
