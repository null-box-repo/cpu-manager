// CPU Tuner backend
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const BIN = process.env.CPUSET_BIN || './cputuner';
const SUDO = process.env.CPUSET_SUDO === '1';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

const FILES = ['/index.html', '/css/styles.css', '/js/app.js'];

const SET = {
  governor: ['--set', 'governor'],
  min_freq: ['--set', 'min_freq'],
  max_freq: ['--set', 'max_freq']
};

const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const NUM_RE = /^\d+$/;

function run(args) {
  return new Promise((resolve) => {
    const cmd = SUDO ? 'sudo' : BIN;
    const cargs = SUDO ? [BIN].concat(args) : args;
    execFile(cmd, cargs, { timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function getStatus() {
  const r = await run(['--list', 'clusters']);
  const clusters = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    let m = line.match(/^cluster(\d+): cores(.*)$/);
    if (m) {
      cur = {
        id: +m[1],
        cores: m[2].trim().split(/\s+/).map(x => +x.replace('cpu', '')).filter(n => !isNaN(n)),
        governors: [], governor: '', freqs: [], rmin: null, rmax: null, min: null, max: null, cur: null
      };
      clusters.push(cur);
      continue;
    }
    if (!cur) continue;
    m = line.match(/^\s*available governors: (.+)$/);
    if (m) { cur.governors = m[1].trim().split(/\s+/).filter(Boolean); continue; }
    m = line.match(/^\s*governor: (.+)$/);
    if (m) { cur.governor = m[1].trim(); continue; }
    m = line.match(/^\s*available frequencies \(kHz\): (.+)$/);
    if (m) { cur.freqs = m[1].trim().split(/\s+/).map(Number); continue; }
    m = line.match(/^\s*range (min|max): (\d+) kHz$/);
    if (m) { if (m[1] === 'min') cur.rmin = +m[2]; else cur.rmax = +m[2]; continue; }
    m = line.match(/^\s*(min|max|cur): (\d+) kHz$/);
    if (m) { if (m[1] === 'min') cur.min = +m[2]; else if (m[1] === 'max') cur.max = +m[2]; else cur.cur = +m[2]; }
  }
  const errors = r.err ? [(r.stderr || r.err.message).trim()] : [];
  return {
    ok: errors.length === 0,
    clusters,
    errors
  };
}

async function doSet(body) {
  const action = SET[body.key];
  if (!action) return { ok: false, error: 'Unknown key' };
  const value = String(body.value == null ? '' : body.value);
  if (!NAME_RE.test(value)) return { ok: false, error: 'Bad value' };
  const args = action.concat([value]);
  if (body.cluster != null) {
    if (!NUM_RE.test(String(body.cluster))) return { ok: false, error: 'Bad cluster' };
    args.push('--cluster', String(body.cluster));
  }
  const { err, stdout, stderr } = await run(args);
  if (err) return { ok: false, error: stderr.trim() || err.message };
  return { ok: true, output: stdout.trim() };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function end(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/status' && req.method === 'GET') return json(res, await getStatus());
    if (url.pathname === '/api/set' && req.method === 'POST') return json(res, await doSet(await readBody(req)));
    if (url.pathname.startsWith('/api/')) return json(res, { ok: false, error: 'Not found' }, 404);
    if (req.method !== 'GET') return end(res, 405, 'Method not allowed');
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!FILES.includes(file)) return end(res, 404, 'Not found');
    fs.readFile(path.join(ROOT, file), (err, data) => {
      if (err) return end(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    json(res, { ok: false, error: e.message }, 500);
  }
});

server.listen(PORT, () => console.log('CPU Tuner on http://localhost:' + PORT));