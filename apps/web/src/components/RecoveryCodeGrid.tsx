import { formatRecoveryCode } from "@keypage/shared";

import { cn } from "@/lib/cn";

type RecoveryCodeGridProps = {
  codes: string[];
  className?: string;
};

export function RecoveryCodeGrid({ codes, className }: Readonly<RecoveryCodeGridProps>) {
  return (
    <ol
      className={cn(
        "grid grid-cols-1 gap-2 sm:grid-cols-2",
        className,
      )}
    >
      {codes.map((code, index) => (
        <li
          key={code}
          className="rounded-sm border border-hairline bg-obsidian/50 px-3 py-2 font-mono text-xs tracking-wide text-text sm:text-[0.8rem]"
        >
          <span className="mr-2 text-muted">{String(index + 1).padStart(2, " ")}.</span>
          {formatRecoveryCode(code)}
        </li>
      ))}
    </ol>
  );
}
