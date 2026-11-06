# Security policy

Full policy, scope and safe harbour: <https://qryptonics.com/security.html>
Machine-readable contact: <https://qryptonics.com/.well-known/security.txt>

## Reporting

Report privately through GitHub: <https://github.com/SyedShahmirKazmi/qryptonics-site/security/advisories/new>, or email **security@qryptonics.com**.
Include steps to reproduce and what you observed.
Acknowledgement within five working days, assessment within fifteen.

## Scope

`qryptonics.com` and everything served from it, the simulator, the community form, our DNS
and mail authentication, and this repository.

## Known and accepted

`X-Frame-Options`, `frame-ancestors` and HSTS all require HTTP response headers, which
GitHub Pages does not allow us to set. Framing is mitigated in script: `site.js` hides the
page when a foreign origin frames it. HSTS cannot be mitigated without a header. The site
has no authentication, no cookies and no state-changing actions, so the residual risk is
accepted and documented rather than hidden.

## Safe harbour

Good-faith research under this policy will not be met with legal action. We do not run a
paid bounty.
