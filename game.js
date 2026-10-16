"use strict";

/* =========================================================
   Game data
   Blank template: replace every "" with your own text.
   Each clue is [clue, answer], ordered easiest (row 1) to hardest (row 5).
   You can also fill everything in from the browser with "Edit clues".
   ========================================================= */
const CATEGORIES = 4;         // categories per round on a new board; add or delete them in Edit clues
const MAX_CATEGORIES = 8;     // the most columns a round can have

const blankCat = () => ({ name: "", clues: [["", ""], ["", ""], ["", ""], ["", ""], ["", ""]] });

const ROUNDS = [
  { name: "Jeopardy",        values: [100, 200, 300, 400, 500],  cats: Array.from({ length: CATEGORIES }, blankCat) },
  { name: "Double Jeopardy", values: [200, 400, 600, 800, 1000], cats: Array.from({ length: CATEGORIES }, blankCat) }
];

const FINAL = { cat: "", clue: "", answer: "" };

/* Settings */
const FINAL_SECONDS = 30;     // Final Jeopardy countdown
const DAILY_DOUBLES = [1, 2]; // how many Daily Doubles hide in Jeopardy and in Double Jeopardy (at most one per category)

/* Starting sound levels, 0–100. Players can change them in the Sound panel (header → Sound),
   and their choice is remembered; "Reset to defaults" there brings these back. */
const SOUND = { master: 100, music: 60, sfx: 80, hover: 60, echo: 50 };

/* Player looks: each player picks a color and a pattern in their podium's edit pop-up.
   Add or change entries freely; colors are "#rrggbb". */
const COLORS = [
  ["Crimson", "#e63946"], ["Royal", "#4361ee"], ["Emerald", "#06a77d"], ["Tangerine", "#f77f00"],
  ["Violet", "#8338ec"], ["Magenta", "#ff006e"], ["Teal", "#00b4d8"], ["Sunflower", "#f4c430"],
  ["Lime", "#8ac926"], ["Coral", "#ff7b6b"], ["Slate", "#8d99ae"], ["Bronze", "#c08552"]
];
const PATTERNS = [
  ["stripes", "Stripes"], ["dots", "Dots"], ["checks", "Checks"], ["zigzag", "Zigzag"], ["diamonds", "Diamonds"],
  ["waves", "Waves"], ["grid", "Grid"], ["pinstripe", "Pinstripes"], ["confetti", "Confetti"], ["solid", "Solid"]
];

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
let control = 0;      // the last player to answer right; the Daily Double screen starts with them picked
let look = null;      // the color and pattern being edited in a player pop-up

function fresh() {
  return {
    players: ["Player 1", "Player 2", "Player 3", "Player 4"].map((name, i) => ({ name, score: 0, ...defaultLook(i) })),
    used: {},        // { "0-2-3": true }
    cols: ROUNDS.map(() => CATEGORIES),           // columns in each round
    dd: pickDD({}, ROUNDS.map(() => CATEGORIES)), // Daily Double keys
    edits: {},       // custom clues ("0-2-3": [q, a]), category names ("cat-0-2"), final
    final: { wagers: {}, judged: {} }
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.players) {
      const base = fresh();
      const st = { ...base, ...s, final: { ...base.final, ...(s.final || {}) } };
      st.players = st.players.map((p, i) => ({ ...p, ...lookOf(p, i) }));
      st.cols = ROUNDS.map((_, r) => {
        const n = Array.isArray(s.cols) ? Math.round(s.cols[r]) : NaN;
        return n >= 1 && n <= MAX_CATEGORIES ? n : CATEGORIES;
      });
      // A save from a board with more columns could hide a Daily Double off the board: pick again
      if (!Array.isArray(st.dd) || st.dd.some(k => { const { r, c } = parseKey(k); return !ROUNDS[r] || c >= st.cols[r]; }))
        st.dd = pickDD(st.used, st.cols);
      return st;
    }
  } catch (e) {}
  return fresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* Daily Doubles: DAILY_DOUBLES per round, in different categories, rows 3–5 only,
   never on a tile that has already been played */
function pickDD(used = {}, cols = S.cols) {
  return ROUNDS.flatMap((_, r) => pickRoundDD(r, DAILY_DOUBLES[r] | 0, used, cols[r]));
}
// `count` Daily Doubles for round r, skipping the categories listed in `skip`
function pickRoundDD(r, count, used, ncol, skip = []) {
  const open = c => [2, 3, 4].filter(i => !used[`${r}-${c}-${i}`]);
  const cats = Array.from({ length: ncol }, (_, c) => c).filter(c => !skip.includes(c) && open(c).length);
  return shuffle(cats).slice(0, Math.max(0, count)).map(c => {
    const rows = open(c);
    return `${r}-${c}-${rows[Math.floor(Math.random() * rows.length)]}`;
  });
}
// After a column is deleted, hide new Daily Doubles to make up the round's count
function topUpDD() {
  ROUNDS.forEach((_, r) => {
    const have = S.dd.filter(k => parseKey(k).r === r);
    const need = Math.min(DAILY_DOUBLES[r] | 0, S.cols[r]) - have.length;
    if (need > 0) S.dd.push(...pickRoundDD(r, need, S.used, S.cols[r], have.map(k => parseKey(k).c)));
  });
}

/* Player looks */
function defaultLook(i) {
  return { color: COLORS[i % COLORS.length][1], pattern: PATTERNS[i % (PATTERNS.length - 1)][0] };
}
function lookOf(p, i) {
  const d = defaultLook(i);
  return {
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : d.color,
    pattern: PATTERNS.some(([k]) => k === p.pattern) ? p.pattern : d.pattern
  };
}
// class and style attributes that paint an element in player i's look
function paint(i, cls = "") {
  const L = lookOf(S.players[i], i);
  return `class="${cls} pl pat-${L.pattern}" style="--pc:${L.color}"`;
}
const pcolor = i => lookOf(S.players[i], i).color;
const chip = i => `<span ${paint(i, "chip")} aria-hidden="true"></span>`;
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

// Clues written in ROUNDS come first; columns beyond them start blank
const codeCat = (r, c) => ROUNDS[r].cats[c] || blankCat();
function rawCatName(r, c) { return S.edits[`cat-${r}-${c}`] ?? codeCat(r, c).name; }
function catName(r, c) { return rawCatName(r, c) || `Category ${c + 1}`; }
function clueOf(k) {
  const { r, c, i } = parseKey(k);
  return S.edits[k] || codeCat(r, c).clues[i] || ["", ""];
}
function finalData() { return { ...FINAL, ...(S.edits.final || {}) }; }

function blanks() {
  let n = 0;
  ROUNDS.forEach((R, r) => { for (let c = 0; c < S.cols[r]; c++) {
    if (!rawCatName(r, c).trim()) n++;
    R.values.forEach((_, i) => { const [q, a] = clueOf(`${r}-${c}-${i}`); if (!q.trim() || !a.trim()) n++; });
  } });
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
     <button class="tab tool snd ${Sound.get("muted") ? "" : "on"}" data-act="sound" title="Sound settings (M mutes)">${Sound.get("muted") ? "🔇 Muted" : "🔊 Sound"}</button>`;
}

function renderBoard(r) {
  const R = ROUNDS[r];
  let h = "";
  if (editMode) {
    const n = blanks();
    h += `<p class="hint"><span>Edit mode: click any tile to change its clue, answer and category.</span>
          <span>${n ? `<strong>${n}</strong> blank${n === 1 ? "" : "s"} left in the game` : "<strong>Every clue is filled in.</strong>"}</span>
          <span><b class="dd-key">DD</b> marks this game's Daily Doubles.</span>
          <button class="btn mini" data-act="reshuffle-dd">Reshuffle Daily Doubles</button>
          <button class="btn mini" data-act="add-col" ${S.cols[r] >= MAX_CATEGORIES ? "disabled" : ""}>+ Add category</button>
          <span>${S.cols[r]} of ${MAX_CATEGORIES} categories · × on a category deletes it</span></p>`;
  }
  const cols = Array.from({ length: S.cols[r] }, (_, c) => c);
  h += `<div class="board ${editMode ? "editing" : ""}" style="--cols:${cols.length}">`;
  cols.forEach(c => h += `<div class="cat">${esc(catName(r, c))}${editMode && cols.length > 1
    ? `<button class="col-del" data-delcol="${c}" title="Delete this category" aria-label="Delete ${esc(catName(r, c))}">×</button>` : ""}</div>`);
  R.values.forEach((v, i) => cols.forEach(c => {
    const k = `${r}-${c}-${i}`;
    const [q, a] = clueOf(k);
    const blank = !q.trim() || !a.trim();
    h += `<button class="cell ${S.used[k] ? "used" : ""} ${blank ? "blank" : ""} ${editMode && S.dd.includes(k) ? "dd" : ""}" data-k="${k}"
            aria-label="${esc(catName(r, c))} for ${v}${S.used[k] ? ", used" : ""}">${v}</button>`;
  }));
  return h + `</div>`;
}

function renderScores() {
  scores.innerHTML = S.players.map((p, i) =>
    `<button ${paint(i, "pod")} data-player="${i}">
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
    return `<label class="wager" style="--pc:${pcolor(i)}">
      <span class="nm">${chip(i)}${esc(p.name)}</span>
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

function ddCount(r) {
  const n = DAILY_DOUBLES[r] | 0;
  return `${n || "no"} Daily Double${n === 1 ? "" : "s"}`;
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
      <li>Jeopardy hides ${ddCount(0)} and Double Jeopardy hides ${ddCount(1)}, never on the top two rows.</li>
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
      <li>Click a podium to rename a player, fix a score, or pick their color and pattern. <b>+ Player</b> adds one.</li>
      <li><b>Sound</b> in the header has a volume dial for everything, plus music speed and echo. Press <b>M</b> to mute or unmute.</li>
      <li><b>Edit clues</b> lets you change any clue, answer or category, and the Final. It can also add a category, or delete one with the × on its header.</li>
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
  const dd = cur && S.dd.includes(cur.k);      // Daily Doubles have their own music
  Sound.music(
    scene === "clue" ? (dd ? "dd" : `r${r}.clue`) :
    scene === "reveal" ? (dd ? "dd.reveal" : `r${r}.reveal`) :
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
  cur = { k, value: ROUNDS[r].values[i], judged: {}, only: null, pick: null, ddp: clamp(control, 0, S.players.length - 1) };
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
  return `<div class="judge" style="--pc:${pcolor(j)}">
    ${chip(j)}<span class="nm">${esc(p.name)}</span>
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
  if (next === 1) control = j;
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
      <div class="field"><span class="flabel">Who found it?</span>
        <div class="pick-player" role="radiogroup" aria-label="Who found it?">${S.players.map((p, j) =>
          `<button type="button" ${paint(j, "pp")} role="radio" aria-checked="${j === cur.ddp}" data-ddp="${j}">
             <span class="nm">${esc(p.name)}</span><span class="sc">${fmt(p.score)}</span></button>`).join("")}
        </div>
      </div>
      <label>Wager <input id="ddWager" type="number" inputmode="numeric" min="5" step="1" placeholder="5">
        <small id="ddMax">From $5 up to ${fmt(ddMax(cur.ddp))}</small>
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

function pickFinder(j) {
  cur.ddp = j;
  ov.querySelectorAll("[data-ddp]").forEach(b => b.setAttribute("aria-checked", +b.dataset.ddp === j));
  Sound.sfx("select");
  updateDDMax();
}

function updateDDMax() {
  const j = cur.ddp, max = ddMax(j), w = $("ddWager");
  $("ddMax").textContent = `From $5 up to ${fmt(max)}`;
  w.max = max;
  if (w.value !== "") w.value = clamp(Math.round(+w.value || 5), 5, max);
}

function ddGo() {
  const j = cur.ddp;
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
  look = lookOf(p, i);
  openOv(`<div class="card">
    <h2 class="title">Edit player</h2>
    <div class="look-preview pl pat-${look.pattern}" id="lookPreview" style="--pc:${look.color}">
      <span class="nm" id="lookName">${esc(p.name)}</span><span class="sc ${p.score < 0 ? "neg" : ""}">${fmt(p.score)}</span>
    </div>
    <div class="form">
      <label>Name <input id="plName" value="${esc(p.name)}"></label>
      <label>Score <input id="plScore" type="number" inputmode="numeric" step="1" value="${p.score}"></label>
      <div class="field"><span class="flabel">Color</span>
        <div class="swatches" role="radiogroup" aria-label="Color">${COLORS.map(([name, c]) =>
          `<button type="button" class="swatch" role="radio" data-color="${c}" style="--pc:${c}" title="${name}" aria-label="${name}"
             aria-checked="${c.toLowerCase() === look.color.toLowerCase()}"></button>`).join("")}
          <span class="swatch custom" title="Any color"><input type="color" id="plColor" value="${look.color}" aria-label="Pick any color"></span>
        </div>
      </div>
      <div class="field"><span class="flabel">Pattern</span>
        <div class="swatches" role="radiogroup" aria-label="Pattern">${PATTERNS.map(([k, name]) =>
          `<button type="button" class="swatch pl pat-${k}" role="radio" data-pattern="${k}" style="--pc:${look.color}" title="${name}"
             aria-label="${name}" aria-checked="${k === look.pattern}"></button>`).join("")}
        </div>
      </div>
    </div>
    <div class="row">
      ${S.players.length > 1 ? `<button class="btn danger" data-act="remove-player" data-p="${i}">Remove</button>` : ""}
      <button class="btn ghost" data-act="close">Cancel</button>
      <button class="btn primary" data-act="save-player" data-p="${i}">Save</button>
    </div>
  </div>`);
}

/* Update the look being edited: preview, swatch states and pattern tints, without a redraw */
function setLook(change) {
  if (change.color && !/^#[0-9a-f]{6}$/i.test(change.color)) return;
  Object.assign(look, change);
  const pv = $("lookPreview");
  pv.className = `look-preview pl pat-${look.pattern}`;
  pv.style.setProperty("--pc", look.color);
  ov.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-checked", b.dataset.color.toLowerCase() === look.color.toLowerCase()));
  ov.querySelectorAll("[data-pattern]").forEach(b => {
    b.style.setProperty("--pc", look.color);
    b.setAttribute("aria-checked", b.dataset.pattern === look.pattern);
  });
  $("plColor").value = look.color;
}

function savePlayer(i) {
  const p = S.players[i];
  p.name = $("plName").value.trim() || p.name;
  Object.assign(p, look);
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
  S.players.push({ name: `Player ${S.players.length + 1}`, score: 0, ...defaultLook(S.players.length) });
  Sound.sfx("add");
  save(); renderScores();
  if (view === "final") render();
}

/* =========================================================
   Columns: add a blank category, or delete one and shift the rest left
   ========================================================= */
function addColumn(r) {
  const c = S.cols[r];
  if (c >= MAX_CATEGORIES) return;
  // clear anything left over at this position from an earlier, wider board
  delete S.edits[`cat-${r}-${c}`];
  ROUNDS[r].values.forEach((_, i) => { delete S.edits[`${r}-${c}-${i}`]; delete S.used[`${r}-${c}-${i}`]; });
  S.cols[r] = c + 1;
  Sound.sfx("add");
  save(); render();
}

function deleteColumn(r, c) {
  const n = S.cols[r], rows = ROUNDS[r].values.length;
  if (n <= 1 || c < 0 || c >= n) return;
  const key = (cc, i) => `${r}-${cc}-${i}`;
  const filled = rawCatName(r, c).trim() || ROUNDS[r].values.some((_, i) => clueOf(key(c, i)).some(x => x.trim()));
  if (filled && !confirm(`Delete "${catName(r, c)}" and all of its clues? This can't be undone.`)) return;

  // Take a snapshot of every column, drop one, then write them back in their new places
  const snap = Array.from({ length: n }, (_, cc) => ({
    name: rawCatName(r, cc),
    clues: Array.from({ length: rows }, (_, i) => [...clueOf(key(cc, i))]),
    used: Array.from({ length: rows }, (_, i) => !!S.used[key(cc, i)]),
    dd: S.dd.filter(k => { const p = parseKey(k); return p.r === r && p.c === cc; }).map(k => parseKey(k).i)
  }));
  snap.splice(c, 1);
  for (let cc = 0; cc < n; cc++) {
    delete S.edits[`cat-${r}-${cc}`];
    for (let i = 0; i < rows; i++) { delete S.edits[key(cc, i)]; delete S.used[key(cc, i)]; }
  }
  S.dd = S.dd.filter(k => parseKey(k).r !== r);
  snap.forEach((col, cc) => {
    S.edits[`cat-${r}-${cc}`] = col.name;
    col.clues.forEach((qa, i) => { S.edits[key(cc, i)] = qa; if (col.used[i]) S.used[key(cc, i)] = true; });
    col.dd.forEach(i => S.dd.push(key(cc, i)));
  });
  S.cols[r] = n - 1;
  topUpDD();                     // a deleted Daily Double hides somewhere else
  Sound.sfx("remove");
  save(); render();
}

function newGame() {
  if (!confirm("Start a new game? Scores, used tiles and Daily Doubles reset. Names and clues stay.")) return;
  S = { ...fresh(), players: S.players.map(p => ({ ...p, score: 0 })), edits: S.edits, cols: S.cols };
  S.dd = pickDD();
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
  return `<div class="judge" id="fj-${i}" style="--pc:${pcolor(i)}">
    ${chip(i)}<span class="nm">${esc(p.name)}</span>
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
        <span class="nm">${chip(p.i)}${esc(p.name)}</span>
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
   Sound panel: a volume dial for each kind of sound
   ========================================================= */
const KNOBS = [   // [setting, label, its on/off switch]
  ["master", "Master", "muted"], ["music", "Music", "musicOn"], ["sfx", "Sound effects", "sfxOn"],
  ["hover", "Hover blips", "hoverOn"], ["echo", "Room echo", null]
];
const SPEEDS = [[.85, "Slower"], [1, "Normal"], [1.15, "Faster"]];

function soundHTML() {
  return `<div class="card sound-card">
    <h2 class="title">Sound</h2>
    <div class="knobs">${KNOBS.map(knobHTML).join("")}</div>
    <div class="sound-opts">
      <div class="field"><span class="flabel">Music speed</span>
        <div class="seg" role="radiogroup" aria-label="Music speed">${SPEEDS.map(([v, label]) =>
          `<button type="button" role="radio" data-speed="${v}" aria-checked="${Sound.get("speed") === v}">${label}</button>`).join("")}
        </div>
      </div>
      <button type="button" class="tgl wide" data-snd="duck" aria-pressed="${Sound.get("duck")}">Quieter music while a clue is open</button>
    </div>
    <p class="hint">Drag a dial up or down, scroll over it, or use the arrow keys. Double-click a dial to reset it. Press M anytime to mute.</p>
    <div class="row">
      <button class="btn ghost" data-act="sound-reset">Reset to defaults</button>
      <button class="btn primary" data-act="close">Done</button>
    </div>
  </div>`;
}

function knobHTML([k, label, sw]) {
  const v = Sound.get(k), on = sw === "muted" ? !Sound.get("muted") : sw ? Sound.get(sw) : true;
  return `<div class="knob-box ${on ? "" : "off"}">
    <div class="knob" role="slider" tabindex="0" data-knob="${k}" aria-label="${label}${k === "echo" ? "" : " volume"}"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-valuetext="${v}%" style="--v:${v}">
      <span class="knob-cap"><span class="knob-val">${v}</span></span>
    </div>
    <span class="knob-label">${label}</span>
    ${sw ? `<button type="button" class="tgl" data-snd="${sw}" aria-pressed="${on}" aria-label="${label} on/off">${on ? "On" : "Off"}</button>` : ""}
  </div>`;
}

function setKnob(el, v) {
  v = clamp(Math.round(v), 0, 100);
  const k = el.dataset.knob;
  if (v === Sound.get(k)) return;
  Sound.set(k, v);
  el.style.setProperty("--v", v);
  el.setAttribute("aria-valuenow", v); el.setAttribute("aria-valuetext", v + "%");
  el.querySelector(".knob-val").textContent = v;
  knobFeedback(k);
}

// Let people hear the new level while turning a dial (the music speaks for itself)
const lastFeedback = {};
function knobFeedback(k) {
  const now = performance.now();
  if (now - (lastFeedback[k] || 0) < (k === "echo" ? 450 : 110)) return;
  lastFeedback[k] = now;
  if (k === "hover") Sound.blip(0);
  else if (k === "echo") Sound.sfx("right");
  else if (k !== "music") Sound.sfx("tick");
}

function toggleSnd(btn) {
  const k = btn.dataset.snd, value = !Sound.get(k);
  Sound.set(k, value);
  const on = k === "muted" ? !value : value;
  btn.setAttribute("aria-pressed", on);
  if (!btn.classList.contains("wide")) btn.textContent = on ? "On" : "Off";
  const box = btn.closest(".knob-box");
  if (box) box.classList.toggle("off", !on);
  Sound.sfx(on ? "toggleOn" : "toggleOff");
  renderNav();
}

function toggleMute() {
  Sound.set("muted", !Sound.get("muted"));
  const b = ov.querySelector('[data-snd="muted"]');
  if (b) { const on = !Sound.get("muted"); b.setAttribute("aria-pressed", on); b.textContent = on ? "On" : "Off"; b.closest(".knob-box").classList.toggle("off", !on); }
  Sound.sfx(Sound.get("muted") ? "toggleOff" : "toggleOn");
  renderNav();
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
  if (t.dataset.ddp) return pickFinder(+t.dataset.ddp);
  if (t.dataset.delcol) return deleteColumn(view === "r1" ? 1 : 0, +t.dataset.delcol);
  if (t.dataset.color) { Sound.sfx("select"); return setLook({ color: t.dataset.color }); }
  if (t.dataset.pattern) { Sound.sfx("select"); return setLook({ pattern: t.dataset.pattern }); }
  if (t.dataset.snd) return toggleSnd(t);
  if (t.dataset.speed) {
    Sound.set("speed", +t.dataset.speed);
    ov.querySelectorAll("[data-speed]").forEach(b => b.setAttribute("aria-checked", b === t));
    return Sound.sfx("select");
  }
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
    case "sound":         Sound.sfx("pop"); return openOv(soundHTML());
    case "sound-reset":   Sound.reset(); Sound.sfx("save"); swapOv(soundHTML()); return renderNav();
    case "add-col":       return addColumn(view === "r1" ? 1 : 0);
    case "reshuffle-dd":  S.dd = pickDD(S.used); save(); Sound.sfx("shuffle"); return render();
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
  if (t.matches("input, select") && t.type !== "color") Sound.sfx("tick");
});

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "plColor") setLook({ color: t.value });
  if (t.id === "plName") $("lookName").textContent = t.value || "Player";
});

/* Dials: drag up/down (or left/right), scroll, arrow keys; double-click resets */
let drag = null;
document.addEventListener("pointerdown", e => {
  const k = e.target.closest(".knob");
  if (!k) return;
  e.preventDefault();
  k.focus({ preventScroll: true });
  k.setPointerCapture(e.pointerId);
  drag = { el: k, x: e.clientX, y: e.clientY, v: Sound.get(k.dataset.knob) };
});
document.addEventListener("pointermove", e => {
  if (drag) setKnob(drag.el, drag.v + (drag.y - e.clientY + e.clientX - drag.x) * .5);
});
["pointerup", "pointercancel"].forEach(ev => document.addEventListener(ev, () => { drag = null; }));
document.addEventListener("wheel", e => {
  const k = e.target.closest(".knob");
  if (!k) return;
  e.preventDefault();
  setKnob(k, Sound.get(k.dataset.knob) + (e.deltaY < 0 ? 2 : -2));
}, { passive: false });
document.addEventListener("dblclick", e => {
  const k = e.target.closest(".knob");
  if (k) setKnob(k, Sound.defaults()[k.dataset.knob]);
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
const CLICKABLE = "button, input, select, textarea, [role=slider]";
let hoverSig = null, keyNav = false;

function hoverBlip(el) {
  if (el.disabled) return;
  if (el.dataset.k) {
    const { c, i } = parseKey(el.dataset.k);
    const mid = (S.cols[parseKey(el.dataset.k).r] - 1) / 2;
    return Sound.blip(i * 2, mid ? (c - mid) / mid * .85 : 0);
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
  const typing = e.target.matches("input, textarea, select");
  if ((e.key === "m" || e.key === "M") && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) return toggleMute();
  const knob = e.target.closest && e.target.closest(".knob");
  if (knob) {
    const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 10, PageDown: -10 }[e.key];
    const v = Sound.get(knob.dataset.knob);
    if (step) { e.preventDefault(); return setKnob(knob, v + step); }
    if (e.key === "Home") { e.preventDefault(); return setKnob(knob, 0); }
    if (e.key === "End") { e.preventDefault(); return setKnob(knob, 100); }
  }
  if (ov.hidden || closing) return;
  if (e.key === "Escape") { e.preventDefault(); closeOv(); }
  else if (e.key === "Enter" && e.target.matches("input, select")) {
    e.preventDefault();
    const go = ov.querySelector(".btn.primary");
    if (go) go.click();
  }
});

render();
