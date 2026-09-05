import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateRecoveryCode,
  generateRecoveryCodes,
  computeLookupHash,
  buildRecoveryCodeEnvelope,
  unwrapMasterKey,
  buildRecoveryCodesFileText,
} from "./recovery.js";
import { RECOVERY_CODE_COUNT, formatRecoveryCode } from "@keypage/shared";

describe("recovery codes", () => {
  it("generates alphabet-only codes and a full set", () => {
    const code = generateRecoveryCode();
    assert.match(code, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, RECOVERY_CODE_COUNT);
  });

  it("computes a stable lookup hash", async () => {
    const hash = await computeLookupHash("ABCDE12345FGHIJ67890");
    const again = await computeLookupHash("ABCDE12345FGHIJ67890");
    assert.equal(hash, again);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("wraps and unwraps a master key", async () => {
    const masterKey = new Uint8Array(32).fill(4);
    const code = generateRecoveryCode();
    const envelope = await buildRecoveryCodeEnvelope(masterKey, code, "1");
    const unwrapped = await unwrapMasterKey(envelope, formatRecoveryCode(code));
    assert.deepEqual(unwrapped, masterKey);
    assert.equal(envelope.label, "1");
    assert.equal(envelope.kdf.algorithm, "argon2id");
  });

  it("rejects an invalid recovery code", async () => {
    const masterKey = new Uint8Array(32).fill(4);
    const code = generateRecoveryCode();
    const envelope = await buildRecoveryCodeEnvelope(masterKey, code, "1");
    await assert.rejects(() => unwrapMasterKey(envelope, "not-a-code"), /Invalid recovery code/);
    await assert.rejects(
      () => unwrapMasterKey(envelope, formatRecoveryCode(generateRecoveryCode())),
      /Invalid recovery code/,
    );
  });

  it("rejects a truncated wrapped key", async () => {
    const masterKey = new Uint8Array(32).fill(4);
    const code = generateRecoveryCode();
    const envelope = await buildRecoveryCodeEnvelope(masterKey, code, "1");
    envelope.wrappedMasterKeyB64 = Buffer.from([1, 2, 3]).toString("base64");
    await assert.rejects(
      () => unwrapMasterKey(envelope, formatRecoveryCode(code)),
      /Wrapped master key must be/,
    );
  });

  it("formats a downloadable recovery codes file", () => {
    const text = buildRecoveryCodesFileText(
      ["AAAAA", "BBBBB"],
      new Date("2026-08-01T12:00:00.000Z"),
    );
    assert.match(text, /KeyPage — Recovery Codes/);
    assert.match(text, /Generated: 2026-08-01T12:00:00Z/);
    assert.match(text, /1\.\s+AAAAA/);
    assert.match(text, /2\.\s+BBBBB/);
    assert.match(text, /cannot be recovered/);
  });
});
