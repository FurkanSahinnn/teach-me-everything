import { WORKSPACES } from "@/lib/fixtures/workspaces";
import { db } from "./schema";
import type {
  DeckRecord,
  FlashcardRecord,
  SeedFlagRecord,
  SourceRecord,
  WorkspaceRecord,
} from "./types";

const SEED_VERSION = 1;
const SEED_ID = "dev-seed" as const;

type SeedSource = {
  id: string;
  workspaceId: string;
  title: string;
  author?: string;
};

type SeedDeck = {
  id: string;
  workspaceId: string;
  name: string;
  nameEn?: string;
  color: string;
};

type SeedFlashcard = {
  id: string;
  workspaceId: string;
  deckId: string;
  question: string;
  questionEn?: string;
  answer: string;
  answerEn?: string;
  tags?: string[];
};

const SEED_SOURCES: SeedSource[] = [
  { id: "qft-s1", workspaceId: "qft", title: "An Introduction to Quantum Field Theory", author: "Peskin & Schroeder" },
  { id: "qft-s2", workspaceId: "qft", title: "The Quantum Theory of Fields, Vol. 1", author: "Weinberg" },
  { id: "qft-s3", workspaceId: "qft", title: "arXiv:2112.03929 — Wilsonian RG, a primer", author: "Polonyi" },
  { id: "qft-s4", workspaceId: "qft", title: "Ders notları: §4 Renormalizasyon akışı" },
  { id: "bio-s1", workspaceId: "bio", title: "Molecular Biology of the Cell, 7e", author: "Alberts et al." },
  { id: "bio-s2", workspaceId: "bio", title: "CRISPR-Cas9: biology and applications", author: "Doudna & Charpentier" },
  { id: "bio-s3", workspaceId: "bio", title: "Lehninger Principles of Biochemistry", author: "Nelson & Cox" },
  { id: "phil-s1", workspaceId: "phil", title: "Cartesian Meditations", author: "Husserl" },
  { id: "phil-s2", workspaceId: "phil", title: "Being and Time", author: "Heidegger" },
  { id: "ml-s1", workspaceId: "ml", title: "Attention Is All You Need", author: "Vaswani et al." },
  { id: "ml-s2", workspaceId: "ml", title: "Deep Learning", author: "Goodfellow, Bengio, Courville" },
  { id: "ml-s3", workspaceId: "ml", title: "arXiv:2403.09137 — Efficient transformer training", author: "Chen et al." },
];

const SEED_DECKS: SeedDeck[] = [
  { id: "qft-wilson", workspaceId: "qft", name: "Wilsonian RG destesi", nameEn: "Wilsonian RG deck", color: "#B8601C" },
  { id: "qft-ferm", workspaceId: "qft", name: "Fermion alanları", nameEn: "Fermion fields", color: "#7F3D10" },
  { id: "bio-crispr", workspaceId: "bio", name: "CRISPR mekanizmaları", nameEn: "CRISPR mechanisms", color: "#4E5E3E" },
  { id: "phil-husserl", workspaceId: "phil", name: "Husserl — Cartesian", nameEn: "Husserl — Cartesian", color: "#6B3A5E" },
  { id: "ml-transformer", workspaceId: "ml", name: "Transformer içgörüleri", nameEn: "Transformer insights", color: "#3C4A58" },
];

const SEED_FLASHCARDS: SeedFlashcard[] = [
  {
    id: "qft-wilson-c1",
    workspaceId: "qft",
    deckId: "qft-wilson",
    question:
      "Wilson'ın RG akışında relevant operatörler, ölçek boyutları açısından hangi koşulu sağlar ve düşük enerjide davranışları nedir?",
    questionEn:
      "In Wilson's RG flow, what condition do relevant operators satisfy in terms of scaling dimensions, and what is their low-energy behaviour?",
    answer:
      "Relevant operatörlerin ölçek boyutu d_O < d; IR'ye doğru akışta büyürler ve fiziksel davranışı belirleyen sonlu bir kümeye işaret ederler.",
    answerEn:
      "Relevant operators have scaling dimension d_O < d; they grow under the flow towards the IR and pick out a finite set of couplings.",
    tags: ["peskin", "rg"],
  },
  {
    id: "qft-wilson-c2",
    workspaceId: "qft",
    deckId: "qft-wilson",
    question: "β-fonksiyonu sabit bir noktada sıfır olduğunda, katsayıların spektrumunu belirleyen nedir?",
    questionEn: "When the β-function vanishes at a fixed point, what determines the spectrum of the couplings?",
    answer: "Sabit nokta çevresinde lineerleştirilmiş akışın matrisinin özdeğerleri.",
    answerEn: "The eigenvalues of the linearised flow matrix around the fixed point.",
    tags: ["peskin", "rg"],
  },
  {
    id: "qft-wilson-c3",
    workspaceId: "qft",
    deckId: "qft-wilson",
    question: "Etkin Lagranjiyen kavramı neden kesim ölçeği Λ'ya bağlıdır, fakat fiziksel gözlemler neden bağımsızdır?",
    questionEn: "Why does the effective Lagrangian depend on the cutoff Λ, yet physical observables do not?",
    answer:
      "Katsayılar Λ'ya göre kayar ama akış denklemi tarafından birbirine bağlıdırlar. Fiziksel büyüklükler bu akışın invariantlarıdır.",
    answerEn:
      "The couplings shift with Λ but are tied together by the flow equation. Physical quantities are invariants of this flow.",
    tags: ["peskin", "rg"],
  },
];

export async function isDevSeeded(): Promise<boolean> {
  const flag = await db.seedFlags.get(SEED_ID);
  return flag?.version === SEED_VERSION;
}

export async function seedDevData(
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force && (await isDevSeeded())) return;

  const now = Date.now();

  await db.transaction(
    "rw",
    [db.workspaces, db.sources, db.decks, db.flashcards, db.seedFlags],
    async () => {
      const workspaceRecords: WorkspaceRecord[] = WORKSPACES.map((w) => ({
        id: w.id,
        name: w.name,
        nameEn: w.nameEn,
        color: w.color,
        initials: w.initials,
        goal: w.goal,
        goalEn: w.goalEn,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      }));
      await db.workspaces.bulkPut(workspaceRecords);

      const sourceRecords: SourceRecord[] = SEED_SOURCES.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        type: "pdf",
        title: s.title,
        author: s.author,
        ingestStatus: "pending",
        createdAt: now,
        updatedAt: now,
      }));
      await db.sources.bulkPut(sourceRecords);

      const deckRecords: DeckRecord[] = SEED_DECKS.map((d) => ({
        id: d.id,
        workspaceId: d.workspaceId,
        name: d.name,
        nameEn: d.nameEn,
        color: d.color,
        createdAt: now,
        updatedAt: now,
      }));
      await db.decks.bulkPut(deckRecords);

      const flashcardRecords: FlashcardRecord[] = SEED_FLASHCARDS.map((c) => ({
        id: c.id,
        workspaceId: c.workspaceId,
        deckId: c.deckId,
        question: c.question,
        questionEn: c.questionEn,
        answer: c.answer,
        answerEn: c.answerEn,
        tags: c.tags ?? [],
        ease: 2.5,
        interval: 0,
        repetitions: 0,
        dueAt: now,
        lastReviewedAt: null,
        lastRating: null,
        reviewCount: 0,
        successCount: 0,
        againCount: 0,
        leech: false,
        createdAt: now,
        updatedAt: now,
      }));
      await db.flashcards.bulkPut(flashcardRecords);

      const flag: SeedFlagRecord = {
        id: SEED_ID,
        appliedAt: now,
        version: SEED_VERSION,
      };
      await db.seedFlags.put(flag);
    },
  );
}

export async function clearAllAppData(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.sources,
      db.chunks,
      db.highlights,
      db.decks,
      db.flashcards,
      db.reviewLogs,
      db.chatThreads,
      db.chatMessages,
      db.seedFlags,
    ],
    async () => {
      await db.chatMessages.clear();
      await db.chatThreads.clear();
      await db.reviewLogs.clear();
      await db.flashcards.clear();
      await db.decks.clear();
      await db.highlights.clear();
      await db.chunks.clear();
      await db.sources.clear();
      await db.workspaces.clear();
      await db.seedFlags.clear();
    },
  );
}
