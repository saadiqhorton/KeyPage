import { API_BASE, APP_NAME, type HealthResponse } from "@keypage/shared";
import type { FastifyPluginAsync } from "fastify";

import { APP_PACKAGE_VERSION } from "../app-version.js";
import type { InstanceRecord } from "../data-dir.js";

export type HealthRouteOptions = {
  dataDir: string;
  instance: InstanceRecord;
};

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  options,
) => {
  app.get(`${API_BASE}/health`, async (): Promise<HealthResponse> => ({
    status: "ok",
    app: APP_NAME,
    version: APP_PACKAGE_VERSION,
    dataDir: options.dataDir,
    firstBootAt: options.instance.firstBootAt,
  }));
};
