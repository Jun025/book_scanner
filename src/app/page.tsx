"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import ClipboardIcon from "@/components/ClipboardIcon";
import OnlineStatusBanner from "@/components/OnlineStatusBanner";
import Scanner from "@/components/Scanner";
import {
  buildAllSessionsText,
  buildExportFilename,
  type ExportResult,
  shareOrCopyOrDownload,
} from "@/lib/exportSessions";
import {
  countSessionLines,
  toPlainSessionText,
} from "@/lib/sessionText";
import {
  deleteSessionKey,
  listSessionStorageKeys,
  readSessionRaw,
  removeSessionKeysWithZeroBarcodes,
  useScannerStore,
  writeSessionRaw,
} from "@/store/useScannerStore";

function formatSessionLabel(key: string): string {
  const iso = key.slice("book-scanner:session:".length);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return key;

  const time = d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (today.getTime() - target.getTime()) / 86_400_000
  );

  if (dayDiff === 0) return `오늘 ${time}`;
  if (dayDiff === 1) return `어제 ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
  }
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
}

type Screen = "main" | "scan" | "list" | "detail";

function screenFromState(state: unknown): Screen | null {
  if (!state || typeof state !== "object") return null;
  const maybe = (state as { screen?: unknown }).screen;
  if (
    maybe === "main" ||
    maybe === "scan" ||
    maybe === "list" ||
    maybe === "detail"
  ) {
    return maybe;
  }
  return null;
}

/** popstate 직후 동기 history.back()은 무시되는 경우가 있어 비동기로 한 번 더 시도한다. */
function scheduleLeaveHostedApp(resetSkipFlag: () => void) {
  window.setTimeout(() => {
    window.history.back();
    window.setTimeout(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        const n = window.history.length;
        if (n > 1) {
          window.history.go(1 - n);
        }
        window.setTimeout(() => {
          window.history.back();
          try {
            window.close();
          } catch {
            /* 일부 브라우저·PWA는 close를 허용하지 않음 */
          }
        }, 0);
      }
      resetSkipFlag();
    }, 200);
  }, 0);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12l5 5L20 7" />
  </svg>
);

export default function Home() {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const beginInventorySession = useScannerStore((s) => s.beginInventorySession);

  const [isScanMode, setIsScanMode] = useState(false);
  const [adminView, setAdminView] = useState<"main" | "list" | "detail">(
    "main"
  );
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [copyDone, setCopyDone] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  /** 점검 종료 직후 자동으로 해당 세션 상세로 보냈을 때, 상세 화면 상단에
      "사서께 전달하려면 복사하세요" 안내 배너를 한 번만 띄우기 위한 플래그. */
  const [justFinishedSession, setJustFinishedSession] = useState(false);
  /** B-3 전체 내보내기 결과 — 버튼 라벨을 잠시 결과 문구로 바꿔 사용자가
      어떤 경로(공유 시트/클립보드/파일)로 처리됐는지 인지하게 한다. */
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const timerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const exportTimerRef = useRef<number | null>(null);
  /** `scheduleLeaveHostedApp`이 연쇄 popstate를 일으킬 때 재진입 방지 */
  const skipLeaveEchoRef = useRef(false);
  const didSetupHistoryRef = useRef(false);

  const applyScreen = useCallback(
    (screen: Screen) => {
      if (screen === "scan") {
        if (!activeSessionKey) {
          beginInventorySession();
        }
        setIsScanMode(true);
        return;
      }
      setIsScanMode(false);
      setAdminView(screen);
    },
    [activeSessionKey, beginInventorySession]
  );

  const pushScreenHistory = useCallback((screen: Screen) => {
    if (typeof window === "undefined") return;
    window.history.pushState({ screen }, "", window.location.href);
  }, []);

  const refreshList = useCallback(() => {
    setSessionKeys(listSessionStorageKeys());
  }, []);

  useLayoutEffect(() => {
    if (isScanMode || adminView !== "main") return;
    removeSessionKeysWithZeroBarcodes();
    /* 메인 진입 시 빈 세션 정리 후 카운트가 paint 직전에 동기 반영되어야 한다 — 의도된 useLayoutEffect 동기 setState */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionKeys(listSessionStorageKeys());
  }, [isScanMode, adminView]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (savedTimerRef.current !== null)
        window.clearTimeout(savedTimerRef.current);
      if (exportTimerRef.current !== null)
        window.clearTimeout(exportTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || didSetupHistoryRef.current) return;
    didSetupHistoryRef.current = true;
    window.history.replaceState({ screen: "main", root: true }, "", window.location.href);
    window.history.pushState({ screen: "main", guard: true }, "", window.location.href);
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const targetScreen = screenFromState(event.state);
      if (!targetScreen) return;

      if (targetScreen === "main") {
        setIsScanMode(false);
        setAdminView("main");
        const isRootState =
          !!event.state &&
          typeof event.state === "object" &&
          (event.state as { root?: boolean }).root === true;

        if (isRootState) {
          const skipEcho = skipLeaveEchoRef.current;
          skipLeaveEchoRef.current = false;
          if (skipEcho) return;

          skipLeaveEchoRef.current = true;
          scheduleLeaveHostedApp(() => {
            skipLeaveEchoRef.current = false;
          });
          return;
        }
        return;
      }

      applyScreen(targetScreen);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyScreen]);

  const startWork = () => {
    beginInventorySession();
    setIsScanMode(true);
    pushScreenHistory("scan");
  };

  const openDetail = (key: string) => {
    setSelectedKey(key);
    setSelectedText(readSessionRaw(key));
    setCopyDone(false);
    setSavedAt(0);
    setJustFinishedSession(false);
    setAdminView("detail");
    pushScreenHistory("detail");
  };

  const onChangeDetail = (value: string) => {
    if (!selectedKey) return;
    setSelectedText(value);
    writeSessionRaw(selectedKey, value);
    refreshList();
    setSavedAt(Date.now());
    if (savedTimerRef.current !== null)
      window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setSavedAt(0), 1200);
  };

  const onDelete = () => {
    if (!selectedKey) return;
    if (
      !window.confirm(
        "이 점검 기록을 지울까요?\n지우면 이 기기에서 다시 살릴 수 없어요."
      )
    )
      return;
    deleteSessionKey(selectedKey);
    setSelectedKey(null);
    setSelectedText("");
    refreshList();
    setAdminView("list");
    /* detail 진입 시 push했던 히스토리 항목을 정리한다.
       이 호출이 없으면 뒤로가기 시 popstate가 selectedKey=null 상태의 detail로
       돌아가서 빈 화면이 표시된다. */
    window.history.back();
  };

  const onExportAll = async () => {
    const text = buildAllSessionsText(sessionKeys);
    if (!text) return;
    const filename = buildExportFilename();
    const result = await shareOrCopyOrDownload(text, filename);
    if (result === "cancelled") return;
    setExportResult(result);
    if (exportTimerRef.current !== null)
      window.clearTimeout(exportTimerRef.current);
    exportTimerRef.current = window.setTimeout(
      () => setExportResult(null),
      2200
    );
  };

  const onCopy = async () => {
    const plain = toPlainSessionText(selectedText);
    if (!plain) return;
    try {
      await copyText(plain);
      setCopyDone(true);
      /* B-2 배너는 "복사하세요"가 목적이었으므로 복사가 끝나면 임무 완수.
         자동으로 사라져 화면을 깔끔하게 한다. */
      setJustFinishedSession(false);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      window.alert("복사가 안 됐어요. 글씨를 길게 눌러 직접 복사해요.");
    }
  };

  const selectedCount = useMemo(
    () => countSessionLines(selectedText),
    [selectedText]
  );
  const totalRecords = sessionKeys.length;
  const canCopyDetail = useMemo(
    () => toPlainSessionText(selectedText).length > 0,
    [selectedText]
  );
  /** 리스트 화면 렌더마다 모든 항목에 대해 localStorage.getItem을 다시 부르지 않도록 한 번에 계산해 캐시. */
  const sessionLineCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const key of sessionKeys) {
      out[key] = countSessionLines(readSessionRaw(key));
    }
    return out;
  }, [sessionKeys]);

  if (isScanMode) {
    return (
      <main className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-base text-text-primary">
        <Scanner
          onExitSession={(preservedKey) => {
            setIsScanMode(false);
            refreshList();
            if (preservedKey) {
              /* B-2: 1줄 이상 기록이 남은 채 종료한 경우 메인이 아니라 그
                 세션의 상세로 바로 보낸다 — 메인의 안내 배너로 사용자가
                 바로 복사할 수 있게 백업을 강하게 권유한다. 모달이 아닌
                 화면 전환이라 .cursorrules의 "확인 없이 즉시 종료" 원칙과
                 충돌하지 않는다. history는 scan 항목을 replaceState로
                 detail 항목으로 바꿔, 사용자가 뒤로가기 한 번이면 메인
                 으로 자연스럽게 돌아가게 한다. */
              setSelectedKey(preservedKey);
              setSelectedText(readSessionRaw(preservedKey));
              setCopyDone(false);
              setSavedAt(0);
              setJustFinishedSession(true);
              setAdminView("detail");
              if (typeof window !== "undefined") {
                window.history.replaceState(
                  { screen: "detail" },
                  "",
                  window.location.href
                );
              }
              return;
            }
            /* 권수 0이면 빈 세션 자동 정리 경로 — 종래대로 메인으로. */
            setAdminView("main");
            window.history.back();
          }}
        />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-base text-text-primary">
      {adminView === "main" && (
        <>
          <AppHeader />
          <OnlineStatusBanner />
        </>
      )}

      <div
        className={`mx-auto flex min-h-0 w-full max-w-[var(--container-max)] flex-1 flex-col px-5 pb-6 ${
          adminView === "main"
            ? "pt-4"
            : "pt-[max(0.75rem,env(safe-area-inset-top))]"
        }`}
      >
        {adminView === "main" && (
          <section className="flex min-h-0 flex-1 flex-col gap-5">
            <div>
              <p className="text-[13px] font-semibold text-brand-text">
                오늘도 잘 와주었어요
              </p>
              <h2 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-text-primary">
                책을 한 권씩 찬찬히 점검해볼까요?
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">
                사서교사 민경 선생님과 함께 도서관을 돌보는 빛나래의 점검
                도구예요. 바코드를 찍을 때마다 이 기기에 바로 저장돼요.
              </p>
            </div>

            <div
              className="rounded-2xl bg-bg-subtle p-4"
              aria-label="이용 안내"
            >
              <ul className="space-y-2.5 text-[13px] leading-relaxed text-text-secondary">
                <li className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  />
                  <span>
                    <span className="font-semibold text-text-primary">
                      장서점검 시작
                    </span>
                    을 누른 뒤에만 카메라가 켜져요.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  />
                  <span>
                    <span className="font-semibold text-text-primary">
                      숫자만
                    </span>{" "}
                    있는 바코드가 저장돼요. (QR이나 글자 섞인 코드는 넘어가요.)
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  />
                  <span>
                    기록은 이 기기에만 남아요. Wi-Fi가 끊겨도 찍은 순간부터
                    저장돼요.
                  </span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={startWork}
              className="press flex min-h-[52px] items-center justify-center rounded-xl bg-brand px-4 py-3.5 text-[16px] font-semibold text-text-on-brand shadow-md hover:bg-brand-hover"
            >
              장서점검 시작
            </button>

            <button
              type="button"
              onClick={() => {
                setAdminView("list");
                pushScreenHistory("list");
              }}
              className="press flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-bg-input px-4 py-3.5 text-[15px] font-semibold text-text-primary active:bg-border-default"
              aria-label={`지난 점검 기록 ${totalRecords}개 보기`}
            >
              <span className="inline-flex items-center gap-2">
                지난 점검 기록
                {totalRecords > 0 && (
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-subtle px-2 text-[12px] font-bold text-brand-text">
                    {totalRecords}
                  </span>
                )}
              </span>
              <ChevronRightIcon className="h-5 w-5 text-text-tertiary" />
            </button>
          </section>
        )}

        {adminView === "list" && (
          <section className="flex min-h-0 flex-1 flex-col">
            <header className="flex items-center gap-1 pb-3">
              <button
                type="button"
                onClick={() => window.history.back()}
                aria-label="뒤로 가기"
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-bg-subtle"
              >
                <ChevronLeftIcon className="h-6 w-6 text-text-primary" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[18px] font-bold text-text-primary">
                  지난 점검 기록
                </h2>
                <p className="text-[12px] text-text-tertiary">
                  눌러서 내용을 보거나 복사해요
                </p>
              </div>
            </header>

            {sessionKeys.length > 0 && (
              <button
                type="button"
                onClick={onExportAll}
                aria-label={`저장된 점검 기록 ${sessionKeys.length}개를 한 번에 보내기`}
                aria-live="polite"
                className={`press mb-3 flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold ${
                  exportResult && exportResult !== "failed"
                    ? "bg-accent text-text-on-brand"
                    : exportResult === "failed"
                      ? "bg-danger-bg text-danger"
                      : "bg-bg-input text-text-primary active:bg-border-default"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 16V4" />
                  <path d="M5 11l7-7 7 7" />
                  <path d="M5 20h14" />
                </svg>
                {exportResult === "shared"
                  ? "공유 시트를 열었어요"
                  : exportResult === "copied"
                    ? "전체 기록을 복사했어요"
                    : exportResult === "downloaded"
                      ? "파일로 저장했어요"
                      : exportResult === "failed"
                        ? "내보내기가 안 됐어요. 잠시 후 다시 시도해주세요"
                        : `전체 ${sessionKeys.length}개 한 번에 보내기`}
              </button>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {sessionKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <div
                    aria-hidden
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-subtle"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-8 w-8 text-brand"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <p className="text-[15px] font-semibold text-text-primary">
                    아직 점검한 책이 없어요
                  </p>
                  <p className="max-w-xs text-[13px] leading-relaxed text-text-secondary">
                    장서점검을 시작하면 끝낸 점검이 날짜별로 여기에 쌓여요.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2 pb-2">
                  {sessionKeys.map((key) => {
                    const count = sessionLineCounts[key] ?? 0;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => openDetail(key)}
                          className="press flex w-full items-center gap-3 rounded-2xl bg-bg-subtle px-4 py-3.5 text-left active:bg-bg-input"
                        >
                          <div
                            aria-hidden
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-5 w-5 text-brand"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold text-text-primary">
                              {formatSessionLabel(key)}
                            </p>
                            <p className="text-[12px] tabular-nums text-text-tertiary">
                              {count}권 점검
                            </p>
                          </div>
                          <ChevronRightIcon className="h-5 w-5 shrink-0 text-text-tertiary" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {adminView === "detail" && selectedKey && (
          <section className="flex min-h-0 flex-1 flex-col">
            <header className="flex items-center gap-1 pb-3">
              <button
                type="button"
                onClick={() => window.history.back()}
                aria-label="뒤로 가기"
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-bg-subtle"
              >
                <ChevronLeftIcon className="h-6 w-6 text-text-primary" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold text-text-primary">
                  {formatSessionLabel(selectedKey)}
                </h2>
                <p className="text-[12px] tabular-nums text-text-tertiary">
                  바코드 {selectedCount}권
                </p>
              </div>
            </header>

            {justFinishedSession && selectedCount > 0 && (
              <div
                role="status"
                className="mb-3 rounded-xl bg-brand-subtle px-4 py-3 text-[13px] leading-relaxed text-brand-text"
              >
                방금 점검한{" "}
                <span className="font-bold tabular-nums">{selectedCount}권</span>
                이 저장됐어요. 사서 선생님께 전달하려면 아래{" "}
                <span className="font-bold">복사 버튼</span>을 눌러주세요.
              </div>
            )}

            <div className="flex flex-col gap-2.5 pb-3">
              <button
                type="button"
                onClick={onCopy}
                disabled={!canCopyDetail}
                title={
                  canCopyDetail
                    ? undefined
                    : "복사할 번호가 없어요. 먼저 점검을 진행하거나 아래에 번호를 적어 주세요."
                }
                aria-live="polite"
                className={`press flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  copyDone
                    ? "bg-accent text-text-on-brand"
                    : "bg-brand text-text-on-brand hover:bg-brand-hover"
                }`}
              >
                {copyDone ? (
                  <CheckIcon className="h-5 w-5 shrink-0" />
                ) : (
                  <ClipboardIcon className="h-5 w-5 shrink-0" />
                )}
                {copyDone ? "복사했어요" : "클립보드에 복사하기"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="press min-h-[52px] rounded-xl bg-bg-subtle px-5 text-[14px] font-semibold text-danger hover:bg-danger-bg"
              >
                이 점검 기록 지우기
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[12px] leading-relaxed text-text-tertiary">
                  한 줄에 번호 하나씩 적으면 복사할 때 깔끔해요.
                </p>
                <span
                  role="status"
                  aria-live="polite"
                  className={`shrink-0 text-[12px] font-medium text-accent-text transition-opacity duration-200 ${
                    savedAt > 0 ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {savedAt > 0 ? "저장됨" : ""}
                </span>
              </div>
              <textarea
                value={selectedText}
                onChange={(e) => onChangeDetail(e.target.value)}
                aria-label="점검 기록 편집"
                spellCheck={false}
                autoCorrect="off"
                autoComplete="off"
                className="h-full min-h-[40dvh] w-full resize-none rounded-xl border border-border-default bg-bg-input px-3.5 py-3 font-mono text-[15px] leading-relaxed tabular-nums text-text-primary outline-none focus:border-brand"
              />
            </div>
          </section>
        )}
      </div>

      <AppFooter className="mt-auto" />
    </main>
  );
}
