---
id: BACK-813
title: 'A-05 inceleme bulguları: gözlem performansı, arama ve bağlı işlem tekrarı'
status: Done
assignee:
  - '@codex'
created_date: '2026-10-23 10:44'
updated_date: '2026-10-23 11:05'
labels:
  - server
  - a-05
dependencies: []
documentation:
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
priority: high
type: bug
ordinal: 418000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kullanıcının dokuz A-05 bulgusu: kayıt başına gözlem okuma; bozuk dosyada restart sonrası güvenilir görüntü kaybı; bağlı arama query/çoklu filtre/taskType; belge/milestone tekrarının istemcide engellenmesi (MCP dahil); karar listesi revision/sayfalama kaybı. Yerel A-05 değişiklikleri korunur; commit/push yapılmaz.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Kimlik çözümü bütün gözlem görüntüsünü kayıt başına yüklemez; 1000 kayıt ölçümü ve regresyon kanıtı vardır.
- [x] #2 Bozuk dosyada yeni handler güvenilir kalıcı görüntüyü liste ve aramaya yayınlar; detay/yazma korumaları sürer.
- [x] #3 Bağlı search/doc search doğru query ve ayrı çoklu filtre parametreleri kullanır; taskType filtrelenir.
- [x] #4 Belge ve milestone rename/archive/remove aynı UUID, özgün revision ve girdilerle CLI/MCP üzerinden tek sonuç/olay döndürür; farklı girdi reddedilir.
- [x] #5 Karar listesi metin/JSON revision ve recordKey korur; JSON max-count/skip/total/nextSkip uygular.
- [x] #6 Regresyon, tip, yazmasız Biome ve derleme geçer; devir/kanıt günceldir.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. İstek ve toplu precondition boyunca tek gözlem checkpointi/path indeksi kullan; yeni handlera güvenilir içeriği ilk taramada yayınla.
2. ServerClient çoklu query değerlerini ayrı aktar; CLI query/taskType ve karar listesi revision/sayfalamasını düzelt.
3. Belge explicit content tekrarında güncel revision okumasını kaldır; milestone özgün hedefini CLI/MCPden doğrudan gönder, mevcut sunucu preconditionını aynı ad/ID sözleşmesine bağla.
4. Gerçek CLI/API/MCP regresyonları, 1000 kayıt kimlik ölçümü, tip/Biome/build ve uygun ortak yazma testlerini koş; sadeleştir ve devir/kanıt kaydet.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dokuz A-05 bulgusu düzeltildi: istek başına tek güvenilir görüntüyle kimlik çözümü; bozuk dosyada restart liste/arama yayını; query/çoklu filtre/taskType; belge ve milestone CLI/MCP tekrarı; karar revision/sayfalama. 1000 kayıt ölçümü 11.32s → 13.43ms. Son tam CI3973pass/13skip/0fail; types, yazmasız Biome, native build/smoke ve Chromium28/28 runtime0 geçti. Kanıt verification/server/back-813-verification.json; doc-5 güncellendi. Binary atomik güncellendi; kişisel süreç yeniden başlatılmadı. Commit/push yapılmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dokuz A-05 bulgusu düzeltildi: istek başına tek güvenilir görüntüyle kimlik çözümü; bozuk dosyada restart liste/arama yayını; query/çoklu filtre/taskType; belge ve milestone CLI/MCP tekrarı; karar revision/sayfalama. 1000 kayıt ölçümü 11.32s → 13.43ms. Son tam CI3973pass/13skip/0fail; types, yazmasız Biome, native build/smoke ve Chromium28/28 runtime0 geçti. Kanıt verification/server/back-813-verification.json; doc-5 güncellendi. Binary atomik güncellendi; kişisel süreç yeniden başlatılmadı. Commit/push yapılmadı.
<!-- SECTION:FINAL_SUMMARY:END -->
