import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "../config.js";

export function requestHostForOriginCheck(
  request: FastifyRequest,
): string | undefined {
  if (config.trustProxy) {
    const forwarded = request.headers["x-forwarded-host"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0]?.trim();
    }
  }
  return request.headers.host;
}

export async function checkOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  const host = requestHostForOriginCheck(request);
  if (!host) {
    return;
  }

  try {
    if (new URL(origin).host !== host) {
      await reply.status(403).send({
        error: "invalid_request",
        message: "Forbidden",
      });
      return;
    }
  } catch {
    await reply.status(403).send({
      error: "invalid_request",
      message: "Forbidden",
    });
    return;
  }
}
