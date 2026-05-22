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

export default withPWA(nextConfig);

// Cloudflare 로컬 dev 전용 — Vercel/프로덕션 next build에서 Wrangler 기동 시 EPIPE 발생 방지
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev();
}
