"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type ClientInfo = {
  browser: string;
  os: string;
  vibration: string;
};

const SERVER_INFO: ClientInfo = {
  browser: "확인 중...",
  os: "확인 중...",
  vibration: "확인 중...",
};

/** navigator 값은 마운트 후 변하지 않는다 — 모듈 캐시로 snapshot 동일성을 유지해 무한 렌더를 막는다. */
let cachedClientInfo: ClientInfo | null = null;

function detectBrowser(ua: string): string {
  const edge = ua.match(/Edg\/([\d.]+)/);
  if (edge) return `Edge ${edge[1]}`;
  const crios = ua.match(/CriOS\/([\d.]+)/);
  if (crios) return `Chrome ${crios[1]}`;
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  if (chrome) return `Chrome ${chrome[1]}`;
  const firefox = ua.match(/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/);
  if (firefox) return `Firefox ${firefox[1] ?? firefox[2]}`;
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  if (safari) return `Safari ${safari[1]}`;
  return "알 수 없는 브라우저";
}

function detectOs(ua: string): string {
  const ios = ua.match(/OS (\d+[_\d]*) like Mac OS X/);
  if (ios) return `iOS ${ios[1].replaceAll("_", ".")}`;
  const android = ua.match(/Android ([\d.]+)/);
  if (android) return `Android ${android[1]}`;
  const mac = ua.match(/Mac OS X ([\d_]+)/);
  if (mac) return `macOS ${mac[1].replaceAll("_", ".")}`;
  const windows = ua.match(/Windows NT ([\d.]+)/);
  if (windows) return `Windows NT ${windows[1]}`;
  return navigator.platform || "알 수 없는 OS";
}

function subscribeClientInfo(): () => void {
  return () => {};
}

function getClientInfoSnapshot(): ClientInfo {
  if (typeof navigator === "undefined") return SERVER_INFO;
  if (cachedClientInfo) return cachedClientInfo;
  cachedClientInfo = {
    browser: detectBrowser(navigator.userAgent),
    os: detectOs(navigator.userAgent),
    vibration: typeof navigator.vibrate === "function" ? "지원" : "미지원",
  };
  return cachedClientInfo;
}

function getClientInfoServerSnapshot(): ClientInfo {
  return SERVER_INFO;
}

export default function DebugInfoButton() {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const info = useSyncExternalStore(
    subscribeClientInfo,
    getClientInfoSnapshot,
    getClientInfoServerSnapshot
  );

  /* 다이얼로그 ARIA APG 패턴: ESC 닫기, Tab 트랩, 닫을 때 트리거로 포커스 복귀. */
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    /* 닫을 때 포커스를 돌려놓을 트리거를 effect 시점에 캡처해 두면
       cleanup 시 ref가 바뀌어도 동일 노드를 가리킬 수 있어요. */
    const trigger = triggerRef.current;

    const focusables = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    const initial = focusables();
    initial[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialog?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-label="기기 정보 열기"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="app-debug-info-dialog"
        onClick={() => setOpen(true)}
        className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-card text-text-secondary hover:border-brand hover:text-brand"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            id="app-debug-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-debug-info-title"
            className="w-full max-w-md rounded-2xl bg-bg-card p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="app-debug-info-title"
              className="text-[17px] font-bold text-text-primary"
            >
              기기 정보
            </h2>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-text-tertiary">브라우저</dt>
              <dd className="text-right text-text-secondary">{info.browser}</dd>
              <dt className="text-text-tertiary">OS</dt>
              <dd className="text-right text-text-secondary">{info.os}</dd>
              <dt className="text-text-tertiary">진동</dt>
              <dd className="text-right text-text-secondary">
                {info.vibration}
              </dd>
            </dl>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="press mt-5 min-h-[52px] w-full rounded-xl bg-bg-input px-4 text-[15px] font-semibold text-text-primary active:bg-border-default"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
