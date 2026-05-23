import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161115" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "빛나래 장서점검",
  description:
    "동국대학교사범대학부속가람고등학교 도서부 빛나래 장서점검. 바코드를 찍을 때마다 이 기기에 바로 저장돼요. 점검을 마치면 클립보드로 한 번에 복사해 선생님께 보내요.",
  manifest: "/manifest.json",
  applicationName: "빛나래 장서점검",
  appleWebApp: {
    capable: true,
    title: "빛나래 장서점검",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  /* 학교 내부용 도구이므로 검색엔진 색인 대상이 아님 */
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg-base text-text-primary">
        {children}
      </body>
    </html>
  );
}
