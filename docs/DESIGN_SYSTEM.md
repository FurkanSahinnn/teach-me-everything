# Design System

The token system and UI primitives of Teach Me Everything. The single source of truth for tokens is `src/app/globals.css`. For where the pages that use it live, see [FEATURES.md](FEATURES.md); for the component layout, see [CODEMAPS/frontend.md](CODEMAPS/frontend.md).

## Rules

- **Tokens first.** A new color, font, radius, shadow or spacing value is added as a token in `globals.css` (`@theme`, and every theme block if it varies by theme) and documented here before any component uses it. No raw hex values or ad hoc font stacks in components.
- **No `dark:` prefix.** Themes switch through CSS variables under `data-theme`, so a token-based class (`bg-paper`, `text-ink`) is already correct in every theme. Tailwind's `dark:` variant follows `prefers-color-scheme`, not `data-theme`, and does not match the app's themes. (A few legacy usages remain in `src/components/notes/EmbedAsSourceButton.tsx`, `src/components/notes/NoteTreeContextMenu.tsx` and `src/app/settings/page.tsx`; do not copy them.)
- **Primitives before one-offs.** Use `src/components/ui/*` and the icon barrel before writing new markup.
- Every UI string goes through i18n (TR + EN), see `messages/{tr,en}.json`.

## Tailwind v4 setup

`globals.css` starts with `@import "tailwindcss"` and the KaTeX stylesheet, then declares an `@theme` block. Tokens named `--color-*`, `--radius-*`, `--shadow-*`, `--font-*`, `--ease-*`, `--duration-*` become Tailwind utilities (`bg-paper-2`, `text-ink-3`, `border-rule`, `rounded-[var(--radius-sm)]`, `shadow-[var(--shadow-soft)]`). Custom utilities are declared with `@utility`: `paper-grid`, `no-scrollbar`, `eyebrow`, `page-container`, `grain`.

## Color tokens

Each theme redefines the same names (values below are the `white` theme, which is also the `:root` default; the `@theme` block holds the same values).

| Group | Tokens | White values |
|---|---|---|
| Surface (`paper`) | `paper`, `paper-2`, `paper-3`, `paper-4` | `#FFFFFF`, `#FAFAF9`, `#F4F4F2`, `#EDEDEA` |
| Border (`rule`) | `rule`, `rule-soft`, `rule-strong` | `#E5E5E1`, `#EFEEEA`, `#D4D3CD` |
| Text (`ink`) | `ink`, `ink-2` ... `ink-5` | `#0F0F0E`, `#2B2B29`, `#5C5B57`, `#8B8A85`, `#B8B7B1` |
| Accent | `accent`, `accent-hot`, `accent-soft`, `accent-wash`, `accent-ink` | `#B86A2B`, `#C26A2E`, `#E8C9A8`, `#FCEFDC`, `#6E3A0F` |
| Tags | `moss`, `plum`, `slate` | `#4E5E3E`, `#6B3A5E`, `#3C4A58` (not redefined per theme) |
| Semantic | `ok`, `warn`, `err` | `#4E6E3E`, `#A86A1C`, `#8E2F2F` (overridden in `dark` and `github`) |

Usage convention: `paper` is the page, `paper-2` sidebars and sunken areas, `paper-3`/`paper-4` hover and pressed; `ink` is body text, `ink-3` secondary, `ink-4`/`ink-5` tertiary and disabled; `accent-wash` plus `accent-ink` is the highlighted/selected surface; `accent-hot` is the filled call-to-action.

## Themes

Four themes, selected with `data-theme` on `<html>`. The `Theme` type in `src/stores/prefs.ts` is `"white" | "sepia" | "dark" | "github"`.

| Theme | Character | Paper (base) | Ink | Accent | `color-scheme` |
|---|---|---|---|---|---|
| `white` | clean minimal; also the `:root` fallback | `#FFFFFF` | `#0F0F0E` | `#B86A2B` | light |
| `sepia` | warm parchment, reading; border-heavy, almost no shadow | `#F6EAD2` | `#2E1F0E` | `#B86A2B` | light |
| `dark` | warm dark; border plus soft shadow | `#11100E` | `#F5F0E7` | `#D99A5E` | dark |
| `github` | GitHub Dark (Primer palette); border-first, ring on overlays | `#0D1117` | `#E6EDF3` | `#58A6FF` | dark |

How switching works:

- `usePrefs` (`src/stores/prefs.ts`) holds `theme`, `themeFollowsSystem` and `density`, and mirrors them to `data-theme` / `data-density` on `<html>`. The store default is `dark`.
- `themeInitScript` (`src/lib/utils/theme-script.ts`), inlined in `<head>` by `src/app/layout.tsx`, reads `tme:prefs` from localStorage before hydration so the first paint has the right theme (default `dark`; with "follow system" it picks `dark` or `white`).
- `ThemeToggle` (`src/components/ui/ThemeToggle.tsx`) is a four-option radiogroup (White, Sepia, Dark, GitHub); `TweaksPanel` (`src/components/shell/TweaksPanel.tsx`) exposes theme, language and width.
- Shadows are theme-specific: every theme block redefines `--shadow-soft`, `--shadow-medium`, `--shadow-deep`, `--shadow-lift`.

### Density

`data-density` = `compact` | `normal` | `comfy` redefines `--space`, `--pad-x`, `--pad-y`, `--row-sm`/`--row`/`--row-lg` and the type scale `--type-xs` ... `--type-xl`.

| Token | compact | normal | comfy |
|---|---|---|---|
| `--space` | 6px | 8px | 12px |
| `--pad-x` / `--pad-y` | 10 / 6px | 14 / 9px | 18 / 12px |
| `--row-sm` / `--row` / `--row-lg` | 24 / 30 / 36px | 28 / 36 / 44px | 32 / 42 / 50px |
| `--type-xs` ... `--type-xl` | 11, 12, 13, 14, 16px | 12, 13, 14, 15, 17px | 13, 14, 15, 17, 19px |

`body` uses `--type-base` for its font size and 1.5 line height.

## Typography

Fonts are loaded in `src/app/layout.tsx` with `next/font/google` (self-hosted at build, `display: "swap"`) and exposed as CSS variables on `<html>`:

| Loader | Variable | Weights / subsets | Token | Fallbacks |
|---|---|---|---|---|
| `Source_Serif_4` | `--font-source-serif` | 400-700; latin, latin-ext | `--font-serif` | Charter, Iowan Old Style, Georgia, serif |
| `Geist` | `--font-geist` | default; latin, latin-ext | `--font-sans` | system sans |
| `JetBrains_Mono` | `--font-jetbrains-mono` | 400, 500; latin | `--font-mono` | SF Mono, ui-monospace, Menlo |

- `body` is `font-sans`. Serif is for reading surfaces and headings that need it; mono is for code, keys and eyebrow labels.
- `eyebrow` utility: mono, `--type-xs`, 0.08em tracking, uppercase, `ink-3`.
- A new font means a new loader in `layout.tsx` plus a `--font-*` token in `@theme`.

## Radius, motion, layout

- Radius: `--radius-xs` 6px, `--radius-sm` 10px, `--radius` and `--radius-md` 12px (central), `--radius-lg` 16px, `--radius-xl` 24px, `--radius-2xl` 32px.
- Motion: `--ease-out` `cubic-bezier(0.2, 0.6, 0.2, 1)`, `--ease-spring` `cubic-bezier(0.34, 1.56, 0.64, 1)`; `--duration-fast` 120ms, `--duration-normal` 180ms, `--duration-slow` 280ms. A `prefers-reduced-motion` rule collapses animation and transition durations globally.
- `page-container`: max width 1180px, centered; padding 20/16px, widening at 640px and 1024px.
- Scrollbars: thin, themed with `rule` / `rule-strong`; `scroll-paper` class for custom scroll areas.

## UI primitives (`src/components/ui/`)

| Component | Props worth knowing |
|---|---|
| `Button` | `variant`: `default` (default), `primary`, `accent`, `ghost`, `danger`. `size`: `sm`, `md` (default), `lg`, `icon-sm`, `icon-md`, `icon-lg`. `loading`. |
| `Card` | `variant`: `default`, `sunken`, `floating`, `ghost`, `accent`. Padding scale: `none`, `sm`, `md`, `lg`, `xl`. |
| `Chip` | `variant`: `default`, `accent`, `muted`, `ok`, `warn`, `err`. `size`: `sm`, `md`. |
| `Input` | `variant`: `default` or `mono`; `invalid`. |
| `Modal` | `open`, `onClose`, `title`, `description`, `footer`, `size`: `sm`, `md`, `lg`, `xl`, `full`; `closeOnBackdrop`, `closeOnEsc`, `initialFocusRef`. |
| `ConfirmDeleteModal` | Destructive confirm built on `Modal` and `Button variant="danger"`. |
| `SegmentedControl<T>` | Generic option list; `size`: `sm`, `md`; `tone`: `default`, `inverted`. |
| `Switch` | `size`: `sm`, `md`. |
| `Tooltip` | `content`, `side`: `top`, `bottom`, `left`, `right`; `delay`, `hideOnMobile`. |
| `Toast` | `ToastProvider` (mounted in `layout.tsx`) and `useToast()`; `variant`: `info`, `success`, `warn`, `error`; errors and warnings use `role="alert"`. |
| `EmptyState` | `icon`, `title`, `description`, optional `action` (`label` plus `onClick` or `href`). |
| `Skeleton` | `variant`: `text`, `rect`, `circle`; `lines` for multi-line text. |
| `Kbd` | Keyboard key cap (mono, `rule` border). |
| `ThemeToggle` | `size`: `sm`, `md`. |

Compose class names with `cn` from `@/lib/utils/cn`. Primitives take `className` for layout tweaks, not for recoloring.

## Icons

Icons come from `lucide-react`, re-exported through the barrel `src/components/icons/index.ts` (grouped by purpose: navigation, actions, and so on). Add a new icon to the barrel first and import it from `@/components/icons`. Some existing files (for example `ThemeToggle`, `src/lib/fixtures/navigation.ts`) still import `lucide-react` directly. Sizes are set with `h-*/w-*` classes (commonly `h-3.5 w-3.5` to `h-4 w-4`); decorative icons carry `aria-hidden`.

## Markdown and prose

Rendered by `MarkdownPreview` (`src/components/markdown/MarkdownPreview.tsx`) under the `.markdown-preview` class; chat uses `.chat-bubble-markdown` for KaTeX display math. All rules are in `globals.css`.

- Block styles: headings `h1`-`h6`, `p`, `strong`, `a`, `ul`/`ol`/`li`, `blockquote`, `hr`, `table`/`thead`/`th`/`td`, `mark`, footnotes (`.footnote-ref`, `.footnote-label`, `p.footnote-def`), task lists (`li.task-list-item`, `.task-list-checkbox`).
- Code: `pre.markdown-code-block`, `code.markdown-inline-code`, highlight.js token classes `.hljs-*`. Code colors come from `--md-code-*` and `--md-inline-code-bg` variables: a light GitHub skin by default, and the dark GitHub skin under `dark`, `sepia` and `github` themes.
- Callouts: `blockquote.callout` with `.callout-title`, and type modifiers `callout-warning`, `callout-caution`, `callout-danger`, `callout-bug`, `callout-failure`, `callout-error`, and `callout-tip`, `callout-hint`, `callout-success`, `callout-check`, `callout-done`. Default callouts use `accent` and `accent-wash`.
- Wikilinks: `a.wikilink` and `.wikilink-embed`.
- Math: KaTeX (`.katex`, `.katex-display`).
- PDF text layer: `.textLayer` rules for `PdfViewer` selection and highlighting.
- Citation chips: `CitationChip` and `WebCitationChip` (`src/components/notebook/`) are components styled with token utilities (no dedicated CSS class). `.citation-pulse` (keyframes `citation-pulse`, 1.2s, `accent-wash`) briefly highlights the target chunk after a chip jumps to it in the reader.

## Adding to the system

1. Add the token to `@theme`; if it differs by theme, add it to all four theme blocks (`white`, `sepia`, `dark`, `github`) and check contrast in each.
2. Document it in this file.
3. Use the token-based utility in the component. Add a variant to the relevant primitive rather than restyling it at the call site.
