import { beforeEach } from "vitest";

/**
 * 각 테스트 시작 전 localStorage를 비워 격리한다 — sessionMeta·세션 정리
 * 헬퍼가 모두 localStorage를 직접 읽고 쓰므로, 이전 테스트의 잔여 키가
 * 다음 테스트의 가정을 흐릴 위험이 있다.
 */
beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
