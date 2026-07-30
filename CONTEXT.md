# API Key Manager — Context

## Scope
A self-hosted, single-user dashboard for securely storing and retrieving API keys.
Open source project — each deployment is single-user, but the code is public for others to self-host.

## Glossary

| Term | Definition |
|------|-----------|
| API Key | A secret token issued by a third-party service (e.g. OpenAI, AWS, Stripe) used to authenticate API requests. |
| Dashboard | The web-based UI the user interacts with to manage their keys. |
| Master Password | The single password the user enters on login, used to derive the encryption key. |
| Encryption at Rest | All API keys are encrypted in the database using AES-256-GCM. The encryption key is derived from the master password via Argon2id. |
| Service | The third-party provider that issued the API key (e.g. OpenAI, AWS, Stripe). Known services come from a curated catalog with stable IDs and icons; unknown ones use a Custom entry. |
| Service Catalog | A predefined list of common providers (stable IDs, display names, icons/colors) used when creating or displaying a Key Entry. Includes a Custom option for anything not listed. |
| Key Entry | A stored record containing an encrypted API key plus its metadata (label, service, description, tags, timestamps). |
| Provider Integration | A future capability where the system communicates with a Service to automatically refresh, rotate, or update stored API keys. |
| Activity Event | A recorded action on a Key Entry (created, edited, deleted, revealed, copied) with a timestamp. Contains no plaintext secrets. |

## Security Model
- General security best practices for API key storage and management
- Client-side encryption: master password never leaves the browser
- Keys encrypted/decrypted in the browser via Web Crypto API (AES-256-GCM)
- Encryption key derived client-side via Argon2id (or Web Crypto PBKDF2 fallback)
- Server stores only ciphertext, metadata, and a password verification hash
- Session-based authentication with inactivity timeout (15-30 minutes)
- Keys decrypted on-demand in the browser for viewing/copying
- Prefer HTTPS when exposed beyond LAN (Cloudflare Tunnel covers this)
- Clipboard auto-clear after configurable timeout (default 30s)
- Password recovery via multiple alphanumeric codes (8-10 codes, any one can be used)
- Login rate limiting: after N failed attempts (e.g. 5), lock login for a few minutes

## Encryption Boundary
- Encryption happens in the browser, not on the server
- Server never sees plaintext API keys or the master password
- Future provider integrations may need a separate server-held credential model


## Dashboard Layout
- User-toggleable views: Card Grid, Table, List
- Default view on first login: Card Grid
- View preference persisted (localStorage or server)
- Search bar and tag filter chips shared across all views
- Empty state: guided center message ("Add your first API key") with primary CTA — no suggested-provider cards in v1

## Add Key Flow
- Form modal triggered by "Add Key" button
- Fields: label, service, description, tags, key value
- Animated modal entrance/exit (spring physics)
- Visually polished (high-end premium design, tasteful motion)
- Design skills: high-end-visual-design, find-animation-opportunities, design-taste-frontend

## Edit & Delete
- Row-level kebab menu with "Edit" and "Delete" actions
- Edit opens the same modal pre-filled with existing data
- Delete requires confirmation modal
- Future: bulk select with toolbar for batch operations

## Responsive Design
- Desktop-first (1024px+) for v1
- Mobile gets a basic stacked fallback, not a polished mobile UX
- Proper mobile layout deferred to a later version

## Key Visibility UX
- Keys masked by default (••••••••••••)
- Eye icon to temporarily reveal the key value
- Copy button to copy key to clipboard
- Copy confirmation toast
- Clipboard auto-clears after timeout

## First-Time Setup
- Setup wizard shown when database is empty
- User creates master password via UI
- Verification hash stored so login can be checked without keeping the password
- Encryption key derived and held only in the browser for the session
- Recovery codes generated and downloaded during setup

## Change Master Password
- Settings page supports changing the master password
- Requires current password + new password confirmation
- Client re-encrypts all Key Entries with the new encryption key
- Verification hash updated; recovery codes regenerated and re-downloaded

## Technology Stack
- **Frontend:** React + TypeScript, shadcn/ui, Tailwind CSS
- **Backend:** Node.js + Fastify (TypeScript)
- **Database:** SQLite (file-based, no separate server needed)
- **Deployment:** Docker (single container, SQLite volume mount); remote access via Cloudflare Tunnel

## Deployment & Access
- Docker single container with SQLite volume mount
- Local LAN: plain HTTP to the container port is fine
- Remote access: Cloudflare Tunnel (user's existing pattern) — Tunnel handles HTTPS at Cloudflare's edge
- App itself does not manage TLS certificates
- Reverse proxy optional; not required for v1


## Import/Export
- Encrypted backup file (encrypted with master password)
- Export all keys + metadata to single encrypted file
- Import requires master password to decrypt
- Plain text export can be added later if needed

## Key Entry Metadata
Each stored key carries: label, service name, description, tags, creation date, last used timestamp.
Future: expiration date, refresh token (encrypted), provider-specific config — to support Provider Integrations.

## Activity Log
- Basic activity events recorded for create, edit, delete, reveal, and copy
- Timestamps only — never stores plaintext keys
- No dedicated history UI in v1 (data stored for future use)
- "Last used" on a Key Entry updates when the key is revealed or copied
