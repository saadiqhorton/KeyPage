# SAA-175 — Backup import pins header KDF to export presets

Plan only. No code in this change. Implementer: follow the tasks in order; every design
decision is already made here.

**Issue:** [SAA-175](https://linear.app/saadiqhorton/issue/SAA-175/medium-backup-import-honors-attacker-kdf-params-browser-dos) (Medium)

---

## 1. Root cause (confirmed in code)

Backup import honors attacker-supplied KDF params from the cleartext backup header. The
untrusted path is:

`apps/web/src/components/settings/BackupImportCard.tsx` → `parseBackupFile` (shape-only) →
user enters password → `apps/web/src/vault/useBackup.ts` `importBackup` → `decryptBackup` →
`deriveBackupKey` → `argon2idDerive` (`apps/web/src/crypto/argon2.ts`).

`validateKdfParams` in `apps/web/src/crypto/backup.ts` (lines 63-100) is the only gate and it
only range-checks. A crafted `keypage-backup` can set `memoryKiB` up to
`BACKUP_KDF_MAX_MEMORY_KIB` (262_144 ≈ 256 MiB) and `iterations` up to 10, so an unlocked user
importing a hostile file forces heavy Argon2id in the tab — a hang/DoS. The derive cost is paid
before AES-GCM can fail on a wrong key.

Every legitimate v1 backup was produced by `pickKdfParams()` in
`apps/web/src/crypto/derive.ts` (lines 29-48), which returns exactly one of two presets,
unchanged since export shipped:

- **argon2id:** `memoryKiB: 65536`, `iterations: 3`, `parallelism: 1` (from
  `ARGON2ID_VAULT_PARAMS` in `packages/shared/src/vault.ts`)
- **pbkdf2-sha256:** `iterations: 600_000` (from `PBKDF2_FALLBACK_ITERATIONS` in
  `packages/shared/src/vault.ts`)

`BACKUP_FORMAT_VERSION = 1` is frozen. No format change. No server-side change.

## 2. Chosen fix: pin import to the exact export presets

Add a strict preset check for the **untrusted import path** only, rejecting anything that is
not a KDF KeyPage export has ever emitted — **before** any key derivation. Keep
`validateKdfParams` for the trusted encrypt path (`encryptBackup`/`deriveBackupKey`).

- `packages/shared/src/backup.ts` gains `isExportedBackupKdf(kdf)` — matches algorithm plus
  numeric params exactly against the two presets (ignores salt).
- `apps/web/src/crypto/backup.ts` gains `validateImportedKdfParams(kdf)` — same 16-byte salt
  check as `validateKdfParams`, then throws `BackupFormatError` if the KDF is not an export
  preset. It is called in `parseBackupFile` (reject at file selection) and in `decryptBackup`
  (defense in depth at the derive boundary).

### Why not the alternatives

| Alternative | Why it fails or is larger |
|---|---|
| Lower `BACKUP_KDF_MAX_MEMORY_KIB` | Still honors attacker-chosen params within a range; a DoS just needs a smaller-but-still-heavy value. Does not pin to what export emits. |
| Cap memory at the derive boundary only | Leaves the hostile header accepted at parse time and still allows non-preset (but in-range) params; weaker and less clear. |
| Require a server-side allowlist / signature on the header | Format change; `BACKUP_FORMAT_VERSION` is frozen and there is no server-side change. Overkill for a single-user vault. |
| Do nothing (rely on AES-GCM failing) | The derive cost is paid before AES-GCM can fail, so the DoS still lands. |

### Non-goals (deliberate)

- **No format change.** `BACKUP_FORMAT_VERSION = 1` stays frozen; the header shape is unchanged.
- **No server-side change.**
- **No change to `validateKdfParams`** — it remains the gate for self-generated params on the
  encrypt path.
- **No change to the vault KDF** or to recovery-code KDF handling; this is scoped to backup
  import only.

---

## 3. Implementation

### Task 1 — Shared predicate

**Modify:** `packages/shared/src/backup.ts`

1. Change the type-only import from `./vault.js` to also import the values
   `ARGON2ID_VAULT_PARAMS` and `PBKDF2_FALLBACK_ITERATIONS` (keep `type KdfParams`).
2. Add the exported predicate:

   ```ts
   /** True only for KDF params a KeyPage export has ever emitted (v1). */
   export function isExportedBackupKdf(kdf: KdfParams): boolean {
     if (kdf.algorithm === "argon2id") {
       return (
         kdf.memoryKiB === ARGON2ID_VAULT_PARAMS.memoryKiB &&
         kdf.iterations === ARGON2ID_VAULT_PARAMS.iterations &&
         kdf.parallelism === ARGON2ID_VAULT_PARAMS.parallelism
       );
     }
     return kdf.iterations === PBKDF2_FALLBACK_ITERATIONS;
   }
   ```

3. Keep the three `BACKUP_KDF_MAX_*` constants. Add a short doc comment noting they are
   shape/sanity bounds for self-generated params and that import additionally pins to export
   presets.

### Task 2 — Web import gate

**Modify:** `apps/web/src/crypto/backup.ts`

1. Import `isExportedBackupKdf` from `@keypage/shared` (add to the existing import block).
2. Add `validateImportedKdfParams(kdf: KdfParams): void` — (a) same 16-byte salt check as
   `validateKdfParams`, then (b) throw `BackupFormatError` with a clear message if
   `!isExportedBackupKdf(kdf)`:

   ```
   Backup KDF settings don't match a KeyPage export. Re-export the backup from KeyPage and try again.
   ```

3. In `parseBackupFile`, after `const kdf = parseKdfParams(parsed.kdf);` call
   `validateImportedKdfParams(kdf);` so hostile files are rejected at file selection.
4. In `decryptBackup`, change `validateKdfParams(file.kdf);` to
   `validateImportedKdfParams(file.kdf);` (defense in depth at the derive boundary).
5. Leave `validateKdfParams` in place for `encryptBackup` and `deriveBackupKey`.

### Task 3 — Tests

**Modify:** `apps/web/src/crypto/backup.test.ts`

- Add a `PRESET_KDF` fixture (pbkdf2-sha256, `iterations: 600_000`, importing
  `PBKDF2_FALLBACK_ITERATIONS` from `@keypage/shared`).
- Keep `FAST_KDF` only for the encrypt-only test.
- Switch fixtures that parse or decrypt to `PRESET_KDF` (round-trip, wrong-password,
  flipped-ciphertext, mutated-formatVersion, header fixture `base.kdf`).
- Keep the "rejects out-of-clamp KDF parameters" test (argon2id 4_194_304 MiB is non-preset,
  so it still throws `BackupFormatError`; it now exercises the preset gate).
- New tests:
  - `parseBackupFile` accepts both real presets (argon2id preset + `PRESET_KDF`).
  - `parseBackupFile` rejects attacker headers with `BackupFormatError` (argon2id 262_144,
    argon2id 131_072, argon2id iterations 10, argon2id parallelism 2, pbkdf2 2_000_000,
    pbkdf2 1_000).
  - `decryptBackup` rejects a preset-shaped file whose header was mutated to argon2id
    256 MiB ×10 with `BackupFormatError` (NOT `BackupPasswordError`) — proving rejection
    precedes derivation/password use.
  - `decryptBackup` on a real-preset file with the wrong password still throws
    `BackupPasswordError` (legit path intact). The existing default `pickKdfParams()`
    round-trip test already covers the real-preset happy path.

### Task 4 — Docs

- Create `docs/plans/2026-09-03-saa-175-backup-import-kdf-preset-pin.md` (this file).
- `CONTEXT.md` line 143 (the backup bullet): append a sentence that import pins the header KDF
  to the presets KeyPage export has ever emitted.
- `README.md` "Backups" section (~line 107-110): add one line that import only accepts files
  exported by KeyPage with unmodified KDF settings.
- `docs/adr/0002-encrypted-backup-format.md` Trade-offs section: add one line recording that
  import validates the cleartext header KDF against export presets (compatible tightening of
  v1; no format change).

---

## 4. Verification

### Automated

`pnpm typecheck && pnpm test && pnpm build` must pass. New/updated: `backup.test.ts` (new
preset-accept and attacker-reject cases; existing decrypt/parse cases switched to `PRESET_KDF`).

### Manual (for the PR)

1. Export a backup from KeyPage, then hand-edit the header `kdf.memoryKiB` to `262144` and
   re-import → rejected at file selection with the "don't match a KeyPage export" message,
   before any password prompt/derivation.
2. Import an unmodified export → still works (happy path intact).
3. Import an export with the wrong password → still reports the wrong-password error.

Capture evidence under the gitignored `.odw/` directory per `AGENTS.md`.

---

## 5. Risks and mitigations

- **Rejecting a legitimate file.** Only files whose header KDF was hand-edited (or produced by
  a non-KeyPage tool) are rejected. Every real KeyPage export uses one of the two presets, so
  no legitimate file is affected. The error message tells the user to re-export.
- **Future preset change.** If KeyPage ever changes its export KDF presets, `isExportedBackupKdf`
  must be extended to accept the new preset(s) alongside the old ones so old backups still
  import. This is a deliberate, documented maintenance point.
- **Defense in depth.** The check runs both at parse time and at the derive boundary, so a
  hostile file is rejected even if a future caller skips `parseBackupFile`.
