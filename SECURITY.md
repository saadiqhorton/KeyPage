# Security policy

## Supported versions

Security updates are provided for the current `main` branch and the latest published release only. Older commits, images, forks, and modified deployments are not supported. Operators should update to the newest release after reviewing its notes and keep KeyPage behind HTTPS as described in the README.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability-reporting form for this repository:

<https://github.com/saadiqhorton/KeyPage/security/advisories/new>

Include the affected version or commit, deployment assumptions, reproduction steps, impact, and any suggested mitigation. Remove API keys, vault contents, setup tokens, cookies, credentials, personal data, and other secrets from the report and its attachments. We do not need live credentials to investigate.

If private reporting is unavailable, do not publish exploit details. Open a public issue that asks the maintainer to enable a private reporting channel, without including sensitive technical details.

## What to expect

Maintainers will acknowledge and triage reports on a best-effort basis. Reporters should receive an initial response within five business days. Investigation and remediation time depends on severity, reproducibility, and release risk. The maintainer may request a minimal reproducer or additional non-secret context and will coordinate disclosure after a fix is available.

## Security updates

Confirmed fixes are developed and reviewed privately when practical, verified with the smallest relevant security and regression checks, and released through the normal repository release process. Release notes identify security impact and required operator action without exposing unnecessary exploit detail. Operators are responsible for taking backups, applying the updated release or image, and following any migration or configuration instructions. Security findings are not silently suppressed; any accepted residual risk must be documented with scope, rationale, compensating controls, and a review point.
