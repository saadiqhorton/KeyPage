# SAA-171 Key Entry Write Proofs Design

## Security boundary

An authenticated session is necessary but no longer sufficient for Key Entry create, import, update, or delete. Every mutation must also prove possession of browser-only key material derived from the Master Password. Read-only operations and the `last_used_at` activity path remain session-authenticated because they cannot destroy or replace ciphertext.

## Protocol

The browser retains the existing HKDF-derived auth key in the same in-memory session-key store as the encryption key and clears it whenever the encryption key is cleared. The server already stores only its SCRAM-style stored-key digest. Proof messages use a distinct `key-write:` domain, so login proofs cannot be substituted for write proofs.

Before a Key Entry mutation, the client requests a short-lived challenge (session-authenticated issuance only). The client computes a proof over a canonical message containing the challenge ID, server nonce, HTTP method, normalized API path, and SHA-256 digest of the exact JSON request body. The mutation includes the challenge ID, nonce, and proof in headers. The server atomically consumes the challenge and verifies the proof against the vault's auth stored key, then performs the existing key-version and recovery-state checks. A missing, consumed, expired, wrong-route, or wrong-body proof is rejected with a uniform `401 unauthenticated` (no distinction that would reveal which proof component failed). Challenges are not row-bound to a session id: possession of the auth key is what stops a stolen cookie, and a challenge alone is useless without that key.

## Lifecycle and compatibility

Setup, Master Password change, recovery reset, and legacy enrollment already maintain the auth stored key used by login proofs. Reusing that verifier avoids a migration and preserves the existing upgrade path. A vault cannot be unlocked without deriving the auth key, while a stolen cookie alone does not provide it.

## Error handling

Missing, malformed, expired, consumed, or mismatched proof material all return `401 unauthenticated` with a generic message so the failure mode does not leak which header or digest component was wrong. Existing `key_version_mismatch`, recovery lock, validation, and duplicate-ID behavior remain unchanged after proof verification.

## Testing

Automated tests first demonstrate that session-only create, import, update, and delete fail; valid proofs succeed; replay, payload mutation, and route substitution fail; lifecycle paths replace the verifier; and clearing the encryption key also clears write-proof material. Full typecheck, tests, and build follow. Final user-flow evidence is captured only through screen recording and computer control, with no manual stage annotations or browser-console logging.
