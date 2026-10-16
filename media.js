"use strict";

/* =========================================================
   Clue media: a picture or GIF (a web link or an uploaded file) or a YouTube
   video, shown on a clue card. Added in the clue editor, which only opens in
   Edit clues mode. Uploaded files are kept in this browser's IndexedDB, which
   holds far more than the few megabytes the game's own save has room for.
   ========================================================= */
const Media = (() => {
  const MAX_FILE = 25 * 1024 * 1024;
  const escA = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

  /* ---------- Uploaded files (IndexedDB) ---------- */
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open("bearcat-jeopardy-media", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  }));
  async function store(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction("files", mode), req = fn(t.objectStore("files"));
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }
  const urls = {};                                   // file id → object URL
  async function fileUrl(id) {
    if (urls[id]) return urls[id];
    const blob = await store("readonly", s => s.get(id));
    return blob ? (urls[id] = URL.createObjectURL(blob)) : null;
  }
  // A clue's media was replaced or deleted: drop its uploaded file
  function forget(m) {
    m = clean(m);
    if (m && m.kind === "file") store("readwrite", s => s.delete(m.id)).catch(() => {});
  }

  /* ---------- What a saved media entry may contain ---------- */
  function clean(m) {
    if (!m || typeof m !== "object") return null;
    const when = m.when === "answer" ? "answer" : "clue";
    if (m.kind === "image" && /^(https?:\/\/|data:image\/)/i.test(m.src || "")) return { kind: "image", src: String(m.src), when };
    if (m.kind === "file" && /^[a-z0-9]{12}$/.test(m.id || "")) return { kind: "file", id: m.id, name: String(m.name || "").slice(0, 80), when };
    if (m.kind === "youtube" && /^[\w-]{11}$/.test(m.id || "")) return { kind: "youtube", id: m.id, start: Math.max(0, Math.floor(+m.start || 0)), when };
    return null;
  }

  /* YouTube links: youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /live/ID,
     with an optional start time (t=90, t=1m30s, start=90) */
  function youtube(text) {
    let u;
    try { u = new URL(String(text).trim()); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com")
      id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1];
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    const t = (u.searchParams.get("t") || u.searchParams.get("start") || "").match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    return { id, start: t ? (+(t[1] || 0)) * 3600 + (+(t[2] || 0)) * 60 + (+(t[3] || 0)) : 0 };
  }

  /* ---------- On the clue card ---------- */
  function html(m) {
    m = clean(m);
    if (!m) return "";
    const later = m.when === "answer" ? " later" : "";
    if (m.kind === "youtube") {
      const t = m.start ? m.start : 0;
      return `<div class="media yt${later}">
        <iframe src="https://www.youtube-nocookie.com/embed/${m.id}?rel=0&playsinline=1${t ? "&start=" + t : ""}" title="YouTube video"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        <a class="yt-link" href="https://www.youtube.com/watch?v=${m.id}${t ? "&t=" + t + "s" : ""}" target="_blank" rel="noopener">Video not playing? Open it on YouTube</a>
      </div>`;
    }
    if (m.kind === "image") return `<div class="media${later}"><img src="${escA(m.src)}" alt="" referrerpolicy="no-referrer"></div>`;
    return `<div class="media${later}"><img data-file="${m.id}" alt=""></div>`;
  }

  // Uploaded pictures load from IndexedDB after the card is drawn
  async function hydrate(root) {
    for (const img of root.querySelectorAll("img[data-file]")) {
      const url = await fileUrl(img.dataset.file).catch(() => null);
      if (url) img.src = url;
      else img.closest(".media").innerHTML = `<p class="muted media-missing">This picture was uploaded in another browser, so it isn't saved here. Upload it again in Edit clues.</p>`;
    }
  }

  /* ---------- In the clue editor ---------- */
  let draft = null;        // what the editor currently shows: { kind, src, id, name, blob, start, when }

  function fields(saved) {
    const m = clean(saved);
    draft = m ? { ...m } : { kind: "none", when: "clue" };
    return `<div class="field media-field" id="mediaField">
      <span class="flabel">Picture, GIF or YouTube video <small>(optional)</small></span>
      <div class="seg" role="radiogroup" aria-label="Media">
        <button type="button" role="radio" data-mkind="none">None</button>
        <button type="button" role="radio" data-mkind="image">Picture or GIF</button>
        <button type="button" role="radio" data-mkind="youtube">YouTube</button>
      </div>
      <div class="media-pane" data-pane="image">
        <input id="mdUrl" type="url" inputmode="url" placeholder="Paste a picture or GIF link (https://…)" value="${m && m.kind === "image" ? escA(m.src) : ""}" aria-label="Picture or GIF link">
        <div class="file-row">
          <label class="btn mini file-btn">Upload from this device<input type="file" id="mdFile" accept="image/*"></label>
          <span id="mdFileName" class="muted">${m && m.kind === "file" ? escA(m.name || "Uploaded picture") : ""}</span>
        </div>
      </div>
      <div class="media-pane" data-pane="youtube">
        <input id="mdYt" type="url" inputmode="url" placeholder="Paste a YouTube link" aria-label="YouTube link"
          value="${m && m.kind === "youtube" ? `https://youtu.be/${m.id}${m.start ? "?t=" + m.start : ""}` : ""}">
      </div>
      <div class="media-when">
        <span class="flabel">Show it</span>
        <div class="seg" role="radiogroup" aria-label="When to show it">
          <button type="button" role="radio" data-mwhen="clue">With the clue</button>
          <button type="button" role="radio" data-mwhen="answer">After the answer is revealed</button>
        </div>
      </div>
      <div class="media-preview" id="mdPreview"></div>
      <p class="media-msg" id="mdMsg" role="status"></p>
    </div>`;
  }

  const $m = id => document.getElementById(id);
  const say = (text, bad) => { const el = $m("mdMsg"); if (el) { el.textContent = text; el.classList.toggle("bad", !!bad); } };

  // Redraw the editor's media section from the draft
  function update() {
    const box = $m("mediaField");
    if (!box || !draft) return;
    const kind = draft.kind === "file" ? "image" : draft.kind;
    box.querySelectorAll("[data-mkind]").forEach(b => b.setAttribute("aria-checked", b.dataset.mkind === kind));
    box.querySelectorAll("[data-mwhen]").forEach(b => b.setAttribute("aria-checked", b.dataset.mwhen === draft.when));
    box.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== kind; });
    box.querySelector(".media-when").hidden = kind === "none";
    const pv = $m("mdPreview");
    if (draft.kind === "file" && draft.blob) {
      pv.innerHTML = `<div class="media"><img alt="Preview"></div>`;
      pv.querySelector("img").src = draft.preview || (draft.preview = URL.createObjectURL(draft.blob));
    } else {
      pv.innerHTML = html({ ...draft, when: "clue" });
      hydrate(pv);
    }
    const img = pv.querySelector("img");
    if (img) img.onerror = () => say("That link didn't load as a picture. Check that it points to an image or GIF.", true);
  }

  function setKind(kind) {
    if (kind === "image") {
      const url = ($m("mdUrl") || {}).value || "";
      draft = url ? { kind: "image", src: url.trim(), when: draft.when } : (draft.kind === "file" ? draft : { kind: "image", src: "", when: draft.when });
    } else if (kind === "youtube") {
      const y = youtube(($m("mdYt") || {}).value || "");
      draft = { kind: "youtube", id: y ? y.id : "", start: y ? y.start : 0, when: draft.when };
    } else draft = { kind: "none", when: draft.when };
    say(""); update();
  }
  function setWhen(when) { draft.when = when === "answer" ? "answer" : "clue"; update(); }

  // Typing or pasting into the link boxes
  function input(el) {
    if (el.id === "mdUrl") {
      const v = el.value.trim();
      draft = { kind: "image", src: v, when: draft.when };
      $m("mdFileName").textContent = "";
      say(v && !/^(https?:\/\/|data:image\/)/i.test(v) ? "Use a link that starts with https://" : "", true);
      update();
    }
    if (el.id === "mdYt") {
      const y = youtube(el.value);
      draft = { kind: "youtube", id: y ? y.id : "", start: y ? y.start : 0, when: draft.when };
      say(el.value.trim() && !y ? "That doesn't look like a YouTube link. Copy it from the Share button on YouTube." : "", true);
      update();
    }
  }

  // A picture chosen from the device
  function pick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return say("That file isn't a picture or GIF.", true);
    if (file.size > MAX_FILE) return say(`That file is ${(file.size / 1048576).toFixed(0)} MB. Pick one under 25 MB.`, true);
    draft = { kind: "file", blob: file, name: file.name, when: draft.when };
    $m("mdUrl").value = "";
    $m("mdFileName").textContent = file.name;
    say(""); update();
  }

  /* Turn the draft into what gets saved. Returns { media } (null for none), or { error }.
     `before` is what was saved for this clue until now, so a replaced upload can be dropped. */
  async function commit(before) {
    const d = draft || { kind: "none" };
    let media = null;
    if (d.kind === "image") {
      if (d.src && !/^(https?:\/\/|data:image\/)/i.test(d.src)) return { error: "The picture link has to start with https://" };
      media = d.src ? clean(d) : null;
    } else if (d.kind === "youtube") {
      if (!d.id) return ($m("mdYt") && $m("mdYt").value.trim()) ? { error: "That doesn't look like a YouTube link." } : { media: keep(before, null) };
      media = clean(d);
    } else if (d.kind === "file") {
      if (d.blob) {
        const id = newId();
        try { await store("readwrite", s => s.put(d.blob, id)); }
        catch (e) { return { error: "Couldn't save that file in this browser. It may be out of space." }; }
        media = { kind: "file", id, name: d.name, when: d.when };
      } else media = clean(d);
    }
    return { media: keep(before, media) };
  }
  // Drop an uploaded file that's no longer used
  function keep(before, after) {
    const b = clean(before);
    if (b && b.kind === "file" && !(after && after.kind === "file" && after.id === b.id)) forget(b);
    return after;
  }

  /* =========================================================
     Sound clips: an MP3 that plays from a pill-shaped player on the clue card,
     its waveform on the left and a play button on the right. Separate from the
     picture or video, so a clue can have both (a bird and its call).
     ========================================================= */
  const BARS = 56;

  function cleanClip(c) {
    if (!c || typeof c !== "object" || !/^[a-z0-9]{12}$/.test(c.id || "")) return null;
    const peaks = Array.isArray(c.peaks) ? c.peaks.slice(0, BARS).map(v => Math.max(.04, Math.min(1, +v || 0))) : [];
    return { id: c.id, name: String(c.name || "").slice(0, 80), dur: Math.max(0, +c.dur || 0), peaks, when: c.when === "answer" ? "answer" : "clue" };
  }
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // The pill. `src` is used in the editor preview, before the file is saved.
  function clipHTML(c, src) {
    c = src ? c : cleanClip(c);
    if (!c) return "";
    const peaks = c.peaks.length ? c.peaks : Array.from({ length: BARS }, () => .3);
    return `<div class="clip${c.when === "answer" && !src ? " later" : ""}" ${src ? `data-src="${escA(src)}"` : `data-file="${c.id}"`} data-dur="${c.dur}">
      <div class="clip-wave" role="slider" tabindex="0" aria-label="Sound clip position" aria-valuemin="0" aria-valuemax="${Math.round(c.dur)}" aria-valuenow="0">
        ${peaks.map(v => `<i style="--h:${v.toFixed(2)}"></i>`).join("")}
      </div>
      <span class="clip-time">${mmss(c.dur)}</span>
      <button type="button" class="clip-play" aria-label="Play sound clip"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5.5v13l11-6.5z"/><path class="i-pause" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></button>
    </div>`;
  }

  // Waveform: the loudest sample in each of BARS slices, scaled so the loudest bar is full height
  async function analyse(file) {
    const buf = await file.arrayBuffer();
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new AC(1, 2, 44100);
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    const data = audio.getChannelData(0), step = Math.max(1, Math.floor(data.length / BARS));
    const peaks = Array.from({ length: BARS }, (_, b) => {
      let m = 0;
      for (let i = b * step, end = Math.min(data.length, i + step); i < end; i += 16) m = Math.max(m, Math.abs(data[i]));
      return m;
    });
    const top = Math.max(...peaks) || 1;
    return { dur: audio.duration, peaks: peaks.map(v => +Math.max(.06, Math.sqrt(v / top)).toFixed(2)) };
  }

  /* ---------- Playing ---------- */
  const players = new WeakMap();      // pill element → its Audio
  let onPlaying = () => {};           // the game fades its music while a clip plays

  async function audioFor(pill) {
    if (players.has(pill)) return players.get(pill);
    const src = pill.dataset.src || await fileUrl(pill.dataset.file).catch(() => null);
    if (!src) { pill.classList.add("missing"); pill.querySelector(".clip-time").textContent = "Not in this browser"; return null; }
    const a = new Audio(src);
    a.preload = "auto";
    a.addEventListener("play", () => { pill.classList.add("playing"); onPlaying(true); tick(pill, a); });
    a.addEventListener("pause", () => { pill.classList.remove("playing"); onPlaying(anyPlaying()); });
    a.addEventListener("ended", () => { a.currentTime = 0; paint(pill, a); });
    players.set(pill, a);
    return a;
  }
  const live = new Set();
  const anyPlaying = () => [...live].some(a => !a.paused);

  async function toggleClip(btn) {
    const pill = btn.closest(".clip");
    const a = await audioFor(pill);
    if (!a) return;
    live.add(a);
    if (a.paused) { document.querySelectorAll(".clip.playing").forEach(p => p !== pill && players.get(p) && players.get(p).pause()); a.play().catch(() => {}); }
    else a.pause();
  }

  // Fill the waveform up to the playhead
  function paint(pill, a) {
    const dur = a.duration || +pill.dataset.dur || 1, f = Math.min(1, a.currentTime / dur);
    const bars = pill.querySelectorAll(".clip-wave i"), lit = Math.round(f * bars.length);
    bars.forEach((b, k) => b.classList.toggle("on", k < lit));
    pill.querySelector(".clip-time").textContent = a.paused && a.currentTime === 0 ? mmss(dur) : `${mmss(a.currentTime)} / ${mmss(dur)}`;
    pill.querySelector(".clip-wave").setAttribute("aria-valuenow", Math.round(a.currentTime));
    pill.querySelector(".clip-play").setAttribute("aria-label", a.paused ? "Play sound clip" : "Pause sound clip");
  }
  function tick(pill, a) {
    paint(pill, a);
    if (!a.paused && pill.isConnected) requestAnimationFrame(() => tick(pill, a));
    else if (!pill.isConnected) a.pause();
  }

  async function seek(pill, fraction) {
    const a = await audioFor(pill);
    if (!a) return;
    live.add(a);
    const dur = a.duration || +pill.dataset.dur || 0;
    a.currentTime = Math.max(0, Math.min(dur, fraction * dur));
    paint(pill, a);
  }
  // Tap or drag on the waveform to jump; arrow keys skip 5 seconds
  document.addEventListener("pointerdown", e => {
    const wave = e.target.closest(".clip-wave");
    if (!wave) return;
    const r = wave.getBoundingClientRect();
    seek(wave.closest(".clip"), (e.clientX - r.left) / r.width);
  });
  document.addEventListener("keydown", e => {
    const wave = e.target.closest && e.target.closest(".clip-wave");
    if (!wave || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const pill = wave.closest(".clip"), a = players.get(pill), dur = (a && a.duration) || +pill.dataset.dur || 1;
    seek(pill, ((a ? a.currentTime : 0) + (e.key === "ArrowRight" ? 5 : -5)) / dur);
  });

  // The card closed: silence every clip
  function stopClips() { live.forEach(a => a.pause()); live.clear(); onPlaying(false); }

  /* ---------- In the clue editor ---------- */
  let clipDraft = null;               // { id?, blob?, name, dur, peaks, when } or null for no clip

  function clipFields(saved) {
    const c = cleanClip(saved);
    clipDraft = c ? { ...c } : null;
    return `<div class="field clip-field" id="clipField">
      <span class="flabel">Sound clip <small>(optional, MP3)</small></span>
      <div class="file-row">
        <label class="btn mini file-btn">Upload an MP3<input type="file" id="clipFile" accept="audio/mpeg,.mp3"></label>
        <button type="button" class="btn mini ghost" data-clip-remove>Remove</button>
      </div>
      <div class="media-when" id="clipWhen">
        <span class="flabel">Show it</span>
        <div class="seg" role="radiogroup" aria-label="When to show the sound clip">
          <button type="button" role="radio" data-cwhen="clue">With the clue</button>
          <button type="button" role="radio" data-cwhen="answer">After the answer is revealed</button>
        </div>
      </div>
      <div id="clipPreview"></div>
      <p class="media-msg" id="clipMsg" role="status"></p>
    </div>`;
  }

  function clipUpdate() {
    const box = $m("clipField");
    if (!box) return;
    box.querySelector("[data-clip-remove]").hidden = !clipDraft;
    $m("clipWhen").hidden = !clipDraft;
    if (clipDraft) box.querySelectorAll("[data-cwhen]").forEach(b => b.setAttribute("aria-checked", b.dataset.cwhen === clipDraft.when));
    const pv = $m("clipPreview");
    if (!clipDraft) { pv.innerHTML = ""; return; }
    if (clipDraft.blob) pv.innerHTML = clipHTML(clipDraft, clipDraft.url || (clipDraft.url = URL.createObjectURL(clipDraft.blob)));
    else pv.innerHTML = clipHTML({ ...clipDraft, when: "clue" });
    const name = pv.querySelector(".clip");
    if (name) name.title = clipDraft.name || "";
  }
  const clipSay = (text, bad) => { const el = $m("clipMsg"); if (el) { el.textContent = text; el.classList.toggle("bad", !!bad); } };

  async function pickClip(file) {
    if (!file) return;
    if (!(file.type === "audio/mpeg" || file.type === "audio/mp3" || /\.mp3$/i.test(file.name))) return clipSay("That file isn't an MP3.", true);
    if (file.size > MAX_FILE) return clipSay(`That file is ${(file.size / 1048576).toFixed(0)} MB. Pick one under 25 MB.`, true);
    clipSay("Reading the sound…");
    try {
      const { dur, peaks } = await analyse(file);
      clipDraft = { blob: file, name: file.name, dur, peaks, when: clipDraft ? clipDraft.when : "clue" };
      clipSay(`${file.name} · ${mmss(dur)}`);
    } catch (e) { return clipSay("That file couldn't be read as audio. Try another MP3.", true); }
    clipUpdate();
  }
  function removeClip() { clipDraft = null; clipSay(""); clipUpdate(); }
  function setClipWhen(when) { if (clipDraft) { clipDraft.when = when === "answer" ? "answer" : "clue"; clipUpdate(); } }

  async function commitClip(before) {
    const b = cleanClip(before);
    let clip = null;
    if (clipDraft && clipDraft.blob) {
      const id = newId();
      try { await store("readwrite", s => s.put(clipDraft.blob, id)); }
      catch (e) { return { error: "Couldn't save that MP3 in this browser. It may be out of space." }; }
      clip = { id, name: clipDraft.name, dur: +clipDraft.dur.toFixed(2), peaks: clipDraft.peaks, when: clipDraft.when };
    } else if (clipDraft) clip = cleanClip(clipDraft);
    if (b && !(clip && clip.id === b.id)) forget({ kind: "file", id: b.id });
    return { clip };
  }
  const forgetClip = c => { c = cleanClip(c); if (c) forget({ kind: "file", id: c.id }); };

  return {
    clean, html, hydrate, fields, update, setKind, setWhen, input, pick, commit, forget, youtube,
    cleanClip, clipHTML, clipFields, clipUpdate, pickClip, removeClip, setClipWhen, commitClip, forgetClip,
    toggleClip, stopClips, set onPlaying(fn) { onPlaying = fn; }
  };
})();
