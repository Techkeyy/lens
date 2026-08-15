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
  const home = path === "/";
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Primary">
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
          {home ? (
            <Link href="/vault" className="btn btn-primary">
              Score this next action
            </Link>
          ) : (
            <SelectWallet variant="nav" />
          )}
        </div>
      </nav>
      <main id="main">{children}</main>
      <footer className="footer">
        <span>Lens. Privacy briefing for STRK20.</span>
        <span>
          <a href="https://github.com/Techkeyy/lens" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </div>
  );
}
