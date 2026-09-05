import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyEntry } from "@keypage/shared";

import { AuthShell } from "@/components/AuthShell.js";
import { DashboardShell } from "@/components/DashboardShell.js";
import { EmptyVaultState } from "@/components/EmptyVaultState.js";
import { IdleWarningToast } from "@/components/IdleWarningToast.js";
import { LockoutCountdown } from "@/components/LockoutCountdown.js";
import { RecoveryCodeGrid } from "@/components/RecoveryCodeGrid.js";
import { StepIndicator } from "@/components/StepIndicator.js";
import { Button } from "@/components/ui/Button.js";
import { Callout } from "@/components/ui/Callout.js";
import { PasswordField } from "@/components/ui/PasswordField.js";
import { PasswordStrengthHint } from "@/components/ui/PasswordStrengthHint.js";
import { SearchField } from "@/components/ui/SearchField.js";
import { SelectField } from "@/components/ui/SelectField.js";
import { ServiceIcon, monogram } from "@/components/ui/ServiceIcon.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { TagInput, tagDraftError } from "@/components/ui/TagInput.js";
import { TextArea } from "@/components/ui/TextArea.js";
import { TextField } from "@/components/ui/TextField.js";
import { Toast } from "@/components/ui/Toast.js";
import { KebabMenu, computeMenuPosition } from "@/components/ui/KebabMenu.js";
import { Modal } from "@/components/ui/Modal.js";
import { KeyEntryCard } from "@/components/keys/KeyEntryCard.js";
import { KeyEntryCardGrid } from "@/components/keys/KeyEntryCardGrid.js";
import { KeyEntryList } from "@/components/keys/KeyEntryList.js";
import { KeyEntryTable } from "@/components/keys/KeyEntryTable.js";
import { KeyEntryTags } from "@/components/keys/KeyEntryTags.js";
import { KeyEntryToolbar } from "@/components/keys/KeyEntryToolbar.js";
import { KeyValueField } from "@/components/keys/KeyValueField.js";
import { NoFilterMatchesState } from "@/components/keys/NoFilterMatchesState.js";
import { DeleteKeyEntryModal } from "@/components/keys/DeleteKeyEntryModal.js";
import { SettingsCard } from "@/components/settings/SettingsCard.js";
import { SettingsSection } from "@/components/settings/SettingsSection.js";
import { BackupExportCard } from "@/components/settings/BackupExportCard.js";
import { BackupImportCard } from "@/components/settings/BackupImportCard.js";
import { ChangeMasterPasswordCard } from "@/components/settings/ChangeMasterPasswordCard.js";
import {
  RecoveryCodesCard,
  remainingCodesSummary,
} from "@/components/settings/RecoveryCodesCard.js";
import { RecoveryCodesPanel } from "@/components/settings/RecoveryCodesPanel.js";
import { SessionTimeoutCard } from "@/components/settings/SessionTimeoutCard.js";
import { KEY_ENTRY_TAG_MAX } from "@keypage/shared";

function makeEntry(overrides: Partial<KeyEntry> = {}): KeyEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    label: "Production",
    serviceId: "openai",
    customServiceName: null,
    description: "Main billing key",
    tags: ["prod", "billing", "ops", "extra"],
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

const revealProps = {
  revealedId: null as string | null,
  revealedValue: null as string | null,
  busyId: null as string | null,
  onToggleReveal: () => undefined,
  onCopy: () => undefined,
  onEdit: () => undefined,
  onDelete: () => undefined,
};

describe("presentational shells", () => {
  it("renders AuthShell with and without a title", () => {
    const withTitle = renderToStaticMarkup(
      <AuthShell chip="LOCKED" title="Enter password">
        <p>child</p>
      </AuthShell>,
    );
    assert.match(withTitle, /LOCKED/);
    assert.match(withTitle, /Enter password/);
    assert.match(withTitle, />child</);
    const without = renderToStaticMarkup(
      <AuthShell chip="STARTING">
        <p>boot</p>
      </AuthShell>,
    );
    assert.doesNotMatch(without, /Enter password/);
  });

  it("renders DashboardShell actions, countdown, toolbar, and footer", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        onLock={() => undefined}
        idleCountdown="00:12"
        actions={<button type="button">Settings</button>}
        footer={<p>footer</p>}
        content={<p>content</p>}
      >
        <p>toolbar</p>
      </DashboardShell>,
    );
    assert.match(html, /Lock vault/);
    assert.match(html, /00:12/);
    assert.match(html, /Settings/);
    assert.match(html, /toolbar/);
    assert.match(html, /footer/);
    const bare = renderToStaticMarkup(
      <DashboardShell onLock={() => undefined} content={<p>only</p>} />,
    );
    assert.doesNotMatch(bare, /00:12/);
    assert.doesNotMatch(bare, /toolbar/);
  });

  it("renders empty vault and no-filter states", () => {
    assert.match(
      renderToStaticMarkup(<EmptyVaultState onAddKey={() => undefined} busy />),
      /Your vault is empty/,
    );
    assert.match(
      renderToStaticMarkup(
        <NoFilterMatchesState onClearFilters={() => undefined} />,
      ),
      /No matching Key Entries/,
    );
  });

  it("renders recovery code grid and step indicator states", () => {
    const grid = renderToStaticMarkup(
      <RecoveryCodeGrid codes={["AAAAA11111BBBBB22222"]} />,
    );
    assert.match(grid, /1\./);
    const steps = renderToStaticMarkup(
      <StepIndicator steps={["One", "Two", "Three"]} currentStep={2} />,
    );
    assert.match(steps, /✓/);
    assert.match(steps, /Two/);
    assert.match(steps, /aria-current="step"/);
  });
});

describe("toasts and lockout", () => {
  it("hides idle warning when not visible and shows it when visible", () => {
    assert.equal(
      renderToStaticMarkup(
        <IdleWarningToast
          visible={false}
          secondsRemaining={12}
          onStayUnlocked={() => undefined}
        />,
      ),
      "",
    );
    const html = renderToStaticMarkup(
      <IdleWarningToast
        visible
        secondsRemaining={12}
        onStayUnlocked={() => undefined}
      />,
    );
    assert.match(html, /Locking in 12s/);
    assert.match(html, /Stay unlocked/);
  });

  it("renders toast copy and lockout countdown", () => {
    assert.equal(renderToStaticMarkup(<Toast message={null} />), "");
    assert.match(
      renderToStaticMarkup(<Toast message="Copied" />),
      /Copied/,
    );
    assert.match(
      renderToStaticMarkup(<Toast message="Failed" tone="danger" />),
      /Failed/,
    );
    assert.match(
      renderToStaticMarkup(<LockoutCountdown retryAfterSeconds={9} />),
      /Too many attempts/,
    );
    assert.equal(
      renderToStaticMarkup(<LockoutCountdown retryAfterSeconds={0} />),
      "",
    );
  });
});

describe("UI primitives", () => {
  it("renders button variants and loading spinner", () => {
    const html = renderToStaticMarkup(
      <Button variant="danger" size="sm" loading>
        Save
      </Button>,
    );
    assert.match(html, /Save/);
    assert.match(html, /disabled/);
    assert.match(renderToStaticMarkup(<Button variant="ghost">Ghost</Button>), /Ghost/);
    assert.match(
      renderToStaticMarkup(<Button variant="secondary">Sec</Button>),
      /Sec/,
    );
  });

  it("renders callout tones and spinner labels", () => {
    assert.match(renderToStaticMarkup(<Callout>Info</Callout>), /Info/);
    assert.match(
      renderToStaticMarkup(<Callout tone="danger">Bad</Callout>),
      /Bad/,
    );
    assert.match(renderToStaticMarkup(<Spinner label="Loading keys" />), /Loading keys/);
    assert.match(renderToStaticMarkup(<Spinner size="sm" />), /Loading/);
  });

  it("renders fields with hints and errors", () => {
    assert.match(
      renderToStaticMarkup(
        <TextField label="Label" hint="hint" error="required" />,
      ),
      /required/,
    );
    assert.match(
      renderToStaticMarkup(
        <PasswordField label="Password" hint="hint" error="too short" />,
      ),
      /Show/,
    );
    assert.match(
      renderToStaticMarkup(
        <TextArea label="Notes" hint="optional" error="too long" />,
      ),
      /too long/,
    );
    assert.match(
      renderToStaticMarkup(
        <SelectField label="Timeout" hint="pick" error="bad">
          <option value="15">15</option>
        </SelectField>,
      ),
      /Timeout/,
    );
    const search = renderToStaticMarkup(
      <SearchField value="prod" onChange={() => undefined} aria-label="Search" />,
    );
    assert.match(search, /Clear search/);
    assert.doesNotMatch(
      renderToStaticMarkup(
        <SearchField value="" onChange={() => undefined} aria-label="Search" />,
      ),
      /Clear search/,
    );
  });

  it("renders password strength states", () => {
    assert.equal(renderToStaticMarkup(<PasswordStrengthHint password="" />), "");
    const weak = renderToStaticMarkup(<PasswordStrengthHint password="short" />);
    assert.match(weak, /At least 12 characters/);
    const strong = renderToStaticMarkup(
      <PasswordStrengthHint password="Correct-Horse-1" />,
    );
    assert.match(strong, /Strong enough for KeyPage/);
  });

  it("computes service monograms and renders icons", () => {
    assert.equal(monogram("GitHub"), "G");
    assert.equal(monogram("Open AI"), "OA");
    assert.equal(monogram("   "), "?");
    assert.match(renderToStaticMarkup(<ServiceIcon serviceId="github" size="sm" />), /GH|G/);
  });

  it("renders a closed kebab menu and computes position", () => {
    const html = renderToStaticMarkup(
      <KebabMenu
        label="Actions"
        items={[{ id: "edit", label: "Edit", onSelect: () => undefined }]}
      />,
    );
    assert.match(html, /Actions/);
    const rect = {
      top: 10,
      bottom: 40,
      left: 0,
      right: 200,
      height: 30,
      width: 200,
      x: 0,
      y: 10,
      toJSON() {
        return this;
      },
    } as DOMRect;
    const prior = globalThis.window;
    globalThis.window = { innerHeight: 800, innerWidth: 1200 } as Window &
      typeof globalThis;
    try {
      const pos = computeMenuPosition(rect, 80);
      assert.equal(typeof pos.top, "number");
      assert.equal(typeof pos.left, "number");
      const flipped = computeMenuPosition(
        { ...rect, top: 780, bottom: 800 } as DOMRect,
        200,
      );
      assert.ok(flipped.top <= 780);
    } finally {
      globalThis.window = prior;
    }
  });

  it("returns null for a closed modal", () => {
    assert.equal(
      renderToStaticMarkup(
        <Modal open={false} onClose={() => undefined} title="Hidden">
          secret
        </Modal>,
      ),
      "",
    );
  });
});

describe("tag input helper and rendering", () => {
  it("validates drafts", () => {
    assert.equal(tagDraftError(""), null);
    assert.equal(tagDraftError("   "), null);
    assert.equal(tagDraftError("ok"), null);
    assert.match(tagDraftError("x".repeat(KEY_ENTRY_TAG_MAX + 1)) ?? "", /Each tag/);
  });

  it("renders tags, hint, and error", () => {
    const html = renderToStaticMarkup(
      <TagInput
        label="Tags"
        value={["prod"]}
        onChange={() => undefined}
        draft="new"
        onDraftChange={() => undefined}
        hint="up to 8"
        error="too many"
      />,
    );
    assert.match(html, /prod/);
    assert.match(html, /too many/);
  });
});

describe("key entry views", () => {
  it("renders tags with overflow", () => {
    assert.equal(renderToStaticMarkup(<KeyEntryTags tags={[]} />), "");
    const html = renderToStaticMarkup(
      <KeyEntryTags tags={["prod", "ops", "ci"]} max={2} />,
    );
    assert.match(html, /prod/);
    assert.match(html, /\+1/);
  });

  it("renders hidden and revealed key values", () => {
    const hidden = renderToStaticMarkup(
      <KeyValueField
        entryLabel="Production"
        value={null}
        revealed={false}
        busy={false}
        density="card"
        onToggleReveal={() => undefined}
        onCopy={() => undefined}
      />,
    );
    assert.match(hidden, /Reveal API Key/);
    const revealed = renderToStaticMarkup(
      <KeyValueField
        entryLabel="Production"
        value="sk-live"
        revealed
        busy
        density="row"
        onToggleReveal={() => undefined}
        onCopy={() => undefined}
      />,
    );
    assert.match(revealed, /sk-live/);
    assert.match(revealed, /Hide API Key/);
  });

  it("renders card, list, table, and grid", () => {
    const entry = makeEntry();
    assert.match(
      renderToStaticMarkup(
        <KeyEntryCard
          entry={entry}
          revealed={false}
          revealedValue={null}
          busy={false}
          onToggleReveal={() => undefined}
          onCopy={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />,
      ),
      /Production/,
    );
    const custom = makeEntry({
      serviceId: "custom",
      customServiceName: "Internal",
      description: null,
      tags: [],
    });
    assert.match(
      renderToStaticMarkup(
        <KeyEntryCard
          entry={custom}
          revealed
          revealedValue="sk-x"
          busy={false}
          onToggleReveal={() => undefined}
          onCopy={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />,
      ),
      /Internal/,
    );
    assert.match(
      renderToStaticMarkup(
        <KeyEntryCardGrid entries={[entry]} {...revealProps} />,
      ),
      /Production/,
    );
    assert.match(
      renderToStaticMarkup(<KeyEntryList entries={[entry]} {...revealProps} />),
      /Main billing key/,
    );
    const table = renderToStaticMarkup(
      <KeyEntryTable
        entries={[entry, makeEntry({ id: "other", description: null })]}
        revealedId={entry.id}
        revealedValue="sk-live"
        busyId={entry.id}
        onToggleReveal={() => undefined}
        onCopy={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );
    assert.match(table, /Key Entries/);
    assert.match(table, /sk-live/);
  });

  it("renders the toolbar counts", () => {
    const html = renderToStaticMarkup(
      <KeyEntryToolbar
        query="prod"
        onQueryChange={() => undefined}
        view="grid"
        onViewChange={() => undefined}
        facets={[{ key: "prod", label: "prod", count: 2 }]}
        tagCounts={new Map([["prod", 2]])}
        selectedTagKeys={["prod"]}
        onToggleTag={() => undefined}
        visibleCount={1}
        totalCount={4}
      />,
    );
    assert.match(html, /1 of 4 Key Entries/);
  });

  it("returns null when delete modal has no entry", () => {
    assert.equal(
      renderToStaticMarkup(
        <DeleteKeyEntryModal
          entry={null}
          onConfirm={async () => undefined}
          onClose={() => undefined}
        />,
      ),
      "",
    );
  });
});

describe("settings cards", () => {
  it("renders section and card chrome", () => {
    assert.match(
      renderToStaticMarkup(
        <SettingsSection title="Vault" description="desc">
          <p>child</p>
        </SettingsSection>,
      ),
      /Vault/,
    );
    assert.doesNotMatch(
      renderToStaticMarkup(<SettingsSection title="Bare">x</SettingsSection>),
      /desc/,
    );
    assert.match(
      renderToStaticMarkup(
        <SettingsCard title="Card" description="why">
          inner
        </SettingsCard>,
      ),
      /why/,
    );
    assert.doesNotMatch(
      renderToStaticMarkup(<SettingsCard title="Card">inner</SettingsCard>),
      /why/,
    );
  });

  it("renders backup export empty and ready states", () => {
    assert.match(
      renderToStaticMarkup(
        <BackupExportCard entryCount={0} busy={false} onExport={async () => ({ fileName: "x", entryCount: 0 })} />,
      ),
      /Nothing to back up yet/,
    );
    assert.match(
      renderToStaticMarkup(
        <BackupExportCard
          entryCount={2}
          busy={false}
          onExport={async () => ({ fileName: "x", entryCount: 2 })}
        />,
      ),
      /Export backup/,
    );
  });

  it("renders import, password, recovery, and timeout cards", () => {
    assert.match(
      renderToStaticMarkup(
        <BackupImportCard busy={false} onImport={async () => ({ imported: 0, skipped: 0 })} />,
      ),
      /Import backup/,
    );
    assert.match(
      renderToStaticMarkup(
        <ChangeMasterPasswordCard
          busy
          error="failed"
          progress="Deriving…"
          onChangePassword={async () => undefined}
        />,
      ),
      /Deriving/,
    );
    assert.match(
      renderToStaticMarkup(
        remainingCodesSummary(null, true) as never,
      ),
      /Loading/,
    );
    assert.equal(remainingCodesSummary(null, false), null);
    assert.match(
      renderToStaticMarkup(remainingCodesSummary(1, false) as never),
      /code remaining/,
    );
    assert.match(
      renderToStaticMarkup(remainingCodesSummary(4, false) as never),
      /codes remaining/,
    );
    assert.match(
      renderToStaticMarkup(
        <RecoveryCodesCard
          remaining={4}
          loadingRemaining={false}
          busy
          error="nope"
          progress="Saving…"
          onRegenerate={async () => undefined}
        />,
      ),
      /Saving/,
    );
    const panel = renderToStaticMarkup(
      <RecoveryCodesPanel
        codes={["AAAAA11111BBBBB22222"]}
        onAcknowledged={() => undefined}
      />,
    );
    assert.match(panel, /Download again/);
    assert.match(panel, /Done/);
    assert.match(
      renderToStaticMarkup(
        <SessionTimeoutCard
          settings={{
            loading: true,
            sessionIdleMinutes: null,
            sessionIdleSource: null,
            saveBusy: false,
            error: null,
            success: false,
          }}
          onSessionIdleMinutesChange={() => undefined}
          onSave={async () => undefined}
          onClearSuccess={() => undefined}
        />,
      ),
      /Loading session settings/,
    );
    assert.match(
      renderToStaticMarkup(
        <SessionTimeoutCard
          settings={{
            loading: false,
            sessionIdleMinutes: 20,
            sessionIdleSource: "env",
            saveBusy: false,
            error: null,
            success: false,
          }}
          onSessionIdleMinutesChange={() => undefined}
          onSave={async () => undefined}
          onClearSuccess={() => undefined}
        />,
      ),
      /KEYPAGE_SESSION_IDLE_MINUTES/,
    );
    const form = renderToStaticMarkup(
      <SessionTimeoutCard
        settings={{
          loading: false,
          sessionIdleMinutes: 20,
            sessionIdleSource: "database",
          saveBusy: false,
          error: "could not save",
          success: true,
        }}
        onSessionIdleMinutesChange={() => undefined}
        onSave={async () => undefined}
        onClearSuccess={() => undefined}
      />,
    );
    assert.match(form, /could not save/);
    assert.match(form, /Session timeout saved/);
  });
});
