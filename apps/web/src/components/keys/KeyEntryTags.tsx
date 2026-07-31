import { cn } from "@/lib/cn";

type KeyEntryTagsProps = {
  tags: string[];
  max?: number;
  className?: string;
};

export function KeyEntryTags({ tags, max, className }: KeyEntryTagsProps) {
  if (tags.length === 0) {
    return null;
  }

  const visible = max === undefined ? tags : tags.slice(0, max);
  const overflow = max === undefined ? 0 : Math.max(0, tags.length - max);

  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Tags">
      {visible.map((tag) => (
        <li
          key={tag}
          className="rounded-sm border border-brass/25 bg-brass/10 px-2 py-0.5 font-mono text-[11px] text-brass"
        >
          {tag}
        </li>
      ))}
      {overflow > 0 ? (
        <li className="font-mono text-[11px] text-muted">+{overflow}</li>
      ) : null}
    </ul>
  );
}
