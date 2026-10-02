// Mirror GeoGebra css/ subtree (referenced relative to the version dir, one
// level above web3d/). Entry points discovered via runtime network capture.
// Usage: node scripts/download-ggb-css.mjs <baseUrl> <publicRootDir>
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const base = (process.argv[2] || 'https://www.geogebra.org/apps/5.4.920.0/').replace(/\/?$/, '/');
const rootDir = process.argv[3] || 'client/public/ggb';

const entries = [
  'css/bundles/simple-bundle.css',
  'css/bundles/bundle.css',
  'css/keyboard-styles.css',
  'css/fonts.css',
  'css/greek-font.css',
];

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractCssRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const r = m[1];
    if (r.startsWith('data:') || r.startsWith('http') || r.startsWith('//')) continue;
    refs.add(r);
  }
  for (const m of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const r = m[1];
    if (!r.startsWith('http') && !r.startsWith('//')) refs.add(r);
  }
  return [...refs];
}

function resolveRef(fromFile, ref) {
  // resolve relative to the css file's own directory, normalize ..
  const parts = (dirname(fromFile) + '/' + ref).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

const queue = [...entries];
const seen = new Set();
let ok = 0, fail = 0;
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const out = join(rootDir, rel);
  if (!existsSync(out)) {
    try {
      const buf = await fetchBuf(base + rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buf);
      ok++;
      console.log(`ok   ${rel} (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      fail++;
      console.error(`FAIL ${rel} ${e.message}`);
      continue;
    }
  }
  const ext = rel.split('.').pop().toLowerCase();
  if (ext === 'css') {
    const text = readFileSync(out, 'utf8');
    for (const r of extractCssRefs(text)) queue.push(resolveRef(rel, r));
  }
}
console.log(`done: ${ok} ok, ${fail} failed, ${seen.size} total`);
