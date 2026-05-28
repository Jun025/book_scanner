import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  isSessionInTrash,
  mergeSessionMetaRaw,
  metaKeyForSessionKey,
} from "@/store/sessionMeta";
import {
  SESSION_STORAGE_PREFIX,
  makeSessionStorageKey,
  readSessionRaw,
  removeSessionKeysWithZeroBarcodes,
  useScannerStore,
  writeSessionRaw,
} from "@/store/useScannerStore";

beforeEach(() => {
  /* zustand store도 테스트 사이에 초기 상태로 리셋해 격리 */
  useScannerStore.setState({
    activeSessionKey: null,
    liveSessionText: "",
    lastCapturedCode: null,
    lastCaptureAt: 0,
    sessionsRevision: 0,
    _lastAccepted: null,
  });
});

describe("makeSessionStorageKey — 시계 점프 충돌 방어", () => {
  it("충돌이 없으면 종전 형식(prefix + ISO) 그대로 반환", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    expect(makeSessionStorageKey(at)).toBe(
      `${SESSION_STORAGE_PREFIX}2026-05-28T03:21:11.456Z`
    );
  });

  it("같은 시각으로 두 번째 호출 시 -2 suffix가 붙은 새 키를 반환", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    const k1 = makeSessionStorageKey(at);
    writeSessionRaw(k1, "first content");
    const k2 = makeSessionStorageKey(at);
    expect(k2).toBe(`${k1}-2`);
  });

  it("연속 충돌은 -2, -3, ... 순으로 다음 빈 슬롯을 찾는다", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    const k1 = makeSessionStorageKey(at);
    writeSessionRaw(k1, "a");
    const k2 = makeSessionStorageKey(at);
    writeSessionRaw(k2, "b");
    const k3 = makeSessionStorageKey(at);
    expect(k3).toBe(`${k1}-3`);
  });

  it("충돌 시 기존 본문은 절대 덮어쓰지 않는다", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    const k1 = makeSessionStorageKey(at);
    writeSessionRaw(k1, "preserved content");
    const k2 = makeSessionStorageKey(at);
    /* makeSessionStorageKey 자체는 setItem하지 않으므로 k2는 아직 빈
       상태 — 호출자(beginInventorySession)가 새 빈 본문을 쓰기 전까지
       원본은 그대로 */
    expect(readSessionRaw(k1)).toBe("preserved content");
    expect(localStorage.getItem(k2)).toBeNull();
  });

  it("휴지통(softDelete된 본문이 살아 있는 상태)에서도 충돌이 잡힌다", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    const k1 = makeSessionStorageKey(at);
    writeSessionRaw(k1, "trashed but body alive");
    mergeSessionMetaRaw(k1, { deletedAt: 9999 });
    const k2 = makeSessionStorageKey(at);
    expect(k2).not.toBe(k1);
    expect(isSessionInTrash(k1)).toBe(true);
    expect(readSessionRaw(k1)).toBe("trashed but body alive");
  });

  it("suffix 키도 metaKeyForSessionKey와 호환된다", () => {
    const at = new Date("2026-05-28T03:21:11.456Z");
    const k1 = makeSessionStorageKey(at);
    writeSessionRaw(k1, "x");
    const k2 = makeSessionStorageKey(at);
    /* suffix가 메타 prefix 교체 후에도 그대로 따라가야 한다 */
    expect(metaKeyForSessionKey(k2).endsWith("-2")).toBe(true);
    expect(metaKeyForSessionKey(k2).startsWith("book-scanner:meta:")).toBe(
      true
    );
  });
});

describe("beginInventorySession — 충돌 시 새 키 + 본문 보존", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("이미 동일 시각 키가 있어도 본문을 덮지 않고 새 키로 시작한다", () => {
    vi.setSystemTime(new Date("2026-05-28T03:21:11.456Z"));

    const k1 = useScannerStore.getState().beginInventorySession();
    /* 첫 점검에서 데이터가 쌓였다고 가정 */
    writeSessionRaw(k1, "9780000000001\n9780000000002");
    useScannerStore.getState().endInventorySession();

    /* 시계가 같은 ms에 머무는 상태에서 새 점검 시작 */
    vi.setSystemTime(new Date("2026-05-28T03:21:11.456Z"));
    const k2 = useScannerStore.getState().beginInventorySession();

    expect(k2).not.toBe(k1);
    expect(readSessionRaw(k1)).toBe("9780000000001\n9780000000002");
    expect(readSessionRaw(k2)).toBe("");
  });
});

describe("removeSessionKeysWithZeroBarcodes — 빈 세션 정리", () => {
  it("권수>0 활성 세션은 보존된다", () => {
    const k = `${SESSION_STORAGE_PREFIX}2026-05-01T00:00:00.000Z`;
    writeSessionRaw(k, "1234567");
    removeSessionKeysWithZeroBarcodes();
    expect(localStorage.getItem(k)).not.toBeNull();
  });

  it("권수 0인 활성 세션은 정리된다(본문·메타 동시)", () => {
    const k = `${SESSION_STORAGE_PREFIX}2026-05-01T00:00:00.000Z`;
    writeSessionRaw(k, "");
    removeSessionKeysWithZeroBarcodes();
    expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem(metaKeyForSessionKey(k))).toBeNull();
  });

  it("휴지통 세션은 권수 0이어도 정리하지 않는다(사용자 의도 보존)", () => {
    const k = `${SESSION_STORAGE_PREFIX}2026-05-01T00:00:00.000Z`;
    writeSessionRaw(k, "");
    mergeSessionMetaRaw(k, { deletedAt: 1000 });
    removeSessionKeysWithZeroBarcodes();
    expect(localStorage.getItem(k)).not.toBeNull();
    expect(isSessionInTrash(k)).toBe(true);
  });

  it("본문이 사라진 짝없는 orphan 메타도 함께 정리한다", () => {
    const orphanSession = `${SESSION_STORAGE_PREFIX}2026-04-01T00:00:00.000Z`;
    const orphanMeta = metaKeyForSessionKey(orphanSession);
    localStorage.setItem(orphanMeta, JSON.stringify({ backedUpAt: 100 }));
    removeSessionKeysWithZeroBarcodes();
    expect(localStorage.getItem(orphanMeta)).toBeNull();
  });

  it("권수>0 본문의 짝 메타는 정리에 영향받지 않는다", () => {
    const k = `${SESSION_STORAGE_PREFIX}2026-05-01T00:00:00.000Z`;
    writeSessionRaw(k, "1234567");
    mergeSessionMetaRaw(k, { backedUpAt: 1000 });
    removeSessionKeysWithZeroBarcodes();
    expect(localStorage.getItem(metaKeyForSessionKey(k))).not.toBeNull();
  });

  it("여러 활성·휴지통·orphan 메타가 섞여 있어도 정확히 분기 처리한다", () => {
    const activeFull = `${SESSION_STORAGE_PREFIX}2026-05-10T00:00:00.000Z`;
    const activeEmpty = `${SESSION_STORAGE_PREFIX}2026-05-09T00:00:00.000Z`;
    const trashedEmpty = `${SESSION_STORAGE_PREFIX}2026-05-08T00:00:00.000Z`;
    const orphanMeta = metaKeyForSessionKey(
      `${SESSION_STORAGE_PREFIX}2026-05-07T00:00:00.000Z`
    );

    writeSessionRaw(activeFull, "9780000000001");
    writeSessionRaw(activeEmpty, "");
    writeSessionRaw(trashedEmpty, "");
    mergeSessionMetaRaw(trashedEmpty, { deletedAt: 1 });
    localStorage.setItem(orphanMeta, JSON.stringify({ backedUpAt: 1 }));

    removeSessionKeysWithZeroBarcodes();

    expect(localStorage.getItem(activeFull)).not.toBeNull();
    expect(localStorage.getItem(activeEmpty)).toBeNull();
    expect(localStorage.getItem(trashedEmpty)).not.toBeNull();
    expect(localStorage.getItem(orphanMeta)).toBeNull();
  });
});

describe("appendDigitScanToActiveSession — 입력 검증·쿨다운", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T03:21:11.456Z"));
    useScannerStore.getState().beginInventorySession();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trim 후 숫자만 있으면 수락(true)", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("  1234567 ")
    ).toBe(true);
  });

  it("숫자 외 문자가 섞이면 거절(false)", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("12abc34")
    ).toBe(false);
  });

  it("빈 문자열은 거절", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("")
    ).toBe(false);
  });

  it("동일 코드 2초 이내 중복은 거절(쿨다운)", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(true);
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(false);
  });

  it("다른 코드는 즉시 허용(쿨다운은 동일 코드에만)", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(true);
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("9876543")
    ).toBe(true);
  });

  it("쿨다운 지나면 동일 코드도 다시 허용", () => {
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(true);
    vi.advanceTimersByTime(2100);
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(true);
  });

  it("활성 세션이 없으면 거절", () => {
    useScannerStore.getState().endInventorySession();
    expect(
      useScannerStore.getState().appendDigitScanToActiveSession("1234567")
    ).toBe(false);
  });
});

describe("markSessionBackedUp / softDeleteSession / restoreSession — 두 필드 독립성", () => {
  const SESSION = `${SESSION_STORAGE_PREFIX}2026-05-28T03:21:11.456Z`;

  beforeEach(() => {
    writeSessionRaw(SESSION, "9780000000001");
  });

  it("markSessionBackedUp 후 softDeleteSession하면 backedUpAt이 보존된다", () => {
    useScannerStore.getState().markSessionBackedUp(SESSION);
    useScannerStore.getState().softDeleteSession(SESSION);
    expect(isSessionInTrash(SESSION)).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(metaKeyForSessionKey(SESSION))!)
        .backedUpAt
    ).toBeGreaterThan(0);
  });

  it("restoreSession은 deletedAt만 0으로, backedUpAt은 유지", () => {
    useScannerStore.getState().markSessionBackedUp(SESSION);
    useScannerStore.getState().softDeleteSession(SESSION);
    useScannerStore.getState().restoreSession(SESSION);
    expect(isSessionInTrash(SESSION)).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(metaKeyForSessionKey(SESSION))!)
        .backedUpAt
    ).toBeGreaterThan(0);
  });
});
