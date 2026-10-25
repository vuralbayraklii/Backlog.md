---
id: BACK-823
title: Eski görev dosya adlarının sunucu panosunu engellemesini düzelt
status: Done
assignee:
  - '@codex'
created_date: '2026-10-24 14:16'
updated_date: '2026-10-24 14:23'
labels:
  - server
  - bug
dependencies: []
documentation:
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
priority: high
type: bug
ordinal: 428000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Backlog.md projesinin ilk merkezi dosya taraması, CLI üzerinden okunabilen backlog/completed/back-196-add-nixos-packaging-support.md kaydını dosya adı/kimlik uyuşmazlığı sayıyor ve yazıları durduruyor. Kullanıcının panosunda görevler ve menü de yüklenmiyor. Mevcut kaynak kayıtları ve bilinen bağımsız arşiv kimliği çakışmaları korunarak bu dar entegrasyon uyumsuzluğu giderilecek ve arayüzün kullandığı APIler doğrulanacak.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI tarafından okunabilen eski sayısal kimlik-tire-başlık görev dosyaları ilk sunucu taramasını engellemez; görev kimliği ve içerik değişmez.
- [x] #2 Modern, kısa ve eski alfasayısal kimlikli dosyalar çalışır; gerçek dosya adı/kimlik uyuşmazlıkları ve bozuk içerik reddedilmeye devam eder.
- [x] #3 Gerçek depo kopyasında ilk açılış, görevler, arama ve menü APIleri doğrulanır; bilinen kimliği çakışan göreve erişim belirsizlik hatasını korur.
- [x] #4 İlgili regresyonlar, tip, Biome ve derleme geçer; kabul kanıtı ve devir güncellenir.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Gerçek depo üzerinde salt okunur tarama ve geçici tam kopyada HTTP açılış istekleriyle eski dosya adı uyumsuzluğunu kanıtla.
2. Sunucu gözleminin mevcut kimlik denetiminde yalnız eski sayısal kimlik-tire-başlık biçimini tanı; modern/kısa/alfasayısal kimlikleri ve gerçek uyuşmazlık reddini koru. Kaynak görev dosyalarını yeniden adlandırma ve doctor onarımı çalıştırma.
3. Önce başarısız regresyonları, sonra odaklı gözlem/HTTP/kimlik testlerini, tip/Biome ve derlemeyi çalıştır. Depo kopyasında panonun beş paralel açılış isteğini ve çakışan görevin 409 yanıtını kontrol et.
4. Sadelik incelemesini yap; kalıcı kanıt, görev kapanışı ve devir kaydını CLI ile güncelle. Kişisel uygulama sürecinin güncellenme durumunu açıkça raporla.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Kök neden: CLI tarafından okunan BACK-196 eski dosya adı, gözlemde tam ad/ID karşılaştırmasına takılıyor. Düzeltme modern/kısa denetimi koruyup yalnız eski sayısal kimlik-tire-başlık için mevcut kanonik ID karşılaştırmasına düşer. Yeni helper/store/UI yok. Eski kaynakta 3 olumlu regresyon fail, 1 tam alfasayısal kontrol pass; son 79 odaklı + 9 HTTP/ilk envanter/çakışma testi pass, types637 ve Biome552 pass, native build/smoke pass. Tam depo kopyasında özgün dosya adıyla ready, 191 görev/8 belge; 5 paralel açılış isteği en kötü 10009ms → 3726ms. Eski HTTP koşusunda yanıtlar200; kişisel tarayıcıdaki taşıma hatası doğrudan üretilmedi. Native Chromium6/6, runtime0; ekran görüntüsü açık temada incelendi. Kalıcı kanıt verification/server/back-823-verification.json. Doğrulanan binary dist/backlog konumuna atomik alındı; kişisel süreç yeniden başlatılmadı. Bilinen10 kimlik çakışması/20 dosya ve 409 koruması sürer; doctor yalnız preview, kaynak görev dosyaları/Finbee değişmedi. Önceki A-07 kayıtları korundu, A-08 yok, commit/push/merge yok. Doc-5 devir güncellendi. Ham kanıt ve önceki binary /tmp/backlog-dashboard-diagnosis-0onfs9yi içinde; kalıcı yedek değildir.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Eski sayısal kimlik-tire-başlık görev dosyaları, kayıtları değiştirmeden sunucu gözleminde tanınıyor. BACK-196 ilk tarama engeli giderildi; gerçek depo kopyasında pano ve menü native Chromium ile doğrulandı. 88 ilgili test, tip/Biome, native build ve CLI/web/MCP smoke geçti; 6 tarayıcı kontrolü/runtime0. Dist binary güncellendi; kişisel sunucunun aynı data-dir ile yeniden başlatılması gerekiyor. Bağımsız eski arşiv kimliği çakışmaları korundu; tam CI yeniden koşulmadı. Kanıt verification/server/back-823-verification.json ve doc-5.
<!-- SECTION:FINAL_SUMMARY:END -->
