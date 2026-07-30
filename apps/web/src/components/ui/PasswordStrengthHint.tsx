import { cn } from "@/lib/cn";

const MIN_LENGTH = 12;

type PasswordStrengthHintProps = {
  password: string;
  className?: string;
};

type Check = {
  label: string;
  met: boolean;
};

function getChecks(password: string): Check[] {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  return [
    {
      label: `At least ${MIN_LENGTH} characters`,
      met: password.length >= MIN_LENGTH,
    },
    {
      label: "Mix of character types (letters, numbers, symbols)",
      met: classCount >= 2,
    },
  ];
}

export function PasswordStrengthHint({ password, className }: PasswordStrengthHintProps) {
  if (!password) return null;

  const checks = getChecks(password);
  const allMet = checks.every((check) => check.met);

  return (
    <ul
      className={cn("space-y-1.5 text-xs", className)}
      aria-live="polite"
      aria-label="Password strength"
    >
      {checks.map((check) => (
        <li
          key={check.label}
          className={cn(
            "flex items-start gap-2",
            check.met ? "text-success" : "text-muted",
          )}
        >
          <span aria-hidden="true" className="mt-0.5 font-mono text-[0.65rem]">
            {check.met ? "✓" : "·"}
          </span>
          <span>{check.label}</span>
        </li>
      ))}
      {allMet ? (
        <li className="text-success">Strong enough for KeyPage.</li>
      ) : null}
    </ul>
  );
}

export function isPasswordStrongEnough(password: string): boolean {
  return getChecks(password).every((check) => check.met);
}
