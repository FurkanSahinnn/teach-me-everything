"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/Kbd";
import { Modal } from "@/components/ui/Modal";
import { useLocalePick } from "@/i18n/IntlProvider";

type ShortcutEntry = {
  id: string;
  labelKey: string;
  keys: ReactNode[];
};

type ShortcutGroup = {
  id: string;
  titleKey: string;
  entries: ShortcutEntry[];
};

type ShortcutsHelpModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Cross-platform mod key. We don't try to detect at runtime — the symbol is
// recognised by both Mac and Windows users, and showing both would clutter
// the table. The reader/cards/map shortcuts in the codebase already wire
// `e.metaKey || e.ctrlKey`, so the legend matches actual behaviour.
const MOD = "⌘";

const GROUPS: ShortcutGroup[] = [
  {
    id: "general",
    titleKey: "group_general",
    entries: [
      {
        id: "palette",
        labelKey: "action_palette",
        keys: [<Kbd key="mod">{MOD}</Kbd>, <Kbd key="k">K</Kbd>],
      },
      { id: "help", labelKey: "action_help", keys: [<Kbd key="qm">?</Kbd>] },
      {
        id: "escape",
        labelKey: "action_escape",
        keys: [<Kbd key="esc">Esc</Kbd>],
      },
    ],
  },
  {
    id: "reader",
    titleKey: "group_reader",
    entries: [
      {
        id: "send_message",
        labelKey: "action_send_message",
        keys: [<Kbd key="mod">{MOD}</Kbd>, <Kbd key="enter">Enter</Kbd>],
      },
      {
        id: "stop_chat",
        labelKey: "action_stop_chat",
        keys: [<Kbd key="esc">Esc</Kbd>],
      },
    ],
  },
  {
    id: "cards",
    titleKey: "group_cards",
    entries: [
      {
        id: "rating_again",
        labelKey: "action_rating_again",
        keys: [<Kbd key="1">1</Kbd>],
      },
      {
        id: "rating_hard",
        labelKey: "action_rating_hard",
        keys: [<Kbd key="2">2</Kbd>],
      },
      {
        id: "rating_good",
        labelKey: "action_rating_good",
        keys: [<Kbd key="3">3</Kbd>],
      },
      {
        id: "rating_easy",
        labelKey: "action_rating_easy",
        keys: [<Kbd key="4">4</Kbd>],
      },
      {
        id: "flip_card",
        labelKey: "action_flip_card",
        keys: [<Kbd key="space">Space</Kbd>],
      },
      {
        id: "edit_card",
        labelKey: "action_edit_card",
        keys: [<Kbd key="e">E</Kbd>],
      },
    ],
  },
  {
    id: "map",
    titleKey: "group_map",
    entries: [
      { id: "pan", labelKey: "action_pan", keys: [] },
      { id: "zoom", labelKey: "action_zoom", keys: [] },
    ],
  },
];

export function ShortcutsHelpModal({
  open,
  onOpenChange,
}: ShortcutsHelpModalProps) {
  const t = useTranslations("shortcuts");
  const pick = useLocalePick();

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("modal_title")}
      size="lg"
      closeLabel={pick("Kapat", "Close")}
    >
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group.id}>
            <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {t(group.titleKey)}
            </h3>
            <ul className="mt-2 divide-y divide-rule-soft">
              {group.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 py-2 text-[13.5px] text-ink-2"
                >
                  <span>{t(entry.labelKey)}</span>
                  <span className="flex items-center gap-1">
                    {entry.keys.length > 0 ? (
                      entry.keys
                    ) : (
                      <span className="font-mono text-[11px] text-ink-4">
                        {pick("Fare", "Mouse")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
