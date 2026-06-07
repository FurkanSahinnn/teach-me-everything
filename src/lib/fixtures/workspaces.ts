export type Workspace = {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  initials: string;
  sourceCount: number;
  highlightCount: number;
  flashcardCount: number;
  progress: number;
  lastUpdated: string;
  lastUpdatedEn: string;
  goal?: string;
  goalEn?: string;
};

export const WORKSPACES: Workspace[] = [
  {
    id: "qft",
    name: "Kuantum Alan Teorisi",
    nameEn: "Quantum Field Theory",
    color: "#B8601C",
    initials: "Q",
    sourceCount: 14,
    highlightCount: 218,
    flashcardCount: 184,
    progress: 62,
    lastUpdated: "Dün güncellendi",
    lastUpdatedEn: "Updated yesterday",
    goal: "Renormalizasyon grubuna hakimiyet",
    goalEn: "Mastery of the renormalization group",
  },
  {
    id: "bio",
    name: "Moleküler Biyoloji",
    nameEn: "Molecular Biology",
    color: "#4E5E3E",
    initials: "M",
    sourceCount: 9,
    highlightCount: 132,
    flashcardCount: 97,
    progress: 41,
    lastUpdated: "2 gün önce",
    lastUpdatedEn: "2 days ago",
    goal: "CRISPR-Cas9 mekanizması sınavına hazırlık",
    goalEn: "Prep for CRISPR-Cas9 exam",
  },
  {
    id: "phil",
    name: "Fenomenoloji",
    nameEn: "Phenomenology",
    color: "#6B3A5E",
    initials: "F",
    sourceCount: 6,
    highlightCount: 74,
    flashcardCount: 38,
    progress: 24,
    lastUpdated: "4 gün önce",
    lastUpdatedEn: "4 days ago",
    goal: "Husserl'in Cartesian Meditations'ı",
    goalEn: "Husserl's Cartesian Meditations",
  },
  {
    id: "ml",
    name: "Derin Öğrenme Tezi",
    nameEn: "Deep Learning Thesis",
    color: "#3C4A58",
    initials: "D",
    sourceCount: 22,
    highlightCount: 361,
    flashcardCount: 204,
    progress: 78,
    lastUpdated: "Bugün",
    lastUpdatedEn: "Today",
    goal: "Tez savunması için literatür taraması",
    goalEn: "Literature review for thesis defense",
  },
];

export function getWorkspace(id: string): Workspace | undefined {
  return WORKSPACES.find((w) => w.id === id);
}
