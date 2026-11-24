"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PaneResizer } from "@/components/notes/layout/PaneResizer";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

export type ReaderTab = "source" | "chat" | "notes";

const MIN_READER_WIDTH = 320;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 560;
const HANDLE_WIDTH = 7;
const MIN_SPLIT_WIDTH = MIN_READER_WIDTH + HANDLE_WIDTH + MIN_PANEL_WIDTH;

export function ReaderLayout({
  activeTab,
  onTabChange,
  collapsed,
  onCollapsedChange,
  reader,
  chat,
  notes,
}: {
  activeTab: ReaderTab;
  onTabChange: (tab: ReaderTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  reader: ReactNode;
  chat: ReactNode;
  notes: ReactNode;
}) {
  const pick = useLocalePick();
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [containerWidth, setContainerWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(390);
  const [notesOpened, setNotesOpened] = useState(activeTab === "notes");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const split = containerWidth >= MIN_SPLIT_WIDTH;
  const maxWidth = Math.min(MAX_PANEL_WIDTH, containerWidth - MIN_READER_WIDTH - HANDLE_WIDTH);
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, preferredWidth));
  const panelTab = activeTab === "source" && split ? "chat" : activeTab;
  const panelHidden = split ? collapsed : activeTab === "source";
  const panelOptions = [
    { value: "chat", label: pick("Sohbet", "Chat") },
    { value: "notes", label: pick("Notlar", "Notes") },
  ] satisfies { value: ReaderTab; label: string }[];
  const panelToggleLabel = collapsed
    ? pick("Yan paneli aç", "Expand side panel")
    : pick("Yan paneli daralt", "Collapse side panel");

  function changeTab(tab: ReaderTab) {
    if (tab === "notes") setNotesOpened(true);
    onTabChange(tab);
  }

  return (
    <div ref={container} className="flex h-full min-h-0 min-w-0 flex-col">
      {!split && (
        <div className="shrink-0 border-b border-rule bg-paper px-3 py-2">
          <SegmentedControl<ReaderTab>
            size="sm"
            value={activeTab}
            onChange={changeTab}
            options={[{ value: "source", label: pick("Kaynak", "Source") }, ...panelOptions]}
            ariaLabel={pick("Okuyucu görünümü", "Reader view")}
            className="w-full"
          />
        </div>
      )}
      <div
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
        style={{ gridTemplateColumns: split ? `minmax(0,1fr) ${collapsed ? 0 : HANDLE_WIDTH}px ${collapsed ? 48 : width}px` : "minmax(0,1fr)" }}
      >
        <div className={cn("min-h-0 min-w-0 flex-col", split || activeTab === "source" ? "flex" : "hidden")}>
          {reader}
        </div>
        {split && !collapsed && (
          <PaneResizer
            side="left"
            width={width}
            min={MIN_PANEL_WIDTH}
            max={maxWidth}
            label={pick("Yan panel genişliğini ayarla", "Resize side panel")}
            controls={panelId}
            onResize={setPreferredWidth}
            onCommit={setPreferredWidth}
            className="relative block bg-paper [&>span]:bg-rule"
          />
        )}
        <div className={cn("relative min-h-0 min-w-0 flex-col bg-paper", split || !panelHidden ? "flex" : "hidden", split && "col-start-3 border-l border-rule")}>
          {split && (
            <div className={cn("flex shrink-0 items-center justify-between gap-2 border-b border-rule p-2", collapsed && "justify-center border-b-0")}>
              {!collapsed && (
                <SegmentedControl
                  size="sm"
                  value={panelTab}
                  onChange={changeTab}
                  options={panelOptions}
                  ariaLabel={pick("Yan panel görünümü", "Side panel view")}
                />
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={panelToggleLabel}
                title={panelToggleLabel}
                aria-controls={panelId}
                aria-expanded={!collapsed}
                onClick={() => onCollapsedChange(!collapsed)}
              >
                {collapsed ? <ChevronsLeft className="size-4" aria-hidden /> : <ChevronsRight className="size-4" aria-hidden />}
              </Button>
            </div>
          )}
          <div id={panelId} className={cn("min-h-0 min-w-0 flex-1", panelHidden && "hidden")}>
            <div className={cn("h-full min-h-0", panelTab !== "chat" && "hidden")}>{chat}</div>
            {(notesOpened || panelTab === "notes") && (
              <div className={cn("h-full min-h-0", panelTab !== "notes" && "hidden")}>{notes}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
