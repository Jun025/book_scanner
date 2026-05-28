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
  /** Date.now() — 0보다 크면 "한 번이라도 백업(복사·공유)됨"으로 해석한다. */
  backedUpAt: number;
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
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { backedUpAt?: unknown }).backedUpAt === "number"
    ) {
      const at = (parsed as { backedUpAt: number }).backedUpAt;
      if (at > 0) return { backedUpAt: at };
    }
  } catch {
    /* 손상된 JSON — 메타 없음으로 취급(안전한 기본값) */
  }
  return null;
}

export function isSessionBackedUp(sessionKey: string): boolean {
  return readSessionMeta(sessionKey) !== null;
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
       백업 뱃지만 표시 못 할 뿐. */
    return false;
  }
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
