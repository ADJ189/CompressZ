# Security Policy

CompressZ processes files entirely in the browser and has no backend, so the
most important security properties are: no file content leaves the device, no
remote code is executed outside the app's own bundle, and user-controlled text
never becomes executable markup.

## Supported versions

Security fixes land on `main` and in the latest deployed build at
<https://compressz.pages.dev>. Older `1.x` prereleases are not separately
maintained; please reproduce against the latest `main` before reporting.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on the repository:

<https://github.com/ADJ189/compressz/security/advisories/new>

If private reporting is unavailable, open a minimal public issue asking for a
private contact channel — without exploit details — and a maintainer will
follow up.

Please include:

- A description of the issue and its impact (data exposure, XSS, denial of
  service, dependency compromise, etc.).
- Browser and OS versions, plus the CompressZ route/tool involved.
- Reproduction steps or a proof of concept. A malicious file is ideal; if the
  file is large, describe its structure and attach a minimized version.
- Whether any file data, localStorage value, or network request is involved.

## What to expect

- Acknowledgement on a best-effort basis, usually within 7 days.
- Triage and a remediation plan after the report is reproduced.
- Credit in the fix/changelog if you want it. There is no bug bounty.

## Scope

In scope:

- Cross-site scripting or HTML injection through file names, OCR text, SVG
  content, extracted office-document text, or error messages.
- Any path that transmits file bytes or file-derived content to a server.
- Leaks of localStorage settings beyond the documented `theme`,
  `cz-settings-v2`, and legacy `cz-settings-v1` keys.
- Supply-chain issues in dependencies that actually ship in the browser
  bundle or are loaded from the documented CDNs.
- Denial-of-service bugs in the app's own parsers/engines that are reachable
  from a normal file drop.

Out of scope:

- Third-party CDN outages or compromises outside the project's control (report
  those upstream, but tell us if the app should fail more safely).
- Browser zero-days and OS-level attacks.
- Social engineering, physical access, or issues requiring a compromised
  browser extension.
- Missing hardening headers with no demonstrated impact.

## Safe harbor

Good-faith research that respects user privacy, avoids destructive testing, and
does not access other people's data is welcome. We will not pursue legal action
for accidental issues found while following this policy.
