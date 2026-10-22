---
id: BACK-798
title: 'A-03 — Proje önizleme, kayıt ve admin klasör/takip arayüzleri'
status: Done
assignee:
  - '@codex-registration-ui'
created_date: '2026-10-22 06:30'
updated_date: '2026-10-22 07:19'
labels:
  - server
  - a-03
dependencies:
  - BACK-794
references:
  - verification/server/a03-verification.json
documentation:
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
  - backlog/docs/server/doc-4 - Backlog.md-çoklu-proje-takip-sistemi-planı.md
priority: high
type: feature
ordinal: 403000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mevcut proje seçici ve yönetim ekranları üzerinden hazır proje bağlama kullanılabilir olmalı. Auth bağlamı, ortak istemci ve mevcut taslak koruması kullanılacak. Sahiplik: src/web/** ve yeni/ilgili DOM testleri; sunucu/CLI/ortak tipleri değiştirme. Başlık altında gereksiz açıklama ekleme.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Yetkili kullanıcı proje adı/yoluyla önizleme yapar, yapılandırma/sayı/sorunları görür ve kaydı tamamlayınca mevcut panoya gider; engelleyici sonuç kayıt düğmesini kapatır.
- [x] #2 Admin kişisel alan ekler/kaldırır ve takip dışı projeleri görüp yeniden etkinleştirir; takip dışına alma erişimi kapatır ve hatalar görünürdür.
- [x] #3 İstekler ortak sessionFetch istemcisini ve CSRF davranışını kullanır; eski önizleme/yanıtlar yeni girişleri ezmez; kirli form mevcut ayrılma korumasına katılır.
- [x] #4 DOM testleri yetki, başarı, hata, önizleme geçersizleşmesi ve takip akışlarını doğrular; mevcut auth/seçici regresyonları geçer.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Mevcut proje seçiciye yalnız kayıt yetkisi olan hesaplarda ad/yol, kişisel alanlar ve salt-okunur önizleme/kayıt akışını ekle; ortak API tiplerini ve requestJson/sessionFetch kullan.
2. Yönetimde kullanıcıların klasör alanlarını atama/kaldırma ve projelerin takip durumunu değiştirme kontrollerini mevcut ekranla bütünleştir.
3. Önizleme ve kayıt isteklerini giriş/oturum sahipliğiyle koru; giriş değişiminde önizlemeyi geçersizleştir ve mevcut kirli form kaydını kullan. Başarılı kayıt sonrası kaydı temizleyip mevcut panoya tam sayfa geç.
4. Yetki, önizleme/kayıt başarı-hata-yarışları, kirli ayrılma, klasör/takip akışlarını DOM testleriyle doğrula; auth/seçici regresyonları ve ilgili tip/Biome kontrollerini çalıştır.
5. Sadelik incelemesi yap, kanıtları /tmp/backlog-a03-8vr8jlkz altında tut ve bağımsız inceleme için görevi In Progress bırak.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Başlangıç: tasks/server-a03-project-registration, temel 4e67653bb76723cb93ff299ac12f99fd10b36a87. Ortak a03-contract.json ve kayıt tipleri okundu. Groma komutu ortamda yok (127); mimari tarama veya Groma dosyası değişikliği yapılmayacak. Ortak kaynaklar ve diğer ajanların kayıtları korunacak.

Uygulama hazır (bağımsız inceleme ve ana kabul bekleniyor):
- ProjectSelector kayıt yetkisini GET /api/projects/registration ile öğreniyor; kullanıcı yalnız kendi alanlarını görüyor. Açılan form ada odaklanıyor ve listenin önünde kalıyor.
- ProjectRegistration mevcut klasörü POST preview ile okuyor; ad/kök/Backlog/yapılandırma, tüm sayılar ve uyarı/hataları gösteriyor. Engelleyici önizleme kaydı kapatıyor. Girdi değişiminde eski önizleme iptal; oturum/girdi sahipliği geç yanıt ve eski finally yarışlarını engelliyor. POST başarıdan önce taslak kaydı temizlenip mevcut /projects/:id/board yoluna tam sayfa geçiliyor.
- AdminUsers içindeki AdminProjectRegistration kişisel klasör atama/kaldırma ve takip dışına alma/yeniden etkinleştirmeyi sunuyor; yıkıcı olmayan erişim değişikliklerinin sonuçları onayda açık. Ortak requestJson/sessionFetch CSRF kullanımı ve mutasyonlarda yeniden denememe korunuyor.
- Yeni iki form ortak useUnsavedChanges kaydını kullanıyor. AdminUsers merkezi oturum geçici olarak null iken ağacını koruyor; AuthProvider giriş örtüsü altında aynı hesapta klasör taslağı kalıyor, başka hesapta state temizleniyor.
- Sadelik incelemesi: seçicinin okuma yaşam döngüleri tek AbortController altında birleştirildi; admin mutasyonları tek yerel, tipli helper kullanıyor; yeni servis/rota/ortak tip katmanı eklenmedi.
Kanıt: bun test --timeout=10000 --isolate src/test/web-project-registration.test.tsx src/test/web-project-selector.test.tsx src/test/web-auth.test.tsx => 55 başarılı, 0 hata, 256 beklenti (ui-tests.log). Yeni 23 test yetki/CSRF, sayı-yapılandırma/sorun, engelleme, input ve oturum geç yanıtları, farklı hesap ayrımı, çift kayıt tıklaması, kirli logout/cancel, klasör ve takip hata/başarılarını kapsıyor. Repo Biome TSX kapsamıyor; repo ayarlarının yalnız TSX kapsamı açılmış /tmp kopyasıyla 5 dosyada yazmasız check başarılı (ui-biome.log). git diff --check başarılı. Tip kontrolünün son koşusunda UI hatası yok; eşzamanlı binding testinde 2 ServerUser argüman hatası ana ajana bildirildi (ui-types.log). Tüm kanıtlar /tmp/backlog-a03-8vr8jlkz/. Görev ana ajanın kabulü için In Progress bırakıldı.

Kapsam açıklığı: A-03 yalnız mevcut ProjectSelector ve AdminUsers içine eklendi; mevcut App rotaları, pano, görev/belge/karar editörleri, arama ve Markdown bileşenleri yeniden yazılmadı. Var olan tam sayfa proje geçişi ve Users yerleşimi korunuyor. Önceki nottaki kayıt sırası: taslak kaydı POST başarı yanıtından SONRA, pano navigasyonundan ÖNCE temizleniyor.
Bağımsız veri/yetki incelemesi: v0/v2→v3 eklemeli göçü, izin varsayılanları, güncel kullanıcı/alan denetimleri, CSRF ve admin sınırları okundu. İki somut hata bulundu ve sahipleri düzeltti: (1) SQLite kilidi beklenirken iptal edilmiş adminin alan kaldırması artık işlem içi beforeCommit denetimiyle 401; alan kalıyor. (2) Kullanıcının kayıt alanında olsa bile üye olmadığı mevcut özel proje artık çakışma denetiminden önce okunmuyor; preview200, boş yapılandırma/sayılar ve genel engelleyici sorun dönüyor.
Yeni src/test/central-registration-admin-race.test.ts gerçek HTTP ile her iki regresyonu doğrular: 2 başarılı, 0 hata, 18 beklenti; fs.watch/çocuk süreç kilit el sıkışmasıyla sabit 1 saniye bekleme yok. review-regressions.log ve yazmasız review-biome.log başarılı. Geçici bağımsız tekrar üretmelerin önce/sonra sonuçları review-delete-race*.log ve review-preview-privacy*.log içinde. İlk normal sandbox testinde loopback portu açılamadı; aynı test gerekli izinle 956ms içinde geçti. İncelemede bu iki giderilmiş bulgu dışında A-03 için engelleyici bulgu kalmadı. Kaynak/test düzenlemeleri ana ajanın tam doğrulaması için donduruldu.

Gerçek Chromium düzeltmesi: kayıt POST başarı yanıtı sonrası clearUnsaved() anlık kirli kayıt kümesini boşaltmasına rağmen mevcut beforeunload dinleyicisi React effect temizliğine kadar koşulsuz engelliyordu; bu nedenle tam sayfa mevcut pano geçişi durabiliyordu. UnsavedChangesProvider dinleyicisi artık preventDefault öncesi güncel isDirty() sonucunu denetliyor. Bu ortak koruma değişikliği A-03 kaydet→mevcut pano akışının tamamlanması için gerekli; navigasyon gecikmesi, setTimeout veya flushSync eklenmedi.
Yeni DOM regresyonu ProjectRegistration.onRegistered içinde React effectleri temizlenmeden senkron beforeunload yolluyor. Düzeltme öncesinde 1 test beklenen false yerine true ile hata verdi (ui-register-unload-before.log); sonrasında yeni test ve kirli logout/unload dahil auth/seçici grubu 56 başarılı, 0 hata, 259 beklenti (ui-register-unload-after.log). 580 dosyada tip başarılı (ui-register-unload-types.log), değişen iki TSX dosyada yazmasız Biome başarılı (ui-register-unload-biome.log), git diff --check başarılı. Kaynak/test düzenlemeleri tekrar donduruldu; ana ajan tam koşuyu ve gerçek tarayıcıyı son kaynaktan tekrarlayacak.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18724 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 20 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Önizleme/kayıt mevcut proje seçicisine, kişisel alan/takip kontrolleri Users ekranına eklendi. Mevcut istemci/CSRF/oturum/taslak koruması kullanılır; kayıt sonrası senkron panoya geçişte eski unload dinleyicisi düzeltildi. Mevcut görev/belge/karar/arama/pano ekranları yeniden uygulanmadı. Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti.
<!-- SECTION:FINAL_SUMMARY:END -->
