---
id: BACK-795
title: A-03 — Hazır proje bağlama CLI/API entegrasyonu ve kabul doğrulaması
status: In Progress
assignee:
  - '@codex'
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
ordinal: 400000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hazır bağımsız Backlog projelerini merkezi uygulamaya güvenli biçimde bağlama. Kullanıcının A-03 talebi kapsam ve paralel çalışma yetkisidir. Ana ajan ortak tipler, central.ts, commands/server.ts, entegrasyon, README, rapor ve devri yönetir; taban 4e67653b. Kaynak yapılandırma veya proje yapısı oluşturulmaz.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI ve oturum/CSRF korumalı API önizleme, kayıt, kişisel alan ve takip yönetimini ortak semantiklerle sunar; mevcut register/list/view korunur.
- [x] #2 Güncel hesap/alan/yol/çakışma denetimi, atomik standart üyelik, takip iptali ve yeniden etkinleştirme entegrasyon testlerinde doğrulanır.
- [x] #3 Admin ve normal kullanıcıyla gerçek Chromium akışları, kaynak içerik özetleri ve bağımsız inceleme kanıtları kaydedilir.
- [ ] #4 Son birleşmiş kaynak üzerinde tam Bun, tip, yazmasız Biome, build ve derlenmiş smoke geçer; görevler, devir ve a03-verification.json güncellenir; commit/push ve uzak HEAD doğrulanır.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Doğrulanan 4e67653b tabanını ve başlangıç arşivini koru; üç alt ajanla verification/server/a03-contract.json sözleşmesini uygula. 2. Ana ajan ortak tipleri, oturum/CSRF korumalı merkezi API ve kanonik server CLI komutlarını bağlasın; projeler ve üyelikler atomik olsun, takip dışı erişim/WS kapansın. 3. Birleştirilmiş kaynakta alan/yol/önizleme/kayıt/takip ve kaynak özetleri entegrasyon testlerini çalıştır; üç ajan arasında bağımsız yetki/veri/kullanıcı akışı incelemesi yap. 4. Gerçek Chromium admin/normal kullanıcı akışları ve son kaynak üzerinde tam Bun, tip, yazmasız Biome, build, derlenmiş smoke doğrula. 5. Sadelik incelemesi, görev kapanışları, a03-verification.json, CLI devir güncellemesi, commit/push ve uzak HEAD eşitliğini tamamla.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Başlangıç Git temiz, uzak A-02 HEAD 4e67653bb76723cb93ff299ac12f99fd10b36a87 ile aynı. İstenen tasks/server-a03-project-registration dalı açıldı. Başlangıç arşivi /tmp/backlog-a03-8vr8jlkz/start.tar.gz; SHA-256 c18d04acbbdf63fc07e7c0421c8fc443df9dd18bc1c767f13a925cec9a66551b. Groma bulunamadı. BACK-795–BACK-798 CLI allocator ile oluşturuldu; sözleşme ve dosya sahipliği verification/server/a03-contract.json içinde.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18724 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 20 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.
<!-- SECTION:NOTES:END -->
