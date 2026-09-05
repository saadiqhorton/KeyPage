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

function rethrowPermission(error: unknown, filePath: string): never {
  if (isPermissionError(error)) {
    throw permissionErrorMessage(filePath);
  }
  throw error;
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function isValidSetupToken(value: string): boolean {
  return new RegExp(SETUP_TOKEN_PATTERN).test(value);
}

async function removeSetupTokenFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    rethrowPermission(error, filePath);
  }
}

function claimedGate(filePath: string): SetupGate {
  return {
    token: null,
    filePath,
    verify: () => false,
    consume: async () => {},
  };
}

async function readExistingToken(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(filePath, "utf8")).trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    rethrowPermission(error, filePath);
  }
}

async function mintToken(filePath: string): Promise<string> {
  const tokenValue = randomToken();
  await fs.writeFile(filePath, `${tokenValue}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
  return tokenValue;
}

async function loadOrMintToken(filePath: string): Promise<string> {
  try {
    const existing = await readExistingToken(filePath);
    if (existing && isValidSetupToken(existing)) {
      return existing;
    }
    return mintToken(filePath);
  } catch (error) {
    rethrowPermission(error, filePath);
  }
}

function liveGate(filePath: string, tokenRef: { value: string | null }): SetupGate {
  return {
    get token() {
      return tokenRef.value;
    },
    filePath,
    verify(candidate: string): boolean {
      const current = tokenRef.value;
      return current !== null && timingSafeEqual(sha256(candidate), sha256(current));
    },
    async consume(): Promise<void> {
      tokenRef.value = null;
      await removeSetupTokenFile(filePath);
    },
  };
}

export async function openSetupGate(options: {
  dataDir: string;
  vaultInitialized: boolean;
}): Promise<SetupGate> {
  const filePath = path.join(options.dataDir, SETUP_TOKEN_FILENAME);

  if (options.vaultInitialized) {
    await removeSetupTokenFile(filePath);
    return claimedGate(filePath);
  }

  const tokenRef: { value: string | null } = {
    value: await loadOrMintToken(filePath),
  };
  return liveGate(filePath, tokenRef);
}
