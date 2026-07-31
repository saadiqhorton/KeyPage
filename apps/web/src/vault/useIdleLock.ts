import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getVaultSession, postVaultSessionTouch } from "@/lib/api.js";

import { useVault, type LockReason } from "./useVault.js";

const TICK_MS = 5_000;
const TOUCH_THROTTLE_MS = 60_000;
const HEARTBEAT_MS = 60_000;
const WARNING_LEAD_SECONDS = 60;

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "focus",
] as const;

const LISTENER_OPTIONS: AddEventListenerOptions = {
  passive: true,
  capture: true,
};

export type IdleLockState = {
  warningVisible: boolean;
  secondsRemaining: number;
  stayUnlocked: () => void;
};

export function useIdleLock(): IdleLockState {
  const { state, actions } = useVault();
  const enabled = state.phase === "unlocked";
  const idleTimeoutSeconds =
    state.phase === "unlocked" ? state.idleTimeoutSeconds : 0;

  const lastActivityRef = useRef(Date.now());
  const lastTouchAtRef = useRef(0);
  const lockingRef = useRef(false);

  const [warningVisible, setWarningVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const triggerLock = useCallback(
    async (reason: LockReason) => {
      if (lockingRef.current) return;
      lockingRef.current = true;
      setWarningVisible(false);
      setSecondsRemaining(0);
      await actions.lock(reason);
    },
    [actions],
  );

  const touchSession = useCallback(async () => {
    try {
      await postVaultSessionTouch();
      lastTouchAtRef.current = Date.now();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "session_expired" || error.code === "unauthenticated")
      ) {
        await triggerLock("session_expired");
      }
    }
  }, [triggerLock]);

  const stayUnlocked = useCallback(() => {
    registerActivity();
    setWarningVisible(false);
    setSecondsRemaining(0);
    void touchSession();
  }, [registerActivity, touchSession]);

  useEffect(() => {
    if (!enabled) {
      lockingRef.current = false;
      setWarningVisible(false);
      setSecondsRemaining(0);
      return;
    }

    const now = Date.now();
    lastActivityRef.current = now;
    lastTouchAtRef.current = now;
    lockingRef.current = false;

    const onActivity = () => {
      registerActivity();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        registerActivity();
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, LISTENER_OPTIONS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timeoutMs = idleTimeoutSeconds * 1000;
    const warningThresholdMs = Math.max(
      0,
      timeoutMs - WARNING_LEAD_SECONDS * 1000,
    );

    const tick = () => {
      const tickNow = Date.now();
      const idleMs = tickNow - lastActivityRef.current;

      if (idleMs >= timeoutMs) {
        void triggerLock("idle");
        return;
      }

      if (idleMs >= warningThresholdMs) {
        const remaining = Math.max(0, Math.ceil((timeoutMs - idleMs) / 1000));
        setWarningVisible(true);
        setSecondsRemaining(remaining);
      } else {
        setWarningVisible(false);
        setSecondsRemaining(0);
      }

      if (
        lastActivityRef.current > lastTouchAtRef.current &&
        tickNow - lastTouchAtRef.current >= TOUCH_THROTTLE_MS
      ) {
        void touchSession();
      }
    };

    tick();
    const tickId = window.setInterval(tick, TICK_MS);

    let heartbeatCancelled = false;

    const runHeartbeat = async () => {
      try {
        const session = await getVaultSession();
        if (heartbeatCancelled) return;
        if (!session.authenticated) {
          await triggerLock("session_expired");
        }
      } catch {
        // Network errors are ignored; the next heartbeat will retry.
      }
    };

    const heartbeatId = window.setInterval(() => {
      void runHeartbeat();
    }, HEARTBEAT_MS);

    return () => {
      heartbeatCancelled = true;
      window.clearInterval(tickId);
      window.clearInterval(heartbeatId);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, LISTENER_OPTIONS);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    enabled,
    idleTimeoutSeconds,
    registerActivity,
    touchSession,
    triggerLock,
  ]);

  return {
    warningVisible,
    secondsRemaining,
    stayUnlocked,
  };
}
