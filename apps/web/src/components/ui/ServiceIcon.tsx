import { getService } from "@keypage/shared";

import { cn } from "@/lib/cn";

type ServiceIconSize = "sm" | "md";

type ServiceIconProps = {
  serviceId: string;
  /**
   * Effective display name of the service (e.g. the custom service name).
   * Only used for custom services; branded built-ins keep their catalog
   * monogram.
   */
  displayName?: string;
  size?: ServiceIconSize;
  className?: string;
};

const sizeClasses: Record<ServiceIconSize, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
};

export function monogram(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase();
  }
  return (words[0]?.[0] ?? "?").toUpperCase();
}

export function customBadge(displayName: string): string {
  const match = displayName.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "?";
}

export function ServiceIcon({
  serviceId,
  displayName,
  size = "md",
  className,
}: Readonly<ServiceIconProps>) {
  const entry = getService(serviceId);
  const glyph =
    entry.id === "custom" && displayName !== undefined
      ? customBadge(displayName)
      : monogram(entry.displayName);

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm border font-mono font-semibold uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        sizeClasses[size],
        className,
      )}
      style={{
        borderColor: `${entry.accent}55`,
        backgroundColor: `${entry.accent}14`,
        color: entry.accent,
      }}
    >
      {glyph}
    </span>
  );
}
