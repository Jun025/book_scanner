import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
});

const nextConfig: NextConfig = {
  // Vercel 등 2코어 CI에서 jest-worker EPIPE 완화
  ...(process.env.VERCEL
    ? {
        experimental: {
          cpus: 1,
          webpackBuildWorker: false,
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self)",
          },
        ],
      },
    ];
  },
};

/**
 * `@ducanh2912/next-pwa`는 webpack 전용 플러그인이라 `webpack` 키만 주입한다.
 * Next.js 16부터 기본 번들러가 Turbopack이라, 플래그 없이 `next build`를 실행하면
 * "Turbopack인데 webpack 설정이 있다"는 검증에 걸려 빌드가 종료된다.
 * 따라서 CLI에 `--webpack`이 들어있을 때만 PWA를 래핑해 검증 충돌을 피한다.
 * 프로덕션 빌드 스크립트(`pnpm build`)와 dev 스크립트는 모두 `--webpack`을 명시하므로
 * 실제 PWA 산출물 생성 경로는 그대로 유지된다.
 */
const useWebpackBundler = process.argv.includes("--webpack");

/**
 * 프로덕션 빌드 안전망 — `next build`가 `--webpack` 없이 호출되면 PWA 플러그인이 그냥
 * 빠진 채 산출물이 만들어진다. 배포 파이프라인이 우회 경로(예: `pnpm build` 대신
 * 직접 `next build`)를 타게 되어도 조용히 지나가지 않도록 빌드 단계에서 즉시 실패시킨다.
 * Next CLI(`bin/next`)로 `build` 서브커맨드를 도는 경우에만 가드해, 다른 도구가 설정을
 * 로드하는 상황은 영향받지 않는다.
 */
const isNextBuildCli =
  process.argv[2] === "build" &&
  /[\\/]next(?:\.[mc]?js)?$/.test(process.argv[1] ?? "");

if (
  isNextBuildCli &&
  process.env.NODE_ENV === "production" &&
  !useWebpackBundler
) {
  throw new Error(
    "[next.config] 프로덕션 빌드가 `--webpack` 없이 실행되었습니다.\n" +
      "@ducanh2912/next-pwa는 webpack 전용이라 이대로 빌드하면 서비스 워커가 빠집니다.\n" +
      "`pnpm build`(스크립트가 --webpack을 자동으로 붙입니다) 또는 `next build --webpack`을 사용하세요."
  );
}

export default useWebpackBundler ? withPWA(nextConfig) : nextConfig;

// Cloudflare 로컬 dev 전용 — Vercel/프로덕션 next build에서 Wrangler 기동 시 EPIPE 발생 방지
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev();
}
