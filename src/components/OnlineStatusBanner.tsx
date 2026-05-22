"use client";

import { useEffect, useState } from "react";

/**
 * 네트워크 오프라인일 때만 얇은 안내 띠를 표시.
 * 본 앱은 localStorage 기반이라 오프라인에서도 정상 동작하지만, 사용자가
 * "저장 안 되는 거 아닌가" 불안해하지 않도록 짧은 안심 문구를 보여준다.
 */
export default function OnlineStatusBanner() {
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setMounted(true);
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!mounted || online) return null;

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
