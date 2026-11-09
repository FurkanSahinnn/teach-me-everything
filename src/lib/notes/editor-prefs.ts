/**
 * Per-device preferences for the notes editor: line width, font size, toolbar
 * placement and contents, colour palettes and pane layout.
 *
 * Lives outside `stores/prefs.ts` so the shape, defaults and the sanitiser
 * that the prefs migration and every setter share stay in one testable place.
 * `sanitizeNoteEditorPrefs` accepts anything (a persisted payload from an
 * older build, a hand-edited localStorage value) and returns a valid record,
 * keeping every field that is already valid.
 */

export const TOOLBAR_MODES = ["top", "floating", "both", "hidden"] as const;
export type ToolbarMode = (typeof TOOLBAR_MODES)[number];

export const NOTE_VIEW_MODES = ["live", "source", "reading"] as const;
export type NoteViewMode = (typeof NOTE_VIEW_MODES)[number];

/** Every command the editing toolbar can show, in default order. */
export const TOOLBAR_ITEM_IDS = [
  "undo",
  "redo",
  "formatPainter",
  "clearFormatting",
  "heading",
  "bold",
  "italic",
  "underline",
  "strike",
  "highlight",
  "textColor",
  "superscript",
  "subscript",
  "inlineCode",
  "bulletList",
  "orderedList",
  "taskList",
  "outdent",
  "indent",
  "align",
  "blockquote",
  "callout",
  "codeBlock",
  "table",
  "horizontalRule",
  "link",
  "wikilink",
  "image",
  "math",
  "footnote",
] as const;
export type ToolbarItemId = (typeof TOOLBAR_ITEM_IDS)[number];

export const EDITOR_WIDTH_MIN = 560;
export const EDITOR_WIDTH_MAX = 1600;
export const EDITOR_FONT_SIZE_MIN = 13;
export const EDITOR_FONT_SIZE_MAX = 22;
const MAX_PALETTE_SLOTS = 12;
const MAX_RECENT_COLORS = 8;
export const PANEL_WIDTH_MIN = 200;
export const PANEL_WIDTH_MAX = 480;

export type NoteEditorPrefs = {
  /** Max width of the text column in px (Editor Width Slider). */
  editorWidth: number;
  fontSize: number;
  toolbarMode: ToolbarMode;
  /** Ordered, enabled toolbar commands. */
  toolbarItems: ToolbarItemId[];
  /** Text colour slots (Colored Text palette), `#rrggbb`. */
  textColors: string[];
  /** Background/highlight colour slots, `#rrggbbaa` so they read on any theme. */
  backgroundColors: string[];
  /** Most recent first; custom colours picked from the colour input. */
  recentColors: string[];
  defaultViewMode: NoteViewMode;
  spellcheck: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
};

// Mid-tone hues stay legible on both the white/sepia papers and the dark
// canvases; background slots carry ~35% alpha for the same reason.
export const DEFAULT_TEXT_COLORS = [
  "#e5484d",
  "#f76b15",
  "#d4a72c",
  "#30a46c",
  "#0090ff",
  "#8e4ec6",
  "#d6409f",
];
export const DEFAULT_BACKGROUND_COLORS = [
  "#ffe06659",
  "#8ce99a59",
  "#74c0fc59",
  "#faa2c159",
  "#ffa94d59",
  "#b197fc59",
];

export const DEFAULT_NOTE_EDITOR_PREFS: NoteEditorPrefs = {
  editorWidth: 760,
  fontSize: 16,
  toolbarMode: "top",
  toolbarItems: [...TOOLBAR_ITEM_IDS],
  textColors: DEFAULT_TEXT_COLORS,
  backgroundColors: DEFAULT_BACKGROUND_COLORS,
  recentColors: [],
  defaultViewMode: "live",
  spellcheck: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  leftPanelWidth: 272,
  rightPanelWidth: 288,
};

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sanitizePalette(value: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const colors = value.filter(isHexColor).map((c) => c.toLowerCase());
  const unique = [...new Set(colors)].slice(0, max);
  return unique.length > 0 ? unique : fallback;
}

function sanitizeToolbarItems(value: unknown): ToolbarItemId[] {
  if (!Array.isArray(value)) return [...TOOLBAR_ITEM_IDS];
  const known = new Set<string>(TOOLBAR_ITEM_IDS);
  const items = value.filter((v): v is ToolbarItemId => typeof v === "string" && known.has(v));
  // An empty list is a valid choice (toolbar with no commands) only when the
  // user saved it that way; a non-array payload falls back to the default.
  return [...new Set(items)];
}

export function sanitizeNoteEditorPrefs(value: unknown): NoteEditorPrefs {
  const d = DEFAULT_NOTE_EDITOR_PREFS;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...d, toolbarItems: [...d.toolbarItems] };
  }
  const r = value as Record<string, unknown>;
  const recent = Array.isArray(r.recentColors)
    ? [...new Set(r.recentColors.filter(isHexColor).map((c) => c.toLowerCase()))].slice(
        0,
        MAX_RECENT_COLORS,
      )
    : [];
  return {
    editorWidth: clampInt(r.editorWidth, EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX, d.editorWidth),
    fontSize: clampInt(r.fontSize, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, d.fontSize),
    toolbarMode: pickEnum(r.toolbarMode, TOOLBAR_MODES, d.toolbarMode),
    toolbarItems: sanitizeToolbarItems(r.toolbarItems),
    textColors: sanitizePalette(r.textColors, d.textColors, MAX_PALETTE_SLOTS),
    backgroundColors: sanitizePalette(r.backgroundColors, d.backgroundColors, MAX_PALETTE_SLOTS),
    recentColors: recent,
    defaultViewMode: pickEnum(r.defaultViewMode, NOTE_VIEW_MODES, d.defaultViewMode),
    spellcheck: typeof r.spellcheck === "boolean" ? r.spellcheck : d.spellcheck,
    leftPanelOpen: typeof r.leftPanelOpen === "boolean" ? r.leftPanelOpen : d.leftPanelOpen,
    rightPanelOpen: typeof r.rightPanelOpen === "boolean" ? r.rightPanelOpen : d.rightPanelOpen,
    leftPanelWidth: clampInt(r.leftPanelWidth, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, d.leftPanelWidth),
    rightPanelWidth: clampInt(
      r.rightPanelWidth,
      PANEL_WIDTH_MIN,
      PANEL_WIDTH_MAX,
      d.rightPanelWidth,
    ),
  };
}

/** Push a colour to the front of the recent list (deduped, capped). */
export function pushRecentColor(recent: readonly string[], color: string): string[] {
  if (!isHexColor(color)) return [...recent];
  const lower = color.toLowerCase();
  return [lower, ...recent.filter((c) => c !== lower)].slice(0, MAX_RECENT_COLORS);
}

/**
 * Per-note width override from frontmatter (`editor-width: 0-100`), the same
 * key the Obsidian Editor Width Slider reads. Maps the percentage onto the
 * slider's pixel range. Returns null when absent or invalid; `0` is a valid
 * value (the plugin treats it as falsy, a bug we don't copy).
 */
export function readFrontmatterEditorWidth(content: string): number | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = content.slice(3, end);
  const match = /^editor-width:\s*["']?(\d{1,3})["']?\s*$/m.exec(block);
  if (!match) return null;
  const pct = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return widthFromPercent(pct);
}

export function widthFromPercent(pct: number): number {
  const p = Math.min(100, Math.max(0, pct));
  return Math.round(EDITOR_WIDTH_MIN + ((EDITOR_WIDTH_MAX - EDITOR_WIDTH_MIN) * p) / 100);
}

export function percentFromWidth(width: number): number {
  const w = Math.min(EDITOR_WIDTH_MAX, Math.max(EDITOR_WIDTH_MIN, width));
  return Math.round(((w - EDITOR_WIDTH_MIN) * 100) / (EDITOR_WIDTH_MAX - EDITOR_WIDTH_MIN));
}
