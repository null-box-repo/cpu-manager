// CPU Tuner UI logic
const $ = (s, r) => (r || document).querySelector(s);

const CPUDIV = 1000;
const GPUDIV = 1e6;

const fmtFreq = (v, div) => {
  if (v == null) return '-';
  const mhz = v / div;
  if (mhz >= 1000) return (mhz / 1000).toFixed(2).replace(/\.?0+$/, '') + ' GHz';
  return Math.round(mhz) + ' MHz';
};
const pin = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function setPage(name) {
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.page === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $('#page-cpu').hidden = name !== 'cpu';
  $('#page-gpu').hidden = name !== 'gpu';
}
document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => setPage(t.dataset.page)));

function govOpts(list, cur) {
  const all = list.length ? [...new Set(list)] : [cur].filter(Boolean);
  return all.map(g => `<option${g === cur ? ' selected' : ''}>${g}</option>`).join('');
}

function freqOpts(list, cur, div) {
  let all = list.slice().map(Number).filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (cur != null && !all.some(v => v === +cur)) {
    all.push(+cur);
    all.sort((a, b) => a - b);
  }
  return all.map(v => `<option value="${v}"${+v === +cur ? ' selected' : ''}>${fmtFreq(v, div)}</option>`).join('');
}

function meterW(min, max, cur) {
  if (min == null || max == null || cur == null || max <= min) return 0;
  return pin(((cur - min) / (max - min)) * 100, 0, 100);
}

function cardHTML(c) {
  const opts = c.freqs.length ? c.freqs : [c.rmin, c.rmax].filter(v => v != null);
  const cores = (c.cores || []).map(n => 'CPU ' + n).join(', ') || '?';
  return `<article class="card" data-id="${c.id}">
    <header>
      <div>
        <span class="num">Cluster ${c.id}</span>
        <span class="sub">${cores}</span>
      </div>
      <span class="freq" data-cur>${fmtFreq(c.cur, CPUDIV)}</span>
    </header>
    <div class="meter"><i data-meter style="width:${meterW(c.min, c.max, c.cur)}%"></i></div>
    <div class="row">
      <label>Governor</label>
      <div class="sel"><select data-k="governor">${govOpts(c.governors, c.governor)}</select></div>
    </div>
    <div class="row split">
      <div>
        <label>Min</label>
        <div class="sel"><select data-k="min">${freqOpts(opts, c.min, CPUDIV)}</select></div>
      </div>
      <div>
        <label>Max</label>
        <div class="sel"><select data-k="max">${freqOpts(opts, c.max, CPUDIV)}</select></div>
      </div>
    </div>
  </article>`;
}

function gpuCardHTML(g) {
  const opts = g.freqs.length ? g.freqs : [g.min, g.max].filter(v => v != null);
  return `<article class="card">
    <header>
      <div>
        <span class="num">GPU core</span>
        <span class="sub">governor &amp; frequency control</span>
      </div>
      <span class="freq" data-gcur>${fmtFreq(g.cur, GPUDIV)}</span>
    </header>
    <div class="meter"><i data-gmeter style="width:${meterW(g.min, g.max, g.cur)}%"></i></div>
    <div class="row">
      <label>Governor</label>
      <div class="sel"><select data-gk="governor">${govOpts(g.governors, g.governor)}</select></div>
    </div>
    <div class="row split">
      <div>
        <label>Min</label>
        <div class="sel"><select data-gk="min">${freqOpts(opts, g.min, GPUDIV)}</select></div>
      </div>
      <div>
        <label>Max</label>
        <div class="sel"><select data-gk="max">${freqOpts(opts, g.max, GPUDIV)}</select></div>
      </div>
    </div>
  </article>`;
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.classList.remove('show'); }, 2600);
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  } : undefined);
  return res.json();
}

const KEYS = { governor: 'governor', min: 'min_freq', max: 'max_freq' };
const GKEYS = { governor: 'gpu_governor', min: 'gpu_min_freq', max: 'gpu_max_freq' };

async function apply(key, value, cluster) {
  const d = await api('/api/set', { key, value, cluster });
  if (!d.ok) { toast('Set failed: ' + d.error, true); return false; }
  return true;
}

let rendered = false;

async function loadStatus() {
  try {
    const s = await api('/api/status');
    if (!s.ok) {
      $('#conn').className = 'conn off';
      $('#banner').hidden = false;
      $('#banner').textContent = s.errors.join('\n');
      return null;
    }
    $('#conn').className = 'conn on';
    $('#banner').hidden = true;
    return s;
  } catch (e) {
    $('#conn').className = 'conn off';
    $('#banner').hidden = false;
    $('#banner').textContent = 'Cannot reach server: ' + e.message;
    return null;
  }
}

function renderCpu(clusters) {
  $('#stat-cores').textContent = clusters.length || '-';
  $('#stat-gov').textContent = clusters.length ? (clusters[0].governor || '-') : '-';
  $('#stat-cpu').textContent = clusters.length ? fmtFreq(clusters[0].cur, CPUDIV) : '-';
  $('#cores').innerHTML = clusters.map(c => cardHTML(c)).join('');
}

function renderGpu(g) {
  const box = $('#gpu');
  if (!g || !g.present) {
    box.innerHTML = '';
    $('#gpu-empty').hidden = false;
    $('#gstat-gov').textContent = '-';
    $('#gstat-clock').textContent = '-';
    $('#gstat-levels').textContent = '-';
    return;
  }
  $('#gpu-empty').hidden = true;
  $('#gstat-gov').textContent = g.governor || '-';
  $('#gstat-clock').textContent = fmtFreq(g.cur, GPUDIV);
  $('#gstat-levels').textContent = g.freqs.length || '-';
  box.innerHTML = gpuCardHTML(g);
}

function render(s) {
  renderCpu(s.clusters || []);
  renderGpu(s.gpu);
}

function liveUpdate(s) {
  const clusters = s.clusters || [];
  $('#stat-cpu').textContent = clusters.length ? fmtFreq(clusters[0].cur, CPUDIV) : '-';
  clusters.forEach(c => {
    const card = $('#cores .card[data-id="' + c.id + '"]');
    if (!card) return;
    const cur = $('[data-cur]', card);
    if (cur) cur.textContent = fmtFreq(c.cur, CPUDIV);
    const meter = $('[data-meter]', card);
    if (meter) meter.style.width = meterW(c.min, c.max, c.cur) + '%';
  });
  const g = s.gpu;
  if (g && g.present) {
    $('#gstat-clock').textContent = fmtFreq(g.cur, GPUDIV);
    const card = $('#gpu .card');
    if (card) {
      const cur = $('[data-gcur]', card);
      if (cur) cur.textContent = fmtFreq(g.cur, GPUDIV);
      const meter = $('[data-gmeter]', card);
      if (meter) meter.style.width = meterW(g.min, g.max, g.cur) + '%';
    }
  }
}

async function poll() {
  const s = await loadStatus();
  if (!s) return;
  if (rendered) liveUpdate(s);
  else { render(s); rendered = true; }
}

function fizzle(sel) {
  const card = sel.closest('.card');
  if (card) {
    card.classList.remove('bump');
    void card.offsetWidth;
    card.classList.add('bump');
  }
}

$('#cores').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-k]');
  if (!sel) return;
  const key = KEYS[sel.dataset.k];
  if (!key) return;
  const id = +sel.closest('.card').dataset.id;
  fizzle(sel);
  if (await apply(key, sel.value, id)) {
    const s = await loadStatus();
    if (s) render(s);
  }
});

$('#gpu').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-gk]');
  if (!sel) return;
  const key = GKEYS[sel.dataset.k];
  if (!key) return;
  fizzle(sel);
  if (await apply(key, sel.value)) {
    const s = await loadStatus();
    if (s) render(s);
  }
});

poll();
setInterval(poll, 1000);