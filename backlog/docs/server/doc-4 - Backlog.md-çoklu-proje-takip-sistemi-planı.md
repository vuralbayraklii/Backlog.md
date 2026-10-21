---
id: doc-4
title: Backlog.md çoklu proje takip sistemi planı
type: specification
created_date: '2026-10-20 12:17'
updated_date: '2026-10-21 07:50'
tags:
  - server
  - requirements
  - user-plan
---
Bu belge kullanıcının başlangıç planını korur. Güncel çalışma durumu, tamamlanan işler, açık kararlar ve yeni sohbet başlangıcı doc-5 numaralı Sunucu geliştirmesi devir notu belgesindedir. Plan incelemesindeki ek öneriler bu gereksinimlere kendiliğinden eklenmiş sayılmaz.

## 1. Hedef ve temel kararlar

**Kullanıcının 20 Ekim 2026 netleştirmesi:** Bu depoda geliştirilen ürün, bağımsız Backlog.md proje takip uygulamasıdır. Kullanıcı yönetimi, yetkilendirme, çoklu proje ve tarihçe Backlog.md’nin kendi özellikleridir. Önce bu uygulama istenen seviyeye getirilecek. Ardından diğer projelerdeki Backlog.md dosya yapıları, özelleştirdiğimiz uygulamanın “Proje kaydet” özelliği üzerinden okunup otomatik olarak merkezi takip sisteminde gösterilecek. Finbee ve diğer projeler hazır uygulamaya bu yolla daha sonra bağlanacak.

Sunucuda çalışan, kullanıcıların giriş yaptıktan sonra yetkili oldukları projeleri seçebildiği bir takip uygulaması geliştirilecek. Seçilen projenin görevleri, kararları ve belgeleri **mevcut Backlog.md arayüzünde** gösterilecek. Kullanıcı yönetimi, proje seçimi, yetkilendirme ve tarihçe bu arayüze eklenecek.

- **Geliştirme temeli:** Backlog.md’nin kendi hesabımızdaki fork’u. Başlangıçta incelenen `v1.54.0` etiketinin karşılık geldiği commit sabitlenecek; geliştirme sırasında kendiliğinden sürüm yükseltilmeyecek.
- **Teknoloji:** Mevcut Bun, TypeScript ve React yapısı kullanılacak. Görev panosu ve düzenleme ekranları yeniden yazılmayacak. [Mevcut uygulama yapısı](https://github.com/MrLesk/Backlog.md/blob/v1.54.0/src/web/App.tsx).
- **Görev kayıtları:** Her projenin kendi Backlog.md Markdown dosyaları esas kaynak olacak.
- **Merkezi bilgiler:** Kullanıcılar, oturumlar, proje kayıtları, yetkiler ve tarihçe SQLite veritabanında tutulacak. Bun’ın yerleşik SQLite desteği kullanılacak. [SQLite desteği](https://bun.sh/docs/runtime/sqlite).
- **Çalıştırma varsayımı:** İlk sürüm tek Linux sunucusunda, tek uygulama örneği olarak çalışacak.
- **Geçiş:** Önce Finbee, ardından diğer projeler bağlanacak. Projelerin kendi uygulama servislerinin ve finansal veritabanlarının taşınması ayrı çalışma olarak ele alınacak.

Başarı ölçütü: Kullanıcı, sohbet geçmişini okumadan bir projede **ne yapıldığını, neyin beklediğini, kendisinden ne istendiğini ve değişikliklerin geçmişini** görebilmeli.

## 2. Kullanıcı akışı ve yetkilendirme

### Giriş ve hesap yönetimi

Ana akış:

**Giriş → Yetkili projeler → Proje seçimi → Backlog.md panosu**

- Hesapları yalnız admin oluşturacak; açık kullanıcı kaydı olmayacak.
- Admin kullanıcı oluşturabilecek, pasifleştirebilecek, parola sıfırlayabilecek ve yetki atayabilecek.
- İlk admin, sunucuda bir başlangıç komutuyla oluşturulacak; hazır kullanıcı adı/parola bulunmayacak.
- Parolalar Argon2id ile saklanacak. İlk girişte ve admin sıfırlamasından sonra parola değişikliği istenecek.
- Oturumlar sunucuda tutulacak; güvenli cookie, CSRF koruması ve giriş denemesi sınırlaması uygulanacak.
- Başlangıç oturum sınırları: en fazla 12 saat, hareketsizlikte 2 saat. Hesap pasifleştirme ve parola sıfırlama mevcut oturumları kapatacak.
- Son aktif adminin pasifleştirilmesi veya admin yetkisinin kaldırılması engellenecek.

### Yetki modeli

İki hesap türü olacak: **Admin** ve **Kullanıcı**. Kullanıcıların proje içindeki yetkileri ayrıca atanacak.

| İşlem | Projeye eklenen normal kullanıcının varsayılanı |
|---|---|
| Projeyi, görevleri, kararları ve tarihçeyi görüntüleme | Açık |
| Görev oluşturma, düzenleme ve durum değiştirme | Açık |
| Belge ve karar taslağı oluşturma/düzenleme | Açık |
| Karar kabul etme veya kabul edilmiş kararı değiştirme | Kapalı; admin açabilir |
| Kayıt arşivleme ve geri getirme | Kapalı; admin açabilir |
| Kayıt silme | **Kapalı; admin proje bazında açabilir** |
| Proje ayarları ve kullanıcı erişimlerini yönetme | Admin |
| Yeni proje tanımlama | Kapalı; admin kullanıcıya açabilir |

Yetki kontrolü yalnız düğmelerde yapılmayacak. API, arama, istatistik, dışa aktarma, dosya erişimi ve canlı güncelleme bağlantıları aynı kuralları uygulayacak. Yetkisi kaldırılan kullanıcı açık oturumundan ilgili projeye erişmeye devam edemeyecek.

### Proje ekleme

“Proje ekle” ekranında proje adı ve sunucudaki klasör yolu girilecek.

1. Sistem klasörü ve mevcut Backlog.md yapılandırmasını okuyacak.
2. Bulunan kayıt sayıları, yapılandırma ve sorunlar önizlemede gösterilecek.
3. Kullanıcı projeyi bağlayacak. Backlog yapısı bulunmuyorsa ayrı bir **Backlog oluştur** işlemi sunulacak.
4. Mevcut serbest biçimli Markdown belgeleri kendiliğinden görev veya karar kaydına dönüştürülmeyecek.

Proje oluşturma yetkisi verilen kullanıcıya admin tarafından uygun klasörler veya kendisine ayrılmış bir klasör alanı atanacak. Bu yetki başka kullanıcının projesini kendi hesabına bağlamaya izin vermeyecek.

Aynı gerçek klasörün iki kez bağlanması, çakışan proje kökleri ve sembolik bağlantıyla izinli alanın dışına çıkılması engellenecek. Projeyi takip sisteminden kaldırmak, proje klasörünü silmeyecek.

## 3. Uygulama mimarisi ve arayüz değişiklikleri

### Proje bağlamı

Her kayıtlı proje için ayrı Backlog çalışma bağlamı, dosya izleyicisi, arama indeksi ve canlı güncelleme grubu tutulacak. Mevcut `Core(projectRoot)` yapısı genişletilecek. [Mevcut Core yapısı](https://github.com/MrLesk/Backlog.md/blob/v1.54.0/src/core/backlog.ts).

- Sunucuda veya tarayıcıda bütün kullanıcıların paylaştığı tek bir “aktif proje” değişkeni olmayacak.
- Her istek kimlik doğrulanan kullanıcı, proje kimliği ve gerekli yetkiyle çözümlenecek.
- Görev kimliği proje kimliğiyle birlikte değerlendirilecek; iki projedeki `TASK-1` birbirine karışmayacak.
- Yeni çalışma alanı proje kimliği, Backlog.md’nin mevcut görev içi `project` alanından ayrı tutulacak.
- Tarayıcıdaki veriler, açık görevler ve canlı bağlantılar proje bazında ayrılacak. Proje değişiminde önceki projeden gecikmiş yanıtlar yeni ekranı değiştiremeyecek.
- Bir projenin çalışma kopyaları aynı proje kaydına bağlanacak. İlk sürümde tek esas Backlog klasörü kullanılacak; kodun çalışıldığı dal/kopya görevde belirtilecek.

### Ekranlar

Mevcut Backlog ekranlarına şu bölümler eklenecek:

- **Giriş ve parola değiştirme**
- **Projeler:** Yalnız erişilebilir projeler; mevcut durum, bekleyen işler, yaklaşan teslimler ve son güncelleme
- **Yönetim:** Kullanıcılar, proje erişimleri, işlem yetkileri ve proje ekleme yetkisi
- **Geçmiş:** Proje, görev, tarih, kişi ve olay türüne göre filtrelenebilen kayıtlar
- **Görev ayrıntısında tarihçe:** Oluşturma, başlangıç, engel, doğrulama, kabul, tamamlanma ve yeniden açılma olayları

Proje listesinde “Benden beklenenler” görünümü bulunacak. Bu görünüm açıkça atanmış inceleme/karar ihtiyacından üretilecek; yalnızca görev sahibinden kabul sorumlusu çıkarılmayacak.

Okunamayan veya son kontrolü başarısız olan proje “güncel” gösterilmeyecek. Son başarılı okuma ve erişim sorunu görünür olacak.

### API ve agent arayüzü

Mevcut veri uçları proje kapsamına alınacak:

- `/api/auth/...`: Giriş, çıkış, oturum ve parola işlemleri
- `/api/admin/...`: Kullanıcı, yetki ve agent erişimi yönetimi
- `/api/projects`: Yetkili proje listesi ve proje kaydı
- `/api/projects/:projectId/...`: Mevcut görev, belge, karar, arama ve ayar işlemleri
- `/api/projects/:projectId/history`: Proje ve kayıt tarihçesi
- Proje kapsamlı, kimliği doğrulanmış canlı güncelleme bağlantısı

Sunucu modunda eski, proje kapsamı bulunmayan veri uçları erişime açık bırakılmayacak.

Agent’lar için mevcut CLI/MCP kullanımını koruyan bir **sunucu bağlantı modu** eklenecek. Bu mod proje kimliği ve admin tarafından oluşturulan, iptal edilebilir agent erişim anahtarıyla aynı API’yi kullanacak. Agent’ın hangi projede hangi işlemleri yapabileceği ayrıca sınırlandırılacak.

Sunucu modunda Markdown veya proje yapılandırmasındaki komut çalıştıran durum kancaları devre dışı olacak. Otomatik Git commit, uzak fetch ve Git kancaları da başlangıçta kapalı tutulacak. Proje ayarları API’si yalnız izin verilen alanları değiştirecek.

## 4. Tarihçe ve kayıt bütünlüğü

### Kaydedilecek olaylar

Görev, karar, belge ve ilgili yönetim işlemlerindeki anlamlı değişiklikler kaydedilecek:

- Oluşturma, içerik/kapsam değişikliği, sorumlu ve teslim tarihi değişikliği
- Başlama, bekleme, tamamlama ve yeniden açılma
- Karar önerme, kabul etme ve yerine yeni karar geçmesi
- Doğrulama ve kullanıcı kabulü
- Arşivleme, geri getirme ve silme
- Kullanıcı, proje erişimi ve yetki değişikliği

Her olayda proje, kayıt kimliği, işlem, kaynak, doğrulanabilen aktör, zaman, önceki/sonraki değerler ve varsa açıklama/kanıt bulunacak.

**Doğrulama ve kullanıcı kabulü ayrı olaylar olacak.** Bir görevin “Tamamlandı” durumuna geçirilmesi, testin çalıştırıldığını veya kullanıcının kabul ettiğini kendiliğinden kanıtlamayacak.

### Panel ve agent işlemleri

Panel ve kimliği doğrulanmış agent işlemleri ortak yazma katmanından geçecek.

- Düzenleme, okunan kayıt sürümüyle karşılaştırılacak. Eski sürümü kaydetmeye çalışan kullanıcıya çakışma gösterilecek; hazırladığı metin korunacak.
- Yeniden gönderilen aynı işlem ikinci bir değişiklik veya tarihçe kaydı oluşturmayacak.
- İşlem niyeti kalıcı kayda alındıktan sonra dosya yazılacak; sonuç ve tarihçe kesinleşmeden başarı bildirilmeyecek.
- Dosya ve veritabanı arasındaki işlem sırasında kesinti olursa başlangıçta kurtarma yapılacak. Beklenmeyen veya kısmen uygulanmış sonuç sessizce yeniden oynatılmayacak.
- Normal uygulama işlemleri önceki tarihçe kayıtlarını değiştiremeyecek veya silemeyecek.

### Doğrudan dosya değişiklikleri

Dosya izleyicisi, başlangıç taraması ve periyodik karşılaştırma birlikte kullanılacak.

- Uygulamanın kendi yazımı için oluşan dosya bildirimi ikinci olay üretmeyecek.
- Doğrudan dosya değişiminde aktör doğrulanamıyorsa **bilinmiyor** yazılacak.
- Algılanma zamanı ile değişikliğin gerçekleştiği bilinen zaman ayrı tutulacak.
- Sistem kapalıyken gerçekleşen değişikliklerde yalnız gözlenebilen sonuç farkı kaydedilecek; aradaki bütün adımlar yeniden oluşturulmuş gibi gösterilmeyecek.
- Geçersiz veya yarım yazılmış Markdown, silinmiş ya da tamamlanmış görev olarak yorumlanmayacak.
- Silinip aynı görünen kimlikle yeniden oluşturulan kayıt, gözlenebildiği durumda eski kaydın tarihçesine karıştırılmayacak.

Normal kullanıcılar tarayıcı üzerinden çalışacak. Sunucuda doğrudan dosya yazma yetkisi olan kişiler uygulama yetkilerinin dışındaki bir erişime sahiptir; bu işlemler tarihçede dış değişiklik olarak ele alınacak.

### Eski kayıtların aktarımı

Mevcut kayıtlar ilk bağlanmada “başlangıç envanterine alındı” olayıyla kaydedilecek. Kaynak oluşturulma ve teslim tarihleri korunacak; bilinmeyen tamamlanma tarihi son güncelleme tarihinden üretilmeyecek.

Yeni olaylar UTC saklanacak, başlangıçta `Europe/Istanbul` ile gösterilecek. Yalnız gün içeren eski tarihlere saat uydurulmayacak.

## 5. Uygulama sırası, kabul ve geçiş

| Aşama | Yapılacak çalışma | Tamamlanma ölçütü |
|---|---|---|
| **A-00 — Temel sürüm** | Fork, sabit commit, kurulum ve mevcut test/build doğrulaması | Değiştirilmemiş sürümün sonuçları ve mevcut başarısızlıkları kayıtlı |
| **A-01 — Proje bağlamı** | Proje kayıt modeli, ayrı Core bağlamları, proje kapsamlı API ve arayüz yolları | Aynı görev kimliğini kullanan iki örnek proje birbirine karışmıyor |
| **A-02 — Hesap ve yetki** | Admin başlangıcı, özel hesaplar, oturumlar ve ortak yetki denetimi | Yetkisiz API/canlı bağlantı erişimleri reddediliyor; yetki kaldırma etkili |
| **A-03 — Proje seçimi** | Proje listesi, klasör önizlemesi ve yetkili proje ekleme | Kullanıcı yalnız yetkili projelerini görüyor ve izinli klasörleri bağlayabiliyor |
| **A-04 — Ortak yazma ve tarihçe** | Sürüm çakışmaları, kalıcı işlem kaydı, tarihçe ve kesinti kurtarması | Bir işlem tek olay üretiyor; çakışmada veri ezilmiyor; kesinti sonrası sonuç doğru |
| **A-05 — Agent ve dosya takibi** | Sunucu bağlantılı CLI/MCP, erişim anahtarları ve dış değişiklik algılama | Agent kimliği doğrulanıyor; dış değişiklikler belirsizlikleriyle kaydediliyor |
| **A-06 — Kullanıcı görünümü** | Görev tarihçesi, proje geçmişi, tarih filtreleri ve benden beklenenler | Kullanıcı görevden gerekçeye, karara ve kanıta ulaşabiliyor |
| **A-07 — Finbee pilotu** | Sunucudaki güncel kayıtlardan geçiş önizlemesi ve ilk gerçek kullanım | Kaynaklar korunuyor; açık işler doğru; insan ve agent aynı kaydı güncelliyor |
| **A-08 — Yaygınlaştırma** | Diğer projelerin bağlanması, işletim ve yedekleme düzeni | Her proje için erişim, kayıt ve geri yükleme kontrolü tamamlanmış |

Her aşama mevcut test düzenine uygun kontrollerle kapanacak. Bun testleri, tip kontrolü, yazmasız Biome kontrolü ve build kullanılacak; kullanıcı akışları için tarayıcı uçtan uca testleri eklenecek.

Özellikle şu senaryolar zorunlu olacak:

- Yetkisiz projenin adresini veya API kimliğini doğrudan kullanma
- Proje değiştirirken eski yanıtın veya canlı bildirimin yeni ekrana gelmesi
- Silme yetkisi kapalı kullanıcı ve sonradan verilmiş/kaldırılmış yetki
- Başkasının klasörünü bağlama, aynı klasörü tekrar ekleme ve sembolik bağlantıyla sınır dışına çıkma
- İki kullanıcının aynı kaydı eşzamanlı düzenlemesi
- Panel/agent işleminin tekrar gönderilmesi ve yinelenen dosya bildirimleri
- Dosya yazımı ile tarihçe kaydı arasındaki kesinti
- Sistem kapalıyken dosya değişmesi, geçersiz Markdown ve bilinmeyen aktör
- Tamamlanan görevin yeniden açılması ve geçmişin korunması
- Eski “Tamamlandı” kaydına sahte tamamlanma tarihi eklenmemesi
- Yapılandırmadaki komut kancasının sunucu modunda çalışmaması
- Yedekten veritabanı, Markdown kayıtları ve tarihçenin birlikte geri yüklenmesi

Uygulama TLS üzerinden, ayrı bir servis hesabıyla çalıştırılacak. Merkezi veritabanı ve Backlog dosyalarını birlikte kapsayan tutarlı yedekleme/geri yükleme komutları hazırlanacak. Sunucu adresi, alan adı, proje kökleri ve yedek hedefi kurulum yapılandırması olacak.

Finbee geçişi **sunucudaki güncel kayıtlar yeniden incelenerek** hazırlanacak. Önceki yerel önizleme paketi örnek olarak kullanılacak. Çalışma kopyalarında bulunan eski kanıtların sunucuda erişilebilirliği ayrıca kontrol edilecek.

Uygulayıcı agent, bu aşamaları küçük görevler halinde yürütecek; her görevde kapsamı, kaynak sürümünü, yapılan değişikliği, doğrulama sonucunu ve sıradaki adımı kaydedecek. Ürün davranışını değiştiren yeni bir karar gerektiğinde bunu mevcut planın içinde varsayarak uygulamayacak.



## 6. Onaylanan A-01.2 uygulama kararları — 21 Ekim 2026

Kullanıcı, genel yol haritasıyla birlikte ilk küçük teslimin ayrıntılandırılmasını seçti ve bu konuşmada sunulan planın uygulanmasını onayladı. İlk teslim BACK-787: kalıcı proje kayıtları ve sunucu CLI komutlarıdır.

- Merkezi özellikler aynı Backlog.md uygulamasındaki `backlog server …` komut grubuyla sunulacak; mevcut `backlog browser` yerel kullanımını sürdürecek.
- `--data-dir` zorunlu olacak; varsayılan kullanıcı dizini seçilmeyecek. Merkezi veritabanı bu dizindeki `server.sqlite` dosyasıdır.
- Proje kaydı; kalıcı otomatik artan kimlik, görünen ad, gerçek klasör yolu ve UTC kayıt zamanını içerir. JSON kimliği metindir; görev içindeki `project` alanından ayrıdır.
- `project register/list/view`, okunabilir metin ve `schemaVersion: 1` JSON sunar. Kayıt, belirtilen kökteki mevcut Backlog yapısını yalnız okuyarak doğrular; kaynak Markdown/yapılandırmayı değiştirmez. Okuma komutları dosya oluşturmaz; bozuk veritabanı kendiliğinden yenilenmez.
- Aynı gerçek klasörün tekrar kaydı ve birbirini içeren kökler tek SQLite işlemiyle reddedilir; yazma kilidi en fazla beş saniye beklenir.
- İlk teslim örnek projelerle geliştirilir. HTTP/UI, hesap/yetki, tarihçe ve gerçek projelerin bağlanması sonraki ürün işleridir. Yol haritasının A-01–A-08 sırası korunur.
