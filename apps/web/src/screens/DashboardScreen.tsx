import { StatusPanel } from "@/components/StatusPanel";
import { useHealth } from "@/hooks/useHealth";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const health = useHealth();
  const { actions } = useVault();

  return (
    <main className="flex min-h-dvh flex-col justify-between gap-16 px-6 py-12 md:px-12 md:py-16 lg:px-20">
      <div className="flex flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl">KeyPage Dashboard</h1>
          <button type="button" onClick={() => void actions.lock("manual")}>
            Lock vault
          </button>
        </header>
        <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-lg">Your vault is empty</p>
          <p className="text-muted">
            Key Entries will live here — locked in your browser before they reach the server.
          </p>
          <button type="button" disabled aria-describedby="add-key-caption">
            Add your first API key
          </button>
          <p id="add-key-caption" className="text-sm text-muted">
            Adding Key Entries arrives in the next release.
          </p>
        </section>
      </div>
      <StatusPanel health={health} />
    </main>
  );
}
