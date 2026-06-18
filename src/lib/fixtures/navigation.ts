import type { LucideIcon } from "lucide-react";
import {
  GitFork,
  Headphones,
  Home,
  LayoutGrid,
  MessagesSquare,
  Network,
  Notebook,
  NotebookPen,
  Radar,
  Route,
  SquareStack,
} from "lucide-react";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  workspaceScoped?: boolean;
};

export const PRIMARY_NAV: NavItem[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    label: "Kontrol paneli",
    labelEn: "Dashboard",
    icon: Home,
  },
];

export const WORKSPACE_NAV: NavItem[] = [
  {
    key: "workspace",
    href: "/w/{id}",
    label: "Özet",
    labelEn: "Overview",
    icon: LayoutGrid,
    workspaceScoped: true,
  },
  {
    key: "chat",
    href: "/w/{id}/chat",
    label: "Sohbet",
    labelEn: "Chat",
    icon: MessagesSquare,
    workspaceScoped: true,
  },
  {
    key: "notes",
    href: "/w/{id}/notes",
    label: "Notlar",
    labelEn: "Notes",
    icon: NotebookPen,
    workspaceScoped: true,
  },
  {
    key: "flash",
    href: "/w/{id}/cards",
    label: "Kartlar",
    labelEn: "Flashcards",
    icon: SquareStack,
    workspaceScoped: true,
  },
  {
    key: "quiz",
    href: "/w/{id}/quiz",
    label: "Quiz",
    labelEn: "Quiz",
    icon: Notebook,
    workspaceScoped: true,
  },
  {
    key: "mindmap",
    href: "/w/{id}/map",
    label: "Zihin Haritası",
    labelEn: "Mind Map",
    icon: Network,
    workspaceScoped: true,
  },
  {
    key: "audio",
    href: "/w/{id}/audio",
    label: "Ses Özeti",
    labelEn: "Audio Overview",
    icon: Headphones,
    workspaceScoped: true,
  },
  {
    key: "research",
    href: "/w/{id}/research",
    label: "Araştırma",
    labelEn: "Research",
    icon: Radar,
    workspaceScoped: true,
  },
  {
    key: "roadmap",
    href: "/w/{id}/roadmap",
    label: "Roadmap",
    labelEn: "Roadmap",
    icon: Route,
    workspaceScoped: true,
  },
];

export const FOOTER_NAV: NavItem[] = [
  {
    key: "settings",
    href: "/settings",
    label: "Ayarlar",
    labelEn: "Settings",
    icon: GitFork,
  },
];

export function resolveHref(item: NavItem, workspaceId?: string): string {
  if (item.workspaceScoped && workspaceId) {
    return item.href.replace("{id}", workspaceId);
  }
  return item.href;
}
