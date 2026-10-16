"use strict";

/* =========================================================
   Sound: original music and sound effects, synthesized live
   with the Web Audio API. There are no audio files to host.

   Music is one continuous sequencer. Each "mood" is an
   arrangement of the same theme; switching moods waits for the
   next beat, glides the tempo, and crossfades the level, so the
   music turns rather than cuts.

     Sound.unlock()      start audio (browsers need a click first)
     Sound.music(key)    e.g. "r0.board", "r1.clue", "final.reveal"
     Sound.sfx(name)     e.g. "swooshIn", "twinkle", "wrong"
   ========================================================= */
const Sound = (() => {
  const PREFS = "bearcat-jeopardy-sound";
  // Starting values come from SOUND in game.js; whatever players set in the Sound panel is remembered
  function defaults() {
    const d = { master: 100, music: 60, sfx: 80, hover: 60, echo: 50 };
    if (typeof SOUND === "object") Object.keys(d).forEach(k => { if (Number.isFinite(SOUND[k])) d[k] = Math.max(0, Math.min(100, SOUND[k])); });
    return { ...d, muted: false, musicOn: true, sfxOn: true, hoverOn: true, speed: 1, duck: true };
  }
  let P = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS));
    if (saved) {
      if (typeof saved.music === "boolean") saved.musicOn = saved.music, delete saved.music;   // older saves
      if (typeof saved.sfx === "boolean") saved.sfxOn = saved.sfx, delete saved.sfx;
      Object.keys(P).forEach(k => { if (typeof saved[k] === typeof P[k]) P[k] = saved[k]; });
    }
  } catch (e) {}
  const persist = () => { try { localStorage.setItem(PREFS, JSON.stringify(P)); } catch (e) {} };

  let ctx = null, out, master, musicBus, sfxBus, hoverBus, verbOut, verb, noiseBuf;

  /* ---------- Setup ---------- */
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createDynamicsCompressor();
      out.threshold.value = -12; out.ratio.value = 4; out.attack.value = .005; out.release.value = .2;
      master = ctx.createGain();
      out.connect(master); master.connect(ctx.destination);

      verb = ctx.createConvolver();
      verb.buffer = impulse(2.4, 2.8);
      verbOut = ctx.createGain();
      verb.connect(verbOut); verbOut.connect(out);

      musicBus = ctx.createGain(); musicBus.gain.value = 0;
      sfxBus = ctx.createGain();
      [musicBus, sfxBus].forEach((bus, i) => {
        bus.connect(out);
        const send = ctx.createGain(); send.gain.value = i ? .25 : .35;
        bus.connect(send); send.connect(verb);
      });
      hoverBus = ctx.createGain();                 // dry, so blips stay crisp
      hoverBus.connect(out);
      applyLevels(true);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) ctx.suspend(); else ctx.resume();
      });
    }
    if (ctx.state === "suspended" && !document.hidden) ctx.resume();
    if (P.musicOn) startSeq();
  }

  function impulse(secs, decay) {
    const len = ctx.sampleRate * secs, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /* ---------- Building blocks ---------- */
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const Z = .0001;

  // One enveloped oscillator (or detuned pair), optionally filtered
  function voice(o) {
    const t = o.t, a = o.attack ?? .005, d = o.decay ?? .1, s = o.sustain ?? .6, r = o.release ?? .15;
    const peak = o.gain ?? .2, hold = Math.max(t + (o.dur ?? .1), t + a + d), end = hold + r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Z, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * s, Z), t + a + d);
    g.gain.setValueAtTime(Math.max(peak * s, Z), hold);
    g.gain.exponentialRampToValueAtTime(Z, end);
    g.connect(o.dest);
    const input = filterInto(o.filter, t, g);
    const spread = o.detune ? [-o.detune, o.detune] : [0];
    spread.forEach(dt => {
      const x = ctx.createOscillator();
      x.type = o.type || "sine";
      x.frequency.setValueAtTime(o.freq, t);
      if (o.glideTo) x.frequency.exponentialRampToValueAtTime(o.glideTo, t + (o.glideTime ?? o.dur ?? .1));
      x.detune.value = dt;
      if (spread.length > 1) { const h = ctx.createGain(); h.gain.value = 1 / spread.length; x.connect(h); h.connect(input); }
      else x.connect(input);
      x.start(t); x.stop(end + .05);
    });
  }

  // Filtered noise burst: swooshes, hats, snares, cymbals
  function noise(o) {
    const t = o.t, a = o.attack ?? .002, d = o.decay ?? .1, s = o.sustain ?? .001, r = o.release ?? .05;
    const peak = o.gain ?? .2, hold = Math.max(t + (o.dur ?? 0), t + a + d), end = hold + r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Z, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * s, Z), t + a + d);
    g.gain.setValueAtTime(Math.max(peak * s, Z), hold);
    g.gain.exponentialRampToValueAtTime(Z, end);
    g.connect(o.dest);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.connect(filterInto(o.filter, t, g));
    src.start(t, Math.random() * 1.5); src.stop(end + .05);
  }

  // filter: { type, freq, q, to, time } — sweeps freq → to over time
  function filterInto(f, t, dest) {
    if (!f) return dest;
    const n = ctx.createBiquadFilter();
    n.type = f.type || "lowpass"; n.Q.value = f.q ?? 1;
    n.frequency.setValueAtTime(f.freq, t);
    if (f.to) n.frequency.exponentialRampToValueAtTime(f.to, t + (f.time ?? .2));
    if (f.back) n.frequency.exponentialRampToValueAtTime(f.back, t + (f.time ?? .2) + (f.backTime ?? .3));
    n.connect(dest);
    return n;
  }

  /* ---------- Instruments (m = MIDI note) ---------- */
  const I = {
    flute(m, t, dur, v, dest) {
      voice({ type: "triangle", freq: hz(m), t, dur, gain: .15 * v, attack: .02, decay: .2, sustain: .7, release: .15, dest });
      voice({ type: "sine", freq: hz(m) * 2, t, dur, gain: .03 * v, attack: .03, decay: .2, sustain: .5, release: .1, dest });
    },
    bell(m, t, dur, v, dest) {
      voice({ type: "sine", freq: hz(m), t, dur: .02, gain: .13 * v, attack: .002, decay: Math.max(.4, dur), sustain: .05, release: .3, dest });
      voice({ type: "sine", freq: hz(m) * 3.01, t, dur: .01, gain: .025 * v, attack: .002, decay: .15, sustain: .01, release: .1, dest });
    },
    epiano(m, t, dur, v, dest) {
      voice({ type: "sine", freq: hz(m), t, dur, gain: .09 * v, attack: .004, decay: .5, sustain: .35, release: .25, dest });
      voice({ type: "triangle", freq: hz(m) * 2, t, dur: .02, gain: .015 * v, attack: .002, decay: .15, sustain: .05, release: .1, dest });
    },
    brass(m, t, dur, v, dest) {
      voice({ type: "sawtooth", freq: hz(m), t, dur, gain: .1 * v, detune: 7, attack: .025, decay: .15, sustain: .75, release: .12,
        filter: { freq: 500, to: 3200, time: .05, back: 1600, backTime: .25, q: 1.2 }, dest });
    },
    stab(m, t, dur, v, dest) {
      voice({ type: "sawtooth", freq: hz(m), t, dur: Math.min(dur, .12), gain: .08 * v, detune: 9, attack: .008, decay: .12, sustain: .3, release: .1,
        filter: { freq: 3500, to: 900, time: .15, q: 1.5 }, dest });
    },
    pad(m, t, dur, v, dest) {
      voice({ type: "sawtooth", freq: hz(m), t, dur, gain: .04 * v, detune: 12, attack: .35, decay: .3, sustain: .85, release: .7,
        filter: { freq: 900, q: .5 }, dest });
    },
    pluck(m, t, dur, v, dest) {
      voice({ type: "triangle", freq: hz(m), t, dur: .01, gain: .07 * v, attack: .002, decay: .16, sustain: .02, release: .08, dest });
    },
    bass(m, t, dur, v, dest) {
      voice({ type: "triangle", freq: hz(m), t, dur: dur * .85, gain: .32 * v, attack: .006, decay: .15, sustain: .55, release: .07, dest });
      voice({ type: "square", freq: hz(m), t, dur: dur * .85, gain: .04 * v, attack: .006, decay: .1, sustain: .5, release: .05, filter: { freq: 600 }, dest });
    },
    bigBass(m, t, dur, v, dest) {
      voice({ type: "sawtooth", freq: hz(m), t, dur: dur * .8, gain: .17 * v, attack: .004, decay: .15, sustain: .4, release: .06,
        filter: { freq: 1600, to: 320, time: .14, q: 5 }, dest });
      voice({ type: "sine", freq: hz(m), t, dur: dur * .8, gain: .22 * v, attack: .004, decay: .1, sustain: .7, release: .06, dest });
    }
  };

  const D = {
    kick(t, v, dest) {
      voice({ type: "sine", freq: 150, glideTo: 42, glideTime: .12, t, dur: .01, gain: .9 * v, attack: .002, decay: .32, sustain: .001, release: .05, dest });
      noise({ t, decay: .012, gain: .12 * v, filter: { type: "highpass", freq: 3000 }, dest });
    },
    snare(t, v, dest) {
      noise({ t, decay: .17, gain: .32 * v, filter: { type: "bandpass", freq: 1900, q: .7 }, dest });
      voice({ type: "triangle", freq: 200, glideTo: 150, t, dur: .01, gain: .2 * v, attack: .001, decay: .09, sustain: .01, release: .03, dest });
    },
    clap(t, v, dest) {
      [0, .011, .022].forEach(o => noise({ t: t + o, decay: .012, gain: .25 * v, filter: { type: "bandpass", freq: 1300, q: 1.2 }, dest }));
      noise({ t: t + .03, decay: .16, gain: .18 * v, filter: { type: "bandpass", freq: 1200, q: 1 }, dest });
    },
    hat(t, v, dest, open) {
      noise({ t, decay: open ? .22 : .035, gain: .1 * v, filter: { type: "highpass", freq: 7500 }, dest });
    },
    shaker(t, v, dest) {
      noise({ t, attack: .012, decay: .05, gain: .05 * v, filter: { type: "bandpass", freq: 6500, q: 1.5 }, dest });
    },
    tick(t, v, dest) {
      voice({ type: "sine", freq: 1750, t, dur: .005, gain: .14 * v, attack: .001, decay: .03, sustain: .01, release: .02, dest });
      voice({ type: "square", freq: 880, t, dur: .003, gain: .02 * v, attack: .001, decay: .015, sustain: .01, release: .01, filter: { type: "bandpass", freq: 1800, q: 4 }, dest });
    },
    tom(t, m, v, dest) {
      voice({ type: "sine", freq: hz(m), glideTo: hz(m) * .62, glideTime: .25, t, dur: .01, gain: .5 * v, attack: .002, decay: .3, sustain: .01, release: .05, dest });
    },
    timpani(t, m, v, dest) {
      voice({ type: "sine", freq: hz(m), glideTo: hz(m) * .97, glideTime: 1, t, dur: .01, gain: .45 * v, attack: .004, decay: 1.1, sustain: .01, release: .2, dest });
      noise({ t, decay: .08, gain: .15 * v, filter: { type: "lowpass", freq: 500 }, dest });
    },
    crash(t, v, dest) {
      noise({ t, decay: 1.5, gain: .16 * v, filter: { type: "highpass", freq: 4500 }, dest });
    },
    swell(t, len, v, dest) {   // reverse-cymbal style riser that peaks at t + len
      noise({ t, attack: len, decay: .05, gain: .13 * v, filter: { type: "highpass", freq: 3000 }, dest });
    }
  };

  /* ---------- Harmony ---------- */
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUAL = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7] };
  function chord(name, tr) {
    const [, l, acc, q] = name.match(/^([A-G])([b#]?)(.*)$/);
    const root = (PC[l] + (acc === "b" ? -1 : acc === "#" ? 1 : 0) + tr + 24) % 12;
    const iv = QUAL[q] || QUAL[""];
    const bass = 36 + root;                                  // C2–B2
    const notes = iv.map(i => { let n = 60 + root + i; while (n > 71) n -= 12; return n; }).sort((x, y) => x - y);
    return { root, bass, iv, notes, tones: iv.map(i => root + i) };
  }
  const hit = (pat, s) => ({ x: 1, o: .65, "-": .35 }[pat[s]] || 0);

  /* ---------- The theme (original), written in F major ---------- */
  // [step 0–15, MIDI note, length in 16th steps], one array per bar
  const THEME = [
    [[0, 69, 3], [4, 72, 2], [6, 77, 4], [10, 76, 2], [12, 74, 4]],
    [[0, 72, 4], [4, 69, 2], [6, 74, 6]],
    [[0, 74, 2], [2, 77, 2], [4, 79, 4], [8, 77, 2], [10, 74, 2], [12, 70, 4]],
    [[0, 72, 4], [4, 76, 2], [6, 79, 6], [12, 72, 4]],
    [[0, 69, 3], [4, 72, 2], [6, 77, 4], [10, 76, 2], [12, 74, 4]],
    [[0, 72, 4], [4, 69, 2], [6, 74, 6]],
    [[0, 74, 2], [2, 77, 2], [4, 81, 4], [8, 79, 4], [12, 77, 4]],
    [[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 79, 4]]
  ];
  // The theme turned into a question: same opening shape, in D minor, ending up in the air
  const QUESTION = [
    [[0, 69, 4], [4, 74, 4], [8, 77, 6]],
    [[0, 77, 4], [4, 74, 4], [8, 70, 6]],
    [[0, 67, 4], [4, 70, 4], [8, 74, 6]],
    [[0, 76, 2], [2, 73, 2], [4, 76, 4], [8, 81, 8]],
    [[0, 74, 4], [4, 77, 4], [8, 81, 8]],
    [[0, 79, 4], [4, 77, 4], [8, 74, 8]],
    [[0, 70, 4], [4, 74, 4], [8, 79, 8]],
    [[0, 81, 4], [4, 79, 4], [8, 76, 4], [12, 73, 4]]
  ];
  // The theme as an answer: lifted an octave, landing home on F
  const ANSWER = [
    [[0, 74, 2], [2, 77, 2], [4, 82, 6], [10, 81, 2], [12, 77, 4]],
    [[0, 79, 2], [2, 81, 2], [4, 84, 6], [10, 82, 2], [12, 79, 4]],
    [[0, 81, 4], [4, 76, 2], [6, 81, 2], [8, 84, 8]],
    [[0, 86, 6], [6, 84, 2], [8, 81, 8]],
    [[0, 74, 2], [2, 77, 2], [4, 82, 6], [10, 81, 2], [12, 77, 4]],
    [[0, 79, 2], [2, 81, 2], [4, 84, 6], [10, 82, 2], [12, 79, 4]],
    [[0, 84, 4], [4, 81, 2], [6, 84, 2], [8, 89, 8]],
    []
  ];
  const SUSPENSE = [
    [[0, 69, 16]], [[0, 74, 8], [8, 77, 8]], [[0, 77, 16]], [[0, 76, 8], [8, 73, 8]],
    [[0, 74, 16]], [[0, 70, 8], [8, 74, 8]], [[0, 79, 16]], [[0, 76, 8], [8, 73, 8]]
  ];
  const THINK = [
    [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 77, 2], [8, 74, 4], [12, 69, 4]],
    [[0, 67, 2], [2, 70, 2], [4, 74, 2], [6, 70, 2], [8, 67, 4], [12, 74, 4]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2], [8, 72, 4], [12, 67, 4]],
    [[0, 69, 2], [2, 72, 2], [4, 77, 2], [6, 72, 2], [8, 69, 8]],
    [[0, 74, 2], [2, 77, 2], [4, 82, 4], [8, 81, 2], [10, 79, 2], [12, 77, 4]],
    [[0, 79, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 70, 8]],
    [[0, 73, 4], [4, 76, 4], [8, 81, 8]],
    [[0, 79, 4], [4, 76, 4], [8, 73, 4], [12, 69, 4]]
  ];

  // The theme as a Daily Double: same rhythm, in E minor, galloping
  const DAILY = [
    [[0, 71, 3], [4, 76, 2], [6, 79, 4], [10, 78, 2], [12, 76, 4]],
    [[0, 79, 4], [4, 76, 2], [6, 81, 6]],
    [[0, 78, 2], [2, 81, 2], [4, 86, 4], [8, 81, 2], [10, 78, 2], [12, 74, 4]],
    [[0, 75, 4], [4, 78, 2], [6, 83, 6], [12, 81, 4]],
    [[0, 71, 3], [4, 76, 2], [6, 79, 4], [10, 78, 2], [12, 76, 4]],
    [[0, 79, 4], [4, 76, 2], [6, 81, 6]],
    [[0, 76, 2], [2, 81, 2], [4, 84, 4], [8, 83, 4], [12, 81, 4]],
    [[0, 71, 2], [2, 75, 2], [4, 78, 2], [6, 81, 2], [8, 83, 4], [12, 87, 4]]
  ];

  /* ---------- Arrangements ---------- */
  // Each gets { b (bar in phrase), step, t, sp (seconds per step), ch (chord), dest }
  const comp = (inst, ch, t, dur, v, dest, up = 0) => ch.notes.forEach(n => inst(n + up, t, dur, v, dest));

  const MOODS = {
    /* Round 1 — the baseline: relaxed, bouncy, light */
    "r0.board": {
      bpm: 104, tr: 0, level: .5, melody: THEME, lead: [["flute", 0, 1]],
      chords: ["F", "Dm", "Bb", "C", "F", "Dm", "Bb", "C7"],
      play({ step, t, sp, ch, dest }) {
        const c = hit("x.....x...x.....", step); if (c) comp(I.epiano, ch, t, sp * 3, c, dest);
        const bl = { 0: 0, 6: 7, 8: 12, 12: 7, 14: 4 }[step];
        if (bl !== undefined) I.bass(ch.bass + (step === 14 ? ch.iv[1] : bl), t, sp * 2, .9, dest);
        if (hit("x.......x.......", step)) D.kick(t, .55, dest);
        if (hit("....-.......-...", step)) D.tick(t, .6, dest);
        const s = hit("-.o.-.o.-.o.-.o.", step); if (s) D.shaker(t, s, dest);
      }
    },
    /* Round 1 — the clue: same key family, minor, quicker pulse, ticking clock */
    "r0.clue": {
      bpm: 112, tr: 0, level: .42, duck: true, melody: QUESTION, lead: [["bell", 0, 1.1]],
      chords: ["Dm", "Bb", "Gm", "A", "Dm", "Bb", "Gm", "A7"],
      play({ step, t, sp, ch, dest }) {
        if (step === 0) comp(I.pad, ch, t, sp * 15, 1, dest);
        const p = hit("x.o.o.o.x.o.o.o.", step); if (p) I.bass(ch.bass, t, sp, .75 * p, dest);
        const k = hit("x..o............", step); if (k) D.kick(t, .45 * k, dest);
        const c = hit("x.o.x.o.x.o.x.o.", step); if (c) D.tick(t, .5 * c, dest);
      }
    },
    /* Round 1 — the answer: bright, rising, "I did it!" */
    "r0.reveal": {
      bpm: 120, tr: 0, level: .55, melody: ANSWER, lead: [["flute", 0, 1], ["bell", 12, .5]],
      chords: ["Bb", "C", "Am", "Dm", "Bb", "C", "F", "F"],
      play({ b, step, t, sp, ch, dest }) {
        if (step === 0 || step === 8) comp(I.epiano, ch, t, sp * 6, .9, dest);
        if (step % 2 === 0) I.pluck(ch.notes[(step / 2) % ch.notes.length] + 12, t, sp, .9, dest);
        if (step % 4 === 0 || step % 4 === 2) I.bass(ch.bass + (step % 4 ? 12 : 0), t, sp * 1.6, .85, dest);
        if (hit("x...x...x...x...", step)) D.kick(t, .6, dest);
        if (hit("....x.......x...", step)) D.clap(t, .7, dest);
        if (hit("..x...x...x...x.", step)) D.hat(t, .7, dest);
        if (b === 7 && step === 8) D.swell(t, sp * 8, .8, dest);
      }
    },

    /* Double Jeopardy — up a step, faster, brass and a full kit */
    "r1.board": {
      bpm: 128, tr: 2, level: .55, melody: THEME, lead: [["brass", 0, 1], ["bell", 12, .45]],
      chords: ["F", "Dm", "Bb", "C", "F", "Dm", "Bb", "C7"],
      play({ b, step, t, sp, ch, dest }) {
        const s = hit("x..x..x...x..x..", step); if (s) comp(I.stab, ch, t, sp, s, dest);
        if (step % 2 === 0) I.bigBass(ch.bass + (step % 4 ? 12 : 0), t, sp * 1.8, .9, dest);
        if (step % 4 === 0) D.kick(t, .8, dest);
        if (hit("....x.......x...", step)) D.snare(t, .75, dest);
        if (hit("..o...o...o...o.", step)) D.hat(t, .8, dest, true);
        if (hit("-.-.-.-.-.-.-.-.", step)) D.hat(t, .5, dest);
        if (b % 4 === 0 && step === 0) D.crash(t, .7, dest);
        if (b % 2 === 1 && step % 2 === 1) I.pluck(ch.notes[((step - 1) / 2) % ch.notes.length] + 24, t, sp, .7, dest);
      }
    },
    "r1.clue": {
      bpm: 132, tr: 2, level: .48, duck: true, melody: QUESTION, lead: [["bell", 0, 1.1], ["brass", -12, .45]],
      chords: ["Dm", "Bb", "Gm", "A", "Dm", "Bb", "Gm", "A7"],
      play({ b, step, t, sp, ch, dest }) {
        if (step === 0) comp(I.pad, ch, t, sp * 15, 1.2, dest);
        if (step === 0 && (b === 3 || b === 7)) comp(I.brass, ch, t + sp * 4, sp * 11, .55, dest);
        I.bigBass(ch.bass, t, sp * .9, step % 4 === 0 ? .9 : .55, dest);
        const k = hit("x.....x...x.....", step); if (k) D.kick(t, .7, dest);
        const c = hit("xo-ox-o-xo-ox-o-", step); if (c) D.tick(t, .45 * c, dest);
        if (b % 2 === 1 && (step === 12 || step === 14)) D.tom(t, step === 12 ? 50 : 45, .7, dest);
        if (b === 7 && step >= 8) D.snare(t, .25 + (step - 8) * .07, dest);
      }
    },
    "r1.reveal": {
      bpm: 140, tr: 2, level: .62, melody: ANSWER, lead: [["brass", 0, 1], ["bell", 12, .5]],
      chords: ["Bb", "C", "Am", "Dm", "Bb", "C", "F", "F"],
      play({ b, step, t, sp, ch, dest }) {
        const s = hit("x..x..x.x..x..x.", step); if (s) comp(I.stab, ch, t, sp, s, dest, 12);
        if (step === 0) comp(I.pad, ch, t, sp * 15, .8, dest);
        I.pluck(ch.notes[step % ch.notes.length] + 24, t, sp, .6, dest);
        if (step % 2 === 0) I.bigBass(ch.bass + (step % 4 ? 12 : 0), t, sp * 1.8, 1, dest);
        if (step % 4 === 0) D.kick(t, .85, dest);
        if (hit("....x.......x...", step)) { D.snare(t, .7, dest); D.clap(t, .6, dest); }
        if (hit("..x...x...x...x.", step)) D.hat(t, .85, dest, true);
        if (step % 2 === 1) D.hat(t, .45, dest);
        if (b % 2 === 0 && step === 0) D.crash(t, .8, dest);
        if (b === 7 && step >= 8) D.tom(t, 52 - (step - 8) * 1.5, .6, dest);
      }
    },

    /* Final Jeopardy — the category and wagers: slow, grand, suspenseful */
    "final.board": {
      bpm: 80, tr: 0, level: .5, melody: SUSPENSE, lead: [["brass", -12, .7]],
      chords: ["Dm", "Dm", "Bb", "A", "Gm", "Gm", "Eb", "A7"],
      play({ b, step, t, sp, ch, dest }) {
        if (step === 0) comp(I.pad, ch, t, sp * 15, 1.3, dest);
        if (step === 0 || step === 8) D.timpani(t, ch.bass, step ? .5 : .8, dest);
        if (step === 0) I.bass(ch.bass, t, sp * 14, .8, dest);
        if (b % 4 === 3 && step >= 12) D.timpani(t, ch.bass, .3, dest);
        if (hit("x..o............", step)) D.kick(t, .4, dest);
      }
    },
    /* Final Jeopardy — the 30 seconds: playful, tense thinking music */
    "final.clue": {
      bpm: 120, tr: 0, level: .45, duck: true, melody: THINK, lead: [["bell", 0, 1], ["pluck", -12, .8]],
      chords: ["Dm", "Gm", "C", "F", "Bb", "Gm", "A", "A7"],
      play({ step, t, sp, ch, dest }) {
        if (step % 4 === 0) I.bass(ch.bass + (step % 8 ? 7 : 0), t, sp * 1.2, .8, dest);
        const c = hit("x...o...x...o...", step); if (c) comp(I.epiano, ch, t, sp, .6 * c, dest);
        if (step % 4 === 0) D.tick(t, step % 8 ? .7 : 1, dest);
      }
    }
  };
  MOODS["final.reveal"] = MOODS["r1.reveal"];  // the big finish

  /* Daily Double — the most intense music in the game, and the most fun:
     the theme in E minor at a gallop, with brass, off-beat stabs and a full kit */
  MOODS.dd = {
    bpm: 152, tr: 0, level: .6, duck: true, melody: DAILY, lead: [["brass", 0, 1], ["bell", 12, .55]],
    chords: ["Em", "C", "D", "B7", "Em", "C", "Am", "B7"],
    play({ b, step, t, sp, ch, dest }) {
      const s = hit("..x...x...x...x.", step); if (s) comp(I.stab, ch, t, sp, s, dest, 12);
      const g = hit("x.ox.ox.ox.ox.oo", step); if (g) I.bigBass(ch.bass + (step % 4 === 0 ? 0 : 12), t, sp * .9, g, dest);
      if (step === 0) comp(I.pad, ch, t, sp * 15, 1, dest);
      if (step % 4 === 0) D.kick(t, .9, dest);
      if (hit("....x.......x...", step)) { D.snare(t, .8, dest); D.clap(t, .5, dest); }
      D.hat(t, step % 2 ? .4 : .6, dest);
      if (hit("..o...o...o...o.", step)) D.hat(t, .7, dest, true);
      if (b % 2 === 0 && step === 0) D.crash(t, .8, dest);
      if (b % 4 === 3 && step >= 12) D.tom(t, 55 - (step - 12) * 3, .75, dest);
      if (b % 4 === 1 && step === 8) D.swell(t, sp * 8, .7, dest);
      if (step % 2 === 1) I.pluck(ch.notes[((step - 1) / 2) % ch.notes.length] + 24, t, sp, .55, dest);
    }
  };
  MOODS["dd.reveal"] = MOODS["r1.reveal"];

  /* ---------- Sequencer ---------- */
  let timerId = null, nextT = 0, step = 0, bar = 0, mood = null, pending = null, bpm = 104;

  function startSeq() {
    if (timerId || !ctx || !mood) return;
    nextT = ctx.currentTime + .1; step = 0; bar = 0; bpm = mood.bpm * P.speed;
    level(mood);
    timerId = setInterval(tick, 25);
  }
  function stopSeq() {
    clearInterval(timerId); timerId = null;
    if (musicBus) musicBus.gain.setTargetAtTime(0, ctx.currentTime, .15);
  }
  function applyLevels(now) {
    if (!ctx) return;
    const t = ctx.currentTime, tc = now ? .001 : .05;
    master.gain.setTargetAtTime(P.muted ? 0 : P.master / 100, t, tc);
    sfxBus.gain.setTargetAtTime(P.sfxOn ? P.sfx / 100 : 0, t, tc);
    hoverBus.gain.setTargetAtTime(P.hoverOn ? P.hover / 100 : 0, t, tc);
    verbOut.gain.setTargetAtTime(.3 * P.echo / 50, t, tc);
    if (mood) level(mood);
  }
  const duckers = new Set();    // what's playing on the clue card ("video", "clip"): the music gets out of its way
  function level(m) {
    const lvl = m.duck && !P.duck ? m.level * 1.3 : m.level;
    musicBus.gain.setTargetAtTime(P.musicOn && !duckers.size ? lvl * P.music / 100 : 0, ctx.currentTime, .35);
  }
  function duck(on, who = "video") {
    if (duckers.has(who) === !!on) return;
    if (on) duckers.add(who); else duckers.delete(who);
    if (ctx && mood) level(mood);
  }

  function tick() {
    if (ctx.state !== "running") return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05;   // after a pause (e.g. a confirm box) skip ahead, don't burst
    while (nextT < ctx.currentTime + .12) {
      if (pending && step % 4 === 0) {                           // change on a beat, start the new phrase there
        const from = mood; mood = pending; pending = null; bar = 0; step = 0;
        transition(from, mood, nextT);
        level(mood);
      }
      bpm += (mood.bpm * P.speed - bpm) * .15;                              // glide into the new tempo
      const sp = 60 / bpm / 4, b = bar % mood.chords.length;
      const ch = chord(mood.chords[b], mood.tr);
      (mood.melody[b] || []).forEach(([s, n, len]) => {
        if (s === step) mood.lead.forEach(([name, oct, v]) => I[name](n + mood.tr + oct, nextT, len * sp, v, musicBus));
      });
      mood.play({ b, step, t: nextT, sp, ch, dest: musicBus });
      nextT += sp;
      if (++step === 16) { step = 0; bar++; }
    }
  }

  // A short fill so mood changes feel like the music turning, not cutting
  function transition(from, to, t) {
    if (!from) return;
    const dest = musicBus;
    if (to.melody === QUESTION || to.melody === THINK) { D.timpani(t, chord(to.chords[0], to.tr).bass, .6, dest); }
    else if (to.melody === ANSWER) { D.crash(t, .6, dest); comp(I.bell, chord(to.chords[0], to.tr), t, .4, .6, dest, 12); }
    else if (to.melody === THEME && from.melody !== THEME) { D.tick(t, .5, dest); }
    else if (to.melody === THEME) { D.crash(t, .7, dest); D.kick(t, .8, dest); }
    else if (to.melody === DAILY) { D.crash(t, .9, dest); D.kick(t, 1, dest); D.timpani(t, 40, .9, dest); }
    else if (to.melody === SUSPENSE) { D.timpani(t, chord(to.chords[0], to.tr).bass, 1, dest); }
  }

  function music(key) {
    const m = MOODS[key];
    if (!m) return;
    if (!mood) { mood = m; if (ctx && P.musicOn) startSeq(); return; }
    pending = m === mood ? null : m;
  }

  /* ---------- Sound effects ---------- */
  const S = {
    click(t, d) { voice({ type: "triangle", freq: 950, glideTo: 700, t, dur: .01, gain: .12, attack: .002, decay: .045, sustain: .01, release: .02, dest: d }); },
    tap(t, d) { voice({ type: "sine", freq: 1500, t, dur: .005, gain: .07, attack: .001, decay: .025, sustain: .01, release: .02, dest: d }); },
    tick(t, d) { D.tick(t, 1, d); },
    tab(t, d) {
      voice({ type: "sine", freq: 660, glideTo: 990, t, dur: .05, gain: .13, attack: .003, decay: .07, sustain: .1, release: .04, dest: d });
      noise({ t, decay: .02, gain: .05, filter: { type: "highpass", freq: 5000 }, dest: d });
    },
    swooshIn(t, d) {
      noise({ t, attack: .22, decay: .14, gain: .6, filter: { type: "bandpass", freq: 350, to: 4500, time: .32, q: 1.4 }, dest: d });
      voice({ type: "sine", freq: 260, glideTo: 880, glideTime: .3, t, dur: .25, gain: .09, attack: .15, decay: .1, sustain: .3, release: .1, dest: d });
    },
    swooshOut(t, d) {
      noise({ t, attack: .05, decay: .3, gain: .55, filter: { type: "bandpass", freq: 4200, to: 300, time: .34, q: 1.4 }, dest: d });
      voice({ type: "sine", freq: 820, glideTo: 230, glideTime: .3, t, dur: .2, gain: .08, attack: .03, decay: .2, sustain: .2, release: .1, dest: d });
    },
    twinkle(t, d) {
      [84, 88, 91, 96, 100, 103].forEach((m, i) => I.bell(m, t + i * .045, .5, .8, d));
      noise({ t, attack: .1, decay: .5, gain: .05, filter: { type: "highpass", freq: 9000 }, dest: d });
    },
    untwinkle(t, d) { [96, 91, 88, 84].forEach((m, i) => I.bell(m, t + i * .04, .3, .7, d)); },
    right(t, d) { I.bell(84, t, .3, 1.6, d); I.bell(91, t + .09, .6, 1.8, d); I.pluck(96, t + .09, .1, 1.2, d); },
    wrong(t, d) {
      [110, 116.5].forEach(f => voice({ type: "sawtooth", freq: f, glideTo: f * .85, glideTime: .45, t, dur: .38, gain: .12, attack: .01, decay: .1, sustain: .8, release: .08, filter: { freq: 1400 }, dest: d }));
    },
    undo(t, d) { voice({ type: "sine", freq: 620, glideTo: 380, t, dur: .06, gain: .1, attack: .003, decay: .08, sustain: .1, release: .04, dest: d }); },
    pop(t, d) {
      voice({ type: "sine", freq: 420, glideTo: 980, glideTime: .08, t, dur: .06, gain: .14, attack: .003, decay: .09, sustain: .1, release: .05, dest: d });
      noise({ t, attack: .08, decay: .1, gain: .1, filter: { type: "bandpass", freq: 900, to: 3500, time: .15, q: 1.2 }, dest: d });
    },
    stamp(t, d) {
      voice({ type: "sine", freq: 190, glideTo: 60, glideTime: .14, t: t + .05, dur: .01, gain: .45, attack: .002, decay: .18, sustain: .01, release: .05, dest: d });
      noise({ t: t + .05, decay: .06, gain: .12, filter: { type: "lowpass", freq: 900 }, dest: d });
    },
    save(t, d) { I.bell(88, t, .2, 1.3, d); I.bell(93, t + .08, .4, 1.4, d); },
    add(t, d) { I.pluck(79, t, .1, 2, d); I.pluck(86, t + .07, .1, 2, d); S.pop(t, d); },
    remove(t, d) { I.pluck(84, t, .1, 2, d); I.pluck(77, t + .08, .1, 2, d); I.pluck(72, t + .16, .1, 2, d); },
    toggleOn(t, d) { voice({ type: "sine", freq: 600, glideTo: 950, t, dur: .05, gain: .12, attack: .003, decay: .08, sustain: .1, release: .04, dest: d }); },
    toggleOff(t, d) { voice({ type: "sine", freq: 950, glideTo: 600, t, dur: .05, gain: .12, attack: .003, decay: .08, sustain: .1, release: .04, dest: d }); },
    newGame(t, d) { [72, 76, 79, 84, 88].forEach((m, i) => I.bell(m, t + i * .07, .4, 1.3, d)); S.swooshIn(t, d); },
    dd(t, d) {                                   // Daily Double: riser, then a big stab
      noise({ t, attack: .45, decay: .05, gain: .25, filter: { type: "bandpass", freq: 300, to: 7000, time: .45, q: 1.2 }, dest: d });
      voice({ type: "sawtooth", freq: 180, glideTo: 1400, glideTime: .45, t, dur: .42, gain: .06, attack: .2, decay: .2, sustain: .6, release: .05, filter: { freq: 2500 }, dest: d });
      const h = t + .47;
      [62, 66, 69, 74, 78].forEach(m => I.brass(m, h, .5, .8, d));
      D.kick(h, .8, d); D.crash(h, .8, d); D.timpani(h, 38, .8, d);
    },
    ddGo(t, d) { S.swooshIn(t, d); D.timpani(t + .25, 41, 1, d); D.tick(t + .25, 1, d); },
    roundUp(t, d) {                              // into Double Jeopardy
      S.swooshIn(t, d);
      [67, 71, 74, 79].forEach(m => I.brass(m, t + .3, .45, .85, d));
      D.kick(t + .3, .8, d); D.crash(t + .3, .8, d);
    },
    finalReveal(t, d) {                          // a gong for the Final clue
      [98, 147, 233, 311].forEach((f, i) => voice({ type: "sine", freq: f, t, dur: .01, gain: [.3, .12, .07, .04][i], attack: .01, decay: 2.6, sustain: .01, release: .4, dest: d }));
      noise({ t, decay: .5, gain: .08, filter: { type: "lowpass", freq: 1200 }, dest: d });
    },
    fanfare(t, d) {
      [[67, 0, .12], [67, .14, .12], [67, .28, .12], [72, .42, .7]].forEach(([m, o, l]) => { I.brass(m, t + o, l, 1, d); I.brass(m + 4, t + o, l, .7, d); });
      D.crash(t + .42, .8, d); D.kick(t + .42, .8, d);
      [84, 88, 91, 96].forEach((m, i) => I.bell(m, t + .5 + i * .06, .5, 1, d));
    },
    buzzIn(t, d) {                               // someone rang in: a bright two-tone ring
      [[1047, 0], [1397, .085]].forEach(([f, o]) => voice({ type: "square", freq: f, t: t + o, dur: .07, gain: .07, attack: .003, decay: .05, sustain: .6, release: .06, filter: { freq: 3500 }, dest: d }));
      I.bell(96, t + .085, .4, 1.2, d);
    },
    select(t, d) { I.bell(91, t, .15, .9, d); I.pluck(79, t, .08, 1, d); },
    shuffle(t, d) { [79, 84, 76, 88, 81, 86].forEach((m, i) => I.pluck(m, t + i * .045, .1, 1.8, d)); },
    countdown(t, d) { D.tick(t, 1.6, d); voice({ type: "sine", freq: 1320, t, dur: .02, gain: .06, attack: .002, decay: .06, sustain: .01, release: .03, dest: d }); },
    pensDown(t, d) {
      I.bell(76, t, .6, 2, d); I.bell(69, t + .28, 1.2, 2, d);
      [138, 146].forEach(f => voice({ type: "square", freq: f, t: t + .28, dur: .5, gain: .045, attack: .01, decay: .1, sustain: .8, release: .1, filter: { freq: 900 }, dest: d }));
    }
  };

  /* Hover blip: a tiny tick, pitched up by `pitch` semitones and panned from -1 (left) to 1 (right) */
  let lastBlip = 0;
  const panners = {};
  function blip(pitch = 0, pan = 0) {
    if (!ctx || !P.hoverOn || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - lastBlip < .03) return;                  // sweeping fast across tiles stays a light patter
    lastBlip = now;
    let dest = hoverBus;
    if (pan && ctx.createStereoPanner) {
      const key = pan.toFixed(2);
      if (!panners[key]) { panners[key] = ctx.createStereoPanner(); panners[key].pan.value = pan; panners[key].connect(hoverBus); }
      dest = panners[key];
    }
    voice({ type: "sine", freq: hz(84 + pitch), t: now + .005, dur: .004, gain: .07, attack: .002, decay: .025, sustain: .01, release: .015, dest });
  }

  function sfx(name) {
    if (!ctx || !P.sfxOn || !S[name]) return;
    S[name](ctx.currentTime + .01, sfxBus);
  }

  /* ---------- Settings (the Sound panel) ----------
     master / music / sfx / hover / echo: 0–100
     muted / musicOn / sfxOn / hoverOn / duck: true or false
     speed: music tempo multiplier, e.g. 0.85, 1, 1.15 */
  function set(key, value) {
    if (!(key in P) || typeof value !== typeof P[key]) return;
    P[key] = typeof value === "number" ? Math.max(key === "speed" ? .5 : 0, Math.min(key === "speed" ? 2 : 100, value)) : value;
    persist();
    if (!ctx) return;
    if (key === "musicOn") { if (!P.musicOn) stopSeq(); else if (mood) startSeq(); }
    applyLevels();
  }
  function reset() {
    const keep = P.muted;
    P = defaults(); P.muted = keep;
    persist();
    if (!ctx) return;
    if (P.musicOn && mood) startSeq();
    applyLevels();
  }

  return {
    unlock, music, sfx, blip, set, reset, duck,
    get: key => P[key],
    defaults: () => defaults(),
    get musicOn() { return P.musicOn; }, get sfxOn() { return P.sfxOn; },
    get mood() { return mood && Object.keys(MOODS).find(k => MOODS[k] === mood); }   // for testing
  };
})();
