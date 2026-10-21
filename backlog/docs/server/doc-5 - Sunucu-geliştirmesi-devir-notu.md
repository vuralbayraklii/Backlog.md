---
id: doc-5
title: Sunucu geliştirmesi devir notu
type: guide
created_date: '2026-10-20 12:17'
updated_date: '2026-10-21 11:14'
tags:
  - server
  - handoff
  - status
---
Bu not, Backlog.md fork’unda çoklu proje takip sistemi geliştirmesine yeni bir sohbetten devam etmek içindir. 21 Ekim 2026 güncellemesinde A-00 (BACK-785) ve A-01.1–A-01.3 (BACK-786–BACK-789) tamamlandı; A-01 proje bağlamı aşaması kapandı. Geliştirme hedefi, bağımsız Backlog.md uygulamasının kendi kullanıcı, yetki, çoklu proje ve tarihçe özelliklerini tamamlamaktır. Diğer projeler uygulama istenen seviyeye geldikten sonra “Proje kaydet” üzerinden bağlanacaktır. Güncel görev durumunu CLI’dan, dosyaların kalıcılık durumunu Git’ten tekrar kontrol et.

## Amaç ve esas plan

Bu depoda geliştirilen ürün, bağımsız Backlog.md proje takip uygulamasıdır. Kullanıcı yönetimi, yetkilendirme, çoklu proje ve tarihçe Backlog.md’nin kendi özellikleridir. Önce bu uygulama istenen seviyeye getirilecek. Ardından diğer projelerdeki Backlog.md dosya yapıları, özelleştirdiğimiz uygulamanın “Proje kaydet” özelliği üzerinden okunup otomatik olarak merkezi takip sisteminde gösterilecek. Finbee ve diğer projeler hazır uygulamaya bu yolla daha sonra bağlanacak. Mevcut Backlog.md panosu ve düzenleme ekranları korunarak bu ürün geliştirilecek. Proje kayıtlarının esas kaynağı kendi Markdown dosyaları; kullanıcı, oturum, proje, yetki ve tarihçe merkezi SQLite olacak. İlk sürüm tek Linux sunucusunda tek uygulama örneği. İlk gerçek geçiş Finbee, sonra diğer projeler. Uygulamaların kendi servisleri ve finansal veritabanlarının taşınması ayrı iş.

Kullanıcının başlangıç planı, tüm A-00–A-08 aşamaları ve zorunlu kabul senaryolarıyla [doc-4 plan belgesinde](<doc-4 - Backlog.md-çoklu-proje-takip-sistemi-planı.md>) korunuyor. Önce planı oku; aşağıdaki inceleme önerileri kullanıcı tarafından onaylanmış ürün kararları değildir. Bu fork’un ürün soruları mevcut kullanıcı vuralbayraklii ile ele alınır; upstream yönergelerindeki Alex’e başvurma ifadeleri upstream bakım bağlamındadır.

## Depo, kaynak sürümü ve Git durumu

- Çalışma klasörü: `/home/vuralbayrakli/Backlog.md` (`~/Backlog.md`).
- Fork: `https://github.com/vuralbayraklii/Backlog.md`.
- Origin SSH adresi, kullanıcının `github-backlogmd` takma adını kullanıyor. Kullanıcı bu bağlantıyla klonlama ve `server` dalını gönderme işlemini tamamladı.
- Kaynak etiketi: `v1.54.0`. Gerçek commit: `2225c4167234fd300b477cc3207689c8454abed1`.
- Geliştirme tabanı: `server`. Kullanıcı bu dalı belirtilen commit’ten açıp `origin/server` olarak gönderdi.
- Yerel çalışma dalı: `tasks/server-a013-open-project-board`. Önceki kayıtlar korunarak bu dal açıldı; A-01.3 başlangıç yedeği `/tmp/backlog-a013-start.tar.gz`. HEAD hâlâ sabit kaynak commit’idir; uygulama ve kayıtlar commit edilmedi.
- Fork’un `main` dalı, ilk incelemede kaynak commit’in 12 commit ilerisindeydi. `main` kendiliğinden yeni geliştirme tabanı yapılmayacak.
- Sabit commit’in `package.json` sürümü `1.53.0`. Bu mevcut upstream metaveri tutarsızlığı raporda kayıtlı; kaynak sabitlemesi commit üzerinden yapılıyor.
- Görevler, üç rapor, plan/devir belgeleri, AGENTS.md devir bağlantısı, A-01.1/A-01.2 kaynak dosyaları ve CLI/README değişiklikleri yereldir. Henüz commit/push yapılmadı; bunların GitHub’da mevcut olduğunu varsayma.
- Git commit adı/e-postası henüz tanımlı değil. Kullanıcıya GitHub gizlilik e-postası seçeneği sunuldu, fakat yanıt verilmedi. Kimlik seçimini yapılmış sayma ve rastgele yazar bilgisi uydurma.
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
- Git durumu: `tasks/server-a013-open-project-board`, HEAD `2225c4167234fd300b477cc3207689c8454abed1`; A-00–A-01.3 kodu, görevler ve raporlar yerel, değişmiş veya izlenmeyen dosyalardır. Commit/push yapılmadı. Git yazar adı/e-postası hâlâ tanımlı değil; kendiliğinden kimlik uydurma. Groma komutu bu ortamda bulunamadı; Groma taraması yapılmadı ve yönettiği dosyalara dokunulmadı. En güncel devir arşivi `/tmp/backlog-a013-handoff.tar.gz`; SHA-256 dosyası yanındadır. Geçici alandan taşınmadan kalıcı yedek sayılmamalıdır.

## Geliştirmenin yönü

Önce bağımsız Backlog.md uygulamasının kullanıcı, yetki, çoklu proje, proje kaydetme ve tarihçe özellikleri geliştirilecek. Proje bağlamı ve API/UI çalışmaları bu ürünün kendi uygulama ayrıntılarıdır. Ürün hazır olduğunda diğer projelere uygulanmış Backlog.md dosya yapıları “Proje kaydet” ile otomatik olarak merkezi takibe alınacak. A-01.3 ve A-01 aşaması tamamlandı. Sıradaki ürün aşaması A-02 hesap ve yetkidir; uygulama görevi henüz açılmadı. Açık inceleme önerilerini onaylanmış ürün kararı sayma.

Devam sırası:

1. MANIFESTO.md, AGENTS.md, doc-4 ve bu devir notuyla A-00–A-01.3 doğrulama raporlarını oku; BACK-785–BACK-789 görevlerini CLI ile doğrula.
2. `git status --short --branch` ile yerel kayıtları doğrula. HEAD sabit kaynak commit’idir; tüm A-00–A-01.3 dosyaları commit/push edilmedi. Dal değiştirmeden veya temizlikten önce kayıtları koru.
3. Sonraki küçük A-02 hesap/yetki işinin ürün davranışını mevcut kullanıcı vuralbayraklii ile belirle. İnceleme önerilerini onaylanmış karar sayma ve A-01.3 yerel erişimini kalıcı yetkilendirme yerine kullanma.
4. Yeni kapsamı CLI ile küçük görev olarak kaydet; kabul kanıtlarını ve devir notunu güncelle.

## Karar bekleyen inceleme önerileri

Aşağıdakiler önceki plan incelemesinde önerildi; kullanıcı bunları ayrıca karara bağlamadı. Gereken aşamaya gelince netleştir, kabul edilmiş özellik gibi uygulama:

- İnceleme/karar taleplerinin alanları ve Markdown/SQLite arasındaki esas kaynak dağılımı; mevcut metin assignee’lerin uygulama kullanıcılarıyla eşleştirilmesi; proje durumlarından tarihçe olaylarına eşleme.
- Doğrulama ve kullanıcı kabulünün hangi içerik/kod sürümüne ait olduğu; kapsam değişince yeniden inceleme gerekip gerekmediği; yeniden kullanılan görünen kimliği ayıran kalıcı kayıt kimliği.
- Dosya ve SQLite arasındaki kesinti kurtarma karar tablosu; kısmen yazılmış çok dosyalı işlem; ortak kilide katılmayan dış yazıcılara karşı verilen eşzamanlılık garantisinin sınırı.
- Tek işin birden fazla kayıt olayını kapsadığı durumda ortak operation_id ile tekilleştirme; aynı idempotency anahtarının farklı içerikle, sürerken veya tamamlandıktan sonra gönderilmesi.
- Global adminin içerik erişimi, proje oluşturanın ilk yetkileri, doğrulama/kabul olaylarını kimin yazabileceği ve agent’ın kullanıcı adına kabul verebilmesi; agent anahtarının bağımsız mı kullanıcıya bağlı mı olduğu.
- API’nin kabul edilmiş kararın ham Markdown düzenlemesini de önceki/sonraki içeriğe göre yetkilendirmesi; sonradan değişen sembolik bağlantılar ve zararlı Markdown HTML/URL senaryoları.
- Yönetim tarihçesi, tarayıcı testleri ve yedek/geri yükleme provasının daha erken aşamalara alınması. Asıl planın aşama tablosu doc-4’te özgün haliyle duruyor.

## Yeni sohbete verilecek başlangıç mesajı

```text
/home/vuralbayrakli/Backlog.md projesindeki çalışmaya devam ediyoruz.
Önce MANIFESTO.md, AGENTS.md Server fork continuity, doc-4, doc-5 ve verification/server/a00-baseline.json ile a01-1, a01-2, a01-3a, a01-3b raporlarını; BACK-785–BACK-789 görevlerini CLI ile oku.
A-00 ve A-01.1–A-01.3 tamamlandı. Tek yerel merkezi dinleyicide kayıtlı projeler seçiliyor ve mevcut pano proje kapsamlı çalışıyor; hesap/yetki ve tarihçe sonraki aşamalardır. A-02 görevi henüz açılmadı.
Yerel dal tasks/server-a013-open-project-board, HEAD 2225c4167234fd300b477cc3207689c8454abed1. Kod, görevler ve raporlar commit/push edilmedi; Git yazar kimliği seçilmedi. Başlangıç yedeği /tmp/backlog-a013-start.tar.gz.
Tam bun run test son koşuda 3591 başarılı, 13 atlanan, 0 başarısız ve çıkış kodu 0 verdi. İlgili 121 API/DOM testi, Chromium, tip, yazmasız Biome, build ve compiled smoke de geçti; ayrıntılar a01-3b raporunda.
Önce Git durumunu ve yerel kayıtları koru. Sonraki A-02 ürün davranışını mevcut kullanıcıyla netleştir; devirdeki çözülmemiş önerileri onaylı karar sayma.
```
