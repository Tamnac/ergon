# Design

Ergon is inspired by TeuxDeux but has its own look: outline-style, monochrome plus one accent color, condensed display type. Tokens live in [tokens.css](../apps/web/src/styles/tokens.css); this file says how to use them. Update it when a rule changes.

## Principles

- Content (todos, days, lists) has no borders or shadows. Structure comes from whitespace and thin ruled lines in `--line`.
- Raised or transient things (dialogs, menus, drag ghost, focus, errors, drop targets) get **rings**. The more rings, the more important the thing.
- One accent color, set by the user. Everything else is `--fg`, `--bg` and grays.
- Motion is short and explains where something came from (rings expand, days slide, the calendar zooms). Everything falls back to static under `prefers-reduced-motion`.

## Rings

Concentric 1px outlines made from `box-shadow`, with a `--bg` gap between them. Color fades from the accent toward `--fg` going outward (`--ring-c1`..`--ring-c3`).

| Token      | Rings | Outer reach | Used for                                                                                                                                                       |
| ---------- | ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ring-1` | 1     | 1px         | Focus on controls inside dialogs (`.dialog :focus-visible`), on a todo row (`.todo:focus-visible`), hovered "New list", the todo an anchored dialog belongs to |
| `--ring-2` | 2     | 6px         | Focus everywhere else (`:focus-visible`), errors, drag ghost, menus and anchored dialogs (veiled, see below)                                                   |
| `--ring-3` | 3     | 14px        | Centered dialogs (settings, help, sync, scope)                                                                                                                 |

- Gaps are 4px between ring 1 and 2, and 7px between ring 2 and 3.
- A ring never sits inside the same level of ring: controls inside a dialog drop one level (`ring-3` dialog, `ring-1` focus) so a dialog stays at most three outlines deep.
- Rings appear with `--ring-in` (expand outward with a small overshoot) and the shared `ring-in` keyframes in [base.css](../apps/web/src/styles/base.css).
- Don't add borders to content to get emphasis; use a ring or `--accent`.

### Veiled rings

Surfaces that float over content (menus, anchored dialogs) use `--ring-2-veiled`: the inner ring and a translucent `--ring-veil` (under the rings and a soft halo a little beyond) are shadows, and the outer ring is a 1px shadow around an empty `::after` box (see base.css), so the gap between the rings is empty instead of a solid `--bg` fill and text shows through it. Stacked shadows can't do this, since each outer ring is a filled shape under the inner ones. `outline` is not used: browsers round its offset and width to device pixels differently from shadows, which made the outer ring thinner and closer at 150% scaling. Centered dialogs sit over the dimmed backdrop and keep the plain `--ring-3`.

### Anchored dialogs

Reminder and repeat dialogs sit beside the todo they edit (desktop, when there is room; otherwise centered). The todo gets `.is-anchor` (`--ring-1`) and a 1px `--ring-c1` leader line joins its ring to the dialog's outer ring (it runs 1px under each so device-pixel rounding leaves no gap), level with the dialog title. See `placeBeside` in [Dialog.tsx](../apps/web/src/components/Dialog.tsx).

## Color

| Token           | Role                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--accent`      | User-chosen. Today's cap, the active tab, checked checkboxes, editing underline, link underlines, calendar marks, primary buttons, selected segments |
| `--accent-fg`   | Text on accent, picked automatically for contrast (`readableOn` in [color.ts](../apps/web/src/lib/color.ts))                                         |
| `--accent-soft` | Accent at 14%: the visible range in the calendar                                                                                                     |
| `--bg`, `--fg`  | Page and text. Light and dark via `light-dark()`                                                                                                     |
| `--bg-alt`      | Panels such as the lists tab bar                                                                                                                     |
| `--fg-muted`    | Secondary text, past days, done todos (with strikethrough), icon buttons, labels                                                                     |
| `--line`        | Hairlines: ruled filler lines, separators                                                                                                            |
| `--line-strong` | Outlines of inputs, checkboxes, buttons, segmented controls                                                                                          |
| `--hover`       | Hover background for rows and icon buttons                                                                                                           |

Theme (light, dark, system) and accent are applied in [App.tsx](../apps/web/src/App.tsx) and cached for the pre-paint script in index.html.

## Type

- Display: Barlow Condensed (`--font-display`) for drop caps, dialog titles, calendar dates, list names. Always uppercase for titles.
- Body: system UI (`--font-body`). Mono (`--font-mono`) for keys, recovery phrases, rules.
- Drop caps: a large first letter (`Cap`, 2.75rem) with the rest of the word small, uppercase and letter-spaced beside it. Days put the rest of the weekday above the date; lists wrap their name to two lines. Today's cap is accent, past days are muted.
- Small caps labels (`--text-xs`, bold, `--tracking-caps`, `--fg-muted`) for form field labels and calendar captions.
- Scale: `--text-xs` .. `--text-2xl`.

## Spacing and layout

- 4px base scale `--space-1`..`--space-8`; a todo row is `--row` (31px) high, ruled lines sit on that rhythm.
- Drops show a 3px accent bar (`.drop-indicator`), not a ring.
- Below the last todo two ruled lines, the second shorter; the rest of the column is the click-to-add and drop target.
- Layout (top bar, right sidebar, lists panel with bottom tab bar) is described in [PLAN.md](../PLAN.md) M1.5; phones use `.app.is-phone`.

## Motion

- Day navigation slides columns (FLIP), the calendar button zooms between the day grid and a month view, completions play a [completion effect](../apps/web/src/lib/effects.ts).
- Rings use 820ms because of the overshoot. Respect `reducedMotion()` in JS and `prefers-reduced-motion` in CSS.
