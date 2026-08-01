# Encrypted backup format (keypage-backup v1)

Backups store all key entries and metadata inside one encrypted envelope rather than reusing each entry's vault ciphertext.

## Decision

Use a **plaintext-inside-envelope** backup payload: export decrypts every entry with the vault encryption key, builds a JSON payload with plaintext `keyValue` fields, then encrypts that payload with a **separate backup KDF** (independent salt and HKDF info `keypage:v1:backup-key`). The on-disk file is cleartext header + one AES-GCM blob (AAD `keypage:v1:backup:1`).

## Rationale

A fresh KeyPage instance has a different vault encryption key. Re-exporting opaque per-entry ciphers would be useless on restore. Plaintext inside a password-protected envelope lets import re-encrypt entries for the new vault while keeping merge-by-ID semantics.

## Trade-offs

- The backup file is a single point of failure: anyone with the backup file and Master Password gets every key at once.
- Export briefly holds all plaintext keys in browser memory (same as viewing every entry).
- Independent backup KDF means the backup password can differ from the vault Master Password on import (by design for cross-instance restore).
