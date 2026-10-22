---
id: BACK-797
title: 'A-03 — Salt okunur proje önizlemesi, güvenli kayıt ve takip durumu'
status: Done
assignee:
  - '@codex-binding'
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
ordinal: 402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hazır standart, gizli ve özel Backlog klasörleri okunup bağlanacak; hazırlanmamış veya güvenli olmayan kaynak reddedilecek. Önizleme kayıt yetkisi sayılmaz. Sahiplik: project-store.ts, yeni proje yol denetimi modülleri, gerekirse server/index.ts ve yalnız bağlama/dosya testleri. central.ts, CLI ve ortak tipleri ana ajan yazar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Önizleme yapılandırma, kayıt sayıları, mevcut doğrulama sorunları ve kimlik çakışmalarını gösterir; geçersiz yapılandırma ve sınır dışı bağlantı kaydı engeller.
- [x] #2 Kayıt güncel gerçek yolları, aktör hesabını/alanını ve çakışmaları tekrar denetler; ilk standart üyelik ile proje aynı SQLite işleminde oluşur ve yarışta tek kayıt kalır.
- [x] #3 Takip durumu kalıcıdır; yeniden etkinleştirme klasörü yeniden doğrular ve aynı kimlik/üyelikleri korur.
- [x] #4 Yapılandırma, Backlog kayıtları ve eklerde proje dışına çıkan bağlantılar engellenir; sonradan değişimde önbellek/izleyici/WS dış içerik sızdırmaz.
- [x] #5 Kaynak dosya özetleri önizleme/kayıt/takip işlemleri öncesi ve sonrası aynıdır; standart/gizli/özel, hatalı kayıt ve yarış testleri geçer.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reuse the existing FileSystem config parser and Markdown/identity validators in a read-only synchronous inspection helper; validate canonical root, all config candidates before discovery, and the selected Backlog tree including assets. 2. Add preview, persistent tracking and actor-aware registration using a single ServerDatabase write transaction for current account/folder access, root collision, fresh path/config inspection and default membership; support a synchronous session guard at commit. 3. Guard central BacklogServer layout paths, asynchronous response delivery and WebSocket sends so a changed symlink cannot publish content from outside the registered root. 4. Verify standard/hidden/custom layouts, per-record diagnostics, no source mutation, stale grants/path changes, transactional rollback/concurrency and runtime symlink changes with focused tests; record evidence and simplify. Groma agent-instructions is unavailable (command not found); no Groma-owned files will be edited.

Final narrow privacy correction: collision-blocked actor previews return the normalized submitted path instead of a private canonical symlink target; trusted CLI previews retain canonical output. Extend the existing collision test for alias privacy and unchanged registration409, then run scoped store/registration/boundary/review regressions and freeze for root final validation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
A-03 implementation is active. ProjectStore now previews existing standard/hidden/custom layouts without Core initialization, records parse/identity warnings through existing parsers/validators, and inserts project plus DEFAULT_PERMISSIONS membership inside one current-account/grant/root-validation transaction. Tracking changes preserve identity and members; reactivation validates the existing source again. Shared-code edits are narrowly required by changed/transient symlink safety: Core passes one optional reader; FileSystem text/byte reads and discovery/rebinding use it; ContentStore and config-watcher reuse FileSystem reads so external data cannot enter existing caches; no parser/search/board/content model was replaced. Central mode checks opened Linux file-descriptor targets and sends checked asset snapshots, with pinned old-layout and post-await/API/WS guards. Local Bun text behavior is preserved by default. Initial 26 store/cache tests and 29 focused preview/boundary tests passed; 579-file type check passed. Existing reader/config/cache/content-store regressions and independent review are running. Groma remains unavailable.

Scoped implementation is stable for final root validation. Authorized regression command (ten files: server-project-store, server-project-registration, server-project-boundary, server-project-permissions, filesystem, filesystem-task-cache, content-store, config-watcher, backlog-directory, core-task-corpus-regressions) passed 255/255 tests, 0 skipped, 1353 expectations in 24.32s; log /tmp/backlog-a03-8vr8jlkz/binding-regressions-authorized.log. Earlier sandbox-only run had five draft-promotion timeouts because existing Git create locks require .git writes; isolated repro and authorized rerun are preserved, no test behavior was weakened. Type check passed 580 files; scoped Biome passed 11 files. Competing server processes leave one project and one standard membership. Existing local file/config/cache behavior passes without an injected reader. Independent reviewer findings fixed: forbidden existing/missing/file roots return generic403; initial/rebinding config discovery uses the opened-file reader; collision preview detects private existing bindings before source reads and returns empty config/counts with generic issue. Runtime transient task/config links are exercised by real watchers and rejected even when restored before later API; old layouts, assets, delayed API and WS are guarded. Independent UI review found no blocker; 26 DOM tests/113 expectations passed in binding-ui-review-tests.log. Simplification review retained one reader callback and the existing parsers/stores/search paths; no alternative content workflow added. Task deliberately remains In Progress for main-agent final acceptance and complete-suite/browser verification.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18724 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 20 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.

Reopened for final review finding: a collision-blocked actor preview could disclose a private canonical project root when the actor submitted an in-area symlink alias. The correction is confined to the blocker output and dependent canonical collision recheck; no endpoints or content architecture change. Main agent owns final rebuild, full-suite evidence and closure.

Final narrow privacy correction completed and source frozen. Collision-blocked actor previews now return resolve(submitted path), so an in-area symlink alias does not reveal the private canonical project root; trusted no-actor CLI previews retain canonical output. Blocked registration still checks the canonical target to preserve409 collision behavior; successful preview snapshots and root-change checks are unchanged. The existing privacy regression covers an alias input ending in /., verifies complete blocker JSON omits canonical target and private name, verifies trusted canonical output, and preserves alias registration409. Scoped existing store/registration/boundary/independent-review regressions passed51/51 tests,0 failures,232 expectations; type check580 files passed; Biome2 files passed without fixes. Evidence: /tmp/backlog-a03-8vr8jlkz/binding-final-alias-privacy-tests.log, binding-final-alias-types.log and binding-final-alias-biome.log. Main agent owns final-source full-suite rebuild/report and terminal task closure; no further source edits planned.

Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti. Kanıt: verification/server/a03-verification.json. Üç bağımsız inceleme açık engelleyici bırakmadı. Sadelik: tek SQLite ve alan/yol denetimi; mevcut Markdown/parser/CRUD/arama/pano korunuyor. Groma yoktu; gerçek proje bağlanmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Salt okunur hazır proje önizlemesi, özel projenin içeriğini okumadan çakışma denetimi, atomik standart üyelik ve kalıcı takip durumu tamamlandı. Merkezi güvenli okuyucu mevcut FileSystem/parser/ContentStore/arama/pano uygulamalarına bağlanır; değişen bağlantılar önbellek ve izleyici üzerinden dış içerik sunamaz. Tam Bun: 3814 başarılı / 13 atlanan / 0 başarısız; 3827 test / 337 dosya / 18728 beklenti. Tip, yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke geçti. Gerçek Chromium 21 kontrol, 0 işlenmemiş hata; 6 geçici kaynak için dosya listesi/SHA-256 özetleri eşleşti.
<!-- SECTION:FINAL_SUMMARY:END -->
