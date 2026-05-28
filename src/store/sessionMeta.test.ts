import { describe, expect, it } from "vitest";
import {
  isSessionBackedUp,
  isSessionInTrash,
  META_STORAGE_PREFIX,
  mergeSessionMetaRaw,
  metaKeyForSessionKey,
  readSessionMeta,
  removeOrphanMetaKeys,
  writeSessionMetaRaw,
} from "@/store/sessionMeta";
import { SESSION_STORAGE_PREFIX } from "@/store/useScannerStore";

const ISO = "2026-05-28T03:21:11.456Z";
const SESSION_KEY = `${SESSION_STORAGE_PREFIX}${ISO}`;
const META_KEY = `${META_STORAGE_PREFIX}${ISO}`;

describe("metaKeyForSessionKey", () => {
  it("본문 키 prefix를 메타 prefix로 교체한다", () => {
    expect(metaKeyForSessionKey(SESSION_KEY)).toBe(META_KEY);
  });

  it("시계 점프 방어 suffix(-N)가 붙은 키도 그대로 매핑된다", () => {
    expect(metaKeyForSessionKey(`${SESSION_KEY}-2`)).toBe(`${META_KEY}-2`);
    expect(metaKeyForSessionKey(`${SESSION_KEY}-123-abcd`)).toBe(
      `${META_KEY}-123-abcd`
    );
  });

  it("본문 prefix가 아닌 키는 변형하지 않고 그대로 반환한다", () => {
    expect(metaKeyForSessionKey("foreign:key")).toBe("foreign:key");
  });
});

describe("mergeSessionMetaRaw — 부분 갱신 invariant", () => {
  it("빈 상태에서 backedUpAt만 추가하면 deletedAt은 0으로 초기화", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000 });
    expect(readSessionMeta(SESSION_KEY)).toEqual({
      backedUpAt: 1000,
      deletedAt: 0,
    });
  });

  it("backedUpAt이 있는 상태에서 deletedAt 추가해도 backedUpAt이 보존된다", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000 });
    mergeSessionMetaRaw(SESSION_KEY, { deletedAt: 2000 });
    expect(readSessionMeta(SESSION_KEY)).toEqual({
      backedUpAt: 1000,
      deletedAt: 2000,
    });
  });

  it("deletedAt이 있는 상태에서 backedUpAt 추가해도 deletedAt이 보존된다", () => {
    mergeSessionMetaRaw(SESSION_KEY, { deletedAt: 2000 });
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000 });
    expect(readSessionMeta(SESSION_KEY)).toEqual({
      backedUpAt: 1000,
      deletedAt: 2000,
    });
  });

  it("deletedAt=0(복구)을 머지해도 backedUpAt(복사 이력)은 보존된다", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000, deletedAt: 2000 });
    mergeSessionMetaRaw(SESSION_KEY, { deletedAt: 0 });
    expect(readSessionMeta(SESSION_KEY)).toEqual({
      backedUpAt: 1000,
      deletedAt: 0,
    });
  });

  it("두 필드 모두 0이 되면 메타 키 자체를 삭제(orphan 사전 방지)", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000 });
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 0 });
    expect(localStorage.getItem(META_KEY)).toBeNull();
    expect(readSessionMeta(SESSION_KEY)).toBeNull();
  });
});

describe("readSessionMeta — 파싱 & 하위호환", () => {
  it("옛 JSON({backedUpAt}만 있음)은 deletedAt을 0으로 보정한다", () => {
    localStorage.setItem(META_KEY, JSON.stringify({ backedUpAt: 500 }));
    expect(readSessionMeta(SESSION_KEY)).toEqual({
      backedUpAt: 500,
      deletedAt: 0,
    });
  });

  it("손상된 JSON은 null을 반환한다", () => {
    localStorage.setItem(META_KEY, "{not valid");
    expect(readSessionMeta(SESSION_KEY)).toBeNull();
  });

  it("메타 키가 없으면 null을 반환한다", () => {
    expect(readSessionMeta(SESSION_KEY)).toBeNull();
  });

  it("두 필드 모두 0인 메타는 의미 없음으로 null 취급한다", () => {
    localStorage.setItem(
      META_KEY,
      JSON.stringify({ backedUpAt: 0, deletedAt: 0 })
    );
    expect(readSessionMeta(SESSION_KEY)).toBeNull();
  });

  it("음수·문자열·null 등 잘못된 필드 타입은 0으로 안전 보정", () => {
    localStorage.setItem(
      META_KEY,
      JSON.stringify({ backedUpAt: "x", deletedAt: -1 })
    );
    expect(readSessionMeta(SESSION_KEY)).toBeNull();
  });
});

describe("isSessionBackedUp / isSessionInTrash 판정", () => {
  it("복사한 적 있는 세션은 backedUp=true, inTrash=false", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000 });
    expect(isSessionBackedUp(SESSION_KEY)).toBe(true);
    expect(isSessionInTrash(SESSION_KEY)).toBe(false);
  });

  it("휴지통 세션은 inTrash=true", () => {
    mergeSessionMetaRaw(SESSION_KEY, { deletedAt: 2000 });
    expect(isSessionInTrash(SESSION_KEY)).toBe(true);
  });

  it("두 필드는 독립 — 백업된 채로 휴지통에 들어가도 두 판정 모두 true", () => {
    mergeSessionMetaRaw(SESSION_KEY, { backedUpAt: 1000, deletedAt: 2000 });
    expect(isSessionBackedUp(SESSION_KEY)).toBe(true);
    expect(isSessionInTrash(SESSION_KEY)).toBe(true);
  });

  it("메타 부재(=신규) 세션은 둘 다 false (마이그레이션 fail-safe)", () => {
    expect(isSessionBackedUp(SESSION_KEY)).toBe(false);
    expect(isSessionInTrash(SESSION_KEY)).toBe(false);
  });
});

describe("writeSessionMetaRaw — 단순 write", () => {
  it("메타 키를 그대로 JSON으로 setItem한다", () => {
    writeSessionMetaRaw(SESSION_KEY, { backedUpAt: 100, deletedAt: 200 });
    expect(JSON.parse(localStorage.getItem(META_KEY)!)).toEqual({
      backedUpAt: 100,
      deletedAt: 200,
    });
  });
});

describe("removeOrphanMetaKeys — 본문 없는 메타 정리", () => {
  it("살아있는 본문 키와 짝이 없는 meta만 제거한다", () => {
    const liveSession = `${SESSION_STORAGE_PREFIX}2026-05-01T00:00:00.000Z`;
    const liveMeta = metaKeyForSessionKey(liveSession);
    const orphanMeta = metaKeyForSessionKey(
      `${SESSION_STORAGE_PREFIX}2026-04-01T00:00:00.000Z`
    );

    localStorage.setItem(liveMeta, JSON.stringify({ backedUpAt: 1000 }));
    localStorage.setItem(orphanMeta, JSON.stringify({ backedUpAt: 2000 }));

    removeOrphanMetaKeys([liveSession]);

    expect(localStorage.getItem(liveMeta)).not.toBeNull();
    expect(localStorage.getItem(orphanMeta)).toBeNull();
  });

  it("본문 키와 무관한 다른 prefix 키는 건드리지 않는다", () => {
    localStorage.setItem("unrelated:key", "x");
    removeOrphanMetaKeys([]);
    expect(localStorage.getItem("unrelated:key")).toBe("x");
  });
});
