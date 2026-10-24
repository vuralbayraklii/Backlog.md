---
id: BACK-821
title: A-06 inceleme güveni ve taslak yaşam döngüsü düzeltmeleri
status: Done
assignee:
  - '@codex'
created_date: '2026-10-23 20:16'
updated_date: '2026-10-23 20:22'
labels:
  - server
  - a-06
dependencies: []
references:
  - src/web/components/TaskReviewPanel.tsx
  - src/core/backlog.ts
priority: high
type: bug
ordinal: 426000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kullanıcı iki review bulgusunun ayrı ayrı doğrulanmasını istedi: genel inceleme talebinin dosyadan kabul türüne çevrilmesi tarayıcıda yanlış Accepted gösterebiliyor; görev taslağa indirilip değiştirilip geri alındığında aynı kimlikle yükseltme eski yerel incelemeyi canlandırabiliyor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dosyadan değiştirilmiş güvenilmeyen talep doğrulanmış kullanıcı kabulü olarak gösterilmez; gerçek kabul görünmeye devam eder.
- [x] #2 Taslak düzenleme ve görev/taslak yaşam döngüsündeki içerik değişimleri geri alınsa da eski inceleme yeniden onaylanamaz.
- [x] #3 Her bulgu başarısız regresyonla doğrulanır; küçük ortak düzeltmeler sonrası ilgili testler, tip ve Biome kontrolleri kaydedilir.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Talep türü değiştirilmiş gerçek API kaydı ve DOM özeti ile yanlış kabulü; aynı kimliği yeniden kullanan yerel görev/taslak akışı ile eski incelemenin canlanmasını regresyonlarla doğrula.
2. Kabul özetinde güvenilir talep-yanıt bağını denetle. İçerik revizyonunu görev/taslak ortak yazımında ilerlet; yaşam döngüsünde önceki kaydı karşılaştırmaya geçir.
3. İlgili review, taslak, yaşam döngüsü ve yazma regresyonlarını, tip ve yazmasız Biome kontrollerini çalıştır; sadeleştirmeyi ve doc-5 devrini kaydet.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Başlangıç dalı tasks/server-a06-review-history ve mevcut yerel değişiklikler korundu. Diff/indeks/izlenmeyen kayıt yedeği /tmp/backlog-review-validation-he_6qq15; kişisel server-data yedeğe okunmadı. Groma komutu mevcut değil. Görev CLI allocator kilidi için gerekli yerel izinle oluşturuldu.

İki bulgu doğrulandı: eski DOM yanlış Accepted gösterdi; dedicated/edit/filesystem yerel akışlarının üçü de eski talebi onayladı. Kabul özeti güvenilir/güncel talebe bağlandı. Revizyon denetimi FileSystem ortak saveTask/saveDraft yoluna taşındı; lifecycle kaynak kaydı ve ContentStore iletimi tamamlandı. Legacy kimlik yazımlarındaki workflow-only değişikliklerin revizyonu artırmaması ayrıca doğrulandı. Son ilgili test grubu 258 başarılı/1 mevcut PTY atlaması/0 hata; DOM20/0. Tip637, Biome ve iki TSX sıfır tanı, diff, geçici native build ve CLI/web/MCP smoke geçti. Tam CI/Chromium yeniden koşulmadı. Kanıt verification/server/back-821-verification.json; doc-5 güncellendi. Sadelik incelemesi yeni servis/depo veya dış API eklemeden tek özel revizyon yardımcısı ve dört üretim dosyasındaki küçük değişiklikleri korudu. dist/backlog ve kişisel süreç değiştirilmedi; commit/push/merge yok.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
P1: Dosyadan değiştirilmiş güvenilmeyen talepler artık doğrulanmış kabul göstermez; gerçek kabul korunur. P2: Görev/taslak içerik yazımları ve geçişleri revizyonu ortak yoldan ilerletir; geri alınmış içerik eski incelemeyi canlandırmaz. 278 başarılı test, 1 mevcut PTY atlaması, 0 hata; tip/Biome/build/smoke geçti. Kanıt back-821-verification.json, devir doc-5. Kaynak düzeltildi; kişisel binary/süreç yenilenmedi, commit/push yok.
<!-- SECTION:FINAL_SUMMARY:END -->
