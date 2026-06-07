"use client";

import { Network } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePick } from "@/i18n/IntlProvider";

export function RoadmapEmptyState() {
  const pick = useLocalePick();
  return (
    <Card variant="sunken" className="min-h-[260px]">
      <EmptyState
        icon={<Network />}
        title={pick(
          "Henüz roadmap yok",
          "No roadmaps yet",
        )}
        description={pick(
          "Yeni bir roadmap oluştur — AI sana konunun önkoşul grafiğini çıkarır.",
          "Create your first roadmap — AI builds a prerequisite graph of the topic.",
        )}
      />
    </Card>
  );
}
