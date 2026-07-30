import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.KEYPAGE_DATA_DIR ?? "./data"),
  webDir: path.resolve(
    process.env.KEYPAGE_WEB_DIR ?? path.join(packageRoot, "../web/dist"),
  ),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
