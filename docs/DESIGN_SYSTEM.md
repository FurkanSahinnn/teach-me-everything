# Design System v2 — Teach Me Everything

> **Son güncelleme:** 2026-04-28 · v2 (UI overhaul)
> Tek doğruluk kaynağı: `src/app/globals.css`. Bu dokümandan farklı değer
> kullanma; ne renk, ne radius, ne shadow. Yeni token önerin varsa önce
> burayı güncelle, sonra `globals.css`'e ekle.
>
> **Redesign notu:** Bu dosya mevcut implementasyonun token ve komponent notlarını açıklar. Yeni görsel yön için kaynak `UI_REDESIGN_PLAN.md` dosyasıdır. Onaydan sonra bu doküman dark-first premium akademik sisteme göre güncellenecektir.

---

## 1. Felsefe

**Mevcut baseline:** modern minimal · akademik kimlik korunur · hover-lift mikro-etkileşim · shell tarafında mobile-first.

**Planlanan yön:** dark-first premium akademik çalışma alanı · dengeli yoğunluk · sepia güçlü reader modu · landing ve tüm app ekranlarında tutarlı responsive yapı.

- Genel dil **Linear / Notion** sadeliği — temiz boşluk, tutarlı 12px radius, ölçülü shadow
- **Premium amber** dual-token (`--color-accent` daha akademik, `--color-accent-hot` CTA) — 3 temada da çalışır
- **3 tema · 3 yoğunluk · 2 dil** kullanıcı tercihi → `data-theme`, `data-density`, `lang` attribute'larıyla anında değişir
- Tipografi: **Source Serif 4** (display), **Inter** (UI), **JetBrains Mono** (code)
- Tüm ikonografi `lucide-react` üzerinden — `src/components/icons/index.ts` barrel'ından tüketilir

---

## 2. Tema Mimarisi

### Üç tema

| Tema | Default | Karakter | Surface stratejisi |
|------|---------|----------|--------------------|
| `white` | ✅ (sistem light ise) | Modern minimal · saf beyaz · Linear/Notion | Border + soft shadow |
| `sepia` | — | Akademik · warm parchment · okuma odaklı | Border ağırlıklı · shadow minimal |
| `dark` | ✅ (sistem dark ise) | Sofistike · ink-black · gece modu | Border + belirgin shadow |

İlk açılışta `prefers-color-scheme` dinlenir (`white` veya `dark` seçilir). Kullanıcı tema değiştirdiğinde `themeFollowsSystem: false` set edilir ve tercih persist olur.

### Theme switching akışı

1. **FOUC önleyici inline script** (`lib/utils/theme-script.ts`) `<head>` içinde, React hydrate olmadan önce `data-theme`/`data-density`/`lang` atribütlerini set eder
2. `prefs.ts` Zustand store her `setTheme`/`setDensity`/`setLocale` çağrısında `<html>` attribute'ünü senkron tutar
3. `prefers-color-scheme` change listener `themeFollowsSystem` true ise sistem temasına otomatik geçirir
4. Tüm color/shadow token'ları `[data-theme]` selector'ları üzerinden override edilir; component'lerde `dark:` prefix **yok**

### Token örneği

```css
@theme {
  --color-paper:    #FFFFFF;
  --color-ink:      #0F0F0E;
  --color-accent:   #B86A2B;
  --color-accent-hot: #C26A2E;
  --shadow-soft:    0 1px 2px rgb(15 15 14 / 0.04), 0 4px 12px -4px rgb(15 15 14 / 0.06);
  --radius:         12px;
  --row:            36px;
  /* …kalan tokenler globals.css'te… */
}

[data-theme="sepia"] {
  --color-paper: #F6EAD2;
  --color-ink:   #2E1F0E;
  --shadow-soft: 0 1px 2px rgb(46 31 14 / 0.05);
}

[data-theme="dark"] {
  --color-paper: #0E0E10;
  --color-ink:   #F4F2EE;
  --shadow-soft: 0 1px 2px rgb(0 0 0 / 0.40), 0 4px 12px -4px rgb(0 0 0 / 0.40);
}
```

---

## 3. Tam Token Tablosu

### 3.1 Color (her tema kendi değerini override eder)

| Token | White | Sepia | Dark | Kullanım |
|-------|-------|-------|------|----------|
| `--color-paper` | `#FFFFFF` | `#F6EAD2` | `#0E0E10` | Primary surface |
| `--color-paper-2` | `#FAFAF9` | `#EFDFC0` | `#1A1A1D` | Sunken surface, sidebar |
| `--color-paper-3` | `#F4F4F2` | `#E5D2AC` | `#242428` | Hover state |
| `--color-paper-4` | `#EDEDEA` | `#DCC79A` | `#2D2D32` | Pressed state |
| `--color-rule` | `#E5E5E1` | `#C9B68F` | `#2E2E33` | Default border |
| `--color-rule-soft` | `#EFEEEA` | `#D6C4A0` | `#26262A` | Subtle divider |
| `--color-rule-strong` | `#D4D3CD` | `#A6925F` | `#404048` | Hover border |
| `--color-ink` | `#0F0F0E` | `#2E1F0E` | `#F4F2EE` | Primary text |
| `--color-ink-2` | `#2B2B29` | `#4A331A` | `#D4D1CC` | Secondary text |
| `--color-ink-3` | `#5C5B57` | `#6B4F30` | `#948F87` | Tertiary text, icons |
| `--color-ink-4` | `#8B8A85` | `#8E7651` | `#6B6760` | Placeholder, eyebrow |
| `--color-ink-5` | `#B8B7B1` | `#B19979` | `#4A463F` | Disabled / muted |
| `--color-accent` | `#B86A2B` | `#B86A2B` | `#E89757` | Aksanlı vurgu (akademik) |
| `--color-accent-hot` | `#C26A2E` | `#B25920` | `#F5A56B` | Primary CTA |
| `--color-accent-soft` | `#E8C9A8` | `#DDB988` | `#7A4419` | Tinted surface |
| `--color-accent-wash` | `#FCEFDC` | `#ECD8B0` | `#2E2012` | Highlight bg |
| `--color-accent-ink` | `#6E3A0F` | `#5C2E08` | `#F6D0A8` | Accent text on wash |
| `--color-ok` | `#4E6E3E` | `#4E6E3E` | `#4E6E3E` | Başarı |
| `--color-warn` | `#A86A1C` | `#A86A1C` | `#A86A1C` | Uyarı |
| `--color-err` | `#8E2F2F` | `#8E2F2F` | `#8E2F2F` | Hata |

### 3.2 Radius (12px central)

| Token | Değer | Kullanım |
|-------|-------|----------|
| `--radius-xs` | `6px` | Inline pill, küçük chip |
| `--radius-sm` | `10px` | Button, input |
| `--radius` | `12px` | Card default, segmented |
| `--radius-md` | `12px` | (alias) |
| `--radius-lg` | `16px` | Panel, modal, drawer |
| `--radius-xl` | `24px` | Hero card, splash |
| `--radius-2xl` | `32px` | Marketing surface |

### 3.3 Shadow (tema-bazlı override)

| Token | Beyaz/Dark | Sepia |
|-------|-----------|-------|
| `--shadow-soft` | Card default | Belirgin azaltılmış |
| `--shadow-medium` | Floating menu | Çok hafif |
| `--shadow-deep` | Modal, drawer | Modal, drawer |
| `--shadow-lift` | Hover-lift state | Hover-lift state |

### 3.4 Density (compact / normal / comfy)

| Token | Compact | Normal | Comfy |
|-------|---------|--------|-------|
| `--space` | 6px | 8px | 12px |
| `--pad-x` | 10px | 14px | 18px |
| `--pad-y` | 6px | 9px | 12px |
| `--row-sm` | 24px | 28px | 32px |
| `--row` | 30px | 36px | 42px |
| `--row-lg` | 36px | 44px | 50px |
| `--type-base` | 13px | 14px | 15px |

Component'ler `var(--row)` arbitrary value'ları ile yoğunluğa duyarlı.

### 3.5 Motion

| Token | Değer | Kullanım |
|-------|-------|----------|
| `--ease-out` | `cubic-bezier(0.2, 0.6, 0.2, 1)` | Default |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Switch knob, FAB |
| `--duration-fast` | `120ms` | Hover/active |
| `--duration-normal` | `180ms` | Theme transition, switch |
| `--duration-slow` | `280ms` | Drawer slide, modal fade |

---

## 4. Component Spec

### 4.1 `Button` (`src/components/ui/Button.tsx`)

5 variant × 6 size, hover-lift mikro-etkileşim default.

| Variant | Açıklama | Background | Use case |
|---------|----------|------------|----------|
| `default` | Soft tinted (varsayılan) | `bg-paper-2` + border | Sekonder eylemler |
| `primary` | Solid ink | `bg-ink text-paper` | Save / Continue / Apply |
| `accent` | Solid CTA | `bg-accent-hot text-white` | Generate / Yapay zekâ aksiyonları |
| `ghost` | Transparent | `bg-transparent` | Icon-only nav, toolbar |
| `danger` | Destructive | `bg-paper-2 text-err` | Delete / Reset |

| Size | Yükseklik | Padding | Use |
|------|-----------|---------|-----|
| `sm` | 32px | 12px | Toolbar, inline |
| `md` | 40px | 16px | **Default** |
| `lg` | 48px | 20px | Hero CTA |
| `icon-sm/md/lg` | 32/40/48px | square | Icon-only |

**Hover-lift:** `hover:-translate-y-[1px]` + `hover:shadow-[var(--shadow-lift)]`, 120ms ease-out. Active'de geri iner.

### 4.2 `Chip`

6 variant (`default`, `accent`, `muted`, `ok`, `warn`, `err`) × 2 size. Pill shape (`rounded-full`).

### 4.3 `Card`

5 variant: `default`, `sunken`, `floating`, `ghost`, `accent`. `padding` prop: `none|sm|md|lg|xl`. `interactive` flag hover-lift ekler.

Surface karakteri tema bazlı:
- White: border + `--shadow-soft`
- Sepia: border heavy + `--shadow-soft` (çok hafif)
- Dark: border + `--shadow-soft` (belirgin)

### 4.4 `Switch`

Modern knob — spring easing (`var(--ease-spring)`), white knob ile her temada kontrast. `sm`/`md` size.

### 4.5 `SegmentedControl`

`default` ve `inverted` ton. Active state'te `bg-paper` + soft shadow (raised look). Density'ye duyarlı.

### 4.6 `Input`

`focus-visible:ring-2 ring-accent/25` + border accent. `invalid` state error kırmızısı + ring/30. `disabled` paper-2 + opacity-60.

### 4.7 `Kbd`

Inset bottom shadow (klavye tuş hissi), paper-2 bg, ink-3 text, mono font. Topbar `⌘K` ipucu için.

### 4.8 `ThemeToggle` (yeni)

3 segment pill: Sun (white) · BookOpen (sepia) · Moon (dark). Active'te raised paper background.

---

## 5. Shell — Mobile-First Hibrit

### Desktop (≥768px)
```
┌────────┬──────────────────┐
│ Side   │ Topbar (sticky)  │
│ bar    ├──────────────────┤
│ 260px  │                  │
│        │ Main content     │
│        │                  │
└────────┴──────────────────┘
```

### Mobile (<768px)
```
┌──────────────────┐
│ Topbar           │  ← Hamburger + Search + ⚡
│                  │
│                  │  ← MobileDrawer (sidebar slide-in)
│ Main content     │
│                  │
│                  │
├──────────────────┤
│ ⊞  ⊟  ⊕  🔍 ⚙️ │  ← BottomBar (fixed)
└──────────────────┘
```

### Komponentler

| Komponent | Sorumluluk |
|-----------|-----------|
| `AppShell` | Responsive grid orchestrator; drawer/search state |
| `Sidebar` | Desktop'ta sabit, `MobileDrawer` içinde reuse |
| `MobileDrawer` | <md: slide-in panel + backdrop, ESC kapatır |
| `Topbar` | Sticky, blur backdrop, mobile'da hamburger + search ikonu |
| `BottomBar` | <md: 4 nav + ortada CTA FAB (Add) |
| `TweaksPanel` | Floating gear → tema/yoğunluk/dil pop-up |

---

## 6. Token → Tailwind Eşleştirme

Tüm `--color-*`, `--radius-*`, `--shadow-*`, `--font-*` token'ları `@theme` üzerinden Tailwind utility'sine bağlanır:

```tsx
<div className="bg-paper border-rule rounded-[var(--radius)] shadow-[var(--shadow-soft)]">
```

Density token'ları için arbitrary CSS variable kullanın:
```tsx
<button className="h-[var(--row)] px-[var(--pad-x)]">
```

---

## 7. İkonografi

`lucide-react` standart. Yeni ikon ekleme:
1. `src/components/icons/index.ts` barrel'ına re-export ekle
2. Sayfalardan import: `import { Search } from "@/components/icons"`
3. Boyut `h-4 w-4` (16px) UI default; `h-5 w-5` (20px) topbar/CTA; `h-3.5 w-3.5` (14px) chip içi

---

## 8. Tipografi Skala

| Sınıf | Font | Size | Weight | Use |
|-------|------|------|--------|-----|
| Display | serif | 32-48px | 400-500 | Page hero |
| H1 | serif | 28px | 500 | Page title |
| H2 | sans/serif | 21px | 500 | Section |
| H3 | sans | 17px | 600 | Subsection |
| Body | sans | 14-15px | 400 | UI default |
| Small | sans | 13px | 400 | Helper |
| Eyebrow | mono | 11-12px | 500 | Section labels (UPPERCASE, tracking 0.08em) |
| Code | mono | 13px | 400 | Code/keys |

Reader prose (`/notebook`) için ayrı `prose-tme` utility — Source Serif 4, 17px, line-height 1.68, drop-cap, mark.hl.

---

## 9. Mikro-Etkileşim Kuralları

1. **Hover-lift** (default for tüm clickable surface'ler): `translateY(-1px)` + `shadow-lift`, 120ms ease-out
2. **Active**: lift'i geri al (`translate-y-0`) + shadow-none
3. **Focus-visible**: 2px ring `ring-accent` + 2px offset `ring-paper`. Hiçbir komponent focus halkasız bırakılmaz
4. **Disabled**: `opacity-50`, hover effect kapalı, `cursor-not-allowed`
5. **Loading**: spinner overlay, içerik invisible
6. **prefers-reduced-motion**: tüm transition/animation 0.01ms'a düşer (CSS guard global)
7. **Tema geçişi**: 180ms color/background fade — body üzerinde

---

## 10. Erişilebilirlik

| Alan | Kural |
|------|-------|
| Contrast | WCAG AA 4.5:1 minimum (her tema 3 ana ink seviyesi paper üstüne testli) |
| Focus ring | Tüm interactive'larda `ring-accent` görünür |
| ARIA | Sidebar/Topbar/Main landmark + `role` ataması |
| Icon-only btn | `aria-label` zorunlu |
| Reduced motion | Global CSS guard |
| Color-scheme | Her tema `color-scheme` declarative — form control'ler doğal eşleşir |
| Touch targets | Mobile bottom-bar 52px min-width, FAB 48px |

---

## 11. Migration Notları (v1 → v2)

| Eski | Yeni | Notu |
|------|------|------|
| `Theme = "light" \| "sepia"` | `Theme = "white" \| "sepia" \| "dark"` | `prefs.ts` v5 migration `light` → `white` map'ler |
| `--paper, --ink, --accent` (raw) | `--color-paper, --color-ink, --color-accent` | Tailwind utility üretimi için `--color-*` zorunlu |
| `radius: 6px` | `radius: 12px` | Modern feel; button 10px, chip pill |
| Inline SVG ikonlar | `lucide-react` barrel | `components/icons/index.ts` |
| Sabit 248px sidebar | 260px desktop + drawer mobile | `AppShell` responsive grid |
| `accent: #B8601C` (tek) | `accent: #B86A2B` + `accent-hot: #C26A2E` | Dual-token; `accent-hot` CTA-only |
| `themeFollowsSystem` yok | Var (default `true`) | İlk açılış `prefers-color-scheme` |
| FOUC riski | `theme-init-script` inline `<head>` | Hydrate öncesi data-theme set |

---

## 12. Yapılacaklar (post-v2)

- [ ] `dompurify` markdown render için
- [ ] Toast/Snackbar component (sticky bottom-right)
- [ ] Modal/Dialog component (focus trap + backdrop)
- [ ] Tooltip component (Radix-free, native popover veya custom)
- [ ] Command palette (`cmdk` paketi) — Topbar `⌘K` modal'ını besler
- [ ] Skeleton loader pattern (`animate-pulse` + paper-2 fill)
- [ ] Reader prose stili (`prose-tme` utility) — Phase 2 source ingest ile
- [ ] Visual regression snapshot'ları (`docs/visual-regression/`)
