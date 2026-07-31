import { type ReactNode, useMemo, useState } from "react";

import { AddKeyModal } from "@/components/keys/AddKeyModal";
import { KeyEntryCardGrid } from "@/components/keys/KeyEntryCardGrid";
import { KeyEntryList } from "@/components/keys/KeyEntryList";
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
import { useKeyEntryView } from "@/hooks/useKeyEntryView";
import { useHealth } from "@/hooks/useHealth";
import { formatCountdown } from "@/lib/format";
import {
  collectTagFacets,
  filterByQuery,
  filterByTags,
  toggleTagKey,
} from "@/lib/key-entry-filter";
import { useIdleLock } from "@/vault/useIdleLock";
import { useKeyEntries } from "@/vault/useKeyEntries.js";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const health = useHealth();
  const { state, actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();
  const vaultUnlocked = state.phase === "unlocked";
  const { status, entries, error, createKeyEntry } = useKeyEntries(vaultUnlocked);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
  const { view, setView } = useKeyEntryView();

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
    content = <KeyEntryTable entries={visible} />;
  } else if (view === "list") {
    content = <KeyEntryList entries={visible} />;
  } else {
    content = <KeyEntryCardGrid entries={visible} />;
  }

  const headerActions =
    vaultUnlocked && status === "ready" && entries.length > 0 ? (
      <Button size="sm" onClick={openAddKey}>
        Add Key
      </Button>
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
      <AddKeyModal
        open={addKeyOpen}
        onClose={() => setAddKeyOpen(false)}
        onCreate={createKeyEntry}
      />
    </>
  );
}
