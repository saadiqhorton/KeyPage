# Client-side encryption for API keys

API keys are encrypted and decrypted in the browser (Web Crypto API + Argon2id/PBKDF2). The server stores only ciphertext, metadata, and a password verification hash — it never sees plaintext keys or the master password.

We chose this over server-side encryption so a compromised container or stolen SQLite file still yields only ciphertext. The trade-off is that future server-side provider auto-refresh will need a separate credential model, since the server cannot decrypt vault secrets itself.
