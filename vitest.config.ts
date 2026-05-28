import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 설정 — DOM/카메라 의존 없는 순수 로직(스토어·메타·텍스트
 * 정규화·바코드 검증) 회귀 방지를 위한 단위 테스트 전용.
 *
 * - environment: jsdom — localStorage 등 브라우저 API를 sessionMeta와
 *   useScannerStore가 직접 사용한다. 각 테스트 시작 시 setupFiles에서
 *   localStorage를 비워 격리.
 * - resolve.alias — tsconfig의 `@/*` paths 매핑을 vitest 모듈 해상에도
 *   동일하게 적용.
 *
 * 카메라/실제 DOM 렌더가 필요한 React 컴포넌트 테스트는 본 범위에서 제외
 * (별도 Playwright/E2E 도입 시점에 다룬다).
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    /* watch off — 기본은 `vitest run`이지만 CI/검증 흐름의 일관성을 위해
       명시 */
    watch: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
