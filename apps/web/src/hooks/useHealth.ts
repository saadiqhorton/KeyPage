import { API_BASE, HEALTH_STATUS_OK, type HealthResponse } from "@keypage/shared";
import { useEffect, useState } from "react";

export type HealthState =
  | { status: "loading" }
  | { status: typeof HEALTH_STATUS_OK; data: HealthResponse }
  | { status: "error" };

export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/health`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as HealthResponse;
        if (!cancelled) {
          setState({ status: HEALTH_STATUS_OK, data });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
