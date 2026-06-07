export type WorkspaceColor = {
  id: string;
  hex: string;
  nameTr: string;
  nameEn: string;
};

export const WORKSPACE_COLORS: WorkspaceColor[] = [
  { id: "amber", hex: "#B86E00", nameTr: "Kehribar", nameEn: "Amber" },
  { id: "plum", hex: "#6E3A7B", nameTr: "Erik", nameEn: "Plum" },
  { id: "teal", hex: "#0F6E68", nameTr: "Çam", nameEn: "Teal" },
  { id: "slate", hex: "#3D4756", nameTr: "Çelik", nameEn: "Slate" },
  { id: "rose", hex: "#A8294F", nameTr: "Gül", nameEn: "Rose" },
  { id: "sage", hex: "#4F6B3D", nameTr: "Adaçayı", nameEn: "Sage" },
  { id: "indigo", hex: "#3946A8", nameTr: "Çivit", nameEn: "Indigo" },
  { id: "sand", hex: "#876B3C", nameTr: "Kum", nameEn: "Sand" },
];

export function deriveInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}
