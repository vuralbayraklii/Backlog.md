---
id: BACK-793
title: 'A-02 — Giriş, yönetim, proje izinleri ve arşiv arayüzleri'
status: Done
assignee:
  - '@codex-web'
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
ordinal: 398000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Alt ajan 3 sahipliği: src/web/** ve ilgili DOM testleri. Ortak src/server/auth-types.ts ana ajana aittir. Önceden mevcut ekranları kullanarak auth bağlamı ve tek istek davranışı ekle; central.ts/index.ts/CLI dosyalarını değiştirme.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Merkezi mod giriş/parola/kullanıcı ve proje üyelik yönetimi ile üç kayıt türünde arşiv görüntüleme/geri getirme/kimlik onaylı silme sunar.
- [x] #2 Yetki yüklenmeden veri/WS açılmaz; kontroller etkin izinlerle tutarlıdır ve bütün fetch çağrıları ortak oturum/CSRF davranışı kullanır.
- [x] #3 Oturum bitişinde kaydedilmemiş metin bellekte kalır; aynı hesapla dönüş korunur, farklı hesapta eski durum temizlenir; görünür etkileşim dakikada en fazla bir activity gönderir.
- [x] #4 DOM testleri ve mevcut yerel browser akışı korunur; başlık altına gereksiz açıklama eklenmez.
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

1. Add one cookie/CSRF request client and a central session gate that preserves mounted editors across login.
2. Add login/password, admin users/members, archive screens and permission-aware navigation/actions.
3. Route direct fetch calls through the client, protect Markdown links, add focused DOM/client tests, and review simplicity.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a central AuthProvider gate that waits for account and project permissions before mounting data views; expired sessions hide the mounted editor tree and overlay login. Same-account login preserves text, different accounts remount and use separate preference keys. Login, forced/voluntary password change, user administration, per-project membership permissions and three-kind archive screens now use one memory-only CSRF/cookie request client. All API mutations send once without automatic retry. Archive deletion asks with record ID, Core refusal messages and applied outcomes remain visible. Project write/archive/delete controls follow independent grants; proposed decision editing is enabled centrally. Markdown active schemes are blocked while project asset URLs remain scoped. Corrected the existing docs/decision refresh behavior to preserve dirty same-record editors. Groma is unavailable (groma agent-instructions: command not found); no Groma files changed.
Verification: bun test --timeout=10000 on eleven relevant existing/new web test files passed 125 tests and 778 assertions. Final owned run of web-auth.test.tsx, web-project-members.test.tsx and web-archive-page.test.tsx passed 15 tests, 61 assertions. Covers permission-before-mount, mandatory change, CSRF/password whitespace, expiry same/different account, dirty document/decision refresh, stale401, account preference separation, dangerous Markdown URLs, each archive kind restore/delete, ID confirmation, refusal/no-retry, applied deletion, default membership/add-reset/individual permission/removal. bunx biome check src/web passes (20 configured TypeScript files); new TSX files formatted with the repository tab/double-quote settings. Root owns final typecheck/build/full-suite/Chromium evidence and task closure. Independent central/auth-store/project API versus UI review found aligned payloads, fresh session/permission checks and queued decision-state checks; no unresolved implementation issue.

Final integrated regression follow-up: preserved the existing ftp: Markdown autolink behavior in scopeMarkdownUrl while retaining the explicit active-scheme rejection. Changed only src/web/lib/project-scope.ts. bun test --timeout=10000 src/test/mermaid-markdown.test.tsx src/test/web-auth.test.tsx passed 30 tests, 58 assertions, zero failures.

Son entegre kaynak: tam bun run test 3689 başarılı / 13 atlanan / 0 başarısız, 3702 test/329 dosya/17906 beklenti, çıkış 0. Tip kontrolü 567 dosyada geçti; yazmasız Biome ve build başarılı; native CLI/web/MCP smoke ve son 1440x1000 Chromium 31 iddia geçti. Kabul-test eşlemeleri ve SHA-256 özetleri verification/server/a02-verification.json içinde. Üç bağımsız inceleme tamamlandı, açık engelleyici bulgu yok. Sadelik incelemesi ortak SQLite, rota izinleri, Core yaşam döngüsü ve ortak istek istemcisini korudu.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Giriş/parola, admin hesap ve proje erişimleri, üç tür arşiv ekranları ve izinli kontroller eklendi. Cookie/CSRF ortak istemcisi mutasyonları tekrarlamıyor; aynı hesapla oturum dönüşü metni koruyor, farklı hesap state/tercihlerini ayırıyor. Trusted activity, tehlikeli URL engeli ve mevcut güvenli FTP bağlantıları doğrulandı. 15 yeni DOM testi, ilgili regresyonlar, tam 3689 başarılı test ve 31 gerçek Chromium kontrolü geçti.
<!-- SECTION:FINAL_SUMMARY:END -->
