"use client";

import {
  Brain,
  FileText,
  Globe,
  Notebook,
  Route,
  Target,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ComponentType } from "react";
import {
  SourceScopePicker,
  type PickableSource,
} from "@/components/notebook/SourceScopePicker";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ContextScope } from "@/lib/ai/context/types";
import { cn } from "@/lib/utils/cn";

type ContextBarProps = {
  /** Active non-web context scopes for the current thread. `"web"` is handled
   *  separately via `webEnabled` so the native-search toggle can live next to
   *  the grounding chips without leaking into the prompt-context dispatch. */
  scopes: ContextScope[];
  onToggleScope: (scope: ContextScope) => void;
  webEnabled: boolean;
  onToggleWeb: (next: boolean) => void;
  /** Ready sources for the source-scope picker. The picker only renders when
   *  there are ≥2 (no point narrowing among 0 or 1). */
  sources?: PickableSource[];
  /** Empty ⇒ all sources; non-empty ⇒ that subset. */
  selectedSourceIds?: string[];
  onChangeSelectedSources?: (next: string[]) => void;
  /** Disabled while a chat turn is in flight so toggling context mid-stream
   *  can't diverge from the value that turn actually used. */
  disabled?: boolean;
};

// The non-web grounding chips, in display order. Sources is first and defaults
// on (the runner seeds `["sources"]`); the rest are opt-in study-context blocks.
type ChipDef = {
  scope: Exclude<ContextScope, "web">;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  labelKey:
    | "ctx_sources"
    | "ctx_notes"
    | "ctx_concepts"
    | "ctx_roadmap"
    | "ctx_performance";
  hintKey:
    | "ctx_sources_hint"
    | "ctx_notes_hint"
    | "ctx_concepts_hint"
    | "ctx_roadmap_hint"
    | "ctx_performance_hint";
};

const CHIPS: ChipDef[] = [
  {
    scope: "sources",
    icon: FileText,
    labelKey: "ctx_sources",
    hintKey: "ctx_sources_hint",
  },
  {
    scope: "notes",
    icon: Notebook,
    labelKey: "ctx_notes",
    hintKey: "ctx_notes_hint",
  },
  {
    scope: "concepts",
    icon: Brain,
    labelKey: "ctx_concepts",
    hintKey: "ctx_concepts_hint",
  },
  {
    scope: "roadmap",
    icon: Route,
    labelKey: "ctx_roadmap",
    hintKey: "ctx_roadmap_hint",
  },
  {
    scope: "performance",
    icon: Target,
    labelKey: "ctx_performance",
    hintKey: "ctx_performance_hint",
  },
];

function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors",
    active
      ? "border-accent bg-accent-wash text-accent-ink"
      : "border-rule text-ink-4 hover:border-ink-3 hover:text-ink-3",
  );
}

export function ContextBar({
  scopes,
  onToggleScope,
  webEnabled,
  onToggleWeb,
  sources,
  selectedSourceIds,
  onChangeSelectedSources,
  disabled = false,
}: ContextBarProps) {
  const t = useTranslations("workspace_chat");
  const active = new Set(scopes);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
        {t("context_label")}
      </span>
      {CHIPS.map(({ scope, icon: Icon, labelKey, hintKey }) => {
        const isOn = active.has(scope);
        return (
          <Fragment key={scope}>
            <Tooltip
              content={t(hintKey)}
              side="bottom"
              className="w-max max-w-[260px] whitespace-normal text-left leading-snug normal-case tracking-normal"
            >
              <button
                type="button"
                role="switch"
                aria-checked={isOn}
                data-scope={scope}
                disabled={disabled}
                onClick={() => onToggleScope(scope)}
                className={cn(
                  chipClass(isOn),
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
                <span>{t(labelKey)}</span>
              </button>
            </Tooltip>
            {scope === "sources" &&
            onChangeSelectedSources &&
            sources &&
            sources.length >= 2 ? (
              <SourceScopePicker
                sources={sources}
                selectedSourceIds={selectedSourceIds ?? []}
                onChange={onChangeSelectedSources}
                disabled={disabled || !active.has("sources")}
              />
            ) : null}
          </Fragment>
        );
      })}
      <Tooltip
        content={t("ctx_web_hint")}
        side="bottom"
        className="w-max max-w-[260px] whitespace-normal text-left leading-snug normal-case tracking-normal"
      >
        <button
          type="button"
          role="switch"
          aria-checked={webEnabled}
          data-scope="web"
          data-testid="workspace-web-toggle"
          disabled={disabled}
          onClick={() => onToggleWeb(!webEnabled)}
          className={cn(
            chipClass(webEnabled),
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Globe className="h-3 w-3" aria-hidden />
          <span>{t("ctx_web")}</span>
        </button>
      </Tooltip>
    </div>
  );
}
