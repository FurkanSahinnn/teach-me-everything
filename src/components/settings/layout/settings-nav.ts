import {
  AudioLines,
  Binary,
  Boxes,
  Database,
  Gauge,
  GraduationCap,
  Info,
  Network,
  NotebookPen,
  Palette,
  Plug,
  RefreshCw,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "@/components/icons";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "learning"
  | "providers"
  | "models"
  | "usage"
  | "embedding"
  | "research"
  | "audio"
  | "concepts"
  | "notes"
  | "data"
  | "updates"
  | "about";

export type SettingsGroupId = "app" | "ai" | "knowledge" | "system";

export type SettingsSectionDef = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  href: string;
  icon: LucideIcon;
  /** Extra search terms (TR + EN) beyond the visible label. */
  keywords: readonly string[];
};

/** Group order in the sidebar; `app` renders without a heading. */
export const SETTINGS_GROUPS: readonly SettingsGroupId[] = ["app", "ai", "knowledge", "system"];

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "general", group: "app", href: "/settings", icon: SlidersHorizontal, keywords: ["genel", "general", "dil", "language", "locale", "başlangıç", "startup", "autostart"] },
  { id: "appearance", group: "app", href: "/settings/appearance", icon: Palette, keywords: ["görünüm", "appearance", "tema", "theme", "yoğunluk", "density", "genişlik", "width"] },
  { id: "learning", group: "app", href: "/settings/learning", icon: GraduationCap, keywords: ["öğrenme", "learning", "srs", "kart", "cards", "müfredat", "curriculum"] },
  { id: "providers", group: "ai", href: "/settings/providers", icon: Plug, keywords: ["sağlayıcı", "providers", "anahtar", "api key", "claude", "codex", "opencode", "openai", "anthropic", "gemini", "ollama", "cli", "oauth", "endpoint"] },
  { id: "models", group: "ai", href: "/settings/models", icon: Boxes, keywords: ["model", "modeller", "models", "varsayılan", "default", "binding"] },
  { id: "usage", group: "ai", href: "/settings/usage", icon: Gauge, keywords: ["kullanım", "usage", "limit", "limits", "token", "maliyet", "cost", "bütçe", "budget"] },
  { id: "embedding", group: "ai", href: "/settings/embedding", icon: Binary, keywords: ["embedding", "gömme", "vektör", "vector", "parçalama", "rechunk", "reembed"] },
  { id: "research", group: "ai", href: "/settings/research", icon: Search, keywords: ["araştırma", "research", "arama", "search", "web", "firecrawl", "brave", "exa", "tavily"] },
  { id: "audio", group: "ai", href: "/settings/audio", icon: AudioLines, keywords: ["ses", "audio", "podcast", "tts", "piper", "voice"] },
  { id: "concepts", group: "knowledge", href: "/settings/concepts", icon: Network, keywords: ["kavram", "concepts", "graf", "graph", "zihin haritası", "mind map"] },
  { id: "notes", group: "knowledge", href: "/settings/notes", icon: NotebookPen, keywords: ["not", "notes", "vault", "klasör", "folder", "günlük", "daily", "markdown"] },
  { id: "data", group: "system", href: "/settings/data", icon: Database, keywords: ["veri", "data", "yedek", "backup", "depolama", "storage", "kota", "quota"] },
  { id: "updates", group: "system", href: "/settings/updates", icon: RefreshCw, keywords: ["güncelleme", "updates", "sürüm", "version"] },
  { id: "about", group: "system", href: "/settings/about", icon: Info, keywords: ["hakkında", "about", "lisans", "license"] },
];

const GENERAL = SETTINGS_SECTIONS[0] as SettingsSectionDef;

export function settingsSectionForPath(pathname: string): SettingsSectionDef {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_SECTIONS.find((s) => s.href === normalized) ?? GENERAL;
}

/** Old single-page settings used `#tab` hashes; deep links elsewhere still may. */
const LEGACY_HASH_TO_SECTION: Readonly<Record<string, SettingsSectionId>> = {
  api: "providers",
  models: "models",
  embed: "embedding",
  concepts: "concepts",
  preferences: "general",
  cost: "usage",
  learning: "learning",
  data: "data",
  about: "about",
};

export function resolveLegacySettingsHash(hash: string): string | null {
  const key = hash.replace(/^#/, "").trim();
  if (!key) return null;
  const id = LEGACY_HASH_TO_SECTION[key];
  if (!id) return null;
  return SETTINGS_SECTIONS.find((s) => s.id === id)?.href ?? null;
}

export function filterSettingsSections(
  query: string,
  labelOf: (id: SettingsSectionId) => string,
): SettingsSectionDef[] {
  const needle = query.trim().toLocaleLowerCase("tr");
  if (!needle) return [...SETTINGS_SECTIONS];
  return SETTINGS_SECTIONS.filter((s) =>
    [labelOf(s.id), ...s.keywords].some((term) => term.toLocaleLowerCase("tr").includes(needle)),
  );
}
