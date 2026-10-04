import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinSight",
  description: "거래 내역 파일만 올리면 소비가 한눈에",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
