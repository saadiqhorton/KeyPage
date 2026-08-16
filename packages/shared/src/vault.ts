import type { KeyEntry, KeyEntryCipherPayload } from "./key-entries.js";

export const ARGON2ID_VAULT_PARAMS = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
} as const;

export const ARGON2ID_RECOVERY_PARAMS = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
} as const;

export const PBKDF2_FALLBACK_ITERATIONS = 600_000;
export const KDF_SALT_BYTES = 16;
export const DERIVED_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const HKDF_INFO_ENCRYPTION_KEY = "keypage:v1:encryption-key";
export const HKDF_INFO_AUTH_KEY = "keypage:v1:auth-key";
export const HKDF_INFO_BACKUP_KEY = "keypage:v1:backup-key";
export const BACKUP_AAD_PREFIX = "keypage:v1:backup:";
export const RECOVERY_WRAP_AAD = "keypage:v1:recovery-wrap";
export const RECOVERY_CODE_LOOKUP_PREFIX = "keypage:v1:recovery-code:";
/** Prefix for vault_auth.auth_verifier when login uses stored-key proofs (SAA-170). */
export const AUTH_VERIFIER_PROOF_V1 = "proof:v1";


export const SESSION_COOKIE_NAME = "keypage_session";
export const RECOVERY_CODE_COUNT = 10;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 300;
export const LOGIN_FAILURE_WINDOW_SECONDS = 900;
export const DEFAULT_SESSION_IDLE_MINUTES = 20;
export const SESSION_IDLE_MINUTES_MIN = 15;
export const SESSION_IDLE_MINUTES_MAX = 30;
export const SESSION_IDLE_MINUTES_OPTIONS = [15, 20, 25, 30] as const;
export const MASTER_PASSWORD_MIN_LENGTH = 12;
export const SESSION_ABSOLUTE_HOURS = 12;
export const RECOVERY_TICKET_TTL_SECONDS = 600;

export type ApiErrorCode =
  | "invalid_request"
  | "setup_required"
  | "vault_already_initialized"
  | "invalid_credentials"
  | "rate_limited"
  | "unauthenticated"
  | "session_expired"
  | "invalid_recovery_code"
  | "invalid_recovery_ticket"
  | "key_version_mismatch"
  | "internal_error";

export type ApiErrorBody = {
  error: ApiErrorCode;
  message: string;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
  details?: Array<{ field: string; message: string }>;
};

export type KdfAlgorithm = "argon2id" | "pbkdf2-sha256";

export type KdfParams = {
  algorithm: KdfAlgorithm;
  saltB64: string;
  iterations: number;
  memoryKiB?: number;
  parallelism?: number;
};

export type LockoutState = { locked: boolean; retryAfterSeconds: number };

export type SessionInfo = {
  idleTimeoutSeconds: number;
  absoluteExpiresAt: string;
};

export type RecoveryCodeEnvelope = {
  label: string;
  lookupHash: string;
  kdf: KdfParams;
  wrappedMasterKeyB64: string;
};

export type VaultStatusResponse = {
  state: "setup_required" | "ready";
  kdf: KdfParams | null;
  recoveryCodesRemaining: number;
  keyVersion: number;
  lockout: LockoutState;
  recoveryLockout: LockoutState;
  session: { authenticated: boolean; idleTimeoutSeconds: number };
  /** True once auth_stored_key is enrolled (challenge proofs). False on legacy vaults. */
  proofReady: boolean;
};

export type VaultSetupRequest = {
  kdf: KdfParams;
  /** SHA-256(HMAC(authKey)) hex — authKey never sent (SAA-170). */
  authStoredKeyHex: string;
  /** SHA-256(HMAC(masterKey)) hex — required for recovery reset proofs (SAA-173). */
  recoveryStoredKeyHex: string;
  recoveryCodes: RecoveryCodeEnvelope[];
};

export type VaultSetupResponse = {
  state: "ready";
  keyVersion: number;
  session: SessionInfo;
};

export type VaultLoginChallengeResponse = {
  challengeId: string;
  nonceB64: string;
  expiresAt: string;
};

export type VaultLoginProofRequest = {
  challengeId: string;
  nonceB64: string;
  clientProofB64: string;
};

/** One-shot enroll for pre-proof vaults (SAA-177). Rejected once proofReady. */
export type VaultLoginEnrollRequest = {
  authKeyB64: string;
};

export type VaultLoginRequest = VaultLoginProofRequest | VaultLoginEnrollRequest;
export type VaultLoginResponse = { keyVersion: number; session: SessionInfo };

export type VaultSessionResponse = {
  authenticated: boolean;
  idleTimeoutSeconds: number;
  idleSecondsRemaining: number;
  absoluteExpiresAt: string | null;
};

export type RecoveryClaimRequest = { lookupHash: string };
export type RecoveryClaimResponse = {
  recoveryTicket: string;
  /** Server nonce; client must prove masterKey possession over ticket+nonce at reset. */
  challengeNonceB64: string;
  kdf: KdfParams;
  wrappedMasterKeyB64: string;
  keyVersion: number;
  codesRemaining: number;
  /** Opaque Key Entry ciphertexts so the client can re-encrypt without a session. */
  entries: KeyEntry[];
};

export type RecoveryCancelRequest = {
  recoveryTicket: string;
};

export type RecoveryResetRequest = {
  recoveryTicket: string;
  /** Required when the ticket was minted with a challenge nonce. */
  challengeNonceB64?: string;
  /** Proof of unwrapped masterKey (SAA-173). Omitted only for pre-proof vaults. */
  recoveryClientProofB64?: string;
  kdf: KdfParams;
  authStoredKeyHex: string;
  recoveryStoredKeyHex: string;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedKeyEntry[];
};

export type RecoveryResetResponse = {
  state: "ready";
  keyVersion: number;
  reEncrypted: number;
  session: SessionInfo;
};

export type ReencryptedKeyEntry = {
  id: string;
  /** `ivB64` of the ciphertext this re-encryption replaces (optimistic concurrency token). */
  baseIvB64: string;
  /** No `keyVersion`: rotation mints the next version server-side, in the same transaction. */
  cipher: KeyEntryCipherPayload;
};

export type VaultPasswordChangeRequest = {
  challengeId: string;
  nonceB64: string;
  /** Proof of current authKey via login challenge (SAA-170). */
  currentClientProofB64: string;
  kdf: KdfParams;
  authStoredKeyHex: string;
  recoveryStoredKeyHex: string;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedKeyEntry[];
};

export type VaultPasswordChangeResponse = {
  state: "ready";
  keyVersion: number;
  reEncrypted: number;
  session: SessionInfo;
};

export type RecoveryCodesRegenerateRequest = {
  challengeId: string;
  nonceB64: string;
  clientProofB64: string;
  /** Vault key version the envelopes wrap, so a rotation mid-request is rejected. */
  keyVersion: number;
  recoveryCodes: RecoveryCodeEnvelope[];
};

export type RecoveryCodesRegenerateResponse = {
  recoveryCodesRemaining: number;
  keyVersion: number;
};

export type IdleTimeoutSource = "env" | "database" | "default";

export type AppSettingsResponse = {
  sessionIdleMinutes: number;
  sessionIdleSource: IdleTimeoutSource;
  clipboardClearSeconds: number;
};

export type AppSettingsUpdateRequest = {
  sessionIdleMinutes: number;
};
