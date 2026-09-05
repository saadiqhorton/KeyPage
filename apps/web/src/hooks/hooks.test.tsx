import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useToast } from "@/hooks/useToast.js";
import { useHealth } from "@/hooks/useHealth.js";
import { useKeyEntryView } from "@/hooks/useKeyEntryView.js";
import { useExitTransition } from "@/hooks/useExitTransition.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";
import { VaultContext, useVault, type VaultActions } from "@/vault/useVault.js";
import { useChangeMasterPassword } from "@/vault/useChangeMasterPassword.js";
import { useKeyEntryOperations } from "@/vault/useKeyEntryOperations.js";
import { useBackup } from "@/vault/useBackup.js";
import { useAppSettings } from "@/vault/useAppSettings.js";
import { useRecoveryCodes } from "@/vault/useRecoveryCodes.js";
import { useKeyEntries } from "@/vault/useKeyEntries.js";
import { useKeyEntrySecret } from "@/vault/useKeyEntrySecret.js";
import { useIdleLock } from "@/vault/useIdleLock.js";
import { DEFAULT_KEY_ENTRY_VIEW, KEY_ENTRY_VIEW_STORAGE_KEY } from "@/lib/view-mode.js";
import { resolveClipboardClearMs } from "@/lib/clipboard-timeout.js";
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

function withVault(ui: ReactNode, phase: "unlocked" | "locked" = "unlocked") {
  const state =
    phase === "unlocked"
      ? ({ phase: "unlocked" as const, idleTimeoutSeconds: 1200 })
      : ({
          phase: "locked" as const,
          reason: "initial" as const,
          idleTimeoutSeconds: 1200,
          kdf: {
            algorithm: "pbkdf2-sha256" as const,
            saltB64: "AAAAAAAAAAAAAAAAAAAAAA==",
            iterations: 1000,
          },
          keyVersion: 1,
          lockout: { locked: false, retryAfterSeconds: 0 },
          recoveryCodesRemaining: 10,
          recoveryLockout: { locked: false, retryAfterSeconds: 0 },
          proofReady: true,
        });

  return (
    <VaultContext.Provider
      value={{
        state,
        wizard: { kind: "none" },
        actions: noopActions,
        issuingRecoveryCodes: false,
      }}
    >
      {ui}
    </VaultContext.Provider>
  );
}

function withMockStorage(store: Map<string, string>, run: () => void) {
  const prior = globalThis.localStorage;
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
    run();
  } finally {
    globalThis.localStorage = prior;
  }
}

describe("useToast", () => {
  it("starts with no toast message", () => {
    function Probe() {
      const { toast } = useToast();
      return <span>{toast ? toast.message : "none"}</span>;
    }
    assert.match(renderToStaticMarkup(<Probe />), /none/);
  });
});

describe("useHealth", () => {
  it("starts in loading because fetch lives in useEffect (no SSR fetch)", () => {
    const priorFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ status: "ok" }),
      } as Response;
    }) as typeof fetch;
    try {
      function Probe() {
        const health = useHealth();
        return <span>{health.status}</span>;
      }
      assert.match(renderToStaticMarkup(<Probe />), /loading/);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = priorFetch;
    }
  });
});

describe("useKeyEntryView", () => {
  it("falls back to the default view when storage is empty or invalid", () => {
    withMockStorage(new Map(), () => {
      function Probe() {
        const { view } = useKeyEntryView();
        return <span>{view}</span>;
      }
      assert.equal(renderToStaticMarkup(<Probe />), `<span>${DEFAULT_KEY_ENTRY_VIEW}</span>`);
    });
    withMockStorage(new Map([[KEY_ENTRY_VIEW_STORAGE_KEY, "cards"]]), () => {
      function Probe() {
        const { view } = useKeyEntryView();
        return <span>{view}</span>;
      }
      assert.equal(renderToStaticMarkup(<Probe />), `<span>${DEFAULT_KEY_ENTRY_VIEW}</span>`);
    });
  });

  it("reads a stored table view", () => {
    withMockStorage(new Map([[KEY_ENTRY_VIEW_STORAGE_KEY, "table"]]), () => {
      function Probe() {
        const { view } = useKeyEntryView();
        return <span>{view}</span>;
      }
      assert.equal(renderToStaticMarkup(<Probe />), "<span>table</span>");
    });
  });

  it("falls back when localStorage throws", () => {
    const prior = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() {
        throw new Error("blocked");
      },
    } as Storage;
    try {
      function Probe() {
        const { view } = useKeyEntryView();
        return <span>{view}</span>;
      }
      assert.equal(renderToStaticMarkup(<Probe />), `<span>${DEFAULT_KEY_ENTRY_VIEW}</span>`);
    } finally {
      globalThis.localStorage = prior;
    }
  });
});

describe("useExitTransition", () => {
  it("keeps the initial value visible and not closing", () => {
    function Probe() {
      const { rendered, closing } = useExitTransition("hello", 100);
      return (
        <span>
          {rendered}-{String(closing)}
        </span>
      );
    }
    assert.equal(renderToStaticMarkup(<Probe />), "<span>hello-false</span>");
  });

  it("starts with a null value hidden", () => {
    function Probe() {
      const { rendered, closing } = useExitTransition<string>(null, 100);
      return (
        <span>
          {rendered ?? "empty"}-{String(closing)}
        </span>
      );
    }
    assert.equal(renderToStaticMarkup(<Probe />), "<span>empty-false</span>");
  });
});

describe("vault hooks initial state", () => {
  it("starts idle, password, backup, settings, recovery, and secret hooks idle/loading", () => {
    function Probe() {
      const rekey = useRekeyBusy();
      const password = useChangeMasterPassword();
      const backup = useBackup();
      const settings = useAppSettings();
      const recovery = useRecoveryCodes();
      const secret = useKeyEntrySecret({
        clipboardClearMs: 30_000,
        onCopied: () => undefined,
        onError: () => undefined,
      });
      return (
        <ul>
          <li>{`rekey:${rekey.busy}:${rekey.error ?? "none"}:${rekey.progress ?? "none"}`}</li>
          <li>{`password:${password.busy}:${password.error ?? "none"}:${password.progress ?? "none"}`}</li>
          <li>{`backup:${backup.exportBusy}:${backup.importBusy}`}</li>
          <li>{`settings:${settings.loading}:${settings.sessionIdleMinutes ?? "none"}:${settings.saveBusy}`}</li>
          <li>{`recovery:${recovery.loadingRemaining}:${recovery.remaining ?? "none"}:${recovery.busy}`}</li>
          <li>{`secret:${secret.revealedId ?? "none"}:${secret.revealedValue ?? "none"}:${secret.busyId ?? "none"}`}</li>
        </ul>
      );
    }
    const html = renderToStaticMarkup(withVault(<Probe />));
    assert.match(html, /rekey:false:none:none/);
    assert.match(html, /password:false:none:none/);
    assert.match(html, /backup:false:false/);
    assert.match(html, /settings:true:none:false/);
    assert.match(html, /recovery:true:none:false/);
    assert.match(html, /secret:none:none:none/);
  });

  it("starts key entries in loading with the default clipboard timeout", () => {
    function Probe() {
      const entries = useKeyEntries(false);
      return (
        <span>
          {entries.status}:{entries.entries.length}:{entries.error ?? "none"}:
          {entries.clipboardClearMs}
        </span>
      );
    }
    assert.equal(
      renderToStaticMarkup(withVault(<Probe />)),
      `<span>loading:0:none:${resolveClipboardClearMs(undefined)}</span>`,
    );
  });

  it("hides the idle warning when the vault is locked or newly unlocked", () => {
    function Probe() {
      const idle = useIdleLock();
      return (
        <span>
          {String(idle.warningVisible)}:{idle.secondsRemaining}
        </span>
      );
    }
    assert.equal(renderToStaticMarkup(withVault(<Probe />, "locked")), "<span>false:0</span>");
    assert.equal(renderToStaticMarkup(withVault(<Probe />, "unlocked")), "<span>false:0</span>");
  });

  it("exposes key-entry operations that fail closed without a session key", async () => {
    let createPromise: Promise<unknown> | undefined;
    function Probe() {
      const ops = useKeyEntryOperations();
      createPromise = ops.create({
        label: "Prod",
        serviceId: "openai",
        tags: [],
        keyValue: "sk-live",
      });
      return <span>wired</span>;
    }
    assert.match(renderToStaticMarkup(withVault(<Probe />)), /wired/);
    await assert.rejects(() => createPromise!, /Vault is locked/);
  });
});

describe("VaultProvider", () => {
  it("starts in the loading phase on first render", () => {
    function Probe() {
      const { state, wizard, issuingRecoveryCodes } = useVault();
      return (
        <span>
          {state.phase}:{wizard.kind}:{String(issuingRecoveryCodes)}
        </span>
      );
    }
    const html = renderToStaticMarkup(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    );
    assert.equal(html, "<span>loading:none:false</span>");
  });
});
