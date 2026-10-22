---
id: doc-6
title: A-04 kod incelemesi ve ortak yazma tarihçe planı
type: specification
created_date: '2026-10-22 07:51'
updated_date: '2026-10-22 10:53'
tags:
  - server
  - a-04
  - planning
  - review-required
---
# A-04 — Kod incelemesine dayalı uygulama taslağı

Durum: **A-04 ürün kararları 22 Ekim 2026 tarihinde kullanıcı tarafından onaylandı.** Backend/frontend incelemesi ve görevleme tamamlandı; uygulama kodu henüz değiştirilmedi. Aşağıdaki teknik sözleşme uygulama planıdır. doc-4 ve doc-5 içindeki kesin A-02/A-03 kararları geçerlidir.

İncelenen kaynak: `adb84179c3e639140c270504e75841f96cb4f4d0`; dal `tasks/server-a04-write-history`. Başlangıç çalışma ağacı temizdi. Önceki görevler BACK-795–BACK-798 Done. Başlangıç arşivi `/tmp/backlog-a04-plan-rl9fukci/start.tar.gz`, SHA-256 `feb34babb05fc4a4548cf93c48379c49cdf64f14ad33e30f6b443d9674fe3aa0`. Groma komutu bulunamadı; kullanıcının açık kod inceleme talebi doğrultusunda kaynak dosyalar doğrudan okundu, Groma taraması yapılmadı.

## 1. Mevcut mimari ve bulunan bağlantılar

| Alan | Bugünkü kod ve davranış | A-04 açısından sonuç |
|---|---|---|
| Merkezi giriş | `src/server/central.ts:211,267,424`: oturum, CSRF, üyelik, yol sınırı; proje başına `BacklogServer` | İstek aktörü ve sunucu veri dizini bu sınırdan ortak yazmaya aktarılmalı. Aktör global değişkende tutulamaz. |
| Proje çalışma zamanı | `src/server/index.ts:268`: kendi `Core` örneği, ContentStore, SearchService ve WS. `project-context.ts` ayrı bir registry sunuyor; merkezi sunucu şu an handler haritasını kullanıyor. | Yeni paralel çalışma zamanı/registry eklemek gerekmiyor. |
| Ortak semantik | `src/core/backlog.ts:2164,3010,4348,4493`: görev tahsisi, düzenleme, Markdown doğrulaması, belge/karar işlemleri | Kanonik CLI ile aynı doğrulama ve serializer kullanılmalı. HTTP için ikinci CRUD uygulaması yazılmamalı. |
| Fiziksel yazma | `src/file-system/operations.ts:1012`: `writeRecordFile`; ayrıca arşiv, silme, config ve milestone yazımları | Bugün doğrudan dosyaya uygulanıyor. Kalıcı niyetten önce tüm değişiklik kümesini hazırlamak için bu sınır değişmeli. |
| Kilitler | Görev/draft ve allocator kilitleri; `index.ts:681` yalnız kararlar için süreç içi kuyruk | Kilit, tarayıcının eski sürümle kaydetmesini engellemiyor. Proje kuyruğu ve mevcut dosya kilitleri birlikte kullanılmalı. |
| Çok dosyalı işlemler | `backlog.ts` toplu taşıma, demotion, silme/referans temizliği; `duplicate-task-repair.ts:603`; `archived-task-move.ts`; `mcp/tools/milestones/handlers.ts` | Yalnız tek kayıt PUT endpointlerini sarmalamak yeterli değil. Doğrudan fs çağrıları da ortak yazma sınırına katılmalı. |
| SQLite | `database.ts`: v0/v2/v3 tanıma, kesin şema denetimi, kısa senkron `BEGIN IMMEDIATE`, okumada göç yok | Aynı ServerDatabase içinde eklemeli göç; ayrı veritabanı veya ikinci bağlantı politikası gerekmiyor. |
| Tarayıcı HTTP | `web/lib/request.ts`: cookie/CSRF; `web/lib/api.ts`: ApiError, GET tekrarları, mutasyon tekrarı yok | Ortak mutasyon kimliği ve hata kodu bu mevcut istemci sınırına eklenmeli. `requestJson` kullanan yönetim/arşiv yolları da kapsanmalı. |
| Veri modelleri | `types/index.ts`: Task, Document, Decision, Milestone; Task/Document updatedDate, Decision date; kalıcı revision yok | `updatedDate` dakika hassasiyetinde ve her değişimde güncellenmiyor. Güvenilir kayıt sürümü yerine kullanılamaz. |
| Pano verisi | `web/App.tsx:420,664`: görevleri esas olarak `apiClient.search()` sonucundan kuruyor | Revision yalnız task-detail veya `/tasks` yanıtına eklenirse pano yazıları korunmaz; search snapshot da kapsanmalı. |
| Editörler | `TaskDetailsModal.tsx:535`: kirli alanı koruyup form baseline'ını yeniliyor. DocumentationDetail/DecisionDetail kendi ham metnini ve başlangıç içeriğini tutuyor. | Düzenleme başlangıcının revision'ı ayrı tutulmalı; arka plan yanıtı kirli taslağın sürümünü ilerletemez. |
| Hata sınıflaması | `web/lib/api.ts:133`: her 409 kimlik belirsizliği sayılıyor. App task deep-link de 409'u aynı yorumluyor. | Kimlik, kilit, sürüm ve idempotency çakışmaları makine okunur kodlarla ayrılmalı. |
| Canlı yayın | `index.ts:364`, `content-store.ts:363,421`: izleyici ve doğrudan upsert/transition yayınları; 75ms WS birleştirmesi | Yalnız HTTP yanıtını bekletmek yeterli değil. Hazırlanan/kısmi içerik cache, arama veya WS üzerinden başarı gibi görünmemeli. |

## 2. Aşama sınırı ve mevcut mutasyon envanteri

A-04 önerisi: mevcut merkezi yazıların sürüm/tekilleştirme/tarihçe/kurtarma altyapısı; ilk envanter; yetkili tarihçe ve işlem sonucu okuması; gerekli çakışma/kurtarma bildirimi. A-05 sunucu bağlantılı agent kimliği ve sürekli dış değişiklik algılama; A-06 geçmiş sayfaları, tarih filtreleri, benden beklenenler ve inceleme/kabul iş akışları. A-04 tarihçe katmanının yalnız kaydettiği gerçek olaylar için türleri bulunacak; gelecek aşama adına kullanılmayan endpoint/alan eklenmeyecek.

`P = /api/projects/:projectId` olmak üzere bugünkü yollar:

| Mevcut işlem ailesi | Mevcut yollar/gövde | Etkilenen frontend | Planlanan A-04 işi |
|---|---|---|---|
| Görev/draft oluşturma ve düzenleme | POST `P/tasks`, PUT `P/tasks/:id`, JSON; draft aynı task modelinden geçiyor | TaskDetailsModal, App, DraftsList | İşlem anahtarı; düzenlemede başlangıç revision'ı; aynı parser/allocator |
| Belge | POST `P/docs`, PUT `P/docs/:id`; `{content,title?,path?,type?,tags?}` | DocumentationDetail | İçerik, başlık ve yol aynı işlem; sürüm ve sonuç korunur |
| Karar | POST `P/decisions` `{title}`; PUT `P/decisions/:id` **text/plain** | DecisionDetail | Ham Markdown gövdesi korunur; revision ve anahtar header ile taşınır; güncel decisionsManage kontrolü |
| Yaşam döngüsü | Üç türde POST archive/restore, DELETE archived kayıt; tasks/demote, drafts/promote | App, RecordArchive, ArchivePage, DraftsList | Taşıma/silme/referans temizliği tek mantıksal işlemde kaydedilir |
| Pano | POST `P/tasks/reorder`, `P/tasks/move` | Board, App, MilestonesPage | Seçilen kayıt sürümleri; sıralama/rebalance için koleksiyon sürümü; mevcut changedTasks/failures anlamı |
| Toplu bakım | GET cleanup önizleme, POST cleanup/execute; GET/POST tasks/duplicates | CleanupModal, DuplicateIdRepairModal | Önizleme fingerprint'i ve işlem anahtarı; gerçek değişiklik kümesi; yan etki listeleri korunur |
| Milestone/config | Milestone POST/PUT/DELETE/archive; PUT `P/config` | MilestonesPage, Settings | Çok dosyalı etkiler ve izinli config alanları; sürüm taşıma |
| Merkezi yönetim | `/api/admin/users`, reset-password, proje members, folder-areas, tracking; POST `/api/projects` | AdminUsers, ProjectMembers, AdminProjectRegistration, ProjectRegistration | DB mutasyonu ile aynı transaction'da güvenli audit; güncel yetki; anahtar tekilleştirmesi |

`/api/auth/login/logout/activity` için HTTP yanıtı tekrar oynatma uygulanmaz. Parola taşıyan user-create/reset/password işlemlerinde A-02 davranışının ve yalnız güvenli transaction içi audit kaydının korunması önerilir; bu işlemler A-04 idempotent yanıt saklama sözleşmesine alınmaz. Parolanın basit request hash'i de kalıcı kayda yazılmaz. Bu kapsam ayrımı 9. bölümde onaylandı. `POST P/init` merkezi modda zaten kapalıdır. Önizleme POST'ları yazma olayı üretmez. Yerel `backlog browser`, doğrudan CLI ve MCP sözleşmeleri ayrıca regresyonla korunur.

## 3. Önerilen yazma sınırı

Tek akış: **yetki → proje sırası → mevcut kayıt kilitleri → güncel okuma/sürüm kontrolü → mevcut semantiklerle değişiklik kümesini hazırlama → SQLite'ta kalıcı niyet → dosyaları uygulama → sonuç+tarihçeyi kesinleştirme → cache/WS ve HTTP sonucu**.

- Yeni küçük `src/server/mutations.ts` merkezi işlem yaşam döngüsünü yönetir; `mutation-store.ts` mevcut ServerDatabase üzerinden kalıcı işlemi/tarihçeyi okur ve yazar. İş kuralları Core'da kalır.
- `Core` ve `FileSystem` içinde isteğe bağlı hazırlama/uygulama sınırı: işlem tamamlanmadan önce tüm yazma, taşıma ve silmelerin gerçek önceki/sonraki baytları, yolları ve beklenen yoklukları bilinir. Mevcut fonksiyonlar ortak hazırlamayı çağırır; merkezi mod niyeti kaydettikten sonra aynı sonucu uygular. Yerel yol aynı ortak hazırlamayı doğrudan uygular.
- Önerilen tek yeni ortak tip modülü `src/server/mutation-types.ts`; ortak fiziksel değişiklik kümesi tipi gerekiyorsa `src/file-system` altında tek modül. Büyük bir sanal dosya sistemi veya ikinci domain modeli kapsamda değildir.
- Kilit sırası proje sırası → mevcut sıralı task/draft/allocator kilitleri. SQLite transaction'ında async dosya okuma, kilit bekleme veya ağ çağrısı tutulmaz. Yetki beklemeden sonra ve kalıcı niyetten hemen önce yeniden doğrulanır.
- İçerik/yol değişikliği, allocator sonucu ve HTTP sonucu yeniden yürütülerek tahmin edilmez; kaydedilmiş işlem planından gelir. Cache güncelleme ve WS bildirimi nihai kayıtla birlikte açılır; watcher bildirimi ikinci tarihçe olayı üretmez.
- Dosya kurulumu mevcut no-replace ve izinli gerçek yol kurallarını korur; desteklenen Linux ortamında dayanıklı geçici dosya/rename ve dizin senkronizasyonu gereksinimleri failpoint testleriyle kanıtlanır. Birden çok dosyanın dış okuyuculara aynı anda görünür olduğu iddia edilmez.

Bu Core/FileSystem değişikliği mevcut yapıdan gerekli ayrılıktır: HTTP handler sonunda tarihçe eklemek, dosya yazıldıktan sonra süreç ölürse niyeti kaybettirir; ayrıca doğrudan fs kullanan yardımcıları kapsamaz. Değişimin etkisi CLI/MCP/browser ortak koduna uzanır; mevcut atomik düzenleme, allocator, arşiv, belge/karar ve pano testleri zorunlu regresyon kapısıdır.

## 4. Önerilen veri ve API sözleşmesi

### Kalıcı veriler

Aynı `server.sqlite` içinde önerilen eklemeli v4:

- `records`: `record_key`, `project_id`, `kind`, `visible_id`, `path`, `lifecycle`, `revision`. Görünen TASK/DOC/DECISION kimliği ve Markdown değişmez. İç record_key arşiv/geri getirme, promote/demote ve açık kimlik onarımında korunur; gözlenen silip yeniden oluşturma yeni kimlik alır. Gözlenemeyen silip aynı baytlarla yaratma kesin ayırt edilebilir gibi sunulmaz.
- `operations`: `operation_id`, kapsam, doğrulanmış aktör veya bilinmeyen aktör, `source`, `request_hash`, `state`, UTC zamanlar, güvenli sonuç/status. İstemcinin UUID işlem anahtarı aynı zamanda benzersiz operation_id'dir; ayrı idempotency_key kolonu gerekmez. Anahtar aktör ve kapsamla bağlanır; başka aktör/kapsamdaki anahtar genel çatışma yanıtı verir, mevcut sonucu açıklamaz. Kullanıcı alanı istek gövdesinden alınmaz.
- `operation_files`: işlem sırası, record_key, kaynak/hedef yol, önceki/sonraki hash ve baytlar, beklenen yokluk/taşıma/silme. Kurtarma için yalnız hash yeterli değildir. Kimlik tahsis sonucu da niyette bulunur.
- `history_events`: `event_id`, benzersiz `operation_id`, proje veya yönetim kapsamı, kaynak, doğrulanabilir aktör, olay zamanı/algılanma zamanı, eylem ve bütün kayıt değişiklikleri. **Öneri: bir mantıksal işlem bir olay zarfı; zarf içinde birden fazla kayıt değişikliği.** No-op sonucu saklanabilir, içerik değişikliği olayı üretilmez. Normal uygulama yüzeyleri eski olayları güncellemez/silmez.

Parola, parola hash'i, oturum token'ı, CSRF ve Set-Cookie audit/tekrar yanıtına yazılmaz. Yönetim olayının before/after alanları izin listesiyle seçilir. `commentAuthor` gibi serbest metin, doğrulanmış olay aktörü yerine kullanılamaz. Başlangıç envanteri kaynak tarihlerini korur; tamamlanma zamanı üretilmez. Gün içeren tarih gün olarak kalır; yeni olaylar UTC, insan görünümü Europe/Istanbul.

### Mevcut yanıtlara eklenecek alanlar

- Merkezi kayıt DTO'larında `recordKey` ve opak `revision`; Task/Document/Decision/Milestone alanlarına ek metaveri. YAML/frontmatter'a yazılmaz. Sürüm, kullanıcıya verilen içerikle **aynı okuma snapshot'ından** hesaplanır; sonradan ayrı bir dosya hash'i okunarak iliştirilmez.
- Liste, arşiv, draft ve search sonucundaki kayıtlarda aynı metaveri; `GET P/search` ve `GET P/tasks` için `X-Backlog-Tasks-Revision` ile görev koleksiyonu/sıralama snapshot'ı. Var olan JSON dizi şekli korunur; istemci header'ı sonuçla birlikte açıkça taşır, gizli global sürüm kullanmaz.
- `GET P/config` için `ETag`; `GET P` yanıtında `writeState: ready | recovery_required` ve gerekirse erişilebilir `pendingOperationId`. Mevcut permission bitleri yetkiyi, writeState kullanılabilirliği anlatır.
- Başarılı mutasyon yanıtında `X-Backlog-Operation-Id`; tek kayıt yanıtında `ETag`. Gövdesi `{success:true}` olan karar/lifecycle yanıtı bu header'larla sürüm/işlem bilgisini taşır. Çok kayıtlı mevcut `changedTasks`, `failures`, `cleanedTaskIds` vb. alanlar korunur.

### Mevcut yazma isteklerine eklenecek bilgiler

- Merkezi içerik ve parola taşımayan yönetim mutasyonlarında UUID `Idempotency-Key`; bu aynı zamanda operationId'dir. Tekrar gönderimde aynı mantıksal işlem aynı anahtarı kullanır. Oturum yenilemesi anahtarı değiştirmez; başka hesap aynı sonucu okuyamaz.
- Tek kayıt yazma/taşıma/silmede `If-Match: <revision>`; creates için mevcut kayıt sürümü gerekmez. Pano bulk payload'ında `expectedRevisions: { [recordKey]: revision }`; reorder ayrıca görülen koleksiyon sürümünü `If-Match` ile gönderir. Türetilen referans/ordinal etkilerinin tüm dosyaları sunucuda yeniden okunur ve uygulama öncesi doğrulanır.
- Önizleme fingerprint'leri korunur. Config ETag ile korunur. Yönetim kullanıcı/üyelik/alan/tracking snapshot'larına aynı opak revision sözleşmesi uygulanır; parola endpointlerinin özel oturum davranışı değişmez.
- Sürüm eksik: `428 PRECONDITION_REQUIRED`. Eski sürüm: `409 REVISION_CONFLICT`. Kimlik belirsizliği: `409 AMBIGUOUS_ID`; kilit çakışması: `409 WRITE_LOCKED`; aynı anahtar farklı istek: `409 IDEMPOTENCY_KEY_REUSED`; süren işlem: `409 OPERATION_IN_PROGRESS`; tamamen uygulanmamış eski niyet: `409 OPERATION_NOT_APPLIED`; ayrı kurtarma olayıyla çözülmüş eski niyet: `409 OPERATION_RESOLVED` ve `resolvedBy`; kurtarma bekleyen proje: `503 RECOVERY_REQUIRED`.
- Hata gövdesi `{error, code, operationId?, recordKey?, expectedRevision?, currentRevision?}`. Yetki kontrolünden önce kayıt/işlem bilgisi açıklanmaz. Mevcut `ApiError.code` statusText okuyor; sunucunun `code` alanını okuyacak. İki hata sınıfını geniş çaplı yeniden yazmak yerine ortak hata-payload tipi kullanılır.
- Aynı anahtar+aynı istek tamamlanmışsa kayıtlı güvenli sonuç tekrar verilir; işlem yeniden uygulanmaz. Request hash yöntem+kanonik rota+anlamlı gövde+sürüm önkoşullarını kapsar; raw karar gövdesi bayt düzeyinde korunur, cookie/CSRF hash'e dahil edilmez.

### Yeni okuma endpointleri ve kanonik CLI

| Önerilen yeni yüzey | Sonuç/erişim | Kullanan |
|---|---|---|
| GET `P/history?recordKey=&kind=&cursor=&limit=` | `{items: HistoryEvent[], nextCursor}`; mevcut proje okuma yetkisi, yalnız proje içerik olayları | A-04 kabul testleri; A-06 geçmiş UI |
| GET `/api/operations/:operationId` | `{operationId,state,result?,error?}`; doğrulanmış işlem sahibi ve güncel proje/admin erişimi | Kayıp yanıt sonrası bütün merkezi yazılar, proje kaydı dahil |
| GET `/api/admin/history?scope=&recordKey=&kind=&cursor=&limit=` | Güvenli yönetim olayları, admin | Kanonik CLI ile aynı scope/filtre/sayfalama sorgusu |
| `server --data-dir D history list [--project ID] [--record-key KEY] --json` | schemaVersion 1; metin çıktısı da var | İnsan/yerel işletim |
| `server --data-dir D operation view OP --json` | Güvenli işlem ve kurtarma tanısı | İnsan/yerel işletim |
| `server --data-dir D recovery list/view ...` | Yazmasız rapor, etkilenen dosyalar ve fingerprint | İnsan/yerel işletim |
| `server --data-dir D recovery resolve OP --accept-observed --expected-fingerprint HASH` | Onaylanan mevcut gözlemi ayrı kurtarma olayıyla kaydet; ilk işlemi tamamlandı sayma | **Onaylanan**, önizlemeye bağlı CLI işlemi |

İşlem sorgusunda önerilen iki ayrı proje/admin GET yolu, normal kullanıcının henüz proje kimliği bulunmayan kayıt işleminin sonucunu da sorgulayabilmesi için tek sahiplik denetimli `/api/operations/:operationId` yolunda birleştirildi. Proje kapsamlı işlemde güncel üyelik/takip, yönetimde güncel admin yetkisi ayrıca aranır; kayıt işlemi kullanıcı kimliğine bağlanır. Bu sadeleştirme olay/kurtarma/aşama kararlarını değiştirmez.

A-04'te ayrı history yazma/silme endpointi, yeni görev CRUD endpoint ailesi veya tam geçmiş ekranı önerilmiyor. Yönetim audit olayları ve fiziksel kurtarma yolları yalnız admin/yerel işletim yüzeyindedir; normal proje geçmişi üyelik/klasör alanı veya özel sunucu yolu bilgisi açıklamaz. Doğrulama/kullanıcı kabulü için yeni POST endpointi, yetki ve sürüm kapsamı kararı verilmeden eklenmeyecek; bunların A-06 iş akışına ayrılması 9. bölümde onaylandı.

## 5. Kesinti ve dış yazıcı sınırı — onaylanan karar

| Başlangıçta kalıcı niyet ve dosyaların gözlenen durumu | Önerilen sonuç |
|---|---|
| Niyet var; tüm kaynak/hedefler kaydedilen önceki durumla aynı | `not_applied`; kendiliğinden yeniden çalıştırma yok; aynı anahtarda bu sonuç |
| Tam değişiklik planı var; tüm kaynak/hedefler beklenen son durumla aynı | Kaydedilmiş sonuç ve tek olay zarfını idempotent kesinleştir |
| Dosyaların bir bölümü önceki, bir bölümü sonraki; beklenmeyen bayt/yol veya okunamayan dosya | `recovery_required`; ilgili projenin merkezi yazıları kapanır; kanıt korunur; otomatik replay/rollback yok |
| Sonuç+tarihçe kesinleşmiş; istemci yanıtı kaybetmiş | Aynı anahtar ve yetkili işlem sorgusu aynı sonucu verir |
| Finalize sonrası cache/WS yayını yarıda kalmış | Disk+kesinleşmiş kayıt yeniden yüklenir; ikinci tarihçe olayı üretilmez |

Kurtarma taraması HTTP yazıları kabul edilmeden önce çalışır. Ayrı bir projedeki sorun sağlıklı projeyi kapatmaz. Kurtarma raporu yanlış biçimli Markdown'ı silinmiş/tamamlanmış gibi yorumlamaz. İçerik okuması güvenli yapılabiliyorsa proje salt okunur açılır ve kısa bir uyarı gösterilir. `accept-observed` sırasında güncel fingerprint, geçerli parser/kimlikler ve gerçek yol sınırı tekrar doğrulanır; okunamayan/belirsiz veri veya çakışan çözülmemiş işlem varken yazma engeli kalkmaz. Eski niyet, bayt kanıtları ve kısmi sonuç korunur.

İlk sürüm tek Linux sunucu/tek uygulama örneği varsayımındadır. Sunucuyla aynı kilitleri kullanmayan dış yazıcılara karşı tam atomiklik vaat edilemez. Uygulama öncesi snapshot denetimi gözlenen değişikliği yakalar; denetim ile fiziksel yazma arasındaki dış müdahale riski işletim sözleşmesinde açık yazılır. A-05 watcher/başlangıç/periyodik karşılaştırması bu sınırı gözlenebilir kılar. Dış değişiklik doğrulanmış kullanıcıya mal edilmez.

## 6. Frontend uygulama kalıbı

- `request.ts` cookie/CSRF ve 401 sahipliğinin tek kaynağı kalır; otomatik mutasyon tekrarları eklenmez. Kullanıcının tekrar denemesi aynı anahtarı taşır. Belirsiz ağ sonucunda önce operation endpointi okunur; sonucu bilinmeyen işlem yeni anahtarla çoğaltılmaz. İstemci isteği göndermeden UUID üretir; operationId ve Idempotency-Key aynı değerdir, kayıp yanıt sorgusu bu kimlikle yapılır. DB ve API her okumada anahtarın aktör/kapsam sahipliğini denetler.
- TaskDetailsModal ve iki Markdown editörü düzenleme başında `{recordKey,revision}` saklar. Kirli editörde WS/oturum yenilemesi bu başlangıcı ilerletmez. Sunucu snapshot'ı ve kullanıcı taslağı ayrı kalır; çakışmada taslak, hata ve ayrılma koruması korunur. Güncel içeriğe geçiş metin kaybı gerektiriyorsa mevcut discard onayı kullanılır; otomatik üzerine yazma yapılmaz.
- Yeni ortak `MutationConflictNotice.tsx` yalnız sürüm çakışması, güncel içeriği açma ve taslağı koruma eylemleri için kullanılabilir. Yeni ortak `ProjectWriteNotice.tsx` kurtarma nedeniyle salt okunur durumu gösterir; mevcut Layout/AuthContext verisine bağlanır. Başlık altına tekrarlı açıklama eklenmez.
- Board drag/drop, TaskDetailsModal inline alan/AC/DoD/comment, MilestonesPage, DraftsList, RecordArchive, ArchivePage, CleanupModal, DuplicateIdRepairModal, Settings ve yönetim formları mutasyon envanterine göre bağlanır. Yalnız Kaydet düğmesini değiştirmek yeterli değildir.
- Pano iyimser değişikliği çakışmada geri alınır veya güncel snapshot ile düzeltilir; açık editör taslağı korunur. AC/DoD kutusunu işaretlemek doğrulama veya kullanıcı kabulü kanıtı oluşturmaz.
- ApiError/HttpError ayrımı, mevcut legacy lifecycle failure alanları ve `isAmbiguousIdConflict` mevcut tüketicileriyle birlikte güncellenir. Yerel browser'da server revision eksikliği merkezi önkoşul hatasına dönüşmez.

## 7. Görev yapısı ve paralel çalışma

Görev kimlikleri CLI allocator ile atanır. Aşağıdaki A-04.x adları aşama adlarıdır, önceden ayrılmış task kimliği değildir. Her uygulama görevi sözleşme/ürün kapısı tamamlanmadan To Do kalır; şu an yalnız araştırma görevi aktiftir.

| İş | Teslim ve dosya sahipliği | Başlama bağımlılığı | Backend–frontend entegrasyonu |
|---|---|---|---|
| A-04.1 | Bu araştırma, mutasyon matrisi ve karar/sözleşme kaydı; doc-6/doc-5 | BACK-795–798 | Header/DTO/hata/kurtarma sözleşmesini bütün işlere verir |
| A-04.2 | `database.ts`, yeni `mutation-store.ts`, depolama ve kurtarma durum mantığı, store testleri | A-04.1 | Frontend'in operation/history/writeState verisinin kaynağı; A-04.3/6 ile ortak tip sözleşmesi |
| A-04.3 | Core/FileSystem hazırlama-uygulama, tek kayıt ve lifecycle mutasyonları, `index.ts`, yayın engeli | A-04.1 | A-04.5'in revision/hata/header sözleşmesini uygular; A-04.2 depolamasını kullanır |
| A-04.4 | Çok dosyalı pano, cleanup, repair, milestone/config yolları; A-04.3'ün Core/index dosyalarını devralır | A-04.3 | A-04.5'in bulk revision ve mevcut sonuçları; store sözleşmesi |
| A-04.5 | `src/web/**`, ilgili DOM/API testleri; iki yeni küçük ortak notice bileşeni | A-04.1 | Önce onaylı kontratla test doubles; kapanış A-04.2/3/4/6 gerçek yanıtlarına bağlı |
| A-04.6 | `central.ts`, `auth-store.ts`, `project-store.ts`, `commands/server.ts`, ortak `mutation-types.ts`, runtime `mutations.ts`, README | A-04.1 | A-04.2/3'ü bağlar; yeni history/operation okuması, admin audit, recovery CLI, UI writeState |
| A-04.7 | Gerçek süreç-kesme/yeniden başlatma, HTTP/Chromium/CLI kabulü, nihai kanıt ve devir | A-04.2/4/5/6 | Test doubles yerine birleşmiş backend–frontend sözleşmesini doğrular |

Üç alt ajan için önerilen sıra:

1. A-04.1 kararı kullanıcıyla kesinleşir. Ana ajan A-04.6 kapsamında ortak tip ve çağrı imzalarını tek başına yerleştirir; dosya sahipliği kaydedilir.
2. Alt ajan 1 A-04.2; alt ajan 2 A-04.3 ardından A-04.4; alt ajan 3 A-04.5. Ana ajan A-04.6 ve entegrasyonu yürütür. TypeScript ortak tip dosyası tek sahibindedir. Başlama bağımlılığı ile nihai entegrasyon bağımlılığı aynı şey değildir; bağımsız taraf onaylı kontratla başlayabilir, gerçek karşı taraf bitmeden kabul edilmez.
3. Core/index dosyalarında A-04.3 ve A-04.4 aynı anda çalışmaz. UI/src/web tek sahibindedir. `content-store.ts` yayın sınırı A-04.3 sahibindedir. Test altyapısı paylaşımları için dosya bazında sahip değişimi açık yapılır.
4. Uygulama bitince boşalan ajanlar başka sahibin değişikliklerini inceler. A-04.7 ana ajan tarafından birleştirilmiş sabit kaynakta çalıştırılır. Tam test, build ve Chromium aynı anda kaynak değişirken kabul kanıtı sayılmaz.

Bu oturumda alt ajan başlatılmadı. Gelecek oturumda izin verilen üç alt ajan sınırı, bütün işleri aynı anda açma zorunluluğu değildir.

## 8. Doğrulama ve değişim etkisi

- v0/v2/v3 → v4 yükseltme/rollback; mevcut hesap, oturum, üyelik, alan ve proje kimliği korunur; salt okunur komutlar dosya/şema oluşturmaz.
- Aynı kayıt için iki gerçek HTTP istemcisi; eski revision reddi ve disk/tarihçe değişmezliği; farklı projelerde aynı TASK-1; izin ve takip iptali bekleme sırasında da etkili.
- Aynı anahtarın eşzamanlı ve sonradan aynı/farklı gövdeyle gönderilmesi; kayıp HTTP yanıtı; farklı hesapla replay reddi; no-op olay sayısı.
- Niyet kaydından önce/sonra, her fiziksel etkiden sonra, finalize öncesi/sonrası gerçek alt süreç sonlandırılır ve yeni sunucu süreci başlatılır. Dosyalar+SQLite olay sayısı+işlem sonucu incelenir. Sadece mock exception testi kesinti kanıtı sayılmaz.
- Reorder rebalance, kısmen geçerli bulk move, cleanup preview, silme/referans temizliği, doc rename/path, draft promote/demote, milestone cascade ve duplicate repair; mevcut başarı/partial failure anlamları.
- Watcher bildirimi veya erken cache upsert kalıcı niyeti ikinci olaya dönüştürmez ve yarım sonucu yayınlamaz. Kaynak symlink/bozuk Markdown/okunamama kontrolleri korunur.
- Gerçek Chromium'da iki oturum, üç editör, pano, arşiv, kayıp yanıt, tekrar deneme, oturum süresi dolması, aynı/farklı hesap, kirli gezinme ve kurtarma bildirimi.
- Mevcut anlamlı kapılar: `atomic-task-edit`, `server-project-permissions`, `server-documents-endpoint`, `server-reorder-publication`, `server-move-tasks-endpoint`, `web-auth`, `web-task-details-modal-unsaved-navigation`, belge/karar ve milestone testleri. Son kaynakta tam Bun, tip, yazmasız Biome, build, derlenmiş CLI/web/MCP smoke; atlanan platform testleri açık kaydedilir.
- Bu planlama çalışmasında kaynak kodu değişmedi, uygulama testleri yeniden koşulmadı. Kayıtlar CLI üzerinden okunarak ve `git diff --check` ile kontrol edilir.

## 9. Onaylanan ürün kararları — 22 Ekim 2026

Kullanıcı aşağıdaki dört kararı açıkça onayladı:

1. **Olay sayımı:** Bir mantıksal işlem bir olay zarfı üretir; çoklu dosya/kayıt etkileri zarf içindeki değişikliklerdir. Mevcut bulk move kısmi başarı sözleşmesi korunur. Fiziksel kesinti kısmi sonucu ayrıca raporlanır.
2. **Kurtarma:** Tamamen önceki durumda işlem uygulanmadı sayılır; tamamen sonraki durumda kaydedilmiş sonuç kesinleştirilir. Karışık/bilinmeyen durumda proje yazıları durur ve admin fingerprint'li CLI incelemesi yapar. Kısmi işlem otomatik oynatılmaz veya geri alınmaz. `accept-observed` ilk işlemi başarılı saymaz ve ayrı kurtarma olayı bırakır.
3. **Dış yazıcı garantisi:** İlk sürüm merkezi işlemler arasında kayıp güncellemeyi engeller. Ortak kilide katılmayan dış yazıcılara tam atomiklik garantisi verilmez. A-05 dış değişiklik algılama takibiyle gözlenebilen olayları ekler.
4. **Aşama sınırı:** A-04 mevcut merkezi içerik/milestone/config ve parola taşımayan yönetim mutasyonlarını tekilleştirme kapsamına alır. Parola taşıyan hesap işlemleri A-02 davranışı ve güvenli audit ile sınırlıdır. Yeni doğrulama/kullanıcı kabulü yazma iş akışı, yetkileri ve kod sürümü bağlamı A-06'da kararlaştırılır. Done/AC/DoD işaretlerinden doğrulama veya insan kabulü çıkarılmaz.

Bu kararlar BACK-800–805 uygulama planlarının ürün sınırıdır. Teknik sözleşme uygulama sırasında bu sınıra ve mevcut CLI/MCP/tarayıcı davranışına göre doğrulanır.

## 10. CLI ile oluşturulan görevler

| Görev | Aşama | 22 Ekim son durum | Başlama bağımlılığı |
|---|---|---|---|
| BACK-799 | A-04.1 sözleşme ve karar incelemesi | Done, @codex; ürün kararları onaylandı | BACK-795, BACK-796, BACK-797, BACK-798 |
| BACK-800 | A-04.2 kalıcı depo | Done, @codex-store | BACK-799 |
| BACK-801 | A-04.3 ortak kayıt yazımı | Done, @codex-core | BACK-799 |
| BACK-802 | A-04.4 çok dosyalı işlemler | Done, @codex-core ve @codex | BACK-801 |
| BACK-803 | A-04.5 frontend | Done, @codex-web | BACK-799 |
| BACK-804 | A-04.6 merkezi runtime/API/CLI | Done, @codex | BACK-799 |
| BACK-805 | A-04.7 birleşmiş kabul | Done, @codex | BACK-800, BACK-802, BACK-803, BACK-804 |

BACK-799 araştırma ve karar incelemesi tamamlandı. Uygulama görevleri görevlendirilirken seçilen uygulayıcı mevcut kod ve bu onaylı sözleşmeyle güncel yürütme planını CLI görevine yazar. Kapsam, modül, kontrat ve bağımlılıklar görev açıklamalarında ve bu belgede korunur.


## 11. Uygulama sırasında netleştirilen teknik sözleşme

- Proje kimliği henüz olmayan kayıt işlemi `registration` scope kullanır. Tek `/api/operations/:operationId` yolu bütün yazılar için sahiplik ve güncel erişimi denetler. Registration sonucu için de güncel proje üyeliği/takibi aranır.
- Yönetim geçmişi `admin` ve `registration` scope ile sorgulanır; özel yönetim bilgileri proje içerik geçmişine karışmaz. Folder-area upsert yalnız oluşturur veya aynı alanı döndürür, bu yüzden key ister; var olan kaydı değiştiren/silen yönetim yazıları revision ister.
- Yeni fiziksel capture isteğe özel dosya etkilerini taşır; aktör/oturum global duruma alınmaz. Kaynak bytes ile bağlı sembol parser/Core/ContentStore boyunca taşınır ve JSON'a çıkmaz. Mevcut dosya/allocator kilitleri finalize veya abort'a kadar tutulur.
- Proje içerik okumaları da aynı proje sırasını kullanır; fiziksel yazı ile finalize arasındaki HTTP/cache/search/WS görünürlüğü açılmaz. Yetki niyet transaction'ının BEGIN beklemesinden sonra, ekleme öncesi yeniden denetlenir; aynı-key replay de güncel etkin işlem yetkisini denetler.
- `accept-observed` ayrı recovery operation/event üretir. Eski olay başarılı yapılmaz; `resolvedBy` bağı çözümün kaydını gösterir. Eski key tekrarında `409 OPERATION_RESOLVED` döner. Açık sunucu kalıcı çözümü görünce yazma engelini kaldırır ve proje handler'ını yeniden kurar. SIGKILL'den kalan ortak kilit tazeyken `409 WRITE_LOCKED` normaldir; kilit atlanmaz.
- Şifreli hesap isteklerinin audit hash'i parola baytlarından türetilmez. CLI aktörü bilinmiyor, source server-cli'dir. JSON zamanları UTC; yeni olayların insan CLI görünümü Europe/Istanbul'dur.
- BACK-802 dosya devri: ana ajan duplicate-task-repair.ts ve özel merkezi testler; @codex-core Core/FileSystem/index/milestone/config/pano/cleanup. Ana ajan BACK-804; @codex-store CLI/recovery/SIGKILL testlerine açık devirle katkı verir. Son kabul sabit kaynakta BACK-805 tarafından toplanır.

## Ek onaylı okuma kararı — 22 Ekim 2026

Kullanıcı ek kabul incelemesinde şu seçeneği onayladı: **Yeni yola yeni kimlik; dış olay tarihçesi A-05’te.** Merkezi süreç açıkken yerel CLI/MCP veya normal dosya değişikliğiyle sonradan gelen güvenli dosya yolu ilk okunurken kalıcı yeni recordKey alır; eşleşmeyen dış taşıma da bu aşamada yeni kimlik sayılır. Var olan kimlikler korunur. Bu türetilmiş kimlik eşlemesi sahte içerik olayı veya doğrulanmış aktör üretmez; ilk envanter tekrarlanmaz. Dış taşıma tanıma ve sürekli dış olay tarihçesi A-05 kapsamındadır. Pending/kurtarma durumunda yeni yol benimseme engeli ve gerçek yol/snapshot denetimi korunur. Mevcut pano/arama Markdown okuma döngüsünü503 ile durdurmak kabul edilen sınır değildir.

## 12. Tamamlanan uygulama ve kabul

BACK-799–805 Done. Yukarıdaki araştırma sırasında önerilen yüzeylerin uygulanan son sözleşmesi README'nin Server writes and history bölümünde; onaylanan dört ürün kararı bölüm9'dadır. Merkezi işlem/kayıt/tarihçe deposu, Core/FileSystem hazırlama, çok dosyalı pano/bakım, frontend çakışma ve sonuç akışları, API/CLI/audit ve gerçek süreç kurtarması birleştirildi. İzleyici yayınları da aynı guarded ham snapshot'ı taşır; normal yenileme sonrası sürümsüz kayıt üretilmez.

Son kaynak sabitken 3908 başarılı/13 atlanan/0 başarısız Bun testi (351 dosya), tip, depo kapsamındaki yazmasız Biome, build ve derlenmiş smoke geçti. Gerçek Chromium 21 kontrol/0 işlenmemiş hata. TSX ayrı taraması eski HEAD tanılarını açık tutar, yeni tanı 0; ham tarama ve fark kapısı ayrıdır. Altı gerçek SIGKILL kesintisi ve ayrı exception testi birbirine karıştırılmadı. Kalıcı kabul eşlemesi/kaynak/test/günlük SHA-256: verification/server/a04-verification.json. Ayrıntılı devir doc-5.

Sadelik: tek SQLite/finalize, mevcut parser/serializer/allocator/kilitlerin ortak capture içinde kullanılması, watcher dahil tek ham snapshot okuyucusu, tek operation GET, ortak frontend request istemcisi ve mevcut envanterle recovery. Ek geçmiş CRUD veya A-05/A-06 iş akışı eklenmedi. Uygulama/kabul kayıtları 09e336fb28f28dcef9a94ac162666cfc5662a20b commit’iyle origin/tasks/server-a04-write-history dalına gönderildi; uzak baş eşitliği doğrulandı. Bu gönderimin kapanış metaverisi aynı dalda ayrı takip commit’iyle taşınır. Test edilen kaynak commit sonrasında değişmedi; son HEAD için Git esas alınır. /tmp ham kanıtları kalıcı yedek değildir.
