---
id: doc-5
title: Sunucu geliştirmesi devir notu
type: guide
created_date: '2026-10-20 12:17'
updated_date: '2026-10-23 06:00'
tags:
  - server
  - handoff
  - status
---
Bu not Backlog.md çoklu proje sunucusuna yeni sohbetten devam etmek içindir. A-00–A-04 ve BACK-799–805 tamamlandı; A-04 uygulama/kabul commit’i 09e336fb, Git kapanışı fc07f2ce ile origin/tasks/server-a04-write-history dalındadır. Kullanıcının görsel geri bildirimi üzerine BACK-806 mevcut frontend/tema bütünlüğü düzeltmesi tamamlandı. Güncel dal tasks/server-ui-consistency; taban fc07f2ced74c9aeec5615f469f5fb21b24d32648. BACK-806 uygulama/kabul commit’i 289bfc2dfa6c4d68b7ab2a9acfb7b40631ac47d6, origin/tasks/server-ui-consistency dalına gönderildi. Git teslim kaydı bu commit’i takip eder. Önce Git durumunu doğrula ve yerel çalışmayı koru.

## BACK-806 Git teslimi — 23 Ekim 2026

Kullanıcı commit ve push yapılmasını onayladı. Uygulama/kabul commit’i 289bfc2dfa6c4d68b7ab2a9acfb7b40631ac47d6, origin/tasks/server-ui-consistency dalına normal push ile gönderildi. Ön commit kancası geçti; 634 kaynak dosyası test edilen sürümle aynı kaldı. Kaynak özeti 747d58c4d5f5274b441f48341671aa454f5bf7cac131fd76f2ec07ad121bf0d7; binary ve üç ekran görüntüsünün SHA-256 özetleri de kabul raporuyla eşleşti. Önceki 446 web testi ve 23 gerçek Chromium kontrolünün kanıtları geçerlidir; kaynak değişmediği için testler tekrarlanmadı. Bu teslim kaydı ayrı bir takip commit’idir. A-05 başlatılmadı.

## BACK-806 — mevcut frontend ile sunucu ekranlarının bütünlüğü

Kullanıcı ilk Projects ekranını Finbee önizlemesindeki mevcut Backlog.md arayüzüyle karşılaştırıp varsayılan frontend ve akış üzerine özelleştirme istediğini yeniden belirtti. Proje içi App/Layout zaten mevcut panoyu kullanıyordu; global Projects/giriş/parola/Users sayfaları ayrı dar düzen ve tema kapsamıyla bırakılmıştı. Bu görsel eksiklik giderildi; A-05 başlamadı.

- Mevcut Layout ortak AppFrame içine alındı; global ServerLayout aynı Navigation/ThemeToggle ve çerçeveyi kullanır. Proje seçilmeden yalnız Workspace/Projects ve izinli Users gezinmesi vardır; sahte görev/proje sayaçları veya kayıtlar üretilmez.
- ThemeProvider main.tsx içinde AuthProvider üstündedir; giriş öncesi, zorunlu parola değişimi, Projects, Users ve proje içi ekranlar tek kaydedilmiş/sistem temasını kullanır. Mevcut proje panosu, Milestones, belge/karar ve düzenleyiciler kullanılır; rotalar/istek işleyicileri/yetkiler aynı akıştadır.
- 45 dosyada 446 web testi / 2800 beklenti / 0 hata geçti. 604 dosyada tip, varsayılan yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Değişen 19 TSX aynı kurallarla HEAD karşılaştırmasına alındı: mevcut 4 hata/31 uyarı, başlangıç 19 hata/31 uyarı; yeni tanı 0. Kalıtımlı borç temiz tarama sayılmadı.
- Ayrı native süreç ve geçici örnekle gerçek Chromium 23 kontrol / 0 runtime hatası: sistem/kayıtlı tema, login/parola/Projects, kirli kayıt formu, kayıt sonrası mevcut pano/Milestones/belge/karar, Users/parola ve 390px genişlikte akış. Gerçek Finbee veya kişisel sunucu veritabanı bağlanmadı/değişmedi.

Kalıcı kabul kaydı verification/server/back-806-ui.json; karşılaştırılabilir PNG'ler verification/server/back-806-projects-dark.png, back-806-projects-light.png ve back-806-project-milestones-dark.png. Ham kanıt /tmp/backlog-server-ui/ altındadır; kalıcı yedek değildir. Sadelik incelemesi ortak çerçeve/başlık/tema ve mevcut form işleyicilerini korudu; yeni backend, rota veya ikinci domain modeli eklenmedi. Groma yoktu; yönetilen dosya/manifesto değişmedi.

Doğrulanmış binary dist/backlog konumuna atomik olarak alındı; açık kullanıcı sunucusu yeniden başlatılmadı ve kişisel veri klasörüne dokunulmadı. Görünmesi için kullanıcı açık terminalde Ctrl+C ile durdurup aynı data-dir ve start komutuyla yeniden açmalıdır. Kullanıcı ve projeler aynı veri klasöründen korunur. Kullanıcı aynı veri klasörüyle uygulamayı yeniden başlatıp arayüzün açıldığını doğruladı. BACK-806 uygulama/kabul commit’i 289bfc2dfa6c4d68b7ab2a9acfb7b40631ac47d6, origin/tasks/server-ui-consistency dalına gönderildi.

## A-04 Git teslimi — 22 Ekim 2026

Kullanıcı commit ve push için açık onay verdi. Uygulama/kabul commit’i 09e336fb28f28dcef9a94ac162666cfc5662a20b, origin/tasks/server-a04-write-history dalına normal push ile gönderildi; git ls-remote eşitliği doğrulandı. Ön commit kancası geçti ve test edilen 632 dosyanın özeti commit sonrasında aynı kaldı: c53431ce1c370f25366f06cbad9215b5e084d99e2251d11735132b22406b126c. Bu teslim metaverisi ayrı kapanış commit’idir; uygulama kodunu değiştirmez. origin/server değiştirilmedi.

## Tamamlanan A-04 — ortak yazım, işlem sonucu ve tarihçe

Kullanıcının doc-6 bölüm 9'da onayladığı dört karar uygulandı. @codex-store BACK-800 deposunu ve açık dosya devriyle BACK-804 CLI/recovery/SIGKILL dilimini; @codex-core BACK-801/802 Core/FileSystem/pano/bakım dilimini; @codex-web BACK-803 web ve DOM dilimini tamamladı. Ana ajan @codex BACK-804 merkezi yürütücü/API/audit/README, BACK-802 duplicate repair dilimi ve BACK-805 birleşmiş kabul sahibidir. Tüm kabul ölçütleri ve DoD, CLI görevlerinde kanıta bağlandı.

Mevcut Core, parser, serializer, allocator, kilitler ve arayüzler kullanılır. Tek hazırlama/yazma yolu niyeti fiziksel dosyalardan önce, güvenli sonucu ve tek olay zarfını başarı/cache/search/WS yayınından önce kesinleştirir. Aynı ham dosya snapshot'ı DTO revision'ını taşır; izleyiciden gelen görev/belge/karar yenilemeleri de bu yolu kullanır. recordKey merkezi yaşam döngüsü ve açık kimlik onarımında korunur. Ek kullanıcı kararıyla, güvenle sonradan okunan yeni yerel yol yeni kimlik alır; eşleşmeyen dış taşıma da yeni kimlik sayılır. Bu eşleme sahte olay/aktör üretmez; dış taşıma tanıma ve dış olay tarihçesi A-05'tedir. Bulk partial success, config, milestone cascade, cleanup ve duplicate repair aynı sınırdadır.

Merkezi yazılarda UUID Idempotency-Key, mevcut kayıtta If-Match; pano bulk'ta recordKey ile expectedRevisions, reorder'da koleksiyon sürümü kullanılır. Sıra/replay ve SQLite BEGIN beklemesi sonrasında güncel aktör/izin tekrar denetlenir. Tek işlem okuma yolu GET /api/operations/:operationId; history proje/admin/registration kapsamlıdır. Yönetim audit'i mevcut SQLite transaction'ındadır; parola/hash/token/CSRF/Set-Cookie saklanmaz. Parola taşıyan istekler A-02 akışında kalır ve yalnız güvenli audit üretir.

Kesinti: tüm dosyalar önceki durumdaysa not_applied; sonraki durumdaysa saklanan sonuç ve olay kesinleşir; karışık/bilinmeyende yalnız ilgili proje yazmaya kapanır. Fingerprintli CLI accept-observed ayrı kurtarma olayı üretir, eski işlem başarısız kalır ve resolvedBy ile bağlanır. Açık sunucu bu çözümü görüp handler'ı yeniler; eski anahtar OPERATION_RESOLVED verir. SIGKILL'den kalan ortak dosya kilidi tazeyken WRITE_LOCKED korunur. Ortak kilide katılmayan dış yazıcılara tam atomiklik verilmez; sürekli dış olay/agent takibi A-05, doğrulama/kullanıcı kabul ekranları A-06'dır.

Sabit son kaynakta tam Bun: 3908 başarılı / 13 atlanan / 0 başarısız; 3921 test / 351 dosya / 19407 beklenti. Tip, depo kapsamındaki yazmasız Biome, native build, test CLI bundle ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol ve 0 işlenmemiş hata ile geçti. Gerçek alt süreçler altı noktada SIGKILL ile kesilip yeni süreçte disk/SQLite/olay/kurtarma durumu doğrulandı; exception testi bu sayıya katılmadı.

Normal Biome ayarı TSX'i kapsamıyor. Değişen TSX'ler aynı kuralları kalıtan geçici ayarla ayrıca tarandı: HEAD 171 hata/52 uyarı, son kaynak 166 hata/50 uyarı; yeni tanı 0. Eski biçim/erişilebilirlik borcu silinmedi veya temiz tarama gibi sunulmadı; ham tarama exit1 ve fark kapısı raporda ayrıdır. İlk tanı tam koşusunun 32 hatası yeni sözleşmeye uymayan test taklitleri/temizliği ve izleyici snapshot kusuruydu; düzeltilip final koşu yeniden yapıldı.

Kalıcı sonuç, kabul eşlemeleri, kaynak/test/günlük SHA-256 özetleri [a04-verification.json](../../../verification/server/a04-verification.json) içindedir. Son kaynak özeti c53431ce1c370f25366f06cbad9215b5e084d99e2251d11735132b22406b126c; derleme/testler/tarayıcı sonrası aynı kaldı. Ham günlükler /tmp/backlog-a04-final ve Chromium raporundaki geçici dizindedir; /tmp kalıcı yedek değildir. Başlangıç kayıt arşivi /tmp/backlog-a04-approved-start-records.tar.gz; SHA-256 7b402457c58ebb8bba8e1b69267243c0c8db43d4b7b07d95ed8c6b0004cc7ff4.

Sadelik incelemesi: aynı SQLite/BEGIN politikası ve tek finalize; mevcut Core/FS üzerinde ortak fiziksel plan ve guarded snapshot okuyucusu; tek operation okuma yolu; ortak frontend request/outcome istemcisi; recovery'de ayrı CRUD yerine mevcut envanter ve depo. Groma bulunamadı; tarama veya Groma dosyası değişikliği yapılmadı. Yalnız geçici Linux projeleri kullanıldı; gerçek proje/Finbee bağlanmadı, manifesto değiştirilmedi. Platform/PTY atlananları başarı sayılmadı. origin/server değiştirilmedi.

## A-04 hazırlığı — BACK-799–BACK-805 (22 Ekim 2026)

Kullanıcı plan öncesinde ilgili backend/frontend kodunun okunmasını; görevlerde mevcut mimari, API, model ve bileşen kalıplarının, etkilenen modüllerin, iki taraf arasındaki bağımlılıkların ve mevcut/önerilen ayrımının gösterilmesini istedi. Araştırma ve görevleme tamamlandı; kullanıcı 22 Ekim 2026'da dört ürün kararını onayladı ve üç alt ajanlı uygulama oturumunu başlattığını bildirdi.

[doc-6 kod incelemesi ve plan taslağı](<doc-6 - A-04-kod-incelemesi-ve-ortak-yazma-tarihçe-planı.md>) mutasyon envanteri, kaynak konumları, önerilen DTO/header/hata kodları, yeni history/operation API ve kanonik CLI, SQLite alanları, iki küçük UI bildirimi, fiziksel kesinti karar tablosu, dosya sahipliği ve üç alt ajan çalışma sırasını içerir. Bölüm 9'daki dört ürün kararı onaylandı; doc-4 kapsamı yalnız açık A-04/A-06 ayrımı ölçüsünde yorumlanır.

Somut kaynak bulguları: CentralServer mevcut BacklogServer/Core yolunu kullanıyor; görev kilitleri eski tarayıcı revision'ını denetlemiyor; belge/karar farklı yazma yollarında; pano search sonucundan kuruluyor; frontend her409'u kimlik belirsizliği sayıyor; TaskDetailsModal kirli alanları korurken baseline yeniliyor. Bulk/cleanup/repair/milestone/config ve yaşam döngüsü referans temizliği çok dosyalı olabilir. Kalıcı niyet için Core/FileSystem hazırlama–uygulama sınırı ve kesinleşmeye bağlı cache/WS yayını önerildi.

| Görev | Kapsam | Durum / başlama bağımlılığı |
|---|---|---|
| BACK-799 | A-04.1 araştırma ve sözleşme/ürün kararları | Done, @codex; dört karar onaylandı |
| BACK-800 | A-04.2 kalıcı işlem/tarihçe deposu | Done, @codex-store; BACK-799 |
| BACK-801 | A-04.3 Core/FileSystem ortak kayıt yazımı | Done, @codex-core; BACK-799 |
| BACK-802 | A-04.4 çok dosyalı pano/bakım/milestone/config | Done, @codex-core ve @codex; BACK-801 |
| BACK-803 | A-04.5 frontend sürüm/işlem sonucu | Done, @codex-web; BACK-799 |
| BACK-804 | A-04.6 merkezi runtime, API/CLI ve yönetim audit | Done, @codex; BACK-799 |
| BACK-805 | A-04.7 gerçek kesinti ve birleşmiş kabul | Done, @codex; BACK-800/802/803/804 |

Uygulama dağılımı: ana ajan BACK-804 ortak tip/runtime/API/CLI; alt ajan1 BACK-800, alt ajan2 BACK-801 ardından BACK-802, alt ajan3 BACK-803. BACK-799 kararı tamamlandı. Core/index sahipliği BACK-801→802 sıralıdır; frontend bütün web dosyalarının tek sahibidir. Backend–frontend kapanış bağımlılıkları her görevde ayrıca belirtilir. Her uygulayıcı koddan önce kendi CLI görevine güncel yürütme planını yazar.

Onaylanan dört karar: bir mantıksal işlem/tek olay zarfı; tamamen önceki durumda uygulanmadı, tamamen sonraki durumda kesinleştirme, karışık durumda yazma engeli ve fingerprintli CLI incelemesi; ortak kilit dışı yazıcılara tam atomiklik garantisi verilmemesi; A-04'te mevcut yazılar ve güvenli audit, yeni doğrulama/kullanıcı kabulünün A-06'ya ayrılması. Fingerprintli accept-observed ayrı kurtarma olayıdır ve ilk işlemi başarılı göstermez. BACK-799 kabul ölçütleri ve DoD kanıtla kapatıldı.

Başlangıç Git temizdi; A-03 yerel ve GitHub başı adb84179 ile eşitti. Yeni dal açılmadan önce /tmp/backlog-a04-plan-rl9fukci/start.tar.gz oluşturuldu; SHA-256 feb34babb05fc4a4548cf93c48379c49cdf64f14ad33e30f6b443d9674fe3aa0. Görev/dokümanlar standart CLI allocator ile oluşturuldu. Sandbox altında oluşturma kilidi EROFS verdi; gereken .git/backlog.md kilit erişimiyle CLI yeniden çalıştırıldı. Kimlik kilidi devre dışı bırakılmadı. Groma bulunamadı; kullanıcı açık kaynak incelemesi istediği için kod doğrudan okundu, Groma taraması/yönetilen dosya değişikliği yapılmadı.

BACK-799 kapanışında uygulama kaynakları değişmedi; testler yeniden çalıştırılmadı. CLI ile görev/bağımlılık okumaları ve git diff --check kayıt doğrulamasıdır; A-03 test sonuçları A-04 kabul kanıtı sayılmaz. Ham hazırlık dosyaları /tmp/backlog-a04-plan-rl9fukci/ altındadır; karar öncesi yerel kayıt anlık görüntüsü /tmp/backlog-a04-approved-start-records.tar.gz (SHA-256 7b402457c58ebb8bba8e1b69267243c0c8db43d4b7b07d95ed8c6b0004cc7ff4); kalıcı esas kayıtlar doc-6 ve BACK-799–805'tir. /tmp uzun süreli yedek değildir. Commit/push/merge yapılmadı; origin/server değiştirilmedi.

## Tamamlanan A-03 kabulü — BACK-795–BACK-798 (22 Ekim 2026)

Ana ajan @codex, @codex-areas BACK-796, @codex-binding BACK-797 ve @codex-registration-ui BACK-798 ile kullanıcının istediği üç paralel uygulamayı birleştirdi. Başlangıç Git temizdi ve uzak A-02 HEAD’i doğrulandı; kaynak yedeği /tmp/backlog-a03-8vr8jlkz/start.tar.gz (SHA-256 c18d04acbbdf63fc07e7c0421c8fc443df9dd18bc1c767f13a925cec9a66551b). Yeni dal tasks/server-a03-project-registration. Ortak sözleşme/dosya sahipliği verification/server/a03-contract.json.

- Yeni yüzeyler yalnız hazır proje önizleme/kayıt, kişisel klasör alanları ve takip yönetimidir. Seçicide kayıt formu; Users içinde alan/takip kontrolleri var. Görev/belge/karar, Markdown parser/okuyucular, arama ve pano mevcut uygulamadan kullanılır. Hazır standart/.backlog/özel klasör desteklenir; eksik yapı hata verir ve oluşturulmaz. Tekil bozuk kayıt ve kimlik çakışmaları görünür uyarıdır.
- Eklemeli v3 SQLite şeması, v0/v2 proje/hesap/oturum/üyelik verisini korur; okumalar yükseltmez. Farklı kullanıcı gerçek alanları çakışmaz. Alan iptali kayıt yetkisini kaldırır, üyeliği korur. Kayıt, güncel oturum/hesap/alan/gerçek yol ve çakışmayı işlem içinde denetler; standart üyeliği aynı işlemde oluşturur.
- Takip durumu kimlik/üyelikten ayrıdır. Durdurmada normal liste, API/sayfa ve canlı erişim kapanır; açmada klasör yeniden doğrulanır. CLI register/list/view korunur, preview/tracking ve folder-area list/set/remove eklendi; schemaVersion1 JSON. README tüm yeni CLI/API sözleşmelerini açıklar.
- Ortak okuyucu değişikliğinin gerekçesi, sonradan değişen veya kısa süreli dışa yönelmiş bağlantılardan önbellek/izleyiciye içerik girmesini engellemektir. Merkezi açılmış-dosya okuyucusu mevcut FileSystem/Core/ContentStore/config keşfi/izleyicisine isteğe bağlı bağlanır; yerel davranış korunur. Eski handler yolları, API sonrası ve WS gönderimleri de denetlenir. Yinelenen görev/arama/pano uygulaması yoktur.
- Bağımsız inceleme bulguları kapandı: eski v2/no-area okuması, yapılandırma keşfinde güvenli okuyucu, yetkisiz yolun varlık/tür bilgisi, SQLite kilidi beklenirken admin iptalinin DELETE içinde yeniden denetlenmesi ve özel kayıtlı projeyi içerik okumadan çakışmada engelleme. Chromium ayrıca kayıt sonrası eski beforeunload dinleyicisini buldu; ortak dinleyici güncel kirli-token kaydını kontrol ediyor. Eski tam koşu durduruldu, final kaynakla tekrarlandı; başarısız regresyon ve ham kanıt korundu.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti.

255 ilgili backend testi ve son56 UI/auth/seçici testi geçti; bunlar tam koşuyla toplanarak ayrı bir toplam gibi gösterilmez. Üç bağımsız inceleme açık engelleyici bırakmadı; final unload düzeltmesi de bağımsız56 testle doğrulandı. Makine okunur kabul eşlemeleri/kaynak ve günlük SHA-256 özetleri [a03-verification.json](../../../verification/server/a03-verification.json) içinde; ham kanıt /tmp/backlog-a03-8vr8jlkz/.

Sadelik: tek SQLite politikası, ortak alan/yol denetimi, mevcut veri ve arayüz akışları kullanıldı; central içindeki yinelenen async okunabilirlik denetimi ortak guard lehine kaldırıldı. Groma bulunamadı; tarama/yönetilen dosya değişikliği yapılmadı. Yalnız geçici Linux örnekleri kullanıldı, kaynak envanteri ve içerikleri değişmedi; Finbee/gerçek proje yok. Atlanan platform/PTY testleri geçmiş sayılmadı. /tmp kalıcı yedek değildir.

Git teslimi: uygulama ve kabul kanıtları 18e554082aa46057747685cf998e564d710935a1 commit’iyle origin/tasks/server-a03-project-registration dalına normal push ile gönderildi; git ls-remote eşitliği doğrulandı. BACK-795–BACK-798 Done; kabul/DoD kanıtları işaretli. Kapanış metaverisi aynı dalda ayrı takip commit’iyle gönderilir; son HEAD’i Git ve uzak dal üzerinden doğrula. origin/server değiştirilmedi.

## A-02 inceleme düzeltmeleri — BACK-794 (21 Ekim 2026)

Kullanıcı inceleme bulguları için sunulan planın uygulanmasını ve uygun düzeltmenin mevcut özellik dalına gönderilmesini onayladı. Ana ajan `@codex`, `codex-password`, `codex-web-tests` ve `codex-review` ile çalıştı. Başlangıç HEAD'i `8440e7b7475d404ff7cc15eb10f01616ef66ada3`; kaynak yedeği `/tmp/backlog-a02-review-fixes-69vcph7x/start.tar.gz`.

- Gecikmiş oturum success/error yanıtları, kimlik nesli ve iptal edilebilir istek sahipliğiyle denetleniyor; eski finally daha yeni isteği temizlemiyor. Logout, unmount ve StrictMode yarışları doğrulandı.
- Tek kirli editör kaydı AuthProvider dışında, router engeli router içinde. Bütün logout çağrıları aynı onayı kullanır; iptalde HTTP isteği yok, onayda tek istek var. Başarısız logout metni korur, zaten kapanmış oturumun 401 yanıtı yerel çıkışı tamamlar.
- Kesin kullanıcı kararı: kendi parola değiştirme işlemlerinin tamamında mevcut parola yeniden seçilemez. HTTP 400 ret sırasında parola/bayrak/oturumlar değişmez. Admin reset işlemi aynı davranışı korur.

| Kontrol | Sonuç |
|---|---|
| İlgili hesap/API/CLI grubu | 7 dosyada 129 başarılı, 0 başarısız, 0 atlanan; 787 beklenti |
| Tüm web/DOM grubu | 43 dosyada 437 başarılı, 0 başarısız, 0 atlanan; 2627 beklenti |
| Tip | 567 dosyada hata yok |
| Yazmasız Biome | Başarılı |
| Build ve derlenmiş CLI/web/MCP smoke | Başarılı |
| Gerçek Chromium | 19 başarılı kontrol; 0 işlenmemiş tarayıcı hatası |

[Son kaynak doğrulama raporu](../../../verification/server/a02-review-fixes.json) kaynak/kanıt SHA-256 değerlerini korur. Ham kanıtlar `/tmp/backlog-a02-review-fixes-69vcph7x/`. Asıl A-02 tam koşusu önceki commit'e aittir ve `a02-verification.json` içinde korunur; bu dar düzeltmede 329 dosyalık tam koşu tekrar yapılmadı. Browser hata/gecikme senaryoları sayfa fetch denetimiyle üretildi; gerçek giriş, CSRF, belge, süre dolması ve parola işlemleri derlenmiş sunucuda çalıştı.

Bağımsız inceleme engelleyici bulgu bırakmadı. Groma yoktu; tarama veya yönettiği dosyalarda değişiklik yapılmadı. Standart CLI görev oluşturma kilidi ve localhost/alt süreç testleri gereken sandbox izinleriyle çalıştırıldı. Varsayılan SSH, sistem proxy yapılandırmasının sahiplik/izin denetiminde reddedildi; sistem dosyasına dokunmadan `git -c core.sshCommand='ssh -F /home/vuralbayrakli/.ssh/config' ...` ile origin okuması başarılı oldu.

Git teslimi: uygulama düzeltmesi `28c9cd5c86ca529733fc880bf4c462160e6f8f44` commit’iyle `origin/tasks/server-a02-accounts-authorization` dalına gönderildi; `git ls-remote` ile uzak HEAD eşitliği doğrulandı. BACK-794 Done; dört kabul ölçütü ve üç DoD kanıtla kapandı. Kapanış kayıtları ayrı bir BACK-794 takip commit’iyle aynı dala gönderilir; son HEAD’i Git’ten doğrula. `origin/server` değiştirilmedi.

## Tamamlanan A-02 — Hesap ve yetki (21 Ekim 2026)

Ana ajan `@codex` BACK-790 entegrasyonunu; üç alt ajan `@codex-accounts` BACK-791, `@codex-projects` BACK-792 ve `@codex-web` BACK-793 uygulamalarını aynı dalda dosya sahipliğiyle tamamladı. CLI allocator dört kimliği ayırdı; kaynak ve kayıtlar başlangıçta temiz `d13a31b2` başından açılan `tasks/server-a02-accounts-authorization` dalında yerel commit ile teslim edilir. Push/merge veya üretime kurulum bu isteğin kapsamında yapılmadı. Başlangıç kayıt yedeği `/tmp/backlog-a02-start.tar.gz`; ham kanıtlar `/tmp/backlog-a02-verification/`. Git yazarının mevcut olduğu tekrar doğrulandı; var olan repo kimliği kullanıldı. Son devir arşivi `/tmp/backlog-a02-handoff.tar.gz`, SHA-256 dosyası yanındadır; geçici alan kalıcı yedek sayılmaz.

Kesin ürün kararları: admin tüm projelere ve işlemlere otomatik erişir; admin hesapları kullanıcı adı/parolayla oluşturur; normal kullanıcı proposed kararları decisionsWrite ile düzenler, her durum değişimi ve proposed dışı düzenleme ayrıca decisionsManage ister; üç kayıt türünde arşiv, geri getirme ve kalıcı silme bu teslimdedir. Bu kararlar aşağıdaki eski açık inceleme önerilerinin ilgili maddelerinin yerine geçer.

- Ortak ServerDatabase A-01 server.sqlite kaydını ve proje kimliklerini yalnız başarılı yazma işlemi içinde eklemeli yükseltir. Okumalar dosya/şema oluşturmaz; bozuk veya tanınmayan, kısıtları eksik lookalike şemalar reddedilir. Hesap, üyelik, özetlenmiş oturum kimlikleri ve giriş sayaçları aynı SQLite dosyasındadır; görev/belge/karar Markdown’ı kendi örnek proje köklerindedir.
- Argon2id memoryCost 19456/timeCost 2; 15–128 Unicode karakterli parolaların boşlukları korunur. Kullanıcı adı kalıcı ve benzersizdir; kırpılıp küçük harfe çevrilir. İlk giriş ve admin sıfırlaması parola değişimi ister; pasifleştirme/sıfırlama bütün oturumları, kendi değişimi eski oturumları iptal eder ve geçerli tarayıcıya yenisini verir. Son aktif admin eşzamanlı CLI süreçlerinde işlem içinde korunur.
- Kanonik yerel komutlar: `server --data-dir <d> user init-admin/create/list/view/edit/reset-password`; `project member list/set/remove`. Parola gizli terminal veya `--password-stdin`; JSON schemaVersion 1. `init-admin` tekrar çalışmaz; yerel kurtarma reset-password ile yapılır. README ve komut yardımları günceldir.
- `start` zorunlu `--public-url` ister, 127.0.0.1 dinleyicisi korunur. HTTPS reverse proxy kökeni kullanılır; HTTP yalnız açık `--allow-http-loopback` ile loopback kökeninde geliştirme içindir. İlk aktif admin olmadan başlamaz. Cookie HttpOnly/SameSite=Lax/Path=/ ve HTTPS’te Secure; Domain yok. Oturum mutlak 12 saat, idle 2 saat; arka plan/WS uzatmaz. Görünür trusted etkileşim en fazla dakikada bir korumalı activity yollar. Login JSON + tam Origin; oturumlu mutasyonlar session-bound CSRF ister. SQLite hız sınırı 5 başarısız/15 dakika/kullanıcı ve 60 deneme/dakika/hizmettir.
- API proje üyeliğini okunabilirlikten önce denetler: gizli/olmayan proje 404, izinli ama okunamayan proje 503; oturum 401, işlem yetkisi 403. İzin adları tasksWrite, docsWrite, decisionsWrite, decisionsManage, archive, delete; ayarlar/üyelik/kimlik onarımı admin. Rota izni gerçek işleyici yanında tutulur; tanımsız merkezi işlem reddedilir. Her WS gönderimi güncel erişimi denetler; boş bağlantılar en geç 1 saniyede iptal edilir. Karar mutasyonları proje bazında sıraya alınır; kimlik tahsisi ve ham Markdown durum/yetki denetimi bekledikten sonra güncel kayıtla yapılır.
- Görev/belge/karar archived GET, restore POST ve archived-only DELETE mevcut Core davranışını kullanır; alt görev engelleri ve referans/etkilenen kayıt alanları korunur. Dosya ekleri realpath sınırında kalır, aktif içerik sandboxed indirme olur, Markdown tehlikeli protokolleri engellenir.
- Arayüz giriş, zorunlu/isteğe bağlı parola, kullanıcı ve proje üyeliği yönetimi ile üç tür arşiv ekranını içerir. İzin yüklenmeden proje görünümü/WS açılmaz. Ortak istemci CSRF’yi yalnız bellekte tutar ve mutasyonları yeniden denemez. Oturum dolunca aynı sayfadaki editör saklanır; aynı hesap metni sürdürür, farklı hesap eski state ve tercihleri ayırır. Doğrudan `/projects/1` girişinin sağlık sağlayıcısı, Unicode parola sınırı ve kirli belge/kararın arka plan yenilemesi de düzeltildi.

| Son kaynak doğrulaması | Sonuç |
|---|---|
| Tam bun run test | 3689 başarılı / 13 atlanan / 0 başarısız, 3702 test, 329 dosya, 17906 beklenti; çıkış 0 |
| Tip kontrolü | Başarılı; test geçici dosyaları kapandıktan sonra |
| Yazmasız Biome | Başarılı; düzeltme uygulanmadı |
| Native build ve test CLI paketi | Başarılı |
| Mevcut derlenmiş CLI/web/MCP smoke | Başarılı |
| Gerçek masaüstü Chromium/CDP | 31 başarılı iddia; 1440×1000, admin/normal kullanıcı, ayrı oturumlar, canlı izinler, üç tür arşiv, idle/metin ve yerel browser |

[Makine okunur kabul raporu](../../../verification/server/a02-verification.json) komutları, sonuçları, kabul-test eşlemelerini, son kaynak ve günlük/screenshot/betik SHA-256 özetlerini korur. Tam test komutu `BACKLOG_TEST_CLI_BUNDLE=/tmp/backlog-a02-verification/test-cli/cli.js bun run test`; paket aynı son kaynaktan `BACKLOG_BUILD_OUTDIR=... bun scripts/build.ts` ile üretildi. İlk tamamlanan tam koşuda güvenli FTP autolink regresyonu nedeniyle tek hata vardı; düzeltme 30 ilgili test, son tam koşu ve Chromium ile geçti. Hata günlüğü full-tests-ftp-regression.log olarak korundu. Kaynak henüz değişirken başlamış bir önceki tam koşu bilerek durduruldu ve başarılı sayılmadı. Bir ara tip koşusu test geçici dosyasıyla çakıştı; son koşu temizlikten sonra geçti. Tarayıcı otomasyonunun veri/düğme bekleme düzeltmeleri ve nihai sonuç ayrı kanıtlarda korundu.

Üç bağımsız inceleme tamamlandı: oturum/izin iptali, UI yetki aşma senaryoları, API/kullanıcı akışı tutarlılığı. Karar oluşturma yarışı, milestone silme izni ve kirli editör yenilemesi gibi bulgular giderildi. Sadelik incelemesi tek SQLite politikası, rota izin kaynağı, karar kuyruğu ve ortak tarayıcı istemcisiyle mevcut Core’u yeniden kullandı. Groma bu ortamda hâlâ yok; tarama veya yönettiği dosyalarda değişiklik yapılmadı. Bilinen upstream 10 görev kimliği çakışması onarılmadı. Yalnız Linux ve geçici örnek projeler doğrulandı; atlanan platform/PTY testleri geçmiş gibi gösterilmedi. `/tmp` ham kanıtları kalıcı depoya taşımadan uzun süreli yedek sayma. Tarihçe/çakışma/kesinti kurtarması A-04, sunucu bağlantılı agent modu A-05 kapsamındadır.

## Amaç ve esas plan

Bu depoda geliştirilen ürün, bağımsız Backlog.md proje takip uygulamasıdır. Kullanıcı yönetimi, yetkilendirme, çoklu proje ve tarihçe Backlog.md’nin kendi özellikleridir. Önce bu uygulama istenen seviyeye getirilecek. Ardından diğer projelerdeki Backlog.md dosya yapıları, özelleştirdiğimiz uygulamanın “Proje kaydet” özelliği üzerinden okunup otomatik olarak merkezi takip sisteminde gösterilecek. Finbee ve diğer projeler hazır uygulamaya bu yolla daha sonra bağlanacak. Mevcut Backlog.md panosu ve düzenleme ekranları korunarak bu ürün geliştirilecek. Proje kayıtlarının esas kaynağı kendi Markdown dosyaları; kullanıcı, oturum, proje, yetki ve tarihçe merkezi SQLite olacak. İlk sürüm tek Linux sunucusunda tek uygulama örneği. İlk gerçek geçiş Finbee, sonra diğer projeler. Uygulamaların kendi servisleri ve finansal veritabanlarının taşınması ayrı iş.

Kullanıcının başlangıç planı, tüm A-00–A-08 aşamaları ve zorunlu kabul senaryolarıyla [doc-4 plan belgesinde](<doc-4 - Backlog.md-çoklu-proje-takip-sistemi-planı.md>) korunuyor. Önce planı oku; aşağıdaki inceleme önerileri kullanıcı tarafından onaylanmış ürün kararları değildir. Bu fork’un ürün soruları mevcut kullanıcı vuralbayraklii ile ele alınır; upstream yönergelerindeki Alex’e başvurma ifadeleri upstream bakım bağlamındadır.

## Depo, kaynak sürümü ve Git durumu

- Çalışma klasörü: `/home/vuralbayrakli/Backlog.md` (`~/Backlog.md`).
- Fork: `https://github.com/vuralbayraklii/Backlog.md`.
- Origin SSH adresi, kullanıcının `github-backlogmd` takma adını kullanıyor. Kullanıcı bu bağlantıyla klonlama ve `server` dalını gönderme işlemini tamamladı.
- Kaynak etiketi: `v1.54.0`. Gerçek commit: `2225c4167234fd300b477cc3207689c8454abed1`.
- Geliştirme tabanı: `server`. Kullanıcı bu dalı belirtilen commit’ten açıp `origin/server` olarak gönderdi.
- A-01.3 dalı (tarihsel): `tasks/server-a013-open-project-board`; `origin/tasks/server-a013-open-project-board` dalını izler. Önceki kayıtlar korunarak açıldı; A-01.3 başlangıç yedeği `/tmp/backlog-a013-start.tar.gz`. Uygulama commit’i `ed051888e0dc8835956ae2079d454df682b3263b` uzak özellik dalına gönderildi. `origin/server` sabit kaynak commit’inde kaldı.
- Fork’un `main` dalı, ilk incelemede kaynak commit’in 12 commit ilerisindeydi. `main` kendiliğinden yeni geliştirme tabanı yapılmayacak.
- Sabit commit’in `package.json` sürümü `1.53.0`. Bu mevcut upstream metaveri tutarsızlığı raporda kayıtlı; kaynak sabitlemesi commit üzerinden yapılıyor.
- A-00–A-01.3 görevleri, raporları, plan/devir belgeleri ve kaynak değişiklikleri özellik dalında commit edilip GitHub’a gönderildi. Güncel dal başını `git status` ve `git log` ile doğrula; `server` dalına merge yapılmadı.
- Önceki aşamalarda beklenen Git yazarı A-01.3 sırasında kullanıcı tarafından tanımlandı; A-02 başlangıç/kapanışında mevcut repo kimliği doğrulandı. Yeni bir yazar kimliği uydurulmadı.
- Yeni oturumda `git status --short --branch` ile kontrol et. Yerel ve izlenmeyen dosyalar bu çalışmanın kayıtlarıdır; başka klon açmak, temizlemek veya dal değiştirmek devrin kayıtlarını taşımak anlamına gelmez.

## Tamamlanan A-00

`BACK-785` — A-00 Sabit kaynak sürümü ve başlangıç doğrulaması, `Done`; 4 kabul ölçütü ve 3 mevcut DoD maddesi kanıtlarıyla işaretli.

Kullanıcı terminalinde Bun 1.4.3 kuruldu; `bun install --frozen-lockfile --linker=isolated` ile 521 paket yüklendi. Kontroller kullanıcı tarafından çalıştırıldı; agent daha sonra günlükleri ve iki JUnit dosyasını doğrudan okuyup doğruladı.

| Kontrol | Sonuç |
|---|---|
| Bun | 1.4.3 |
| Kaynak commit | 2225c4167234fd300b477cc3207689c8454abed1 |
| Tip kontrolü | 538 dosya, hata yok |
| Yazmasız Biome | 460 dosya, düzeltme uygulanmadı |
| Tam CI profili, ana bölüm | 3.143 başarılı, 13 atlanan, 0 başarısız |
| Tam CI profili, DOM bölümü | 399 başarılı, 0 başarısız |
| Test toplamı | 3.542 başarılı, 13 atlanan, 0 başarısız |
| Build | Çıkış kodu 0 |
| Derlenen CLI/web/MCP çalıştırma kontrolü | Çıkış kodu 0 |
| Test/build öncesi ve sonrası kaynak ağacı | Temiz |

[Makine okunur rapor](../../../verification/server/a00-baseline.json), testlerin profil bazında dökümünü, atlanan testlerin adlarını, komutları ve 14 kanıt dosyasının SHA-256 özetlerini içerir.

Ham kanıtlar: `/home/vuralbayrakli/backlog-a00/`. Burada tip/Biome/build/test günlükleri, iki JUnit XML dosyası, son Git durumu ve smoke sonucu bulunur. `evidence.tar.gz` ve `evidence.tar.gz.sha256` bu ilk rapor ve ham kanıtları birlikte kapsar. Bu arşiv, daha sonra eklenen devir belgelerini içermez; arşiv adı güncel çalışma ağacının yedeği anlamına gelmez.

Testler Linux terminalindeki başlangıç durumunu kanıtlar. 13 atlanan senaryo, macOS/Windows/Nix ve ilave etkileşimli TUI CI adımları çalışmış gibi gösterilmeyecek. A-00 kapanışında eklenen dosyalar görev/belge metaverisi ve rapordu; o aşamada uygulama kodu değiştirilmedi. A-01.1 kaynak değişikliği ve ilgili doğrulama aşağıda ayrıca kayıtlıdır.

## Bilinen bulgular ve ortam

Upstream’den gelen `backlog/archive/tasks` ve `backlog/completed` içeriğinde 10 görev kimliği çakışması, toplam 20 dosya var: BACK-41, BACK-76, BACK-81, BACK-82, BACK-88, BACK-89, BACK-90, BACK-168, BACK-275, BACK-569. `doctor` yalnız önizleme olarak çalıştırıldı. Kimlikleri ve geçmiş bağlantılarını değiştiren bir onarım uygulanmadı. Bulgular `doctor.log` ve başlangıç raporunda kayıtlı; bu çakışmalar testlerde 0 başarısız sonucuyla karıştırılmamalı.

Son oturumdaki agent terminalinde GitHub HTTPS DNS çözümlemesi başarısız oldu. SSH çağrısı `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf` sahiplik/izin kontrolünde reddedildi. GitHub bağlayıcısının dal oluşturma çağrısı 403 verdi. Bunlar kullanıcının terminalindeki başarılı push’tan ayrı ortam sonuçlarıdır. Yeni oturumda erişimi tekrar kontrol et; sistem SSH dosyalarına veya anahtarlara rastgele müdahale etme.

Bun kurulu: `/home/vuralbayrakli/.bun/bin/bun`. Agent kabuğunda PATH içinde olmayabilir. Kurulu sürümü kullan:

```bash
cd /home/vuralbayrakli/Backlog.md
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Geliştirme komutları kaynak sürümde zaten var. Derlenen CLI `./dist/backlog`; kaynak CLI `bun run cli`. Backlog verisini CLI ile değiştir; görev/karar/belge/arşiv Markdown dosyalarını elle düzenleme.

AGENTS.md, mimari incelemeden önce `groma agent-instructions` çalıştırılmasını istiyor. Bu komut son ortamda bulunamadı. Mimari tarama veya Groma tarafından yönetilen dosya düzenlemesi yapılmadı. Yeni oturumda aracın durumunu ve geçerli yönergeleri kontrol et; var olmayan bir taramanın tamamlandığını iddia etme.

## Tamamlanan A-01.1

`BACK-786` — Proje kimliğiyle bağımsız Backlog çalışma bağlamları, `Done`; 5 kabul ölçütü ve 4 DoD maddesi kanıtlarıyla işaretli. Sorumlu `@codex`. Uygulama planı kod yazılmadan önce görev kaydına CLI ile yazıldı.

- `src/server/project-context.ts`: Proje kimliğiyle açılan/çözümlenen çalışma zamanı bağlamları. Her bağlam mevcut `Core(projectRoot)`, içerik deposu, arama ve izleyicilerini kullanır. Aynı kimlikte eşzamanlı açmalar tek başlatmayı paylaşır; açık kimliğin farklı köke taşınması reddedilir. Başlatma hatası ve kapatma yalnız kendi kaynaklarını etkiler; yönetici kapatılırken önceden başlamış kapanışlar da beklenir.
- `src/test/project-context.test.ts`: İki ayrı klasörde aynı TASK-1/doc-1/decision-1 ile 10 davranış testi. Okuma/yazma, diğer dosyanın değişmemesi, yapılandırma/arama ayrımı, gerçek dosya bildirimleri, farklı Backlog klasör düzenleri, kapatma/yeniden açma ve başlatma/kapatma yarışları doğrulandı.
- Çalışma alanı kimliği görev içindeki `project` alanından ayrıdır. Süreç çalışma dizini değiştirilmez ve genel aktif proje tutulmaz. Sadelik incelemesinde mevcut Core/içerik/arama uygulamaları yeniden kullanıldı; yeni kalıcı depo veya CRUD katmanı eklenmedi.
- Bu modül güvenilen kimlik/kök eşlemelerini alır. Mevcut BacklogServer HTTP/UI akışı henüz bu yöneticiyi kullanmıyor. A-01.1 kapanışında kalıcı kayıt modeli, kök bağlama/izin doğrulaması, API/UI yolları ve sunucu güvenlik politikaları kalan işlerdi. Kalıcı proje kayıtları ve yerel yönetim CLI’sı A-01.2 ile tamamlandı; HTTP/UI, yetkili klasör bağlama ve sunucu güvenlik politikaları kalan ürün işleridir. A-01 veya giriş/yetki aşaması tamamlandı sayılmaz.

| Kontrol | Sonuç |
|---|---|
| İlgili Bun test grubu | 8 dosyada 128 başarılı, 0 başarısız, 0 atlanan; 1.077 beklenti |
| Yeni bağlam davranış testleri | 10 başarılı |
| Tip kontrolü | 540 dosya, hata yok |
| Yazmasız Biome | Başarılı; yeni JSON raporu ayrıca kontrol edildi |
| Build | Çıkış kodu 0 |

[Doğrulama raporu](../../../verification/server/a01-1-project-contexts.json), son kaynak dosyalarının SHA-256 özetlerini, test komutunu, JUnit dosya bazlı sayımlarını ve ham günlüklerin özetlerini içerir. Ham kanıtlar: `/tmp/backlog-back786-verification-4gwewqlf/`. İlk ilgili test çalışması sandbox içinde localhost dinleme çağrısında `EPERM` ile kesildi; aynı grup yerel dinleme izniyle son kaynak üzerinde geçti. İlk günlük ayrıca korundu. Bu aşamada tam A-00 CI profili veya macOS/Windows kontrolleri yeniden çalıştırılmadı.

Çalışma öncesindeki altı devir dosyasının `/home/vuralbayrakli/backlog-a00/chat-handoff.tar.gz` ile birebir eşleştiği doğrulandı. Ek başlangıç yedeği: `/tmp/backlog-back786-start-ql7m7y2k/`. Özgün arşiv değiştirilmedi; A-01.1 sonrasındaki kodu ve kayıtları içermez. Güncel kayıtlar, iki yeni kaynak dosyası, A-00 kanıt arşivi ve A-01.1 ham kanıtları için yeni devir arşivi: `/tmp/backlog-back786-handoff.tar.gz` (yanında SHA-256 dosyası). Bu geçici arşivi başka ortama taşımadan önce kalıcı bir yerde koru.

## Tamamlanan A-01.2

`BACK-787` — Kalıcı proje kayıtları ve sunucu CLI komutları. Kullanıcı planı uygulamamızı 21 Ekim 2026’da onayladı; görev `@codex` üzerine alınıp planı kod öncesinde CLI ile kaydedildi.

Aynı Backlog.md uygulamasına ayrı `server` komut grubu ve zorunlu `--data-dir` eklendi. Proje kayıtları bu dizindeki `server.sqlite` içinde tutulur; kayıt kimliği artan sayısal değerin metin karşılığıdır. Görev `project` alanıyla bağlantılı değildir. Kaynak görev/belge/karar/yapılandırma dosyaları esas yerlerinde kalır.

```bash
backlog server --data-dir ./server-data project register /path/to/project --name "Example"
backlog server --data-dir ./server-data project list --json
backlog server --data-dir ./server-data project view 1
```

- `src/server/project-store.ts`: register/list/load; readonly okumalar, işlem başına kapanan SQLite bağlantıları, `BEGIN IMMEDIATE` yazmaları ve 5000ms kilit sınırı. Aynı gerçek klasör, sembolik bağlantı takma adı ve birbirini içeren kökler reddedilir. Eksik dizin/veritabanı okumalarda oluşturulmaz; bozuk/kesilmiş veya yanlış şemalı veritabanı kendiliğinden onarılmaz.
- `src/commands/server.ts` ve CLI bağlantısı: üç komutta metin ve `schemaVersion: 1` JSON. `rootPath`, `name`, `id` ve `createdAt` alanları yardım/README’de açıklı. Sunucu komutları terminal çalışma dizinindeki projeyi otomatik taşımaz; `BACKLOG_CWD` sunucu verisini veya hedef projeyi seçmez. Standart, gizli ve özel Backlog klasörleri mevcut ortak okuma koduyla desteklenir.
- `src/test/server-project-store.test.ts` ve `src/test/cli-server-project.test.ts`: 27 yeni test. Kalıcılık, kaynak dosya özetlerinin korunması, iki kayıtlı projede aynı TASK-1, gerçek süreçlerde yinelenen/çakışan kayıtlar, 5 saniyelik kilit, bozuk veritabanı, eksik veri dizini, eski yapılandırmayı taşımama ve CLI sözleşmesi doğrulandı.
- Sadelik incelemesinde mevcut FileSystem, klasör doğrulaması, JSON/yardım düzeni ve proje bağlamları kullanıldı; ORM, ek kilit katmanı, genel sürümleme veya kullanılmayan düzenleme/silme API’si eklenmedi.

| Kontrol | Sonuç |
|---|---|
| İlgili regresyon grubu | 11 dosyada 133 başarılı, 0 başarısız, 0 atlanan; 591 beklenti |
| Yeni kayıt/CLI davranış testleri | 27 başarılı |
| Tip kontrolü | 544 dosya, hata yok |
| Yazmasız Biome | Başarılı; rapor ayrıca kontrol edildi |
| Build ve test CLI paketi | Başarılı |
| Derlenen CLI kontrolü | İki TASK-1 örneği, kayıt/listeleme/görüntüleme, süreçler arası kimlik, dosya özetleri, yinelenen kayıt, eksik/bozuk veri ve eski browser yardımı başarılı |

[Doğrulama raporu](../../../verification/server/a01-2-project-records.json), komutları, dosya bazlı JUnit sayılarını, son kaynak ve günlük SHA-256 özetlerini korur. Ham kanıtlar: `/tmp/backlog-back787-verification-rtit9x4h/`. Sandbox içindeki Bun alt süreçleri stdout akışını açamadığı için aynı boş liste komutu izinli ortamla karşılaştırıldı ve başarılı oldu; nihai CLI/HTTP regresyonları gerekli süreç/localhost izinleriyle geçti. Standart görev oluşturma kilidi de `.git/backlog.md` salt okunur olduğu için izinli ortamda alındı; görev dosyası veya kimliği elle oluşturulmadı.

Bu teslim HTTP sunucusunu, proje kaydetme ekranını, hesap/yetkiyi veya tarihçeyi tamamlamaz. İzinli klasör alanları ve sonradan değişen sembolik bağlantılara ilişkin yetki politikaları kendi aşamalarındadır. Yalnız örnek projeler kullanıldı. Tam A-00 CI profili bu küçük değişiklik için yeniden çalıştırılmadı.

En güncel devir arşivi `/tmp/backlog-back787-handoff.tar.gz`, SHA-256 dosyası yanındadır. A-00 ve A-01.1 arşivleri yerinde korundu. Güncel arşiv yerel değişiklikleri ve tüm aşamaların kanıtlarını taşır; geçici dizinden başka ortama geçmeden önce kalıcı yerde korunmalıdır.

## Tamamlanan A-01.3 — Kayıtlı projenin mevcut panosu

`BACK-788` (ortak sunucu ve proje kapsamlı işlemler) ve bağımlı `BACK-789` (seçici ve pano bağlantısı) `Done`; ikisi de `@codex` üzerine alındı. Kullanıcının 21 Ekim 2026 A-01.3 planı uygulandı. A-01’in iki projede aynı kimliklerin ayrılması ölçütü örnek projelerde sağlandı. A-02 hesap/yetki aşaması başlatılmadı ve yeni takip görevi açılmadı.

- `backlog server --data-dir ./server-data start --port 6420` tek `127.0.0.1` dinleyicisi açar; yalnız `--open` tarayıcı başlatır. `/projects` seçicisi kayıtlı ad/kimlikleri gösterir; proje değişimi tam sayfa gezinmesidir. Eski yerel `backlog browser` davranışı korunur.
- `src/server/central.ts` kalıcı SQLite kaydını çözer ve mevcut `BacklogServer` işleyicilerini proje başına Core, içerik/arama, izleyici ve WebSocket grubuyla kullanır. Bilinmeyen proje 404, kayıtlı ama okunamayan proje 503; proje belirtmeyen merkezi veri API yolları 404. Sonradan silinen özel Backlog klasörü de 503 verir ve yeniden oluşturulmaz. Eksik veritabanı boş seçici, bozuk veritabanı başlangıç hatasıdır.
- `Core` sunucu modunda Git dal birleştirme, uzak fetch, otomatik commit ve durum komutlarını proje ayarından bağımsız kapatır. Merkezi ayar API’si yalnız `defaultStatus`, `definitionOfDone`, `dateFormat`, `hideEmptyColumns`, `maxColumnWidth` alanlarını birleştirir; görünen ad SQLite kayıt adıdır.
- Tarayıcıda sabit proje rota/API/WebSocket tabanı, Markdown görev/doküman bağlantıları ve ek URL’leri, proje bazlı pano/belge gezgini tercihleri ve kaydedilmemiş görev, belge, yeni karar, kilometre taşı ve ayar taslağında ayrılma uyarısı tamamlandı. Seçicide WebSocket açılmıyor.
- `verification/server/a01-3a-central-api.json`: 9 API testi / 62 beklenti. `verification/server/a01-3b-verification.json`: yedi ilgili API/DOM dosyasında 121/121 test / 1215 beklenti; DEBUG çapraz test düzeltmesiyle üç dosyada 74/74; 550 dosyada tip kontrolü, 474 dosyada yazmasız Biome, build ve derlenen CLI/web/MCP smoke geçti. Derlenmiş `dist/backlog` ve gerçek Chromium ile 23 iddia doğrulandı: iki sekme/WebSocket, seçici, pano/düzenleme, taslak, belge, karar, kilometre taşı, arama, ayar, geri/ileri, doğrudan bağlantı, Markdown ekleri, 404/503 ve yerel browser. Ham günlük, ortam özel tarayıcı betiği ve masaüstü ekran görüntüleri rapor manifestinde SHA-256 ile korunuyor.
- Tam `bun run test` ilk koşusunda `offline-mode.test.ts` yok olan `DEBUG` değişkenini yanlış geri yüklediği için 18 CLI çıktı testi başarısızdı. İkinci koşuda 3591 başarılı / 13 atlanan / 0 başarısız vardı fakat `list-window.test.ts` yok olan `process.exitCode` değerini `undefined` atamasıyla geri yüklediği için Bun çıkış kodu 1 kaldı. İki test temizliği düzeltildi. Son tam koşu 3604 test / 322 dosyada 3591 başarılı, 13 atlanan, 0 başarısız, 17361 beklenti ve çıkış kodu 0 ile tamamlandı; ham günlük SHA-256 özeti `a01-3b-verification.json` içindedir.
- Git durumu: A-00–A-01.3 uygulama ve kanıtları `ed051888e0dc8835956ae2079d454df682b3263b` commit’iyle `origin/tasks/server-a013-open-project-board` dalına gönderildi; `origin/server` `2225c4167234fd300b477cc3207689c8454abed1` commit’inde kaldı. Yazar bu depoda `vuralbayraklii` ve kullanıcının seçtiği GitHub gizli adresi olarak tanımlı. Groma komutu bu ortamda bulunamadı; Groma taraması yapılmadı ve yönettiği dosyalara dokunulmadı. En güncel devir arşivi `/tmp/backlog-a013-handoff.tar.gz`; SHA-256 dosyası yanındadır. Geçici alandan taşınmadan kalıcı yedek sayılmamalıdır.

## Geliştirmenin yönü

A-00–A-04 ve BACK-806 arayüz düzeltmesi tamamlandı. BACK-806 289bfc2dfa6c4d68b7ab2a9acfb7b40631ac47d6 commit’iyle origin/tasks/server-ui-consistency dalına gönderildi; kabul kaydı verification/server/back-806-ui.json. A-04 uygulaması ve kabulü 09e336fb28f28dcef9a94ac162666cfc5662a20b commit’iyle origin/tasks/server-a04-write-history dalındadır; kapanış kayıtları aynı dalda takip commit’iyle taşınır. Yeni aşama veya gerçek proje bağlama bu çalışmada başlatılmadı. A-05 agent kimliği/dış değişiklik olayları, A-06 kullanıcı geçmişi ve doğrulama/kabul iş akışları doc-4'teki ayrı aşamalardır.

Devam eden sohbet önce MANIFESTO.md, CLI overview, doc-4/doc-5/doc-6, a00-baseline.json ve a04-verification.json okumalı; BACK-799–805'i CLI ile doğrulamalı. Git durumunu ve yerel dosyaları korumadan dal değiştirmemeli. Sonraki kapsamı mevcut kullanıcı vuralbayraklii belirler; önceki öneriler kendiliğinden onaylanmış sayılmaz.

## Sonraki aşamalarda karar gerektiren konular

- Agent anahtarının kullanıcıyla bağı ve agent'ın kullanıcı adına doğrulama/kabul yetkisi.
- İnceleme taleplerinin alanları, Markdown/SQLite kaynak dağılımı ve serbest metin assignee'lerin hesaplarla eşleştirilmesi.
- Doğrulama/kabulün hangi içerik veya kod sürümüne ait olduğu ve kapsam değişiminde yeniden inceleme politikası.
- Yedek/geri yükleme provası ve sonraki işletim kapsamı. A-04 kesinti/olay/ortak kilit sınırları doc-6 bölüm9 ile karara bağlandı; açık öneri değildir.

## Yeni sohbete verilecek başlangıç mesajı

```text
Backlog.md sunucusunda A-00–A-04 tamamlandı ve origin/tasks/server-a04-write-history dalına gönderildi (uygulama09e336fb, kapanışfc07f2ce).
Kullanıcının görsel geri bildirimi üzerine BACK-806 frontend/tema bütünlüğü düzeltmesi 289bfc2dfa6c4d68b7ab2a9acfb7b40631ac47d6 commit’iyle origin/tasks/server-ui-consistency dalına gönderildi; teslim kaydı takip commit’indedir.
Önce MANIFESTO.md, backlog instructions overview, doc-4/doc-5 ve verification/server/back-806-ui.json oku; BACK-806'yı CLI ile doğrula. Git durumunu ve yerel değişiklikleri koru.
Yeni derleme dist/backlog'a alındı. Kullanıcı aynı kişisel data-dir ile yeniden başlattı ve güncel arayüzün açıldığını doğruladı; gerçek Finbee bu çalışma sırasında bağlanmadı.
A-05 agent/dış dosya olayları ve A-06 kullanıcı geçmişi/kabul kapsamları ayrı aşamalardır; mevcut kullanıcı vuralbayraklii ile kapsam ve açık ürün kararları netleştirilmeden yeni aşama başlatma.
```
