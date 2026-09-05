import { APP_NAME, APP_VERSION, type HealthResponse } from "@keypage/shared";
import type { FastifyPluginAsync } from "fastify";

import type { InstanceRecord } from "../data-dir.js";

export type HealthRouteOptions = {
  dataDir: string;
  instance: InstanceRecord;
};

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  options,
) => {
  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    app: APP_NAME,
    version: APP_VERSION,
    dataDir: options.dataDir,
    firstBootAt: options.instance.firstBootAt,
  }));
};
