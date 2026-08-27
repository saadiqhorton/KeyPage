# SAA-174 — First-boot setup token

Plan only. No code in this change. Implementer: follow the tasks in order; every design
decision is already made here.

**Issue:** [SAA-174](https://linear.app/saadiqhorton/issue/SAA-174/high-unauthenticated-first-boot-setup-can-claim-vault-on-lantunnel) (High)

---

## 1. Root cause (confirmed in code)

`POST /api/vault/setup` has **no proof that the caller owns the deployment**. Its only gates are:

- `preHandler: checkOrigin` — a CSRF check, not authentication. `apps/api/src/plugins/check-origin.ts`
  returns early when `Origin` is absent (so any non-browser client passes) and otherwise only
  requires `Origin.host === Host`, which an attacker controls for their own request.
- `if (isVaultInitialized(db)) throw new HttpVaultAlreadyInitialized()` in
  `apps/api/src/routes/vault.ts` — a first-writer-wins condition, not an authorization check.

The server binds `0.0.0.0` by default (`host: process.env.HOST ?? "0.0.0.0"` in
`apps/api/src/config.ts`), which is deliberate for the documented Docker-on-LAN use case. So on a
fresh data dir, anyone who can reach port 9090 can post their own `kdf`, `authStoredKeyHex`,
`recoveryStoredKeyHex`, and recovery envelopes and become the vault owner. `initializeVault` is
already transactional and maps a duplicate insert to `vault_already_initialized`, so the DB-level
race is clean — the problem is purely that **the first caller is never authenticated**. The real
owner is then locked out with `vault_already_initialized` until the data dir is wiped.

Two distinct reachability paths, both open:

- **LAN peer** — reaches `http://<LAN-IP>:9090` directly.
- **Cloudflare Tunnel URL holder** — reaches the same route through `cloudflared`, which connects
  from `127.0.0.1`, so the request is indistinguishable from a local one at the socket level.

## 2. Chosen fix: a server-minted first-boot setup token

On startup, when the vault is not yet initialized, the server mints a 256-bit random token, writes
it to `<dataDir>/setup-token` with mode `0600`, and prints it to stdout. `POST /api/vault/setup`
requires that token in the request body. On success the token is deleted from disk and dropped from
memory.

The token is a **proof of host access**: it exists only in the server's stdout and in the
bind-mounted data directory. A LAN peer and a Tunnel URL holder can both reach the route but
neither can read `docker compose logs` or `./data/setup-token`, so both claim races close with one
mechanism. It authenticates the operator instead of guessing at network position, which is why it
survives the Tunnel case that any IP-based gate fails.

### Why not the alternatives

| Alternative | Why it fails or is larger |
|---|---|
| Loopback-only `/setup` | Does not close the Tunnel vector at all (`cloudflared` connects from `127.0.0.1`), and with `KEYPAGE_TRUST_PROXY=true` the forwarded client IP is attacker-supplied. Also breaks the documented "open `http://<LAN-IP>:9090` for first run" flow. |
| Bind `127.0.0.1` until setup completes | Inside a container, binding loopback makes the published `9090:9090` port unreachable, so Docker first-run — the primary install path — breaks entirely. |
| RFC1918 / LAN-CIDR allowlist on `/setup` | The LAN peer *is* on the LAN. Closes neither vector. |
| Operator-supplied `KEYPAGE_SETUP_TOKEN` env var | Closes both vectors but forces the user to edit `.env` and restart before first boot, breaks the one-shot `curl \| bash` installer, and parks a long-lived secret in the process environment (`docker inspect`, `/proc/<pid>/environ`). Auto-minting is strictly better UX with a shorter-lived secret. |
| Time-boxed claim window after boot | Authenticates nobody. A LAN peer still wins the race inside the window. |
| Accounts, pairing flow, or mTLS | Product redesign; out of scope for a single-user vault. |

### Non-goals (deliberate)

- **No rate limiting on the token check.** The token is 256 bits of CSPRNG output, comparison is
  constant-time, and a wrong guess reveals nothing. Adding a `setup` throttle scope would mean a
  migration for the existing scope column and buys nothing. Do not add it.
- **No new env var**, no change to `.env.example`, no change to the default bind, no change to port
  9090.
- **No change to `GET /api/vault/status`.** The setup screen always renders the token field while
  the vault is unclaimed, so no new status flag is needed.

---

## 3. Implementation

### Task 1 — Shared contract

**Modify:** `packages/shared/src/vault.ts`

1. Add to `ApiErrorCode`: `| "invalid_setup_token"`.
2. Add the token shape constant next to the other `keypage:v1:*` constants:

   ```ts
   /** base64url of 32 random bytes, as minted by the API's randomToken(). */
   export const SETUP_TOKEN_PATTERN = "^[A-Za-z0-9_-]{43}$";
   ```

   Keep it a **string**, not a `RegExp`: the API feeds it straight into a Fastify JSON schema and
   the web wraps it in `new RegExp(...)`.
3. Add to `VaultSetupRequest`:

   ```ts
   /** First-boot proof of host access; minted by the server (SAA-174). */
   setupToken: string;
   ```

### Task 2 — Setup gate module

**Create:** `apps/api/src/auth/setup-token.ts`
**Test:** `apps/api/src/auth/setup-token.test.ts`

Owns the whole token lifecycle behind a narrow interface so the route never touches the filesystem:

```ts
export const SETUP_TOKEN_FILENAME = "setup-token";

export type SetupGate = {
  /** Plaintext token while the vault is unclaimed; null once claimed. */
  readonly token: string | null;
  readonly filePath: string;
  verify(candidate: string): boolean;
  consume(): Promise<void>;
};

export async function openSetupGate(options: {
  dataDir: string;
  vaultInitialized: boolean;
}): Promise<SetupGate>;
```

Behavior:

- `filePath = path.join(dataDir, SETUP_TOKEN_FILENAME)`.
- **`vaultInitialized: true`** — `await fs.rm(filePath, { force: true })` to clear a stale file, and
  return a gate with `token: null`, `verify: () => false`, and a no-op `consume`.
- **`vaultInitialized: false`** — read the file as utf8 and `trim()`. Reuse the value if it matches
  `SETUP_TOKEN_PATTERN` (a restart mid-onboarding must not invalidate a token the owner already
  copied). Otherwise mint `randomToken()` from `./tokens.js` and
  `fs.writeFile(filePath, token + "\n", { mode: 0o600 })` followed by an explicit
  `fs.chmod(filePath, 0o600)` — the create mode is masked by umask, and the file may pre-exist with
  looser bits.
- `verify(candidate)` — `token !== null && timingSafeEqual(sha256(candidate), sha256(token))`, where
  `sha256` is `createHash("sha256").update(x).digest()`. Hash both sides so `timingSafeEqual` never
  throws on a length mismatch.
- `consume()` — set the closure variable to `null` (expose `token` via a getter), then
  `await fs.rm(filePath, { force: true })`. In-memory invalidation first, so a filesystem error
  cannot leave a live token.
- On `EACCES`/`EPERM` for any read/write/chmod, throw
  `Cannot write the first-boot setup token at <path>. Check bind-mount ownership and permissions.`
  Match the phrasing style of `permissionErrorMessage` in `apps/api/src/data-dir.ts`. This is a
  startup failure and should stop the process — a data dir the server cannot write is unusable
  anyway.

Tests (`node:test`, `fs.mkdtemp` under `os.tmpdir()`, remove the dir in `afterEach`):

1. Mints a token that matches `SETUP_TOKEN_PATTERN` and writes the file with mode `0600`
   (`(statSync(p).mode & 0o777) === 0o600`). This is what pins the shared pattern to `randomToken()`.
2. Reuses the same token when `openSetupGate` runs again on the same dir (restart case).
3. `consume()` deletes the file, flips `token` to `null`, and makes `verify(correctToken)` false.
4. `vaultInitialized: true` deletes a pre-existing token file and yields `token: null`.

### Task 3 — Route gate

**Modify:** `apps/api/src/errors.ts`

```ts
export class HttpInvalidSetupToken extends HttpError {
  constructor(message = "Setup token is invalid") {
    super(401, "invalid_setup_token", message);
  }
}
```

401 matches the existing convention for `invalid_credentials`, `invalid_recovery_code`, and
`invalid_recovery_ticket` (none of which send `WWW-Authenticate` either).

**Modify:** `apps/api/src/routes/vault.ts`

1. `VaultRouteOptions` gains `setupGate: SetupGate` (required).
2. `/setup` schema: add `"setupToken"` as the **first** entry of `required`, and
   `setupToken: { type: "string", pattern: SETUP_TOKEN_PATTERN }` to `properties`. A missing or
   malformed token therefore fails as a 400 `invalid_request` before any handler code runs, and
   `verify` only ever sees a well-formed candidate.
3. In the handler, after the existing `validate*` calls and **after** the `isVaultInitialized`
   check:

   ```ts
   if (isVaultInitialized(db)) {
     throw new HttpVaultAlreadyInitialized();
   }
   if (!setupGate.verify(body.setupToken)) {
     throw new HttpInvalidSetupToken();
   }
   ```

   Order matters and this order is deliberate: `vault_already_initialized` first keeps today's error
   semantics for a legitimate double-submit (the second request arrives with a valid token that
   `consume()` has already dropped, and `invalid_setup_token` would be a misleading answer). It
   leaks nothing new, because `GET /api/vault/status` already reports initialization state to
   unauthenticated callers.
4. Immediately after `initializeVault(...)` returns, `await setupGate.consume();` — before the
   session is created, so a failure to mint a session still burns the token.

**Modify:** `apps/api/src/server.ts` — `BuildServerOptions` gains `setupGate: SetupGate`; pass it
into the `vaultRoutes` registration.

**Modify:** `apps/api/src/routes/vault-auth.test.ts` — `buildTestApp` registers `vaultRoutes` with
`{ prefix, db }` only and will fail typecheck. Give it a stub:
`{ token: null, filePath: "", verify: () => false, consume: async () => {} }`. That file's cases all
run against an already-initialized vault, so `verify` is never reached.

**Create:** `apps/api/src/routes/vault-setup.test.ts` — mirror the `buildTestApp` harness from
`vault-auth.test.ts`, but register a gate backed by a fixed valid-shaped token and a `consumed`
boolean:

1. No `setupToken` in the body → 400 `invalid_request`.
2. Well-formed but wrong token → 401 `invalid_setup_token`, `isVaultInitialized(db)` still false, and
   `GET /api/vault/status` still reports `setup_required`. **This is the regression test for the
   ticket.**
3. Correct token → 201, `consumed === true`, and a follow-up POST with the same token → 409
   `vault_already_initialized`.

These are justified against the repo's manual-first preference in `CONTEXT.md`: the negative case is
the security property itself, it cannot be re-verified by hand on every future change, and the
harness already exists.

### Task 4 — Startup wiring and operator banner

**Modify:** `apps/api/src/main.ts`

After `openDatabase` / `runHousekeeping` and before `buildServer`:

```ts
const setupGate = await openSetupGate({
  dataDir: config.dataDir,
  vaultInitialized: isVaultInitialized(db),
});
```

Pass `setupGate` into `buildServer`. Immediately before `app.listen`, when `setupGate.token` is
non-null, print the banner with **`console.log`, not `app.log`** — `LOG_LEVEL=error` must not be
able to hide the only onboarding credential, and this keeps the token out of the structured log
stream and its redaction config:

```
────────────────────────────────────────────────────────────────
  KeyPage first-boot setup token

    <token>

  Paste it on the setup screen to claim this vault.
  Also readable at: <filePath>
  Anyone who can reach this server but cannot read this token
  cannot claim the vault.
────────────────────────────────────────────────────────────────
```

Never log the token on any other code path, and never put it in a URL — Fastify's request logger
serializes `req.url`.

### Task 5 — Web UI

**Modify:** `apps/web/src/vault/useVault.ts` — `submitSetup(password: string, setupToken: string): Promise<void>;`

**Modify:** `apps/web/src/vault/VaultProvider.tsx`

- Widen the `submitSetup` callback signature and add `setupToken` to the `postVaultSetup` body.
- Add a pre-flight as the **first** statement of the callback, before `setIssuingRecoveryCodes(true)`
  and before any KDF work, so a typo does not cost an Argon2 derivation or mint a throwaway recovery
  code set:

  ```ts
  if (!new RegExp(SETUP_TOKEN_PATTERN).test(setupToken)) {
    throw new ApiError({
      error: "invalid_setup_token",
      message:
        "That setup token doesn't look right. Copy it from the server log or ./data/setup-token.",
    });
  }
  ```

  No token-verification endpoint: it would be a new unauthenticated oracle for zero real benefit.

**Modify:** `apps/web/src/screens/SetupScreen.tsx`

- New `setupToken` state and a `TextField` (from `@/components/ui/TextField`) rendered **above** the
  password fields in step 1. `label="Setup token"`, `type="text"` (not a password field — the user
  needs to eyeball a paste, and it should not land in a password manager),
  `autoComplete="off"`, `spellCheck={false}`, `autoFocus` (move `autoFocus` off the Master Password
  field), `disabled={working}`.
- `hint`: "Printed in the server log the first time KeyPage starts. Docker: `docker compose logs
  keypage | grep -A4 'setup token'`, or `cat ./data/setup-token`."
- Submit with `setupToken.trim()`; clear the field alongside the passwords on success.
- Track the caught `ApiError.code` and, when it is `invalid_setup_token`, render the message through
  the field's `error` prop instead of the form-level `<p>`, following the pattern in
  `UnlockScreen.tsx`.

`apps/web/src/lib/api.ts` needs no change — `postVaultSetup` is typed off `VaultSetupRequest`.

### Task 6 — Docs and installer

**Modify:** `README.md`

- "First run": new step 1, "Get your setup token", listing all three retrieval paths (container log,
  `./data/setup-token` on the host via the bind mount, `docker compose exec keypage cat
  /app/data/setup-token`); renumber the existing steps. Add one sentence explaining *why*: the
  server binds `0.0.0.0` so anyone on the LAN or holding the Tunnel URL can reach the setup screen,
  and the token is what stops them claiming the vault.
- Quick start: after `docker compose up -d --build`, add the `docker compose logs` one-liner that
  surfaces the token.
- Data-dir table: add `setup-token` — "First-boot setup token (mode `0600`); deleted once the vault
  is claimed".
- "Start over with a fresh vault": change to `rm -f data/keypage.db* data/setup-token` (both Docker
  and local-dev variants) so the next boot mints a fresh token.
- Add a "Lost the setup token?" note: stop the app, delete `data/setup-token`, start it again — a new
  one is minted and printed. Only possible with host access, which is the point.

**Modify:** `CONTEXT.md`

- Security Model: "First-boot claim: `POST /setup` requires a server-minted setup token, written to
  `<dataDir>/setup-token` (`0600`) and printed to stdout on the first boot of an unclaimed vault.
  Because the default bind is `0.0.0.0` and Cloudflare Tunnel arrives over loopback, no
  network-position gate can distinguish the owner; possession of the token is proof of host access.
  The token is deleted on successful setup (SAA-174)."
- First-Time Setup: note that the wizard's first step now collects the setup token alongside the
  Master Password.

**Modify:** `scripts/install.sh` — after the health-check stage, print the token when
`${KEYPAGE_DIR}/data/setup-token` exists, so the primary onboarding path never requires the user to
go digging:

```bash
if [[ -r data/setup-token ]]; then
  say "Setup token: $(cat data/setup-token)"
  note "Paste it on the setup screen. Also at ${KEYPAGE_DIR}/data/setup-token"
fi
```

Use the existing `say`/`note` helpers. If the file is unreadable because of the UID-1000 chown, fall
back to a `note` pointing at `docker compose logs keypage`.

No change to `.env.example`, `docker-compose.yml`, `Dockerfile`, or `.gitignore` (`data/` is already
ignored).

---

## 4. Verification

### Automated

`pnpm typecheck && pnpm test && pnpm build` must pass. New: `setup-token.test.ts` (4 cases) and
`vault-setup.test.ts` (3 cases); updated: `vault-auth.test.ts` harness.

### Manual (for the PR, on port 9090 only)

1. **Fresh boot mints the token.** `rm -rf data && pnpm build && KEYPAGE_WEB_DIR=apps/web/dist pnpm
   start`. Banner appears on stdout; `ls -l data/setup-token` shows `-rw-------`; the file contents
   match the banner.
2. **The claim race is closed.** Post a fully valid setup body with a wrong-but-well-formed token:
   `curl -sS -X POST http://127.0.0.1:9090/api/vault/setup -H 'content-type: application/json' -d
   '{"setupToken":"<43 wrong chars>", ...}'` → `401 invalid_setup_token`. Then
   `curl -sS http://127.0.0.1:9090/api/vault/status` → still `"state":"setup_required"`. Repeat the
   same POST against the machine's non-loopback address to stand in for the LAN peer, and with no
   `Origin` header to stand in for the Tunnel/non-browser client. Both must be rejected.
3. **Owner setup succeeds.** Open `http://localhost:9090`, paste the token, create the Master
   Password → recovery codes screen appears, and `data/setup-token` is gone.
4. **LAN access after setup still works.** From the non-loopback address, load the app and unlock
   with the Master Password.
5. **Restart is quiet.** Restart with the initialized vault → no banner, no token file recreated,
   `/setup` returns `vault_already_initialized`.
6. **Docker path**, when Docker is available: `docker compose up -d --build`, then
   `docker compose logs keypage | grep -A4 "setup token"` and `cat data/setup-token`.

Capture evidence under the gitignored `.odw/` directory per `AGENTS.md`.

---

## 5. Risks and mitigations

- **Docker UX friction.** First-boot now requires a copy-paste step that did not exist before. The
  installer prints the token, the README documents three ways to retrieve it, and the setup screen's
  hint restates them inline. Accepted cost; this is the security property.
- **Headless / no terminal.** The banner goes to container stdout, which `docker compose logs`
  retains, and the bind-mounted `./data/setup-token` is readable from the host without attaching to
  the container. No path requires an interactive TTY.
- **File permissions under UID 1000.** The container runs as `node` (UID 1000) and the entrypoint
  chowns `/app/data`, so `0600` means a host user with a different UID needs `sudo cat` (or the
  already-documented `chown -R 1000:1000 ./data`). Onboarding never depends on that, because the log
  banner is the primary channel.
- **Token leakage via logs.** The token sits in `docker compose logs` output for the life of the
  container's log buffer. Residual and accepted: it is inert the moment the vault is initialized,
  because `/setup` returns `vault_already_initialized` before the token is ever compared. Mitigated
  further by never routing it through `app.log` (so it is not shipped by structured log collectors)
  and never placing it in a URL, which Fastify does log.
- **`KEYPAGE_TRUST_PROXY`.** The gate deliberately ignores client IP entirely, so forged
  `X-Forwarded-For`/`X-Forwarded-Host` cannot influence it. This is exactly why an IP-based
  alternative was rejected. `checkOrigin` behavior is unchanged.
- **Data dir on shared or world-readable storage.** A token file on NFS or a world-readable path is
  as exposed as the SQLite vault itself. `0600` plus the explicit `chmod` is the mitigation; the
  broader exposure is pre-existing and out of scope.
- **Setup token reuse across restarts.** Intentional: a container restart mid-onboarding must not
  strand a token the owner already copied. The window closes the moment the vault is claimed, and
  the file never survives a successful setup.
- **Breaking the existing route contract.** `setupToken` is a required field, so any external
  scripted setup (none known in-repo) breaks with a 400. Acceptable for a High-severity
  authentication fix, and called out in the README.
