export type QuizOption = {
  letter: "A" | "B" | "C" | "D";
  text: string;
  textEn: string;
  isCorrect: boolean;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  promptEn: string;
  topic: string;
  topicEn: string;
  options: QuizOption[];
  explanation: string;
  explanationEn: string;
  citations: string[];
};

export type FeynmanPrompt = {
  id: string;
  topic: string;
  topicEn: string;
  prompt: string;
  promptEn: string;
  hints: { tr: string; en: string }[];
};

const QFT_QUESTIONS: QuizQuestion[] = [
  {
    id: "q1",
    topic: "Wilson-Fisher sabit noktası",
    topicEn: "Wilson-Fisher fixed point",
    prompt: "Wilson-Fisher sabit noktasının fiziksel anlamı nedir?",
    promptEn: "What is the physical meaning of the Wilson-Fisher fixed point?",
    options: [
      {
        letter: "A",
        text: "Ultraviyole sonsuzluklarını eleyen benzersiz noktadır, böylece kuantum teori iyi tanımlı hale gelir.",
        textEn:
          "The unique point that removes UV infinities, making the quantum theory well-defined.",
        isCorrect: false,
      },
      {
        letter: "B",
        text: "Perturbatif hesaplamanın yakınsamayı garantilediği tek nokta olup, tüm yüksek mertebe düzeltmeleri sıfırlar.",
        textEn:
          "The only point where perturbation theory converges, zeroing all higher-order corrections.",
        isCorrect: false,
      },
      {
        letter: "C",
        text: "Aşikâr olmayan bir sabit nokta olarak kritik olguların üstellerini mikroskopik detaylardan bağımsız verir ve evrenselliğin matematiksel kaynağını oluşturur.",
        textEn:
          "As a non-trivial fixed point, it yields critical exponents independent of microscopic detail, providing the mathematical origin of universality.",
        isCorrect: true,
      },
      {
        letter: "D",
        text: "Gauss sabit noktası ile çakışır ve ε → 0 limitinde aşikâr hale gelir.",
        textEn:
          "It coincides with the Gaussian fixed point and becomes trivial in the ε → 0 limit.",
        isCorrect: false,
      },
    ],
    explanation:
      "Wilson-Fisher, ε-açılımında (ε = 4 − d) Gauss noktasından ayrılan aşikâr olmayan bir sabit noktadır. Kritik üsseller bu noktanın lineer spektrumundan okunur ve mikroskopik Lagranjiyenden bağımsızdır — bu evrensellik sınıflarının kaynağıdır.",
    explanationEn:
      "Wilson-Fisher is a non-trivial fixed point that separates from the Gaussian one in the ε-expansion (ε = 4 − d). Critical exponents are read from the linear spectrum at this point and are independent of the microscopic Lagrangian — this is the origin of universality classes.",
    citations: ["Peskin §12.5", "Wilson-Fisher 1972"],
  },
  {
    id: "q2",
    topic: "β-fonksiyonu ve akış",
    topicEn: "β-function and flow",
    prompt:
      "β(g*) = 0 koşulu sabit bir noktanın karakterizasyonudur. g* çevresinde lineerleştirilmiş akışın negatif özdeğerli yönleri hangi operatörleri işaret eder?",
    promptEn:
      "The condition β(g*) = 0 characterises a fixed point. Around g*, which operators do the negative-eigenvalue directions of the linearised flow pick out?",
    options: [
      {
        letter: "A",
        text: "Marjinal operatörler — logaritmik olarak akarlar.",
        textEn: "Marginal operators — they flow logarithmically.",
        isCorrect: false,
      },
      {
        letter: "B",
        text: "İrrelevant operatörler — UV'de anlamlı, IR'de sönümlenirler.",
        textEn: "Irrelevant operators — meaningful in UV, decay in IR.",
        isCorrect: false,
      },
      {
        letter: "C",
        text: "Relevant operatörler — IR'ye akışta büyür, düşük enerji fiziğini belirlerler.",
        textEn:
          "Relevant operators — they grow under the flow to the IR and determine low-energy physics.",
        isCorrect: true,
      },
      {
        letter: "D",
        text: "Hiçbiri — lineer spektrum fiziksel anlam taşımaz.",
        textEn: "None of them — the linear spectrum carries no physical meaning.",
        isCorrect: false,
      },
    ],
    explanation:
      "Lineerleştirilmiş akış matrisinde negatif özdeğerli yönler, akışın ölçek t arttıkça (IR yönü) büyüyen bileşenlere karşılık gelir. Bunlar relevant operatörlerdir ve düşük enerjide teorinin davranışını belirleyen sonlu bir küme oluşturur.",
    explanationEn:
      "Negative-eigenvalue directions of the linearised flow matrix correspond to components that grow as the scale t increases (towards the IR). These are the relevant operators, forming a finite set that determines the theory's low-energy behaviour.",
    citations: ["Peskin §12.2", "Weinberg Vol. 1 §12.4"],
  },
  {
    id: "q3",
    topic: "Etkin Lagranjiyen",
    topicEn: "Effective Lagrangian",
    prompt:
      "Etkin Lagranjiyen yaklaşımında Λ kesim ölçeği değiştirildiğinde hangi büyüklükler fiziksel olarak invariant kalır?",
    promptEn:
      "In the effective Lagrangian approach, which quantities remain physically invariant as the cutoff Λ is changed?",
    options: [
      {
        letter: "A",
        text: "Katsayıların kendisi (kütle, g) — hepsi Λ'dan bağımsızdır.",
        textEn: "The couplings themselves (mass, g) — all Λ-independent.",
        isCorrect: false,
      },
      {
        letter: "B",
        text: "Gözlenebilir büyüklükler — akışın invariantları.",
        textEn: "Observable quantities — invariants of the flow.",
        isCorrect: true,
      },
      {
        letter: "C",
        text: "Yalnızca Lagranjiyen'in toplam biçimi korunur, katsayılar aynı kalır.",
        textEn:
          "Only the total form of the Lagrangian is preserved; couplings stay the same.",
        isCorrect: false,
      },
      {
        letter: "D",
        text: "Hiçbir şey — her şey Λ ile kayar.",
        textEn: "Nothing — everything shifts with Λ.",
        isCorrect: false,
      },
    ],
    explanation:
      "Katsayılar Λ ile 'koşar' (running couplings), fakat bu koşma akış denklemi tarafından sınırlanır. Fiziksel gözlenebilirler akışın invariantlarıdır ve ölçekten bağımsız kalır.",
    explanationEn:
      "The couplings 'run' with Λ, but this running is constrained by the flow equation. Physical observables are invariants of the flow and remain independent of the scale.",
    citations: ["Peskin §12.2", "Weinberg Vol. 1 §12.4"],
  },
  {
    id: "q4",
    topic: "Evrensellik sınıfları",
    topicEn: "Universality classes",
    prompt:
      "Evrensellik sınıfı kavramı, farklı mikroskopik sistemlerin neden aynı kritik üsselleri paylaştığını açıklar. Bu bağlamda 'aynı sabit noktaya akmak' ne anlama gelir?",
    promptEn:
      "The concept of a universality class explains why different microscopic systems share the same critical exponents. In this context, what does 'flowing to the same fixed point' mean?",
    options: [
      {
        letter: "A",
        text: "Sistemlerin başlangıç Lagranjiyenleri eşitlenir.",
        textEn: "The starting Lagrangians of the systems become equal.",
        isCorrect: false,
      },
      {
        letter: "B",
        text: "İrrelevant farklar RG akışında sönümlenir; IR davranışı ortak bir sabit noktanın spektrumuyla belirlenir.",
        textEn:
          "Irrelevant differences decay under the RG flow; IR behaviour is set by the spectrum of a common fixed point.",
        isCorrect: true,
      },
      {
        letter: "C",
        text: "Sayısal değerler deneysel hata içinde örtüşür, ama kavramsal olarak farklıdırlar.",
        textEn:
          "Numerical values overlap within experimental error, but conceptually they are different.",
        isCorrect: false,
      },
      {
        letter: "D",
        text: "Sadece simetri sınıfı aynıdır; üsseller bağımsız olarak hesaplanır.",
        textEn:
          "Only the symmetry class is the same; exponents are computed independently.",
        isCorrect: false,
      },
    ],
    explanation:
      "Evrensellik, RG akışının irrelevant operatörleri sönümlemesinden doğar. Farklı mikroskopik teoriler aynı IR sabit noktasına akar ve ortak spektrum kritik üsselleri verir.",
    explanationEn:
      "Universality arises from the RG flow damping irrelevant operators. Different microscopic theories flow to the same IR fixed point, and the common spectrum yields the critical exponents.",
    citations: ["Peskin §12.4", "Cardy 1996"],
  },
  {
    id: "q5",
    topic: "Callan-Symanzik denklemi",
    topicEn: "Callan-Symanzik equation",
    prompt:
      "Callan-Symanzik denklemi, fiziksel Green fonksiyonlarının ölçek dönüşümleri altındaki davranışını kaydeder. Denklemin pratik önemi nedir?",
    promptEn:
      "The Callan-Symanzik equation captures how physical Green functions behave under scale transformations. What is its practical importance?",
    options: [
      {
        letter: "A",
        text: "Yalnızca teorik bir egzersizdir; pratik hesaplamada kullanılmaz.",
        textEn:
          "It is a purely theoretical exercise; it is not used in practical computation.",
        isCorrect: false,
      },
      {
        letter: "B",
        text: "Renormalize edilmiş perturbatif katsayılar arası tutarlılık ilişkilerini verir ve log-artıklarını toplar.",
        textEn:
          "It gives consistency relations between renormalised perturbative couplings and resums log-residues.",
        isCorrect: true,
      },
      {
        letter: "C",
        text: "Sadece serbest teoriler için geçerlidir.",
        textEn: "It only holds for free theories.",
        isCorrect: false,
      },
      {
        letter: "D",
        text: "Akış denklemini reddeder.",
        textEn: "It contradicts the flow equation.",
        isCorrect: false,
      },
    ],
    explanation:
      "CS denklemi Green fonksiyonlarının μ ve g üzerinden koordine edilmiş davranışını verir; log-terimleri RGE yoluyla toplanır ve perturbatif genişlemelerin doğruluk bölgesi genişletilir.",
    explanationEn:
      "The CS equation coordinates the behaviour of Green functions in μ and g; log-terms are resummed via the RGE, widening the domain of validity of perturbative expansions.",
    citations: ["Peskin §12.3"],
  },
];

const PLACEHOLDER_Q = (workspaceId: string, i: number): QuizQuestion => ({
  id: `${workspaceId}-q${i}`,
  topic: "Örnek konu",
  topicEn: "Sample topic",
  prompt: `Bu çalışma alanı için ${i + 1}. örnek soru — Phase 2'de gerçek sorular AI tarafından üretilecek.`,
  promptEn: `Sample question ${i + 1} for this workspace — real questions will be generated by AI in Phase 2.`,
  options: [
    { letter: "A", text: "Seçenek A", textEn: "Option A", isCorrect: false },
    { letter: "B", text: "Seçenek B", textEn: "Option B", isCorrect: true },
    { letter: "C", text: "Seçenek C", textEn: "Option C", isCorrect: false },
    { letter: "D", text: "Seçenek D", textEn: "Option D", isCorrect: false },
  ],
  explanation:
    "Gerçek açıklama Phase 2'de LLM'den gelecek. Bu alan yer tutucu.",
  explanationEn:
    "Real explanation will arrive from the LLM in Phase 2. This is a placeholder.",
  citations: ["—"],
});

const QUESTIONS_BY_WS: Record<string, QuizQuestion[]> = {
  qft: QFT_QUESTIONS,
  bio: Array.from({ length: 6 }, (_, i) => PLACEHOLDER_Q("bio", i)),
  phil: Array.from({ length: 6 }, (_, i) => PLACEHOLDER_Q("phil", i)),
  ml: Array.from({ length: 6 }, (_, i) => PLACEHOLDER_Q("ml", i)),
};

export function getQuizQuestions(workspaceId: string): QuizQuestion[] {
  return QUESTIONS_BY_WS[workspaceId] ?? [];
}

const FEYNMAN_PROMPTS: Record<string, FeynmanPrompt> = {
  qft: {
    id: "f-qft",
    topic: "Renormalizasyon grubu",
    topicEn: "Renormalization group",
    prompt:
      "Wilson'ın yaklaşımında yüksek enerji modlarını integre ederek nasıl etkin bir teoriye ulaşılır? Kendi kelimelerinle, bir lisansüstü arkadaşına anlatıyormuş gibi 2-3 dakika konuş.",
    promptEn:
      "In Wilson's approach, how does integrating out high-energy modes yield an effective theory? Explain in your own words, as if talking to a grad school peer for 2-3 minutes.",
    hints: [
      { tr: "Kesim ölçeği Λ neyi temsil ediyor?", en: "What does the cutoff Λ represent?" },
      { tr: "β-fonksiyonu ve akış denklemi", en: "β-function and flow equation" },
      { tr: "Sabit noktalar ve evrensellik", en: "Fixed points and universality" },
    ],
  },
  bio: {
    id: "f-bio",
    topic: "CRISPR-Cas9",
    topicEn: "CRISPR-Cas9",
    prompt:
      "CRISPR-Cas9 sisteminin spesifik bir DNA sekansını nasıl bulduğunu ve kestiğini anlat. Guide RNA'nın rolü neydi?",
    promptEn:
      "Explain how the CRISPR-Cas9 system finds and cuts a specific DNA sequence. What was the role of the guide RNA?",
    hints: [
      { tr: "PAM bölgesi", en: "PAM region" },
      { tr: "sgRNA hedeflemesi", en: "sgRNA targeting" },
      { tr: "Çift zincir kırığı onarımı", en: "Double-strand break repair" },
    ],
  },
  phil: {
    id: "f-phil",
    topic: "Husserl — epoché",
    topicEn: "Husserl — epoché",
    prompt:
      "Husserl'in epoché kavramını kendi kelimelerinle anlat. Günlük yaşamdan bir örnek ver.",
    promptEn:
      "Explain Husserl's epoché in your own words. Give an example from daily life.",
    hints: [
      { tr: "Doğal tutum askıya alma", en: "Suspending the natural attitude" },
      { tr: "Transandantal indirgeme", en: "Transcendental reduction" },
    ],
  },
  ml: {
    id: "f-ml",
    topic: "Self-attention",
    topicEn: "Self-attention",
    prompt:
      "Transformer mimarisinde self-attention mekanizması nasıl çalışır? Query-Key-Value matrisleri ve softmax'in rolü nedir?",
    promptEn:
      "How does the self-attention mechanism work in the Transformer architecture? What is the role of the Query-Key-Value matrices and the softmax?",
    hints: [
      { tr: "Ölçekli nokta çarpım", en: "Scaled dot-product" },
      { tr: "Pozisyonel kodlama", en: "Positional encoding" },
      { tr: "Çok-başlı dikkat", en: "Multi-head attention" },
    ],
  },
};

export function getFeynmanPrompt(workspaceId: string): FeynmanPrompt {
  return FEYNMAN_PROMPTS[workspaceId] ?? FEYNMAN_PROMPTS.qft!;
}
