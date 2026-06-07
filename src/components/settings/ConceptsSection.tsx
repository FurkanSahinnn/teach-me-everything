"use client";

import { useState } from "react";
import { Network } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card } from "@/components/ui/Card";
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
    <Card padding="md" id="concepts">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-ink-3" aria-hidden />
            <h3 className="font-serif text-[15px] font-medium">
              {pick("Konsept grafiği", "Concept graph")}
            </h3>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {pick(
              "Workspace başına model bir konsept grafiği üretir; mind map sayfası bu grafiği gezilebilir hale getirir.",
              "The model produces a concept graph per workspace; the mind map page lets you navigate it.",
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {list.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">
            {pick("Henüz workspace yok.", "No workspaces yet.")}
          </p>
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
      </div>

      {openWorkspaceId ? (
        <ExtractConceptsModal
          open
          onClose={() => setOpenWorkspaceId(null)}
          workspaceId={openWorkspaceId}
        />
      ) : null}
    </Card>
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
    <div className="flex items-center justify-between gap-3 rounded-md border border-rule-soft bg-paper-2 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-ink">
          {workspaceName}
        </div>
        <div className="font-mono text-[11px] text-ink-3">
          {count === 0
            ? pick("Henüz konsept çıkarılmadı.", "No concepts yet.")
            : `${count} ${pick("konsept", "concepts")} · ${pick(
                "son",
                "last",
              )} ${
                latest && latest > 0
                  ? formatRelativeDay(latest, pick("tr", "en"))
                  : "—"
              }`}
        </div>
      </div>
      <Button size="sm" onClick={onOpen}>
        {count === 0
          ? pick("Çıkar…", "Extract…")
          : pick("Yeniden çıkar…", "Re-extract…")}
      </Button>
    </div>
  );
}
