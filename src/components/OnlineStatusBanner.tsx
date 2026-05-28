"use client";

import { useSyncExternalStore } from "react";

/**
 * 네트워크 오프라인일 때만 얇은 안내 띠를 표시.
 * 본 앱은 localStorage 기반이라 오프라인에서도 정상 동작하므로,
 * 사용자가 불안해하지 않도록 안심 문구를 보여준다.
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

type Props = {
  /**
   * 이 배너가 화면 최상단에 위치할 때(=위에 AppHeader 같은 safe-area 처리
   * 요소가 없을 때) true로 둔다. iOS 노치 영역을 배너가 직접 처리하도록
   * pt를 safe-area-inset-top로 확장한다. 홈 화면처럼 헤더 아래에 둘 때는
   * false(기본값)를 유지해 헤더가 이미 처리한 safe-area를 중복 적용하지
   * 않는다.
   */
  topmost?: boolean;
};

export default function OnlineStatusBanner({ topmost = false }: Props) {
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
      className={`flex items-center justify-center gap-2 border-b border-border-default bg-warning-bg px-3 pb-2 text-[13px] font-medium text-text-primary ${
        topmost ? "pt-[max(0.5rem,env(safe-area-inset-top))]" : "pt-2"
      }`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
      />
      오프라인이에요. 기록은 이 기기에 그대로 저장돼요.
    </div>
  );
}
