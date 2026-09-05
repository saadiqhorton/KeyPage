import { cn } from "@/lib/cn";

type SpinnerProps = {
  size?: "sm" | "md";
  className?: string;
  label?: string;
};

const sizeClasses = {
  sm: "size-3.5 border",
  md: "size-5 border-2",
};

export function Spinner({ size = "md", className, label = "Loading" }: Readonly<SpinnerProps>) {
  return (
    <output
      aria-label={label}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-brass/30 border-t-brass",
        sizeClasses[size],
        className,
      )}
    />
  );
}
