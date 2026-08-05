# Qryptonics — company website

Static marketing site for Qryptonics. No build step, no dependencies. Three files do the work:

| File | Purpose |
|---|---|
| `index.html` | All page content |
| `styles.css` | Design tokens and layout |
| `lattice.js` | Hero canvas — animated lattice basis reduction |

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Push to a repository named `qryptonics-site` (or anything — the custom domain is what matters).
2. **Settings → Pages → Source:** *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. **Settings → Pages → Custom domain:** enter `qryptonics.com`. This writes the `CNAME` file.
4. Tick **Enforce HTTPS** once the certificate is issued (can take up to an hour).

## DNS — moving the domain from Hostinger parking to GitHub Pages

The domain currently resolves to Hostinger's parking page (`2.57.91.91`) on
`athena/apollo.dns-parking.com`. In Hostinger's DNS zone editor, replace the existing
`A` record for `@` with these four:

```
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   <github-username>.github.io.
```

Keep the email-authentication records below in place — they are independent of hosting.

## Required DNS security records

The domain has no email authentication. Until real mailboxes exist, add these so nobody
can spoof `@qryptonics.com`:

```
TXT   @              v=spf1 -all
TXT   _dmarc         v=DMARC1; p=reject; rua=mailto:dmarc@qryptonics.com; aspf=s; adkim=s
TXT   *._domainkey   v=DKIM1; p=
```

When email is set up, swap the SPF for the provider's `include:`, add their real DKIM
selector, run DMARC at `p=none` for two to three weeks to confirm legitimate mail passes,
then return it to `p=reject`.

## Before this goes public — content to verify

Nothing on the page claims a client, partner, certification or credential, by design.
Check these before launch:

- `hello@qryptonics.com` — mailbox does not exist yet
- LinkedIn company URL in the contact section is a placeholder
- The About section describes team background in general terms. Adjust to match what you
  can evidence, especially anything implying institutional affiliation.
- Capability lists describe services you intend to sell. Remove any you cannot staff today.

## Design notes

Palette is drawn from quantum hardware — the cold indigo of a shielded lab and the
gold-plated copper of a dilution refrigerator — deliberately avoiding the acid-green-on-black
that most quantum sites default to.

The hero motif is a lattice under Lagrange–Gauss basis reduction. It is not decoration:
lattice hardness is what ML-KEM and ML-DSA are built on, and the same lattice structure is
the Ising form every quantum optimization problem is encoded into. One image, both practices.

Type is Chivo for display and IBM Plex Mono for all technical annotation.
