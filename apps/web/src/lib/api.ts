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
  RecoveryClaimRequest,
  RecoveryClaimResponse,
  RecoveryCodesRegenerateRequest,
  RecoveryCodesRegenerateResponse,
  RecoveryResetRequest,
  RecoveryResetResponse,
  VaultPasswordChangeRequest,
  VaultPasswordChangeResponse,
  VaultLoginRequest,
  VaultLoginResponse,
  VaultSessionResponse,
  VaultSetupRequest,
  VaultSetupResponse,
  VaultStatusResponse,
} from "@keypage/shared";

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

export function postVaultLogin(
  body: VaultLoginRequest,
): Promise<VaultLoginResponse> {
  return apiFetch<VaultLoginResponse>("/api/vault/login", {
    method: "POST",
    body: JSON.stringify(body),
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

export function postKeyEntry(
  body: KeyEntryCreateRequest,
): Promise<KeyEntryCreateResponse> {
  return apiFetch<KeyEntryCreateResponse>("/api/keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
  return apiFetch<KeyEntryUpdateResponse>(
    `/api/keys/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

export function deleteKeyEntry(
  id: string,
  body: KeyEntryDeleteRequest,
): Promise<void> {
  return apiFetch<void>(`/api/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

export function postKeyEntryImport(
  body: KeyEntryImportRequest,
): Promise<KeyEntryImportResponse> {
  return apiFetch<KeyEntryImportResponse>("/api/keys/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
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
