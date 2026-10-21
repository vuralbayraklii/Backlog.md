---
id: BACK-794
title: 'A-02 — Oturum, güvenli çıkış ve parola inceleme düzeltmeleri'
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-21 13:54'
updated_date: '2026-10-21 14:08'
labels:
  - server
  - a-02
dependencies: []
references:
  - verification/server/a02-verification.json
documentation:
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
priority: high
type: bug
ordinal: 399000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
8440e7b7 incelemesinde üç davranış hatası yeniden üretildi: gecikmiş başarılı oturum yanıtı yeni hesabı ezebiliyor, logout kaydedilmemiş metni onaysız kaldırıyor ve aynı parola zorunlu değişimi geçebiliyor. Kullanıcı çözüm planını onayladı; kendi parola değişimlerinin tamamında mevcut parolayı yeniden seçmek reddedilecek. İncelenmiş düzeltme ayrı commit ile mevcut özellik dalına gönderilecek.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Gecikmiş eski oturum başarı/hata yanıtları yeni girişin kullanıcı, CSRF, izin ve hata durumunu değiştiremez; logout, kapanış ve StrictMode yarışları doğrulanır.
- [x] #2 Bütün logout çağrıları ortak kaydedilmemiş değişiklik korumasından geçer; iptalde ağ isteği yoktur, onayda tek istek vardır ve başarısızlık metni korur.
- [x] #3 Kendi parola değiştirme işleminde mevcut parola HTTP 400 ile reddedilir; ret parola bayrağını ve oturumları değiştirmez, farklı parola mevcut oturum yenilemesini korur.
- [ ] #4 İlgili hesap/API ve web/DOM regresyonları, gerçek Chromium akışları, tip, yazmasız Biome, build ve derlenmiş smoke kanıtları kaydedilir; devir güncellenir ve özellik dalının push sonucu doğrulanır.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Ana ajan tarayıcı oturum yenilemesinde kimlik nesli ve istek sahipliğini doğrulayacak; eski başarı/hata ve finally yanıtlarını geçersiz kılacak, logout/kapanış/StrictMode iptalini güvenceye alacak. 2. Ana ajan ortak kirli editör kaydını AuthProvider dışına alacak, router engelini içeride tutacak ve bütün logout çağrılarını iptal/onay/tek istek/hata durumlarında aynı korumadan geçirecek. 3. codex-password mevcut parolayı tekrar seçmeyi AuthStore ve HTTP testleriyle reddedecek; codex-web-tests oturum/logout DOM regresyonlarını, codex-review bağımsız inceleme ve Chromium kanıtlarını üstlenecek. 4. İlgili hesap/API ve tüm web/DOM regresyonları, tip, yazmasız Biome, build ve compiled smoke son kaynak üzerinde doğrulanacak; sadelik incelemesi, a02-review-fixes.json ve devir kaydı tamamlanacak. 5. Düzeltme ayrı BACK-794 commit olarak kaydedilecek, mevcut özellik dalı normal push ile origin dalına gönderilip HEAD eşitliği doğrulanacak.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Uygulama: oturum yenilemesi iptal edilebilir istek sahipliği ve kimlik nesliyle korunuyor; eski success/error/finally yeni hesabı değiştirmiyor. Ortak kirli editör kaydı AuthProvider dışına, router engeli router içine alındı. Logout iptal/onay, tek istek, hata ve zaten kapanmış oturum davranışlarını paylaşıyor. Kullanıcının kendi parola değiştirmesinde aynı parola mevcut özete karşı doğrulanıp HTTP400 ile reddediliyor; admin reset davranışı korunuyor.
Son kaynak kontrolleri: 43 dosyada 437 web/DOM testi, 7 dosyada 129 hesap/API/CLI testi başarılı; 0 başarısız. Tip567dosya, yazmasız Biome483dosya, build ve derlenmiş CLI/web/MCP smoke geçti. Chromium ve push kanıtı bekleniyor. Ham kanıtlar /tmp/backlog-a02-review-fixes-69vcph7x/.
<!-- SECTION:NOTES:END -->
