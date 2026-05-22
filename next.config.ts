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

initOpenNextCloudflareForDev();
