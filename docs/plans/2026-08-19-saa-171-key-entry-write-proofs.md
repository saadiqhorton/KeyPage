# Key Entry Write Proofs Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require a fresh Master-Password-derived possession proof for every destructive Key Entry write.

**Architecture:** Reuse the existing SCRAM-style auth stored key and one-time login challenge store. Retain the already-derived auth key only in the browser's in-memory key store, bind each proof to the challenge plus HTTP method, route, and effective JSON body digest, and consume the challenge before the existing transactional write guards.

**Tech Stack:** TypeScript, Fastify, React, SQLite, `@noble/hashes`, Node test runner, pnpm/Turbo.

---

### Task 1: Shared write-proof message

**Files:**
- Modify: `packages/shared/src/auth-proof.ts`
- Test: `packages/shared/src/auth-proof.test.ts`

1. Add a failing fixed-vector test for the canonical key-write auth message and body digest.
2. Run `pnpm --filter @keypage/shared test` and confirm the missing API failure.
3. Add the minimal canonical message/digest helper using the existing SHA-256 implementation.
4. Re-run the shared tests and confirm they pass.

### Task 2: API proof gate

**Files:**
- Create: `apps/api/src/keys/key-write-proof.ts`
- Modify: `apps/api/src/routes/key-entries.ts`
- Test: `apps/api/src/routes/key-entries.test.ts`

1. Add failing route tests showing session-only create, import, update, and delete are rejected and valid proofs succeed only once for the exact route/body.
2. Run the focused API test and confirm current session-only writes violate the expectations.
3. Add the session-authenticated challenge endpoint and proof verification helper, consuming challenges atomically before mutations.
4. Update existing mutation tests to obtain valid proofs while retaining explicit negative security cases.
5. Re-run the focused API tests and confirm they pass.

### Task 3: Browser in-memory proof and API wrapper

**Files:**
- Modify: `apps/web/src/vault/session-keys.ts`
- Modify: `apps/web/src/crypto/derive.ts`
- Modify: `apps/web/src/vault/VaultProvider.tsx`
- Modify: `apps/web/src/vault/master-password.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/vault/session-keys.test.ts`
- Test: `apps/web/src/lib/api.test.ts`

1. Add failing tests that key clearing zeroizes/removes auth proof material and that mutation requests acquire a challenge and attach an exact-body proof.
2. Run the focused web tests and confirm the expected failures.
3. Retain auth key bytes only in the in-memory key store beside the encryption key, replacing and zeroizing them on rotation/lock.
4. Route all Key Entry create/import/update/delete API calls through the proof wrapper; leave read and use-activity calls unchanged.
5. Re-run focused web tests and confirm they pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `CONTEXT.md`

1. Document the per-write possession proof and in-memory auth-key lifetime.
2. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` and inspect complete output.
3. Run the application and capture the genuine add/edit/delete UI flow using only screen recording plus computer control, with no stage annotations or browser-console logging.
4. Inspect the diff and security checklist before committing.
