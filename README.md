# Qryptonics — company website

Static site, no build step, no dependencies. Served from GitHub Pages at
<https://qryptonics.com>.

## Structure

| File | Page |
|---|---|
| `index.html` | Home — hero, practices, circuits, sectors, engagement |
| `development.html` | Development services (things we build) |
| `services.html` | Assurance services (things we assess and certify) |
| `about.html` | About |
| `blog.html` | Insights → Blog |
| `research.html` | Insights → Research |
| `styles.css` | All styling and design tokens |
| `site.js` | Navigation, scroll reveal, circuit and Ising interactions |
| `lattice.js` | Home hero canvas |

Nav and footer markup is duplicated across pages by design. There is no templating
step, which keeps the site dependency-free and instant to load. If you edit the nav,
edit it in all six files.

## Run locally

```bash
python3 -m http.server 8000
```

## Deploy

Push to `main`. GitHub Pages rebuilds automatically. The `CNAME` file holds the custom
domain — do not delete it.

## Design notes

**Palette** reads as a technical drawing: paper ground, indigo ink, copper for
annotation and actions, cryo blue for circuits and data. Tokens live at the top of
`styles.css`.

**Hero motif** is a lattice under Lagrange–Gauss basis reduction. Lattice hardness is
what ML-KEM and ML-DSA rest on, and the same lattice is the Ising form that quantum
optimization problems get encoded into.

**Circuit figures** are hand-authored SVG, not images. Each `.gate` group carries
`data-step`, `data-name` and `data-desc`. Hovering shows the description in the caption;
"run circuit" steps through in `data-step` order. To add a gate, copy an existing `<g>`
and set those three attributes.

**Ising figure** computes its own energy. Each `.edge` has `data-a`, `data-b` and
`data-w`; each `.node` has `data-id`. Clicking a node flips the spin and the readout
recalculates H and the unsatisfied-coupling count. The pentagon is frustrated, so the
minimum is −4.0 with one coupling still unsatisfied.

**Scroll reveal** is progressive enhancement. `.rv` is only hidden when the `js` class
is on `<html>`, and `site.js` reveals everything if IntersectionObserver is missing, the
viewport reports zero height, reduced motion is set, or nothing has appeared after two
seconds. A script failure never leaves a blank page.

## DNS

Live records:

```
A     @   185.199.108.153 / .109.153 / .110.153 / .111.153
CNAME www syedshahmirkazmi.github.io.
TXT   @              v=spf1 -all
TXT   _dmarc         v=DMARC1; p=reject; aspf=s; adkim=s
```

Still outstanding:

- **DKIM** — Hostinger rejected the `*._domainkey` wildcard. Add the real selector when
  you set up email.
- **CAA** — optional now the certificate exists: `0 issue "letsencrypt.org"`.
- **SPF** currently says no server may send mail as this domain. When you add a mailbox,
  replace `-all` with the provider's `include:`, drop DMARC to `p=none` for two to three
  weeks to confirm legitimate mail passes, then return it to `p=reject`.

## Before wider launch

- `hello@qryptonics.com` does not exist. The contact buttons use a personal Gmail, which
  reads poorly to the banks and defence buyers this site targets.
- No LinkedIn company page is linked yet.
- Nothing on the site claims a client, partner, certification or credential. Keep it that
  way until each one is evidenced.
- Capability lists describe what you intend to sell. Remove anything you cannot staff.

## Community signup

`community.js` has a `FORM_ENDPOINT` constant at the top. It is empty by design.

**Empty (current):** submitting composes the joining request in the visitor's own mail client
and copies it to their clipboard. Nothing is transmitted anywhere until they press send, no
third party is involved, and there is no data processor to sign an agreement with. The
trade-off is friction and no structured storage.

**Set to a URL:** the form POSTs JSON instead. Two things must change together:

1. Set `FORM_ENDPOINT` in `community.js`.
2. Relax the CSP in `community.html` — `connect-src 'none'` must become
   `connect-src https://your-endpoint.example`, or the browser blocks the request.

Before choosing a provider, note that it becomes a **data processor** for personal data. You
need a data processing agreement with them, and `privacy.html` must be updated to name them —
it currently states that nobody else sees the data. Prefer a provider that lets you choose
the data region.

## Local development

```bash
npm install     # installs nothing — there are no dependencies
npm run dev     # http://localhost:8000 with live reload
npm run stamp   # refresh ?v= cache-busting hashes after editing any .css/.js
npm run check   # pre-deploy checks
```

GitHub Pages serves every file with `max-age=600`, so without versioning a browser can
show new HTML with a stale stylesheet for ten minutes. Every local CSS/JS reference is
written as `styles.css?v=<first 8 hex of its SHA-256>`; the URL changes only when the
file does. `npm run check` fails if any stamp is stale.

`dev-server.js` is Node standard library only. It injects a live-reload client in
development and adds that client's SHA-256 to the page's existing CSP rather than
weakening the policy, so the CSP you test locally is the one that ships.

`npm run check` verifies: no broken links or dead anchors, every asset referenced by CSS
exists, one `h1` per page with no skipped heading levels, no third-party requests, no
inline style attributes, every page carries a CSP, all scripts parse, and every CSS/JS
reference carries its current `?v=` hash. It exits
non-zero on failure, so it drops straight into CI.

## Motion

`motion.js` implements spring physics without a framework. A damped harmonic oscillator is
solved numerically, sampled, and emitted as a CSS `linear()` easing function. The spring
supplies the curve *shape*; duration is set at the call site, which is what keeps genuine
spring character inside the 150–400 ms interaction guidelines.

Two curves: reveal is near-critically damped so content does not wobble (380 ms, monotonic),
feedback overshoots ~9% so a press feels physical (190 ms). Everything animates transform and
opacity only, so it stays on the compositor thread, and all of it is disabled under
`prefers-reduced-motion`.

**Why not Framer Motion.** It requires React, a build pipeline and roughly 200–300
transitive packages. This site sells dependency and SBOM analysis, so shipping a marketing
page with that tree is an own-goal. React would also force `'unsafe-inline'` back into
`style-src`. The whole homepage including fonts is currently ~145 KB uncompressed; React plus
Framer Motion alone is ~92 KB gzipped before any content.
