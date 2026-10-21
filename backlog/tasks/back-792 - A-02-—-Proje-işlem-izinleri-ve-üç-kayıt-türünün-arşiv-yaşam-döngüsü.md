---
id: BACK-792
title: A-02 — Proje işlem izinleri ve üç kayıt türünün arşiv yaşam döngüsü
status: Done
assignee:
  - '@codex-projects'
created_date: '2026-10-21 11:52'
updated_date: '2026-10-21 12:55'
labels:
  - server
  - a-02
dependencies:
  - BACK-789
references:
  - verification/server/a02-verification.json
priority: high
type: feature
ordinal: 397000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Alt ajan 2 sahipliği: src/server/index.ts ve proje HTTP/izin/arşiv testleri; gerekirse mevcut Core işlemlerine küçük düzeltmeler (önce ana ajana bildir). central.ts ve web dosyalarını değiştirme. Ana ajan oturumu çözerek istek başına yeniden denetlenebilir yetki callback sözleşmesini verir.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 İşlem izinleri rota tanımlarıyla aynı yerde bulunur; merkezi modda tanımsız işlem reddedilir.
- [x] #2 Ham karar Markdown durum geçişleri mevcut parser ile denetlenir; aynı karara yazılar sıraya girer ve güncel izin/durumla tekrar kontrol edilir.
- [x] #3 Görev, belge, karar archived/restore/delete API uçları Core semantiğini, alt görev ve referans bilgilerini korur.
- [x] #4 Ek dosya realpath sınırı ve aktif içerik güvenliği korunur; yerel browser regresyon testleri geçer.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Ortak sözleşme: src/server/auth-types.ts; ServerUser {id,username,displayName,role,active,mustChangePassword}; AuthSession {user,csrfToken,createdAt,expiresAt,lastActivityAt,idleExpiresAt} ISO zamanları. İzinler tasksWrite/docsWrite/decisionsWrite/decisionsManage/archive/delete; membership proje okumasını sağlar; admin tüm izinlere otomatik sahip. JSON API düz nesne/dizi; hata {error:string}; CLI schemaVersion:1. Auth uçlarında login {username,password}, password {currentPassword,newPassword}; session/login/password AuthSession döndürür. Admin users POST {username,password,displayName?,role?}; PATCH/PUT {displayName?,role?,active?}; reset-password POST {password}; members GET ProjectMember[], PUT {permissions: Partial<ProjectPermissions>} ve DELETE. Proje ayrıntısı {id,name,permissions}. BacklogServer.dispatchApi(req,path,authorization?:ProjectAuthorization); check(read|admin|izin) güncel oturum/üyelik denetleyip null veya 401/403/404 Response döndürür. acceptSocket(ws,authorize?:()=>boolean) her gönderimden önce kontrol edecek. central.start(port,openBrowser,{publicUrl,allowHttpLoopback?}) ve CLI zorunlu public-url.

1. Annotate the actual API route definitions with read/admin/operation permissions and deny unclassified central requests. 2. Reuse Core archive, restore and delete operations for all three record types, preserving detailed errors and affected records. 3. Serialize decision writes by ID and recheck current permission plus parser-derived previous/next status within each queued operation. 4. Guard every WebSocket send and enforce realpath-contained passive asset delivery. 5. Add focused HTTP regression tests for all permissions, lifecycle behavior, decision races and asset/socket safety; run scoped tests and simplify.

Independent review found concurrent decision creation could allocate the same ID. Simplify to one project-local decision mutation queue, covering create/update/archive/restore/delete and current-permission checks after waiting. Keep permission metadata on the route wrapper and reject a central handler with missing metadata before invocation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Groma command was checked and remains unavailable; no Groma-owned files changed. Source CLI is used because backlog is not on PATH.

Implementation complete in src/server/index.ts plus server-project-permissions.test.ts and updated server-content-record-archive.test.ts. Focused adversarial suite: 52 successful, 162 assertions. Previous 8-file HTTP/local browser regression run: 82 successful, 0 failures, 307 assertions. Covers route permissions, missing route metadata, parser-derived decision status, alias/concurrent writes and permission revocation, concurrent decision ID allocation, archive/restore/delete for all record kinds, task subtasks/reference cleanup, content documentation references, asset realpath containment and active-content response policy, guarded WebSocket delivery. Independent UI/API review found milestone Remove controls used tasksWrite instead of delete and possible same-route editor refresh data loss; sent both findings to UI owner. No Core changes or Groma files; final integrated type/build/full-test checks stay with main agent.

Final scoped verification after all code edits: bun test --timeout=10000 with server-project-permissions, server-assets, server-content-record-archive, server-document-archive, server-decision-archive, server-loading-progress, server-demote-endpoint, server-milestone-broadcast: 83 passed, 0 failed, 309 assertions, 8 files. Actual local Bun HTTP test confirms /tasks/archived, /docs/archived and /decisions/archived literals win over :id routes. Log /tmp/backlog-a02-project-operations-tests.log. Written-free Biome on the three owned source/test files passes (3 files, no fixes). Standalone adversarial suite is 52 tests/162 assertions. Main agent retains terminal status/acceptance finalization after full integration checks.

Son entegre kaynak: tam bun run test 3689 başarılı / 13 atlanan / 0 başarısız, 3702 test/329 dosya/17906 beklenti, çıkış 0. Tip kontrolü 567 dosyada geçti; yazmasız Biome ve build başarılı; native CLI/web/MCP smoke ve son 1440x1000 Chromium 31 iddia geçti. Kabul-test eşlemeleri ve SHA-256 özetleri verification/server/a02-verification.json içinde. Üç bağımsız inceleme tamamlandı, açık engelleyici bulgu yok. Sadelik incelemesi ortak SQLite, rota izinleri, Core yaşam döngüsü ve ortak istek istemcisini korudu.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gerçek rota tanımlarında işlem izinleri ve tanımsız merkezi işlem reddi; güncel parser/durum/izinle sıraya alınmış karar mutasyonları; üç kayıt türünde arşiv/geri getirme/kalıcı silme; guarded WS ve sınırlandırılmış ek dosyalar tamamlandı. Kimlik tahsis yarışı, alt görev ve referans kuralları 52 adversarial test dahil 83 ilgili testle doğrulandı. Son birleşik testler ve 31 Chromium iddiası geçti.
<!-- SECTION:FINAL_SUMMARY:END -->
