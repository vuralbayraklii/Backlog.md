---
id: BACK-820
title: >-
  A-06 inceleme düzeltmeleri: özet performansı, eski doğrulama, pencere kapanışı
  ve CLI JSON
status: Done
assignee:
  - '@codex'
created_date: '2026-10-23 19:01'
updated_date: '2026-10-23 19:16'
labels:
  - server
  - a-06
dependencies: []
references:
  - src/server/index.ts
  - src/web/components/TaskReviewPanel.tsx
  - src/web/components/TaskDetailsModal.tsx
  - src/commands/connected.ts
  - verification/server/back-820-verification.json
priority: high
type: bug
ordinal: 425000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A-06 sonrası incelemede proje özeti geçmişi görev başına yeniden tarıyor, geri alınan dış içerik değişikliği eski doğrulamayı güncel gösteriyor, temiz görev penceresi kapanışta onay istiyor ve bağlı review alt komutları task üstündeki JSON seçeneğini kaybediyor. Kullanıcı bu dört bulgunun commit/push öncesi düzeltilmesini istedi.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Proje özeti geçmişi istek başına bir kez okur ve görev başına review görünümünü tekrar hesaplamaz; 1000 görev/1000 olay ölçümü kaydedilir.
- [x] #2 Eski doğrulama güncel özetten çıkarılır; geri alınmış içerik için eski başarılı doğrulama kabulü açmaz.
- [x] #3 Temiz görev penceresi onaysız kapanır; kaydedilmemiş görev veya inceleme değişiklikleri kapanışta korunur.
- [x] #4 Bağlı task --json review list ve diğer review alt komutları sürümlü JSON sözleşmesini devralır; regresyon testleri ve ilgili kontroller geçer.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Dört bulgu için mevcut API/CLI/DOM testlerinde başarısız regresyonları kaydet.
2. Proje özetinde tarihçeyi tek sayfalama geçişinde kayıt kimliğine göre grupla; tekil detay ve özet aynı güven/eski içerik hesaplamasını kullansın ve görev görünümü bir kez hesaplansın.
3. Doğrulama özetini eski içerik denetimiyle hizala; modal kapanışını mevcut kirli kayıt onayına bağla; bağlı komut seçeneklerini tüm üst komutlardan devral.
4. İlgili testleri, tam CI profilini, tip/Biome/diff kontrollerini, 1000 görev/olay performans ölçümünü ve derlenmiş CLI/web/MCP-Chromium doğrulamasını tamamla; sadeleştirme incelemesi ve doc-5 devrini kaydet.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Başlangıç tasks/server-a06-review-history dalında A-06 yerel değişiklikleri vardı. Diff/indeks/izlenmeyen dosyalar /tmp/backlog-a06-review-fixes-5s563zua içinde korundu. Groma komutu kurulu değil; yönetilen mimari dosyaları değiştirilmez. Eski 10 görev kimliği çakışması bu kapsamın dışında.

Dört bulgu eski kaynakta yeniden üretildi: özet 5 geçmiş okuması (beklenen 1), eski doğrulamada Passed, temiz kapanışta onay ve task üstündeki JSON seçeneğinde schemaVersion/kind eksikliği. Düzeltilmiş ilgili testler API/CLI13 ve DOM18 geçti. Gerçek geçici SQLite, aynı 1000 görev/1000 olay: önce8774.08ms/2000 geçmiş okuması/2000 view; sonra421.16ms/10 sayfa okuması/1000 view; sonuçlar birebir aynı. Ölçüm yalnız özet hesabıdır, proje gözlemi veya uçtan uca HTTP süresi değildir. Tekil/özet görünüm aynı güven/eski içerik algoritmasını kullanır; yeni kalıcı önbellek/depo/servis yok.

Son tam CI 4018 başarılı / 13 atlanan / 0 hata (4031 test,21161 beklenti); tip637, yazmasız Biome/diff, native build ve CLI/web/MCP smoke geçti. Aynı kurallarla ilgili TSX karşılaştırmasında yeni tanı yok (15→14 mevcut hata,4 uyarı sabit). Gerçek native Chromium10/10,runtime0,API yanıtı taklidi yok. Son kaynak662 girdi ve kanıt SHA-256 değerleri verification/server/back-820-verification.json içinde. dist/backlog doğrulanmış binary ile atomik güncellendi; önceki binary ham kanıt dizininde korundu. doc-5 güncellendi. Kişisel süreç/DB ve Finbee değiştirilmedi; commit/push/merge yok.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dört A-06 bulgusu düzeltildi: istek başına ortak geçmiş ve görev başına tek görünüm, eski doğrulamayı güncel özetten çıkarma, gerçek kirli duruma bağlı kapanış ve üst JSON seçeneğini devralma. Aynı 1000 görev/1000 olayda özet 8774→421ms; sonuçlar eşit. Tam CI4018 başarılı/13 atlanan/0 hata; tip/Biome/diff/build/smoke ve native Chromium10/10 geçti. Kanıt verification/server/back-820-verification.json, devir doc-5. Doğrulanmış dist/backlog güncel; süreç yeniden başlatılmadı, commit/push yapılmadı.
<!-- SECTION:FINAL_SUMMARY:END -->
