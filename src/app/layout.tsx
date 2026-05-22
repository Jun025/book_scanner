import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "빛나래 장서점검",
  description:
    "동국대학교사범대학부속가람고등학교 도서부 빛나래 장서점검. 바코드(숫자)를 찍을 때마다 이 기기에 즉시 저장되며, 목록·점검 화면에서 클립보드로 한 번에 복사해 메신저로 보고할 수 있습니다.",
  manifest: "/manifest.json",
  applicationName: "빛나래 장서점검",
  appleWebApp: {
    capable: true,
    title: "빛나래 장서점검",
    statusBarStyle: "black-translucent",
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
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        {children}
      </body>
    </html>
  );
}
