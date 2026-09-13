import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function forbidden(reply: FastifyReply): void {
  void reply.status(403).send({ error: "invalid_request", message: "Forbidden" });
}

export function createCheckOrigin(publicOrigin?: string) {
  return async function checkOrigin(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const origin = request.headers.origin;
    if (SAFE_METHODS.has(request.method) && !origin) return;
    if (!origin && publicOrigin) {
      forbidden(reply);
      return;
    }
    if (!origin) return;
    try {
      const expected = publicOrigin ?? `${request.protocol}://${request.host}`;
      if (new URL(origin).origin !== new URL(expected).origin) forbidden(reply);
    } catch {
      forbidden(reply);
    }
  };
}

export const checkOrigin = createCheckOrigin();
