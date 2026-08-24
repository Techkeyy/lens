import type { Metadata } from "next";
import { Anton, Cormorant_Garamond, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import "./lens.css";
import Shell from "./components/Shell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-cormorant",
  display: "swap",
});
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lens. Show the payment, not the wallet",
  description:
    "Selective disclosure for STRK20 private payments. Prove one payment relationship without exposing your whole financial history.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${anton.variable} ${cormorant.variable} ${plex.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
