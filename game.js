"use strict";

/* =========================================================
   Game data
   Blank template: replace every "" with your own text.
   Each clue is [clue, answer], ordered easiest (row 1) to hardest (row 5).
   You can also fill everything in from the browser with "Edit clues".
   ========================================================= */
const blankCat = () => ({ name: "", clues: [["", ""], ["", ""], ["", ""], ["", ""], ["", ""]] });

const ROUNDS = [
  { name: "Jeopardy",        values: [100, 200, 300, 400, 500],  cats: Array.from({ length: 6 }, blankCat) },
  { name: "Double Jeopardy", values: [200, 400, 600, 800, 1000], cats: Array.from({ length: 6 }, blankCat) }
];

const FINAL = { cat: "", clue: "", answer: "" };

/* Settings */
const FINAL_SECONDS = 30;     // Final Jeopardy countdown
const SOUND = { music: 0.6, sfx: 0.8, hover: 1 };  // volumes from 0 to 1 (hover is relative to sfx; 0 turns hover blips off)

/* House rules template: an optional side game on top of the points.
   Turn it into whatever fits the crowd (prizes, forfeits, chores, candy...).
   Every field starts blank, and blank fields never show up in the game.
   In any text, {n} is replaced with a number:
     miss / right  → the clue's row, 1 (top) to 5 (bottom)
     ddRight / ddWrong → the amount picked on the Daily Double screen */
const HOUSE = {
  title: "",       // heading on the Rules tab,               e.g. "Prizes"
  miss: "",        // shown on every clue card,               e.g. "Miss: {n} push-ups"
  right: "",       // shown on clue cards in rightRows,       e.g. "Right: pick a sticker"
  rightRows: [3, 4], // rows that show `right` (0 = top row, 4 = bottom row)
  ddPick: "",      // label for a 1–5 picker on Daily Doubles, e.g. "Tickets on the line"
  ddRight: "",     // Daily Double, right answer,             e.g. "Right: win {n} tickets"
  ddWrong: "",     // Daily Double, wrong answer,             e.g. "Wrong: lose {n} tickets"
  winner: "",      // under the winner in the final standings, e.g. "Picks the next game"
  last: "",        // under last place,                        e.g. "Does the dishes"
  rest: "",        // under everyone else
  rules: []        // extra bullet points for the Rules tab,  e.g. ["Ties split the prize."]
};

/* =========================================================
   State
   ========================================================= */
const KEY = "bearcat-jeopardy-v1";
let S = load();       // the game state
let view = "r0";      // r0 | r1 | final | rules
let editMode = false; // "Edit clues" toggle
let cur = null;       // the clue card that is open: { k, value, judged, only, pick }
let scene = null;     // what the overlay shows, for the music: clue | reveal | final-clue | final-reveal | standings

function fresh() {
  return {
    players: ["Player 1", "Player 2", "Player 3", "Player 4"].map(name => ({ name, score: 0 })),
    used: {},        // { "0-2-3": true }
    dd: pickDD(),    // Daily Double keys
    edits: {},       // custom clues ("0-2-3": [q, a]), category names ("cat-0-2"), final
    final: { wagers: {}, judged: {} }
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.players) {
      const base = fresh();
      return { ...base, ...s, final: { ...base.final, ...(s.final || {}) } };
    }
  } catch (e) {}
  return fresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* Daily Doubles: 1 in round 1, 2 in round 2, different categories, rows 3–5 only */
function pickDD() {
  const out = [];
  [[0, 1], [1, 2]].forEach(([round, count]) => {
    shuffle([0, 1, 2, 3, 4, 5]).slice(0, count)
      .forEach(c => out.push(`${round}-${c}-${2 + Math.floor(Math.random() * 3)}`));
  });
  return out;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================================================
   Helpers
   ========================================================= */
const $ = id => document.getElementById(id);
const nav = $("nav"), main = $("main"), scores = $("scores"), ov = $("overlay");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function fmt(n) { return (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString(); }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function house(text, n) { return String(text || "").trim().replace(/\{n\}/g, n); }
function parseKey(k) { const [r, c, i] = k.split("-").map(Number); return { r, c, i }; }

function rawCatName(r, c) { return S.edits[`cat-${r}-${c}`] ?? ROUNDS[r].cats[c].name; }
function catName(r, c) { return rawCatName(r, c) || `Category ${c + 1}`; }
function clueOf(k) {
  const { r, c, i } = parseKey(k);
  return S.edits[k] || ROUNDS[r].cats[c].clues[i];
}
function finalData() { return { ...FINAL, ...(S.edits.final || {}) }; }

function blanks() {
  let n = 0;
  ROUNDS.forEach((R, r) => R.cats.forEach((C, c) => {
    if (!rawCatName(r, c).trim()) n++;
    C.clues.forEach((_, i) => { const [q, a] = clueOf(`${r}-${c}-${i}`); if (!q.trim() || !a.trim()) n++; });
  }));
  const F = finalData();
  ["cat", "clue", "answer"].forEach(f => { if (!String(F[f]).trim()) n++; });
  return n;
}

/* Final Jeopardy: anyone with a positive score plays; once judged they stay listed */
function finalists() {
  return S.players.map((p, i) => i).filter(i => S.final.judged[i] !== undefined || S.players[i].score > 0);
}

/* =========================================================
   Rendering
   ========================================================= */
const TABS = [["r0", "Jeopardy"], ["r1", "Double Jeopardy"], ["final", "Final"], ["rules", "Rules"]];

function renderNav() {
  nav.innerHTML = TABS.map(([v, label]) =>
    `<button class="tab ${view === v ? "on" : ""}" data-view="${v}" ${view === v ? 'aria-current="page"' : ""}>${label}</button>`).join("") +
    `<span class="nav-sp"></span>
     <button class="tab tool ${editMode ? "on" : ""}" data-act="edit-mode" aria-pressed="${editMode}">${editMode ? "Done editing" : "Edit clues"}</button>
     <button class="tab tool" data-act="new-game">New game</button>
     <button class="tab tool snd ${Sound.musicOn ? "on" : ""}" data-act="music" aria-pressed="${Sound.musicOn}" title="Music on/off">♪ Music</button>
     <button class="tab tool snd ${Sound.sfxOn ? "on" : ""}" data-act="sfx" aria-pressed="${Sound.sfxOn}" title="Sound effects on/off">Sound FX</button>`;
}

function renderBoard(r) {
  const R = ROUNDS[r];
  let h = "";
  if (editMode) {
    const n = blanks();
    h += `<p class="hint"><span>Edit mode: click any tile to change its clue, answer and category.</span>
          <span>${n ? `<strong>${n}</strong> blank${n === 1 ? "" : "s"} left in the game` : "<strong>Every clue is filled in.</strong>"}</span></p>`;
  }
  h += `<div class="board ${editMode ? "editing" : ""}">`;
  R.cats.forEach((_, c) => h += `<div class="cat">${esc(catName(r, c))}</div>`);
  R.values.forEach((v, i) => R.cats.forEach((_, c) => {
    const k = `${r}-${c}-${i}`;
    const [q, a] = clueOf(k);
    const blank = !q.trim() || !a.trim();
    h += `<button class="cell ${S.used[k] ? "used" : ""} ${blank ? "blank" : ""}" data-k="${k}"
            aria-label="${esc(catName(r, c))} for ${v}${S.used[k] ? ", used" : ""}">${v}</button>`;
  }));
  return h + `</div>`;
}

function renderScores() {
  scores.innerHTML = S.players.map((p, i) =>
    `<button class="pod" data-player="${i}">
       <span class="nm">${esc(p.name)}</span>
       <span class="sc ${p.score < 0 ? "neg" : ""}">${fmt(p.score)}</span>
     </button>`).join("") + `<button class="pod add" id="addPlayer">+ Player</button>`;
}

function renderFinal() {
  const F = finalData();
  if (editMode) {
    const n = blanks();
    return `<div class="final">
      <p class="eyebrow">Edit Final Jeopardy</p>
      <div class="form">
        <label>Category <input id="fnCat" value="${esc(F.cat)}"></label>
        <label>Clue <textarea id="fnQ" rows="3">${esc(F.clue)}</textarea></label>
        <label>Answer <input id="fnA" value="${esc(F.answer)}"></label>
      </div>
      <div class="row"><button class="btn primary" data-act="save-final">Save Final</button></div>
      <p class="hint">${n ? `<strong>${n}</strong>&nbsp;blank${n === 1 ? "" : "s"} left in the game` : "Every clue is filled in."}</p>
    </div>`;
  }
  const list = finalists();
  const wagers = list.length ? list.map(i => {
    const p = S.players[i], judged = S.final.judged[i] !== undefined;
    return `<label class="wager">
      <span class="nm">${esc(p.name)}</span>
      <span class="cap">${judged ? "Judged" : `Up to ${fmt(p.score)}`}</span>
      <input type="number" inputmode="numeric" min="0" max="${Math.max(0, p.score)}" step="1"
             data-wager="${i}" value="${S.final.wagers[i] ?? ""}" placeholder="0" ${judged ? "disabled" : ""}>
    </label>`;
  }).join("") : `<p class="muted">No one has a positive score, so no one can wager.</p>`;
  return `<div class="final">
    <p class="eyebrow">Final Jeopardy · Category</p>
    <h2 class="final-cat">${esc(F.cat) || "Category to come"}</h2>
    <div class="wagers">${wagers}</div>
    <div class="row">
      <button class="btn primary" data-act="final-clue">Reveal clue</button>
      <button class="btn" data-act="standings">Final standings</button>
    </div>
  </div>`;
}

function renderRules() {
  const top = r => fmt(Math.max(...ROUNDS[r].values));
  return `<div class="rules">
    <h2>Playing a clue</h2>
    <ul>
      <li>Pick a category and a value. The host reads the clue; the first player to answer in the form of a question gets it.</li>
      <li>Right adds the value to your score. Wrong takes it away, and someone else can try.</li>
      <li>The host marks each player with ✓ or ✗, then taps <b>Done, mark used</b>.</li>
    </ul>
    <h2>Daily Doubles</h2>
    <ul>
      <li>One is hidden in Jeopardy, two in Double Jeopardy, never on the top row.</li>
      <li>Only the player who found it answers. Wager from $5 up to your score, or up to ${top(0)} / ${top(1)} if your score is lower.</li>
    </ul>
    <h2>Final Jeopardy</h2>
    <ul>
      <li>Everyone with a positive score wagers up to their score after seeing the category.</li>
      <li>You get ${FINAL_SECONDS} seconds to write your answer once the clue is revealed.</li>
    </ul>
    ${HOUSE.rules.length ? `<h2>${esc(HOUSE.title.trim() || "House rules")}</h2>
    <ul>${HOUSE.rules.map(line => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
    <h2>Host controls</h2>
    <ul>
      <li>Click a podium to rename a player or fix a score. <b>+ Player</b> adds one.</li>
      <li><b>Edit clues</b> lets you change any clue, answer or category, and the Final.</li>
      <li><b>New game</b> resets scores, used tiles and Daily Doubles but keeps names and clues.</li>
      <li>Everything saves in this browser, so a refresh won't lose the game.</li>
    </ul>
  </div>`;
}

function render() {
  renderNav(); renderScores();
  main.innerHTML = view === "r0" ? renderBoard(0)
                 : view === "r1" ? renderBoard(1)
                 : view === "rules" ? renderRules() : renderFinal();
  updateMusic();
}

/* Each round has three moods that follow the clue: board → clue → answer revealed */
function updateMusic() {
  const r = cur ? parseKey(cur.k).r : view === "r1" ? 1 : 0;
  Sound.music(
    scene === "clue" ? `r${r}.clue` :
    scene === "reveal" ? `r${r}.reveal` :
    scene === "final-clue" ? "final.clue" :
    scene === "final-reveal" || scene === "standings" ? "final.reveal" :
    view === "r1" ? "r1.board" : view === "final" ? "final.board" : "r0.board");
}

/* =========================================================
   Overlay: zooms out of the clicked tile (FLIP)
   ========================================================= */
let sourceTile = null;
let closing = false;
let timer = null;

function setTileVars(tile) {
  const r = tile.getBoundingClientRect();
  ov.style.setProperty("--x", r.left + "px");
  ov.style.setProperty("--y", r.top + "px");
  ov.style.setProperty("--sx", r.width / innerWidth);
  ov.style.setProperty("--sy", r.height / innerHeight);
}

// Runs fn when the overlay's own transition ends, or after ms as a fallback
function afterTransition(ms, fn) {
  let done = false;
  const finish = e => {
    if (done || (e && e.target !== ov)) return;
    done = true; ov.removeEventListener("transitionend", finish); fn();
  };
  ov.addEventListener("transitionend", finish);
  setTimeout(finish, ms + 200);
}

function cssMs(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

function openOv(html, tile) {
  sourceTile = tile || null;
  if (tile) setTileVars(tile);
  else {                        // pop-ups grow from a centered card
    ov.style.setProperty("--x", "20vw"); ov.style.setProperty("--y", "20vh");
    ov.style.setProperty("--sx", 0.6);   ov.style.setProperty("--sy", 0.6);
  }
  ov.innerHTML = html;
  ov.classList.remove("open", "closing");
  ov.classList.toggle("popup", !tile);
  ov.hidden = false;
  void ov.offsetWidth;          // commit the start frame
  ov.classList.add("open");
  document.body.style.overflow = "hidden";
  const first = ov.querySelector("input, select, textarea, button");
  if (first) first.focus({ preventScroll: true });
}

/* Replace the card inside an open overlay without zooming again */
function swapOv(html) {
  ov.innerHTML = html;
  const card = ov.firstElementChild;
  if (card) card.classList.add("swap");
}

function closeOv(sound = "swooshOut") {
  if (ov.hidden || closing) return;
  closing = true;
  stopTimer();
  Sound.sfx(sound);
  scene = null; updateMusic();   // the music turns back as the card shrinks
  const key = sourceTile && sourceTile.dataset.k;
  if (sourceTile && document.contains(sourceTile)) setTileVars(sourceTile); // re-measure after resize
  ov.classList.add("closing");
  ov.classList.remove("open");
  afterTransition(cssMs("--t-open") + 120, () => {
    ov.hidden = true; ov.innerHTML = "";
    ov.classList.remove("closing", "popup");
    document.body.style.overflow = "";
    closing = false; cur = null; sourceTile = null;
    render();                    // tile now draws as used
    if (key) { const t = main.querySelector(`[data-k="${key}"]`); if (t) t.focus({ preventScroll: true }); }
  });
}

/* =========================================================
   Clue cards
   ========================================================= */
function onTile(btn) {
  const k = btn.dataset.k;
  if (editMode) { Sound.sfx("pop"); return openEditor(k, btn); }
  const { r, i } = parseKey(k);
  cur = { k, value: ROUNDS[r].values[i], judged: {}, only: null, pick: null };
  scene = "clue"; updateMusic();
  if (S.dd.includes(k)) { Sound.sfx("dd"); return openOv(ddHTML(), btn); }
  Sound.sfx("swooshIn");
  openOv(clueHTML(), btn);
}

function clueHTML() {
  const { r, c, i } = parseKey(cur.k);
  const [q, a] = clueOf(cur.k);
  const who = cur.only === null ? S.players.map((_, j) => j) : [cur.only];
  return `<div class="card">
    <div class="card-top">
      <span class="eyebrow">${esc(catName(r, c))}${cur.only !== null ? " · Daily Double" : ""}</span>
      <span class="val">${fmt(cur.value)}</span>
    </div>
    <p class="clue">${esc(q) || '<span class="muted">No clue yet. Use Edit clues to add one.</span>'}</p>
    <p class="answer" id="ans">${esc(a)}</p>
    <div class="row"><button class="btn" id="revealBtn" aria-pressed="false">Reveal answer</button></div>
    <div class="judges">${who.map(judgeHTML).join("")}</div>
    ${houseLine(i)}
    <div class="row">
      <button class="btn ghost" data-act="close">Back to board</button>
      <button class="btn primary" data-act="done">Done, mark used</button>
    </div>
  </div>`;
}

function judgeHTML(j) {
  const p = S.players[j], st = cur.judged[j] || 0;
  return `<div class="judge">
    <span class="nm">${esc(p.name)}</span>
    <button class="jb ok ${st === 1 ? "on" : ""}" data-j="${j}" data-d="1" aria-pressed="${st === 1}" aria-label="${esc(p.name)} right">✓</button>
    <button class="jb no ${st === -1 ? "on" : ""}" data-j="${j}" data-d="-1" aria-pressed="${st === -1}" aria-label="${esc(p.name)} wrong">✗</button>
  </div>`;
}

/* House-rule reminder under the judging buttons; hidden when HOUSE is blank */
function houseLine(i) {
  const parts = cur.only !== null
    ? [house(HOUSE.ddRight, cur.pick ?? ""), house(HOUSE.ddWrong, cur.pick ?? "")]
    : [house(HOUSE.miss, i + 1), HOUSE.rightRows.includes(i) ? house(HOUSE.right, i + 1) : ""];
  const text = parts.filter(Boolean).map(esc).join(" · ");
  return text ? `<p class="house">${text}</p>` : "";
}

/* ✓ / ✗ toggle: tapping the same mark again undoes it, switching marks swaps the points */
function judge(j, d) {
  if (!cur || !S.players[j]) return;
  const prev = cur.judged[j] || 0;
  const next = prev === d ? 0 : d;
  S.players[j].score += (next - prev) * cur.value;
  cur.judged[j] = next;
  Sound.sfx(next === 1 ? "right" : next === -1 ? "wrong" : "undo");
  save(); renderScores();
  ov.querySelectorAll(`[data-j="${j}"]`).forEach(b => {
    const on = +b.dataset.d === next;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  });
}

function markUsed() {
  if (cur) { S.used[cur.k] = true; save(); }
  Sound.sfx("stamp");
  closeOv();
}

/* =========================================================
   Daily Double
   ========================================================= */
function ddMax(j) {
  const { r } = parseKey(cur.k);
  return Math.max(S.players[j].score, Math.max(...ROUNDS[r].values));
}

function ddHTML() {
  const { r, c } = parseKey(cur.k);
  return `<div class="card">
    <h2 class="title dd-title">Daily Double!</h2>
    <p class="eyebrow">${esc(catName(r, c))}</p>
    <div class="form">
      <label>Who found it?
        <select id="ddPlayer">${S.players.map((p, j) => `<option value="${j}">${esc(p.name)} (${fmt(p.score)})</option>`).join("")}</select>
      </label>
      <label>Wager <input id="ddWager" type="number" inputmode="numeric" min="5" step="1" placeholder="5">
        <small id="ddMax">From $5 up to ${fmt(ddMax(0))}</small>
      </label>
      ${HOUSE.ddPick.trim() ? `<label>${esc(HOUSE.ddPick)}
        <select id="ddPick">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select>
      </label>` : ""}
    </div>
    <div class="row">
      <button class="btn ghost" data-act="close">Back to board</button>
      <button class="btn primary" data-act="dd-go">Show clue</button>
    </div>
  </div>`;
}

function updateDDMax() {
  const j = +$("ddPlayer").value, max = ddMax(j), w = $("ddWager");
  $("ddMax").textContent = `From $5 up to ${fmt(max)}`;
  w.max = max;
  if (w.value !== "") w.value = clamp(Math.round(+w.value || 5), 5, max);
}

function ddGo() {
  const j = +$("ddPlayer").value;
  const max = ddMax(j);
  const wager = clamp(Math.round(+$("ddWager").value || 5), 5, max);
  cur.value = wager;
  cur.only = j;
  cur.pick = $("ddPick") ? +$("ddPick").value : null;
  Sound.sfx("ddGo");
  swapOv(clueHTML());
  $("revealBtn").focus({ preventScroll: true });
}

/* =========================================================
   Editors: clues, players, Final
   ========================================================= */
function openEditor(k, btn) {
  const { r, c, i } = parseKey(k);
  const [q, a] = clueOf(k);
  openOv(`<div class="card">
    <p class="eyebrow">${ROUNDS[r].name} · ${fmt(ROUNDS[r].values[i])}</p>
    <div class="form">
      <label>Category <input id="edCat" value="${esc(rawCatName(r, c))}" placeholder="Category ${c + 1}"></label>
      <label>Clue <textarea id="edQ" rows="3">${esc(q)}</textarea></label>
      <label>Answer <input id="edA" value="${esc(a)}"></label>
    </div>
    <div class="row">
      <button class="btn ghost" data-act="close">Cancel</button>
      <button class="btn primary" data-act="save-edit" data-key="${k}">Save</button>
    </div>
  </div>`, btn);
}

function saveEdit(k) {
  const { r, c } = parseKey(k);
  S.edits[k] = [$("edQ").value.trim(), $("edA").value.trim()];
  S.edits[`cat-${r}-${c}`] = $("edCat").value.trim();
  Sound.sfx("save");
  save(); closeOv();
}

function saveFinal() {
  S.edits.final = { cat: $("fnCat").value.trim(), clue: $("fnQ").value.trim(), answer: $("fnA").value.trim() };
  Sound.sfx("save");
  save(); render();
}

function openPlayer(i) {
  const p = S.players[i];
  openOv(`<div class="card">
    <h2 class="title">Edit player</h2>
    <div class="form">
      <label>Name <input id="plName" value="${esc(p.name)}"></label>
      <label>Score <input id="plScore" type="number" inputmode="numeric" step="1" value="${p.score}"></label>
    </div>
    <div class="row">
      ${S.players.length > 1 ? `<button class="btn danger" data-act="remove-player" data-p="${i}">Remove</button>` : ""}
      <button class="btn ghost" data-act="close">Cancel</button>
      <button class="btn primary" data-act="save-player" data-p="${i}">Save</button>
    </div>
  </div>`);
}

function savePlayer(i) {
  const p = S.players[i];
  p.name = $("plName").value.trim() || p.name;
  const sc = Math.round(+$("plScore").value);
  if (Number.isFinite(sc)) p.score = sc;
  Sound.sfx("save");
  save(); closeOv();
}

function removePlayer(i) {
  if (S.players.length <= 1 || !confirm(`Remove ${S.players[i].name} from the game?`)) return;
  S.players.splice(i, 1);
  // Final wagers and results are keyed by player index, so shift the later ones down
  const shift = o => Object.fromEntries(Object.entries(o)
    .filter(([k]) => +k !== i).map(([k, v]) => [+k > i ? +k - 1 : +k, v]));
  S.final.wagers = shift(S.final.wagers);
  S.final.judged = shift(S.final.judged);
  Sound.sfx("remove");
  save(); closeOv();
}

function addPlayer() {
  S.players.push({ name: `Player ${S.players.length + 1}`, score: 0 });
  Sound.sfx("add");
  save(); renderScores();
  if (view === "final") render();
}

function newGame() {
  if (!confirm("Start a new game? Scores, used tiles and Daily Doubles reset. Names and clues stay.")) return;
  S = { ...fresh(), players: S.players.map(p => ({ name: p.name, score: 0 })), edits: S.edits };
  view = "r0";
  Sound.sfx("newGame");
  save(); render();
}

/* =========================================================
   Final Jeopardy
   ========================================================= */
function finalClueHTML() {
  const F = finalData();
  const list = finalists();
  return `<div class="card">
    <div class="card-top">
      <span class="eyebrow">Final Jeopardy · ${esc(F.cat) || "Category to come"}</span>
      <span class="timer" id="timer" role="timer" aria-live="off"></span>
    </div>
    <p class="clue">${esc(F.clue) || '<span class="muted">No Final clue yet. Use Edit clues on the Final tab.</span>'}</p>
    <p class="answer" id="ans">${esc(F.answer)}</p>
    <div class="row"><button class="btn" id="revealBtn" aria-pressed="false">Reveal answer</button></div>
    <div class="judges">${list.map(finalJudgeHTML).join("") || '<p class="muted">No one is playing Final Jeopardy.</p>'}</div>
    <div class="row">
      <button class="btn ghost" data-act="close">Back</button>
      <button class="btn primary" data-act="standings">Final standings</button>
    </div>
  </div>`;
}

function finalJudgeHTML(i) {
  const p = S.players[i], res = S.final.judged[i], done = res !== undefined;
  return `<div class="judge" id="fj-${i}">
    <span class="nm">${esc(p.name)}</span>
    <span class="w">${fmt(S.final.wagers[i] || 0)}</span>
    <button class="jb ok ${res === 1 ? "on" : ""}" data-fj="${i}" data-d="1" ${done ? "disabled" : ""} aria-label="${esc(p.name)} right">✓</button>
    <button class="jb no ${res === -1 ? "on" : ""}" data-fj="${i}" data-d="-1" ${done ? "disabled" : ""} aria-label="${esc(p.name)} wrong">✗</button>
  </div>`;
}

/* Each player is judged once, so a double tap can't double-count */
function judgeFinal(i, d) {
  if (S.final.judged[i] !== undefined) return;
  S.players[i].score += d * (S.final.wagers[i] || 0);
  S.final.judged[i] = d;
  Sound.sfx(d === 1 ? "right" : "wrong");
  save(); renderScores();
  const el = $(`fj-${i}`);
  if (el) el.outerHTML = finalJudgeHTML(i);
}

function startTimer() {
  stopTimer();
  let left = FINAL_SECONDS;
  const paint = () => {
    const el = $("timer");
    if (!el) return;
    el.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Pens down";
    el.classList.toggle("low", left <= 5);
  };
  paint();
  timer = setInterval(() => {
    left--; paint();
    if (left > 0 && left <= 5) Sound.sfx("countdown");
    if (left <= 0) { Sound.sfx("pensDown"); stopTimer(); }
  }, 1000);
}
function stopTimer() { clearInterval(timer); timer = null; }

function standingsHTML() {
  const ranked = S.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
  const hi = ranked[0].score, lo = ranked[ranked.length - 1].score;
  const spread = ranked.length > 1 && hi !== lo;
  return `<div class="card">
    <h2 class="title">Final standings</h2>
    <ol class="standings">${ranked.map(p => {
      const win = p.score === hi, last = spread && p.score === lo;
      const place = ranked.findIndex(q => q.score === p.score) + 1;
      const rule = house(win ? HOUSE.winner : last ? HOUSE.last : HOUSE.rest);
      return `<li class="${win ? "win" : ""} ${last ? "last" : ""}">
        <span class="place">${place}</span>
        <span class="nm">${esc(p.name)}</span>
        <span class="sc ${p.score < 0 && !win ? "neg" : ""}">${fmt(p.score)}</span>
        ${rule ? `<span class="rule">${esc(rule)}</span>` : ""}
      </li>`;
    }).join("")}</ol>
    <div class="row"><button class="btn primary" data-act="close">Close</button></div>
  </div>`;
}

function showStandings() {
  stopTimer();
  Sound.sfx("fanfare");
  scene = "standings"; updateMusic();
  if (!ov.hidden) swapOv(standingsHTML());
  else openOv(standingsHTML());
}

/* =========================================================
   Events: every click goes through one listener
   ========================================================= */
document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t || closing) return;

  if (t.dataset.k) return onTile(t);
  if (t.dataset.view) {
    Sound.sfx(t.dataset.view === "r1" && view !== "r1" ? "roundUp" : "tab");
    view = t.dataset.view; return render();
  }
  if (t.dataset.j) return judge(+t.dataset.j, +t.dataset.d);
  if (t.dataset.fj) return judgeFinal(+t.dataset.fj, +t.dataset.d);
  if (t.dataset.player) { Sound.sfx("pop"); return openPlayer(+t.dataset.player); }
  if (t.id === "addPlayer") return addPlayer();

  if (t.id === "revealBtn") {
    const ans = document.getElementById("ans");
    const on = ans.classList.toggle("shown");
    t.textContent = on ? "Hide answer" : "Reveal answer";
    t.setAttribute("aria-pressed", on);
    Sound.sfx(on ? "twinkle" : "untwinkle");
    if (scene) {
      const fin = scene.startsWith("final");
      scene = on ? (fin ? "final-reveal" : "reveal") : (fin ? "final-clue" : "clue");
      updateMusic();
    }
    return;
  }

  switch (t.dataset.act) {
    case "close":         return closeOv();
    case "done":          return markUsed();
    case "dd-go":         return ddGo();
    case "save-edit":     return saveEdit(t.dataset.key);
    case "save-final":    return saveFinal();
    case "save-player":   return savePlayer(+t.dataset.p);
    case "remove-player": Sound.sfx("click"); return removePlayer(+t.dataset.p);
    case "edit-mode":     editMode = !editMode; Sound.sfx(editMode ? "toggleOn" : "toggleOff"); return render();
    case "new-game":      Sound.sfx("click"); return newGame();
    case "final-clue":
      Sound.sfx("swooshIn"); Sound.sfx("finalReveal");
      scene = "final-clue"; updateMusic();
      openOv(finalClueHTML()); return startTimer();
    case "standings":     return showStandings();
    case "music":         Sound.toggleMusic(); Sound.sfx(Sound.musicOn ? "toggleOn" : "toggleOff"); return renderNav();
    case "sfx":           if (Sound.toggleSfx()) Sound.sfx("toggleOn"); return renderNav();
    default:              Sound.sfx("click");
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.wager !== undefined) {
    const i = +t.dataset.wager;
    const v = clamp(Math.round(+t.value || 0), 0, Math.max(0, S.players[i].score));
    S.final.wagers[i] = v; t.value = v;
    save();
  }
  if (t.id === "ddPlayer") updateDDMax();
  if (t.matches("input, select")) Sound.sfx("tick");
});

/* Browsers only allow sound after the first click or key press */
document.addEventListener("pointerdown", e => {
  Sound.unlock();
  keyNav = false;
  if (e.target.closest("input, select, textarea")) Sound.sfx("tap");
}, true);
document.addEventListener("keydown", e => {
  Sound.unlock();
  keyNav = e.key === "Tab" || e.key.startsWith("Arrow");
}, true);

/* Hover blips: a tiny tick whenever the pointer (or Tab key) lands on something clickable.
   On the board the blip also says where you are: pitch rises from the top row to the
   bottom row, and it pans left to right by column. */
const CLICKABLE = "button, input, select, textarea";
let hoverSig = null, keyNav = false;

function hoverBlip(el) {
  if (el.disabled) return;
  if (el.dataset.k) {
    const { c, i } = parseKey(el.dataset.k);
    return Sound.blip(i * 2, (c - 2.5) / 3);
  }
  Sound.blip(el.closest("#overlay") ? 5 : el.closest("#scores") ? -3 : 0);
}
// Identify a control by what it does, so a redraw under a still pointer doesn't blip again
const sig = el => el && el.tagName + JSON.stringify(el.dataset) + el.id;

document.addEventListener("pointerover", e => {
  if (e.pointerType === "touch") return;          // a tap already makes its click sound
  const el = e.target.closest(CLICKABLE), s = sig(el);
  if (s === hoverSig) return;
  hoverSig = s;
  if (el) hoverBlip(el);
});
document.addEventListener("focusin", e => {
  if (keyNav && e.target.matches(CLICKABLE)) hoverBlip(e.target);
});

document.addEventListener("keydown", e => {
  if (ov.hidden || closing) return;
  if (e.key === "Escape") { e.preventDefault(); closeOv(); }
  else if (e.key === "Enter" && e.target.matches("input, select")) {
    e.preventDefault();
    const go = ov.querySelector(".btn.primary");
    if (go) go.click();
  }
});

render();
