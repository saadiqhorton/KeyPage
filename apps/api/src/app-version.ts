import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadAppVersion(): string {
  const pkgPath = path.join(packageRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version;
}

/** Release version from @keypage/api package.json, loaded once at process start. */
export const APP_PACKAGE_VERSION = loadAppVersion();

export function readAppVersion(): string {
  return APP_PACKAGE_VERSION;
}
