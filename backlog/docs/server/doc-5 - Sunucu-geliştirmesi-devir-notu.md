---
id: doc-5
title: Sunucu geliştirmesi devir notu
type: guide
created_date: '2026-10-20 12:17'
updated_date: '2026-10-21 14:16'
tags:
  - server
  - handoff
  - status
---
Bu not Backlog.md çoklu proje sunucusu geliştirmesine yeni bir sohbetten devam etmek içindir. A-00, A-01 ve A-02 ana uygulaması tamamlandı. 8440e7b7 incelemesindeki üç hata BACK-794 kapsamında düzeltildi ve doğrulandı; BACK-794 Done olarak kapandı ve düzeltme origin özellik dalına gönderildi. Güncel dal tasks/server-a02-accounts-authorization; HEAD ve temizliği Git ile doğrula. Sonraki ürün aşaması A-03 proje kayıt ekranı ve izinli klasörlerdir; bu teslimde başlatılmadı. Aşağıdaki eski aşama kayıtları tarihsel kanıtlardır.

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

A-00, A-01 ve A-02 tamamlandı. Sıradaki aşama A-03: proje kayıt ekranı, izinli klasör alanları ve güvenli proje bağlama. Bu teslim yalnız geçici örnek projelerle geliştirildi; gerçek projeleri veya Finbee’yi bağlama başlatılmadı. Tarihçe ve kesinti kurtarması A-04; agent sunucu CLI/MCP bağlantısı A-05’tedir.

Devam sırası:

1. MANIFESTO.md, AGENTS.md, doc-4, doc-5 ve A-00–A-02 ve a02-review-fixes.json doğrulama raporlarını oku; BACK-785–BACK-794 görevlerini CLI ile doğrula.
2. Git durumunu ve A-02 özellik dalının HEAD’ini doğrula, yerel kayıtları koru. A-02 inceleme düzeltmesinin son kaynak özetleri a02-review-fixes.json içindedir; origin/server kendiliğinden değiştirilmez.
3. A-03 kapsamını mevcut kullanıcı vuralbayraklii ile ele al. A-02’nin yukarıdaki kesin kararlarını yeniden belirsiz sayma; diğer açık önerileri onaylanmış karar sayma.
4. Yeni görevi yalnız kullanıcı yetkilendirdiğinde CLI allocator ile aç; Groma varsa yönergelerini, yoksa sınırlamayı kaydet. Kabul kanıtlarını ve bu devri güncelle.

## Karar bekleyen inceleme önerileri

Aşağıdakiler önceki plan incelemesinde önerildi; kullanıcı bunları ayrıca karara bağlamadı. Gereken aşamaya gelince netleştir, kabul edilmiş özellik gibi uygulama:

- İnceleme/karar taleplerinin alanları ve Markdown/SQLite arasındaki esas kaynak dağılımı; mevcut metin assignee’lerin uygulama kullanıcılarıyla eşleştirilmesi; proje durumlarından tarihçe olaylarına eşleme.
- Doğrulama ve kullanıcı kabulünün hangi içerik/kod sürümüne ait olduğu; kapsam değişince yeniden inceleme gerekip gerekmediği; yeniden kullanılan görünen kimliği ayıran kalıcı kayıt kimliği.
- Dosya ve SQLite arasındaki kesinti kurtarma karar tablosu; kısmen yazılmış çok dosyalı işlem; ortak kilide katılmayan dış yazıcılara karşı verilen eşzamanlılık garantisinin sınırı.
- Tek işin birden fazla kayıt olayını kapsadığı durumda ortak operation_id ile tekilleştirme; aynı idempotency anahtarının farklı içerikle, sürerken veya tamamlandıktan sonra gönderilmesi.
- A-02 ile global adminin tüm içeriğe erişimi kesinleşti. Açık kalan: proje oluşturanın ilk yetkileri, doğrulama/kabul olaylarını kimin yazabileceği ve agent’ın kullanıcı adına kabul verebilmesi; agent anahtarının bağımsız mı kullanıcıya bağlı mı olduğu.
- A-02, ham karar Markdown’ında önceki/sonraki durum denetimini, ek realpath sınırını ve zararlı Markdown URL korumasını tamamladı. Açık kalan: A-03 izinli klasör bağlama politikası ve A-04 dış yazıcı/kurtarma sınırları.
- A-02 tarayıcı testleri tamamlandı. Açık kalan: yönetim tarihçesi ve yedek/geri yükleme provası. Asıl planın aşama tablosu doc-4’te özgün haliyle duruyor.

## Yeni sohbete verilecek başlangıç mesajı

```text
/home/vuralbayrakli/Backlog.md projesindeki çalışmaya devam ediyoruz.
Önce MANIFESTO.md, AGENTS.md Server fork continuity, doc-4, doc-5, A-00–A-02 verification/server raporları, a02-review-fixes.json ve BACK-785–BACK-794 görevlerini CLI ile oku.
A-00, A-01 ve A-02 tamamlandı. A-02 dalı tasks/server-a02-accounts-authorization; HEAD/temizliği Git ile doğrula. Hesap, oturum, proje işlem izinleri, admin CLI/UI ve üç kayıt türünde arşiv yaşam döngüsü entegre; tarihçe ve agent server modu sonraki aşamalardır.
8440e7b7 ana uygulamasının son tam testi: 3689 başarılı, 13 atlanan, 0 başarısız. Sonraki BACK-794 düzeltmesinde ilgili 566 test ve 19 Chromium kontrolü başarılı; tip, yazmasız Biome, build ve compiled smoke de geçti. Son kaynak kanıtı a02-review-fixes.json, ham kayıtlar /tmp/backlog-a02-review-fixes-69vcph7x/. Tam test bu dar düzeltmede yeniden çalıştırılmadı.
Git ve yerel kayıtları koru. Sıradaki A-03 proje kayıt ekranı/izinli klasörlerdir; kullanıcı yetkilendirmeden başlatma. A-02 kesin kararlarını ve kapsam dışı A-04/A-05 ayrımını koru; Groma bu ortamda bulunamadı.
```
