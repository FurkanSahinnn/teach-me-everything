"use client";

import { FileSearch } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePick } from "@/i18n/IntlProvider";

type Props = {
  onCreate?: (() => void) | undefined;
};

export function AnalysisEmptyState({ onCreate }: Props) {
  const pick = useLocalePick();
  return (
    <Card variant="sunken" className="min-h-[260px]">
      <EmptyState
        icon={<FileSearch />}
        title={pick("Henüz analiz yok", "No analyses yet")}
        description={pick(
          "Bir makale seç; AI kaynak bağlantılı, okunabilir bir analiz hazırlasın. Sonra bölümleri asistana sorabilir veya düzenletebilirsin.",
          "Pick a paper for a readable, source-linked brief. Then ask the assistant about any section or revise it.",
        )}
        {...(onCreate
          ? {
              action: {
                label: pick("Analiz et", "Analyze"),
                onClick: onCreate,
              },
            }
          : {})}
      />
    </Card>
  );
}
