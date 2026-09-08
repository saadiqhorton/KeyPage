export const APP_NAME = "KeyPage";
export const APP_TAGLINE = "Self-hosted API key vault";
export const API_BASE = "/api";
/**
 * Default HTTP listen port (`PORT` env).
 * Packaging/docs that cannot import this file (`.env.example`, Docker,
 * compose, `install.sh`) keep the same numeric default; `app.test.ts`
 * asserts they stay aligned.
 */
export const DEFAULT_LISTEN_PORT = 9090;
/** Default bind address (`HOST` env). */
export const DEFAULT_LISTEN_HOST = "0.0.0.0";
/** JSON `error` for unknown `/api/*` routes (not an `ApiErrorCode`). */
export const API_NOT_FOUND_ERROR = "Not Found";
