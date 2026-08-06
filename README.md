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
