"use client";

import { useTranslations } from "next-intl";
import { Plus, X } from "@/components/icons";
import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import {
  DEFAULT_NOTE_EDITOR_PREFS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  NOTE_VIEW_MODES,
  TOOLBAR_ITEM_IDS,
  TOOLBAR_MODES,
  type ToolbarItemId,
  percentFromWidth,
  widthFromPercent,
} from "@/lib/notes/editor-prefs";
import { cn } from "@/lib/utils/cn";
import { usePrefs } from "@/stores/prefs";

/** Toolbar command id → its label key under `notes.editor.toolbar`. */
const ITEM_LABEL_KEY: Record<ToolbarItemId, string> = {
  undo: "undo",
  redo: "redo",
  formatPainter: "format_painter",
  clearFormatting: "clear_formatting",
  heading: "heading",
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  highlight: "highlight",
  textColor: "text_color",
  superscript: "superscript",
  subscript: "subscript",
  inlineCode: "code",
  bulletList: "list_unordered",
  orderedList: "list_ordered",
  taskList: "checkbox",
  outdent: "outdent",
  indent: "indent",
  align: "align",
  blockquote: "blockquote",
  callout: "callout",
  codeBlock: "code_block",
  table: "table",
  horizontalRule: "horizontal_rule",
  link: "link",
  wikilink: "wikilink",
  image: "image",
  math: "math",
  footnote: "footnote",
};

const MAX_SLOTS = 12;

function PaletteEditor({
  colors,
  variant,
  onChange,
}: {
  colors: string[];
  variant: "text" | "background";
  onChange: (colors: string[]) => void;
}) {
  const t = useTranslations("notes.settings");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((color, i) => (
        <span key={`${color}-${i}`} className="group relative">
          <label
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[7px] border border-rule text-[14px] font-semibold"
            style={variant === "background" ? { backgroundColor: color } : { color }}
            title={color}
          >
            {variant === "text" ? "A" : null}
            <input
              type="color"
              value={color.slice(0, 7)}
              onChange={(e) => {
                const next = [...colors];
                next[i] = variant === "background" ? `${e.target.value}59` : e.target.value;
                onChange(next);
              }}
              className="sr-only"
              aria-label={color}
            />
          </label>
          {colors.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange(colors.filter((_, j) => j !== i))}
              aria-label={t("remove_color")}
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 place-items-center rounded-full bg-ink text-paper group-hover:grid"
            >
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          ) : null}
        </span>
      ))}
      {colors.length < MAX_SLOTS ? (
        <button
          type="button"
          onClick={() => onChange([...colors, variant === "background" ? "#ffe06659" : "#808080"])}
          aria-label={t("add_color")}
          title={t("add_color")}
          className="grid h-8 w-8 place-items-center rounded-[7px] border border-dashed border-rule-strong text-ink-3 hover:text-ink"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Settings → Notes → Editor: everything the notes editor stores in prefs. */
export function NoteEditorSection() {
  const t = useTranslations("notes.settings");
  const tToolbar = useTranslations("notes.editor.toolbar");
  const tPage = useTranslations("notes.page");
  const prefs = usePrefs((s) => s.noteEditor);
  const setPrefs = usePrefs((s) => s.setNoteEditorPrefs);
  const reset = usePrefs((s) => s.resetNoteEditorPrefs);

  const enabled = new Set(prefs.toolbarItems);
  const toggleItem = (id: ToolbarItemId) => {
    // Keep the canonical order so toggling never shuffles the ribbon.
    const next = TOOLBAR_ITEM_IDS.filter((x) => (x === id ? !enabled.has(x) : enabled.has(x)));
    setPrefs({ toolbarItems: next });
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("toolbar_mode")}
        description={t("toolbar_mode_desc")}
        control={
          <SegmentedControl
            size="sm"
            value={prefs.toolbarMode}
            onChange={(v) => setPrefs({ toolbarMode: v })}
            ariaLabel={t("toolbar_mode")}
            options={TOOLBAR_MODES.map((m) => ({ value: m, label: t(`toolbar_mode_${m}`) }))}
          />
        }
      />
      <SettingsRow
        title={t("default_view")}
        description={t("default_view_desc")}
        control={
          <SegmentedControl
            size="sm"
            value={prefs.defaultViewMode}
            onChange={(v) => setPrefs({ defaultViewMode: v })}
            ariaLabel={t("default_view")}
            options={NOTE_VIEW_MODES.map((m) => ({ value: m, label: tPage(`mode_${m}`) }))}
          />
        }
      />
      <SettingsRow
        title={t("font_size")}
        description={t("font_size_desc")}
        control={
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={EDITOR_FONT_SIZE_MIN}
              max={EDITOR_FONT_SIZE_MAX}
              value={prefs.fontSize}
              onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })}
              aria-label={t("font_size")}
              className="w-32 accent-[var(--color-accent)]"
            />
            <span className="w-10 text-right text-[12.5px] tabular-nums text-ink-3">{prefs.fontSize}px</span>
          </div>
        }
      />
      <SettingsRow
        title={t("editor_width")}
        description={t("editor_width_desc")}
        control={
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={percentFromWidth(prefs.editorWidth)}
              onChange={(e) => setPrefs({ editorWidth: widthFromPercent(Number(e.target.value)) })}
              aria-label={t("editor_width")}
              className="w-32 accent-[var(--color-accent)]"
            />
            <span className="w-14 text-right text-[12.5px] tabular-nums text-ink-3">{prefs.editorWidth}px</span>
          </div>
        }
      />
      <SettingsRow
        title={t("spellcheck")}
        description={t("spellcheck_desc")}
        control={
          <Switch
            checked={prefs.spellcheck}
            onCheckedChange={(v) => setPrefs({ spellcheck: v })}
            ariaLabel={t("spellcheck")}
          />
        }
      />
      <SettingsRow
        title={t("toolbar_items")}
        description={t("toolbar_items_desc")}
        control={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPrefs({ toolbarItems: [...DEFAULT_NOTE_EDITOR_PREFS.toolbarItems] })}
          >
            {t("reset_toolbar")}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-1.5" data-testid="toolbar-item-toggles">
          {TOOLBAR_ITEM_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={enabled.has(id)}
              onClick={() => toggleItem(id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                enabled.has(id)
                  ? "border-accent-soft bg-accent-wash text-accent-ink"
                  : "border-rule text-ink-4 line-through hover:text-ink-2",
              )}
            >
              {tToolbar(ITEM_LABEL_KEY[id])}
            </button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow title={t("text_palette")} description={t("palette_desc")}>
        <PaletteEditor colors={prefs.textColors} variant="text" onChange={(c) => setPrefs({ textColors: c })} />
      </SettingsRow>
      <SettingsRow title={t("background_palette")}>
        <PaletteEditor
          colors={prefs.backgroundColors}
          variant="background"
          onChange={(c) => setPrefs({ backgroundColors: c })}
        />
      </SettingsRow>
      <SettingsRow
        title={t("reset")}
        description={t("reset_desc")}
        control={
          <Button size="sm" variant="default" onClick={reset}>
            {t("reset")}
          </Button>
        }
      />
    </SettingsGroup>
  );
}
