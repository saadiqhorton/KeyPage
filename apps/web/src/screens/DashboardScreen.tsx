import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { KeyEntry } from "@keypage/shared";

import { DeleteKeyEntryModal } from "@/components/keys/DeleteKeyEntryModal";
import { KeyEntryCardGrid } from "@/components/keys/KeyEntryCardGrid";
import { KeyEntryList } from "@/components/keys/KeyEntryList";
import { KeyEntryModal } from "@/components/keys/KeyEntryModal";
import { KeyEntryTable } from "@/components/keys/KeyEntryTable";
import { KeyEntryToolbar } from "@/components/keys/KeyEntryToolbar";
import { NoFilterMatchesState } from "@/components/keys/NoFilterMatchesState";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyVaultState } from "@/components/EmptyVaultState";
import { IdleWarningToast } from "@/components/IdleWarningToast";
import { StatusPanel } from "@/components/StatusPanel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";
import { Toast } from "@/components/ui/Toast";
import { useKeyEntryView } from "@/hooks/useKeyEntryView";
import { useHealth } from "@/hooks/useHealth";
import { useToast } from "@/hooks/useToast";
import { formatCountdown } from "@/lib/format";
import {
  collectTagFacets,
  filterByQuery,
  filterByTags,
  toggleTagKey,
} from "@/lib/key-entry-filter";
import { useIdleLock } from "@/vault/useIdleLock";
import { useKeyEntries } from "@/vault/useKeyEntries.js";
import { useKeyEntrySecret } from "@/vault/useKeyEntrySecret.js";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const navigate = useNavigate();
  const health = useHealth();
  const { state, actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();
  const vaultUnlocked = state.phase === "unlocked";
  const { status, entries, error, createKeyEntry, updateKeyEntry, deleteKeyEntry, clipboardClearMs, markUsed } =
    useKeyEntries(vaultUnlocked);
  const { toast, showToast } = useToast();
  const {
    revealedId,
    revealedValue,
    busyId,
    toggleReveal,
    copy,
    hideAll,
  } = useKeyEntrySecret({
    clipboardClearMs,
    markUsed,
    onCopied: (message) => {
      showToast(message, "default", 4500);
    },
    onError: (message) => {
      showToast(message, "danger", 4500);
    },
  });
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<KeyEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<KeyEntry | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
  const { view, setView } = useKeyEntryView();

  const actionProps = useMemo(
    () => ({
      onEdit: (entry: KeyEntry) => setEditEntry(entry),
      onDelete: (entry: KeyEntry) => setDeleteEntry(entry),
    }),
    [],
  );

  const revealProps = useMemo(
    () => ({
      revealedId,
      revealedValue,
      busyId,
      onToggleReveal: toggleReveal,
      onCopy: copy,
    }),
    [revealedId, revealedValue, busyId, toggleReveal, copy],
  );

  useEffect(() => {
    if (!vaultUnlocked) {
      hideAll();
    }
  }, [vaultUnlocked, hideAll]);

  useEffect(() => {
    hideAll();
  }, [view, hideAll]);

  useEffect(() => {
    hideAll();
  }, [query, selectedTagKeys, hideAll]);

  const facets = useMemo(() => collectTagFacets(entries), [entries]);
  const facetKeys = useMemo(() => new Set(facets.map((facet) => facet.key)), [facets]);
  const activeTagKeys = useMemo(
    () => selectedTagKeys.filter((key) => facetKeys.has(key)),
    [selectedTagKeys, facetKeys],
  );
  const queryFiltered = useMemo(() => filterByQuery(entries, query), [entries, query]);
  const tagCounts = useMemo(
    () => new Map(collectTagFacets(queryFiltered).map((facet) => [facet.key, facet.count])),
    [queryFiltered],
  );
  const visible = useMemo(
    () => filterByTags(queryFiltered, activeTagKeys),
    [queryFiltered, activeTagKeys],
  );

  function openAddKey() {
    setAddKeyOpen(true);
  }

  function clearFilters() {
    setQuery("");
    setSelectedTagKeys([]);
  }

  function handleToggleTag(key: string) {
    setSelectedTagKeys((current) => toggleTagKey(current, key));
  }

  const showToolbar = vaultUnlocked && status === "ready" && entries.length > 0;

  let content: ReactNode;

  if (!vaultUnlocked || status === "loading") {
    content = (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner label="Loading key entries" />
      </div>
    );
  } else if (status === "error") {
    content = (
      <Callout tone="danger">{error ?? "Failed to load key entries."}</Callout>
    );
  } else if (entries.length === 0) {
    content = <EmptyVaultState onAddKey={openAddKey} />;
  } else if (visible.length === 0) {
    content = <NoFilterMatchesState onClearFilters={clearFilters} />;
  } else if (view === "table") {
    content = <KeyEntryTable entries={visible} {...revealProps} {...actionProps} />;
  } else if (view === "list") {
    content = <KeyEntryList entries={visible} {...revealProps} {...actionProps} />;
  } else {
    content = <KeyEntryCardGrid entries={visible} {...revealProps} {...actionProps} />;
  }

  const headerActions =
    vaultUnlocked && status === "ready" ? (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("/settings")}
        >
          Settings
        </Button>
        {entries.length > 0 ? (
          <Button size="sm" onClick={openAddKey}>
            Add Key
          </Button>
        ) : null}
      </>
    ) : null;

  const toolbar = showToolbar ? (
    <KeyEntryToolbar
      query={query}
      onQueryChange={setQuery}
      view={view}
      onViewChange={setView}
      facets={facets}
      tagCounts={tagCounts}
      selectedTagKeys={activeTagKeys}
      onToggleTag={handleToggleTag}
      visibleCount={visible.length}
      totalCount={entries.length}
    />
  ) : null;

  return (
    <>
      <DashboardShell
        onLock={() => void actions.lock("manual")}
        idleCountdown={
          warningVisible ? formatCountdown(secondsRemaining) : null
        }
        actions={headerActions}
        footer={<StatusPanel health={health} />}
        content={content}
      >
        {toolbar}
      </DashboardShell>
      <IdleWarningToast
        visible={warningVisible}
        secondsRemaining={secondsRemaining}
        onStayUnlocked={stayUnlocked}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
      <KeyEntryModal
        open={addKeyOpen}
        mode="create"
        onClose={() => setAddKeyOpen(false)}
        onSubmit={createKeyEntry}
      />
      <KeyEntryModal
        open={editEntry !== null}
        mode="edit"
        entry={editEntry}
        onClose={() => setEditEntry(null)}
        onSubmit={async (values) => {
          if (!editEntry) return;
          await updateKeyEntry(editEntry.id, values);
          hideAll();
          showToast("Key Entry updated", "default", 4500);
        }}
      />
      <DeleteKeyEntryModal
        entry={deleteEntry}
        onClose={() => setDeleteEntry(null)}
        onConfirm={async (entry) => {
          await deleteKeyEntry(entry.id);
          hideAll();
          showToast("Key Entry deleted", "default", 4500);
          setDeleteEntry(null);
        }}
      />
    </>
  );
}
