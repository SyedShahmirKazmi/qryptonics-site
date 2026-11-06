#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   Qryptonics — development server
   Static serving plus live reload, using only the Node standard
   library. No dependencies, so `npm install` adds nothing to the
   supply chain of a company that audits supply chains.

   The reload client is injected in development only, and its
   SHA-256 is added to the page's existing CSP on the fly rather
   than the CSP being weakened — so what you test locally is the
   same policy that ships.
   ══════════════════════════════════════════════════════════ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
};

/* ── live reload ─────────────────────────────────────────── */
const clients = new Set();

const RELOAD_CLIENT = `
(function(){
  var es = new EventSource('/__reload');
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ setTimeout(function(){ location.reload(); }, 1200); };
})();`;

const RELOAD_HASH = crypto.createHash('sha256').update(RELOAD_CLIENT).digest('base64');

function injectReload(html) {
  /* Add the client's hash to the existing CSP instead of removing it. */
  html = html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/,
    (_, a, policy, c) => {
      policy = policy.replace("script-src 'self'", `script-src 'self' 'sha256-${RELOAD_HASH}'`);
      policy = policy.replace("connect-src 'none'", "connect-src 'self'");
      return a + policy + c;
    }
  );
  return html.replace('</body>', `<script>${RELOAD_CLIENT}</script>\n</body>`);
}

let debounce = null;
function onChange(file) {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    process.stdout.write(`  reload  ${file}\n`);
    for (const res of clients) res.write('data: reload\n\n');
  }, 60);
}

function watch(dir) {
  fs.watch(dir, { recursive: true }, (_evt, file) => {
    if (!file) return;
    if (file.includes('node_modules') || file.startsWith('.git')) return;
    if (/\.(html|css|js|woff2|png|svg)$/.test(file)) onChange(file);
  });
}

/* ── request handling ────────────────────────────────────── */
/* Returns null for anything outside the site: a malformed escape (which
   would otherwise throw and kill the server), a path escaping the root
   (checked against root + separator, so a sibling folder sharing the
   name prefix does not pass), or a hidden file such as .git/ or .claude/.
   .well-known is the one hidden folder the site serves. */
function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const p = path.normalize(path.join(root, decoded));
  if (p !== root && !p.startsWith(root + path.sep)) return null;
  const hidden = path.relative(root, p).split(path.sep)
    .some(seg => seg.startsWith('.') && seg !== '.well-known');
  return hidden ? null : p;
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let file = safeJoin(ROOT, url === '/' ? '/index.html' : url);
  if (!file) { res.writeHead(403).end('Forbidden'); return; }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      return res.end(injectReload(fs.readFileSync(notFound, 'utf8')));
    }
    res.writeHead(404).end('Not found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';

  if (ext === '.html') {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    return res.end(injectReload(fs.readFileSync(file, 'utf8')));
  }

  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

/* Loopback only. Without a host Node listens on every interface, which
   puts the working copy on any shared Wi-Fi the laptop joins. */
server.listen(PORT, '127.0.0.1', () => {
  watch(ROOT);
  process.stdout.write(
    `\n  Qryptonics dev server\n` +
    `  http://localhost:${PORT}\n` +
    `  watching for changes, live reload on\n\n`
  );
});
