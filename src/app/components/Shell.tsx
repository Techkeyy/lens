"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SelectWallet from "./client/WalletHandle/SelectWallet";

const LINKS = [
  { href: "/vault", label: "Vault" },
  { href: "/protocol", label: "Protocol" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <nav className="nav">
        <Link href="/" className="brand">
          Lens
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          <a
            className="live"
            href="https://strk20.starknet.io/hackathon"
            target="_blank"
            rel="noreferrer"
          >
            <span className="live-dot" />
            <span className="num" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>
              STRK20 sprint
            </span>
          </a>
          <SelectWallet variant="nav" />
        </div>
      </nav>
      {children}
      <footer className="footer">
        <span>Lens · STRK20</span>
        <span>
          <a href="https://github.com/Techkeyy/lens" target="_blank" rel="noreferrer">
            Source
          </a>
          {"  ·  "}
          <a href="https://strk20-by-example.org/" target="_blank" rel="noreferrer">
            STRK20 docs
          </a>
        </span>
      </footer>
    </div>
  );
}
