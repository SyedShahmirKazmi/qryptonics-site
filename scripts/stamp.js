#!/usr/bin/env node
/* Cache-busting. GitHub Pages serves every file with max-age=600, so after a
   deploy a browser can keep the old styles.css or site.js for ten minutes
   while showing the new HTML. Each local CSS/JS reference carries ?v=<hash of
   the file's contents>: the URL changes exactly when the file does.

   node scripts/stamp.js          rewrite every page's references
   node scripts/stamp.js --check  exit 1 if any reference is missing or stale
   check.js runs the --check logic, so a stale stamp fails CI. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REF = /((?:href|src)=")((?:\.\.\/)?[\w-]+\.(?:css|js))(?:\?v=[0-9a-f]*)?(")/g;

function pages() {
  const blog = path.join(ROOT, 'blog');
  return fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .concat(fs.existsSync(blog)
      ? fs.readdirSync(blog).filter(f => f.endsWith('.html')).map(f => 'blog/' + f)
      : []);
}

const hashes = new Map();
function version(file) {
  if (!hashes.has(file)) {
    hashes.set(file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8));
  }
  return hashes.get(file);
}

/* Returns [{page, ref, want}] for every reference whose stamp is wrong;
   rewrites the pages too unless dryRun. */
function stamp(dryRun) {
  const stale = [];
  for (const page of pages()) {
    const file = path.join(ROOT, page);
    const src = fs.readFileSync(file, 'utf8');
    const out = src.replace(REF, (whole, pre, ref, post) => {
      const asset = path.join(ROOT, path.dirname(page), ref);
      if (!fs.existsSync(asset)) return whole;            // check.js reports missing files
      const want = `${ref}?v=${version(asset)}`;
      if (whole !== pre + want + post) stale.push({ page, ref, want });
      return pre + want + post;
    });
    if (!dryRun && out !== src) fs.writeFileSync(file, out);
  }
  return stale;
}

module.exports = { stamp };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = stamp(check);
  if (check) {
    for (const s of stale) console.log(`  stale  ${s.page}: ${s.ref} should be ${s.want}`);
    process.exit(stale.length ? 1 : 0);
  }
  console.log(stale.length ? `stamped ${stale.length} reference(s)` : 'all references already current');
}
