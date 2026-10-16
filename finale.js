"use strict";

/* =========================================================
   The finale: everything after the Final Jeopardy category.

     wager lock → clue + countdown → player-by-player reveals →
     champion → standings → Bearcat Yearbook → One Last Memory → keepsake

   Built on the game's own pieces in game.js: S (saved state), openOv/swapOv,
   paint/chip (player looks), confetti(), judgeFinal() (scores a Final answer once),
   standingsHTML(), and Sound. Every stage is saved in S.final, so a refresh resumes
   where it left off, and no stage ever applies a wager twice.
   ========================================================= */
const Finale = (() => {
  const F = () => S.final;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const name = i => esc(S.players[i] ? S.players[i].name : "?");
  const look = (i, cls) => paint(i, cls);
  const byId = id => S.players.findIndex(p => p.id === id);

  /* ---------- Wagers ----------
     Each eligible player's wager comes in one of three ways:
       phone  – sent from their phone, encrypted (only with a QR-linked phone)
       paper  – written down; the host types it in at that player's reveal
       typed  – the host types it now into a hidden field                       */
  const eligible = () => finalists();
  function source(i) {
    const s = F().src[i];
    if (s === "phone" || s === "paper" || s === "typed") return s;
    return Buzzers.securePlayers().includes(i) ? "phone" : "paper";
  }
  const allLocked = () => eligible().every(i => F().locked[i]);
  const cap = i => Math.max(0, S.players[i].score);

  // What the phones are told (no amounts, no answers)
  function phoneStage() {
    const st = F().stage;
    if (["order", "reveal", "champion", "standings", "yearbook", "memory", "done"].includes(st)) return "reveal";
    if (st === "clue") return F().timeUp ? "closed" : "answer";
    if (view === "final" && !editMode) return "wager";
    return "off";
  }
  function info(i, secureLink) {
    const stage = phoneStage();
    if (i === null || !S.players[i]) return { stage };
    const el = eligible().includes(i);
    return {
      stage, eligible: el, cap: cap(i), mode: source(i), secure: secureLink,
      wager: F().locked[i] ? "locked" : "none",
      answer: F().answers[i] ? "submitted" : "none"
    };
  }
  const tellPhones = () => Buzzers.finale();

  // A private message from a phone (already decrypted by buzzer.js)
  function secret(i, data) {
    if (i === null || !S.players[i] || !eligible().includes(i) || source(i) !== "phone") return;
    if (data.t === "wager" && phoneStage() === "wager" && !F().locked[i]) {
      const v = Math.floor(+data.amount);
      if (!(v >= 0 && v <= cap(i))) return;
      F().wagers[i] = v; F().locked[i] = true; F().src[i] = "phone";
      Sound.sfx("stamp");
      save(); if (view === "final") render(); tellPhones();
    }
    if (data.t === "answer" && F().stage === "clue" && !F().timeUp && !F().answers[i]) {
      const text = String(data.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return;
      F().answers[i] = text;
      Sound.sfx("tick");
      save(); paintResponses(); tellPhones();
    }
  }

  // The Final tab: the category and the wager-locking stage
  function wagerStageHTML() {
    const list = eligible(), Fx = F(), st = Fx.stage;
    if (st && st !== "clue") return resumeHTML();
    const left = list.filter(i => !Fx.locked[i]).length;
    const cards = list.length ? list.map(i => {
      const src = source(i), locked = !!Fx.locked[i], secureNow = Buzzers.securePlayers().includes(i);
      const amount = Fx.wagers[i];
      const shown = src === "paper" ? "Written on paper" : amount === undefined || amount === null || amount === "" ? "No wager yet"
        : Fx.show ? fmt(+amount) : "Hidden";
      return `<div class="lock-card ${locked ? "locked" : ""}" style="--pc:${pcolor(i)}">
        <div class="lc-top"><span class="nm">${chip(i)}${name(i)}</span><span class="lc-cap">$0–${fmt(cap(i))}</span></div>
        <div class="seg lc-src" role="radiogroup" aria-label="How ${name(i)} wagers">
          ${["phone", "paper", "typed"].map(s => `<button type="button" role="radio" data-fx="src" data-i="${i}" data-src="${s}" aria-checked="${src === s}"
            ${locked ? "disabled" : ""} ${s === "phone" && !secureNow && src !== "phone" ? 'disabled title="Needs a phone linked from the QR code"' : ""}>${{ phone: "📱 Phone", paper: "✍️ Paper", typed: "⌨️ Typed" }[s]}</button>`).join("")}
        </div>
        ${src === "typed" && !locked ? `<input class="lc-input" type="password" inputmode="numeric" autocomplete="off" data-wager="${i}" value="${amount ?? ""}"
            aria-label="${name(i)}'s wager (hidden)" placeholder="Type the wager">` : ""}
        <p class="lc-status">${locked ? `🔒 Locked · ${shown}` : src === "phone" ? (secureNow ? "📱 Waiting for their phone…" : "📱 Phone not linked privately") : src === "paper" ? "Collect their written wager, then lock it" : shown}</p>
        <div class="row">${locked
          ? (st === "clue" ? "" : `<button class="btn mini ghost" data-fx="unlock" data-i="${i}">Unlock</button>`)   // frozen once the clue is out
          : src === "phone" ? "" : `<button class="btn mini" data-fx="lock" data-i="${i}">🔒 Lock wager</button>`}</div>
      </div>`;
    }).join("") : `<p class="muted">No one has a score above $0, so no one can wager.</p>`;
    const out = S.players.map((p, i) => i).filter(i => !list.includes(i));
    return `<div class="final">
      <p class="eyebrow">Final Jeopardy · Category</p>
      <h2 class="final-cat">${esc(finalData().cat) || "Category to come"}</h2>
      <div class="lock-head">
        <span class="hint">${list.length ? (left ? `<strong>${left}</strong> wager${left === 1 ? "" : "s"} still to lock` : "<strong>Every wager is locked.</strong>") : ""}</span>
        <button class="btn mini ghost" data-fx="show-amounts" aria-pressed="${!!Fx.show}">${Fx.show ? "🙈 Hide amounts" : "👁 Show amounts"}</button>
      </div>
      <div class="lock-grid">${cards}</div>
      ${out.length ? `<p class="hint">Sitting out (score $0 or less): ${out.map(name).join(", ")}</p>` : ""}
      <div class="row">
        ${list.length ? `<button class="btn primary" data-act="final-clue" ${allLocked() ? "" : "disabled"} title="${allLocked() ? "" : "Lock every wager first"}">${st === "clue" ? "Back to the clue" : "Reveal clue"}</button>`
                      : `<button class="btn primary" data-fx="standings">Go to the final standings</button>`}
      </div>
    </div>`;
  }

  function lock(i) {
    const src = source(i);
    if (src === "typed") {
      const v = F().wagers[i];
      if (v === undefined || v === null || v === "" || !(+v >= 0 && +v <= cap(i))) { Sound.sfx("wrong"); return alert(`Type ${S.players[i].name}'s wager first (from $0 to ${fmt(cap(i))}).`); }
      F().wagers[i] = Math.floor(+v);
    }
    if (src === "paper") delete F().wagers[i];          // typed in at their reveal
    F().src[i] = src; F().locked[i] = true;
    Sound.sfx("stamp");
    save(); render(); tellPhones();
  }
  function unlock(i) {
    if (F().stage) return;                               // wagers are frozen once the clue is revealed
    if (!confirm(`Unlock ${S.players[i].name}'s wager so it can be changed?`)) return;
    F().locked[i] = false;
    Sound.sfx("toggleOff");
    save(); render(); tellPhones();
  }
  function setSource(i, src) {
    if (F().locked[i]) return;
    F().src[i] = src;
    if (src !== "typed") delete F().wagers[i];
    Sound.sfx("select");
    save(); render(); tellPhones();
  }

  /* ---------- The clue: who has answered (never what) ---------- */
  function responsesHTML() {
    const list = eligible();
    if (!list.length) return `<p class="muted">No one is playing Final Jeopardy.</p>`;
    return list.map(i => {
      const src = source(i), got = !!F().answers[i];
      return `<span class="resp ${got ? "in" : ""}" style="--pc:${pcolor(i)}">${chip(i)}${name(i)}
        <small>${src === "phone" ? (got ? "📱 answer in" : "📱 writing…") : "✍️ on paper"}</small></span>`;
    }).join("");
  }
  function paintResponses() { const el = $("responses"); if (el) el.innerHTML = responsesHTML(); }

  /* ---------- Player-by-player reveals ----------
     res[i] records: start (score before Final), wager, correct, delta, final, step, applied.
     step 0 name · 1 answer · 2 verdict · 3 wager + score. Scoring happens once, at step 3,
     through judgeFinal(); a correction adds only the difference. */
  function result(i) {
    const Fx = F();
    if (!Fx.res[i]) {
      const d = Fx.judged[i], w = +Fx.wagers[i] || 0, done = d !== undefined;   // a save judged before reveals existed
      Fx.res[i] = { start: S.players[i].score - (done ? d * w : 0), wager: Fx.wagers[i] ?? null, correct: done ? d === 1 : null,
                    delta: done ? d * w : 0, final: S.players[i].score, step: done ? 3 : 0, applied: done };
    }
    return Fx.res[i];
  }
  // Score a revealed result: first time via judgeFinal(), afterwards only the difference
  function apply(i) {
    const r = result(i), delta = (r.correct ? 1 : -1) * (+r.wager || 0);
    S.players[i].score += delta - (r.applied ? r.delta : 0);
    Object.assign(r, { delta, final: S.players[i].score, applied: true });
    F().wagers[i] = +r.wager || 0;
    F().judged[i] = r.correct ? 1 : -1;
    Track.snap("final");
  }

  function beginReveals() {
    stopTimer();
    const Fx = F();
    Fx.timeUp = true;
    const list = eligible();
    list.forEach(result);
    if (!Array.isArray(Fx.order) || Fx.order.length !== list.length || list.some(i => !Fx.order.includes(i)))
      Fx.order = [...list].sort((a, b) => result(a).start - result(b).start || a - b);   // lowest first, leader last
    Fx.stage = list.length ? "order" : "champion";
    save(); tellPhones();
    show();
  }

  function orderHTML() {
    const o = F().order;
    return `<div class="card fx-card">
      <p class="eyebrow">Final Jeopardy</p>
      <h2 class="title">The results</h2>
      <p class="msg">Players are revealed one at a time, lowest score first, so the leader goes last. Change the order if you like.</p>
      <ol class="order-list">${o.map((i, k) => `<li style="--pc:${pcolor(i)}">
        <span class="nm">${chip(i)}${name(i)}</span>
        <span class="ol-btns">
          <button class="btn mini ghost" data-fx="order-up" data-pos="${k}" ${k ? "" : "disabled"} aria-label="Move ${name(i)} earlier">↑</button>
          <button class="btn mini ghost" data-fx="order-down" data-pos="${k}" ${k < o.length - 1 ? "" : "disabled"} aria-label="Move ${name(i)} later">↓</button>
        </span></li>`).join("")}</ol>
      <div class="row">
        <button class="btn ghost" data-fx="back-clue">← Back to the clue</button>
        <button class="btn primary" data-fx="begin">Begin the reveals</button>
      </div>
    </div>`;
  }
  function moveOrder(k, d) {
    const o = F().order, j = k + d;
    if (j < 0 || j >= o.length) return;
    [o[k], o[j]] = [o[j], o[k]];
    Sound.sfx("select"); save(); swapOv(orderHTML());
  }

  function revealHTML() {
    const o = F().order, at = clamp(F().at | 0, 0, o.length - 1), i = o[at], r = result(i), src = F().src[i] || "paper";
    const ans = F().answers[i];
    const last = at === o.length - 1;
    const step = r.step;
    const wagerKnown = r.wager !== null && r.wager !== undefined && r.wager !== "";
    let action = "";
    if (step === 0) action = `<button class="btn primary" data-fx="rv-answer">Show the answer</button>`;
    else if (step === 1) action = `<button class="btn rv-ok" data-fx="rv-verdict" data-d="1">✓ Correct</button>
                                   <button class="btn rv-no" data-fx="rv-verdict" data-d="-1">✗ Incorrect</button>`;
    else if (step === 2) action = wagerKnown
      ? `<button class="btn primary" data-fx="rv-wager">Show the wager</button>`
      : `<label class="rv-paper">Their written wager ($0–${fmt(r.start > 0 ? r.start : 0)})
           <input id="rvWager" type="number" inputmode="numeric" min="0" max="${Math.max(0, r.start)}" step="1"></label>
         <button class="btn primary" data-fx="rv-wager">Show the wager</button>`;
    else action = last ? `<button class="btn primary" data-fx="champion">Continue to the champion reveal →</button>`
                       : `<button class="btn primary" data-fx="rv-next">Reveal the next player →</button>`;
    return `<div class="card fx-card reveal-card" id="revealCard">
      <p class="eyebrow">Final Jeopardy · Player ${at + 1} of ${o.length}</p>
      <div ${look(i, "rv-name")}>${name(i)}</div>
      <div class="rv-row">
        <div class="rv-box ${step >= 1 ? "on" : ""}"><span class="rv-k">Answer</span>
          <span class="rv-v rv-ans">${step >= 1 ? (ans ? esc(ans) : src === "phone" ? "<em>No answer sent</em>" : "<em>Read it from their paper</em>") : "?"}</span></div>
        <div class="rv-box ${step >= 2 ? "on " + (r.correct ? "ok" : "no") : ""}"><span class="rv-k">Result</span>
          <span class="rv-v">${step >= 2 ? (r.correct ? "✓ Correct" : "✗ Incorrect") : "?"}</span></div>
        <div class="rv-box ${step >= 3 ? "on" : ""}"><span class="rv-k">Wager</span>
          <span class="rv-v">${step >= 3 ? fmt(+r.wager || 0) : "?"}</span></div>
      </div>
      <div class="rv-score ${step >= 3 ? "on" : ""}">
        <span class="rv-k">Score</span>
        <span class="rv-total" id="rvTotal">${fmt(step >= 3 ? r.final : r.start)}</span>
        ${step >= 3 ? `<span class="rv-delta ${r.delta >= 0 ? "up" : "down"}">${r.delta >= 0 ? "+" : "−"}${fmt(Math.abs(r.delta)).replace("−", "")}</span>` : ""}
      </div>
      <div class="row">${action}</div>
      <div class="row rv-host">
        <button class="btn mini ghost" data-fx="rv-prev">← Previous</button>
        <button class="btn mini ghost" data-fx="rv-skip">Skip animation</button>
        ${step >= 2 ? `<button class="btn mini ghost" data-fx="rv-fix">Correct result</button>` : ""}
        ${last && step >= 3 ? "" : allRevealed() ? `<button class="btn mini ghost" data-fx="champion">Continue to champion</button>` : ""}
      </div>
    </div>`;
  }
  const allRevealed = () => F().order.every(i => result(i).step >= 3);
  const current = () => F().order[clamp(F().at | 0, 0, F().order.length - 1)];

  let countAnim = null;
  function animateScore(from, to) {
    cancelAnimationFrame(countAnim);
    const el = $("rvTotal");
    if (!el) return;
    if (reduced()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 1400;
    const stepFn = now => {
      const f = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - f, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (f < 1) countAnim = requestAnimationFrame(stepFn);
    };
    countAnim = requestAnimationFrame(stepFn);
  }
  function skipAnim() {
    cancelAnimationFrame(countAnim);
    const i = current(), r = result(i), el = $("rvTotal");
    if (el) el.textContent = fmt(r.step >= 3 ? r.final : r.start);
    $("revealCard") && $("revealCard").classList.add("instant");
  }

  function revealStep(act, d) {
    const i = current(), r = result(i);
    if (act === "rv-answer" && r.step === 0) { r.step = 1; Sound.sfx("twinkle"); }
    else if (act === "rv-verdict" && r.step === 1) { r.correct = d === 1; r.step = 2; Sound.sfx(r.correct ? "right" : "wrong"); }
    else if (act === "rv-wager" && r.step === 2) {
      if (r.wager === null || r.wager === undefined || r.wager === "") {           // a paper wager, typed in now
        const v = Math.floor(+($("rvWager") || {}).value);
        if (!(($("rvWager") || {}).value !== "" && v >= 0 && v <= Math.max(0, r.start))) {
          Sound.sfx("wrong"); return alert(`Enter a wager from $0 to ${fmt(Math.max(0, r.start))}.`);
        }
        r.wager = v;
      }
      r.step = 3;
      if (!r.applied) { F().wagers[i] = +r.wager; judgeFinal(i, r.correct ? 1 : -1); }   // the one place a wager is scored
      Sound.sfx(r.delta >= 0 ? "newGame" : "untwinkle");
      save(); renderScores();
      swapOv(revealHTML());
      return animateScore(r.start, r.final);
    }
    save();
    swapOv(revealHTML());
  }
  function fixResult() {
    const i = current(), r = result(i);
    if (r.step < 2) return;
    if (!confirm(`Change ${S.players[i].name}'s result to ${r.correct ? "INCORRECT" : "CORRECT"}?`)) return;
    r.correct = !r.correct;
    if (r.applied) { apply(i); renderScores(); }
    Sound.sfx(r.correct ? "right" : "wrong");
    save(); swapOv(revealHTML());
  }
  function go(d) {
    const o = F().order, at = (F().at | 0) + d;
    if (at < 0) { F().stage = "order"; save(); return swapOv(orderHTML()); }
    if (at >= o.length) return;
    F().at = at; save();
    Sound.sfx(d > 0 ? "swooshIn" : "swooshOut");
    swapOv(revealHTML());
  }

  /* ---------- The champion ---------- */
  function champs() {
    const top = Math.max(...S.players.map(p => p.score));
    return { top, list: S.players.map((p, i) => i).filter(i => S.players[i].score === top) };
  }
  function championHTML() {
    const { top, list } = champs(), real = top > 0, co = list.length > 1;
    const kicker = real ? (co ? "Bearcat Jeopardy co-champions" : "Bearcat Jeopardy champion") : "Top of the board";
    const msg = real ? (co ? `A tie at the top! Congratulations to all ${list.length}.` : `Congratulations, ${S.players[list[0]].name}! What a game.`)
                     : "A tough Final for everyone, but these Bearcats finished on top.";
    return `<div class="card fx-card champ-card" id="champCard">
      <div class="champ-trophy" aria-hidden="true">${real ? "🏆" : "⭐"}</div>
      <p class="champ-kicker">${kicker}</p>
      <div class="champ-names">${list.map(i => `<div ${look(i, "champ-name")}><span class="nm">${name(i)}</span><span class="sc ${S.players[i].score < 0 ? "neg" : ""}">${fmt(S.players[i].score)}</span></div>`).join("")}</div>
      <p class="champ-msg">${esc(msg)}</p>
      <div class="row">
        <button class="btn ghost" data-fx="back-reveals">← Back</button>
        <button class="btn ghost" data-fx="replay">↻ Replay celebration</button>
        <button class="btn primary" data-fx="standings">See the final standings →</button>
      </div>
      <button class="btn mini ghost" data-fx="standings">Skip celebration</button>
    </div>`;
  }
  function celebrate() {
    const card = $("champCard");
    if (card) { card.classList.remove("play"); void card.offsetWidth; card.classList.add("play"); }
    Sound.sfx("fanfare");
    if (champs().top > 0) setTimeout(confetti, 300);
  }

  /* ---------- Standings: the existing screen, plus the way onward ---------- */
  function standingsFinaleHTML() {
    return standingsHTML().replace(`<div class="row"><button class="btn primary" data-act="close">Close</button></div>`,
      `<div class="row">
        <button class="btn ghost" data-fx="back-champion">← Champion</button>
        <button class="btn" data-fx="keepsake">📸 Save game night memory</button>
        <button class="btn primary" data-fx="yearbook">The Bearcat Yearbook →</button>
      </div>`);
  }

  /* ---------- The Bearcat Yearbook ---------- */
  const AWARDS = [
    ["royal", "👑", "Trivia Royalty"],
    ["brain", "📚", "The Walking Encyclopedia"],
    ["comeback", "🔥", "The Comeback Queen"],
    ["chaos", "🎲", "The Chaos Coordinator"],
    ["iconic", "⭐", "Most Iconic Moment"]
  ];
  function awards() {
    const P = S.players, tracked = S.tracking === true, ids = P.map(p => p.id);
    const calc = {};
    // Trivia Royalty: the final ranking's top score
    const top = Math.max(...P.map(p => p.score));
    calc.royal = { who: ids.filter((id, i) => P[i].score === top), why: `Finished on top with ${fmt(top)}` };
    if (tracked) {
      // The Walking Encyclopedia: most correct answers in the two rounds
      const right = {};
      S.log.forEach(e => { if (e.ok === 1) right[e.pid] = (right[e.pid] || 0) + 1; });
      const most = Math.max(0, ...ids.map(id => right[id] || 0));
      if (most > 0) calc.brain = { who: ids.filter(id => (right[id] || 0) === most), why: `${most} correct answer${most === 1 ? "" : "s"} across both rounds` };
      // The Comeback: the biggest gap to the leader they climbed back from
      if (S.hist.length) {
        // gameplay snapshots only: a host flipping a Final result back and forth isn't a comeback
        const snaps = [...S.hist.filter(h => h.kind !== "final").map(h => h.s), Object.fromEntries(P.map(p => [p.id, p.score]))];
        const finalTop = top;
        let best = null;
        ids.forEach((id, i) => {
          let worst = 0;
          snaps.forEach(s => { if (s[id] === undefined) return; const lead = Math.max(...Object.values(s)); worst = Math.max(worst, lead - s[id]); });
          const gain = worst - (finalTop - P[i].score);
          if (worst > 0 && gain > 0 && (!best || gain > best.gain)) best = { id, gain, worst, i };
        });
        if (best) calc.comeback = { who: [best.id], why: P[best.i].score === finalTop
          ? `Came back from ${fmt(best.worst)} behind to finish on top`
          : `Trailed by ${fmt(best.worst)}, then clawed back ${fmt(best.gain)}` };
      }
      // The Chaos Coordinator: the boldest Daily Double, by share of what they could have bet
      const dds = (S.ddLog || []).filter(d => d.max > 0 && ids.includes(d.pid));
      if (dds.length) {
        const bold = dds.reduce((a, b) => (b.wager / b.max > a.wager / a.max ? b : a));
        const pct = Math.round(100 * bold.wager / bold.max);
        calc.chaos = { who: [bold.pid], why: pct >= 100 ? `Went all in on a Daily Double: ${fmt(bold.wager)}` : `Bet ${fmt(bold.wager)} of a possible ${fmt(bold.max)} (${pct}%) on a Daily Double` };
      }
    }
    const B = S.book;
    return AWARDS.map(([key, icon, title]) => {
      const manual = B.who[key] && ids.includes(B.who[key]) ? [B.who[key]] : null;
      const c = calc[key];
      const who = manual || (c ? c.who : []);
      const why = key === "iconic" ? (B.note || "The host's pick for the funniest, most surprising or most memorable moment")
        : manual && (!c || !c.who.includes(B.who[key])) ? "The host's pick" : c ? c.why : "";
      return { key, icon, title: (B.title[key] || "").trim() || title, who, why, hidden: !!B.hide[key], available: who.length > 0 };
    });
  }

  let editingBook = false;
  function yearbookHTML() {
    const list = awards();
    const shown = list.filter(a => editingBook || (a.available && !a.hidden));
    const cards = shown.map((a, n) => `<div class="award ${a.hidden ? "hidden-award" : ""}" style="--n:${n}">
      <div class="aw-icon" aria-hidden="true">${a.icon}</div>
      <h3 class="aw-title">${esc(a.title)}</h3>
      <div class="aw-who">${a.who.map(id => byId(id)).filter(i => i >= 0).map(i => `<span ${look(i, "aw-name")}>${name(i)}</span>`).join("") || `<span class="muted">${a.key === "iconic" ? "Host, pick someone!" : "Not enough game data — host can pick"}</span>`}</div>
      <p class="aw-why">${esc(a.why)}</p>
      ${editingBook ? `<div class="aw-edit">
        <label>Title <input data-book-title="${a.key}" value="${esc(a.title)}"></label>
        <label>Recipient <select data-book-who="${a.key}">
          <option value="">${a.key === "iconic" ? "Choose…" : "Automatic"}</option>
          ${S.players.map(p => `<option value="${p.id}" ${S.book.who[a.key] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
        </select></label>
        ${a.key === "iconic" ? `<label>What happened <input data-book-note value="${esc(S.book.note || "")}" maxlength="120" placeholder="The answer nobody will forget…"></label>` : ""}
        <button class="btn mini ghost" data-fx="book-hide" data-key="${a.key}">${a.hidden ? "Show this award" : "Hide this award"}</button>
      </div>` : ""}
    </div>`).join("");
    return `<div class="card fx-card book-card">
      <p class="eyebrow">${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
      <h2 class="title">The Bearcat Yearbook</h2>
      <div class="awards">${cards || `<p class="muted">Awards show up here as the game goes. Use Edit awards to hand some out.</p>`}</div>
      ${S.tracking === true ? "" : `<p class="hint">This game started before the Yearbook tracked answers, so only awards the game can be sure of are shown. The host can hand out the rest.</p>`}
      <div class="row">
        <button class="btn ghost" data-fx="standings">← Standings</button>
        <button class="btn ghost" data-fx="book-edit" aria-pressed="${editingBook}">${editingBook ? "✓ Done editing" : "✎ Edit awards"}</button>
        <button class="btn" data-fx="keepsake">📸 Save game night memory</button>
        <button class="btn primary" data-fx="memory">One last memory →</button>
      </div>
    </div>`;
  }

  /* ---------- One Last Memory ---------- */
  const PROMPTS = [
    "If you could relive one day of your childhood, what would you choose?",
    "Which childhood trend deserves a comeback?",
    "What's one childhood video game you wish you could play for the first time again?",
    "What TV show instantly reminds you of elementary school?",
    "What's the funniest thing you remember from middle school?",
    "Which childhood snack do you miss the most?",
    "What's one school memory you still laugh about?"
  ];
  let prompt = 0;
  function memoryHTML() {
    return `<div class="card fx-card memory-card">
      <p class="eyebrow">No scores, no timer, just stories</p>
      <h2 class="title">One last memory</h2>
      <p class="memory-q" id="memoryQ" aria-live="polite">${esc(PROMPTS[prompt])}</p>
      <div class="row">
        <button class="btn ghost" data-fx="mem-shuffle">🔀 Shuffle</button>
        <button class="btn" data-fx="mem-next">Next prompt →</button>
      </div>
      <div class="row">
        <button class="btn ghost" data-fx="yearbook">← Yearbook</button>
        <button class="btn ghost" data-fx="mem-skip">Skip</button>
        <button class="btn primary" data-fx="finish">Finish game</button>
      </div>
    </div>`;
  }
  function nextPrompt(shuffle) {
    let n = prompt;
    if (shuffle) { while (PROMPTS.length > 1 && n === prompt) n = Math.floor(Math.random() * PROMPTS.length); }
    else n = (prompt + 1) % PROMPTS.length;
    prompt = n;
    const q = $("memoryQ");
    if (q) { q.textContent = PROMPTS[prompt]; q.classList.remove("swap"); void q.offsetWidth; q.classList.add("swap"); }
    Sound.sfx("select");
  }

  /* ---------- The Final tab after (or in the middle of) the finale ---------- */
  function resumeHTML() {
    const done = F().stage === "done", { list } = champs();
    return `<div class="final">
      <p class="eyebrow">Final Jeopardy</p>
      <h2 class="final-cat">${done ? "That's a wrap!" : "The finale is underway"}</h2>
      ${done ? `<p class="msg">Champion${list.length > 1 ? "s" : ""}: ${list.map(name).join(" & ")}</p>` : ""}
      <div class="row">
        ${done ? "" : `<button class="btn primary" data-fx="resume">Resume the finale</button>`}
        <button class="btn" data-fx="champion">🏆 Champion</button>
        <button class="btn" data-fx="standings">Standings</button>
        <button class="btn" data-fx="yearbook">📚 Yearbook</button>
        <button class="btn" data-fx="memory">💬 One last memory</button>
        <button class="btn" data-fx="keepsake">📸 Save game night memory</button>
      </div>
      <p class="hint">Scores are final. Moving between these screens never changes them. <b>New game</b> starts over.</p>
    </div>`;
  }

  /* ---------- Moving between stages ---------- */
  const SCENES = { order: "fx-reveal", reveal: "fx-reveal", champion: "champion", standings: "standings", yearbook: "fx-book", memory: "fx-memory" };
  function html(stage) {
    return stage === "order" ? orderHTML() : stage === "reveal" ? revealHTML() : stage === "champion" ? championHTML()
      : stage === "standings" ? standingsFinaleHTML() : stage === "yearbook" ? yearbookHTML() : stage === "memory" ? memoryHTML() : "";
  }
  // Show the current stage (opening the overlay if it's closed)
  function show() {
    const st = F().stage, body = html(st);
    if (!body) return;
    scene = SCENES[st] || null; updateMusic();
    if (ov.hidden) openOv(body); else swapOv(body);
    if (st === "champion") celebrate();
    tellPhones();
  }
  function goStage(stage) {
    if (["champion", "standings", "yearbook", "memory"].includes(stage) && eligible().some(i => !result(i).applied)) {
      // never crown anyone before every Final result is scored
      F().stage = F().order ? "reveal" : "order";
      F().at = Math.max(0, F().order ? F().order.findIndex(i => !result(i).applied) : 0);
      save(); Sound.sfx("wrong");
      alert("Reveal every player's Final result first.");
      return show();
    }
    F().stage = stage; save();
    Sound.sfx(stage === "standings" ? "tab" : "swooshIn");
    show();
  }

  function act(t) {
    const a = t.dataset.fx, i = t.dataset.i !== undefined ? +t.dataset.i : null;
    switch (a) {
      case "lock": return lock(i);
      case "unlock": return unlock(i);
      case "src": return setSource(i, t.dataset.src);
      case "show-amounts": F().show = !F().show; Sound.sfx(F().show ? "toggleOn" : "toggleOff"); save(); return render();
      case "timer-pause": return pauseTimer();
      case "timer-resume": return resumeTimer();
      case "timer-restart": return restartTimer();
      case "timer-end": return endTimer();
      case "reveals":
        if (!F().timeUp && !confirm("The countdown is still going. End it and start the reveals?")) return;
        Sound.sfx("click"); return beginReveals();
      case "back-clue": F().stage = "clue"; save(); Sound.sfx("swooshOut"); scene = "final-clue"; updateMusic(); swapOv(finalClueHTML()); showMedia(); paintTimer(); return tellPhones();
      case "order-up": return moveOrder(+t.dataset.pos, -1);
      case "order-down": return moveOrder(+t.dataset.pos, 1);
      case "begin": F().stage = "reveal"; F().at = 0; save(); Sound.sfx("swooshIn"); return show();
      case "rv-answer": case "rv-verdict": case "rv-wager": return revealStep(a, +t.dataset.d);
      case "rv-next": return go(1);
      case "rv-prev": return go(-1);
      case "rv-skip": Sound.sfx("click"); return skipAnim();
      case "rv-fix": return fixResult();
      case "champion": return goStage("champion");
      case "back-reveals": F().stage = F().order && F().order.length ? "reveal" : "order"; F().at = Math.max(0, (F().order || []).length - 1); save(); Sound.sfx("swooshOut"); return show();
      case "replay": return celebrate();
      case "standings": case "back-champion": return goStage(a === "standings" ? "standings" : "champion");
      case "yearbook": return goStage("yearbook");
      case "book-edit": editingBook = !editingBook; Sound.sfx(editingBook ? "toggleOn" : "toggleOff"); return swapOv(yearbookHTML());
      case "book-hide": { const k = t.dataset.key; S.book.hide[k] = !S.book.hide[k]; save(); Sound.sfx("select"); return swapOv(yearbookHTML()); }
      case "memory": return goStage("memory");
      case "mem-next": return nextPrompt(false);
      case "mem-shuffle": return nextPrompt(true);
      case "mem-skip": case "finish":
        F().stage = "done"; save(); Sound.sfx(a === "finish" ? "fanfare" : "swooshOut");
        closeOv(); view = "final"; return;
      case "resume": return show();
      case "keepsake": return keepsake(t);
    }
  }

  // Yearbook edits (title, recipient, note) save as they're typed
  function bookInput(el) {
    if (el.dataset.bookTitle) S.book.title[el.dataset.bookTitle] = el.value.slice(0, 40);
    else if (el.dataset.bookWho !== undefined) { if (el.value) S.book.who[el.dataset.bookWho] = el.value; else delete S.book.who[el.dataset.bookWho]; }
    else if (el.dataset.bookNote !== undefined) S.book.note = el.value.slice(0, 120);
    else return false;
    save();
    return true;
  }

  /* ---------- Keepsake: a 16:9 PNG made with the browser's own canvas ---------- */
  async function keepsake(btn) {
    const label = btn && btn.textContent;
    if (btn) btn.textContent = "Making your picture…";
    try { await Promise.all(["64px Anton", "600 28px 'IBM Plex Mono', monospace", "700 30px Bitter, Georgia, serif"].map(f => document.fonts.load(f))); } catch (e) {}
    const W = 1920, H = 1080, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const css = getComputedStyle(document.documentElement), tok = n => css.getPropertyValue(n).trim();
    const gold = tok("--gold") || "#f2c14e", ink = tok("--ink") || "#f4f1e8", muted = tok("--muted") || "#8f99d4";
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0b1d8f"); bg.addColorStop(1, tok("--stage") || "#05081f");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = gold; g.lineWidth = 6; g.strokeRect(36, 36, W - 72, H - 72);
    const text = (s, x, y, font, color, align = "left") => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
    const fit = (s, max, font) => { g.font = font; let t = s; while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + "…"; return t; };
    // Logo and date
    g.font = "92px Anton, Impact, 'Arial Black', sans-serif"; const w1 = g.measureText("BEARCAT ").width, w2 = g.measureText("JEOPARDY").width, x0 = (W - w1 - w2) / 2;
    text("BEARCAT ", x0, 160, "92px Anton, Impact, 'Arial Black', sans-serif", ink); text("JEOPARDY", x0 + w1, 160, "92px Anton, Impact, 'Arial Black', sans-serif", gold);
    text(new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase(), W / 2, 210, "600 28px 'IBM Plex Mono', monospace", muted, "center");
    // Champion
    const { top, list } = champs();
    text(top > 0 ? (list.length > 1 ? "CO-CHAMPIONS" : "CHAMPION") : "TOP OF THE BOARD", W / 2, 290, "600 30px 'IBM Plex Mono', monospace", gold, "center");
    text(fit(`🏆 ${list.map(i => S.players[i].name).join(" & ")} · ${fmt(top)}`, W - 200, "84px Anton, Impact, 'Arial Black', sans-serif"), W / 2, 385, "84px Anton, Impact, 'Arial Black', sans-serif", ink, "center");
    // Standings
    const ranked = S.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    const rowH = Math.min(70, 520 / Math.max(1, ranked.length));
    text("FINAL SCORES", 140, 470, "600 26px 'IBM Plex Mono', monospace", muted);
    ranked.slice(0, 8).forEach(({ p, i }, n) => {
      const y = 500 + n * rowH, c = lookOf(p, i).color;
      g.fillStyle = c; g.beginPath(); g.roundRect ? g.roundRect(140, y + 6, 36, rowH - 20, 8) : g.rect(140, y + 6, 36, rowH - 20); g.fill();
      const place = ranked.findIndex(q => q.p.score === p.score) + 1;
      const fs = Math.round(rowH * .55);
      text(`${place}.`, 200, y + rowH * .62, `${fs}px Anton, Impact, 'Arial Black', sans-serif`, muted);
      text(fit(p.name, 520, `700 ${fs}px Bitter, Georgia, serif`), 260, y + rowH * .62, `700 ${fs}px Bitter, Georgia, serif`, ink);
      text(fmt(p.score), 900, y + rowH * .62, `${fs}px Anton, Impact, 'Arial Black', sans-serif`, p.score < 0 ? "#ff6a6a" : gold, "right");
    });
    // Yearbook awards
    const aw = awards().filter(a => a.available && !a.hidden);
    if (aw.length) {
      text("THE BEARCAT YEARBOOK", 1020, 470, "600 26px 'IBM Plex Mono', monospace", muted);
      aw.slice(0, 5).forEach((a, n) => {
        const y = 520 + n * 92;
        text(`${a.icon} ${fit(a.title, 700, "700 30px Bitter, Georgia, serif")}`, 1020, y, "700 30px Bitter, Georgia, serif", gold);
        text(fit(a.who.map(id => (S.players[byId(id)] || {}).name).filter(Boolean).join(" & "), 740, "600 26px 'IBM Plex Mono', monospace"), 1020, y + 38, "600 26px 'IBM Plex Mono', monospace", ink);
      });
    }
    text("What a game night. Thanks for playing!", W / 2, H - 80, "700 34px Bitter, Georgia, serif", ink, "center");
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bearcat-jeopardy-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    Sound.sfx("save");
    if (btn) btn.textContent = "✓ Saved to your downloads";
    setTimeout(() => { if (btn && btn.isConnected) btn.textContent = label; }, 2500);
    return blob;
  }

  return { wagerStageHTML, responsesHTML, paintResponses, info, secret, act, bookInput, show, tellPhones, phoneStage, awards, result, keepsake };
})();

/* =========================================================
   Event tracking, for the Yearbook. Lightweight: one entry per judged clue
   (replaced if the host changes the mark), Daily Double wagers with what
   could have been bet, and a score snapshot after every change.
   Players are tracked by a stable id, so removing a player doesn't confuse it.
   ========================================================= */
const Track = {
  snap(kind, tag) {
    S.seq = (S.seq || 0) + 1;
    S.hist.push({ seq: S.seq, kind, tag, s: Object.fromEntries(S.players.map(p => [p.id, p.score])) });
    if (S.hist.length > 600) S.hist.shift();
  },
  clue(k, i, value, ok, before, dd) {
    const pid = S.players[i].id, tag = `${k}|${pid}`;
    S.log = S.log.filter(e => !(e.k === k && e.pid === pid));
    if (ok) S.log.push({ seq: (S.seq || 0) + 1, k, pid, value, ok, before, after: S.players[i].score, ...(dd ? { dd: true } : {}) });
    // the host changing or undoing a mark replaces it in the history rather than adding a blip that never really happened
    const last = S.hist[S.hist.length - 1];
    if (last && last.tag === tag) { S.hist.pop(); if (!ok) return; }
    this.snap("clue", ok ? tag : undefined);
  },
  dd(k, i, wager, max) {
    const pid = S.players[i].id;
    S.ddLog = (S.ddLog || []).filter(d => d.k !== k);
    S.ddLog.push({ seq: (S.seq || 0) + 1, k, pid, wager, max });
  }
};
