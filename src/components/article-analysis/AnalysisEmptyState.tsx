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
          "Bir kaynağı seç — AI onu çok aşamalı olarak analiz eder: ne diyor, sorunu nasıl çözüyor, eleştirisi ve çift dilli terim sözlüğü.",
          "Pick a source — AI runs a multi-stage analysis: what it says, how it solves the problem, a critique, and a bilingual glossary.",
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
