---
id: doc-8
title: 'A-06 — Tarihçe, inceleme ve kullanıcı kabulü planı'
type: specification
created_date: '2026-10-23 11:42'
updated_date: '2026-10-23 15:03'
tags:
  - server
  - a-06
  - plan
---
# A-06 — onaylanan uygulama planı

Kullanıcı bu konuşmada planı ve uygulamayı onayladı. Başlangıç dalı tasks/server-a06-review-history; kaynak yedeği /tmp/backlog-a06/start-records.tar.gz. Groma kurulu değil. Manifesto değişmez; gerçek projeler ve kişisel sunucu verisi kullanılmaz.

## Ürün kararları

Akış görev Markdown frontmatter'ındaki isteğe bağlı review alanındadır. SQLite mevcut hesaplar ve değiştirilemeyen tarihçedir; ikinci görev durumu deposu yoktur. Talepler görevde inceleme, karar veya teslim kabulüdür; belge/karara ayrı akış eklenmez. Atama açık hesap kimliği ve okunabilir ad taşır; assignee'den kişi çıkarılmaz. Yalnız atanan insan yanıtlar; salt okunur kullanıcı kendi talebini yanıtlayabilir ama görevi değiştiremez. Admin başkası yerine kabul vermez, iptal ve yeni talep ile yeniden atar. Agent tasksWrite kapsamında talep ve doğrulama kaydeder, insan yanıtı vermez.

Teslim kabulünde aynı içerik sürümüne ait son doğrulama başarılı veya gerekçeli uygulanmaz olmalıdır. Genel inceleme/karar bu koşula tabi değildir. İlgili içerik değişince sonuçlar tarihsel kalır, yeni doğrulama/talep gerekir. Review alanı, otomatik updated_date ve pano ordinal'i içerik karşılaştırmasından çıkarılır. Commit isteğe bağlı kanıttır; kod izlenmez. Done durumu kabul/kanıt değildir ve bu akış durumu kendiliğinden değiştirmez. Yerel CLI kimlikleri beyan, merkezi işlem aktörleri doğrulanmış kimliktir; dış dosya kabulü merkezi doğrulanmış kabul sayılmaz.

## Uygulama sırası

1. Tek ortak review modeli/doğrulayıcı ve içerik özeti; parser/serializer/Core kilitli hazırlama yolu. Eski görevleri yeniden yazma; mevcut yazılar alanı korur.
2. ServerClient'ta açık kullanıcı oturum dosyası; mevcut login/password/logout/CSRF ve oturum süreleri. Depo dışında owner-only atomik dosya, parola saklanmaz, origin'e bağlı ve agent anahtarıyla karşılıklı dışlayıcı. auth login/password/logout. CLI insan işlemi doğrulanmış user aktörü ve server-cli kaynağıdır; istemci etiketi yetki vermez.
3. Proje API ve CLI talep/list/verify/respond/cancel; actor kimlikten, güncel atama/izin bekleme ve commit sonrası yeniden kontrol edilir. Aynı mevcut UUID/revision/yazma/tarihçe/kurtarma yolu. Genel task edit ile akış sonuçları değiştirilemez.
4. Mevcut tarihçe query'sinde tarih/kişi/action/source filtreleri ve CLI eşliği; kalıcı recordKey; external occurredAt bilinmiyorsa detectedAt ile tarih filtreleme; İstanbul gösterimi.
5. Mevcut görev modalında tarihçe/akış; proje history rotası; Projects benden beklenenler, mevcut güvenilir task görüntüsünden özet. Kirli metin korunur, eski proje/hesap yanıtı uygulanmaz. Okunamayan proje güncel sayılmaz.
6. Birleşmiş geçici fixture kabulü, test/types/yazmasız Biome/native build/smoke ve gerçek Chromium. Sadelik incelemesi, README/shipped yönergeler ve doc-5 kapanışı.

## Kabul ve sınırlar

Roundtrip, eski kayıtlar, status/assignee/not değişiminde stale; review/updated_date/ordinal değişiminde kendini geçersiz kılmama; yerel/dış beyan, read-only atanmış kişi, agent ret, iptal/yeniden atama, yetki kaybı, stale/retry/lost response, kesinti, iki proje ve silme/recreate, tarih/sayfalama, CLI oturum/parola ve tarayıcı koyu/açık/narrow akışı doğrulanır. Gerçek Finbee, otomatik Git, bildirim, yeni task status, ayrı review service/store ve yeni MCP araçları kapsam dışıdır. Kaynak ve kanıt özetleri verification/server/a06-verification.json içinde korunacaktır. Önceki kabul yeni sürümün kanıtı sayılmaz. Commit/push ayrıca istenmedikçe yapılmaz.


## Uygulama sonucu — 23 Ekim 2026

BACK-814–819 tamamlandı. Son sabit kaynak: tam CI 4014 başarılı / 13 atlanan / 0 hata; 4027 test, 21136 beklenti. Tip 637 dosyada geçti; varsayılan yazmasız Biome, native build/CLI-web-MCP smoke ve gerçek Chromium 30/30 runtime0 geçti. Kanıt verification/server/a06-verification.json.

Akış mevcut Core, parser/serializer, prepared writer ve SQLite tarihçe/kurtarma yolundadır. Genel task edit workflow sonuçlarını değiştiremez. Aynı saf review doğrulaması commit öncesi güncel yetkiyle tekrar kullanılır; admin rolü kalkıp tasksWrite kalsa bile başkasının talebi iptal edilemez. CLI belirsiz kimliği reddeder, @username açık seçimdir; HTTP reviewer.userId tam kimliktir. CLI metin/JSON Task görünümü doğrulanmış aktör ile beyanı ayırır ve trust/stale metadatasını korur. Eksik bağlantılı auth/reviews/history/operation komutları yerel yapılandırmayı taşımaz.

Sadelik incelemesinde updated-date ve içerik özeti tek taskContentForComparison kullanır. Açıklama/plan/not/özet/AC/DoD değişip geri alınırsa review_revision ilerler; önceden yazılmış Markdown gövdesiyle karşılaştırma hatası red testle üretildi ve düzeltildi. Review/updated_date/ordinal kendi sonuçlarını geçersiz kılmaz. Yerel/dış beyan merkezi doğrulanmış sonucu taklit edemez. İnsan CLI mevcut oturum, CSRF ve süre/iptal kurallarını kullanır; parola saklanmaz. Pano move/reorder ve CLI PUT aynı Updated geçmiş sınıfıdır; cleanup Archived olarak görünür. Başka veri/servis/normalizer katmanı yoktur.

Son kaynak manifesti 662 girdi, SHA-256 b018988839bcbe3fbb616f0a8abd746457cd43d29d7e9c785445b87e462b576b; kontrollerden sonra değişmedi. Native SHA-256 5933031b494e5ad3f9d70225e84f26c516bfa4c3ea9648baf6efaf3314941b9b. Yeni/var olan TSX aynı kurallarla karşılaştırıldı: değişen beş eski dosyada 60 hata/6 uyarı önce ve sonra, ek tanı0; üç yeni TSX temiz. Kalıtımlı borç temiz tarama sayılmaz. Yedi gerçek SIGKILL durumu tam koşudadır; bunlardan biri atanmış salt okunur insan kabulünü tek sonuç/olay olarak kurtarır.

Doğrulanmış binary dist/backlog'a atomik alındı; eski binary /tmp/backlog-a06/previous-backlog içinde korundu. Kişisel süreç yeniden başlatılmadı, kişisel DB/Finbee açılmadı. Aynı --data-dir ve start komutuyla yeniden açılınca özellikler görünür; admin yeniden oluşturulmaz. Dal tasks/server-a06-review-history yerel; commit/push/merge yapılmadı. /tmp ham kanıtları kalıcı yedek değildir. Groma yok; manifesto/yönetilen mimari dosyaları değişmedi. Sonraki aşama A-07 Finbee pilotudur, başlatılmadı.
