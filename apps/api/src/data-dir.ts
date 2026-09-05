import fs from "node:fs/promises";
import path from "node:path";

export const DATA_DIR_SCHEMA_VERSION = 1;

export type InstanceRecord = {
  firstBootAt: string;
  schemaVersion: number;
};

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function permissionErrorMessage(dir: string, action: string): Error {
  return new Error(
    `Cannot ${action} data directory at ${dir}. Check bind-mount ownership and permissions.`,
  );
}

async function mkdirDataDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (isPermissionError(error)) {
      throw permissionErrorMessage(dir, "create");
    }
    throw error;
  }
}

async function writeInstanceFile(
  dir: string,
  instancePath: string,
  record: InstanceRecord,
): Promise<void> {
  try {
    await fs.writeFile(
      instancePath,
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  } catch (writeError) {
    if (isPermissionError(writeError)) {
      throw permissionErrorMessage(dir, "write to");
    }
    throw writeError;
  }
}

async function createInstanceRecord(
  dir: string,
  instancePath: string,
): Promise<InstanceRecord> {
  const record: InstanceRecord = {
    firstBootAt: new Date().toISOString(),
    schemaVersion: DATA_DIR_SCHEMA_VERSION,
  };
  await writeInstanceFile(dir, instancePath, record);
  return record;
}

async function maybeUpgradeRecord(
  dir: string,
  instancePath: string,
  record: InstanceRecord,
): Promise<InstanceRecord> {
  if (record.schemaVersion >= DATA_DIR_SCHEMA_VERSION) {
    return record;
  }

  const upgraded: InstanceRecord = {
    ...record,
    schemaVersion: DATA_DIR_SCHEMA_VERSION,
  };
  await writeInstanceFile(dir, instancePath, upgraded);
  return upgraded;
}

async function readOrCreateInstance(
  dir: string,
  instancePath: string,
): Promise<InstanceRecord> {
  try {
    const raw = await fs.readFile(instancePath, "utf8");
    const record = JSON.parse(raw) as InstanceRecord;
    return maybeUpgradeRecord(dir, instancePath, record);
  } catch (error) {
    if (isMissingFile(error)) {
      return createInstanceRecord(dir, instancePath);
    }
    if (isPermissionError(error)) {
      throw permissionErrorMessage(dir, "read from");
    }
    throw error;
  }
}

export async function ensureDataDir(dir: string): Promise<InstanceRecord> {
  const instancePath = path.join(dir, "instance.json");
  await mkdirDataDir(dir);
  return readOrCreateInstance(dir, instancePath);
}
