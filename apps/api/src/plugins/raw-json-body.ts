import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact JSON request body bytes as received on the wire (for write-proof digests). */
    rawBody?: string;
  }
}

export function registerRawJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = raw;

      if (raw === "" || raw.trim() === "") {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
}
