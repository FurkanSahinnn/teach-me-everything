export type Deck = {
  id: string;
  workspaceId: string;
  name: string;
  nameEn: string;
  color: string;
  dueCount: number;
  newCount: number;
  totalCount: number;
};

export type Flashcard = {
  id: string;
  deckId: string;
  question: string;
  questionEn: string;
  answer: string;
  answerEn: string;
  citations: { section: string; source: string }[];
  chips: { tr: string; en: string }[];
  createdAt: string;
  createdAtEn: string;
  reviewCount: number;
  successRate: number;
  lastReview: string;
  lastReviewEn: string;
  lastRating: "again" | "hard" | "good" | "easy";
};

export type SessionStats = {
  total: number;
  completed: number;
  recallRate: number;
  estimatedMinutes: number;
  distribution: {
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
};

const DECKS: Deck[] = [
  {
    id: "qft-wilson",
    workspaceId: "qft",
    name: "Wilsonian RG destesi",
    nameEn: "Wilsonian RG deck",
    color: "#B8601C",
    dueCount: 28,
    newCount: 6,
    totalCount: 184,
  },
  {
    id: "qft-ferm",
    workspaceId: "qft",
    name: "Fermion alanları",
    nameEn: "Fermion fields",
    color: "#7F3D10",
    dueCount: 9,
    newCount: 3,
    totalCount: 62,
  },
  {
    id: "bio-crispr",
    workspaceId: "bio",
    name: "CRISPR mekanizmaları",
    nameEn: "CRISPR mechanisms",
    color: "#4E5E3E",
    dueCount: 14,
    newCount: 8,
    totalCount: 97,
  },
  {
    id: "phil-husserl",
    workspaceId: "phil",
    name: "Husserl — Cartesian",
    nameEn: "Husserl — Cartesian",
    color: "#6B3A5E",
    dueCount: 7,
    newCount: 2,
    totalCount: 38,
  },
  {
    id: "ml-transformer",
    workspaceId: "ml",
    name: "Transformer içgörüleri",
    nameEn: "Transformer insights",
    color: "#3C4A58",
    dueCount: 21,
    newCount: 12,
    totalCount: 204,
  },
];

const QFT_WILSON_CARDS: Flashcard[] = [
  {
    id: "c1",
    deckId: "qft-wilson",
    question:
      "Wilson'ın RG akışında relevant operatörler, ölçek boyutları açısından hangi koşulu sağlar ve düşük enerjide davranışları nedir?",
    questionEn:
      "In Wilson's RG flow, what condition do relevant operators satisfy in terms of scaling dimensions, and what is their low-energy behaviour?",
    answer:
      "Relevant operatörlerin ölçek boyutu d_O < d; IR'ye (düşük enerjiye) doğru akışta büyürler ve fiziksel davranışı belirleyen sonlu bir kümeye işaret ederler. Marginal'ler logaritmik akar, irrelevant'lar üstel sönümlenir.",
    answerEn:
      "Relevant operators have scaling dimension d_O < d; they grow under the flow towards the IR and pick out a finite set of couplings that determine the physical behaviour. Marginal ones flow logarithmically, irrelevant ones decay exponentially.",
    citations: [
      { section: "§12.5", source: "Peskin & Schroeder" },
      { section: "1993", source: "Wetterich" },
    ],
    chips: [
      { tr: "Peskin §12.2", en: "Peskin §12.2" },
      { tr: "Zorluk: orta", en: "Difficulty: medium" },
    ],
    createdAt: "12 Nis · 4 tekrar · başarı %75",
    createdAtEn: "Apr 12 · 4 reviews · 75% success",
    reviewCount: 4,
    successRate: 0.75,
    lastReview: "3 gün önce · İyi",
    lastReviewEn: "3 days ago · Good",
    lastRating: "good",
  },
  {
    id: "c2",
    deckId: "qft-wilson",
    question:
      "β-fonksiyonu sabit bir noktada sıfır olduğunda, katsayıların spektrumunu belirleyen nedir?",
    questionEn:
      "When the β-function vanishes at a fixed point, what determines the spectrum of the couplings?",
    answer:
      "Sabit nokta çevresinde lineerleştirilmiş akışın matrisinin özdeğerleri. Negatif özdeğer → relevant (IR'de büyür), pozitif → irrelevant (sönümlenir), sıfır → marjinal (logaritmik).",
    answerEn:
      "The eigenvalues of the linearised flow matrix around the fixed point. Negative eigenvalue → relevant (grows in the IR), positive → irrelevant (decays), zero → marginal (logarithmic).",
    citations: [{ section: "§12.2.1", source: "Peskin & Schroeder" }],
    chips: [
      { tr: "Peskin §12.2", en: "Peskin §12.2" },
      { tr: "Zorluk: zor", en: "Difficulty: hard" },
    ],
    createdAt: "10 Nis · 6 tekrar · başarı %62",
    createdAtEn: "Apr 10 · 6 reviews · 62% success",
    reviewCount: 6,
    successRate: 0.62,
    lastReview: "5 gün önce · Zor",
    lastReviewEn: "5 days ago · Hard",
    lastRating: "hard",
  },
  {
    id: "c3",
    deckId: "qft-wilson",
    question:
      "Etkin Lagranjiyen kavramı neden kesim ölçeği Λ'ya bağlıdır, fakat fiziksel gözlemler neden bağımsızdır?",
    questionEn:
      "Why does the effective Lagrangian depend on the cutoff Λ, yet physical observables do not?",
    answer:
      "Katsayılar Λ'ya göre kayar (running couplings), ama akış denklemi tarafından birbirine bağlıdırlar. Fiziksel büyüklükler bu akışın invariantlarıdır — Λ'dan bağımsız kalırlar.",
    answerEn:
      "The couplings shift with Λ (running couplings), but are tied together by the flow equation. Physical quantities are invariants of this flow — they remain independent of Λ.",
    citations: [
      { section: "§12.2", source: "Peskin & Schroeder" },
      { section: "Vol. 1 §12.4", source: "Weinberg" },
    ],
    chips: [
      { tr: "Peskin §12.2", en: "Peskin §12.2" },
      { tr: "Zorluk: kolay", en: "Difficulty: easy" },
    ],
    createdAt: "7 Nis · 8 tekrar · başarı %88",
    createdAtEn: "Apr 7 · 8 reviews · 88% success",
    reviewCount: 8,
    successRate: 0.88,
    lastReview: "2 gün önce · Kolay",
    lastReviewEn: "2 days ago · Easy",
    lastRating: "easy",
  },
];

const PLACEHOLDER_CARD = (deckId: string, i: number): Flashcard => ({
  id: `${deckId}-p${i}`,
  deckId,
  question: `Bu destedeki ${i + 1}. kartın sorusu — Phase 2'de gerçek kartlar parse edilecek.`,
  questionEn: `Sample question ${i + 1} from this deck — real cards will be parsed in Phase 2.`,
  answer:
    "Bu placeholder cevap. Gerçek cevap AI tarafından notebook sohbetinden üretilecek.",
  answerEn:
    "This is a placeholder answer. Real answers will be generated by AI from notebook chat.",
  citations: [{ section: "§1.1", source: "Placeholder" }],
  chips: [
    { tr: "Örnek", en: "Sample" },
    { tr: "Zorluk: orta", en: "Difficulty: medium" },
  ],
  createdAt: "— · — · —",
  createdAtEn: "— · — · —",
  reviewCount: 0,
  successRate: 0,
  lastReview: "—",
  lastReviewEn: "—",
  lastRating: "good",
});

const CARDS_BY_DECK: Record<string, Flashcard[]> = {
  "qft-wilson": [
    ...QFT_WILSON_CARDS,
    ...Array.from({ length: 25 }, (_, i) => PLACEHOLDER_CARD("qft-wilson", i)),
  ],
  "qft-ferm": Array.from({ length: 9 }, (_, i) =>
    PLACEHOLDER_CARD("qft-ferm", i),
  ),
  "bio-crispr": Array.from({ length: 14 }, (_, i) =>
    PLACEHOLDER_CARD("bio-crispr", i),
  ),
  "phil-husserl": Array.from({ length: 7 }, (_, i) =>
    PLACEHOLDER_CARD("phil-husserl", i),
  ),
  "ml-transformer": Array.from({ length: 21 }, (_, i) =>
    PLACEHOLDER_CARD("ml-transformer", i),
  ),
};

export function getDecksForWorkspace(workspaceId: string): Deck[] {
  return DECKS.filter((d) => d.workspaceId === workspaceId);
}

export function getActiveDeck(workspaceId: string): Deck | undefined {
  return DECKS.find((d) => d.workspaceId === workspaceId);
}

export function getCardsForDeck(deckId: string): Flashcard[] {
  return CARDS_BY_DECK[deckId] ?? [];
}

export const DEFAULT_SESSION_STATS: SessionStats = {
  total: 28,
  completed: 12,
  recallRate: 0.72,
  estimatedMinutes: 7,
  distribution: { again: 3, hard: 4, good: 14, easy: 7 },
};

export type RatingKey = "again" | "hard" | "good" | "easy";

export const RATING_INTERVALS: Record<
  RatingKey,
  { tr: string; en: string; shortcut: string; color: string }
> = {
  again: { tr: "< 10 dk", en: "< 10 min", shortcut: "1", color: "#B14A4A" },
  hard: { tr: "1 gün", en: "1 day", shortcut: "2", color: "#B8601C" },
  good: { tr: "4 gün", en: "4 days", shortcut: "3", color: "#4E5E3E" },
  easy: { tr: "11 gün", en: "11 days", shortcut: "4", color: "#3C4A58" },
};
