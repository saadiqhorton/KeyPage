import type {
  ApiErrorBody,
  ApiErrorCode,
  AppSettingsResponse,
  AppSettingsUpdateRequest,
  KeyEntryCreateRequest,
  KeyEntryCreateResponse,
  KeyEntryDeleteRequest,
  KeyEntryUpdateRequest,
  KeyEntryUpdateResponse,
  KeyEntryImportRequest,
  KeyEntryImportResponse,
  KeyEntryListResponse,
  KeyEntryUseAction,
  KeyEntryUseResponse,
  RecoveryCancelRequest,
  RecoveryClaimRequest,
  RecoveryClaimResponse,
  RecoveryCodesRegenerateRequest,
  RecoveryCodesRegenerateResponse,
  RecoveryResetRequest,
  RecoveryResetResponse,
  VaultPasswordChangeRequest,
  VaultPasswordChangeResponse,
  VaultLoginChallengeResponse,
  VaultLoginRequest,
  VaultLoginResponse,
  VaultSessionResponse,
  VaultSetupRequest,
  VaultSetupResponse,
  VaultStatusResponse,
} from "@keypage/shared";

import {
  base64Encode,
  createLoginClientProof,
  keyEntryWriteAuthMessage,
} from "@keypage/shared";

import { loginClientProofB64 } from "@/crypto/auth-proof.js";
import { getAuthProofKey } from "@/vault/session-keys.js";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.error;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch {
    throw new ApiError({
      error: "internal_error",
      message: "Unable to reach the KeyPage server.",
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError({
        error: "internal_error",
        message: "The server returned an invalid response.",
      });
    }
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    if (errorBody?.error && errorBody?.message) {
      throw new ApiError(errorBody);
    }
    throw new ApiError({
      error: "internal_error",
      message: `Request failed with status ${response.status}.`,
    });
  }

  return body as T;
}

export function getVaultStatus(): Promise<VaultStatusResponse> {
  return apiFetch<VaultStatusResponse>("/api/vault/status");
}

export function postVaultSetup(
  body: VaultSetupRequest,
): Promise<VaultSetupResponse> {
  return apiFetch<VaultSetupResponse>("/api/vault/setup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postVaultLoginChallenge(): Promise<VaultLoginChallengeResponse> {
  return apiFetch<VaultLoginChallengeResponse>("/api/vault/login/challenge", {
    method: "POST",
  });
}

export function postVaultLogin(
  body: VaultLoginRequest,
): Promise<VaultLoginResponse> {
  return apiFetch<VaultLoginResponse>("/api/vault/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postVaultLoginWithAuthKey(
  authKeyB64: string,
): Promise<VaultLoginResponse> {
  const challenge = await postVaultLoginChallenge();
  return postVaultLogin({
    challengeId: challenge.challengeId,
    nonceB64: challenge.nonceB64,
    clientProofB64: loginClientProofB64(
      authKeyB64,
      challenge.challengeId,
      challenge.nonceB64,
    ),
  });
}

export function getVaultSession(): Promise<VaultSessionResponse> {
  return apiFetch<VaultSessionResponse>("/api/vault/session");
}

export function postVaultSessionTouch(): Promise<void> {
  return apiFetch<void>("/api/vault/session/touch", { method: "POST" });
}

export function postVaultLock(): Promise<void> {
  return apiFetch<void>("/api/vault/lock", { method: "POST" });
}

export function postRecoveryClaim(
  body: RecoveryClaimRequest,
): Promise<RecoveryClaimResponse> {
  return apiFetch<RecoveryClaimResponse>("/api/vault/recovery/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postRecoveryCancel(
  body: RecoveryCancelRequest,
): Promise<void> {
  return apiFetch<void>("/api/vault/recovery/cancel", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postRecoveryReset(
  body: RecoveryResetRequest,
): Promise<RecoveryResetResponse> {
  return apiFetch<RecoveryResetResponse>("/api/vault/recovery/reset", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getKeyEntries(): Promise<KeyEntryListResponse> {
  return apiFetch<KeyEntryListResponse>("/api/keys");
}

async function keyEntryWrite<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<T> {
  const authKey = getAuthProofKey();
  if (!authKey) {
    throw new ApiError({
      error: "session_expired",
      message: "Vault is locked.",
    });
  }
  const challenge = await apiFetch<{ challengeId: string; nonceB64: string }>(
    "/api/keys/challenge",
    { method: "POST" },
  );
  const bodyJson = JSON.stringify(body);
  const message = keyEntryWriteAuthMessage({
    ...challenge,
    method,
    path,
    bodyJson,
  });
  const proof = createLoginClientProof(authKey, message);
  try {
    return await apiFetch<T>(path, {
      method,
      headers: {
        "x-keypage-write-challenge": challenge.challengeId,
        "x-keypage-write-nonce": challenge.nonceB64,
        "x-keypage-write-proof": base64Encode(proof),
      },
      body: bodyJson,
    });
  } finally {
    proof.fill(0);
  }
}

export function postKeyEntry(
  body: KeyEntryCreateRequest,
): Promise<KeyEntryCreateResponse> {
  return keyEntryWrite<KeyEntryCreateResponse>("/api/keys", "POST", body);
}

export function postKeyEntryUse(
  id: string,
  action: KeyEntryUseAction,
): Promise<KeyEntryUseResponse> {
  return apiFetch<KeyEntryUseResponse>(
    `/api/keys/${encodeURIComponent(id)}/use`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
    },
  );
}

export function patchKeyEntry(
  id: string,
  body: KeyEntryUpdateRequest,
): Promise<KeyEntryUpdateResponse> {
  const path = `/api/keys/${encodeURIComponent(id)}`;
  return keyEntryWrite<KeyEntryUpdateResponse>(
    path,
    "PATCH",
    body,
  );
}

export function deleteKeyEntry(
  id: string,
  body: KeyEntryDeleteRequest,
): Promise<void> {
  const path = `/api/keys/${encodeURIComponent(id)}`;
  return keyEntryWrite<void>(path, "DELETE", body);
}

export function postKeyEntryImport(
  body: KeyEntryImportRequest,
): Promise<KeyEntryImportResponse> {
  return keyEntryWrite<KeyEntryImportResponse>(
    "/api/keys/import",
    "POST",
    body,
  );
}

export function postVaultPasswordChange(
  body: VaultPasswordChangeRequest,
): Promise<VaultPasswordChangeResponse> {
  return apiFetch<VaultPasswordChangeResponse>("/api/vault/password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postRecoveryCodesRegenerate(
  body: RecoveryCodesRegenerateRequest,
): Promise<RecoveryCodesRegenerateResponse> {
  return apiFetch<RecoveryCodesRegenerateResponse>("/api/vault/recovery-codes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getAppSettings(): Promise<AppSettingsResponse> {
  return apiFetch<AppSettingsResponse>("/api/settings");
}

export function patchAppSettings(
  body: AppSettingsUpdateRequest,
): Promise<AppSettingsResponse> {
  return apiFetch<AppSettingsResponse>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
