import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadPackageVersion(): string {
  const pkgPath = path.join(packageRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version;
}

function loadImageVersion(): string | undefined {
  try {
    return fs.readFileSync(path.join(packageRoot, ".keypage-version"), "utf8");
  } catch {
    return undefined;
  }
}

export function resolveAppVersion(
  packageVersion: string,
  configuredVersion = process.env.KEYPAGE_VERSION,
  imageVersion = loadImageVersion(),
): string {
  const baked = imageVersion?.trim();
  const trimmed = configuredVersion?.trim();
  return baked || trimmed || packageVersion;
}

/** Release version from baked image metadata, falling back to env/package in dev. */
export const APP_PACKAGE_VERSION = resolveAppVersion(loadPackageVersion());

export function readAppVersion(): string {
  return APP_PACKAGE_VERSION;
}
