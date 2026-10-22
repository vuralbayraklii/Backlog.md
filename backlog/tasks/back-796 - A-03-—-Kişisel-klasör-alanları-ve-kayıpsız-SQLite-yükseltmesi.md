---
id: BACK-796
title: A-03 — Kişisel klasör alanları ve kayıpsız SQLite yükseltmesi
status: Done
assignee:
  - '@codex-areas'
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
ordinal: 401000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Normal kullanıcının proje kaydetme yetkisini admin tarafından atanmış gerçek klasör alanı belirler. Farklı kullanıcıların alanları çakışamaz. Mevcut hesap, oturum, proje ve üyelik verileri korunmalı; alanın kaldırılması üyelikleri silmemelidir. Sahiplik: database.ts, auth-store.ts, folder-areas.ts ve ilgili veri testleri.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A-01/A-02 verisi yalnız başarılı yazmada atomik yükselir; kimlikler, hesaplar, oturumlar ve üyelikler korunur; okumalar dosya/şema oluşturmaz.
- [x] #2 Alan listeleme/upsert/kaldırma gerçek yolları, güncel hesabı ve farklı kullanıcı alan çakışmalarını denetler; alan kaldırma proje üyeliğini korur.
- [x] #3 Kayıt işlemi içinde yeniden kullanılacak hesap/alan yetki denetimi aynı SQLite bağlantısını kullanır; varsayılan üyelik izinleri korunur.
- [x] #4 Göç, çakışma, yol değişimi, yetki kaldırma ve mevcut auth regresyonları anlamlı testlerle doğrulanır.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recognize exact project-only v0, account v2, and additive v3 schemas; upgrade only inside a successful existing write transaction, preserving rows and read-only behavior.
2. Add canonical personal folder-area load/upsert/remove operations and shared synchronous registration-access/path checks on the caller’s SQLite connection.
3. Make account reads version-aware and deny permissions for untracked projects while preserving current member defaults.
4. Verify migrations, rollback, canonical-path/overlap/revocation behavior, and existing account regressions with scoped tests; review the result for simpler shared logic.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Startup: read MANIFESTO, AGENTS, CLI overview/execution, doc-4/doc-5 and pinned baseline. Shared branch tasks/server-a03-project-registration at 4e67653bb76723cb93ff299ac12f99fd10b36a87; existing A-03 records and contract preserved. groma agent-instructions unavailable (command not found); no Groma files changed.

Implementation ready for integration review: exact v0/v2/v3 schema recognition and additive transaction-only v3 migration; canonical folder-area list/upsert/remove; sync current-account/grant authorization on the caller connection; tracking=false permissions denied without membership deletion. upsert supports a synchronous optional beforeCommit session guard. Scoped test log /tmp/backlog-a03-8vr8jlkz/areas-scoped-tests.log: 38 pass, 0 fail, 234 expectations across server-auth-store and server-folder-areas. Covers v0/v2 rollback and identity/session/member preservation, strict-schema rejection, simultaneous conflicts, target deactivation, stale aliases, and grant revocation. Groma remains unavailable. Simplicity review retained the shared write policy, a single area representation and reused path predicates; no new store/service layers. Type check exposed one schema-map inference annotation (fixed) plus an in-progress binding test expectation; final shared type check remains with integration.

A-03 review follow-up: auth version gates now include v3 solely because folder areas/tracking extend the central schema; v0/v2 read/rollback and existing password/session/member regressions preserve prior behavior. New tracking permission denial is the accepted A-03 visibility contract and retains members. Fixed pre-upgrade v2 normal-user folder checks to return generic403 without creating/migrating schema. UI independent review found a delete lock-wait race; removeFolderArea now accepts an optional beforeCommit callback executed inside the write transaction, with a refusal test proving unchanged area, membership and exact DB bytes. Owned review tests additionally verify generic403 for foreign missing/file/directory paths, checked initial config discovery, and in-flight grant/account revocation. Latest owned group: 43 pass, 0 fail, 256 expectations across 3 files; /tmp/backlog-a03-8vr8jlkz/areas-review-removal-guard.log. No remaining proven blocking finding in areas-owned code; root handles remaining runtime review. Task remains active for final integration acceptance.

Final frozen-source review (read-only): confirmed all accepted data/registration findings closed. A-02/v2 normal users are denied generically before querying absent folder_areas; reads remain non-migrating. Preview/register use the same generic403 for unauthorized existing/missing/file paths, reject collisions before project-content inspection, and recheck current account/grants plus canonical roots inside the registration transaction. Root-config discovery and FileSystem rebinding now receive the checked opened-file reader; central Core/content-store/config watcher/asset reads use the same reader and keep prior layouts guarded. Project insertion and DEFAULT_PERMISSIONS membership remain one transaction. Folder-area deletion checks current admin inside the write lock, leaves existing memberships intact, and tracking changes preserve IDs/memberships while normal API/WS access rejects untracked projects. Additive v3 schema recognition still preserves v0/v2 identities/accounts/sessions/member data and rolls back failed writes. No concrete remaining blocker found in this bounded final review. No source edits or additional scenario investigation performed; root final full tests/Chromium are the integration acceptance evidence.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18724 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 20 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A-01/A-02 verisini koruyan eklemeli v3 şema ve kişisel klasör alanları tamamlandı. Alan iptali üyelikleri korur; güncel hesap/alan denetimi kayıt işlemi içinde, admin iptali silme işlemi içinde yeniden yapılır. Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti.
<!-- SECTION:FINAL_SUMMARY:END -->
