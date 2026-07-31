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
export const RECOVERY_WRAP_AAD = "keypage:v1:recovery-wrap";
export const RECOVERY_CODE_LOOKUP_PREFIX = "keypage:v1:recovery-code:";

export const SESSION_COOKIE_NAME = "keypage_session";
export const RECOVERY_CODE_COUNT = 10;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 300;
export const LOGIN_FAILURE_WINDOW_SECONDS = 900;
export const DEFAULT_SESSION_IDLE_MINUTES = 20;
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
};

export type VaultSetupRequest = {
  kdf: KdfParams;
  authKeyB64: string;
  recoveryCodes: RecoveryCodeEnvelope[];
};

export type VaultSetupResponse = { state: "ready"; session: SessionInfo };

export type VaultLoginRequest = { authKeyB64: string };
export type VaultLoginResponse = { session: SessionInfo };

export type VaultSessionResponse = {
  authenticated: boolean;
  idleTimeoutSeconds: number;
  idleSecondsRemaining: number;
  absoluteExpiresAt: string | null;
};

export type RecoveryClaimRequest = { lookupHash: string };
export type RecoveryClaimResponse = {
  recoveryTicket: string;
  kdf: KdfParams;
  wrappedMasterKeyB64: string;
  keyVersion: number;
  codesRemaining: number;
};

export type RecoveryResetRequest = {
  recoveryTicket: string;
  kdf: KdfParams;
  authKeyB64: string;
  recoveryCodes: RecoveryCodeEnvelope[];
};

export type RecoveryResetResponse = { state: "ready"; session: SessionInfo };
