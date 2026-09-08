import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function readAppVersion(): string {
  const pkgPath = path.join(packageRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version;
}
