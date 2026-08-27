# Spendlygo — Design System

**Direction:** *Native Telegram, elevated.*
The Mini App should feel like a first-party Telegram feature that someone
unusually good at motion design happened to build — not a website in a webview.

**Related:** [`PRD.md`](./PRD.md) · [`GUARDRAILS.md`](./GUARDRAILS.md) · [`CLAUDE.md`](./CLAUDE.md)

---

## 1. Principles

1. **One number, always.** Every screen answers "am I OK?" before it answers
   anything else. The safe-to-spend figure is the hero on the home screen and
   never more than one tap away.
2. **The consequence is visible.** Saving a spend animates the ring downward.
   The user should *feel* the money leave. This is the app's emotional core.
3. **Borrow the chrome, own the content.** Backgrounds, text colours, and system
   buttons come from Telegram. Cards, charts, and motion are ours.
4. **Motion carries meaning.** Every animation explains a relationship —
   where a thing came from, what it became, what it cost. Decoration-only
   motion gets cut.
5. **Thumb-first.** Primary actions live in the bottom third. Nothing critical
   sits in the top-right corner, where Telegram's own close button lives.
6. **Fast beats rich.** A 200 KB bundle that opens in 400 ms beats a beautiful
   one that opens in two seconds. Cold start is the first impression.

---

## 2. Colour

### 2.1 Telegram theme variables (the base layer)

The app adopts the user's Telegram theme. Light/dark handling is therefore
automatic and must not be re-implemented.

| Token | Telegram variable | Use |
|---|---|---|
| `--bg` | `--tg-theme-bg-color` | Page background |
| `--bg-secondary` | `--tg-theme-secondary-bg-color` | Cards, sheets, inputs |
| `--bg-section` | `--tg-theme-section-bg-color` | Grouped list sections |
| `--text` | `--tg-theme-text-color` | Primary text |
| `--text-subtle` | `--tg-theme-subtitle-text-color` | Secondary text |
| `--text-hint` | `--tg-theme-hint-color` | Placeholders, captions |
| `--accent` | `--tg-theme-button-color` | Primary actions, active states |
| `--accent-text` | `--tg-theme-button-text-color` | Text on accent |
| `--link` | `--tg-theme-link-color` | Links |
| `--destructive` | `--tg-theme-destructive-text-color` | Delete, over-budget |

🔴 **Never hardcode a hex value for any of the above.** Always provide a
fallback in case a client omits a variable:
`var(--tg-theme-bg-color, #ffffff)`.

### 2.2 Semantic tokens (ours)

Derived, theme-agnostic, and the only place new colour is introduced:

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--money-in` | Income, ahead of pace | `#1DB954` | `#3DDC84` |
| `--money-out` | Expense | `--text` | `--text` |
| `--pace-ahead` | Under budget | `#1DB954` | `#3DDC84` |
| `--pace-ontrack` | Within ±10% | `--accent` | `--accent` |
| `--pace-behind` | Over pace | `#F5A623` | `#FFB84D` |
| `--over-budget` | Budget exceeded | `--destructive` | `--destructive` |

**Expenses are not red.** Red is reserved for *over budget* and *destructive
actions*. If every expense is red, the user stops reading red — and most
spending is perfectly fine.

### 2.3 Category colours

Twelve hues, evenly spaced, tuned for equal perceived lightness so no category
dominates a donut chart. Each category stores a **token name**, never a hex, so
the palette can be retuned centrally.

```
food #FF7A59  groceries #4ECDC4  transport #5B8DEF  shopping #C77DFF
bills #FFB84D  health #FF6B9D    entertainment #9B7EDE  travel #38C6D9
education #7ED957  gifts #FF9FF3 transfers #98A2B3  uncategorised #667085
```

Charts must never rely on colour alone: always pair with a label, an emoji, or
a value.

---

## 3. Typography

Use the system font stack — it is what makes a webview feel native.

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
             Roboto, system-ui, sans-serif;
```

| Role | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 56px | 700 | −0.03em | The safe-to-spend number |
| `amount-lg` | 34px | 700 | −0.02em | Capture input, period totals |
| `title` | 22px | 600 | −0.01em | Screen titles |
| `heading` | 17px | 600 | 0 | Card headers, list sections |
| `body` | 16px | 400 | 0 | Default |
| `amount-row` | 16px | 600 | −0.01em | Amounts in lists (tabular) |
| `caption` | 13px | 400 | 0 | Dates, hints |
| `label` | 11px | 600 | 0.06em | Uppercase micro-labels |

**Rules**
- 🟢 All numeric displays use `font-variant-numeric: tabular-nums`, so digits
  don't jitter while animating.
- 🟢 Minimum body size is 13px. Nothing smaller, ever.
- 🟢 Amounts render as `S$1,234.56` — grouped thousands, always two decimals.
  In the display style, cents render at 60% size and aligned to the top of the
  dollar digits.

---

## 4. Layout & spacing

**4px base scale:** `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56`

| Token | Value |
|---|---|
| `--space-screen-x` | 16px (screen gutter) |
| `--space-card` | 16px (card padding) |
| `--space-stack` | 12px (between cards) |
| `--radius-sm` | 10px (chips, inputs) |
| `--radius-md` | 16px (cards) |
| `--radius-lg` | 24px (sheets, hero) |
| `--radius-full` | 999px (pills, FAB) |

**Rules**
- 🟢 Respect the safe area: `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
- 🟢 Minimum touch target 44×44px, including chart slices and chips.
- 🟢 Use Telegram's `MainButton` for the primary action on any screen that has
  one — do not paint a custom bottom button next to it.
- 🟢 Use Telegram's `BackButton` for back navigation — never a custom in-page
  back arrow.
- 🟢 Content max-width 520px, centred, so tablets don't stretch.

---

## 5. Motion

Motion is a first-class feature here, not polish. But it is **physics, not
duration** — springs, so interrupted animations retarget smoothly instead of
snapping.

### 5.1 Springs

| Token | Config | Use |
|---|---|---|
| `spring.snappy` | `stiffness 500, damping 32` | Chips, toggles, taps |
| `spring.smooth` | `stiffness 260, damping 30` | Sheets, cards, page transitions |
| `spring.gentle` | `stiffness 140, damping 22` | The safe-to-spend ring, charts |
| `spring.bouncy` | `stiffness 400, damping 15` | Success confirmations only |

Durations, where a spring doesn't apply: `fast 120ms`, `base 200ms`,
`slow 320ms`; easing `cubic-bezier(0.32, 0.72, 0, 1)`.

### 5.2 The motion catalogue

| Moment | Behaviour |
|---|---|
| **App open** | Content fades up 12px, staggered 40ms per card, `spring.smooth`. Never a blank frame — render skeletons immediately. |
| **Number changes** | Digits roll vertically, odometer-style, `spring.gentle`. The value counts, it doesn't cut. |
| **Save a spend** | Ring sweeps down to the new value over ~600ms while the amount rolls; a soft haptic fires at rest; *then* the sheet dismisses. |
| **Ring on load** | Sweeps from 0 to current with `spring.gentle`, 80ms delay. |
| **Category chips** | Scale 0.94 on press, spring back; selected chip's background morphs via a shared layout transition rather than fading. |
| **Sheet open/close** | Slides from the bottom with `spring.smooth`; backdrop fades to 40% black. Drag-to-dismiss with velocity-aware snapping. |
| **List rows** | Stagger in at 30ms intervals; swipe-left reveals edit/delete with rubber-band resistance past the threshold. |
| **Bar & donut charts** | Bars grow from baseline, staggered 25ms; donut arcs sweep clockwise. Period changes **morph** the same elements, never remount them. |
| **Tab switch** | Underline slides via shared layout; content cross-fades with an 8px directional slide matching the swipe direction. |
| **Undo** | Row collapses its height to 0 while fading; a toast slides up with a countdown ring on the undo button. |
| **Over budget** | The ring transitions to `--over-budget` with a single 400ms pulse. Once. Never a loop — a looping alarm gets ignored. |
| **Error** | Horizontal shake, 3 oscillations, 6px, 300ms, plus an error haptic. |
| **Pull to refresh** | Ring rotation tracks drag distance 1:1, then spins while loading. |

### 5.3 Rules

- 🔴 Animate **`transform` and `opacity` only**. Animating `width`, `height`,
  `top`, or `left` drops frames on mid-range Android.
- 🔴 No animation may block input. The user can always tap through it.
- 🟢 Honour `prefers-reduced-motion`: transitions become instant state changes;
  the odometer sets its value directly; layout stays identical.
- 🟢 Nothing loops indefinitely except a genuine loading indicator.
- 🟢 Total time from tapping Save to a usable UI stays under 700 ms.

---

## 6. Haptics

Telegram gives us real haptics — they do more for "native feel" than any
visual, and they are free.

| Event | Call |
|---|---|
| Numpad key press | `impactOccurred('light')` |
| Category / tab selection | `selectionChanged()` |
| Transaction saved | `notificationOccurred('success')` |
| Save failed / validation error | `notificationOccurred('error')` |
| Crossing over budget | `notificationOccurred('warning')` |
| Delete confirmed | `impactOccurred('rigid')` |
| Sheet snapped closed | `impactOccurred('soft')` |

🟢 Wrap every haptic call in a feature check — not every client supports them,
and an unguarded call throws.
🔴 Never fire a haptic on a passive event (scroll, load, incoming data). Haptics
mean *"you did something."*

---

## 7. Screens

### 7.1 Home — "Today"

The screen that justifies the app.

```
┌─────────────────────────────┐
│  Tuesday, 27 August         │  caption, --text-hint
│                             │
│        ╭─────────╮          │  Ring: today's spend vs allowance
│       │  S$42    │          │  display type, odometer
│       │  ╰──────╯ safe today│  caption
│        ╰─────────╯          │
│                             │
│   ● On track  ·  S$18 spent │  pace pill + today's total
│                             │
│  ┌───────────────────────┐  │
│  │ August    S$847 / 1,500│  │  month progress bar
│  │ ▓▓▓▓▓▓▓▓▓░░░░░░  56%  │  │  bar animates on mount
│  └───────────────────────┘  │
│                             │
│  TODAY                      │  label
│  🍜 Lunch          −S$12.50 │  rows stagger in
│  🚇 MRT             −S$2.30 │
│                             │
│         ╭───────╮           │
│         │   +   │           │  FAB → capture sheet
│         ╰───────╯           │
└─────────────────────────────┘
   Today   Stats   History  ⚙
```

Empty state: the ring renders at full allowance with "Nothing spent yet today"
and a single call to action. Never a blank circle.

### 7.2 Capture sheet

Opens straight to the numpad (PRD F2.1).

- Amount at top, `amount-lg`, rolling digits, currency prefix fixed.
- Segmented Expense / Income toggle, animated pill.
- Category chips, horizontally scrollable, ordered by recency-weighted frequency.
- Note field — one line, optional, never blocks save.
- Date pill — "Today", tap to change.
- Camera button to attach a photo.
- Telegram `MainButton` reads `Save S$12.50` and updates live with the amount.

### 7.3 Stats

Segmented control: **Day · Month · Year**, horizontally swipeable.

- **Day** — hourly spend bars, today's transactions, 7-day sparkline.
- **Month** — donut by category (tap a slice to drill through), day-by-day bars,
  in/out/net summary, delta vs last month.
- **Year** — 12-month bars with the current month highlighted, category trend
  ribbon, best/worst month, average monthly burn.

Every chart element is tappable and drills into a filtered list. Period changes
morph existing shapes rather than remounting them.

### 7.4 History

Grouped by day with sticky date headers showing that day's total. Filter chips
for category, direction, and "has photo". Swipe a row for edit/delete. Infinite
scroll in pages of 30.

### 7.5 Settings

Grouped Telegram-style list: monthly budget, timezone, digest time and toggles,
categories (reorder, rename, archive), recurring rules, export CSV, about.

---

## 8. Components

| Component | Notes |
|---|---|
| `<Ring>` | SVG donut, animated `stroke-dashoffset`, colour driven by pace state |
| `<Odometer>` | Per-digit rolling number, tabular figures, reduced-motion aware |
| `<Money>` | The only component that formats cents → `S$1,234.56` |
| `<CategoryChip>` | Emoji + label, shared-layout selected state |
| `<TransactionRow>` | Emoji, note, category, amount, photo badge, swipe actions |
| `<Sheet>` | Bottom sheet, drag-to-dismiss, focus trap, safe-area aware |
| `<BarChart>` `<DonutChart>` `<Sparkline>` | Hand-rolled SVG — no chart library (see `GUARDRAILS.md` §8) |
| `<PacePill>` | Ahead / On track / Behind, with a status dot |
| `<EmptyState>` | Illustration slot, one line of copy, one action |
| `<Skeleton>` | Shimmer placeholder matching the real layout's dimensions |

---

## 9. Voice & copy

- Second person, present tense, contractions. "You've got S$42 left today."
- Never scold. "You're S$60 over this month" — not "You overspent!"
- Numbers before words: "S$42 safe today", not "You can safely spend S$42".
- Errors say what happened and what to do: "Couldn't save — tap to retry."
- No exclamation marks except a genuine milestone (first month under budget).
- Emoji: exactly one per category, none in body copy.

---

## 10. Accessibility

- 🟢 Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and chart strokes,
  verified in both Telegram light and dark themes.
- 🟢 Never encode meaning in colour alone — pair with label, icon, or value.
- 🟢 Every interactive element has an accessible name; icon-only buttons carry
  `aria-label`.
- 🟢 Charts expose an accessible summary (`role="img"` + `aria-label` stating
  the totals) and a screen-reader table alternative.
- 🟢 Focus is visible and trapped inside open sheets.
- 🟢 The layout survives 200% text scaling without clipping the hero number.
- 🟢 `prefers-reduced-motion` is fully supported (§5.3).

---

## 11. Definition of visually done

A screen ships when:

- [ ] It looks correct in Telegram light **and** dark themes
- [ ] It looks correct at 375px width (iPhone SE) and 430px
- [ ] Every async state exists: loading skeleton, empty, error, populated
- [ ] Every animation uses a token from §5.1 — no ad-hoc durations
- [ ] `prefers-reduced-motion` is handled
- [ ] Haptics fire on interaction, and only on interaction
- [ ] No hardcoded colours; all colour flows from §2
- [ ] Safe areas respected; nothing sits under Telegram's own chrome
- [ ] Contrast checked in both themes
