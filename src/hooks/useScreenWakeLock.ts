"use client";

import { useEffect } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

/**
 * 활성화 동안 화면 꺼짐을 막는다. 미지원 브라우저는 조용히 무시.
 * 탭이 가려지면 시스템이 자동으로 release하므로, 다시 보일 때 재요청한다.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined") return;
    const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLockApi) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const next = await wakeLockApi.request("screen");
        if (cancelled) {
          try {
            await next.release();
          } catch {
            /* ignore */
          }
          return;
        }
        sentinel = next;
        next.addEventListener("release", onReleased);
      } catch {
        /* 권한 거부 / 미지원 등은 조용히 무시 */
      }
    };

    const release = async () => {
      const current = sentinel;
      sentinel = null;
      if (!current || current.released) return;
      try {
        current.removeEventListener("release", onReleased);
      } catch {
        /* ignore */
      }
      try {
        await current.release();
      } catch {
        /* ignore */
      }
    };

    function onReleased() {
      sentinel = null;
    }

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        if (!sentinel) void acquire();
      } else {
        void release();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [active]);
}
