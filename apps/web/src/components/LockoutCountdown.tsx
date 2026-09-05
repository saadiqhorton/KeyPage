import { useEffect, useRef, useState } from "react";

import { Callout } from "@/components/ui/Callout";
import { formatCountdown } from "@/lib/format";

type LockoutCountdownProps = {
  retryAfterSeconds: number;
  onExpired?: () => void;
  label?: string;
};

export function LockoutCountdown({
  retryAfterSeconds,
  onExpired,
  label = "Too many attempts. Try again in",
}: Readonly<LockoutCountdownProps>) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil(retryAfterSeconds)),
  );
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    setRemaining(Math.max(0, Math.ceil(retryAfterSeconds)));
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (remaining <= 0) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onExpired?.();
      }
      return;
    }

    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [remaining, onExpired]);

  if (remaining <= 0) {
    return null;
  }

  return (
    <Callout tone="warning" className="font-mono text-sm" aria-live="polite">
      {label}{" "}
      <span className="tabular-nums text-brass">{formatCountdown(remaining)}</span>
    </Callout>
  );
}
