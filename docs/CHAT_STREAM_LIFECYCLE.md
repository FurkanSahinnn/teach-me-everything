# Sohbet akışının yaşam döngüsü

Okuyucu ve çalışma alanı sohbetinde uygulama içi gezinme, devam eden yanıtı
iptal etmez. Sohbet tekrar açıldığında aynı isteğin durumu, mesajları ve
**Durdur** denetimi gösterilir. Kullanıcı uzaktayken tamamlanan yanıt da saklanır.

## Uygulama

- `src/lib/ai/runners/chat-session.ts`: çalışma alanı ve kaynak kimlikleriyle
  ayrılan oturumlar; React görünümünden bağımsız istek sahipliği ve iptal denetimi.
  Görünüm aboneliğinden çıkmak isteği durdurmaz. Aynı oturumda ikinci istek,
  öncekinin son kayıtları tamamlanmadan başlayamaz.
- Durdur hazırlık sırasında da kullanılabilir. İptal bilgisi sonraki akışa
  veya araç turuna geçişte korunur; yeni bir kullanıcı isteğinde sıfırlanır.
  Başka bir kaynağın sohbeti bu isteği iptal edemez.
- Etkin konuşma kimliği oturumda tutulur. Yeniden açılışta sabitlenmiş başka
  bir konuşmanın seçilmesi yerine yanıtın yazıldığı konuşma gösterilir.
- `src/lib/ai/runners/stream-writer.ts`: ara ve son metin kayıtları sırayla
  yazılır. Geciken bir ara kayıt, son metnin üzerine yazamaz.
- Yeniden denemenin mesaj silme adımı da oturum kilidinin içindedir.
  Görünüm kapalıyken gelen kaynak açma aracı kullanıcıyı başka sayfaya taşımaz.

## Doğrulama

- TypeScript kontrolü başarılı; ESLint: 0 hata, 0 uyarı.
- Vitest: 217 dosyada 2.084 test başarılı. Eklenen yedi test görünümün kapanıp
  açılmasını, kaynak değiştirmeyi, araç turunun iptal denetimini, hazırlıkta
  durdurmayı, eşzamanlı istek engelini ve geciken/veritabanında hata veren
  metin kayıtlarını kapsar.
- Playwright: üç senaryo başarılı. Okuyucu ve çalışma alanında yanıt akarken
  Notlar'a gitme, geri dönme, elle durdurma, yeni mesaj gönderme ve uzaktayken
  tamamlanma gerçek arayüz ve IndexedDB üzerinden doğrulanır. Sadece elle
  durdurulan mesajın `interrupted` olarak kaydedildiği de kontrol edilir.
  Mevcut kaynak alıntısı/navigasyon senaryosu da geçer.

Tarayıcı testleri sağlayıcı HTTP sınırında kontrollü SSE kullanır; canlı Claude
Code kotası tüketilmez. Bu değişiklik için paketlenmiş Tauri uygulamasında canlı
sağlayıcı testi yapılmadı. Sağlayıcı ve native taşıma sözleşmeleri değiştirilmedi.

Devamlılık uygulama içi gezinme kapsamındadır. Tam sayfa yenileme veya uygulamayı
kapatıp açma sonrasında üretimi sürdürme/resume desteği eklenmedi. Başlamış bir
araç işlemini durdurmak, daha önce tamamladığı veri değişikliklerini geri almaz.
