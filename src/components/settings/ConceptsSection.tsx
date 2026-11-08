"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useWorkspaces } from "@/lib/db/hooks";
import { listConceptsByWorkspace } from "@/lib/db/concepts";
import { formatRelativeDay } from "@/lib/utils/intl";
import { ExtractConceptsModal } from "./ExtractConceptsModal";

export function ConceptsSection() {
  const pick = useLocalePick();
  const workspaces = useWorkspaces(false);
  const list = workspaces ?? [];
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          title={pick("Konsept grafiği", "Concept graph")}
          description={pick(
            "Workspace başına model bir konsept grafiği üretir; mind map sayfası bu grafiği gezilebilir hale getirir.",
            "The model produces a concept graph per workspace; the mind map page lets you navigate it.",
          )}
        />
        {list.length === 0 ? (
          <SettingsRow title={pick("Henüz workspace yok.", "No workspaces yet.")} />
        ) : (
          list.map((w) => (
            <ConceptsRow
              key={w.id}
              workspaceId={w.id}
              workspaceName={w.name}
              onOpen={() => setOpenWorkspaceId(w.id)}
            />
          ))
        )}
      </SettingsGroup>

      {openWorkspaceId ? (
        <ExtractConceptsModal
          open
          onClose={() => setOpenWorkspaceId(null)}
          workspaceId={openWorkspaceId}
        />
      ) : null}
    </>
  );
}

function ConceptsRow({
  workspaceId,
  workspaceName,
  onOpen,
}: {
  workspaceId: string;
  workspaceName: string;
  onOpen: () => void;
}) {
  const pick = useLocalePick();
  const concepts = useLiveQuery(
    () => listConceptsByWorkspace(workspaceId),
    [workspaceId],
    [],
  );
  const count = concepts?.length ?? 0;
  const latest = concepts?.reduce(
    (max, c) => (c.updatedAt > max ? c.updatedAt : max),
    0,
  );
  return (
    <SettingsRow
      title={workspaceName}
      description={
        <span className="font-mono text-[11px]">
          {count === 0
            ? pick("Henüz konsept çıkarılmadı.", "No concepts yet.")
            : `${count} ${pick("konsept", "concepts")} · ${pick("son", "last")} ${
                latest && latest > 0
                  ? formatRelativeDay(latest, pick("tr", "en"))
                  : "—"
              }`}
        </span>
      }
      control={
        <Button size="sm" onClick={onOpen}>
          {count === 0
            ? pick("Çıkar…", "Extract…")
            : pick("Yeniden çıkar…", "Re-extract…")}
        </Button>
      }
    />
  );
}
