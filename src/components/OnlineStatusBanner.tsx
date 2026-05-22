"use client";

import { useSyncExternalStore } from "react";

/**
 * 네트워크 오프라인일 때만 얇은 안내 띠를 표시.
 * 본 앱은 localStorage 기반이라 오프라인에서도 정상 동작하지만, 사용자가
 * "저장 안 되는 거 아닌가" 불안해하지 않도록 짧은 안심 문구를 보여준다.
 */
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getOnlineServerSnapshot(): boolean {
  /* SSR/하이드레이션 첫 렌더에서는 온라인으로 가정 — 클라이언트에서 즉시 보정된다 */
  return true;
}

export default function OnlineStatusBanner() {
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot
  );

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-500/30 bg-amber-950/70 px-3 py-1.5 text-center text-[11px] font-medium text-amber-100"
    >
      오프라인이에요. 스캔 기록은 이 기기에 그대로 저장돼요.
    </div>
  );
}
