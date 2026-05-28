import { create } from "zustand";
import { countSessionLines } from "@/lib/sessionText";
import {
  deleteSessionMetaRaw,
  isSessionInTrash,
  mergeSessionMetaRaw,
  removeOrphanMetaKeys,
} from "@/store/sessionMeta";

const DIGIT_ONLY = /^\d+$/;
/** 동일 바코드만 2초간 재입력 차단 (다른 바코드는 즉시 허용) */
const SAME_CODE_COOLDOWN_MS = 2000;

/** 세션별 본문 저장용 키 접두사 (값: 줄바꿈으로 구분된 스캔 텍스트) */
export const SESSION_STORAGE_PREFIX = "book-scanner:session:";

/** 마지막으로 수락한 스캔 시각·값 (동일 코드 쿨다운용) */
type LastAcceptedScan = { at: number; value: string };

type ScannerState = {
  activeSessionKey: string | null;
  liveSessionText: string;
  lastCapturedCode: string | null;
  lastCaptureAt: number;
  sessionsRevision: number;
  _lastAccepted: LastAcceptedScan | null;

  beginInventorySession: () => string;
  endInventorySession: () => void;
  setLiveSessionText: (text: string) => void;
  appendDigitScanToActiveSession: (raw: string) => boolean;
  bumpSessionsRevision: () => void;
  /**
   * 세션을 "한 번이라도 복사됨"으로 표시. 진행 중·상세 복사가 실제 성공한
   * 직후 호출. localStorage 메타 merge + revision 자동 bump로 목록 뱃지가
   * 즉시 갱신된다. 기존 deletedAt 값은 보존(휴지통 상태 유지).
   */
  markSessionBackedUp: (sessionKey: string) => void;
  /** 세션을 휴지통으로 보낸다(소프트 삭제). 본문은 보존, 메타에 deletedAt
      만 기록. 목록에서는 사라지지만 휴지통 화면에서 복구·영구 삭제 가능. */
  softDeleteSession: (sessionKey: string) => void;
  /** 휴지통에서 활성 목록으로 되돌린다. 메타의 deletedAt만 0으로 초기화. */
  restoreSession: (sessionKey: string) => void;
};

function normalizeDigits(raw: string): string | null {
  const t = raw.trim();
  if (!t || !DIGIT_ONLY.test(t)) return null;
  return t;
}

export function makeSessionStorageKey(startedAt: Date = new Date()): string {
  return `${SESSION_STORAGE_PREFIX}${startedAt.toISOString()}`;
}

export function listSessionStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(SESSION_STORAGE_PREFIX)) out.push(k);
  }
  return out.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function readSessionRaw(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

export function writeSessionRaw(key: string, text: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, text);
}

function appendLineToLocalStorage(key: string, line: string): string {
  const prev = readSessionRaw(key);
  const next = prev.length === 0 ? line : `${prev}\n${line}`;
  writeSessionRaw(key, next);
  return next;
}

function hasAnyNonEmptyLine(text: string): boolean {
  return text
    .split("\n")
    .some((line) => line.trim().length > 0);
}

export function deleteSessionKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
  /* 본문이 사라지면 짝이 되는 메타도 함께 제거해 orphan을 만들지 않는다. */
  deleteSessionMetaRaw(key);
}

/**
 * 비어 있는(바코드 줄 0건) 세션 키를 localStorage에서 제거. 메인 표시 직전에 호출.
 *
 * 휴지통에 있는 세션(소프트 삭제됨)은 사용자가 의도적으로 보관 중인 상태
 * 이므로 본 정리에서 건드리지 않는다 — 빈 휴지통 세션이 있더라도 휴지통
 * UI에서 복구·영구 삭제하도록 두는 게 사용자 의도와 일치한다.
 */
export function removeSessionKeysWithZeroBarcodes(): void {
  if (typeof window === "undefined") return;
  const keys = listSessionStorageKeys();
  const { activeSessionKey } = useScannerStore.getState();
  let removedActive = false;
  let anyRemoved = false;
  for (const key of keys) {
    if (isSessionInTrash(key)) continue;
    if (countSessionLines(readSessionRaw(key)) > 0) continue;
    deleteSessionKey(key);
    anyRemoved = true;
    if (key === activeSessionKey) removedActive = true;
  }
  /* 본문 정리 후 살아남은 본문 키와 짝이 없는 meta(orphan)도 같이 정리.
     보통 deleteSessionKey가 짝지어 지우므로 비어 있지만, 멀티 탭·미래
     버그·과거 마이그레이션 등을 대비한 안전망. */
  removeOrphanMetaKeys(listSessionStorageKeys());
  if (removedActive) {
    useScannerStore.setState({
      activeSessionKey: null,
      liveSessionText: "",
      _lastAccepted: null,
      lastCapturedCode: null,
      lastCaptureAt: 0,
    });
  }
  if (anyRemoved) useScannerStore.getState().bumpSessionsRevision();
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  activeSessionKey: null,
  liveSessionText: "",
  lastCapturedCode: null,
  lastCaptureAt: 0,
  sessionsRevision: 0,
  _lastAccepted: null,

  bumpSessionsRevision: () =>
    set((s) => ({ sessionsRevision: s.sessionsRevision + 1 })),

  beginInventorySession: () => {
    const key = makeSessionStorageKey();
    writeSessionRaw(key, "");
    set({
      activeSessionKey: key,
      liveSessionText: "",
      _lastAccepted: null,
      lastCapturedCode: null,
      lastCaptureAt: 0,
    });
    get().bumpSessionsRevision();
    return key;
  },

  endInventorySession: () => {
    const { activeSessionKey } = get();
    if (activeSessionKey) {
      const raw = readSessionRaw(activeSessionKey);
      if (!hasAnyNonEmptyLine(raw)) {
        deleteSessionKey(activeSessionKey);
      }
    }
    set({
      activeSessionKey: null,
      liveSessionText: "",
      _lastAccepted: null,
      lastCapturedCode: null,
      lastCaptureAt: 0,
    });
    get().bumpSessionsRevision();
  },

  setLiveSessionText: (text) => {
    const { activeSessionKey } = get();
    if (!activeSessionKey) return;
    writeSessionRaw(activeSessionKey, text);
    set({ liveSessionText: text, _lastAccepted: null });
  },

  appendDigitScanToActiveSession: (raw) => {
    const digits = normalizeDigits(raw);
    if (!digits) return false;
    const { activeSessionKey, _lastAccepted } = get();
    if (!activeSessionKey) return false;

    const now = Date.now();
    /* Distinct-until-changed: 직전 수락 값과 같고 쿨다운 안에만 무시 */
    if (
      _lastAccepted &&
      _lastAccepted.value === digits &&
      now - _lastAccepted.at < SAME_CODE_COOLDOWN_MS
    ) {
      return false;
    }

    const nextText = appendLineToLocalStorage(activeSessionKey, digits);
    set({
      liveSessionText: nextText,
      _lastAccepted: { at: now, value: digits },
      lastCapturedCode: digits,
      lastCaptureAt: now,
    });
    return true;
  },

  markSessionBackedUp: (sessionKey) => {
    if (!sessionKey) return;
    const ok = mergeSessionMetaRaw(sessionKey, { backedUpAt: Date.now() });
    /* private mode 등으로 meta write가 실패해도 본문은 안전하므로 조용히
       지나간다. 성공한 경우에만 revision을 올려 목록 뱃지를 갱신. */
    if (ok) get().bumpSessionsRevision();
  },

  softDeleteSession: (sessionKey) => {
    if (!sessionKey) return;
    const ok = mergeSessionMetaRaw(sessionKey, { deletedAt: Date.now() });
    if (ok) get().bumpSessionsRevision();
  },

  restoreSession: (sessionKey) => {
    if (!sessionKey) return;
    const ok = mergeSessionMetaRaw(sessionKey, { deletedAt: 0 });
    if (ok) get().bumpSessionsRevision();
  },
}));
