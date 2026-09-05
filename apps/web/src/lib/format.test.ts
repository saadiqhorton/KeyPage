import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCountdown,
  formatEntryDate,
  formatKeyCount,
  formatRecoveryCodeInput,
  formatShortDate,
} from "./format.js";

describe("formatKeyCount", () => {
  it("uses singular copy for one key", () => {
    assert.equal(formatKeyCount(1), "1 key");
  });

  it("uses plural copy for zero keys", () => {
    assert.equal(formatKeyCount(0), "0 keys");
  });

  it("uses plural copy for multiple keys", () => {
    assert.equal(formatKeyCount(4), "4 keys");
  });
});

describe("formatShortDate and formatEntryDate", () => {
  it("formats an ISO timestamp in en-GB", () => {
    const formatted = formatShortDate("2026-08-01T12:00:00.000Z");
    assert.match(formatted, /2026/);
    assert.match(formatted, /Aug/);
  });

  it("prefixes Added for entry dates", () => {
    assert.equal(
      formatEntryDate("2026-08-01T12:00:00.000Z"),
      `Added ${formatShortDate("2026-08-01T12:00:00.000Z")}`,
    );
  });
});

describe("formatCountdown", () => {
  it("pads minutes and seconds", () => {
    assert.equal(formatCountdown(0), "00:00");
    assert.equal(formatCountdown(5), "00:05");
    assert.equal(formatCountdown(65), "01:05");
    assert.equal(formatCountdown(-3), "00:00");
    assert.equal(formatCountdown(1.2), "00:02");
  });
});

describe("formatRecoveryCodeInput", () => {
  it("uppercases, maps ambiguous characters, and inserts dashes", () => {
    assert.equal(formatRecoveryCodeInput("abcde12345"), "ABCDE-12345");
    assert.equal(formatRecoveryCodeInput("o0il"), "0011");
    assert.equal(formatRecoveryCodeInput("xxxxxyyyyy"), "XXXXX-YYYYY");
  });

  it("drops characters outside the alphabet and caps length", () => {
    const formatted = formatRecoveryCodeInput("!!!!aaaaabbbbbcccccdddddeeeeefffff");
    assert.equal(formatted, "AAAAA-BBBBB-CCCCC-DDDDD");
    assert.doesNotMatch(formatted, /E/);
  });
});

