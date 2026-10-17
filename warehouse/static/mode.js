// Platform mode shared by every page.
//   compare (light): earlier-vs-current comparison, similarity, change reports.
//   detect  (dark):  no comparison; each window is tagged with hazard / fatigue cues
//                    read from the Cosmos description of that window.
(() => {
  const KEY = 'ws-mode';
  let mode = 'detect';
  try { mode = localStorage.getItem(KEY) || 'detect'; } catch {}
  if (mode !== 'compare' && mode !== 'detect') mode = 'detect';
  document.documentElement.dataset.mode = mode;

  const FATIGUE = [
    [/head (is )?(lowered|down|bowed|hanging)|lowers? (his|her|their) head|head (rests?|resting) on|head on (his|her|their)? ?(arms|knees|hands)/i, 'head lowered'],
    [/rubs? (his|her|their)? ?(face|eyes|forehead|temples)|rubbing (his|her|their)? ?(face|eyes|forehead)/i, 'rubbing face'],
    [/forearm (to|against|on) (the |his |her |their )?forehead|wip(es|ing) (sweat|(his|her|their) (brow|forehead))|hand (to|on) (the |his |her |their )?forehead/i, 'hand to forehead'],
    [/slump|hunched|exhaust|tired|fatigue|weary/i, 'slumped / tired posture'],
    [/hugging (their |his |her )?knees|knees (bent|drawn up)/i, 'knees drawn up'],
    [/taking a break|resting|rest break|sits? (down )?(on|against)|seated|leaning (back )?against/i, 'resting / seated'],
    [/drink(s|ing)? (from |some )?(water|a (water )?bottle)|water bottle/i, 'hydrating'],
  ];
  const HAZARD = [
    [/forklift|agv|automated guided vehicle/i, 'vehicle near person'],
    [/\b(runs?|running)\b/i, 'running on site'],
    [/(removes?|removing|takes? off|taking off|took off|lifts?|lifting) (his|her|their|the)? ?(hard ?hat|helmet)|without (a )?(hard ?hat|helmet)|helmet (is )?(removed|off)/i, 'helmet removed'],
    [/no (safety )?(vest|harness|ppe)|without (a )?(vest|harness|ppe)/i, 'PPE missing'],
    [/(open(ed)?|uncovered) (electrical )?panel|panel cover (is )?(open|removed)/i, 'panel open'],
    [/overload|unstable load|load (is )?(too|very) (high|large)/i, 'overloaded load'],
    [/(roof edge|unprotected edge|near the edge|on a ladder|without (a )?harness|fall)/i, 'fall risk at height'],
    [/unsafe|hazard|danger/i, 'unsafe behaviour'],
  ];

  const textOf = a => {
    if (!a) return '';
    const r = a.report || {};
    return [r.task_context, r.human_review_summary, ...(r.observable_changes || []), a.summary].filter(Boolean).join(' ');
  };
  function cues(text, filename) {
    const t = String(text || '');
    const out = { fatigue: [], hazard: [] };
    FATIGUE.forEach(([re, l]) => { if (re.test(t) && !out.fatigue.includes(l)) out.fatigue.push(l); });
    HAZARD.forEach(([re, l]) => { if (re.test(t) && !out.hazard.includes(l)) out.hazard.push(l); });
    if (/(?:^|[_\/])\d-unsafe-/i.test(filename || '') && !out.hazard.includes('labelled unsafe')) out.hazard.unshift('labelled unsafe');
    // "resting / seated" and "hydrating" alone are context, not a fatigue flag.
    out.flagFatigue = out.fatigue.some(l => l !== 'resting / seated' && l !== 'hydrating');
    return out;
  }
  // kind: bad = hazard, warn = fatigue cue, ok = nothing notable, base = window not described yet
  function kind(a, filename) {
    const t = textOf(a);
    const c = cues(t, filename);
    if (c.hazard.length) return 'bad';
    if (c.flagFatigue) return 'warn';
    return t ? 'ok' : 'base';
  }
  function title(a, filename) {
    const c = cues(textOf(a), filename);
    if (c.hazard.length) return 'Hazard: ' + c.hazard.slice(0, 2).join(', ');
    if (c.flagFatigue) return 'Fatigue cue: ' + c.fatigue.filter(l => l !== 'resting / seated' && l !== 'hydrating').slice(0, 2).join(', ');
    return textOf(a) ? 'No hazard or fatigue cues' : 'Window checked';
  }
  function label(a, filename) {
    const c = cues(textOf(a), filename);
    const all = [...c.hazard, ...c.fatigue];
    return all.length ? all.slice(0, 3).join(' · ') : 'clear';
  }
  function set(m) {
    try { localStorage.setItem(KEY, m); } catch {}
    location.reload();
  }
  window.WSMode = { mode, cues, kind, title, label, textOf, set };

  function mountToggle() {
    const brand = document.querySelector('.brand');
    if (!brand || document.querySelector('.ws-mode')) return;
    const g = document.createElement('div');
    g.className = 'ws-mode';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Platform mode');
    g.innerHTML = '<button type="button" data-m="compare" title="Compare each window with an earlier one (light)">☀ Compare</button>' +
      '<button type="button" data-m="detect" title="No comparison: hazard and fatigue cues only (dark)">☾ Detect</button>';
    g.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.m === mode));
      b.addEventListener('click', () => { if (b.dataset.m !== mode) set(b.dataset.m); });
    });
    brand.after(g);
    const left = brand.parentElement;
    if (left && getComputedStyle(left).display !== 'flex') left.classList.add('ws-left');
  }

  // Review page in detect mode: show cue chips for the selected window instead of the comparison.
  function mountCueBar() {
    if (mode !== 'detect') return;
    const anchor = document.querySelector('.result-bar');
    const report = document.getElementById('report');
    if (!anchor || !report) return;
    const bar = document.createElement('div');
    bar.className = 'ws-cues';
    anchor.before(bar);
    let last = null;
    const render = () => {
      const t = report.textContent + ' ' + (document.getElementById('report-details')?.textContent || '');
      if (t === last) return;
      last = t;
      const c = cues(t, document.getElementById('current-label')?.textContent || '');
      const chips = [...c.hazard.map(l => `<span class="ws-chip bad">⚠ ${l}</span>`),
        ...c.fatigue.map(l => `<span class="ws-chip ${l === 'resting / seated' || l === 'hydrating' ? 'ctx' : 'warn'}">◐ ${l}</span>`)];
      bar.innerHTML = '<span class="ws-cue-label">DETECTED CUES</span>' + (chips.length ? chips.join('') : '<span class="ws-chip ok">✓ no hazard or fatigue cues</span>');
    };
    render();
    setInterval(render, 1000);
  }
  const ready = () => { mountToggle(); mountCueBar(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
