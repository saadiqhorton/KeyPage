import { ShellHero } from "@/components/ShellHero";
import { StatusPanel } from "@/components/StatusPanel";
import { useHealth } from "@/hooks/useHealth";

export default function App() {
  const health = useHealth();

  return (
    <main className="flex min-h-dvh flex-col justify-between gap-16 px-6 py-12 md:px-12 md:py-16 lg:px-20">
      <ShellHero />
      <StatusPanel health={health} />
    </main>
  );
}
