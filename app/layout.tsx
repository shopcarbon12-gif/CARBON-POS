import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ORLANDO_TIME_PATCH } from "@/lib/orlando-time";

// Server side too (API routes, PDFs, emails) — containers already run
// TZ=America/New_York, this just makes it explicit and environment-proof.
// eslint-disable-next-line no-new-func
new Function(ORLANDO_TIME_PATCH)();

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Carbon POS",
  description: "Carbon Jeans Company — Point of Sale",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Orlando time for every date shown, before any app code runs. */}
        <script dangerouslySetInnerHTML={{ __html: ORLANDO_TIME_PATCH }} />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
