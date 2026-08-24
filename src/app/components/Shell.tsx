"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Two destinations, so no sidebar and no permanent wallet button. Connection is
 * requested on the screen that needs it, with a reason attached, rather than at
 * the door.
 */
const LINKS = [
  { href: "/request", label: "Request a disclosure" },
  { href: "/disclosures", label: "My disclosures" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
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
            <Link
              key={l.href}
              href={l.href}
              className={path.startsWith(l.href) ? "active" : ""}
              aria-current={path.startsWith(l.href) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="nav-right" />
      </nav>
      <main id="main">{children}</main>
      <footer className="footer">
        <span>Lens. Selective disclosure for STRK20 private payments.</span>
        <span>
          <a href="https://github.com/Techkeyy/lens" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </div>
  );
}
