import type { KdfAlgorithm } from "@keypage/shared";

export type ThrottleScope = "login" | "recovery";

export type VaultAuthRow = {
  id: 1;
  kdf_algorithm: KdfAlgorithm;
  kdf_memory_kib: number | null;
  kdf_iterations: number;
  kdf_parallelism: number | null;
  kdf_salt: string;
  auth_verifier: string;
  key_version: number;
  created_at: string;
  updated_at: string;
};

export type RecoveryCodeRow = {
  id: string;
  label: string;
  lookup_hash: string;
  kdf_algorithm: KdfAlgorithm;
  kdf_memory_kib: number | null;
  kdf_iterations: number;
  kdf_parallelism: number | null;
  kdf_salt: string;
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
