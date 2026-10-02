#!/usr/bin/env node
// Download GeoGebra web3d deployment package for local self-hosting.
// Usage: node scripts/download-ggb.mjs [baseUrl] [targetDir]
//   baseUrl   e.g. https://www.geogebra.org/apps/5.4.920.0/  (must end with /)
//   targetDir e.g. client/public/ggb/web3d
// Mirrors: web3d.nocache.js, all *.cache.* permutation files it references,
// clear.cache.gif, web3d.css (if present), geogebra-web3d.css (if present).
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const base = (process.argv[2] || 'https://www.geogebra.org/apps/5.4.920.0/').replace(/\/?$/, '/');
const dir = process.argv[3] || 'client/public/ggb/web3d';

mkdirSync(dir, { recursive: true });

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function tryFetch(url) {
  try { return await fetchBuf(url); } catch { return null; }
}

function extractRefs(text) {
  const refs = new Set();
  // GWT permutation payloads: <32-hex-hash>.cache.js / .cache.css / .cache.html / .cache.gif / .cache.png / .cache.woff2 ...
  for (const m of text.matchAll(/[A-F0-9]{32}\.cache\.[a-z0-9]+/g)) refs.add(m[0]);
  // collapsed loaders keep the bare hash in a variable and append ".cache.js" at runtime
  for (const m of text.matchAll(/'([A-F0-9]{32})'/g)) refs.add(m[1] + '.cache.js');
  // literal asset names
  for (const m of text.matchAll(/[A-Za-z0-9_.\/-]+\.(?:gif|png|svg|jpg|css|woff2?|wasm)(?=["')\\ ,;:])/g)) {
    const r = m[0];
    if (r.startsWith('www.geogebra.org') || r.includes('geogebra.org')) continue; // absolute remote, cannot mirror into web3d/
    refs.add(r);
  }
  return [...refs];
}

async function download(name) {
  const out = join(dir, name);
  if (existsSync(out) && readFileSync(out).length > 0) {
    console.log(`skip ${name} (exists)`);
    return 'ok';
  }
  const buf = await tryFetch(base + 'web3d/' + name);
  if (!buf) { console.error(`FAIL ${name}`); return 'fail'; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`ok   ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
  return 'ok';
}

console.log(`mirror ${base}web3d/ -> ${dir}`);
const refs = new Set();

if (!existsSync(join(dir, 'web3d.nocache.js'))) {
  const loader = await fetchBuf(base + 'web3d/web3d.nocache.js');
  writeFileSync(join(dir, 'web3d.nocache.js'), loader);
  console.log(`ok   web3d.nocache.js (${(loader.length / 1024).toFixed(0)} KB)`);
}

function scanLocal(file) {
  const p = join(dir, file);
  if (!existsSync(p)) return;
  for (const r of extractRefs(readFileSync(p, 'utf8'))) {
    if (!r.startsWith('/') && !r.startsWith('//') && r !== 'web3d.nocache.js') refs.add(r);
  }
}

refs.add('clear.cache.gif');

const list = [...refs];
let ok = 0, fail = 0;
const CONCURRENCY = 6;
for (let pass = 0; pass < 3; pass++) {
  // rescan every local payload each pass so refs discovered in previously
  // downloaded cache.js files are picked up even on incremental runs
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.js')) scanLocal(f);
  }
  const pending = [...refs].filter(r => !existsSync(join(dir, r)));
  if (pending.length === 0) break;
  console.log(`-- pass ${pass + 1}: ${pending.length} files to fetch`);
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(download));
    ok += results.filter(r => r === 'ok').length;
    fail += results.filter(r => r === 'fail').length;
  }
}

// GWT split-code fragments and locale property files (found via runtime capture)
const hash = [...refs].find(r => r.endsWith('.cache.js'))?.replace('.cache.js', '');
if (hash) {
  for (let n = 1; n <= 20; n++) refs.add(`deferredjs/${hash}/${n}.cache.js`);
}
for (const loc of ['zh-CN', 'zh-TW', 'en']) refs.add(`js/properties_keys_${loc}.js`);

const extraPending = [...refs].filter(r => !existsSync(join(dir, r)));
console.log(`-- extras: ${extraPending.length} files to fetch`);
for (let i = 0; i < extraPending.length; i += CONCURRENCY) {
  const batch = extraPending.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async (name) => {
    const sub = join(dir, name);
    if (!existsSync(sub)) mkdirSync(dirname(sub), { recursive: true });
    return download(name);
  }));
  ok += results.filter(r => r === 'ok').length;
  fail += results.filter(r => r === 'fail').length;
}
console.log(`done: ${ok} files ok, ${fail} failed, ${refs.size} refs discovered`);
process.exit(fail > 0 && ok === 0 ? 1 : 0);
