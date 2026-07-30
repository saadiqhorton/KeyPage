import { argon2id } from "hash-wasm";

let wasmProbeResult: boolean | null = null;

export async function probeArgon2Wasm(): Promise<boolean> {
  if (wasmProbeResult !== null) {
    return wasmProbeResult;
  }
  try {
    await argon2id({
      password: "probe",
      salt: new Uint8Array(16),
      iterations: 1,
      parallelism: 1,
      memorySize: 1024,
      hashLength: 32,
      outputType: "binary",
    });
    wasmProbeResult = true;
  } catch {
    wasmProbeResult = false;
  }
  return wasmProbeResult;
}

export async function argon2idDerive(options: {
  password: string;
  salt: Uint8Array;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashLength?: number;
}): Promise<Uint8Array> {
  return argon2id({
    password: options.password,
    salt: options.salt,
    memorySize: options.memoryKiB,
    iterations: options.iterations,
    parallelism: options.parallelism,
    hashLength: options.hashLength ?? 32,
    outputType: "binary",
  });
}
