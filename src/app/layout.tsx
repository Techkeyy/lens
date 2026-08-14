import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Shell from "./components/Shell";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif-next",
  display: "swap",
});
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-num-next",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lens — see what a STRK20 action still reveals",
  description:
    "Vickrey and first-price auctions where the bid stays hidden until reveal. Built on the STRK20 privacy pool.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${serif.variable} ${grotesk.variable}`}
      suppressHydrationWarning
    >
      <body
        style={
          {
            ["--font-serif" as string]: "var(--font-serif-next), 'Times New Roman', serif",
            ["--font-num" as string]: "var(--font-num-next), sans-serif",
          } as CSSProperties
        }
      >
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
