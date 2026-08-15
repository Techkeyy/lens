# Lens — Design System Specification (DESIGN.md)

> Persistent design contract for Lens. Generated via Sloppi on the existing Veritable light system. Do not invent a parallel token set.

---

## 1. Design Thesis

A light paper briefing desk, not a privacy-theater dashboard. Editorial serif carries the claim; tabular mono carries amounts and grades; lime is reserved for the single next action. The product is a leak briefing, so the page must look like one.

## 2. Product Context & Operational Stakes

- **Operational Stakes**: High. Users sign mainnet STRK20 actions. Mis-labeling a public edge as hidden is a product failure.
- **User Persona**: A Starknet user with Ready who wants to shield, send, or unshield and needs to know what still publishes.
- **Core Conversion Objective**: Connect Ready → scan public Deposit/Withdrawal edges → read the grade → sign or take a quieter path.

## 3. Design Personality Profile

- **Diagnostic Axes**: Technical 55% · Expressive 25% · Dense 35% · Geometric 20%
- **Tonal Anchors**: Paper · Briefing · Quiet · Exact

## 4. Content Principles

- Zero fabricated logos, testimonials, or pool-size claims.
- Plain verbs: score, scan, shield, unshield, wait, split. Ban: seamless, next-gen, private-by-default, mixer.
- Body measure max 65ch. Display titles `text-wrap: balance`, one assertion each.
- Never call a shield quiet. Deposit and withdrawal remain public edges.

## 5. Messaging & Value Architecture

- **Primary Mechanism**: Grade the next STRK20 action against this address’s public pool edges before the wallet prompt.
- **Feature**: Look back (Deposit/Withdrawal events), look ahead (grade), quieter path (rewrite).
- **Benefit**: See what still publishes before you sign.
- **Outcome**: Fewer distinctive amounts and fast in/out pairs.
- **Banned**: Get Started, Learn More, 10x privacy, trusted by, AI-powered.

## 6. Information & Attention Hierarchy

1. Editorial claim (home hero) or live grade (vault).
2. One-sentence mechanism.
3. Primary action (score / sign).
4. Hidden vs visible leak sheet.
5. Quieter-path rewrites.
6. Fee and two-step shield warnings.
7. Network, edge count, source (live / fixture).

One primary filled button per visible viewport.

## 7. Page Architecture & Section Cadence

- **Home hero**: Text-first editorial, left-aligned. Not a centered SaaS stack.
- **Home why**: Full-width type band. No card chrome.
- **Home how**: Numbered sequence (01–03), not a three-card grid. The steps are ordered, not parallel products.
- **Vault**: Single console. Look back → look ahead → quieter path. This is the working surface.
- **Protocol**: Spec rows + leak sheets. No marketing cards.

## 8. CTA Rules & Action Hierarchy

- **Primary (home)**: `Score this next action` → `/vault` · fill `--accent`
- **Secondary (home)**: `What stays public` → `/protocol` · ghost border
- **Primary (vault)**: `Approve, then shield` / `Send privately` / `Unshield` / `Read notes`
- **Nav on home**: text links only. Do not duplicate the hero fill button.
- **Connect**: `Connect Ready` in the vault empty state. Nav uses `Connect` once a session is on an app page.

## 9. Content Density & Text Measure

- Home: sparse editorial.
- Vault: moderate, briefing density.
- Body `max-width: 65ch`. Inputs 16px to avoid iOS zoom.

## 10. Visual Principles

1. Type and whitespace group information before boxes do.
2. Sequential work uses a sequence, not three identical cards.
3. In-flow panels use a 1px line, not a hovering shadow.
4. Lime is an action, never a decoration wash.

## 11. Typography Architecture

### Font Families

- **Display / wordmark**: Anton (`--font-display`)
- **Editorial headings**: Cormorant Garamond (`--font-editorial`)
- **UI / body**: Inter (`--font-sans`)
- **Data / kickers**: IBM Plex Mono (`--font-mono`)

### Scale

| Role | Size | Weight | Line-height | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Hero | `clamp(44px, 7vw, 84px)` | 500 serif | 0.98 | max 14ch |
| Band H2 | `clamp(32px, 4.5vw, 52px)` | 500 serif | 1.08 | max 18ch |
| Page H1 | 36px | 700 sans | 1.1 | vault / protocol |
| Section H2 | 32px | 500 serif | 1.1 | inside console |
| Card / step H3 | 20px | 700 sans | 1.2 | |
| Body | 16px | 400 | 1.5–1.6 | 45–65ch |
| Kicker | 12px mono | 500 | 1.4 | not a pill |
| Button | 14px | 700 | 1 | min-height 44px |

## 12. Color Palette & Semantic Roles

Map only to existing `:root` names. Do not add `--color-canvas`.

| Role | Token | Value |
| :--- | :--- | :--- |
| Canvas | `--bg` | `#f7f8f5` |
| Canvas alt | `--panel-subtle` | `#edf2ea` |
| Surface | `--panel` | `#ffffff` |
| Hover | `--surface-hover` | `#e8eee4` |
| Line | `--line` | `#d6ddd3` |
| Text | `--text` | `#101310` |
| Muted | `--muted` | `#626b63` |
| Action | `--accent` | `#4fbd22` |
| Action press | `--accent-press` | `#3ea01a` |
| Ink on accent | `--on-accent` | `#0b1608` |
| Success | `--success` | `#187b3c` |
| Warning | `--warning` | `#9a6400` |
| Danger | `--danger` | `#b42318` |

Legacy aliases `--text-1` / `--text-2` / `--text-3` / `--font-serif` resolve to the tokens above so leftover inline styles cannot go silent.

## 13. Spatial System

4px baseline. Page padding 28/16. Band padding 96/56. Console 28/20. Nav 72px desktop, auto-height wrap on small screens.

## 14. Geometry

- Buttons / inputs: 8px
- Leak sheet / receipt: 12px
- Modal / console: 16px
- Pills (wallet only): 999px — status, not section labels

## 15. Elevation

Sticky nav may use a light backdrop blur (content scrolls under it). In-flow cards and the vault console use `1px solid var(--line)` only. Modals may use `--shadow`.

## 16. Motion

120–160ms hover/press. No scroll-jacking, no staggered section fades. Honor `prefers-reduced-motion`.

## 17. Iconography

No decorative icon grid. Wallet icons come from the discovered wallet. Status is type + receipt color, not Lucide wallpaper.

## 18. Imagery

No hero screenshot, no fake dashboard, no gradient mesh. If art is added later it must be a real leak-sheet or pool-edge diagram.

## 19. Component Rules

- `.btn-primary` — one per viewport
- `.btn-ghost` — secondary / rewrites / MAX
- `.kicker` / `.eyebrow` — mono label, not a badge
- `.leak` — hidden vs visible columns
- `.receipt` — ok / pend / err from grade or tx status
- `.steps` — ordered mechanism
- `.spec` — protocol facts

## 20. Interaction States

`:focus-visible` 2px `--accent`, 2px offset. Disabled 0.45 opacity. Modal: overlay click and Escape close. Wallet picker is `role="dialog"`.

## 21. Responsive Strategy

- **<800px**: nav wraps; links stay visible (no hidden-only-desktop menu); 3-col and leak columns stack; touch targets ≥44px.
- **768–1024**: single console column, full leak sheet.
- **≥1120**: home max 1120px, vault 1040px.

## 22. Accessibility

Landmarks: skip link, `nav`, `main`, `footer`. One `h1` per page. Inputs inside `<label>`. Contrast: `--text` on `--bg` AAA; `--muted` on `--bg` AA. Accent is not body text.

## 23. Anti-Slop Commitments

Inspected and rejected unless product-justified: centered SaaS hero, three equal feature cards, gradient blobs, glass cards on flat ground, fake stats, Get Started, award pills, Lucide-on-every-heading.

## 24. Open Questions

None blocking. Hero art is optional and must be a real product surface, not decoration.

## 25. Implementation Notes

Tokens live in `src/app/globals.css`. Pages consume those classes. Do not introduce Tailwind or a second theme file.
