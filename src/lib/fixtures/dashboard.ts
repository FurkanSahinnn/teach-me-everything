import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Highlighter,
  MessageSquare,
  Mic,
  Radar,
  SquareStack,
} from "lucide-react";

export type ActivityItem = {
  id: string;
  icon: LucideIcon;
  title: string;
  titleEn: string;
  meta: string;
  metaEn: string;
};

export const ACTIVITY: ActivityItem[] = [
  {
    id: "a1",
    icon: Highlighter,
    title: "Peskin & Schroeder'den 6 yeni vurgu aldın",
    titleEn: "6 new highlights from Peskin & Schroeder",
    meta: "Kuantum Alan Teorisi · 14 dk önce",
    metaEn: "Quantum Field Theory · 14m ago",
  },
  {
    id: "a2",
    icon: SquareStack,
    title: "14 flashcard otomatik oluşturuldu",
    titleEn: "14 flashcards auto-generated",
    meta: "Derin Öğrenme Tezi · 37 dk önce",
    metaEn: "Deep Learning Thesis · 37m ago",
  },
  {
    id: "a3",
    icon: MessageSquare,
    title: "Claude ile LSM formülü üzerine sohbet",
    titleEn: "Chat with Claude on LSM reduction formula",
    meta: "Kuantum Alan Teorisi · 1 saat önce",
    metaEn: "Quantum Field Theory · 1h ago",
  },
  {
    id: "a4",
    icon: BookOpen,
    title: "CRISPR-Cas9: enzim yapısı bölümü tamam",
    titleEn: "CRISPR-Cas9: enzyme structure chapter done",
    meta: "Moleküler Biyoloji · 3 saat önce",
    metaEn: "Molecular Biology · 3h ago",
  },
  {
    id: "a5",
    icon: Mic,
    title: "Feynman açıklaması: renormalizasyon grubu",
    titleEn: "Feynman explanation: renormalization group",
    meta: "Kuantum Alan Teorisi · dün",
    metaEn: "Quantum Field Theory · yesterday",
  },
  {
    id: "a6",
    icon: Radar,
    title: "Husserl intentionalite: 4 yeni makale önerildi",
    titleEn: "Husserl intentionality: 4 new papers suggested",
    meta: "Fenomenoloji · dün",
    metaEn: "Phenomenology · yesterday",
  },
];

export type Stats = {
  streak: number;
  repeatCardsDone: number;
  repeatCardsTotal: number;
  weeklyStudyMinutes: number;
  activeWorkspaceCount: number;
};

export const STATS: Stats = {
  streak: 17,
  repeatCardsDone: 4,
  repeatCardsTotal: 28,
  weeklyStudyMinutes: 342,
  activeWorkspaceCount: 4,
};

export type StreakLevel = "none" | "partial" | "full";

// 30 günlük streak (en eski → en yeni)
export const STREAK_30_DAYS: StreakLevel[] = [
  "full", "partial", "full", "full", "partial", "full", "full",
  "partial", "full", "full", "full", "partial", "full", "full",
  "full", "full", "full", "partial", "none", "partial", "full",
  "full", "full", "partial", "full", "full", "partial", "full",
  "full", "full",
];
