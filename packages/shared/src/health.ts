/** JSON `status` on `GET /api/health` when the process is up. */
export const HEALTH_STATUS_OK = "ok" as const;

export type HealthResponse = {
  status: typeof HEALTH_STATUS_OK;
  app: string;
  version: string;
  dataDir: string;
  firstBootAt: string;
};
