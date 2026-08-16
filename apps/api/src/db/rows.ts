import type { KdfAlgorithm } from "@keypage/shared";

export type ThrottleScope = "login" | "recovery";

/** The kdf_* columns shared by `vault_auth` and `recovery_codes`. */
export type KdfColumns = {
  kdf_algorithm: KdfAlgorithm;
  kdf_memory_kib: number | null;
  kdf_iterations: number;
  kdf_parallelism: number | null;
  kdf_salt: string;
};

export type VaultAuthRow = KdfColumns & {
  id: 1;
  auth_verifier: string;
  auth_stored_key: string | null;
  recovery_stored_key: string | null;
  key_version: number;
  created_at: string;
  updated_at: string;
};

export type RecoveryCodeRow = KdfColumns & {
  id: string;
  label: string;
  lookup_hash: string;
  wrapped_master_key: string;
  key_version: number;
  created_at: string;
  used_at: string | null;
};

export type SessionRow = {
  id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
};

export type RecoveryTicketRow = {
  id: string;
  token_hash: string;
  recovery_code_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  challenge_nonce: string | null;
};

export type LoginChallengeRow = {
  id: string;
  nonce_b64: string;
  created_at: string;
  expires_at: string;
};

export type AuthThrottleRow = {
  scope: ThrottleScope;
  failed_count: number;
  first_failed_at: string | null;
  last_failed_at: string | null;
  locked_until: string | null;
  lockout_count: number;
};

export type AppSettingRow = {
  key: string;
  value: string;
  updated_at: string;
};

export type KeyEntryRow = {
  id: string;
  label: string;
  service_id: string;
  custom_service_name: string | null;
  description: string | null;
  tags_json: string;
  cipher_algorithm: "aes-256-gcm";
  cipher_iv: string;
  cipher_text: string;
  key_version: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type ActivityEventRow = {
  id: string;
  key_entry_id: string;
  action: "created" | "edited" | "deleted" | "revealed" | "copied";
  occurred_at: string;
};
