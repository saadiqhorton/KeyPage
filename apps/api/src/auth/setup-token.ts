import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { SETUP_TOKEN_PATTERN } from "@keypage/shared";

import { randomToken } from "./tokens.js";

export const SETUP_TOKEN_FILENAME = "setup-token";

export type SetupGate = {
  /** Plaintext token while the vault is unclaimed; null once claimed. */
  readonly token: string | null;
  readonly filePath: string;
  verify(candidate: string): boolean;
  consume(): Promise<void>;
};

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

function permissionErrorMessage(filePath: string): Error {
  return new Error(
    `Cannot write the first-boot setup token at ${filePath}. Check bind-mount ownership and permissions.`,
  );
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function isValidSetupToken(value: string): boolean {
  return new RegExp(SETUP_TOKEN_PATTERN).test(value);
}

export async function openSetupGate(options: {
  dataDir: string;
  vaultInitialized: boolean;
}): Promise<SetupGate> {
  const filePath = path.join(options.dataDir, SETUP_TOKEN_FILENAME);

  if (options.vaultInitialized) {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      if (isPermissionError(error)) {
        throw permissionErrorMessage(filePath);
      }
      throw error;
    }

    return {
      token: null,
      filePath,
      verify: () => false,
      consume: async () => {},
    };
  }

  let tokenValue: string | null;

  try {
    let existing: string | undefined;
    try {
      existing = (await fs.readFile(filePath, "utf8")).trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        if (isPermissionError(error)) {
          throw permissionErrorMessage(filePath);
        }
        throw error;
      }
    }

    if (existing && isValidSetupToken(existing)) {
      tokenValue = existing;
    } else {
      tokenValue = randomToken();
      await fs.writeFile(filePath, `${tokenValue}\n`, { mode: 0o600 });
      await fs.chmod(filePath, 0o600);
    }
  } catch (error) {
    if (isPermissionError(error)) {
      throw permissionErrorMessage(filePath);
    }
    throw error;
  }

  return {
    get token() {
      return tokenValue;
    },
    filePath,
    verify(candidate: string): boolean {
      const current = tokenValue;
      return (
        current !== null &&
        timingSafeEqual(sha256(candidate), sha256(current))
      );
    },
    async consume(): Promise<void> {
      tokenValue = null;
      try {
        await fs.rm(filePath, { force: true });
      } catch (error) {
        if (isPermissionError(error)) {
          throw permissionErrorMessage(filePath);
        }
        throw error;
      }
    },
  };
}
