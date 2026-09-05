import { cn } from "@/lib/cn";

type StepIndicatorProps = {
  steps: string[];
  currentStep: number;
  className?: string;
};

function stepTextClass(isCurrent: boolean, isComplete: boolean): string {
  if (isCurrent) {
    return "text-text";
  }
  if (isComplete) {
    return "text-muted";
  }
  return "text-muted/60";
}

export function StepIndicator({ steps, currentStep, className }: Readonly<StepIndicatorProps>) {
  return (
    <nav aria-label="Progress" className={cn("mb-6", className)}>
      <ol className="flex flex-col gap-2">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isComplete = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 text-xs",
                stepTextClass(isCurrent, isComplete),
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[0.65rem]",
                  isCurrent && "border-brass/60 bg-brass/15 text-brass",
                  isComplete && "border-success/40 bg-success/10 text-success",
                  !isCurrent && !isComplete && "border-hairline bg-obsidian/40",
                )}
                aria-hidden="true"
              >
                {isComplete ? "✓" : stepNumber}
              </span>
              <span className={cn(isCurrent && "font-medium")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
