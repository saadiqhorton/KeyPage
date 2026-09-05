import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { KeyEntry } from "@keypage/shared";
import { KEY_ENTRY_LABEL_MAX, KEY_ENTRY_TAG_MAX } from "@keypage/shared";

import { DashboardScreen, renderDashboardContent } from "@/screens/DashboardScreen.js";
import {
  formatIdleLockMinutes,
  formatUnlockError,
  lockReasonBanner,
  UnlockScreen,
  workingStatusLabel,
} from "@/screens/UnlockScreen.js";
import {
  formatRecoveryError,
  RecoverCodeStep,
  RecoverPasswordStep,
  RecoverScreen,
  workingStatusLabel as recoverWorkingLabel,
} from "@/screens/RecoverScreen.js";
import {
  RecoveryCodesScreen,
  titleForReason,
} from "@/screens/RecoveryCodesScreen.js";
import { SetupScreen } from "@/screens/SetupScreen.js";
import { SettingsScreen } from "@/screens/SettingsScreen.js";
import { ApiError } from "@/lib/api.js";
import {
  VaultContext,
  type VaultActions,
  type VaultState,
  type WizardState,
} from "@/vault/useVault.js";
import {
  buildCreateValues,
  buildEditValues,
  keyValueHintFor,
  mapSharedFieldErrors,
  seedFromEntry,
  submitErrorMessage,
  validateForm,
} from "@/components/keys/KeyEntryModal.js";
import { Guarded, LoadingGate } from "@/routes/gates.js";

const FAST_KDF = {
  algorithm: "pbkdf2-sha256" as const,
  saltB64: "AAAAAAAAAAAAAAAAAAAAAA==",
  iterations: 1000,
};

function makeEntry(overrides: Partial<KeyEntry> = {}): KeyEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    label: "Production",
    serviceId: "openai",
    customServiceName: null,
    description: null,
    tags: ["prod"],
    cipher: {
      algorithm: "aes-256-gcm",
      ivB64: "AAAAAAAAAAAAAAAA",
      ciphertextB64: "BBBBBBBBBBBBBBBBBBBBBBBB",
      keyVersion: 1,
    },
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

const noopActions: VaultActions = {
  refreshStatus: async () => undefined,
  startSetup: () => undefined,
  submitSetup: async () => undefined,
  unlock: async () => undefined,
  lock: async () => undefined,
  lockLocal: async () => undefined,
  startRecovery: () => undefined,
  claimRecoveryCode: async () => undefined,
  completeRecovery: async () => undefined,
  changeMasterPassword: async () => undefined,
  regenerateRecoveryCodes: async () => undefined,
  acknowledgeRecoveryCodes: () => ({ navigateTo: "/" }),
  finishWizard: () => undefined,
  cancelRecovery: async () => undefined,
};

function lockedState(overrides: Partial<Extract<VaultState, { phase: "locked" }>> = {}): VaultState {
  return {
    phase: "locked",
    reason: "initial",
    idleTimeoutSeconds: 1200,
    kdf: FAST_KDF,
    keyVersion: 1,
    lockout: { locked: false, retryAfterSeconds: 0 },
    recoveryCodesRemaining: 10,
    recoveryLockout: { locked: false, retryAfterSeconds: 0 },
    proofReady: true,
    ...overrides,
  };
}

function wrapVault(
  ui: ReactNode,
  state: VaultState,
  wizard: WizardState = { kind: "none" },
) {
  return (
    <MemoryRouter>
      <VaultContext.Provider
        value={{
          state,
          wizard,
          actions: noopActions,
          issuingRecoveryCodes: false,
        }}
      >
        {ui}
      </VaultContext.Provider>
    </MemoryRouter>
  );
}

const revealProps = {
  revealedId: null as string | null,
  revealedValue: null as string | null,
  busyId: null as string | null,
  onToggleReveal: () => undefined,
  onCopy: () => undefined,
};

const actionProps = {
  onEdit: () => undefined,
  onDelete: () => undefined,
};

describe("renderDashboardContent", () => {
  const base = {
    revealProps,
    actionProps,
    onAddKey: () => undefined,
    onClearFilters: () => undefined,
  };

  it("shows a spinner while locked or loading", () => {
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: false,
          status: "ready",
          error: null,
          entries: [],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /Loading key entries/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "loading",
          error: null,
          entries: [],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /Loading key entries/,
    );
  });

  it("shows error, empty, no-match, and each view", () => {
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "error",
          error: "boom",
          entries: [],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /boom/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "error",
          error: null,
          entries: [],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /Failed to load key entries/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "ready",
          error: null,
          entries: [],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /Your vault is empty/,
    );
    const entry = makeEntry();
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "ready",
          error: null,
          entries: [entry],
          visible: [],
          view: "grid",
        }) as never,
      ),
      /No matching Key Entries/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "ready",
          error: null,
          entries: [entry],
          visible: [entry],
          view: "table",
        }) as never,
      ),
      /Key Entries/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "ready",
          error: null,
          entries: [entry],
          visible: [entry],
          view: "list",
        }) as never,
      ),
      /Production/,
    );
    assert.match(
      renderToStaticMarkup(
        renderDashboardContent({
          ...base,
          vaultUnlocked: true,
          status: "ready",
          error: null,
          entries: [entry],
          visible: [entry],
          view: "grid",
        }) as never,
      ),
      /Production/,
    );
  });
});

describe("UnlockScreen helpers and render", () => {
  it("formats idle lock minutes and unlock errors", () => {
    assert.equal(formatIdleLockMinutes(60), "1 minute");
    assert.equal(formatIdleLockMinutes(120), "2 minutes");
    assert.match(
      formatUnlockError(
        new ApiError({
          error: "invalid_credentials",
          message: "nope",
          attemptsRemaining: 1,
        }),
      ),
      /1 attempt remaining/,
    );
    assert.match(
      formatUnlockError(
        new ApiError({
          error: "invalid_credentials",
          message: "nope",
          attemptsRemaining: 2,
        }),
      ),
      /2 attempts remaining/,
    );
    assert.equal(
      formatUnlockError(new ApiError({ error: "internal_error", message: "down" })),
      "down",
    );
  });

  it("builds lock banners and working labels", () => {
    assert.equal(lockReasonBanner({ phase: "working", label: "x" }), null);
    assert.match(
      lockReasonBanner(lockedState({ reason: "idle", idleTimeoutSeconds: 60 })) ?? "",
      /1 minute/,
    );
    assert.equal(
      lockReasonBanner(lockedState({ reason: "session_expired" })),
      "Your session expired.",
    );
    assert.match(
      lockReasonBanner(lockedState({ reason: "rekeyed" })) ?? "",
      /changed somewhere else/,
    );
    assert.equal(lockReasonBanner(lockedState({ reason: "initial" })), null);
    assert.equal(workingStatusLabel({ phase: "working", label: "Deriving…" }), "Deriving…");
    assert.equal(workingStatusLabel(lockedState()), "Working…");
  });

  it("renders locked, lockout, and working states", () => {
    assert.match(
      renderToStaticMarkup(wrapVault(<UnlockScreen />, lockedState({ reason: "idle" }))),
      /Locked after/,
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(
          <UnlockScreen />,
          lockedState({
            lockout: { locked: true, retryAfterSeconds: 30 },
          }),
        ),
      ),
      /Too many attempts/,
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(<UnlockScreen />, { phase: "working", label: "Deriving your encryption key…" }),
      ),
      /Deriving your encryption key/,
    );
  });
});

describe("RecoverScreen helpers and steps", () => {
  it("formats recovery errors", () => {
    assert.match(
      formatRecoveryError(
        new ApiError({
          error: "invalid_recovery_code",
          message: "nope",
          attemptsRemaining: 1,
        }),
      ),
      /1 attempt remaining/,
    );
    assert.equal(
      formatRecoveryError(
        new ApiError({ error: "invalid_recovery_code", message: "nope" }),
      ),
      "That recovery code isn't valid.",
    );
    assert.equal(
      formatRecoveryError(new ApiError({ error: "internal_error", message: "down" })),
      "down",
    );
    assert.equal(recoverWorkingLabel({ phase: "working", label: "Checking…" }), "Checking…");
    assert.equal(recoverWorkingLabel(lockedState()), "Working…");
  });

  it("renders code and password steps", () => {
    const code = renderToStaticMarkup(
      <MemoryRouter>
        <RecoverCodeStep
          code="AAAAA"
          onCodeChange={() => undefined}
          error="bad code"
          working
          workingLabel="Verifying recovery code…"
          lockoutActive
          recoveryLockout={{ locked: true, retryAfterSeconds: 12 }}
          onLockoutExpired={() => undefined}
          onSubmit={() => undefined}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );
    assert.match(code, /bad code/);
    assert.match(code, /Verifying recovery code/);
    const password = renderToStaticMarkup(
      <RecoverPasswordStep
        password="abcdefghijkl"
        confirm="other"
        error="failed"
        working
        workingLabel="Saving…"
        onPasswordChange={() => undefined}
        onConfirmChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    assert.match(password, /Passwords do not match/);
    assert.match(password, /Saving/);
  });

  it("renders recover screen step 1 and 2 from wizard state", () => {
    assert.match(
      renderToStaticMarkup(
        wrapVault(<RecoverScreen />, lockedState(), { kind: "recovery", step: 1 }),
      ),
      /Enter one unused recovery code/,
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(<RecoverScreen />, lockedState(), { kind: "recovery", step: 2 }),
      ),
      /Set a new Master Password/,
    );
  });
});

describe("RecoveryCodesScreen", () => {
  it("titles each reason", () => {
    assert.match(titleForReason("setup"), /Save these recovery codes/);
    assert.match(titleForReason("recovery"), /Save your new recovery codes/);
    assert.match(titleForReason("password_change"), /Master Password was changed/);
    assert.match(titleForReason("regen"), /Save your new recovery codes/);
  });

  it("returns null without parked codes and renders reason variants", () => {
    assert.equal(
      renderToStaticMarkup(wrapVault(<RecoveryCodesScreen />, lockedState())),
      "",
    );
    const setup = renderToStaticMarkup(
      wrapVault(<RecoveryCodesScreen />, { phase: "unlocked", idleTimeoutSeconds: 1200 }, {
        kind: "codes",
        codes: ["AAAAA11111BBBBB22222"],
        reason: "setup",
      }),
    );
    assert.match(setup, /shown only once/);
    const locked = renderToStaticMarkup(
      wrapVault(
        <RecoveryCodesScreen />,
        lockedState(),
        { kind: "codes", codes: ["AAAAA11111BBBBB22222"], reason: "regen" },
      ),
    );
    assert.match(locked, /vault locked while these codes/);
    const unavailable = renderToStaticMarkup(
      wrapVault(
        <RecoveryCodesScreen />,
        { phase: "unavailable", message: "down" },
        { kind: "codes", codes: ["AAAAA11111BBBBB22222"], reason: "recovery" },
      ),
    );
    assert.match(unavailable, /server could not be reached/);
  });
});

describe("SetupScreen", () => {
  it("renders password setup and ready steps", () => {
    assert.match(
      renderToStaticMarkup(
        wrapVault(<SetupScreen />, { phase: "setup_required" }, { kind: "setup", step: 1 }),
      ),
      /Create Master Password/,
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(<SetupScreen />, { phase: "unlocked", idleTimeoutSeconds: 1200 }, {
          kind: "setup",
          step: 3,
        }),
      ),
      /Your vault is ready/,
    );
    assert.equal(
      renderToStaticMarkup(
        wrapVault(<SetupScreen />, { phase: "unlocked", idleTimeoutSeconds: 1200 }, {
          kind: "codes",
          codes: ["a"],
          reason: "setup",
        }),
      ),
      "",
    );
  });
});

describe("DashboardScreen and SettingsScreen", () => {
  it("renders the dashboard shell while key entries load", () => {
    const html = renderToStaticMarkup(
      wrapVault(<DashboardScreen />, { phase: "unlocked", idleTimeoutSeconds: 1200 }),
    );
    assert.match(html, /KeyPage/);
    assert.match(html, /Lock vault/);
  });

  it("renders settings sections", () => {
    const html = renderToStaticMarkup(
      wrapVault(<SettingsScreen />, { phase: "unlocked", idleTimeoutSeconds: 1200 }),
    );
    assert.match(html, /Settings/);
    assert.match(html, /Master Password/);
    assert.match(html, /Encrypted backup/);
  });
});

describe("KeyEntryModal helpers", () => {
  it("maps shared field errors", () => {
    const errors = mapSharedFieldErrors([
      { field: "label", code: "label.required", message: "x" },
      { field: "label", code: "label.too_long", message: "x" },
      { field: "serviceId", code: "service.unknown", message: "x" },
      { field: "customServiceName", code: "custom_service_name.required", message: "x" },
      { field: "customServiceName", code: "custom_service_name.too_long", message: "x" },
      { field: "customServiceName", code: "custom_service_name.not_allowed", message: "x" },
      { field: "description", code: "description.too_long", message: "x" },
      { field: "tags", code: "tag.too_long", message: "x" },
      { field: "tags", code: "tags.too_many", message: "x" },
    ]);
    assert.match(errors.label ?? "", /at most/);
    assert.equal(errors.service, "Choose a service.");
    assert.match(errors.customServiceName ?? "", /only allowed/);
    assert.match(errors.description ?? "", /Description must be at most/);
    assert.match(errors.tags ?? "", /At most/);
  });

  it("validates create and edit forms", () => {
    const invalid = validateForm({
      mode: "create",
      prefillState: "idle",
      label: "",
      serviceId: "openai",
      customServiceName: "",
      description: "",
      tags: [],
      tagDraft: "x".repeat(KEY_ENTRY_TAG_MAX + 1),
      keyValue: "",
    });
    assert.equal(invalid.fields, null);
    assert.ok(invalid.errors.label);
    assert.ok(invalid.errors.keyValue);
    assert.ok(invalid.errors.tags);

    const valid = validateForm({
      mode: "create",
      prefillState: "idle",
      label: "Prod",
      serviceId: "openai",
      customServiceName: "",
      description: "Main",
      tags: ["prod"],
      tagDraft: "",
      keyValue: "sk-live",
    });
    assert.equal(valid.errors.label, undefined);
    assert.equal(valid.fields?.label, "Prod");

    const editBlank = validateForm({
      mode: "edit",
      prefillState: "ready",
      label: "Prod",
      serviceId: "openai",
      customServiceName: "",
      description: "",
      tags: [],
      tagDraft: "",
      keyValue: "   ",
    });
    assert.equal(editBlank.errors.keyValue, "API Key value is required.");
  });

  it("seeds, builds write payloads, and formats hints/errors", () => {
    const entry = makeEntry({
      customServiceName: null,
      description: "desc",
      label: "x".repeat(KEY_ENTRY_LABEL_MAX).slice(0, 8),
    });
    const seeded = seedFromEntry(entry);
    assert.equal(seeded.label, entry.label);
    assert.equal(seeded.description, "desc");

    const created = buildCreateValues(
      {
        label: "Prod",
        serviceId: "custom",
        customServiceName: "Internal",
        description: "Main",
        tags: ["prod"],
      },
      "  sk-live  ",
    );
    assert.equal(created.keyValue, "sk-live");
    assert.equal(created.customServiceName, "Internal");

    const unchanged = buildEditValues(
      {
        label: "Prod",
        serviceId: "openai",
        customServiceName: null,
        description: null,
        tags: [],
      },
      "ready",
      "same",
      "same",
    );
    assert.equal(unchanged.keyValue, undefined);
    const changed = buildEditValues(
      {
        label: "Prod",
        serviceId: "openai",
        customServiceName: null,
        description: null,
        tags: [],
      },
      "ready",
      "new-secret",
      "old-secret",
    );
    assert.equal(changed.keyValue, "new-secret");
    const failedPrefill = buildEditValues(
      {
        label: "Prod",
        serviceId: "openai",
        customServiceName: null,
        description: null,
        tags: [],
      },
      "failed",
      "replacement",
      "",
    );
    assert.equal(failedPrefill.keyValue, "replacement");

    assert.equal(keyValueHintFor(true, "idle"), undefined);
    assert.equal(keyValueHintFor(false, "failed"), "Leave blank to keep the current API key.");
    assert.equal(keyValueHintFor(false, "loading"), "Decrypting API key…");
    assert.equal(keyValueHintFor(false, "ready"), undefined);
    assert.equal(
      submitErrorMessage(new ApiError({ error: "internal_error", message: "nope" }), "create"),
      "nope",
    );
    assert.equal(submitErrorMessage(new Error("x"), "create"), "Failed to create key entry.");
    assert.equal(submitErrorMessage(new Error("x"), "edit"), "Failed to update key entry.");
  });
});

describe("route gates", () => {
  it("LoadingGate waits, shows unavailable, or renders children", () => {
    assert.match(
      renderToStaticMarkup(wrapVault(<LoadingGate />, { phase: "loading" })),
      /Loading vault/,
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(<LoadingGate />, { phase: "unavailable", message: "down" }),
      ),
      /down/,
    );
  });

  it("Guarded waits, redirects, or renders", () => {
    assert.equal(
      renderToStaticMarkup(wrapVault(<Guarded guard="unlocked">ok</Guarded>, { phase: "loading" })),
      "",
    );
    assert.match(
      renderToStaticMarkup(
        wrapVault(<Guarded guard="unlocked">secret</Guarded>, {
          phase: "unlocked",
          idleTimeoutSeconds: 1200,
        }),
      ),
      /secret/,
    );
  });
});
