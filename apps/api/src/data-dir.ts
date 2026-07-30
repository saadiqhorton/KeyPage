import fs from "node:fs/promises";
import path from "node:path";

export type InstanceRecord = {
  firstBootAt: string;
  schemaVersion: 0;
};

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

function permissionErrorMessage(dir: string, action: string): Error {
  return new Error(
    `Cannot ${action} data directory at ${dir}. Check bind-mount ownership and permissions.`,
  );
}

export async function ensureDataDir(dir: string): Promise<InstanceRecord> {
  const instancePath = path.join(dir, "instance.json");

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (isPermissionError(error)) {
      throw permissionErrorMessage(dir, "create");
    }
    throw error;
  }

  try {
    const raw = await fs.readFile(instancePath, "utf8");
    return JSON.parse(raw) as InstanceRecord;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      const record: InstanceRecord = {
        firstBootAt: new Date().toISOString(),
        schemaVersion: 0,
      };

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

      return record;
    }

    if (isPermissionError(error)) {
      throw permissionErrorMessage(dir, "read from");
    }

    throw error;
  }
}
