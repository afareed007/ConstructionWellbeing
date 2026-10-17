// Live layer: watches /api/state and makes pipeline progress and Cosmos findings visible as they happen.
(() => {
  const STEPS = ['Preparing video', 'YOLO person detection', 'ByteTrack association', 'Person-focused crops',
    'Cosmos Embed1 indexing', 'Historical retrieval', 'Cosmos evidence comparison'];
  const SHORT = ['Prepare', 'YOLO detect', 'ByteTrack', 'Crops', 'Cosmos Embed', 'Retrieve', 'Cosmos compare'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const seenEvents = new Set(), seenAnalyses = new Set();
  let primed = false, last = {};

  const main = document.querySelector('main');
  const bar = document.createElement('section');
  bar.id = 'lv-bar';
  bar.innerHTML = `<span class="lv-badge">IDLE</span><span class="lv-stage">Waiting for footage. Press ▶ Demo or ↑ Upload.</span><span class="lv-pct"></span>
    <div class="lv-steps">${SHORT.map((s, i) => `<span class="lv-step" data-i="${i}">${s}</span>`).join('')}</div>
    <div class="lv-track"><div class="lv-fill"></div></div>`;
  const stats = document.createElement('section');
  stats.id = 'lv-stats';
  stats.innerHTML = [['people', 'people tracked'], ['windows', 'windows analysed'], [(window.WSMode && WSMode.mode === 'detect') ? 'compared' : 'compared', (window.WSMode && WSMode.mode === 'detect') ? 'windows described' : 'Cosmos comparisons'], ['flags', (window.WSMode && WSMode.mode === 'detect') ? 'hazards + fatigue cues' : 'need a check-in']]
    .map(([k, l]) => `<div><b data-k="${k}">0</b><span>${l}</span></div>`).join('');
  const header = document.querySelector('.topbar');
  header.after(bar);
  bar.after(stats);
  const toasts = document.createElement('div');
  toasts.id = 'lv-toasts';
  toasts.setAttribute('aria-live', 'polite');
  document.body.appendChild(toasts);

  const wrap = document.getElementById('current-video')?.closest('.video-wrap');
  if (wrap) {
    const hud = document.createElement('div');
    hud.className = 'lv-hud';
    hud.innerHTML = '<span class="live">● LIVE</span><span id="lv-cam">cam-1</span><span id="lv-clock">0:00</span>';
    wrap.appendChild(hud);
    const v = document.getElementById('current-video');
    v.addEventListener('timeupdate', () => {
      const t = Math.floor(v.currentTime || 0);
      document.getElementById('lv-clock').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    });
  }

  function toast(kind, title, sub, ms = 5000) {
    const t = document.createElement('div');
    t.className = 'lv-toast ' + kind;
    t.innerHTML = `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    toasts.prepend(t);
    while (toasts.children.length > 5) toasts.lastChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  function setStat(k, v) {
    const el = stats.querySelector(`[data-k="${k}"]`);
    if (String(v) !== el.textContent) {
      el.textContent = v;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }

  const priorityKind = p => /high|urgent|priority|check/i.test(p || '') ? 'bad' : /elevated|medium|attention|review/i.test(p || '') ? 'warn' : 'ok';
  const DET = !!(window.WSMode && WSMode.mode === 'detect');
  const flagged = a => DET ? ['bad', 'warn'].includes(WSMode.kind(a)) : (a.report && priorityKind(a.report.review_priority) !== 'ok');

  async function poll() {
    let s;
    try { s = await fetch('/api/state').then(r => r.json()); } catch { return; }
    const jobs = s.jobs || [], running = jobs.find(j => j.status === 'queued' || j.status === 'running' || (j.status !== 'completed' && j.status !== 'failed'));
    const job = running || jobs[jobs.length - 1];
    const live = !!running;
    bar.classList.toggle('on', live);
    bar.querySelector('.lv-badge').textContent = live ? '● LIVE' : (job ? 'DONE' : 'IDLE');
    if (job) {
      bar.querySelector('.lv-stage').textContent = `${job.label || 'Recording'} · ${job.stage || job.status}`;
      bar.querySelector('.lv-pct').textContent = (job.progress ?? 0) + '%';
      bar.querySelector('.lv-fill').style.width = (job.progress ?? 0) + '%';
      const reached = new Set((job.events || []).map(e => STEPS.indexOf(e.stage)).filter(i => i >= 0));
      const now = STEPS.indexOf(job.stage);
      bar.querySelectorAll('.lv-step').forEach(el => {
        const i = +el.dataset.i;
        el.classList.toggle('done', reached.has(i) && (i !== now || !live));
        el.classList.toggle('now', live && i === now);
      });
      (job.events || []).forEach((e, i) => {
        const key = job.id + ':' + i;
        if (seenEvents.has(key)) return;
        seenEvents.add(key);
        if (primed) toast('step', '⚙ ' + e.stage, e.detail, 3500);
      });
      if (primed && last[job.id] && last[job.id] !== job.status) {
        if (job.status === 'completed') toast('ok', '✓ Ready for review', `${job.label} processed`, 6000);
        if (job.status === 'failed') toast('bad', '✕ Job failed', job.error || 'See server log', 8000);
      }
      last[job.id] = job.status;
    }
    const analyses = s.analyses || [];
    analyses.forEach(a => {
      if (seenAnalyses.has(a.id)) return;
      seenAnalyses.add(a.id);
      if (!primed) return;
      if (a.report) {
        const p = a.report.review_priority || 'routine';
        const kind = DET ? WSMode.kind(a) : priorityKind(p);
        if (DET) toast(kind, (kind === 'ok' ? '◉ ' : '⚠ ') + WSMode.title(a), WSMode.label(a), 7000);
        else toast(kind, (kind === 'ok' ? '◉ ' : '⚠ ') + 'Cosmos: ' + (a.report.task_context || 'Comparison complete'),
          `priority: ${p} · similarity ${a.similarity ? a.similarity.toFixed(2) : '–'}`, 7000);
      } else if (a.status === 'no_reference' && !DET) {
        toast('step', '◎ Baseline captured', 'First window for this person. No change claim yet.', 4000);
      }
    });
    setStat('people', (s.tracks || []).length);
    setStat('windows', (s.clips || []).length);
    setStat('compared', analyses.filter(a => a.status === 'complete').length);
    setStat('flags', analyses.filter(flagged).length);
    primed = true;
  }
  poll();
  setInterval(poll, 1200);
})();
