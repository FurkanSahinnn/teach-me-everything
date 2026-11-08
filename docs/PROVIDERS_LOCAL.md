# Yerel Sağlayıcılar

Bu sayfa iki ayrı konuyu kapsar: (A) kendi makinende veya ağında çalışan OpenAI-uyumlu HTTP sunucuları, (B) bilgisayarında kurulu `claude`, `codex` ve `opencode` komut satırı araçlarını sağlayıcı olarak kullanmak. Bulut sağlayıcılar için bkz. [PROVIDERS.md](./PROVIDERS.md); genel mimari için [ARCHITECTURE.md](./ARCHITECTURE.md).

## A. Yerel / self-hosted HTTP sunucuları

### A.1 Preset'ler

`src/lib/ai/providers/presets.ts` içinde üç yerel preset vardır, üçü de `openai-compat` ailesidir ve varsayılan adresleri loopback'tir:

| Preset id | Varsayılan `baseUrl` | Tür | Araç kullanımı |
|---|---|---|---|
| `ollama` | `http://localhost:11434/v1` | chat + embed | `native` |
| `lm-studio` | `http://localhost:1234/v1` | chat | `json` (istemde JSON protokolü) |
| `llama-cpp` | `http://localhost:8080/v1` | chat | `json` |

Embedding için Ollama preset'leri `ollama-nomic`, `ollama-mxbai`, `ollama-bge-m3` (`embed-presets.ts`). Bunların dışında bir sunucu (ör. vLLM veya başka bir OpenAI-uyumlu gateway) için hazır preset yoktur; Settings'teki özel sağlayıcılar bölümünden uç nokta eklenir (`CustomEndpointModal`, bkz. [PROVIDERS.md](./PROVIDERS.md) § 7). Porta göre `baseUrl` buradan değiştirilir.

Model listesi çalışan sunucudan çekilir (`model-fetch/ollama.ts`, `lm-studio.ts`, `llama-cpp.ts`; anahtar gerekmez). Önerilen varsayılanlar preset'te: Ollama için sohbette `qwen2.5:14b`, embedding'de `nomic-embed-text`; kurulu olmayan bir modeli önce indirmen gerekir (`ollama pull <model>`).

### A.2 Anahtarsız tespit ve proxy bypass

- `isLocalUrl(url)` (`src/lib/ai/providers/local-bypass.ts`) yalnız `http(s)` URL'lerde şunları yerel sayar: `localhost`, `0.0.0.0`, `::1`, `*.local`, `127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`. Başka her şey bulut kabul edilir (yanlış tespit gizliliği değil işlevi bozar: bulut yolu anahtar ister ve proxy/izin kurallarına tabidir).
- Yerel adreste istek proxy'ye ve `plugin-http`'ye uğramaz; `openai-compat.ts` doğrudan webview `fetch` ile `.../chat/completions` adresine gider. Anahtar girilmişse `Authorization: Bearer` eklenir, boşsa eklenmez.
- Anahtar gerekliliği `presetIsKeyless(presetId, baseUrl)` (`src/lib/ai/anthropic-credential.ts`) ile kararlaştırılır: preset `externalAuth: true` ise ya da `isLocalUrl(baseUrl)` doğruysa anahtar istenmez.
- CSP `connect-src` üretiminde yerel adresler bulut listesine alınmaz (`deriveConnectOrigins`); yerel kaynaklar `next.config.ts` içinde ayrıca eklenir.

### A.3 Sunucu tarafı CORS

İstek tarayıcı/webview'den çıktığı için sunucunun TME'nin origin'ini kabul etmesi gerekir. Ayrıntılar sunucu sürümüne göre değişir; güncel yönerge için sunucunun kendi belgesine bak (preset `docsUrl` alanları: Ollama OpenAI uyumluluk sayfası, LM Studio local server, llama.cpp server README). Bilinen noktalar:

- **Ollama:** `OLLAMA_ORIGINS` ortam değişkeni izinli origin'leri belirler; değiştirdikten sonra Ollama'yı yeniden başlat.
- **LM Studio:** Developer → Local Server ayarlarında "Enable CORS" anahtarı.
- **llama.cpp:** `llama-server`'ın `--api-key` seçeneği anahtar zorunlu kılar; girersen aynı değeri TME'ye de yaz.

Bağlantıyı doğrulamak için Settings'teki "Bağlantıyı test et" düğmesi ya da `curl http://localhost:11434/v1/models` benzeri bir istek yeterlidir.

### A.4 Sık sorunlar

| Belirti | Neden | Çözüm |
|---|---|---|
| Ağ/CORS hatası | Sunucu origin'e izin vermiyor | § A.3 |
| "model not found" | Model sunucuda yok | Önce modeli indir/yükle, ya da modeli seçiciden değiştir |
| Araç çağrısı (ör. flashcard ekleme) çalışmıyor | Model araç kullanımını desteklemiyor | `json` stratejisi istemle dener; küçük modellerde başarısız olabilir |
| Anahtar soruyor | `baseUrl` yerel sayılmıyor (ör. genel alan adı) | Yerel IP/`.local` adı kullan ya da anahtar gir |

## B. Yerel agent CLI sağlayıcıları (`claude-cli`, `codex-cli`, `opencode-cli`)

### B.1 Neden var

Claude Pro/Max ve özellikle ChatGPT Plus/Pro abonelerinin API anahtarı yoktur (ChatGPT planının API karşılığı yok). TME bu kullanıcılar için bilgisayarlarında kurulu `claude` / `codex` ikilisini çalıştırır; kimlik doğrulamayı CLI kendi oturumuyla yapar. Yalnız masaüstü uygulamada çalışır; web build'de sağlayıcı "yalnız masaüstünde kullanılabilir" hatası verir.

Kayıtlar `presets.ts` içinde:

- `claude-cli` ("Claude Code (local CLI)"), varsayılan model `sonnet`; modeller CLI'nin kendi takma adları: `opus`, `sonnet`, `haiku`.
- `codex-cli` ("Codex (local CLI)"), varsayılan `gpt-6-astra`; statik liste yalnız çevrimdışı yedektir, seçici modelleri hesaba göre canlı çeker (B.6).
- `opencode-cli` ("OpenCode (local CLI)"), varsayılan `default`: OpenCode'un kendi seçili modeli. Modeller OpenCode'da bağlanan sağlayıcılardan canlı gelir (B.11).
- Üçü de `family: "agent-cli"`, `externalAuth: true`, `baseUrl: ""`. `ProviderFamily "agent-cli"` ayrı tutulur çünkü `family === "anthropic"` kodda "HTTP isteği kur" demektir; süreç başlatan bir sağlayıcı oraya karışmamalıdır. Boş `baseUrl` URL yardımcılarında atlanır. Kimlik kapıları `presetIsKeyless()` kullanmalıdır; tek başına `isLocalUrl(baseUrl)` kontrolü hiç var olamayacak bir anahtar ister. `resolveChatCredentialForPreset` bu preset'ler için boş anahtarlı kimlik döner.
- Model id'leri `PRICING`'te kasten yok: maliyet çipi gizlenir ([PROVIDERS.md](./PROVIDERS.md) § 5).

### B.2 Rust taşıması

`src-tauri/src/agent_cli.rs` ve `agent_process.rs`. Statik export'ta Node yoktur, bu yüzden `@anthropic-ai/claude-agent-sdk` kullanılamaz; CLI'nin NDJSON çıktısı doğrudan okunur.

- **Komutlar:** `agent_cli_probe`, `agent_cli_start`, `agent_cli_write`, `agent_cli_stop`, `agent_cli_workspace` (`lib.rs` içinde kayıtlı).
- **Akış:** stdout satır satır `tauri::ipc::Channel<AgentCliEvent>` ile webview'e akar. Olaylar: `line`, `stderr`, `exit`, `error`. `exit` her zaman son `line`'lardan sonra gelir. Okuyucular açılış yazımından önce başlar (iki boruda kilitlenmeyi önlemek için); stderr her zaman boşaltılır, yalnız son ~8 KB tutulur ve çıkış kodu başarısızsa `error` olarak iletilir.
- **Süreç ağacı** (`ProcessTree`): Windows'ta Job Object (`KILL_ON_JOB_CLOSE`, süreç askıda başlatılıp job'a atandıktan sonra devam ettirilir), Unix'te ayrı süreç grubu ve `SIGKILL`. Böylece npm sarmalayıcısının çocukları da ölür. Uygulama kapanırken (`RunEvent::Exit`) ve webview yeniden yüklenirken (`on_page_load`, `PageLoadEvent::Started`) `AgentCliState::shutdown` tüm oturumları sonlandırır.
- **Sistem istemi:** `systemPrompt` geçici bir dosyaya yazılıp `--system-prompt-file` olarak eklenir (Windows komut satırı ~32k karakterle sınırlı); süreç bitince dosya silinir. Bu bayrak CLI'nin `--help` çıktısında belgelenmemiştir. OpenCode'da aynı dosya bayrakla değil, yapılandırmadaki `{file:}` başvurusuyla okunur (B.11).
- **stdin:** açılış turu `stdin` ile yazılır; `closeStdin: true` ise EOF gönderilir. `claude` oturumu açık tutup yeni tur bekler, bu yüzden kapatılmaz; turdan sonra süreç `stop` ile öldürülür.
- **Çözümleme ve sınırlar:**
  - Yalnız `claude`, `codex` ve `opencode` kabul edilir. Dosya adı `claude`, `claude.exe`, `cli.js`, `cli-wrapper.cjs`; `codex`, `codex.exe`, `codex.js`; ya da `opencode`, `opencode.exe`, `opencode-cli`, `opencode-cli.exe` olmalıdır.
  - `.cmd`, `.bat`, `.ps1` reddedilir (kabuk gerektirir, argüman enjeksiyonu yüzeyi açar). Windows'ta POSIX kabuk betiği (shebang) de reddedilir. Hata iletisi yerine `claude.exe`/`codex.exe` ya da `.cjs` sarmalayıcıyı göstermeni söyler.
  - JS dosyaları (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts` ya da `node` shebang'li) `node <dosya>` ile başlatılır; probe sonucunda `launcher: "node"` döner.
  - Yol verilmezse bilinen konumlar sırayla denenir (`~/.local/bin`, OpenCode için `~/.opencode/bin`, Windows'ta `%APPDATA%\npm` ve paket içi ikili/giriş dosyaları, OpenCode Desktop'ın sürüm klasörü `%APPDATA%\ai.opencode.desktop\cli\<sürüm>-<mimari>\opencode-cli.exe` (en yüksek sürüm sayısal olarak seçilir), macOS/Linux'ta Homebrew ve `/usr/local/bin`, sonra `PATH`). GUI süreci oturum kabuğunun `PATH`'ini miras almadığından `PATH` taraması son çaredir.
- **Argüman beyaz listesi** (`validate_options`): yalnız TME'nin çıkarım profilleri ve model keşfi kabul edilir. Claude için sabit önek/sonek dizisi, Codex için `["app-server"]` ya da `exec --json ... --sandbox read-only --model <m> -` dizisi, OpenCode için yalnız `["acp"]`. Çalışma dizini verilemez (TME yönetir). Ortam değişkeni geçersiz kılmaları yalnız `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` ile sınırlıdır; OpenCode için yalnız vekil değişkenleri geçer (`OPENCODE_*` Rust'a aittir). Oturum anahtarı en çok 64 karakter, yalnız harf/rakam/`-`/`_`.
- **Probe:** `--version` ile en çok 10 saniye, stdin null; ikili bulunamazsa hata fırlatmaz, `found: false` ve `error` döner.

### B.3 Tauri izinleri

Tauri 2 uygulama komutlarını varsayılan olarak reddeder. `src-tauri/permissions/agent-cli.toml` iki izin tanımlar ve ikisi de `capabilities/default.json` içinde verilir:

- `allow-agent-cli-probe`: yalnız `agent_cli_probe` (sınırlı `--version` çağrısı).
- `allow-agent-cli-session`: `agent_cli_start`, `agent_cli_write`, `agent_cli_stop`, `agent_cli_workspace` (çıkarım, model keşfi, stdin trafiği ve OpenCode çalışma klasörünün yolu).

Genel `shell:allow-execute` verilmez; webview'e "herhangi bir ikiliyi çalıştır" yetkisi vermemek bu ayrımın nedenidir. Yeni bir Tauri komutu eklerken aynı şekilde izin dosyası ve capability kaydı gerekir, yoksa webview komutu "bulunamadı" olarak görür.

### B.4 JS köprüsü

`src/lib/tauri/agent-cli.ts`: `probeAgentCli`, `startAgentCli`, `writeAgentCli`, `stopAgentCli`, `getAgentWorkspace`. Web build'de çekirdek yüklenmez ve `null` döner. Tauri `Result<_, String>` hatalarını çıplak string olarak reddeder; köprü bunu `Error`'a çevirir ki Rust tarafındaki neden kullanıcıya ulaşsın. `stopAgentCli` zaten bitmiş oturumda hata saymaz (iptal ve normal bitiş aynı yolla temizlenir).

### B.5 `claude-cli`

`src/lib/ai/providers/claude-cli.ts`. Argümanlar `buildClaudeCliArgs`: `-p`, `stream-json` giriş/çıkış, `--include-partial-messages`, `--verbose`, `--model <takma ad>`, ardından yalıtım bayrakları `--safe-mode`, `--restricted`, `--strict-mcp-config`, `--disable-slash-commands`, `--setting-sources ""` ve `--disallowedTools` ile `CLAUDE_CLI_DISALLOWED_TOOLS` listesindeki tüm yerleşik araçlar. Amaç kullanıcının kendi kodlama yapılandırmasının (CLAUDE.md, eklentiler, hook'lar, MCP) cevaba sızmasını ve her çağrıda araç şeması token'ı ödemeyi önlemektir. Liste CLI yeni araç eklediğinde güncellenmelidir. Her `stream_event` satırı Anthropic Messages SSE yükünü sarar; `parseCliLine` zarfı açar ve akış HTTP sağlayıcıyla aynı eşleyiciye (`consumeAnthropicPayloads`) gider. TME araçları CLI'nin değil, istemdeki JSON protokolünün (`withJsonToolFallback`) üzerinden çalışır. Model kimliği olarak takma ad korunur, böylece analiz çalıştırıcıları API fiyatı uygulamaz.

### B.6 `codex-cli` ve app-server

`codex-cli.ts` sohbeti `codex-app-server.ts`'e devreder; Rust tarafında `codex app-server` süreci aynı `agent_cli_*` köprüsüyle başlar. Her TME isteği yeni süreç ve yeni geçici iş parçacığıdır; sohbet kalıcılığı TME'dedir.

JSON-RPC sırası: `initialize` -> `initialized` bildirimi -> `thread/start` (`ephemeral: true`, `approvalPolicy: "never"`, `sandbox: "read-only"`, TME sistem metni `baseInstructions`) -> `turn/start` (düzleştirilmiş geçmiş metin girdisi olarak). `item/agentMessage/delta` bildirimleri anında metin olayına dönüşür; `item/completed` yalnız delta gelmemiş mesajlar için yedektir. `thread/tokenUsage/updated` toplamları kullanım olur (önbellekteki girdi ayrılır). `turn/completed` durumu `completed`, `interrupted` veya hata olarak eşlenir. Sunucudan gelen etkileşimli istekler (onay, araç) desteklenmez: istemci hata yanıtı verir ve tur "desteklenmeyen etkileşim" hatasıyla biter. Kimlik doğrulama/hız sınırı hataları HTTP benzeri durum koduna çevrilir (`failure`). Handshake aşamalarının zaman aşımı 20 saniyedir (`HANDSHAKE_TIMEOUT`).

Model keşfi: `listCodexModels` ayrı bir app-server oturumunda `model/list` ister (en çok 20 sn), gizli modelleri atar, katmanı `mini` eki ve hesap varsayılanından çıkarır; web build'de, CLI yokken ve zaman aşımında `[]` döner, seçici statik listeye düşer (`model-fetch/codex-cli.ts` adapter'ı). `claude-cli` için adapter yoktur; CLI çıplak takma adları kabul eder.

Rust beyaz listesi hâlâ bir `codex exec --json ... -` profilini kabul eder ve `agent_cli.rs` `closeStdin` desteği taşır, ancak sağlayıcı bugün yalnız app-server yolunu kullanır. `exec` yolu token akışı vermez.

### B.11 `opencode-cli` ve ACP

`opencode-cli.ts` sohbeti `opencode-acp.ts`'e devreder. Rust `opencode acp` sürecini başlatır; konuşma satır satır JSON-RPC olan Agent Client Protocol'dür (ACP). Yalnız OpenCode 2 desteklenir; 2.2.6 ile doğrulandı. Masaüstü uygulaması arka plan servisini çalıştırsa bile `acp` kendi süreci içinde açılır ve yapılandırmayı ortamdan okur.

**Profili Rust kurar** (`opencode_env`). Web görünümü `OPENCODE_*` değişkeni veremez, çünkü satır içi bir yapılandırma MCP sunucusu ve eklenti (yani komut) tanımlayabilir. Rust şunları ayarlar:

- `OPENCODE_CONFIG_CONTENT`: `tme-tutor` adlı birincil ajan. Bütün araç izinleri reddedilir (`{"action":"*","resource":"*","effect":"deny"}`), `system` sistem istemi dosyasına `{file:<yol>}` ile başvurur. `default_agent: "tme-tutor"` ile her oturum bu ajanla açılır. Varsayılan olarak her araca izin veren yerleşik ajanlar (`build`, `plan`, `general`, `explore`) kapatılır. `title` ajanı da kapatılır; yoksa OpenCode her yeni oturuma ad koymak için fazladan bir model çağrısı yapar.
- `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_FILEWATCHER` = `1`.
- Süreç, uygulama veri klasöründeki boş `agent-workspace` klasöründe başlar. `agent_cli_workspace` aynı yolu web görünümüne verir, çünkü ACP `session/new` var olan mutlak bir `cwd` ister. Paylaşılan temp yerine kullanıcıya ait klasör seçildi; başka bir yerel kullanıcı oraya AGENTS.md ya da opencode.json bırakamasın diye.

**stdin de denetlenir** (`check_opencode_input`, açılış yazımı ve her `agent_cli_write`). argv ve env tek yüzey değil: ACP `session/new` `mcpServers` alır ve OpenCode bunları komut olarak başlatır (2.2.6'da denendi: başlatıyor). Mod değiştirmek de her araca izin veren bir ajana geçebilir. Bu yüzden Rust yalnız TME'nin gönderdiği iletileri geçirir:

- `initialize`, `session/delete`;
- `session/new`: `cwd` çalışma klasörüyle aynı olmalı, `mcpServers` ve `additionalDirectories` boş olmalı;
- `session/set_config_option`: `mode` yalnız `tme-tutor`, `model` herhangi bir dize;
- `session/prompt`: yalnız `text` blokları (`resource_link` gibi dosya başvuruları reddedilir);
- `session/cancel` bildirimi;
- OpenCode'un isteklerine yalnız reddeden yanıtlar (`error` ya da `cancelled` sonucu).

Yük tam satırlarla, `\n` ile bitmelidir; yarım bir satır sonraki yazımla birleşip denetimden kaçamaz. `session/set_mode`, `session/load` gibi diğer bütün yöntemler reddedilir. Böylece kullanıcının kendi yapılandırmasında tanımlı ajanlara da geçilemez.

**Sistem istemi neden satır içi değil:** OpenCode yapılandırma metnindeki `{env:...}` ve `{file:...}` ifadelerini açar. Sistem istemi doğrudan yapılandırmaya yazılsaydı, içinde `{file:~/.ssh/id_rsa}` geçen bir belge o dosyanın içeriğini modele gönderirdi (2.2.6'da denendi: sızıyor). `{file:}` ile başvurulan dosyanın içeriği ise birebir eklenir: içindeki ifadeler açılmaz, ters eğik çizgiler korunur, yalnız baştaki ve sondaki boşluk kırpılır. Dosya ayrıca tek bir ortam değişkeni için Windows'un 32 767 karakterlik sınırına takılmaz.

**Tur sırası:** `initialize` → `session/new` (`cwd`, `mcpServers: []`) → `session/set_config_option` (`configId: "mode"`, `value: "tme-tutor"`) → model `default` değilse `session/set_config_option` (`configId: "model"`, `provider/model`) → `session/prompt` (düzleştirilmiş geçmiş, tek metin bloğu). `session/update` içindeki `agent_message_chunk` metinleri anında metin olayına dönüşür; düşünce ve araç güncellemeleri yok sayılır. `session/prompt` yanıtındaki `stopReason` ve `usage` kullanım olur: `inputTokens` önbellek okumalarını içermez, `thoughtTokens` çıktıya eklenir, `cachedReadTokens` / `cachedWriteTokens` ayrı tutulur. Tur sonunda (iptal ve hata dahil) `session/delete` gönderilir, en çok 2 sn beklenir, sonra süreç durdurulur. Böylece TME istekleri kullanıcının OpenCode geçmişinde kalmaz. İptalde önce `session/cancel` bildirimi gider. Süreç kendiliğinden çıkmışsa silme atlanır. İzin isteği gelirse (`session/request_permission`) `cancelled` ile reddedilir; başka sunucu istekleri `-32601` alır. Handshake aşamaları 20 sn ile sınırlıdır.

**Hatalar:** OpenCode her hatayı `Internal error: <neden>` diye sarar; önek atılır. `data.errorName` içinde `limit`, `rate` ya da `quota` geçerse 429 (ör. `provider.free-limit`); kimlik hatası ya da ACP `-32000` ise 401. `mode not found: tme-tutor`, profilin yüklenmediği anlamına gelir ve "OpenCode 2 veya üstüne güncelle" iletisine çevrilir.

**Model keşfi:** `readOpencodeCatalog` geçici bir ACP oturumu açar, `session/new` yanıtındaki `configOptions` içinden `id: "model"` seçeneğini okur (gruplu seçenekler düzleştirilir) ve oturumu siler. İstem gönderilmez, ücret yazılmaz. `listOpencodeModels` listenin başına "OpenCode default" girdisini koyar (id `default`, ipucu OpenCode'un şu anki modeli). Web build'de, CLI yokken ya da zaman aşımında `[]` döner ve seçici preset'teki tek girdiye düşer. Katman `inferModelTier` ile model id'sinden çıkarılır (`-free` ekli modeller "free" olur).

**Durum yoklaması** (`probeOpencodeStatus`): OpenCode'da tek bir hesap yoktur ve ücretsiz modelleri oturum açmadan çalışır. Bu yüzden "hazır" şu demektir: ACP yanıt veriyor, `tme-tutor` ajanı yüklü ve en az bir model erişilebilir. Durum model sayısını ve sağlayıcıları gösterir (ör. `73 model · opencode, opencode-go`). `--version` 2'den küçükse süreç hiç başlatılmaz, hata döner. `opencode auth list` kullanılmaz, çünkü kimlik bilgisi basabilir.

### B.7 Settings ve tercihler

Ayarlar → Sağlayıcılar (`/settings/providers`, `ProvidersManager`). Listede üç CLI "Bu bilgisayarda" grubunda sürüm ve durumla görünür; ayrıntı paneli `src/components/settings/providers/CliProviderDetail.tsx`:

- **Durum:** oturum açık mı, e-posta ve plan (B.10), kullanım limitleri (`LimitMeter`).
- **İkili dosya yolu:** boşsa otomatik bulunur; kaydedince `probeAgentCli` çözülen yolu ve `node` başlatıcısını gösterir.
- **Ev klasörü:** `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Tam yol olmalı ve var olmalı; Rust `validate_options` başka değeri reddeder. OpenCode'da bu satır yoktur (yapılandırması `~/.config/opencode`, verisi `~/.local/share/opencode`).
- **Ortam değişkenleri:** yalnız `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`; tüm CLI'lar için ortaktır. API anahtarı türü değişkenler arayüzde yoktur: prefs `localStorage`'da düz metin durur, anahtarlar keychain'li alanlara aittir.

Tercihler `usePrefs().agentCli` (`AgentCliPrefs`): `claudePath?`, `codexPath?`, `opencodePath?`, `claudeHome?`, `codexHome?`, `env?`. Ev klasörü ayarlanınca sohbet sağlayıcıları ve durum yoklamaları süreci ilgili ortam değişkeniyle başlatır. Sağlayıcı listesindeki anahtar kapatılırsa (`disabledProviders`) CLI model seçicilerde görünmez; kayıtlı bir binding hâlâ kullanıyorsa görünür kalır.

### B.10 Hesap ve limit yoklaması

`src/lib/ai/agent-status/` (`probes.ts`, `parsers.ts`, `store.ts`). Hiçbir kimlik dosyası okunmaz, özel HTTP uç noktası çağrılmaz; her şey kullanıcının kendi CLI'ından gelir. Sonuçlar `useAgentStatus` içinde 5 dakika önbellekte tutulur (`AGENT_STATUS_TTL_MS`); "Yeniden kontrol et" zorlar.

- **Claude:** çıkarım argümanlarıyla (`haiku` modeli) başlatılır, kullanıcı mesajı gönderilmez, böylece kota harcanmaz. stdin'e iki control request yazılır:
  - `{"type":"control_request","request":{"subtype":"initialize"}}` → `account.{email, organization, subscriptionType}` ve `claude_code_version`.
  - `get_usage` → `rate_limits.five_hour`, `seven_day`, `model_scoped[]` (`utilization` 0–100, `resets_at`).
  - `get_usage` belgelenmemiş ve deneyseldir. Hata verirse hesap bilgisi limitsiz döner (`limitsError`).
- **Codex:** `codex app-server` → `initialize` (`capabilities.experimentalApi: true`) → `account/read` (`account.{type, email, planType}`; `null` ise oturum yok) → ChatGPT hesabında `account/rateLimits/read` (`primary` = oturum penceresi, `secondary` = haftalık, `individualLimit` = aylık kredi; `resetsAt` saniye).
- Bütçe 20 saniye (`PROBE_BUDGET_MS`); süreç her durumda `finally` içinde durdurulur.

Kullanım ekranındaki token ve maliyet verisi ayrı bir yoldan gelir: Rust `usage_scan` komutu (`src-tauri/src/usage.rs`) `~/.claude/projects/**/*.jsonl` ve `~/.codex/sessions/**/*.jsonl(.zst)` günlüklerini yalnız okur. Sayılar günlük ve model bazında birleştirilir, içerik dönmez. Ayrıntı: [ARCHITECTURE.md](./ARCHITECTURE.md) §6.

### B.8 Bilinen sınırlar

- İstek başına bir süreç; sıcak oturum yeniden kullanılmaz. Çok aşamalı üretimde (ör. makale analizi) eşzamanlı birkaç süreç açılabilir.
- Çok turlu geçmiş tek bir kullanıcı turuna düzleştirilir (`flattenMessagesToTurn`); CLI tarafında gerçek çok turlu oturum yoktur.
- Görüntü girdisi yok (`vision: false`).
- `codex app-server` kullanıcının yerel Codex yapılandırmasını yükler; `exec`'teki `--ignore-user-config`/`--ignore-rules` burada yoktur. TME iş parçacığının talimat, kalıcılık ve sandbox/onay politikasını ezer ama kurulumun, miras alınan ortamın ve yerel entegrasyonların yalıtıldığını iddia etmez.
- Yerel ikilinin dosya adı doğrulanır, özgünlüğü doğrulanmaz; yapılandırılmış kurulum güvenilir yerel yazılım sayılır.
- Eski CLI protokol sürümleri doğrulanmamıştır.
- Abonelik kullanımı CLI'nin hız sınırlarına tabidir; hatalar 429 benzeri durumla yüzeye çıkar.
- OpenCode, kullanıcının genel yapılandırmasını (`~/.config/opencode/opencode.json`, global `AGENTS.md`, eklentiler) yükler; sağlayıcılar oradan geldiği için bu gerekli. Global `AGENTS.md` sistem isteminin sonuna eklenir. `skill` aracının tanımı her istekte gider; izni reddedildiği için çalışmaz.
- Kullanım ekranı (`usage_scan`) OpenCode günlüklerini okumaz. OpenCode 1.x (`opencode-ai` paketi) desteklenmez.
- stdin süzgeci yalnız OpenCode içindir. `claude` ve `codex app-server` oturumlarının stdin kanalı denetlenmez; argv/env beyaz listesi onlar için tek sınırdır.
- Bir OpenCode turu iptal edilir ve süreç silme yanıtından önce ölürse oturum OpenCode geçmişinde kalabilir.

### B.9 İsteğe bağlı smoke testleri

Kurulu CLI gerektirdikleri için varsayılan olarak `#[ignore]`'dur (`src-tauri/src/agent_cli.rs` içinde):

```bash
# Claude: ikiliyi çözümle ve --version çalıştır (çıkarım yok)
cargo test --manifest-path src-tauri/Cargo.toml --offline smoke_resolve_and_spawn_claude -- --ignored --nocapture

# Codex: app-server handshake, model/list, thread/start, stop (çıkarım yok)
cargo test --manifest-path src-tauri/Cargo.toml --offline smoke_codex_app_server_handshake -- --ignored
```

OpenCode için: ikiliyi bulur, `acp` handshake'ini yapar, `tme-tutor` ajanının yüklendiğini doğrular ve oturumu siler (çıkarım yok):

```bash
cargo test --manifest-path src-tauri/Cargo.toml --offline smoke_opencode_acp_handshake -- --ignored --nocapture
```

Codex komutuna `TME_CODEX_SMOKE_INFERENCE=1` eklenirse küçük bir gerçek çıkarım turu da çalışır ve kota harcar; istem/yanıt loglanmaz. Normal `cargo test` ise süreç ağacı, `.cmd` reddi, beyaz liste ve oturum yaşam döngüsü gibi CLI gerektirmeyen birim testlerini çalıştırır.
