import type Database from "better-sqlite3";
import type { FastifyPluginAsync } from "fastify";

import {
  SESSION_IDLE_MINUTES_OPTIONS,
  type AppSettingsResponse,
  type AppSettingsUpdateRequest,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";
import { checkOrigin } from "../plugins/check-origin.js";
import { createRequireSession } from "../plugins/require-session.js";
import {
  describeIdleTimeout,
  isIdleMinutesOption,
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

      if (!isIdleMinutesOption(body.sessionIdleMinutes)) {
        throw new HttpInvalidRequest("Invalid sessionIdleMinutes", [
          {
            field: "sessionIdleMinutes",
            message: `must be one of ${SESSION_IDLE_MINUTES_OPTIONS.join(", ")}`,
          },
        ]);
      }

      // A stored value would be silently ignored while the env var is set, so
      // refuse rather than report a save that has no effect.
      if (describeIdleTimeout(db).source === "env") {
        throw new HttpInvalidRequest("Session timeout is set by the server", [
          {
            field: "sessionIdleMinutes",
            message:
              "KEYPAGE_SESSION_IDLE_MINUTES is set on the server; unset it to change the timeout here",
          },
        ]);
      }

      writeIdleTimeoutSetting(db, body.sessionIdleMinutes);
      return buildAppSettingsResponse(db);
    },
  );
};
