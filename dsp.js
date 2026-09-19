// Aaina DSP: pitch tracking, cycle-level jitter/shimmer, pauses, rhythm. Pure functions, no DOM.
(function (root) {
  const clamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const trimmed = a => { const cut = pct(a, 0.9); return mean(a.filter(v => v <= cut)); };
  const scale = (x, [lo, hi]) => clamp(((x - lo) / (hi - lo)) * 100);

  // Calibration: [value that maps to 0, value that maps to 100]. Tune with real recordings.
  const RANGES = {
    jitter: [0.6, 3],   // % cycle-to-cycle period change
    shimmer: [5, 14],   // % cycle-to-cycle amplitude change
    fast: [4.5, 7],     // syllable-like peaks per second (tension side)
    flat: [1.2, 3.5],   // pitch SD in semitones (low = flat voice)
    pause: [0.15, 0.45],// share of time spent in pauses
    slow: [2, 4.5]      // syllable-like peaks per second (low-energy side)
  };

  const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };

  // Normalised autocorrelation pitch tracker on a 2x-decimated frame.
  function pitch(buf, sr, fmin = 75, fmax = 400) {
    const n = buf.length >> 1, fs = sr / 2, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
    const minLag = Math.floor(fs / fmax), maxLag = Math.min(Math.ceil(fs / fmin), (n >> 1) - 2);
    const m = n - maxLag - 1;
    let e1 = 0;
    for (let i = 0; i < m; i++) e1 += x[i] * x[i];
    if (e1 < 1e-9) return { f0: 0, conf: 0 };
    const r = new Float64Array(maxLag + 2);
    let e2 = e1;
    for (let L = 1; L <= maxLag + 1; L++) {
      e2 += x[L + m - 1] * x[L + m - 1] - x[L - 1] * x[L - 1];
      let num = 0;
      for (let i = 0; i < m; i++) num += x[i] * x[i + L];
      r[L] = num / Math.sqrt(e1 * e2 + 1e-12);
    }
    let best = 0;
    for (let L = minLag; L <= maxLag; L++) if (r[L] > best) best = r[L];
    if (best < 0.3) return { f0: 0, conf: best };
    for (let L = minLag; L <= maxLag; L++) {
      if (r[L] >= 0.9 * best && r[L] >= r[L - 1] && r[L] >= r[L + 1]) { // shortest strong period avoids octave-down errors
        const a = r[L - 1], b = r[L], c = r[L + 1], d = a - 2 * b + c;
        return { f0: fs / (L + (d ? (0.5 * (a - c)) / d : 0)), conf: b };
      }
    }
    return { f0: 0, conf: best };
  }

  // Cycle-to-cycle jitter and shimmer inside voiced runs, tracking one glottal period at a time.
  function cycles(x, sr, frames, hopS, W, minC) {
    const dT = [], dA = [], Ts = [], As = [];
    const F = frames.length;
    for (let i = 0; i < F;) {
      if (!frames[i].f0) { i++; continue; }
      let j = i; while (j < F && frames[j].f0) j++;
      if (j - i >= 6) {
        let p = i * hopS + (W >> 1); const end = (j - 1) * hopS + (W >> 1);
        let prevT = 0, prevA = 0;
        while (p < end) {
          const k = Math.min(j - 1, Math.max(i, Math.round((p - (W >> 1)) / hopS)));
          const guess = prevT || sr / frames[k].f0, T = Math.round(guess);
          const lo = Math.floor(guess * 0.88), hi = Math.ceil(guess * 1.12);
          if (p + hi + T + 2 >= x.length) break;
          let ea = 0; for (let n = 0; n < T; n++) ea += x[p + n] * x[p + n];
          const c = new Float64Array(hi + 2); let bl = 0, bc = -1, eb = 0;
          for (let n = 0; n < T; n++) eb += x[p + lo + n] * x[p + lo + n];
          for (let L = lo; L <= hi; L++) {
            if (L > lo) eb += x[p + L + T - 1] * x[p + L + T - 1] - x[p + L - 1] * x[p + L - 1];
            let num = 0; for (let n = 0; n < T; n++) num += x[p + n] * x[p + L + n];
            c[L] = num / Math.sqrt(ea * eb + 1e-12);
            if (c[L] > bc) { bc = c[L]; bl = L; }
          }
          if (bc < minC || bl <= lo || bl >= hi) { prevT = 0; p += Math.round(guess); continue; }
          const a = c[bl - 1], b = c[bl], d = c[bl + 1], q = a - 2 * b + d;
          const s = bl + (q ? (0.5 * (a - d)) / q : 0);
          let mx = -1, mn = 1; for (let n = 0; n < T; n++) { const v = x[p + n]; if (v > mx) mx = v; if (v < mn) mn = v; }
          const A = mx - mn;
          Ts.push(s); As.push(A);
          if (prevT) { dT.push(Math.abs(s - prevT)); dA.push(Math.abs(A - prevA)); }
          prevT = s; prevA = A; p += Math.round(s);
        }
      }
      i = j;
    }
    if (!dT.length) return { n: 0, jitter: 0, shimmer: 0 };
    return { n: dT.length, jitter: (trimmed(dT) / mean(Ts)) * 100, shimmer: (trimmed(dA) / mean(As)) * 100 };
  }

  function analyzeAudio(raw, sr) {
    // Phones with auto-gain off can be very quiet, so scale so the loud parts peak near 0.3.
    const mags = []; for (let i = 0; i < raw.length; i += 16) mags.push(Math.abs(raw[i]));
    const level = pct(mags, 0.99), g = Math.min(300, 0.3 / Math.max(level, 1e-6));
    const x = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) x[i] = raw[i] * g;
    const W = 2048, hopS = Math.round(0.02 * sr), hop = hopS / sr, frames = [], d = { level: +level.toFixed(4) };
    for (let s = 0; s + W <= x.length; s += hopS) {
      const w = x.subarray(s, s + W), r = rms(w); let f0 = 0;
      if (r > 0.004) { const p = pitch(w, sr); if (p.conf >= 0.45) f0 = p.f0; }
      frames.push({ rms: r, f0 });
    }
    if (frames.length < 100) return { ok: false, reason: 'short', d };
    const all = frames.map(f => f.rms);
    const thr = Math.max(pct(all, 0.1) * 2.5, pct(all, 0.95) * 0.12, 0.004);
    const sp = all.map(v => v > thr);
    frames.forEach((f, i) => { if (!sp[i]) f.f0 = 0; });
    const first = sp.indexOf(true), last = sp.lastIndexOf(true);
    if (first < 0 || (last - first) * hop < 4) return { ok: false, reason: 'quiet', d };
    const seg = frames.slice(first, last + 1), s = sp.slice(first, last + 1), dur = seg.length * hop;

    const pauses = []; let run = 0;
    s.forEach(on => { if (!on) run++; else { if (run * hop >= 0.25) pauses.push(run * hop); run = 0; } });
    const pauseRatio = (s.filter(on => !on).length * hop) / dur;

    const f0s = seg.filter(f => f.f0 > 0).map(f => f.f0), voicedSec = f0s.length * hop;
    d.voiced = +voicedSec.toFixed(1);
    if (voicedSec < 2) return { ok: false, reason: 'unvoiced', d };
    const pitchMean = pct(f0s, 0.5), pitchSD = sd(f0s.map(f => 12 * Math.log2(f / pitchMean)));

    // Low-pass a copy (noise and formant ringing make cycles look different), then track periods.
    const a = 1 - Math.exp((-2 * Math.PI * 1200) / sr), xl = new Float32Array(x.length);
    for (let i = 1; i < x.length; i++) xl[i] = xl[i - 1] + a * (x[i] - xl[i - 1]);
    let cy = cycles(xl, sr, frames, hopS, W, 0.7);
    if (cy.n < 25) cy = cycles(xl, sr, frames, hopS, W, 0.5);
    d.cycles = cy.n;
    const approx = cy.n < 25; // steadiness could not be measured cleanly: still give a rougher reading
    if (approx && voicedSec / dur < 0.35) return { ok: false, reason: 'noisy', d };

    const sm = seg.map((_, i) => mean(seg.slice(Math.max(0, i - 2), i + 3).map(f => f.rms)));
    const gap = Math.max(1, Math.round(0.12 / hop));
    let peaks = 0, lastPk = -99;
    for (let i = 1; i < sm.length - 1; i++) {
      if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > thr * 1.5 && i - lastPk >= gap) { peaks++; lastPk = i; }
    }
    const rate = peaks / dur;

    const tension = approx ? scale(rate, RANGES.fast) : mean([scale(cy.jitter, RANGES.jitter), scale(cy.shimmer, RANGES.shimmer), scale(rate, RANGES.fast)]);
    const low = mean([100 - scale(pitchSD, RANGES.flat), scale(pauseRatio, RANGES.pause), 100 - scale(rate, RANGES.slow)]);
    return {
      ok: true, tension: Math.round(tension), low: Math.round(low),
      m: { dur, voicedSec, pitchMean, pitchSD, jitter: cy.jitter, shimmer: cy.shimmer, cycles: cy.n, approx, pauseRatio, pauses: pauses.length, rate }
    };
  }

  const api = { rms, pitch, analyzeAudio, RANGES };
  if (typeof module !== 'undefined') module.exports = api;
  root.DSP = api;
})(typeof self !== 'undefined' ? self : this);
