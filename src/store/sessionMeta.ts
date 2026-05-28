import { SESSION_STORAGE_PREFIX } from "@/store/useScannerStore";

/**
 * 본문 키(`book-scanner:session:` + ISO)와 분리된 메타데이터 네임스페이스.
 * 본문 파싱·세션 정리 로직에 영향을 주지 않도록 의도적으로 다른 접두사를
 * 사용한다. 본문 키와 1:1 대응되도록 ISO suffix는 동일하게 맞춘다.
 *
 * 예) 본문: book-scanner:session:2026-05-28T03:21:11.456Z
 *     메타: book-scanner:meta:2026-05-28T03:21:11.456Z
 */
export const META_STORAGE_PREFIX = "book-scanner:meta:";

/** 향후 필드(공유 경로 등)를 더 넣을 수 있도록 JSON 객체로 보관. */
export type SessionMeta = {
  /** Date.now() — 0보다 크면 "한 번이라도 복사됨"으로 해석한다. */
  backedUpAt: number;
  /** Date.now() — 0보다 크면 "휴지통(소프트 삭제)" 상태. 본문은 보존되며
      복구(`restoreSession`)로 다시 활성 목록에 노출되거나, 영구 삭제
      (`deleteSessionKey`)로 본문·메타가 함께 사라진다. */
  deletedAt: number;
};

export function metaKeyForSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith(SESSION_STORAGE_PREFIX)) return sessionKey;
  return `${META_STORAGE_PREFIX}${sessionKey.slice(SESSION_STORAGE_PREFIX.length)}`;
}

export function readSessionMeta(sessionKey: string): SessionMeta | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(metaKeyForSessionKey(sessionKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    /* 기존 스키마(backedUpAt만 있는 JSON)와의 하위 호환: 누락 필드는 0으로
       해석한다. 두 필드 모두 0이면 의미 있는 메타가 없으므로 null 취급. */
    const backedUpAt =
      typeof obj.backedUpAt === "number" && obj.backedUpAt > 0
        ? obj.backedUpAt
        : 0;
    const deletedAt =
      typeof obj.deletedAt === "number" && obj.deletedAt > 0
        ? obj.deletedAt
        : 0;
    if (backedUpAt === 0 && deletedAt === 0) return null;
    return { backedUpAt, deletedAt };
  } catch {
    /* 손상된 JSON — 메타 없음으로 취급(안전한 기본값) */
  }
  return null;
}

export function isSessionBackedUp(sessionKey: string): boolean {
  return (readSessionMeta(sessionKey)?.backedUpAt ?? 0) > 0;
}

export function isSessionInTrash(sessionKey: string): boolean {
  return (readSessionMeta(sessionKey)?.deletedAt ?? 0) > 0;
}

export function writeSessionMetaRaw(
  sessionKey: string,
  meta: SessionMeta
): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      metaKeyForSessionKey(sessionKey),
      JSON.stringify(meta)
    );
    return true;
  } catch {
    /* private mode / quota 초과 — 본문은 이미 저장되어 있으므로 안전.
       백업 뱃지·휴지통 상태만 표시 못 할 뿐. */
    return false;
  }
}

/**
 * 부분 필드만 갱신하고 나머지는 기존 값을 보존한다. 백업 마크와 휴지통
 * 상태가 서로를 덮어쓰지 않도록 모든 store 액션은 이 함수만 사용해야 한다.
 */
export function mergeSessionMetaRaw(
  sessionKey: string,
  partial: Partial<SessionMeta>
): boolean {
  const current = readSessionMeta(sessionKey) ?? {
    backedUpAt: 0,
    deletedAt: 0,
  };
  const next: SessionMeta = {
    backedUpAt: partial.backedUpAt ?? current.backedUpAt,
    deletedAt: partial.deletedAt ?? current.deletedAt,
  };
  /* 두 필드 모두 0이면 메타가 사실상 의미 없으므로 키를 지우는 편이
     orphan sweep과 enumeration 비용 측면에서 더 깔끔하다. */
  if (next.backedUpAt === 0 && next.deletedAt === 0) {
    deleteSessionMetaRaw(sessionKey);
    return true;
  }
  return writeSessionMetaRaw(sessionKey, next);
}

export function deleteSessionMetaRaw(sessionKey: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(metaKeyForSessionKey(sessionKey));
}

/**
 * 대응되는 본문이 사라진 meta 키(orphan)를 일괄 제거한다.
 * - 메인 진입 시 빈 세션 정리와 함께 호출
 * - existingSessionKeys: 정리 후 살아있는 본문 키 목록
 *
 * 보통은 deleteSessionKey가 본문·메타를 함께 지우므로 orphan이 안 생기지만,
 * 멀티 탭·미래의 버그·과거 마이그레이션 등 예측 못한 경로를 대비한 안전망.
 */
export function removeOrphanMetaKeys(existingSessionKeys: string[]): void {
  if (typeof window === "undefined") return;
  const survivingMetaKeys = new Set(
    existingSessionKeys.map((k) => metaKeyForSessionKey(k))
  );
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(META_STORAGE_PREFIX)) continue;
    if (!survivingMetaKeys.has(k)) toRemove.push(k);
  }
  for (const k of toRemove) localStorage.removeItem(k);
}
