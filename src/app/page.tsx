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
  return d.toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
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

const SCHOOL_NAME =
  "동국대학교사범대학부속가람고등학교 도서관";
const CLUB_NAME = "도서부 동아리 빛나래";

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
  const timerRef = useRef<number | null>(null);
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
    setAdminView("detail");
    pushScreenHistory("detail");
  };

  const onChangeDetail = (value: string) => {
    if (!selectedKey) return;
    setSelectedText(value);
    writeSessionRaw(selectedKey, value);
    refreshList();
  };

  const onDelete = () => {
    if (!selectedKey) return;
    if (
      !window.confirm(
        "이 점검 기록을 삭제할까요?\n삭제하면 이 휴대폰에서 복구할 수 없어요."
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

  const onCopy = async () => {
    const plain = toPlainSessionText(selectedText);
    if (!plain) return;
    try {
      await copyText(plain);
      setCopyDone(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      window.alert("복사에 실패했습니다. 텍스트를 길게 눌러 직접 복사해 주세요.");
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
      <main className="relative flex min-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
        <Scanner
          onExitSession={() => {
            setIsScanMode(false);
            setAdminView("main");
            refreshList();
            window.history.back();
          }}
        />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <AppHeader />
      <OnlineStatusBanner />

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-5 pb-4 pt-2">
        {adminView === "main" && (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="rounded-3xl border border-amber-500/15 bg-linear-to-b from-zinc-900 via-zinc-900/95 to-zinc-950 p-5 shadow-2xl shadow-black/30 ring-1 ring-emerald-900/20 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
                {CLUB_NAME}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                {SCHOOL_NAME}
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                장서점검 안내
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                사서교사 민경 선생님과 함께 도서관을 돌보며, 빛나래 동아리
                활동으로 장서를 점검할 때 쓰는 도구예요. 바코드(숫자)를 찍을
                때마다 이 기기에 바로 쌓이고, 진행 방법이 헷갈리면 항상 선생님께
                여쭤 보세요. 데이터는 이 앱 안에서 복사한 뒤, 메신저로
                선생님께 붙여 넣어내면 돼요.
              </p>
            </div>

            <div
              className="mt-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3 sm:py-4"
              aria-label="이용 안내"
            >
              <p className="text-xs font-semibold text-zinc-200">
                이렇게 쓰면 편해요
              </p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
                <li className="flex gap-2">
                  <span className="shrink-0 text-emerald-400" aria-hidden>
                    ·
                  </span>
                  <span>
                    첫 화면에서는 카메라가 꺼져 있어요.{" "}
                    <span className="text-zinc-100">장서점검 시작</span>을 누른
                    뒤에만 켜져요.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 text-emerald-400" aria-hidden>
                    ·
                  </span>
                  <span>
                    저장되는 건 <span className="text-zinc-100">숫자만</span>{" "}
                    있는 바코드예요. (QR·글자 섞인 코드는 넘어가요.)
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0 text-emerald-400" aria-hidden>
                    ·
                  </span>
                  <span>
                    데이터는 이 브라우저 안(로컬)에만 남아요. Wi-Fi가 불안정해도
                    찍은 순간부터 저장돼요.
                  </span>
                </li>
              </ul>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={startWork}
                className="flex min-h-14 items-center justify-center rounded-3xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
              >
                장서점검 시작
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminView("list");
                  pushScreenHistory("list");
                }}
                className="flex min-h-14 items-center justify-center rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-base font-semibold text-zinc-100 active:bg-zinc-800"
              >
                지난 점검 기록
                {totalRecords > 0 ? ` (${totalRecords})` : ""}
              </button>
            </div>
          </section>
        )}

        {adminView === "list" && (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-3 sm:px-4">
              <button
                type="button"
                onClick={() => window.history.back()}
                className="flex min-h-12 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900 px-5 py-3 text-sm font-medium text-zinc-200 active:bg-zinc-800"
              >
                뒤로
              </button>
              <div className="min-w-0 flex-1 text-center">
                <h2 className="truncate text-base font-semibold text-zinc-100">
                  세션 관리 · 지난 점검
                </h2>
                <p className="text-[11px] text-zinc-400">
                  항목을 눌러 보기·편집·복사
                </p>
              </div>
              <span className="w-[64px] shrink-0 sm:w-[72px]" aria-hidden />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sessionKeys.length === 0 ? (
                <p className="px-4 py-6 text-sm leading-relaxed text-zinc-300">
                  아직 저장된 점검이 없어요.{" "}
                  <span className="text-zinc-100">장서점검 시작</span>으로
                  한 번 점검해 보면 여기에 날짜별로 쌓여요.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {sessionKeys.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => openDetail(key)}
                        className="flex min-h-[3.75rem] w-full flex-col items-start justify-center px-4 py-4 text-left active:bg-zinc-800/70"
                      >
                        <span className="text-sm font-semibold text-zinc-100">
                          {formatSessionLabel(key)}
                        </span>
                        <span className="text-xs text-zinc-400">
                          바코드 {sessionLineCounts[key] ?? 0}권
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {adminView === "detail" && selectedKey && (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-3 sm:px-4">
              <button
                type="button"
                onClick={() => window.history.back()}
                className="flex min-h-12 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900 px-5 py-3 text-sm font-medium text-zinc-200 active:bg-zinc-800"
              >
                뒤로
              </button>
              <div className="min-w-0 flex-1 text-center">
                <h2 className="truncate text-sm font-semibold text-zinc-100">
                  {formatSessionLabel(selectedKey)}
                </h2>
                <p className="text-[11px] text-zinc-400">
                  바코드 {selectedCount}권
                </p>
              </div>
              <span
                className="w-[64px] shrink-0 sm:w-[72px]"
                aria-hidden
              />
            </header>
            <div className="flex flex-wrap items-center gap-3 px-4 py-4">
              <button
                type="button"
                onClick={onCopy}
                disabled={!canCopyDetail}
                title={
                  canCopyDetail
                    ? undefined
                    : "복사할 숫자 줄이 없어요. 먼저 점검을 진행하거나 아래에 번호를 적어 주세요."
                }
                className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  copyDone
                    ? "bg-emerald-600 text-white"
                    : "border border-zinc-600 bg-zinc-900 text-zinc-100 active:bg-zinc-800"
                }`}
              >
                <ClipboardIcon className="h-5 w-5 shrink-0 opacity-90" />
                {copyDone ? "복사 완료" : "클립보드 복사"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="min-h-14 rounded-2xl border border-red-900/70 bg-red-950/40 px-5 text-base font-semibold text-red-100 active:bg-red-950/70"
              >
                이 점검 삭제하기
              </button>
            </div>
            <div className="min-h-0 flex-1 px-4 pb-4">
              <p className="mb-2 text-xs leading-relaxed text-zinc-400">
                선생님이 정한 방식대로 붙여 넣거나 수정해요. 한 줄에 번호 하나씩이면
                복사하기 편해요.
              </p>
              <textarea
                value={selectedText}
                onChange={(e) => onChangeDetail(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoComplete="off"
                className="h-full min-h-[40dvh] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 font-mono text-sm text-zinc-100 outline-none ring-emerald-500/30 focus:ring-2"
              />
            </div>
          </section>
        )}
      </div>

      <AppFooter className="mt-auto" />
    </main>
  );
}
