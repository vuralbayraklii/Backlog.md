---
id: doc-5
title: Sunucu geliştirmesi devir notu
type: guide
created_date: '2026-10-20 12:17'
updated_date: '2026-10-25 09:38'
tags:
  - server
  - handoff
  - status
---
Bu not Backlog.md çoklu proje uygulamasına yeni sohbetten devam etmek içindir. A-00–A-07 tamamlandı; Finbee FIN-21 kabul edilen içeriği korunur ve A-08 kullanıcı talebiyle başlatılmadı. BACK-823 eski dosya adı düzeltmesi ve BACK-824 arşiv kimliği onarımı tamamlandı. Güncel dal tasks/server-duplicate-task-ids; c7cb6989 ve b70f859d yerel commitleri 5b087c6c tabanındadır. Push otomatik onay denetimi tarafından hedef/içerik için ek açık kullanıcı onayı gerektiği gerekçesiyle reddedildi; uzak dal henüz oluşturulmadı. Bu teslim durumu ayrı takip commit’iyle korunur. Güncel onarım kanıtı verification/server/back-824-verification.json; aşağıdaki önceki durumlar tarihseldir.

## A-07/BACK-823/BACK-824 Git teslim kontrolü — 25 Ekim 2026

Kullanıcı son değişiklikler uygunsa commit ve push yapılmasını istedi. BACK-823 düzeltmesi, görev/kabul kayıtları ve önceki A-07/BACK-824 devir metni c7cb6989659d4f74c06cb25bc77ca8c83aa77484 commit’inde; arşiv kimliği onarımı, A-07 kabul raporu ve özel server-data dışlama kuralı b70f859d7178146d896490d9381004d3342ed8dd commit’inde yerel olarak korundu. İki normal Husky/lint-staged Biome kancası geçti; sonrasında 703 kaynak/derleme/kanıt SHA-256 değeri değişmedi ve çalışma ağacı temizdi. Bu teslim kaydı ayrı BACK-824 takip commit’idir.

Salt okunur karşılaştırma taban commit’teki 864 önceki Backlog kaydını doğruladı: 585 completed dosyası ve 10 arşiv kimliği değişikliği dışında beklenmeyen içerik/metadata farkı yok; tek mevcut belge güncellemesi doc-5, yeni görevler yalnız BACK-823/BACK-824. Yerel görev kimliği çakışması yok. Teslim başlangıcında yedeklenen 906 kayıt/kaynak/kanıt dosyası da ilk iki commit sonrasında birebir aynı kaldı. BACK-823/BACK-824 kaynak ve ham kanıtlarında 43, A-07 ham kanıtlarında 5 SHA-256 karşılaştırması geçti; mevcut dist/backlog özeti BACK-823 doğrulanmış binary’siyle eşleşti.

Güncel 6 ilgili test dosyasında 88 başarılı, 0 başarısız ve 1319 beklenti var. İlk sandbox denemesi yerel sunucu açılışında listen EPERM ile durdu; aynı grup izinli ortamda 33,26 saniyede exit0 ile tamamlandı. Tip kontrolü 640 dosyada ve yazmasız Biome 554 dosyada geçti. Tam CI/build/Chromium yeniden çalıştırılmadı; kaynaklar önceki doğrulamayla aynı, bu dar düzeltmenin önceki native build/smoke ve iki tarayıcı kanıtı korunur. Git diff --check yalnız byte-byte korunan eski BACK-41 içeriğindeki üç mevcut sondaki boşluğu bildirir; yeni kaynak/kanıt yollarında yeni whitespace sorunu yok.

Uzak salt okunur git ls-remote kontrolü origin/server için 5b087c6c0d2e0e3436e67da9e747de56bef1382e döndürdü; tasks/server-duplicate-task-ids henüz yoktu. Origin: git@github-backlogmd:vuralbayraklii/Backlog.md.git; gerçek hedef vuralbayraklii/Backlog.md fork’udur. Normal push denemesi SSH/Git çalışmadan otomatik onay denetimiyle reddedildi: denetim, bu commit içeriğinin bu belirli hedefe gönderilmesi için ayrıca açık kullanıcı onayı istedi. Push için alternatif yol denenmedi ve hiçbir uzak dal değiştirilmedi. Sıradaki adım, kullanıcı hedefi/içeriği açıkça onaylarsa mevcut dalı aynı origin/tasks/server-duplicate-task-ids hedefine normal push ile göndermek ve git ls-remote ile son HEAD eşitliğini doğrulamaktır. Merge yapılmadı.

Teslim başlangıç durumu, diff/indeks/refler ve kayıt/kaynak/kanıt arşivi /tmp/backlog-git-delivery-d354sji0 içinde korundu; /tmp kalıcı yedek değildir. Kişisel server-data okunmadı ve hiçbir commit’e alınmadı; önceki özel onarım yedeği yerinde kaldı. FIN-21, Finbee kaynağı, kişisel süreç ve A-08 kapsamı değişmedi. Groma komutu bulunamadı; manifesto ve yönetilen mimari değişmedi.

## BACK-824 — Arşiv görev kimliği onarımı (25 Ekim 2026)

Kullanıcı review sonrasında panodaki Duplicate task IDs: 10 groups across 20 files uyarısının düzeltilmesini istedi. BACK-824 standart CLI allocator ile açılıp @codex üzerine alındı; görev/doküman yazımları CLI ile yapıldı. Başlangıç Git farkları, 902 kaynak/kayıt/kanıt özeti, Backlog kayıtları ve SQLite online yedeği özel erişimli server-data/repair-backups/20261025T090420Z-duplicate-ids-bwggsfme altında korundu. Dizine 0700, dosyalara 0600 erişim verildi; buradaki kişisel veritabanı/yedekler Git teslimine alınmaz. SQLite quick_check ok. Bu yerel onarım yedeği A-08 işletim/geri yükleme provası değildir. Önceki dal tasks/server-legacy-task-filenames üzerinden tasks/server-duplicate-task-ids açıldı; yerel A-07/BACK-823 kayıtları korundu.

Kanonik doctor önizlemesi tam geçici kopyada denendi; sonra aynı doctor --fix --yes gerçek kökte uygulandı. Completed içindeki asıl kayıtlar eski kimliklerini korudu; çakışan archive/tasks kayıtları aşağıdaki yeni kimlikleri aldı. Hiçbir görev silinmedi. CLI aynı işlemde 585 eski completed arşiv kaydını backlog/archive/tasks altına taşıdı. 867 dosyanın tamamı beklenen hedeflerine eşlendi: yalnız 10 frontmatter id alanı değişti, diğer içerik/metadata birebir kaldı. Kapanışta yalnız BACK-824 görev kaydı ve bu devir belgesi ayrıca güncellenir.

| Eski kimlik | Yeniden numaralanan arşiv kaydı |
|---|---|
| BACK-41 | BACK-825 |
| BACK-76 | BACK-826 |
| BACK-81 | BACK-827 |
| BACK-82 | BACK-828 |
| BACK-88 | BACK-829 |
| BACK-89 | BACK-830 |
| BACK-90 | BACK-831 |
| BACK-168 | BACK-832 |
| BACK-275 | BACK-833 |
| BACK-569 | BACK-834 |

Gerçek kökteki salt okunur kaynak taraması 857 geçerli girdi, 0 sorun ve 0 çakışma buldu; 192 aktif, 631 arşiv ve 15 taslak görev var. Eski/yeni 20 kimlik CLI JSON ile arşivlenmiş kayıt olarak okundu. Native sunucu ve Chromium tam onarım öncesi kopyada açıkken aynı CLI onarımı tekrarlandı: önce 10 grup ve BACK-41 için 409 doğrulandı; sonra API grupları/değişiklikleri boş, observation/writeState ready, 20 kimlikli HTTP okuması 200 ve yenilenen panoda uyarı/Review repair düğmesi yok. Doküman menüsü çalışıyor; 9/9 kontrol, runtime exception 0. verification/server/back-824-board-repaired.png gözle incelendi. Kişisel tarayıcı oturumu kullanılmadı ve kişisel sunucu yeniden başlatılmadı; kullanıcı mevcut panoyu yenileyebilir.

Önizlemenin 5 referans satırı incelendi. BACK-570, eski branch-local BACK-569 kaydının yerine geçtiğini tarihsel olarak açıkça söyler; bu eski arşiv kaydı artık BACK-834 ve özgün anlatım korundu. BACK-585 içindeki iki BACK-569 atfının dayandığı 670c5bd7 commit'i Bring Windows CI tests below three minutes kaydıdır; asıl BACK-569 doğru hedef olarak kaldı. Diğer iki satır bu devirdeki eski başlangıç/hata anlatımlarıdır. Çakışan kimlikleri kullanan bağımlılık alanı bulunmadı; tahmini referans değişikliği yapılmadı. Diğer Git dallarındaki eski anlık görüntüler yeniden yazılmadığı için gerçek doctor komutu yalnız cross-branch diagnostic bulgularıyla 1 döndü; onarım ve taşıma tamamlandı, yerel kayıtlarda ve pano API'sinde grup kalmadı. İzole kopyada onarım sonrası doctor 0 döndü.

Kalıcı rapor verification/server/back-824-verification.json; ham kanıtlar /tmp/backlog-id-repair-prcg0efu içinde ve özel kalıcı yedek dizinine kopyalandı. Önceki A-07/BACK-823 dahil 37 kaynak/kanıt dosyasının özetleri başlangıçla aynı. Bu onarım ürün kodu veya binary değiştirmedi; dist/backlog önceki doğrulanmış BACK-823 binary'si (beafaf0e719b983e01e3d295613167f7077af2ff3a321951fe363c680fc02596). Tam CI, tip ve build yeniden çalıştırılmadı; yazmasız Biome 554 dosyada geçti. Özel server-data dizini .gitignore kapsamına alındı; böylece kişisel DB/yedekler Git ve kaynak biçim kontrolünün dışında korunur. Tam git diff --check yalnız taşınan eski BACK-41 içeriğinin 31/61/65 satırındaki özgün sondaki boşlukları bildirir; bu dosya completed kaynağıyla byte-byte aynı, diğer değişen yolların diff kontrolü geçti. Finbee kaynağı, kabul içeriği, hesaplar ve A-08 kapsamı değişmedi. Groma bulunamadı; manifesto ve yönetilen mimari değişmedi. Commit/push/merge yapılmadı.

## BACK-823 — Backlog.md panosunda eski dosya adı uyumsuzluğu (24 Ekim 2026)

Kullanıcı A-07 sonrasında projeyi kullanırken Backlog.md/proje 1 panosunda kırmızı görev/menü hatalarını ve invalid: backlog/completed/back-196-add-nixos-packaging-support.md uyarısını bildirdi; önce bunun incelenmesini istedi. A-08 başlatılmadı. Mevcut A-07 devir/kanıt dosyaları ve server-data korundu. Git başlangıcı tasks/server-a07-finbee-pilot / 5b087c6c; izlenen tek fark doc-5, izlenmeyenler server-data ve a07-finbee-pilot.json idi. Kayıt/diff/ref yedeği /tmp/backlog-dashboard-diagnosis-0onfs9yi içinde alındı; sonra tasks/server-legacy-task-filenames açıldı. BACK-823 standart CLI ile oluşturulup @codex üzerine alındı.

Salt okunur tarama 854 geçerli girdi ve tek geçersiz dosya buldu. BACK-196 CLI ile okunuyor; sunucu gözlemi eski sayısal kimlik-tire-başlık adının tamamını kimlikle karşılaştırıp reddediyordu. Küçük düzeltme yalnız mevcut modern/kısa kimlik denetimi başarısızsa eski sayısal biçimi tanır. Tam/dotted ve baştaki sıfırlar mevcut kanonik karşılaştırmayı kullanır; modern alfasayısal kimlikler, gerçek uyuşmazlık ve bozuk içerik korumaları sürer. Tek üretim dosyasında dört ek satır; yeni helper/store/servis veya arayüz değişikliği yok. Sadelik incelemesi bu dar sınırı korudu.

Tam depo kopyasında eski sürüm beş paralel pano açılış isteğini 9,64–10,01 saniyede; yeni sürüm özgün dosya adıyla 3,13–3,73 saniyede tamamladı. Eski koşuda bu HTTP istekleri de 200 döndü; kişisel tarayıcıdaki Failed to fetch taşıma hatasının birebir sebebi kanıtlanmadı. Tekrarlı başarısız kararlılık taramalarının gecikmesi ve ekran uyarısının kaynağı kanıtlıdır. Yeni ilk tarama ready; 191 görev, 8 belge ve arama/menü APIleri çalışır. Gerçek native Chromium tam kopyada pano/görev/belge menüsü/ready/kimlik reddi/çalışma zamanı olmak üzere 6/6 kontrolü geçti, exception 0. Açık tema ekran görüntüsü verification/server/back-823-board-fixed-light.png gözle incelendi.

Eski kaynakta 3 yeni olumlu regresyon başarısız, tam alfasayısal kimlik kontrolü başarılıydı. Son odaklı grup 79/79, HTTP/ilk envanter/çakışma grubu 9/9; toplam 88 başarılı, 0 hata. Tip 637 dosyada, yazmasız Biome 552 dosyada, native build ve CLI/web/MCP smoke geçti. Tam CI ve platform matrisi bu dar düzeltmede yeniden çalıştırılmadı. Kalıcı kanıt verification/server/back-823-verification.json; ham günlük/harness/yedekler /tmp/backlog-dashboard-diagnosis-0onfs9yi içinde; /tmp kalıcı yedek değildir. Groma bulunamadı; manifesto ve yönetilen mimari değişmedi.

Doğrulanan binary dist/backlog konumuna atomik alındı, SHA-256 beafaf0e719b983e01e3d295613167f7077af2ff3a321951fe363c680fc02596. Önceki binary aynı geçici dizinde previous-backlog olarak korunur. Kişisel sunucu sandbox içinden erişilemiyor; sandbox dışı kimliksiz GET isteğinde HTTP 401 doğrulandı. Kişisel oturum kullanılmadı ve süreç yeniden başlatılmadı. Kullanıcı açık sunucuyu Ctrl+C ile kapatıp aynı veri klasörüyle yeniden açmalı; bu depodaki kayıtlı iki proje ./server-data içindedir. Komut: ./dist/backlog server --data-dir ./server-data start --public-url http://127.0.0.1:6420 --allow-http-loopback. Hesap/proje tekrar oluşturulmaz.

Bağımsız upstream arşiv kimliği sorunu aynı 10 grup/20 dosyadır; pano sarı Duplicate task IDs uyarısını gösterir ve örnek BACK-41 doğrudan okuması 409 AMBIGUOUS_ID kalır. Doctor yalnız önizlemede çalıştırıldı; onarım 10 kimliği yeniden numaralandırıp yüzlerce eski completed kaydını arşiv klasörüne taşıyacağı için uygulanmadı. Eski görev kimlikleri/yolları/içerikleri değiştirilmedi; Finbee ve kişisel hesap/oturum verileri yazılmadı. Kişisel DB'de yalnız kanonik project list okundu. Commit/push/merge yapılmadı; A-07 kabul içeriği korunur. Sıradaki kullanıcı adımı güncellenen binary ile yeniden başlatıp gerçek oturumda panoyu yenilemektir; arşiv onarımı ayrı inceleme konusudur.

## Tamamlanan A-07 — Finbee pilotu ve doğrulanmış insan kabulü (24 Ekim 2026)

Son kabul: Kullanıcı Reviews and verification ekranında Accepted · admin görüntüsünü paylaştı. Aynı anda bağlı CLI ile response #3 / requestId 2 / outcome approved / author.kind user / admin hesabı doğrulandı; kabul zamanı 2026-10-24T11:59:20.528Z. Talep, doğrulama ve yanıt aynı güncel içerikte güvenilir; staleEntryIds boş. A-07 pilot kabulü tamamlandı. FIN-21 durum/not/AC içeriği bu yanıttan sonra değiştirilmedi; insan kabulünü eskitecek bir yazı yapılmadı. A-08 kullanıcı talebiyle başlatılmayacak.

24 Ekim sonraki kullanıcı yönlendirmesi: Kullanıcı Finbee pilotunun geçtiğini bildirdi ve A-08’e geçilmemesini açıkça istedi. Kabulden önceki salt okunur sunucu kontrolünde acceptance talebi #2 için yanıt henüz yoktu; doğrulama #1 ve talep #2 güvenilir/güncel, staleEntryIds boş. Sohbet bildirimi doğrulanmış uygulama kabulü yerine yazılmadı. FIN-21 içeriği değiştirilmedi; A-08 görevi veya çalışması başlatılmadı.

Kullanıcı Finbee’nin /home/vuralbayrakli/projects/finbee kökünde önceden Backlog biçimine dönüştürüldüğünü ve merkezi uygulamaya kaydedildiğini açıkladı; kalan pilot planını onaylayıp başlamamızı istedi. Yeniden dönüşüm veya kayıt yapılmadı. Mevcut proje 2 / Finbee / tracking=true doğrulandı. Finbee FIN-1 tamamlanmış; FIN-21 kalan kaynak, belge/karar ve kimlikli agent kabulünü kapsıyor. FIN-21 @codex üzerine alındı, plan/not/özet kimlikli sunucu CLI’sıyla kaydedildi.

- 29 görevin 15 içerik/plan/not/AC/bağımlılık alanı yerel CLI ile bağlı CLI arasında eşleşti; 65 belge ve 17 karar gövdesi kaynakla aynı (frontmatter hariç, dış boşluklar normalize).
- 807 panel bağlantısının 110 tekil hedefi doğru proje API kaydını açtı; bozuk hedef yok. 198 başlık fragmanı envantere alındı; render kontrolü yeniden koşulmadı. Kullanıcı görev → doc-60 → decision-17 gezinmesini çalışıyor olarak bildirdi; History’deki agent gösteriminin ne olduğunu sordu. Updated · Agent for admin açıklaması verildi; son insan kabulüne görünür tarihçe de dahil edildi. Kişisel tarayıcı oturumu agent tarafından kullanılmadı.
- FIN-21 değişikliği tek source=agent olayı üretti; aktör admin hesabına bağlı anahtar. Aynı özgün revision/UUID ile tekrar ikinci olay veya değişiklik üretmedi; eski revision reddedildi ve kaydı değiştirmedi. Başka proje okuma 404; yönetim erişimi, belge yazma ve agent ile insan yanıtı denemesi 403. Son ret changes-requested kullanır; insan onayı verilmedi ve review kaydı eklenmedi.
- admin hesabına bağlı Finbee Codex pilot anahtarı yalnız proje 2 ve tasksWrite=true taşır; diğer beş yazma izni false. Sır proje dışında /home/vuralbayrakli/.config/backlog/finbee-codex.key dosyasında 0600; rapor/sohbet/Git’e sırrın kendisi yazılmadı. Anahtar kimliği 1913610f-d678-4276-a4ef-5cd311df5ab2; hesap kimliği 78713b32-c3f6-450a-b251-2a84b0e3febf. Hesap/üyelik/parola değiştirilmedi.

FIN-21 İnceleme durumunda, dört AC işaretli. passed doğrulama #1, @admin kabul talebi #2 ve admin insan yanıtı #3 aynı contentHash 1e8f4a520a1a3a08ebedd67ec4109f1c3afc30743cda9e01ba78e0738fa1f11e üzerinde; trustedEntryIds [3,2,1], staleEntryIds boş. Acceptance artık Accepted · admin; açık talep yok. Kullanıcı kabulü doğrulanmış uygulama oturumundan geldi; sohbet veya dosya beyanı yerine kullanılmadı. Kabul, görev durumundan ayrı kayıttır; FIN-21 içeriği/statusu değiştirilirse önceki doğrulama ve kabul eskime koşulları geçerlidir. Sonraki agent bağlı task review list FIN-21 --json ile güncel sonucu okuyabilir.

Kalıcı rapor [a07-finbee-pilot.json](../../../verification/server/a07-finbee-pilot.json). Başlangıç Git farkları/referansları, iki Backlog kayıt arşivi, 1653 Backlog.md + 575 Finbee dosyasının özetleri ve SQLite online yedeği /tmp/backlog-finbee-a07-d5073e5e içinde; /tmp kalıcı yedek ve eşgüdümlü A-08 geri yükleme provası değildir. Önceki Finbee yerel değişiklikleri korundu; başlangıca göre yalnız FIN-21 değişti. Backlog.md’de yalnız devir belgesi ve kabul raporu eklenir. Finans uygulama kaynağı/servisleri/finans DB’ye dokunulmadı; tam CI/build/tarayıcı otomasyonu yeniden çalıştırılmadı. Kaynak kod değişmediği için doğrulama gerçek CLI/API pilotu ve kullanıcı bildirimiyle sınırlı. Groma kurulu değil; manifesto ve yönetilen mimari değişmedi. Commit/push/merge yapılmadı.

## server dalına fast-forward birleştirme — 24 Ekim 2026

Kullanıcı A-07 öncesinde tasks/server-a06-review-history → server birleştirmesini ve GitHub’a gönderilmesini onayladı. Uzak dallar fetch ile yenilendi; yerel/uzak başların eşitliği, server dalının A-06 dalının atası olduğu ve aradaki farkın 15 commit olduğu doğrulandı. git merge --ff-only ile server, 2225c4167234fd300b477cc3207689c8454abed1 başından d95577704859b6a1600f9e3f41d69bf211ea7c1f başına ilerletildi. Çatışma veya yeni merge commit’i oluşmadı; bütün aşamaların commit geçmişi korundu.

Normal git push origin server:server başarılı oldu; git ls-remote uzak refs/heads/server için d95577704859b6a1600f9e3f41d69bf211ea7c1f değerini doğruladı. Birleştirme sonrası server ve A-06 dalının ağaçları birebir aynıydı. Bu kayıt yalnız doc-5’i değiştiren ayrı takip commit’i olarak server dalında korunur. Aşağıdaki önceki teslim bölümlerinde geçen server değiştirilmedi veya merge yapılmadı ifadeleri tarihsel durumdur.

Dal değişiminden önce Git durumu, referanslar, çalışma/indeks farkları ve izlenen Backlog/kabul kayıtları /tmp/backlog-server-merge-kaxt3sqk içinde korundu; records-before.tar.gz SHA-256 eb9a76c97f6bf8d63a7044987cd609aefdd83b0f2c4c4e37779ec878d660f25f. /tmp kalıcı yedek değildir. Başlangıçta izlenen dosyalar temizdi; tek izlenmeyen klasör kişisel server-data idi, okunmadı veya Git’e alınmadı. backlog komutu PATH’te bulunmadığı için mevcut kaynak CLI bun run cli kullanıldı. Groma kurulu değil; mimari tarama yapılmadı.

Kaynak veya kabul raporları değiştirilmedi; test/build/tarayıcı yeniden çalıştırılmadı. Mevcut doğrulama kapsamı ve sınırları korundu. dist/backlog ve kişisel süreç yenilenmedi. A-07 görevi veya dalı açılmadı; sonraki A-07 çalışması güncel server üzerinden yeni özellik dalında yürütülecek, Finbee kaynak ve kabul kapsamını kullanıcı belirleyecek.

## A-06 ve BACK-820–822 Git teslimi — 24 Ekim 2026

Kullanıcı son değişikliklerin uygunluk kontrolü ardından commit ve push yapılmasını açıkça onayladı. A-06 BACK-814–819 ve BACK-820/BACK-821/BACK-822 düzeltmeleri, kaynaklar ve kabul kayıtları e239ceab35a97055c255b20dad03be2ae263bcda uygulama commit’iyle origin/tasks/server-a06-review-history dalına normal push ile gönderildi. git ls-remote uzak dalın aynı commit’i taşıdığını doğruladı. Aşağıdaki uygulama kayıtlarındaki commit/push yapılmadı ifadeleri tarihsel durumu anlatır. Bu teslim kaydı ayrı bir BACK-822 takip commit’idir; origin/server değiştirilmedi.

Uygunluk denetimi BACK-820 tam CI kaynak manifestinin SHA-256 değerini kayıtlı 7e020e7d18c32824644db1accbd2441172f39770e318073407228bfb20b430f4 ile eşleştirdi. BACK-821 ve BACK-822 dosya özetleri bu manifest üzerine sırayla uygulandı; 662 kaynak/derleme girdisinin tamamı mevcut kaynakla birebir aynı, ek/eksik src dosyası yok. Birleşik manifest SHA-256 4238d1ec03be82004bc49909823d49adb1b5c189738b32bc4d2fc9a1f45efecc. BACK-820/821/822 ham kanıt dosyalarının 48 özeti ve A-06 üç ekran görüntüsü doğrulandı. Normal Husky/lint-staged Biome kancası geçti; commit sonrasında kaynak ve kabul dosyalarının değişmediği tekrar doğrulandı. git diff --check geçti.

Kaynak değişmediği için test/build/tarayıcı yeniden çalıştırılmadı. Korunan kanıtlar: BACK-820 tam CI 4018 başarılı / 13 atlanan / 0 hata ve gerçek Chromium 10/10; BACK-821 odaklı 278 başarılı / 1 mevcut PTY atlaması / 0 hata; BACK-822 odaklı 218 başarılı / 0 hata / 0 atlama. Son iki düzeltmede tam CI/Chromium yeniden koşulmadığı sınırı korunur. Kabul raporları tarihsel kanıt olarak değiştirilmedi.

Teslim öncesi diff, indeks ve kişisel server-data hariç izlenmeyen kaynak/kayıt yedeği /tmp/backlog-a06-git-delivery-prqf3t99 içinde korundu; /tmp kalıcı yedek değildir. Kişisel server-data okunmadı ve Git teslimine alınmadı. Groma kurulu değil; manifesto/yönetilen mimari değişmedi. dist/backlog hâlâ BACK-820 binary’sidir; BACK-822 doğrulanmış binary /tmp/backlog-review-three-lsr_rl80/backlog içindedir. Bu Git teslimi binary kurulumunu veya kişisel sürecin yeniden başlatılmasını içermedi. Gerçek Finbee ve A-07 kapsamına geçilmedi.

## BACK-822 — İnceleme talep bağları ve serileştirme (23 Ekim 2026)

Kullanıcı üç review bulgusunu tek tek doğrulayıp gerçek hataları en küçük değişikliklerle düzeltmemizi istedi. BACK-822 standart CLI ile oluşturulup @codex üzerine alındı. Mevcut dal ve yerel çalışmalar korundu; başlangıç diff/indeks/izlenmeyen kayıt yedeği /tmp/backlog-review-three-lsr_rl80 içinde. Kişisel server-data okunmadı.

- P1 doğrulandı: review listesi temizlenip yeni doğrulanmış talep aynı numarayı kullandığında eski doğrulanmış yanıt veya iptal yeni kabul talebini kapatıyordu. Güven taraması artık referans verilen güncel talebi, yanıt/iptalin kimliğini doğrulayan olayın özgün talep görüntüsüyle karşılaştırır. Sahte bağ bekleyen talebi kapatmaz; atanmış insanın gerçek yanıtı kapatır. Önceki talep türü değiştirme testi de yanıtın güvenini reddedecek biçimde güçlendirildi.
- P2 doğrulandı: boş işaretli AC ve DoD bölümleri serializer tarafından kaldırılıyor, önceden hesaplanmış içerik özeti hemen eski kalıyor ve gerçek insan yanıtı HTTP 409 alıyordu. Tek ortak review içerik özeti mevcut serializer/parser roundtrip sonucundan hesaplanır; serializer ve revizyon yazıcısı değiştirilmedi. Yerel Core ve gerçek HTTP yolları ikisi için de kanıtlıdır.
- P2 doğrulandı: YAML nesne anahtar sırasını değiştirmek, iç içe author/reviewer alanları dahil, tamamlanmış kabulün güvenini siliyordu. Karşılaştırma node:util isDeepStrictEqual kullanır; anahtar sırası önemsiz, değerler ve dizi sırası anlamlıdır. Gerçek değer değişiklikleri güven kazanmaz.

Eski kaynakta 8 regresyon başarısız oldu; 7 yeni test ve 1 güçlendirilmiş test bu kanıtı korur. Son ilgili test grubu 13 dosyada 198 başarılı / 0 hata / 0 atlama; iki DOM dosyasında 20 başarılı / 0 hata. Toplam 218 başarılı. Tip 637 dosyada, yazmasız Biome ve diff kontrolü geçti. Geçici test CLI paketi ve native binary derlendi; derlenmiş CLI/web/MCP smoke geçti. Tam CI ve native Chromium bu dar düzeltmede yeniden çalıştırılmadı. Gerçek HTTP/alt süreç/kesinti testleri yalnız geçici projelerle sandbox dışında koştu; sandbox içindeki ilk yerel CLI denemesi blessed hatası verdi, son paketli CLI testleri geçti.

Kalıcı kanıt verification/server/back-822-verification.json; ham günlükler, başlangıç yedeği ve doğrulanmış native binary /tmp/backlog-review-three-lsr_rl80 içinde. /tmp kalıcı yedek değildir. Sadelik incelemesi iki üretim dosyasında mevcut güven hesabı ve ortak serializer/parser ile sınırlı kaldı; yeni servis/depo/şema/dış API/UI yok. Groma kurulu değil; manifesto/yönetilen mimari değişmedi. dist/backlog ve kişisel süreç yenilenmedi; gerçek Finbee, commit/push/merge ve A-07 kapsam dışı kaldı.

## BACK-821 — İnceleme güveni ve taslak yaşam döngüsü (23 Ekim 2026)

Kullanıcı iki review bulgusunun tek tek doğrulanmasını ve gerçek hataların en küçük gerekli değişikliklerle düzeltilmesini istedi. BACK-821 standart CLI ile oluşturulup @codex üzerine alındı. Önceki yerel A-06 değişiklikleri ve mevcut dal korundu; başlangıç diff/indeks/izlenmeyen kayıt yedeği /tmp/backlog-review-validation-he_6qq15 içinde. Kişisel server-data okunmadı.

- P1 doğrulandı: genel inceleme onayından sonra talep türü dosyadan acceptance yapılınca gerçek API talebi güvenilmeyen, eski yanıtı güvenilir ve güncel buluyor; önceki DOM yanlış Accepted gösteriyordu. Kabul özeti artık yalnız güvenilir ve güncel talebin türünü kullanır. Gerçek doğrulanmış kabul görünmeye devam eder.
- P2 doğrulandı: kimliği yeniden kullanan yerel demote/edit/revert/promote akışı dedicated, edit ve filesystem yollarının üçünde de eski incelemeyi onaylıyordu. Revizyon denetimi FileSystem saveTask/saveDraft içinde tek özel yardımcıya taşındı; yaşam döngüsü yazımları önceki kaydı sağlar ve ContentStore sarmalayıcısı bu kaydı iletir. Taslak düzenleme, geçişler ve referans temizliği ortak yazım davranışını kullanır. Eski kimlik yazımları karşılaştırmada normalleştirilir; yalnız workflow değişikliği revizyonu ilerletmez.

Eski kaynakta bir DOM ve üç yerel regresyon başarısız oldu. Son ilgili testler: 14 dosyada 258 başarılı / 1 mevcut PTY atlaması / 0 hata; iki DOM dosyasında 20 başarılı / 0 hata. Toplam 278 başarılı, 1 atlanan. Tip 637 dosyada; yazmasız Biome 549 dosyada ve ayrıca iki ilgili TSX dosyasında sıfır tanıyla geçti. diff kontrolü, geçici native build ve derlenmiş CLI/web/MCP smoke başarılı. Tam CI ve native Chromium bu dar düzeltmede yeniden çalıştırılmadı. Kalıcı kanıt verification/server/back-821-verification.json; ham kanıtlar başlangıç yedeğiyle aynı /tmp dizininde.

Sadelik incelemesi revizyon denetimini dört üretim dosyasındaki küçük değişikliklerle tek ortak kaydetme yolunda tuttu; yeni servis/depo/dış API yok. Groma kurulu değil; yönetilen mimari ve manifesto değişmedi. Doğrulanan binary /tmp/backlog-review-validation-he_6qq15/backlog konumunda; dist/backlog önceki BACK-820 binary'sidir, bu görevde güncellenmedi. Kişisel süreç yeniden başlatılmadı; gerçek Finbee, commit/push/merge ve A-07 kapsam dışı kaldı.

## BACK-820 — A-06 inceleme düzeltmeleri (23 Ekim 2026)

Kullanıcı dört inceleme bulgusunun commit/push öncesi düzeltilmesini istedi. BACK-820 standart CLI ile oluşturulup @codex üzerine alındı; mevcut özellik dalı korundu. Başlangıç diff/indeks ve izlenmeyen kayıtlar /tmp/backlog-a06-review-fixes-5s563zua içinde korundu. Commit/push/merge yapılmadı; origin/server değiştirilmedi.

- Proje ve Projects özetleri geçmişi istek içinde tek sayfalama geçişinde kalıcı recordKey ile gruplar; yol/kimlik indeksi bir kez yüklenir. Görev görünümü bekleyen talep başına tekrar hesaplanmaz. Tekil detay ve özet aynı güven/eski içerik hesaplamasını kullanır. Gerçek geçici SQLite üzerinde aynı 1000 görev/1000 olay: önce 8774,08 ms, 2000 geçmiş okuması ve 2000 view; sonra 421,16 ms, 10 sayfa okuması ve 1000 view. Sonuçlar birebir aynı; yaklaşık 20,8 kat hızlanma. Bu tek yerel ölçüm yalnız özet hesabıdır; proje gözlemi, görev yükleme ve HTTP süresi dışarıdadır.
- Güncel doğrulama özeti staleEntryIds denetimini kullanır; dış içerik değişip geri alındığında eski Passed gösterilmez. Eski kayıt geçmişte okunur, kabul eski kanıtla açılmaz.
- Görev penceresi kapanışı koruyucunun varlığı yerine mevcut kirli kayıt onayını çağırır. Temiz önizleme onaysız kapanır; gerçek inceleme taslağı ve görev düzenlemeleri iptalde korunur.
- Bağlı komutlar Commander optsWithGlobals ile bütün üst komutların seçeneklerini alır. Gerçek CLI testinde task --json review list/request/verify/respond sürümlü JSON üretir; native agent komutları da doğrulandı.

Dört bulgu eski kaynakta başarısız regresyonlarla yeniden üretildi. Son tam CI: 4018 başarılı / 13 atlanan / 0 başarısız; 4031 test, 21161 beklenti. Tip 637 dosyada geçti; yazmasız varsayılan Biome, diff kontrolü, native build ve derlenmiş CLI/web/MCP smoke geçti. Varsayılan Biome TSX kapsamı dışında kalır; aynı kurallarla dört ilgili TSX karşılaştırmasında önce 15, sonra 14 hata ve değişmeyen 4 uyarı var; yeni tanı yok. Tam CI sırasında yalnız biçimsel bir satır kısaltması yapıldı; ilgili DOM aşaması son kaynağı okudu ve yeniden derlenen beş minified çıktı test paketine byte-byte eşit bulundu.

Gerçek native Chromium 10/10, runtime0 ve API yanıtı taklidi yok: üst JSON, Projects talebi, temiz kapanış, gerçek inceleme taslağında iptal/onay, gözlenmiş dış değişiklik+geri alma, güncel özet/geçmiş ayrımı ve görev düzenlemesini koruma. İki önceki harness denemesinde selector yazımı düzeltildi; uygulama kaynağı değişmedi. Son başarılı sonuç raporda korunur.

Kalıcı kanıt [back-820-verification.json](../../../verification/server/back-820-verification.json). Kaynak manifesti 662 girdi; SHA-256 7e020e7d18c32824644db1accbd2441172f39770e318073407228bfb20b430f4. Derlenmiş doğrulanmış binary dist/backlog konumuna atomik alındı; SHA-256 47679a797a06af5eb39b486f2639e5499ddaa217c889682386ab5ee20b223587. Önceki binary /tmp/backlog-a06-review-fixes-5s563zua/previous-backlog içinde. Kişisel süreç yeniden başlatılmadı; kullanıcı aynı data-dir/start komutuyla yeniden açınca düzeltmeler görünür. Kişisel DB ve gerçek Finbee açılmadı/değiştirilmedi; A-07 başlamadı.

Sadelik incelemesi mevcut tarihçe deposu, tek güven hesabı, mevcut kirli kayıt hook'u ve Commander API'sini korudu; yeni kalıcı önbellek, store veya servis yok. Groma komutu bulunamadı; manifesto/yönetilen mimari dosyaları değişmedi. 13 platform/PTY atlaması başarı sayılmaz. Ham günlük/fixture/harness/yedekler /tmp/backlog-a06-review-fixes-5s563zua altında; /tmp kalıcı yedek değildir.

## Tamamlanan A-06 — geçmiş, benden beklenenler ve insan kabulü (23 Ekim 2026)

Kullanıcı bu konuşmada planı ve uygulamayı onayladı. Görevler standart CLI allocator ile oluşturulup @codex üzerine alındı ve kanıtla kapandı. Başlangıç temizdi; /tmp/backlog-a06/start-records.tar.gz korunarak yeni dal açıldı. Commit/push/merge yapılmadı; origin/server değiştirilmedi.

| Görev | Sonuç |
|---|---|
| BACK-814 | Markdown review listesi, içerik geri almalarını koruyan review_revision, parser/serializer/Core ve yerel CLI |
| BACK-815 | Aynı ServerClient üzerinde origin bağlı owner-only insan oturumu; login/password/logout ve eksik bağlantıda yerel göç engeli |
| BACK-816 | Ortak API/CLI request/verify/respond/cancel; güncel atama/izin, RO insan yanıtı, agent ret ve dış beyan ayrımı |
| BACK-817 | Tek history sorgusunda tarih/kişi/action/source ve sayfalama; pano/CLI aynı işlem sınıfları |
| BACK-818 | Mevcut modal/proje Geçmiş ve Projects atanmış talepler/özetler; koyu-açık, 390px ve klavye |
| BACK-819 | Birleşmiş tam CI, native/Chromium, kalıcı kabul ve devir |

Ürün kararları doc-8'de kapalıdır: esas workflow Markdown; SQLite hesap ve değiştirilemeyen tarihçe. Göreve bağlı review/decision/acceptance; belge/karara ayrı workflow yok. Hedef açık hesap, assignee'den türetilmez. Yalnız atanmış insan kendi oturumuyla yanıtlar; read-only üye yanıtlayabilir. Admin başkası yerine kabul vermez, iptal+yeni taleple yeniden atar. Agent görev yazma yetkisiyle talep/doğrulama yapar, insan yanıtı vermez. Kabul aynı içerikte son güvenilir başarılı veya gerekçeli uygulanmaz doğrulamasına bağlıdır. Genel inceleme/karar bağımsızdır. İçerik değişip geri alınsa da eski sonuç canlanmaz; workflow/otomatik zaman/pano sırası dışarıda kalır. Done ayrı, commit isteğe bağlı; kod/kanıt hedefleri izlenmez. Dış dosya sonucu beyan olarak kalır, doğrulanmış kabul veya talep kapanışı sayılmaz.

Mevcut parser/serializer/Core, prepared writer, UUID/revision, kuyruk, kesinti kurtarması ve ContentStore kullanıldı. Kalıcı ikinci workflow store, yeni servis veya MCP aracı yok. Tek içerik karşılaştırması bekleyen yapılandırılmış alanları da kapsar; altı geri alma ve native yerel CLI kanıtlıdır. Aynı saf review kuralı commit yetki recheck'inde kullanılır. İki agent anahtarının sahipliği ayrıdır; admin rol kaybı, açık @username ve CLI metin/JSON beyan ayrımı testlidir. Tarihçe kalıcı recordKey ile okunur; eski kaydın bağlantısı yeniden oluşturulmuş başka kaydı açmaz. Dış occurredAt bilinmiyorsa null, detectedAt gerçek UTC; İstanbul gösterimi korunur. No-op/retry/self-event ikinci olay üretmez.

Son sabit kaynak: tam CI 4014 başarılı / 13 atlanan / 0 hata; 4027 test, 21136 beklenti. Tip 637 dosyada geçti; varsayılan yazmasız Biome, native build/CLI-web-MCP smoke ve gerçek Chromium 30/30 runtime0 geçti. Kanıt verification/server/a06-verification.json.

Sabit kaynak 662 girdi; SHA-256 b018988839bcbe3fbb616f0a8abd746457cd43d29d7e9c785445b87e462b576b. Native SHA-256 5933031b494e5ad3f9d70225e84f26c516bfa4c3ea9648baf6efaf3314941b9b. Kaynak build/test/browser sonrasında aynı. Değişen beş eski TSX'te aynı kurallarla önce60 hata/6 uyarı, sonra60 hata/6 uyarı; yeni tanı0. Üç yeni TSX temiz; kalıtımlı borç temiz tarama değildir. Önceki tanı/odak koşuları tam CI toplamına eklenmedi. 13 mevcut platform/PTY atlaması başarı sayılmaz.

Gerçek Chromium API yanıtı taklidi olmadan 30 kontrol/runtime0: RO kabul, canlı/stale taslak, belge kanıtı, mevcut formdan talep, iki proje/404, pano Updated sınıfı, dış unknown/detected geçmiş, silme/recreate kimlik engeli, native insan CLI, yerel geri alma, koyu-açık, 390px görev+Projects ve gerçek Tab odağı. Üç PNG verification/server altındadır ve gözle incelendi. Tam koşu yedi gerçek SIGKILL durumunu içerir; RO insan kabulü yeniden açılışta tek sonuç/olaydır.

Doğrulanmış binary dist/backlog'a atomik alındı; önceki binary /tmp/backlog-a06/previous-backlog içinde. Kişisel uygulama/DB ve gerçek Finbee açılmadı/değiştirilmedi; süreç yeniden başlatılmadı. Kullanıcı aynı --data-dir ve start komutuyla yeniden açınca özellikler görünür; admin yeniden oluşturulmaz. Ham kanıt/fixture/JUnit/manifest/harness /tmp/backlog-a06 altında; /tmp kalıcı yedek değildir. Groma yok; manifesto/yönettiği dosyalar değişmedi.

## A-05 ve BACK-813 Git teslimi — 23 Ekim 2026

Kullanıcı bu konuşmada commit ve push yapılmasını açıkça onayladı. A-05 BACK-807–812 ve BACK-813 düzeltmeleri 5d8761e3b09cb906a5f9908f53b79e8661168a44 uygulama/kabul commit’iyle origin/tasks/server-a05-agent-observation dalına normal push ile gönderildi; git ls-remote aynı commit’i doğruladı. Önceki commit/push yapılmadı ifadeleri aşağıdaki tarihsel uygulama kayıtlarına aittir; güncel teslim durumu bu bölümdedir. Bu teslim kaydı ayrı bir BACK-813 takip commit’idir.

Commit öncesi ve pre-commit kancası sonrasında 645 kaynak/derleme girdisinin özeti güncel kabul raporuyla birebir eşleşti: c5334e793b662ed845a7ac4e1d980b4b72eab8833581a8c21b9ac9b0d52f8b62. dist/backlog SHA-256 c72c754738aaff6484faada2d1a71ad265040408de3cc1f2fe8d560052cbd865 ve üç A-05 ekran görüntüsü de raporlarıyla eşleşti. Git diff kontrolü ve normal Husky/lint-staged Biome kancası geçti; uygulama kaynakları değişmedi. Bu nedenle önceki tam CI 3973 başarılı / 13 atlanan / 0 hata ve gerçek Chromium 28/28 kanıtı geçerlidir; testler bu Git teslimi için yeniden çalıştırılmadı. Kabul raporları tarihsel kanıt olarak değiştirilmedi.

Teslim öncesi yerel diff, indeks ve izlenmeyen dosyalar /tmp/backlog-a05-git-delivery-_95tuw2q içinde korundu; /tmp kalıcı yedek değildir. Groma komutu bulunamadı; yönetilen mimari dosyaları değiştirilmedi. Sistem SSH yapılandırmasındaki izin sorunu için yalnız bu Git çağrılarında ssh -F /dev/null ile mevcut github.com/git/id_ed25519_backlogmd eşlemesi açıkça kullanıldı; host anahtarı kontrolü korundu ve kalıcı SSH/Git yapılandırması değiştirilmedi.

Kişisel uygulama süreci yeniden başlatılmadı. A-06 görevleri açılmadı; kullanıcı geçmişi, benden beklenenler ve doğrulama/kabul akışı sonraki kapsam kararıdır.

## BACK-813 — A-05 inceleme düzeltmeleri (23 Ekim 2026)

Kullanıcı dokuz inceleme bulgusunun düzeltilmesini istedi ve commit/push için uygun bulmadığını belirtti. BACK-813 @codex üzerine alındı; mevcut yerel değişiklikler /tmp/backlog-review-fixes/before.patch ve before-untracked.tar.gz ile korundu. Aynı özellik dalında düzeltildi.

- Kimlik çözümü istek/toplu precondition başına tek doğrulanmış gözlem görüntüsü ve yol indeksi kullanır. Aynı 1000 kayıt ve 2,29 MB içerikte eski algoritma 11.32 saniye, yeni 13.43 ms; yükleme 1000→1, kimlikler eşit. Bu yalnız kimlik çözümü ölçümüdür.
- Yeni handler, bozuk dosyayla açılışta bile kalıcı son güvenilir görüntüyü liste/aramaya yayınlar. Kuyrukta handler yenilenirse yayın hedefi yeniden çözülür. İki HTTP restart ve gerçek native Chromium restart kontrolünde güvenilir kayıt görünür; bozuk detay/yazma503 kalır.
- Bağlı search/doc search query gönderir. ServerClient dizi filtrelerini ayrı type/status/excludeStatus/project/modifiedFile parametreleri olarak aktarır; API taskType değerlerini ortak yapılandırma resolverı ile doğrulayıp uygular.
- Açık içerikli belge güncellemesi istemcide güncel revision okumasına takılmaz; özgün revision/UUID sunucuya gider. CLI→MCP tekrar, stale yeni edit ve farklı retry body reddi kanıtlıdır. Milestone rename/archive/remove özgün ad/ID ile aynı sunucu replay yoluna gider; CLI/MCP aktif kayıt çözümleme kopyaları kaldırıldı. Boşluk içeren adlar decode edilir; precondition belirsizliği kapalı tutar. Altı CLI/MCP durumunda tek sonuç/olay kanıtlıdır.
- Karar listesi JSON/metinde recordKey ve revision korur; JSON ortak list window ile max-count/skip/total/nextSkip uygular; count mevcut sözleşmeye uyar.

Son sabit kaynakta resmî tam CI 3973 başarılı / 13 atlanan / 0 başarısız; 3986 test, 360 dosya, 20942 beklenti. Tip623, yazmasız Biome, native build/test CLI paketi ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium28/28, runtime0; API yanıtı taklidi yok. Kalıcı kanıt [back-813-verification.json](../../../verification/server/back-813-verification.json); komutlar, dosya/günlük özetleri ve sınırlar buradadır. Kaynak manifesti src ve beş derleme/test girdisi toplam645 dosyayı kapsar; SHA-256 c5334e793b662ed845a7ac4e1d980b4b72eab8833581a8c21b9ac9b0d52f8b62; kontrollerden sonra değişmedi.

Sadelik incelemesi tek resolver, tek ServerClient, mevcut SearchService/list-window/JSON ve sunucu yazım yolunu korudu; yeni kalıcı önbellek, depo veya servis katmanı eklenmedi. Groma yoktu; manifesto/yönetilen mimari dosyaları değişmedi. Yalnız geçici projeler kullanıldı. Ham kanıt /tmp/backlog-review-fixes altındadır; kalıcı yedek değildir. Mevcut13 platform/PTY atlaması başarı sayılmaz.

Doğrulanmış binary dist/backlog konumuna atomik alındı; önceki binary /tmp/backlog-review-fixes/previous-backlog içinde korundu. Kişisel süreç yeniden başlatılmadı; aynı data-dir/start komutuyla yeniden açınca düzeltmeler kullanılır. Commit/push yapılmadı. A-06 kapsamı önceki kayıtta olduğu gibi sonraki kullanıcı kararıdır.

## Tamamlanan A-05 — yerel agent erişimi ve dış dosya gözlemi (23 Ekim 2026)

Kullanıcı doc-7 planını onaylayıp uygulamayı istedi; ayrıca sunucu teriminin mevcut makinedeki Backlog.md süreci olduğunu netleştirdi. Ayrı makine/servis kurulmadı. Üç mevcut alt ajan depo (@codex-store), gözlem (@codex-core) ve web/MCP (@codex-web) dilimlerini; ana ajan (@codex) merkezi API/CLI/istemci, entegrasyon ve kabulü tamamladı. Core ajanının son iki test fixture düzeltmesi ana ajan tarafından tamamlandı. Tüm görevler CLI üzerinden atanıp planlandı ve kanıtla kapatıldı.

| Görev | Sonuç |
|---|---|
| BACK-807 | SQLite v5, kullanıcıya bağlı hash anahtarlar, açık grants ve atomik gözlem/denetim deposu |
| BACK-808 | Güvenli ham envanter, güçlü taşıma eşlemesi, kalıcı gözlem sonrası yayın ve startup/watcher/30s yaşam döngüsü |
| BACK-809 | Aynı proje handlerlarında Bearer, güncel yetki ve operasyon sahipliği; admin anahtar CLI/API ve gözlem bağlantısı |
| BACK-810 | Ortak ServerClient, mevcut etkileşimsiz CLI ve 24 isteğe bağlı MCP aracı; açık revision/UUID ve doğrulanmış sonuç |
| BACK-811 | Mevcut Users içinde anahtar yönetimi; Projects/pano içinde kontrol durumu, durmuş yazmalar ve İstanbul zamanı |
| BACK-812 | Birleşmiş CI, native CLI/web/MCP, gerçek Chromium ve kesinti kabulü |

Anahtarlar kullanıcıya bağlıdır; etkin izin açık grants ile sahibinin güncel izinlerinin kesişimidir. Admin sahibi bile anahtara yönetim/config yetkisi vermez. Ham sır yalnız ilk yanıttadır; sonraki liste/iptal/replay sonucu güvenli metadata içerir. Pasifleştirme ve admin parola sıfırlaması anahtarları kalıcı iptal eder. Grants değişimi iptal+yeniden oluşturma; varsayılan süre sonu yoktur. HTTP create {key,secret}, replay {key}; revoke If-Match korumalıdır. Yönetim CLI server agent-key create/list/revoke mevcut --data-dir kullanır.

Bağlantılı CLI --server-url/--server-project/--agent-key-file ile yerel root/config dönüşümünden önce seçilir. HTTP yalnız açık loopback izniyle çalışır; bağlantı hatası yerel dosyalara yazmaya düşmez. Okunan revision açık --if-match/MCP girdisidir; her yazı UUID kullanır. Kayıp network/body yanıtı ancak kimliği doğrulanan operation GET requestHash'i gönderilen kanonik isteğin hash'iyle eşleşirse başarı kabul edilir. Farklı içerikle aynı UUID veya arada iptal edilmiş erişim eski sonucu yeni başarı gibi göstermez; belirsiz sonuçta işlem kimliği korunur. JSON watch, filtreler, arama ve çıktı yardımcıları yeniden kullanılır. MCP sabit proje ve aynı istemci üzerinde stdio adaptörüdür; roots hedefi değiştirmez. TUI/editör/Git/yerel bakım/config write uzak çalıştırılmaz.

Gözlem mevcut reader/parser/kimlik/güvenli yol kodunu kullanır. Geçerli/yok/bozuk/erişilemeyen/kararsız dosya ayrılır; parser skip silme sayılmaz. İlk A-05 güvenli tarama takip başlangıcıdır; önceki dış hareketler geriye dönük üretilmez. Sonraki fark, record metadata, olay ve checkpoint tek SQLite transaction'ındadır. Dış aktör unknown, occurredAt null, detectedAt gerçek UTC gözlem zamanıdır. Güçlü tekil dosya kimliğiyle taşıma recordKey'i korur; ID/içerik benzerliği yeterli değildir. Belirsiz yeni yol ve gözlenmiş silme sonrası recreate yeni kimlik alır; normal atomik save kimliği bölmez. İç yazı/finalize checkpoint'i de ilerletir; watcher ikinci dış olay üretmez.

Yalnız gerçek Backlog dizini recursive izlenir; başlangıç, dosya bildirimi ve 30 saniye kontrolü browser kapalıyken de çalışır. Değişmeyen güvenli envanter tek kontrol noktası güncellemesiyle doğrulanır; değişen dosyada kararlılık tekrar okunur. Takip kapatma/kapanış yarışları transaction ve proje kuyruğunda denetlenir. Bozuk Markdown ilgili projeyi yazmaya kapatır, güvenli list/search son geçerli hali uyarıyla sunar; değişmiş bozuk detay503, güvenilmeyen fiziksel sınır hard503 olur. Başarılı tam kontrolde yazma otomatik açılır. observation durumu A-04 recovery_required engelinden ayrıdır. Kayıtlar, arama, cache ve WS mevcut ContentStore/pano yolundadır.

### Son kabul kanıtı

- Resmî tam CI profili: 3.967 başarılı, 13 atlanan, 0 başarısız; toplam 3.980 test, 360 dosya, 19.855 beklenti. Non-DOM 3.494/13/0 (315 dosya, 338,54s), DOM 473/0/0 (45 dosya, 34,76s). Komut ve iki JUnit verification/server/a05-verification.json içindedir; kısmi/odak koşuları bu toplama eklenmedi.
- Tip 623 dosyada 0 hata; varsayılan yazmasız Biome 534 dosyada geçti. Değişen/yeni 23 TSX aynı kurallarla ayrıca karşılaştırıldı: başlangıç159 hata/41 uyarı/5 bilgi, son158 hata/39 uyarı/5 bilgi; yeni tanı0. Kalıtımlı TSX borcu temiz tarama sayılmadı.
- Native build, CLI test paketi ve derlenmiş CLI/web/MCP smoke geçti. Gerçek native Chromium 27/27 ve runtime0: kullanıcı/admin, anahtar tek gösterim/iptal, aynı anahtarla native CLI+MCP read/edit, dış olay, bozuk dosyada yazma durması/onarım, mevcut Kanban ve koyu/açık390px akışı. API yanıtı taklidi yoktur. Altı gerçek SIGKILL/kurtarma testi tam koşuda geçti; completed recovery dış watcher olayı üretmedi.
- Son 653 kaynak dosyası özeti 10534e03c96a52895b0f0602a38011fed4de64a7306b8cc064961744ac06b2d2; build/test/browser sonrası aynı kaldı. Native SHA-256 b9ec89cc1a8464428d99c27b9b6cc262d4e187ef224466ce5cdef77c65246f3b.

Kalıcı kabul raporu verification/server/a05-verification.json; PNG'ler a05-board-degraded-dark.png, a05-agent-keys-mobile-light.png ve a05-projects-degraded-dark.png aynı klasördedir ve gözle incelendi. Ham günlük/JUnit/manifest/harness /tmp/backlog-a05 altındadır; /tmp kalıcı yedek değildir. Başlangıç kayıtları start-records.tar.gz ile korundu. İlk tanı tam koşusunun10 hatası yeni DTO beklentileri, ayrı internal Core fixture cache'i, JS test paketi asset çalışma dizini, ham SQLite worker commit yarışı ve ara UI kopya değişikliği kaynaklıydı; nihai sabit kaynak tam CI0hata ile doğrulandı. Native ilk tanı, global --allow-http-loopback bayrağının start alt komutunu gölgelemesini buldu; aynı kullanıcı komutunun gerçek CLI/native testiyle düzeltildi.

Sadelik: tek mevcut Core/prepared writer/SQLite politikası, tek proje dispatch ve ServerClient/kanonik hash/JSON-watch döngüsü; mevcut AppFrame/tema/yetki kontrolleri. Yeni pano veya ikinci görev modeli eklenmedi. Groma yoktu; manifesto/yönetilen mimari dosyaları değişmedi. Yalnız geçici projeler kullanıldı; gerçek Finbee veya kişisel veritabanı ajan tarafından açılmadı/değiştirilmedi. Ortak kilide katılmayan dış yazıcıların bütün ara hareketleri/çok dosyalı atomikliği garanti edilmez; eksik güçlü dosya kimliği yeni kimliğe düşer. Mevcut13 platform/PTY atlaması başarı sayılmaz.

Doğrulanmış yeni binary dist/backlog konumuna atomik alındı; önceki binary /tmp/backlog-a05/previous-backlog içinde korunur. Çalışan kişisel süreç yeniden başlatılmadı. Kullanıcı aynı --data-dir ve localhost start komutuyla yeniden başlatınca A-05 ve SQLite yükseltmesi devreye girer; admin tekrar oluşturulmaz. A-05 değişiklikleri tasks/server-a05-agent-observation dalında yerel, commit/push yapılmadı. Sıradaki aşama A-06 kullanıcı geçmişi/inceleme/kabul akışıdır; görevleri henüz açılmadı.

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
- Geliştirme tabanı: `server`. Kullanıcı bu dalı belirtilen commit’ten açtı. 24 Ekim 2026’da A-06 dalının 15 commit’i fast-forward ile alındı; `origin/server` başı `d95577704859b6a1600f9e3f41d69bf211ea7c1f` olarak doğrulandı. Bu devir kaydı ayrı takip commit’idir; son HEAD’i Git’ten doğrula.
- A-01.3 dalı (tarihsel): `tasks/server-a013-open-project-board`; `origin/tasks/server-a013-open-project-board` dalını izler. Önceki kayıtlar korunarak açıldı; A-01.3 başlangıç yedeği `/tmp/backlog-a013-start.tar.gz`. Uygulama commit’i `ed051888e0dc8835956ae2079d454df682b3263b` uzak özellik dalına gönderildi. `origin/server` sabit kaynak commit’inde kaldı.
- Fork’un `main` dalı, ilk incelemede kaynak commit’in 12 commit ilerisindeydi. `main` kendiliğinden yeni geliştirme tabanı yapılmayacak.
- Sabit commit’in `package.json` sürümü `1.53.0`. Bu mevcut upstream metaveri tutarsızlığı raporda kayıtlı; kaynak sabitlemesi commit üzerinden yapılıyor.
- Tarihsel A-01.3 kapanışında A-00–A-01.3 görevleri, raporları, plan/devir belgeleri ve kaynaklar yalnız özellik dalına gönderilmişti. Güncel durumda A-00–A-06 bütünü `server` ve `origin/server` içindedir; dal başını `git status` ve `git log` ile doğrula.
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

A-00–A-07 tamamlandı; Finbee FIN-21 kullanıcı kabulü korunur. A-08 kullanıcı talebiyle başlatılmayacak. Güncel yerel dal tasks/server-duplicate-task-ids üzerinde c7cb6989 ve b70f859d uygulama/kayıt commitleri ile ayrı teslim takip commit’i var; başlangıç tabanı 5b087c6c. BACK-824 sonrası yerel görev kimliği çakışması yok, eski completed dosyaları kanonik arşiv klasöründe. Push otomatik onay denetimince reddedildi; hedef ve içerik için açık kullanıcı onayı bekleniyor. Merge yapılmadı. Yeni iş veya diğer dalları onarma kendiliğinden başlatılmaz.

## Sonraki aşamalarda karar gerektiren konular

- A-06 kaynak dağılımı, atama, agent yetkisi, RO yanıtı, kabul koşulu, sürüm geçerliliği ve insan CLI oturumu doc-8 ile karara bağlandı; yeniden açık soru sayılmaz.
- A-07 Finbee/proje 2 pilotu kabul edildi; mevcut kaynak /home/vuralbayrakli/projects/finbee ve FIN-21 kaydı korunur. A-08 kullanıcı talebiyle başlatılmayacak.
- Yedek/geri yükleme provası ve işletim kapsamı A-08'de ele alınır. A-04 kesinti/ortak kilit ve A-05 gözlem/anahtar kararları tamamlanmış ürün kararlarıdır.

## Yeni sohbete verilecek başlangıç mesajı

```text
Önce MANIFESTO.md, backlog instructions overview, doc-4/doc-5, a07-finbee-pilot.json, back-823-verification.json ve back-824-verification.json oku. BACK-823/BACK-824 görevlerini CLI ile doğrula. A-00–A-07 tamamlandı; A-08 kullanıcı talebiyle başlatılmayacak.
Güncel dal tasks/server-duplicate-task-ids, başlangıç tabanı 5b087c6c. A-07/BACK-823 ve BACK-824 değişiklikleri c7cb6989/b70f859d yerel commitlerinde ve ayrı teslim takip commit’inde. Push otomatik onay denetimince reddedildi; bu içeriğin vuralbayraklii/Backlog.md fork’unun tasks/server-duplicate-task-ids dalına gönderilmesi için açık kullanıcı onayı bekleniyor. Push/merge yapılmadı. Git durumunu doğrula ve yerel kayıtları koru. BACK-824 kanonik doctor onarımı 10 arşiv kaydını BACK-825–834 olarak yeniden numaraladı, 585 completed kaydını arşive taşıdı; içerik doğrulaması ve native browser9/9 geçti. Yerel kimlik çakışması yok; diğer dalların tarihsel snapshot uyarıları ayrı kalır.
Özel kalıcı yedek server-data/repair-backups/20261025T090420Z-duplicate-ids-bwggsfme altında; kişisel DB ve yedekleri Git teslimine alma. dist/backlog doğrulanmış BACK-823 binary'si; ürün kodu/binary bu onarımda değişmedi, kişisel süreç yeniden başlatılmadı. Kullanıcı panoyu yenileyebilir.
Finbee /home/vuralbayrakli/projects/finbee kökünden proje 2 olarak kayıtlı. FIN-21 @codex / İnceleme, AC4/4; doğrulama #1, talep #2 ve admin insan yanıtı #3 kabul anında aynı içerikte güvenilir/günceldi. Kabul edilen görev/statusu bu onarımda değiştirilmedi. Sonraki bir Finbee çalışmasında güncel sonucu önce bağlı task review list FIN-21 --json ile oku; yeni içerik değişikliği kabulü eskitebilir.
Bağlantı: --server-url http://127.0.0.1:6420 --server-project 2 --agent-key-file /home/vuralbayrakli/.config/backlog/finbee-codex.key --allow-http-loopback. Sırrı yazdırma; anahtar yalnız Finbee görev yazımı ve proje okuma yetkilidir. A-08 veya başka proje işi başlatma.
```
