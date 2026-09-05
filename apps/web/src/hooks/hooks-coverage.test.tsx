import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useToast } from "@/hooks/useToast.js";
import { useHealth } from "@/hooks/useHealth.js";
import { useKeyEntryView } from "@/hooks/useKeyEntryView.js";
import { useWarnBeforeUnload } from "@/hooks/useWarnBeforeUnload.js";
import { useExitTransition } from "@/hooks/useExitTransition.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";
import { VaultContext, type VaultActions } from "@/vault/useVault.js";
import { useChangeMasterPassword } from "@/vault/useChangeMasterPassword.js";
import { useKeyEntryOperations } from "@/vault/useKeyEntryOperations.js";
import { useBackup } from "@/vault/useBackup.js";
import { useAppSettings } from "@/vault/useAppSettings.js";
import { useRecoveryCodes } from "@/vault/useRecoveryCodes.js";
import { useKeyEntries } from "@/vault/useKeyEntries.js";
import { useKeyEntrySecret } from "@/vault/useKeyEntrySecret.js";
import { useIdleLock } from "@/vault/useIdleLock.js";
import { DEFAULT_KEY_ENTRY_VIEW, KEY_ENTRY_VIEW_STORAGE_KEY } from "@/lib/view-mode.js";
import { VaultProvider } from "@/vault/VaultProvider.js";

const noopActions = {
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
  acknowledgeRecoveryCodes: () => ({ navigateTo: "/" as const }),
  finishWizard: () => undefined,
  cancelRecovery: async () => undefined,
} satisfies VaultActions;

function withVault(ui: ReactNode) {
  return (
    <VaultContext.Provider
      value={{
        state: { phase: "unlocked", idleTimeoutSeconds: 1200 },
        wizard: { kind: "none" },
        actions: noopActions,
        issuingRecoveryCodes: false,
      }}
    >
      {ui}
    </VaultContext.Provider>
  );
}

describe("hooks initial render", () => {
  it("starts toast empty", () => {
    function Probe() {
      const { toast } = useToast();
      return <span>{toast ? toast.message : "none"}</span>;
    }
    assert.match(renderToStaticMarkup(<Probe />), /none/);
  });

  it("starts health in loading", () => {
    function Probe() {
      const health = useHealth();
      return <span>{health.status}</span>;
    }
    assert.match(renderToStaticMarkup(<Probe />), /loading/);
  });

  it("reads the stored key entry view and falls back", () => {
    const prior = globalThis.localStorage;
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    try {
      function Probe() {
        const { view } = useKeyEntryView();
        return <span>{view}</span>;
      }
      assert.match(renderToStaticMarkup(<Probe />), new RegExp(DEFAULT_KEY_ENTRY_VIEW));
      store.set(KEY_ENTRY_VIEW_STORAGE_KEY, "table");
      assert.match(renderToStaticMarkup(<Probe />), /table/);
    } finally {
      globalThis.localStorage = prior;
    }
  });

  it("useWarnBeforeUnload is a no-op during SSR", () => {
    function Probe() {
      useWarnBeforeUnload(true);
      useWarnBeforeUnload(false);
      return <span>ok</span>;
    }
    assert.match(renderToStaticMarkup(<Probe />), /ok/);
  });

  it("useExitTransition keeps the initial value", () => {
    function Probe() {
      const { rendered, closing } = useExitTransition("hello", 100);
      return (
        <span>
          {rendered}-{String(closing)}
        </span>
      );
    }
    assert.match(renderToStaticMarkup(<Probe />), /hello-false/);
  });
});

describe("vault hooks initial render", () => {
  it("exposes idle rekey and operations state", () => {
    function Probe() {
      const rekey = useRekeyBusy();
      const password = useChangeMasterPassword();
      const ops = useKeyEntryOperations();
      const backup = useBackup();
      const settings = useAppSettings();
      const recovery = useRecoveryCodes();
      const entries = useKeyEntries(false);
      const secret = useKeyEntrySecret({
        clipboardClearMs: 30_000,
        onCopied: () => undefined,
        onError: () => undefined,
      });
      const idle = useIdleLock();
      return (
        <span>
          {String(rekey.busy)}-{password.error ?? "none"}-{String(Boolean(ops.create))}-
          {String(backup.exportBusy)}-{String(settings.loading)}-{String(recovery.loadingRemaining)}-
          {entries.status}-{String(secret.revealedId)}-{String(idle.warningVisible)}
        </span>
      );
    }
    const html = renderToStaticMarkup(withVault(<Probe />));
    assert.match(html, /false-none-true/);
    assert.match(html, /loading/);
  });

  it("VaultProvider starts in loading", () => {
    const html = renderToStaticMarkup(
      <VaultProvider>
        <span>child</span>
      </VaultProvider>,
    );
    assert.match(html, /child/);
  });
});
