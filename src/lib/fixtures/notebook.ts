export type OutlineItem = {
  id: string;
  label: string;
  labelEn: string;
  level: 1 | 2;
};

export type ContentBlock =
  | { type: "h1"; id: string; text: string; textEn: string }
  | { type: "h2"; id: string; text: string; textEn: string }
  | { type: "p"; text: string; textEn: string };

export type Citation = {
  id: string;
  section: string;
  quote: string;
  quoteEn: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentEn: string;
  citations?: Citation[];
  time: string;
  timeEn: string;
};

export type SourceReader = {
  id: string;
  workspaceId: string;
  title: string;
  titleEn: string;
  author: string;
  currentPage: number;
  totalPages: number;
  section: string;
  sectionTitle: string;
  sectionTitleEn: string;
  outline: OutlineItem[];
  blocks: ContentBlock[];
  chat: ChatMessage[];
};

const QFT_S1_READER: SourceReader = {
  id: "s1",
  workspaceId: "qft",
  title: "An Introduction to Quantum Field Theory",
  titleEn: "An Introduction to Quantum Field Theory",
  author: "Peskin & Schroeder",
  currentPage: 394,
  totalPages: 842,
  section: "§12.2",
  sectionTitle: "Wilsonian Yaklaşım ve Etkin Lagranjiyen",
  sectionTitleEn: "Wilsonian Approach and the Effective Lagrangian",
  outline: [
    {
      id: "ch12",
      level: 1,
      label: "Bölüm 12 — Renormalizasyon Grubu",
      labelEn: "Ch. 12 — The Renormalization Group",
    },
    {
      id: "s12-1",
      level: 2,
      label: "§12.1 Ölçek dönüşümleri",
      labelEn: "§12.1 Scale transformations",
    },
    {
      id: "s12-2",
      level: 2,
      label: "§12.2 Wilsonian yaklaşım",
      labelEn: "§12.2 Wilsonian approach",
    },
    {
      id: "s12-2-1",
      level: 2,
      label: "§12.2.1 Akış denklemi",
      labelEn: "§12.2.1 Flow equation",
    },
    {
      id: "s12-2-2",
      level: 2,
      label: "§12.2.2 Sabit noktalar",
      labelEn: "§12.2.2 Fixed points",
    },
    {
      id: "s12-3",
      level: 2,
      label: "§12.3 Callan-Symanzik denklemi",
      labelEn: "§12.3 Callan-Symanzik equation",
    },
    {
      id: "s12-4",
      level: 2,
      label: "§12.4 Evrensellik",
      labelEn: "§12.4 Universality",
    },
  ],
  blocks: [
    {
      type: "h1",
      id: "s12-2",
      text: "§12.2 · Wilsonian Yaklaşım ve Etkin Lagranjiyen",
      textEn: "§12.2 · Wilsonian Approach and the Effective Lagrangian",
    },
    {
      type: "p",
      text: "Wilson'un renormalizasyon anlayışının can alıcı noktası, yüksek enerji modlarını integre ederek düşük enerji fiziğini etkileyen bir dizi Lagranjiyen üretmektir. Momentum uzayında Λ kesim ölçeği tanımlanır; Λ'dan daha yüksek momentumlu modlar path integral'den çıkarılır ve kalan modlara yönelik etkin etkileşim katsayıları bu integrasyonun sonucu olarak kayar.",
      textEn:
        "The crux of Wilson's view of renormalization is to integrate out high-energy modes and produce a one-parameter family of Lagrangians governing low-energy physics. A cutoff Λ is defined in momentum space; modes above Λ are removed from the path integral, and the effective couplings of the remaining modes are shifted as a consequence of this integration.",
    },
    {
      type: "p",
      text: "Kesim ölçeği değiştirildikçe katsayılar — kütle, etkileşim sabitleri ve alan rescaling faktörleri — sürekli bir akış izler. Bu akışı tanımlayan diferansiyel denklemlere renormalizasyon grubu (RG) akış denklemleri denir.",
      textEn:
        "As the cutoff is lowered the couplings — masses, interaction constants and field-rescaling factors — follow a continuous flow. The differential equations that describe this flow are called renormalization-group (RG) flow equations.",
    },
    {
      type: "h2",
      id: "s12-2-1",
      text: "Akış denklemi ve sabit noktalar",
      textEn: "Flow equation and fixed points",
    },
    {
      type: "p",
      text: "gᵢ katsayıları için akış β-fonksiyonları tarafından belirlenir: dgᵢ/dt = βᵢ(g). Sabit bir nokta g*, βᵢ(g*) = 0 koşulunu sağlar. Sabit noktanın çevresinde akış küçük sapmalara göre lineerleştirildiğinde, özdeğerlerin işaretleri her katsayının ilgili (relevant), marjinal (marginal) veya ilgisiz (irrelevant) oluşunu belirler.",
      textEn:
        "The flow of the couplings gᵢ is governed by β-functions: dgᵢ/dt = βᵢ(g). A fixed point g* satisfies βᵢ(g*) = 0. Linearizing the flow around a fixed point, the signs of the eigenvalues classify each coupling as relevant, marginal, or irrelevant.",
    },
    {
      type: "p",
      text: "İlgisiz katsayılar, düşük enerjilerde sabit noktaya yönelir; bu, renormalize edilebilirliği yeniden üretir ve kritik fenomenlerde evrenselliğin kaynağıdır. Marjinal katsayılar çok küçük logaritmik düzeltmeler alır — gerçek beta fonksiyonunun yüksek mertebe katkılarına duyarlıdırlar.",
      textEn:
        "Irrelevant couplings flow towards the fixed point at low energies; this reproduces renormalizability and is the origin of universality in critical phenomena. Marginal couplings receive only logarithmic corrections — they are sensitive to higher-order contributions in the true beta function.",
    },
    {
      type: "h2",
      id: "s12-2-2",
      text: "Gözlenebilirlerle ilişki",
      textEn: "Relation to observables",
    },
    {
      type: "p",
      text: "Bu bakış açısı, pertürbatif renormalizasyonu belirli bir hesap şemasından öte, fiziksel bir ilkeyle yeniden ifade eder: ölçek değişiminden kalan sabitler. Λ'yı fiziksel bir momentuma göndermek, bize düşük enerji davranışını kontrol eden etkin Lagranjiyen'i verir.",
      textEn:
        "This point of view recasts perturbative renormalization not as a particular computation scheme but as a physical principle: the invariants that remain under a change of scale. Sending Λ to a physical momentum yields the effective Lagrangian that controls the low-energy behaviour.",
    },
    {
      type: "p",
      text: "Kritik fenomenler topluluğunda, tam olarak bu sabit noktanın spektrumu gözlemlenen kritik üssellerle örtüşür; bu nedenle, bu dilde yazılmış bir teorinin öngörüleri farklı mikroskobik detaylara sahip sistemlerin paylaştığı evrensel sınıfa aittir.",
      textEn:
        "In the universality class of critical phenomena, it is precisely the spectrum of this fixed point that coincides with the observed critical exponents; the predictions of a theory written in this language therefore belong to the universal class shared by systems with different microscopic details.",
    },
  ],
  chat: [
    {
      id: "m1",
      role: "user",
      content: "§12.2'de Wilson'un yaklaşımının öz fikrini 3 cümlede özetler misin?",
      contentEn: "Can you summarise the core idea of Wilson's approach in §12.2 in three sentences?",
      time: "4 dk önce",
      timeEn: "4 min ago",
    },
    {
      id: "m2",
      role: "assistant",
      content:
        "Wilson, yüksek momentumlu modları kademeli olarak integre ederek düşük enerji fiziğini kontrol eden bir Lagranjiyen ailesi üretir. Kesim ölçeği Λ düşürüldükçe katsayılar β-fonksiyonları tarafından belirlenen sürekli bir akış izler. Sabit noktalar, kritik fenomenlerdeki evrensellik sınıflarının kaynağıdır; ilgisiz katsayılar akışta yok olur, geriye yalnızca fiziksel olarak anlamlı olanlar kalır.",
      contentEn:
        "Wilson progressively integrates out high-momentum modes to produce a family of Lagrangians governing low-energy physics. As the cutoff Λ is lowered, the couplings follow a continuous flow set by the β-functions. Fixed points are the source of universality in critical phenomena; irrelevant couplings die out along the flow, leaving only physically meaningful ones.",
      citations: [
        {
          id: "c1",
          section: "§12.2 · p.394",
          quote:
            "yüksek enerji modlarının integrasyonu, düşük enerji fiziğini etkileyen etkin Lagranjiyenler üretir",
          quoteEn:
            "integrating out high-energy modes produces effective Lagrangians governing low-energy physics",
        },
        {
          id: "c2",
          section: "§12.2.1 · p.395",
          quote:
            "sabit nokta çevresinde özdeğerler katsayıları ilgili, marjinal veya ilgisiz olarak sınıflandırır",
          quoteEn:
            "around a fixed point, eigenvalues classify couplings as relevant, marginal or irrelevant",
        },
      ],
      time: "4 dk önce",
      timeEn: "4 min ago",
    },
    {
      id: "m3",
      role: "user",
      content: "β-fonksiyonu ve akış denklemi arasındaki ilişki tam olarak nedir?",
      contentEn: "What exactly is the relationship between the β-function and the flow equation?",
      time: "2 dk önce",
      timeEn: "2 min ago",
    },
    {
      id: "m4",
      role: "assistant",
      content:
        "β-fonksiyonu, akış denkleminin sağ tarafıdır: dgᵢ/dt = βᵢ(g). Yani β, ölçek parametresi t = log(μ/Λ)'a göre her bir katsayının anlık değişim hızını verir. Sabit nokta β(g*) = 0 koşuluyla karakterize edilir, ve o noktada lineerleştirilmiş akışın özdeğerleri katsayıların spektrumunu belirler.",
      contentEn:
        "The β-function is the right-hand side of the flow equation: dgᵢ/dt = βᵢ(g). So β gives the instantaneous rate of change of each coupling with respect to the scale parameter t = log(μ/Λ). A fixed point is characterised by β(g*) = 0, and the eigenvalues of the linearised flow at that point determine the spectrum of couplings.",
      citations: [
        {
          id: "c3",
          section: "§12.2.1 · p.395",
          quote: "dgᵢ/dt = βᵢ(g) denklemi katsayıların akışını tanımlar",
          quoteEn: "the equation dgᵢ/dt = βᵢ(g) defines the flow of the couplings",
        },
      ],
      time: "şimdi",
      timeEn: "now",
    },
  ],
};

const PLACEHOLDER_READER = (
  workspaceId: string,
  sourceId: string,
  title: string,
  author: string,
): SourceReader => ({
  id: sourceId,
  workspaceId,
  title,
  titleEn: title,
  author,
  currentPage: 12,
  totalPages: 240,
  section: "§1",
  sectionTitle: "Giriş",
  sectionTitleEn: "Introduction",
  outline: [
    { id: "ch1", level: 1, label: "Bölüm 1 — Giriş", labelEn: "Ch. 1 — Introduction" },
    { id: "s1-1", level: 2, label: "§1.1 Arka plan", labelEn: "§1.1 Background" },
    { id: "s1-2", level: 2, label: "§1.2 Motivasyon", labelEn: "§1.2 Motivation" },
  ],
  blocks: [
    { type: "h1", id: "s1", text: "§1 · Giriş", textEn: "§1 · Introduction" },
    {
      type: "p",
      text: "Bu kaynak için örnek bir metin hazırlanacak. Şimdilik yer tutucu içerik gösteriliyor — Phase 2'de gerçek parse edilmiş metin buraya gelecek.",
      textEn:
        "A sample passage will be prepared for this source. Placeholder content is shown for now — real parsed text will land here in Phase 2.",
    },
    { type: "h2", id: "s1-1", text: "Arka plan", textEn: "Background" },
    {
      type: "p",
      text: "Okuyucu arayüzü: sol kolonda içindekiler, ortada metin, sağda Claude sohbeti. Metinden bir parçayı seçtiğinde \"Bunu sor\", \"Not ekle\" ve \"Karta ekle\" aksiyonları beliriyor.",
      textEn:
        "Reader interface: outline on the left, text in the middle, Claude chat on the right. Selecting a passage reveals actions: 'Ask about this', 'Add note', and 'Add to cards'.",
    },
  ],
  chat: [
    {
      id: "m1",
      role: "assistant",
      content:
        "Bu kaynak henüz tamamen indekslenmedi. Phase 2'de PDF parse edilip embedding'leri oluşturulunca sorularına içerik bazlı cevap verebileceğim.",
      contentEn:
        "This source is not yet fully indexed. Once the PDF is parsed and its embeddings are built in Phase 2, I can answer your questions against the content.",
      time: "şimdi",
      timeEn: "now",
    },
  ],
});

const READERS: SourceReader[] = [
  QFT_S1_READER,
  PLACEHOLDER_READER(
    "qft",
    "s2",
    "The Quantum Theory of Fields, Vol. 1",
    "Weinberg",
  ),
  PLACEHOLDER_READER(
    "qft",
    "s3",
    "arXiv:2112.03929 — Wilsonian RG, a primer",
    "Polonyi",
  ),
  PLACEHOLDER_READER(
    "qft",
    "s4",
    "Ders notları: §4 Renormalizasyon akışı",
    "Kendi notların",
  ),
  PLACEHOLDER_READER(
    "bio",
    "s1",
    "Molecular Biology of the Cell, 7e",
    "Alberts et al.",
  ),
  PLACEHOLDER_READER(
    "bio",
    "s2",
    "CRISPR-Cas9: biology and applications",
    "Doudna & Charpentier",
  ),
  PLACEHOLDER_READER(
    "bio",
    "s3",
    "Lehninger Principles of Biochemistry",
    "Nelson & Cox",
  ),
  PLACEHOLDER_READER("phil", "s1", "Cartesian Meditations", "Husserl"),
  PLACEHOLDER_READER("phil", "s2", "Being and Time", "Heidegger"),
  PLACEHOLDER_READER("ml", "s1", "Attention Is All You Need", "Vaswani et al."),
  PLACEHOLDER_READER(
    "ml",
    "s2",
    "Deep Learning",
    "Goodfellow, Bengio, Courville",
  ),
  PLACEHOLDER_READER(
    "ml",
    "s3",
    "arXiv:2403.09137 — Efficient transformer training",
    "Chen et al.",
  ),
];

export function getReader(
  workspaceId: string,
  sourceId: string,
): SourceReader | undefined {
  return READERS.find(
    (r) => r.workspaceId === workspaceId && r.id === sourceId,
  );
}

export const SUGGESTED_PROMPTS: { tr: string; en: string }[] = [
  {
    tr: "Bu bölümün ana argümanını 3 cümlede özetle",
    en: "Summarise the main argument of this section in three sentences",
  },
  {
    tr: "Burada hangi varsayımlar yapılıyor?",
    en: "What assumptions are being made here?",
  },
  {
    tr: "Bu denklemin fiziksel yorumu nedir?",
    en: "What is the physical interpretation of this equation?",
  },
  {
    tr: "Önceki bölümle nasıl bağlantılı?",
    en: "How does this relate to the previous section?",
  },
];
