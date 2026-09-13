# KeyPage rollback runbook

Use this procedure only for a failed application upgrade. It does not release or deploy anything by itself. Run it first in a disposable environment.

## Prerequisites and decision point

- Record the exact 40-character candidate SHA and its last known-good ancestor SHA.
- Confirm both commits are present locally, the checkout is clean, Docker Compose is healthy, and no schema-dependent writes are still arriving.
- Before upgrade, stop KeyPage and create a consistent data snapshot: `docker compose down && tar -C data -czf ../keypage-pre-upgrade.tgz .`.
- Trigger rollback when the candidate fails health, startup, login, backup import/export, or data-integrity validation and an immediate forward fix is not safer.

The SQLite migrations are forward-only. Never run an older binary against data already opened by a newer schema. `scripts/rollback.sh` therefore stops the service and restores the pre-upgrade snapshot before checking out the ancestor.

## Execute

From the candidate checkout:

```sh
export KEYPAGE_CANDIDATE_SHA=<40-character-candidate-sha>
export KEYPAGE_ROLLBACK_TARGET=<40-character-last-known-good-sha>
export KEYPAGE_ROLLBACK_SNAPSHOT=/absolute/path/keypage-pre-upgrade.tgz
bash scripts/rollback.sh
```

The script refuses a dirty tree, abbreviated SHAs, a non-ancestor target, or a missing snapshot. It stops Compose without deleting volumes, replaces only `./data` from the named snapshot, checks out the target in detached mode, rebuilds, and polls `/api/health` on the published port.

## Validate

Record the command output and elapsed time. Then verify:

1. `git rev-parse HEAD` equals the rollback target.
2. `docker compose ps` reports KeyPage healthy.
3. `curl -fsS http://127.0.0.1:9090/api/health` returns `status: ok` (use the configured published port when changed).
4. The instance reports the expected schema version, unlock succeeds, the expected entry count is present, and one known entry decrypts correctly.
5. Export a fresh encrypted backup and import it into a second disposable instance. Confirm the entry count and known entry again.

Do not include setup tokens, passwords, key values, database files, or backup files in issue evidence.

## Forward recovery

If the older revision fails health validation, the script returns to the candidate revision and attempts a rebuild while retaining the pre-upgrade snapshot data. Keep the service isolated, preserve both the failed-state and pre-upgrade snapshots, and diagnose before another attempt. A later forward recovery must use an exact reviewed SHA and repeat health, unlock, entry-count, known-entry, and backup round-trip checks.
