import { SESSION_COOKIE_NAME } from "@keypage/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  token: string,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    secure: request.protocol === "https",
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    ...COOKIE_OPTIONS,
    secure: request.protocol === "https",
  });
}
