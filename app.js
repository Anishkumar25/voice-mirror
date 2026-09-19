(() => {
  'use strict';
  const CFG = { recSec: 30, minSec: 12 };
  const PROMPTS = ['Tell me how your day has been.', 'What is on your mind right now?', 'What is one thing you are looking forward to?'];
  const KEY = 'aaina.sessions.v1';
  const $ = id => document.getElementById(id);
  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const level = v => (v < 35 ? 'Low' : v < 65 ? 'Moderate' : 'High');
  const when = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    set(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-60))); } catch {} }
  };

  let ctx, stream, an, wbuf, chunks, t0, raf, live = false;

  // ---------- views ----------
  function show(v) {
    ['home', 'rec', 'result', 'trends'].forEach(id => { $(id).hidden = id !== v; });
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === (v === 'trends' ? 'trends' : 'home')));
    if (v === 'trends') renderTrends();
    window.scrollTo(0, 0);
  }
  function fail(msg) { $('err').textContent = msg; show('home'); }

  // ---------- audio ----------
  const mute = c => { const g = c.createGain(); g.gain.value = 0; g.connect(c.destination); return g; };

  async function tap(src, sink) {
    try {
      const code = 'class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("aaina-rec",R)';
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      const n = new AudioWorkletNode(ctx, 'aaina-rec');
      n.port.onmessage = e => { if (live) chunks.push(e.data); };
      src.connect(n); n.connect(sink);
    } catch {
      const n = ctx.createScriptProcessor(4096, 1, 1);
      n.onaudioprocess = e => { if (live) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(n); n.connect(sink);
    }
  }

  async function start() {
    $('err').textContent = '';
    if (!navigator.mediaDevices || !window.isSecureContext) return fail('The microphone needs a secure (https) page.');
    try {
      // Filters off: they distort jitter and shimmer, which we measure raw.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      return fail(e.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser settings and try again.'
        : e.name === 'NotFoundError' ? 'No microphone found on this device.' : 'Could not open the microphone (' + e.name + ').');
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream), sink = mute(ctx);
    an = ctx.createAnalyser(); an.fftSize = 2048;
    src.connect(an); an.connect(sink);
    wbuf = new Float32Array(an.fftSize);
    chunks = [];
    live = true;
    await tap(src, sink);
    t0 = performance.now();
    show('rec');
    const c = $('orb'), d = window.devicePixelRatio || 1;
    c.width = c.clientWidth * d; c.height = c.clientHeight * d;
    loop();
  }

  function drawOrb() {
    const c = $('orb'), g = c.getContext('2d'), w = c.width, h = c.height, cx = w / 2, cy = h / 2, d = window.devicePixelRatio || 1;
    const lvl = Math.min(1, DSP.rms(wbuf) * 7), base = Math.min(w, h) * 0.27;
    g.clearRect(0, 0, w, h);
    const glow = g.createRadialGradient(cx, cy, base * 0.4, cx, cy, base * (1.55 + lvl * 0.5));
    glow.addColorStop(0, 'rgba(122,92,209,.30)'); glow.addColorStop(1, 'rgba(122,92,209,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, base * (1.55 + lvl * 0.5), 0, 6.2832); g.fill();
    const face = g.createRadialGradient(cx - base * 0.3, cy - base * 0.35, base * 0.1, cx, cy, base);
    face.addColorStop(0, '#ffffff'); face.addColorStop(1, '#b9c6e0');
    g.fillStyle = face; g.beginPath(); g.arc(cx, cy, base, 0, 6.2832); g.fill();
    g.strokeStyle = '#1c2240'; g.lineWidth = 2.5 * d; g.lineJoin = 'round'; g.beginPath();
    const N = 200;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * 6.2832, s = wbuf[Math.floor((i / N) * (wbuf.length - 1))] * base * 2.2;
      const r = base * 1.12 + s;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  function loop() {
    if (!live) return;
    const el = (performance.now() - t0) / 1000;
    an.getFloatTimeDomainData(wbuf);
    drawOrb();
    $('bar').style.width = Math.min(100, (el / CFG.recSec) * 100) + '%';
    $('timer').textContent = Math.max(0, Math.ceil(CFG.recSec - el)) + ' s';
    $('prompt').textContent = PROMPTS[Math.min(PROMPTS.length - 1, Math.floor(el / 10))];
    $('hint').textContent = el < CFG.minSec ? 'Keep talking. A few more seconds gives a better reading.' : 'You can tap Done any time.';
    if (el >= CFG.recSec) return finish();
    raf = requestAnimationFrame(loop);
  }

  function release() {
    live = false; cancelAnimationFrame(raf);
    try { stream.getTracks().forEach(t => t.stop()); ctx.close(); } catch {}
  }
  function cancel(msg) { release(); msg ? fail(msg) : show('home'); }
  function done() {
    if ((performance.now() - t0) / 1000 < CFG.minSec) { $('hint').textContent = 'Keep talking a little longer, at least ' + CFG.minSec + ' seconds.'; return; }
    finish();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && live) cancel('Recording stopped because the app went to the background. Try again.'); });

  const concat = cs => { const x = new Float32Array(cs.reduce((n, c) => n + c.length, 0)); let o = 0; cs.forEach(c => { x.set(c, o); o += c.length; }); return x; };

  function finish() {
    const sr = ctx.sampleRate, x = concat(chunks);
    release();
    $('result').innerHTML = '<h2>Listening back</h2><p class="lead">Analysing on your phone. This takes a few seconds.</p>';
    show('result');
    setTimeout(() => {
      let res;
      try { res = DSP.analyzeAudio(x, sr); } catch { res = { ok: false, reason: 'error' }; }
      if (!res.ok) return retry(res.reason);
      const all = store.get(), m = res.m;
      const s = { t: Date.now(), tension: res.tension, low: res.low, m: { jitter: +m.jitter.toFixed(2), shimmer: +m.shimmer.toFixed(2), pitchSD: +m.pitchSD.toFixed(2), pause: +m.pauseRatio.toFixed(2), rate: +m.rate.toFixed(2) } };
      store.set(all.concat(s));
      render(s, all, m);
    }, 60);
  }

  function retry(reason) {
    const msg = reason === 'unvoiced' ? 'I did not catch enough clear speech. Speak normally for the full time and try again.'
      : reason === 'error' ? 'Something went wrong while analysing. Please try again.'
      : 'I could barely hear you. Move a little closer or find a quieter spot, then try again.';
    $('result').innerHTML = `<h2>Let's try that again</h2><p class="lead">${msg}</p><button class="primary" data-act="start">Try again</button>`;
  }

  // ---------- result ----------
  function mirror(t, l) {
    if (t < 35 && l < 35) return ['Steady and easy', 'Your voice sounded relaxed, with natural pitch movement and an even pace.', 'Whatever you did today is working. Keep it up.'];
    if (t >= 65 && l >= 65) return ['Tense and drained', 'Your voice sounded tight and flat at the same time, which is what a long, heavy day often sounds like.', 'Take five slow breaths, drink some water, and think about telling someone how your day went.'];
    if (t >= 65) return ['A bit tense', 'Your voice had more strain and speed than usual.', 'Try breathing in for 4 seconds and out for 6, five times.'];
    if (l >= 65) return ['Low on energy', 'Your voice was flatter and slower, with longer pauses.', 'A short walk, some food, or a chat with a friend can help. If this lasts for days, talk to someone you trust.'];
    return ['Somewhere in the middle', 'Mostly steady, with a few signs of tension or tiredness.', 'Check in again tomorrow. The trend says more than a single day.'];
  }
  const needHelp = all => all.length >= 3 && all.slice(-3).every(s => s.low >= 65);
  const helpCard = '<div class="help"><b>You have sounded low on energy for a few check-ins.</b><br>That happens to everyone at times, and talking helps. Reach out to a friend or family member, or call Tele-MANAS on 14416 (free, 24x7, India). If you are in immediate danger, call 112.</div>';

  function meter(label, v, color, key, prior) {
    let cmp = '';
    if (prior.length >= 3) {
      const d = v - Math.round(mean(prior.slice(-7).map(p => p[key])));
      cmp = `<small>${d === 0 ? 'Same as' : d > 0 ? d + ' higher than' : -d + ' lower than'} your usual</small>`;
    }
    return `<div class="meter"><div class="top"><strong>${label}</strong><span class="lv">${level(v)}</span></div><div class="bar"><b style="width:${v}%;background:${color}"></b></div>${cmp}</div>`;
  }

  function render(s, prior, m) {
    const [head, say, tip] = mirror(s.tension, s.low);
    const rows = [['Pitch (median)', Math.round(m.pitchMean) + ' Hz'], ['Pitch variation', m.pitchSD.toFixed(1) + ' semitones'], ['Jitter', m.jitter.toFixed(2) + ' %'],
      ['Shimmer', m.shimmer.toFixed(1) + ' %'], ['Pauses', m.pauses + ' (' + Math.round(m.pauseRatio * 100) + ' % of time)'], ['Speech rhythm', m.rate.toFixed(1) + ' beats/s'],
      ['Voiced time', m.voicedSec.toFixed(0) + ' s'], ['Cycles analysed', m.cycles]];
    $('result').innerHTML = `<h2 class="verdict">${head}</h2><p class="say">${say}</p>
      ${meter('Tension', s.tension, 'var(--tense)', 'tension', prior)}${meter('Low energy', s.low, 'var(--low)', 'low', prior)}
      <p class="tip">${tip}</p>
      ${needHelp(prior.concat(s)) ? helpCard : ''}
      <details><summary>See the numbers</summary><dl>${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl></details>
      <div class="row"><button class="ghost" data-act="trends">See trends</button><button class="primary" data-act="start">Check in again</button></div>`;
  }

  // ---------- trends ----------
  function chart(a) {
    const n = a.length, W = 320, H = 150, x = i => (n === 1 ? W / 2 : 20 + (i * (W - 40)) / (n - 1)), y = v => 12 + (100 - v) * 1.2;
    const line = (k, c) => `<polyline fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${a.map((s, i) => x(i) + ',' + y(s[k])).join(' ')}"/>` +
      a.map((s, i) => `<circle cx="${x(i)}" cy="${y(s[k])}" r="4" fill="${c}"/>`).join('');
    const grid = [0, 50, 100].map(v => `<line x1="10" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#cfd6e6" stroke-dasharray="3 4"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tension and low energy across your recent check-ins">${grid}${line('tension', '#7a5cd1')}${line('low', '#2f97a8')}</svg>
      <div class="key"><span><i style="background:#7a5cd1"></i>Tension</span><span><i style="background:#2f97a8"></i>Low energy</span></div>`;
  }

  function renderTrends() {
    const all = store.get(), last = all.slice(-14);
    $('empty').hidden = all.length > 0;
    $('chart').innerHTML = all.length ? chart(last) : '';
    $('list').innerHTML = all.slice(-7).reverse().map(s => `<li><span>${when(s.t)}${s.demo ? ' (demo)' : ''}</span><span>Tension ${s.tension}, Low energy ${s.low}</span></li>`).join('');
    $('helpT').innerHTML = needHelp(all) ? helpCard : '';
  }

  function demo() {
    const T = [30, 34, 33, 46, 55, 61, 68], L = [27, 31, 42, 47, 66, 69, 73], day = 864e5, now = Date.now();
    const d = T.map((t, i) => ({ t: now - (6 - i) * day, tension: t, low: L[i], demo: true }));
    store.set(store.get().filter(s => !s.demo).concat(d).sort((a, b) => a.t - b.t));
    renderTrends();
  }
  function clear() { if (confirm('Delete all check-ins stored on this phone?')) { store.set([]); renderTrends(); } }

  // ---------- wiring ----------
  const acts = { start, stop: done, cancel: () => cancel(), home: () => show('home'), trends: () => show('trends'), demo, clear };
  document.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a && acts[a.dataset.act]) acts[a.dataset.act](); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
