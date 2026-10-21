---
id: BACK-791
title: 'A-02 — SQLite hesap, oturum ve üyelik altyapısı ile yönetim CLI'
status: Done
assignee:
  - '@codex-accounts'
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
ordinal: 396000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Alt ajan 1 sahipliği: src/server/database.ts, src/server/auth-store.ts, src/server/project-store.ts, src/commands/server.ts ve bu alanların testleri. src/server/central.ts veya web dosyalarını değiştirme. Ortak auth-types.ts sözleşmesi ana ajana aittir. A-01 kayıtlarını koruyarak hesap ve proje erişimlerini kanonik yerel CLI üzerinden yönetilebilir kıl.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A-01 veritabanı tek işlemde kayıpsız yükselir; okuma dosya oluşturmaz/yükseltmez; bozuk ve tanınmayan şema reddedilir.
- [x] #2 Argon2id hesaplar, oturum özetleri, 12s/2s süreler, SQLite giriş sınırı ve izin varsayılanları uygulanır.
- [x] #3 CLI init-admin/create/list/view/edit/reset-password ve member list/set/remove gizli parola veya password-stdin ve schemaVersion 1 JSON sunar.
- [x] #4 Son aktif admin eşzamanlı işlemlerde korunur; pasifleştirme ve parola değişimleri oturumları iptal eder.
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

1. Extract a shared SQLite opener that validates known A-01/A-02 schemas, upgrades writes atomically, and leaves reads unchanged. 2. Implement accounts, Argon2id, hashed persistent sessions, SQLite login limits, memberships and final-active-admin protection. 3. Extend server user/member CLI with hidden/stdin password input and required public URL start options. 4. Verify targeted migration/account/CLI regressions and send exact integration contract to the main agent.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Hesap deposu ve ortak ServerDatabase tamamlandı. A-01 şeması yalnız yazmada, aynı BEGIN IMMEDIATE işlemi içinde eklemeli olarak yükseliyor; proje kimlikleri korunuyor. Şema SQL bildirimleri PK/UNIQUE/FK/CHECK/STRICT ve SQL sabitleri dahil tanınıyor; okumalarda dosya/şema değişmiyor. Argon2id 19456/2, kalıcı özetlenmiş oturum kimlikleri, 12 saat mutlak/2 saat hareketsizlik, SQLite üzerinde 5 başarısız/15 dakika ve 60 toplam/dakika sınırları var. Son aktif admin denetimi ve iptaller işlem içinde. Kanonik user ve project member CLI komutları, parola stdin/gizli istem ve schemaVersion 1 JSON eklendi; start public-url zorunlu. Son sahiplik test koşusu: bun test --timeout=10000 src/test/server-auth-store.test.ts src/test/cli-server-user.test.ts src/test/server-project-store.test.ts src/test/cli-server-project.test.ts: 48 başarılı, 0 başarısız, 270 beklenti, çıkış 0 (16.47s). Alt süreç stdio sandbox EPERM verdiği için aynı testler izinli çalışma ile doğrulandı. Altı sahiplik dosyasında yazmasız Biome başarılı. Gerçek PTY gizli parola istemi maskeli çıktı verdi; baştaki/sondaki boşlukların login ile korunduğu doğrulandı. Merkezi sunucu/WS bağımsız incelemesinde her gönderim + 1sn iptal kontrolü, arka planın idle uzatmaması ve güncel hash/aktiflik tekrar denetimleri doğrulandı; engelleyici bulgu yok. Tip/tam test/build son entegrasyon kaynakları için ana ajanda.

Son entegre kaynak: tam bun run test 3689 başarılı / 13 atlanan / 0 başarısız, 3702 test/329 dosya/17906 beklenti, çıkış 0. Tip kontrolü 567 dosyada geçti; yazmasız Biome ve build başarılı; native CLI/web/MCP smoke ve son 1440x1000 Chromium 31 iddia geçti. Kabul-test eşlemeleri ve SHA-256 özetleri verification/server/a02-verification.json içinde. Üç bağımsız inceleme tamamlandı, açık engelleyici bulgu yok. Sadelik incelemesi ortak SQLite, rota izinleri, Core yaşam döngüsü ve ortak istek istemcisini korudu.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ortak SQLite erişimi, kayıpsız A-01 yükseltmesi, Argon2id hesaplar, kalıcı oturum/giriş sınırları, üyelik izinleri ve kanonik user/member yönetim CLI tamamlandı. Son aktif admin eşzamanlı süreçlerde korunuyor; reset/pasifleştirme ve kendi parola değişimi oturumları iptal ediyor. 48 ilgili test, gerçek gizli terminal/parola boşlukları ve son birleşik doğrulama geçti; a02-verification.json kanıtları içeriyor.
<!-- SECTION:FINAL_SUMMARY:END -->
