#!/usr/bin/env node
/* Pre-deploy checks. Standard library only.
   Catches the classes of bug that have actually bitten this site:
   dead links, missing assets referenced by CSS, heading-level skips,
   third-party requests sneaking back in, and inline styles that would
   break the content security policy. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
let failures = 0;
let checks = 0;

function fail(msg) { failures++; console.log('  FAIL  ' + msg); }
function pass(msg) { console.log('  ok    ' + msg); }
function section(name) { console.log('\n' + name); }

/* Root pages plus posts under blog/. Paths stay relative to ROOT, and
   links are resolved from each page's own folder. */
const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
  .concat(fs.existsSync(path.join(ROOT, 'blog'))
    ? fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html')).map(f => 'blog/' + f)
    : []);

/* ── links and referenced assets ─────────────────────────── */
section('Links and assets');
let broken = 0;
for (const page of html) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const refs = new Set([...src.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]));
  for (const ref of refs) {
    if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
    const target = ref.split('#')[0];
    if (target && !fs.existsSync(path.join(ROOT, path.dirname(page), target))) {
      fail(`${page} references missing ${ref}`);
      broken++;
    }
  }
  for (const anchor of new Set([...src.matchAll(/href="#([^"]+)"/g)].map(m => m[1]))) {
    if (!src.includes(`id="${anchor}"`)) { fail(`${page} has dead anchor #${anchor}`); broken++; }
  }
}
checks++;
if (!broken) pass(`${html.length} pages, no broken links or anchors`);

/* assets referenced from CSS */
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8') +
            (fs.existsSync(path.join(ROOT, 'fonts.css')) ? fs.readFileSync(path.join(ROOT, 'fonts.css'), 'utf8') : '');
let cssMissing = 0;
for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
  if (/^(https?:|data:)/.test(m[1])) continue;
  if (!fs.existsSync(path.join(ROOT, m[1]))) { fail(`css references missing ${m[1]}`); cssMissing++; }
}
checks++;
if (!cssMissing) pass('every asset referenced by css exists');

/* ── heading order ───────────────────────────────────────── */
section('Heading hierarchy');
let skips = 0;
for (const page of html) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const levels = [...src.matchAll(/<h([1-6])[ >]/g)].map(m => +m[1]);
  const h1 = levels.filter(l => l === 1).length;
  if (h1 !== 1) { fail(`${page} has ${h1} h1 elements, expected 1`); skips++; }
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i + 1] - levels[i] > 1) {
      fail(`${page} skips h${levels[i]} to h${levels[i + 1]}`);
      skips++; break;
    }
  }
}
checks++;
if (!skips) pass('one h1 per page, no skipped levels');

/* ── privacy and CSP invariants ──────────────────────────── */
section('Privacy and CSP');
let thirdParty = 0, inlineStyles = 0, noCsp = 0;
for (const page of html) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  if (/fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics/.test(src)) {
    fail(`${page} loads a third-party resource`); thirdParty++;
  }
  const inline = (src.match(/ style="/g) || []).length;
  if (inline) { fail(`${page} has ${inline} inline style attributes, CSP forbids them`); inlineStyles += inline; }
  if (!src.includes('Content-Security-Policy')) { fail(`${page} has no CSP`); noCsp++; }
}
checks += 3;
if (!thirdParty) pass('no third-party requests');
if (!inlineStyles) pass('no inline style attributes');
if (!noCsp) pass(`all ${html.length} pages carry a CSP`);

/* ── scripts parse ───────────────────────────────────────── */
section('Scripts');
let bad = 0;
for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'dev-server.js')) {
  try { new Function(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  catch (e) { fail(`${f} does not parse: ${e.message}`); bad++; }
}
checks++;
if (!bad) pass('all scripts parse');

/* ── summary ─────────────────────────────────────────────── */
console.log('\n' + (failures
  ? `${failures} problem(s) found across ${checks} checks\n`
  : `all ${checks} checks passed\n`));
process.exit(failures ? 1 : 0);
