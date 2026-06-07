"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useChunksByIds } from "@/lib/db/hooks";
import type {
  ConceptEdgeKind,
  ConceptEdgeRecord,
  ConceptKind,
  ConceptRecord,
} from "@/lib/concepts/types";
import {
  groupNeighborsByKind,
  type LayoutLink,
} from "@/lib/concepts/layout";
import { cn } from "@/lib/utils/cn";

const KIND_LABEL_TR: Record<ConceptKind, string> = {
  concept: "Kavram",
  term: "Terim",
  person: "Kişi",
  place: "Yer",
  method: "Yöntem",
  event: "Olay",
  work: "Eser",
};
const KIND_LABEL_EN: Record<ConceptKind, string> = {
  concept: "Concept",
  term: "Term",
  person: "Person",
  place: "Place",
  method: "Method",
  event: "Event",
  work: "Work",
};

const EDGE_LABEL_TR: Record<ConceptEdgeKind, string> = {
  "is-a": "Türüdür",
  "part-of": "Parçası",
  related: "İlişkili",
  "depends-on": "Bağımlı",
};
const EDGE_LABEL_EN: Record<ConceptEdgeKind, string> = {
  "is-a": "Is-a",
  "part-of": "Part of",
  related: "Related",
  "depends-on": "Depends on",
};

export type InspectorRow = {
  kind: ConceptEdgeKind;
  neighbors: { id: string; label: string }[];
};

/**
 * Pure helper — given a selected concept id and the full graph, return the
 * neighbour rows the inspector renders. Tests pin this without rendering.
 */
export function inspectorRows(
  selectedId: string,
  concepts: ConceptRecord[],
  edges: ConceptEdgeRecord[],
): InspectorRow[] {
  const labelById = new Map(concepts.map((c) => [c.id, c.label]));
  const links: LayoutLink[] = edges.map((e) => ({
    source: e.fromId,
    target: e.toId,
    kind: e.kind,
  }));
  const grouped = groupNeighborsByKind(selectedId, links);
  const out: InspectorRow[] = [];
  for (const [kind, neighborIds] of grouped) {
    out.push({
      kind,
      neighbors: neighborIds.map((id) => ({
        id,
        label: labelById.get(id) ?? id,
      })),
    });
  }
  return out;
}

type Props = {
  concept: ConceptRecord | null;
  concepts: ConceptRecord[];
  edges: ConceptEdgeRecord[];
  onSelect: (id: string | null) => void;
  onClose?: () => void;
};

export function ConceptInspector({
  concept,
  concepts,
  edges,
  onSelect,
  onClose,
}: Props) {
  const pick = useLocalePick();
  // Hooks must run unconditionally — pass an empty list when no concept is
  // selected so React keeps the same hook order across renders.
  const chunkRefs = concept?.chunkRefs ?? [];
  const chunks = useChunksByIds(chunkRefs);

  if (!concept) {
    return (
      <div className="grid h-full place-items-center p-6 text-[12.5px] text-ink-3">
        {pick(
          "Bir konsept seç (haritadan tıkla).",
          "Pick a concept (click one on the map).",
        )}
      </div>
    );
  }

  const rows = inspectorRows(concept.id, concepts, edges);
  const kindLabel = pick(
    KIND_LABEL_TR[concept.kind],
    KIND_LABEL_EN[concept.kind],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-rule-soft px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {kindLabel}
          </div>
          <h3 className="mt-1 font-serif text-[18px] font-normal leading-tight">
            {concept.label}
          </h3>
        </div>
        {onClose ? (
          <Button size="sm" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {concept.definition ? (
          <p className="text-[13.5px] leading-[1.6] text-ink-2">
            {concept.definition}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <section className="space-y-3">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("İlişkiler", "Relations")}
            </div>
            {rows.map((row) => (
              <div key={row.kind}>
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-4">
                  {pick(EDGE_LABEL_TR[row.kind], EDGE_LABEL_EN[row.kind])}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.neighbors.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => onSelect(n.id)}
                      className={cn(
                        "rounded-md border border-rule bg-paper-2 px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink-5 hover:bg-paper",
                      )}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {chunkRefs.length > 0 ? (
          <section className="space-y-2">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Kaynak alıntıları", "Source quotes")}
            </div>
            {chunks && chunks.length > 0 ? (
              <div className="space-y-2">
                {chunks.slice(0, 5).map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-rule-soft bg-paper-2 px-3 py-2"
                  >
                    {c.section ? (
                      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                        {c.section}
                      </div>
                    ) : null}
                    <p className="mt-1 line-clamp-3 text-[12.5px] leading-[1.5] text-ink-2">
                      {c.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-ink-4">
                {pick(
                  "Geçtiği chunk'lar bu kaynakta bulunamadı (yeniden çıkar?).",
                  "Cited chunks not found in this source (re-extract?).",
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
