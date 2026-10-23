---
id: doc-7
title: A-05 — Yerel agent erişimi ve dış dosya gözlem planı
type: specification
created_date: '2026-10-23 06:26'
updated_date: '2026-10-23 07:42'
---
# A-05 — onaylanan uygulama planı

Kullanıcı 23 Ekim 2026 tarihinde planın uygulanmasını onayladı. Bütün bileşenler mevcut makinede tek Backlog.md uygulama örneği olarak çalışır; bağlantı localhost API'sinedir.

## Ürün kararları

Agent anahtarı kullanıcıya bağlıdır. Yetki, açık anahtar grants ile sahibinin güncel proje izinlerinin kesişimidir; sahibi admin olsa da anahtar yönetim yetkisi alamaz. Hesap pasifleştirme/admin parola sıfırlaması anahtarları iptal eder. İzin değişikliği iptal+yeniden oluşturma; otomatik süre sonu yok. Sır yalnız ilk yanıtta gösterilir ve hash olarak saklanır; audit/operation/log içine girmez.

Dış taşıma yalnız güçlü ve tekil dosya kimliğiyle recordKey/geçmişi korur. Yalnız ID veya içerik benzerliği yeterli değildir; belirsiz yeni yol yeni kimlik alır. Gözlenmiş silme sonrası aynı ID yeni recordKey alır; normal atomik save kimliği bölmez. Bozuk/okunamayan dosyada ilgili projede yazma durur; sağlam okumalar uyarıyla sürer; başarılı tam taramada otomatik açılır. Gözlem durumu A-04 recovery engelinden ayrıdır.

Dış aktör unknown, gerçek zaman bilinmiyorsa occurredAt null ve detectedAt gerçek gözlem zamanıdır. İlk A-05 güvenli taraması takip başlangıcıdır; A-04 dış hareketleri geriye dönük üretilmez. Sonraki offline değişikliklerde yalnız gözlenen fark kaydedilir.

## Uygulama ve sınırlar

1. Mevcut SQLite yükseltme yolunda eski hesap/kayıt/işlem/geçmişi koru; agent kimliği/sahibi, grants, son güvenilir dosya görüntüsü ve kontrol durumunu sakla. Fark+record metadata+gözlem noktası aynı transaction içinde kesinleşir.
2. Admin server agent-key create/list/revoke ve /api/admin/agent-keys; aynı-key tekrar ikinci anahtar üretmez. İlk yanıt kaybolursa sır yeniden gösterilmez, metadata üzerinden iptal+yenileme yapılır. İptal revision korumalı ve audit atomiktir.
3. Aynı proje APIlerine Bearer doğrulama; kuyruk/replay/transaction sonrasında güncel izin; source agent kimlikten gelir. Browser cookie/CSRF korunur. Agent user/project/permission/config yönetimine erişemez.
4. Ortak bağlantılı istemci --server-url, --server-project, --agent-key-file ile yerel root/config migration öncesi seçilir. HTTP yalnız açık loopback geliştirme izniyle; bağlantı hatası yerel yazıya düşmez. Mevcut etkileşimsiz task/draft/doc/decision/milestone ve list/search/config-read/history/operation read; MCP mevcut tool adlarıyla aynı istemci. TUI/editör/Git/init/yerel bakım ve config-write uzak çalıştırılmaz. Task update eksikleri mevcut builder/Core yolunda tamamlanır.
5. Okunan revision açık --if-match/MCP girdisinden kullanılır; yazma öncesi otomatik yenileyerek stale okuma gizlenmez. UUID aynı-key tekrar ve operation GET ile kayıp yanıt; çakışmada otomatik yeniden yazım yok.
6. Mevcut güvenli reader/parser ile geçerli/yok/okunamıyor/kararsız envanter. Liste parser skip sonucu silme değildir. Task/draft/doc/decision/milestone/config ve arşivler; kaynak kodu/Git dışarıda. Güçlü move aynı tür/kimlik ve tekil dev/ino/birthtime gibi güvenilir metadata gerektirir; destek yoksa yeni kimlik.
7. Tek merkezi gözlem akışı başlangıç+watcher+30s karşılaştırma; tarayıcı kapalıyken de çalışır. Debounce ve tekrar kararlılık okuması. Merkezi yazı gözlem noktasını da günceller, self-event ikinci olay üretmez. Ortak proje kuyruğu, recovery önce gözlem sonra. Tracking/kapanış izleyicileri de yönetir. Kalıcı gözlem sonrası ContentStore/search/WS yayınlanır.
8. Mevcut Users içinde anahtar yönetimi ve Projects/proje içinde gözlem durumu; mevcut AppFrame/tema/pano. observation DTO: {state:checking|ready|degraded,lastSuccessfulScanAt:string|null,checkedAt:string|null,error:string|null}. Agent key metadata: {id,userId,name,grants:[{projectId,permissions}],createdAt,revokedAt,revision}; POST ilk yanıtta secret ekler. POST /:id/revoke revision korumalıdır.

## Sahiplik

Depo: database/auth-store/agent-store/agent-types/observation-store/observation-types/mutation-types/mutation-store ve testler. Gözlem: observation/inventory/mutations/index ve gerekli Core/FileSystem/ContentStore kancaları. Ana ajan: central, commands/server, cli, bağlantılı istemci/adaptör, MCP, README/yönergeler ve kabul. Web: web component/context/client ve DOM testleri. Ortak dosyada değişiklik önce sahibine bildirilir.

## Doğrulama

Geçici projeler/ayrı data-dir kullanılır. İzin/iptal yarışları; iki proje; stale/retry/lost response; güçlü-belirsiz move; gözlenmiş silme/recreate; bozuk/yarım/erişilemeyen dosya; offline/restart/watcher kaybı; self-event; migration ve gerçek kesinti; Chromium Users/key/status ve mevcut koyu-açık akış. Tip, yazmasız Biome/TSX borç farkı, native build/smoke, birleşmiş tam Bun. Kabul raporu ve doc-5 CLI güncellemesi. A-06 geçmiş/kullanıcı kabul ekranları, Finbee, çoklu sunucu/Git bu aşamanın dışındadır. Groma kurulu değil; manifesto değişmez.


## Uygulama sonucu — 23 Ekim 2026

BACK-807–BACK-812 tamamlandı. Kullanıcıya bağlı key, güçlü dış move, bozuk projede yazmayı durdurma ve mevcut makine kararları uygulandı. HTTP create ilk yanıtta {key,secret}, replay {key} döndürür. Operation GET güvenli requestHash taşır; istemci kayıp yanıtı ancak kanonik hash eşleşirse başarı sayar. Mevcut JSON watch ve fuzzy search aynı yardımcılarla bağlantılı modda da kullanılır. Kontrol zamanı İstanbul saatinde gösterilir; durmuş yazmalar açık uyarı ve soluk düğmelerle görünür.

Son sabit kaynakta resmi tam CI3.967 başarılı/13atlanan/0hata, 3.980test/360dosya/19.855beklenti; native Chromium27/27, runtime0. Tip, varsayılan Biome, değişen TSX0yeni tanı, native build ve derlenmiş smoke geçti. Rapor verification/server/a05-verification.json; güncel durum doc-5. Binary dist/backlog'a atomik alındı; kişisel süreç/DB yeniden başlatılmadı/değiştirilmedi. tasks/server-a05-agent-observation dalındaki değişiklikler yerel; commit/push yapılmadı. A-06 başlamadı.
