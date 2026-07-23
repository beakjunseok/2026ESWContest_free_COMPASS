import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "층간소음 관제 시스템",
  description: "경비실용 아파트 층간소음 실시간 감지/경고 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            층간소음 관제
          </a>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
