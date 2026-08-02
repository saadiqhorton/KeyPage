import type Database from "better-sqlite3";
import type { FastifyPluginAsync } from "fastify";

import {
  SESSION_IDLE_MINUTES_MAX,
  SESSION_IDLE_MINUTES_MIN,
  SESSION_IDLE_MINUTES_OPTIONS,
  type AppSettingsResponse,
  type AppSettingsUpdateRequest,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";
import { checkOrigin } from "../plugins/check-origin.js";
import { createRequireSession } from "../plugins/require-session.js";
import {
  describeIdleTimeout,
  isIdleMinutesInBand,
  resolveClipboardClearSeconds,
  resolveIdleTimeoutSeconds,
  writeIdleTimeoutSetting,
} from "../settings.js";

export type SettingsRouteOptions = {
  db: Database.Database;
};

function buildAppSettingsResponse(db: Database.Database): AppSettingsResponse {
  const { minutes, source } = describeIdleTimeout(db);
  return {
    sessionIdleMinutes: minutes,
    sessionIdleSource: source,
    clipboardClearSeconds: resolveClipboardClearSeconds(db),
  };
}

export const settingsRoutes: FastifyPluginAsync<SettingsRouteOptions> = async (
  app,
  options,
) => {
  const { db } = options;
  const requireSession = createRequireSession(db, () =>
    resolveIdleTimeoutSeconds(db),
  );

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get(
    "/",
    {
      preHandler: [checkOrigin, requireSession],
    },
    async (): Promise<AppSettingsResponse> => buildAppSettingsResponse(db),
  );

  app.patch(
    "/",
    {
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: ["sessionIdleMinutes"],
          properties: {
            sessionIdleMinutes: { type: "number" },
          },
        },
      },
    },
    async (request): Promise<AppSettingsResponse> => {
      const body = request.body as AppSettingsUpdateRequest;

      if (!isIdleMinutesInBand(body.sessionIdleMinutes)) {
        throw new HttpInvalidRequest("Invalid sessionIdleMinutes", [
          {
            field: "sessionIdleMinutes",
            message: `must be one of ${SESSION_IDLE_MINUTES_OPTIONS.join(", ")} (${SESSION_IDLE_MINUTES_MIN}–${SESSION_IDLE_MINUTES_MAX})`,
          },
        ]);
      }

      writeIdleTimeoutSetting(db, body.sessionIdleMinutes);
      return buildAppSettingsResponse(db);
    },
  );
};
