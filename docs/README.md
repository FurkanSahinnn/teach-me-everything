# Teach Me Everything — Dokümantasyon

Bu klasör katkıda bulunanlar için proje belgelerini içerir. Belgeler güncel kodu anlatır; geçmiş faz notları ve
tarihli doğrulama raporları burada tutulmaz (git geçmişindedir).

## Okuma sırası

1. **[PROJECT_INDEX.md](PROJECT_INDEX.md)**: proje ne, ilkeler, rota tablosu, sözlük, şema/sürüm numaraları.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)**: çalışma modları (web dev ve Tauri), katmanlar, veri, AI katmanı,
   masaüstü kabuğu, release, güvenlik, test.
3. **[FEATURES.md](FEATURES.md)**: sayfa sayfa özellikler, kullanılan bileşenler, tablolar ve AI çağrıları.
4. **[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)**: tasarım token'ları, temalar, UI bileşenleri.
5. **[PROVIDERS.md](PROVIDERS.md)**: bulut sağlayıcılar, anahtarlar, CORS/proxy, fiyat tablosu.
6. **[PROVIDERS_LOCAL.md](PROVIDERS_LOCAL.md)**: yerel ve kendi sunucunuzdaki modeller; Claude Code ve Codex CLI
   sağlayıcıları.
7. **[STATIC_EXPORT_WORKSPACE_ROUTING.md](STATIC_EXPORT_WORKSPACE_ROUTING.md)**: statik export altında `/w/[id]`
   rotaları ve yeni rota ekleme kontrol listesi.
8. **[CODEMAPS/](CODEMAPS/architecture.md)**: dosya düzeyinde haritalar:
   [architecture](CODEMAPS/architecture.md) · [backend](CODEMAPS/backend.md) · [frontend](CODEMAPS/frontend.md) ·
   [data](CODEMAPS/data.md) · [dependencies](CODEMAPS/dependencies.md).

## Hızlı başvuru

| Soru | Nerede? |
|---|---|
| Proje ne, hangi sayfalar var? | `PROJECT_INDEX.md` |
| Bir istek uçtan uca nasıl akıyor? | `ARCHITECTURE.md` §6 |
| Bir sayfa ne yapıyor? | `FEATURES.md` |
| Yeni renk/font eklenebilir mi? | `DESIGN_SYSTEM.md` (önce token) |
| Sağlayıcı anahtarı nasıl alınır, neden CORS hatası? | `PROVIDERS.md` |
| Ollama / LM Studio / Claude Code CLI / Codex nasıl bağlanır? | `PROVIDERS_LOCAL.md` |
| Yeni `/w/[id]/...` rotası neden 404 veriyor? | `STATIC_EXPORT_WORKSPACE_ROUTING.md` |
| Bir dosya ya da sembol nerede? | `CODEMAPS/` |
| Release nasıl çıkılır? | `ARCHITECTURE.md` §10 |

Kodlama ajanları için rehber: [`../CLAUDE.md`](../CLAUDE.md).

`.gitignore` bu klasörde yalnız yukarıdaki belgeleri ve `CODEMAPS/` klasörünü git'e alır. Buraya eklenen başka
dosyalar yerel kalır; yeni bir belge paylaşılacaksa `.gitignore` içindeki `!/docs/...` listesine de eklenmeli.
