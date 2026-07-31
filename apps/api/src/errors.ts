import type { ApiErrorBody, ApiErrorCode } from "@keypage/shared";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly attemptsRemaining?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Array<{ field: string; message: string }>;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    options?: {
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
      details?: Array<{ field: string; message: string }>;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.attemptsRemaining = options?.attemptsRemaining;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.details = options?.details;
  }
}

export class HttpInvalidRequest extends HttpError {
  constructor(
    message: string,
    details?: Array<{ field: string; message: string }>,
  ) {
    super(400, "invalid_request", message, { details });
  }
}

export class HttpSetupRequired extends HttpError {
  constructor(message = "Vault setup is required") {
    super(409, "setup_required", message);
  }
}

export class HttpVaultAlreadyInitialized extends HttpError {
  constructor(message = "Vault is already initialized") {
    super(409, "vault_already_initialized", message);
  }
}

export class HttpInvalidCredentials extends HttpError {
  constructor(message: string, attemptsRemaining: number) {
    super(401, "invalid_credentials", message, { attemptsRemaining });
  }
}

export class HttpRateLimited extends HttpError {
  constructor(message: string, retryAfterSeconds: number) {
    super(429, "rate_limited", message, { retryAfterSeconds });
  }
}

export class HttpUnauthenticated extends HttpError {
  constructor(message = "Authentication required") {
    super(401, "unauthenticated", message);
  }
}

export class HttpSessionExpired extends HttpError {
  constructor(message = "Session expired") {
    super(401, "session_expired", message);
  }
}

export class HttpInvalidRecoveryCode extends HttpError {
  constructor(message: string, attemptsRemaining: number) {
    super(401, "invalid_recovery_code", message, { attemptsRemaining });
  }
}

export class HttpInvalidRecoveryTicket extends HttpError {
  constructor(message = "Recovery ticket is invalid or expired") {
    super(401, "invalid_recovery_ticket", message);
  }
}

export class HttpInternalError extends HttpError {
  constructor(message = "Internal server error") {
    super(500, "internal_error", message);
  }
}

export function toApiErrorBody(error: unknown): ApiErrorBody {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      error: error.code,
      message: error.message,
    };

    if (error.attemptsRemaining !== undefined) {
      body.attemptsRemaining = error.attemptsRemaining;
    }
    if (error.retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = error.retryAfterSeconds;
    }
    if (error.details !== undefined) {
      body.details = error.details;
    }

    return body;
  }

  return {
    error: "internal_error",
    message: "Internal server error",
  };
}
