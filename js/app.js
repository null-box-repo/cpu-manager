// CPU Tuner UI logic
const $ = (s, r) => (r || document).querySelector(s);

const CPUDIV = 1000;

const fmtFreq = (v, div) => {
  if (v == null) return '-';
  const mhz = v / div;
  if (mhz >= 1000) return (mhz / 1000).toFixed(2).replace(/\.?0+$/, '') + ' GHz';
  return Math.round(mhz) + ' MHz';
};
const pin = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  const cores = (c.cores || []).map(n => 'Core ' + n).join(', ') || '?';
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
      $('#banner').hidden = false;
      $('#banner').textContent = s.errors.join('\n');
      return null;
    }
    $('#banner').hidden = true;
    return s;
  } catch (e) {
    $('#banner').hidden = false;
    $('#banner').textContent = 'Cannot reach server: ' + e.message;
    return null;
  }
}

function renderCpu(clusters) {
  $('#cores').innerHTML = clusters.map(c => cardHTML(c)).join('');
}

function render(s) {
  renderCpu(s.clusters || []);
}

function liveUpdate(s) {
  (s.clusters || []).forEach(c => {
    const card = $('#cores .card[data-id="' + c.id + '"]');
    if (!card) return;
    const cur = $('[data-cur]', card);
    if (cur) cur.textContent = fmtFreq(c.cur, CPUDIV);
    const meter = $('[data-meter]', card);
    if (meter) meter.style.width = meterW(c.min, c.max, c.cur) + '%';
  });
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

poll();
setInterval(poll, 1000);
