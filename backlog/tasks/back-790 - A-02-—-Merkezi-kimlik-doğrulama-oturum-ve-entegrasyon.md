---
id: BACK-790
title: 'A-02 — Merkezi kimlik doğrulama, oturum ve entegrasyon'
status: Done
assignee:
  - '@codex'
created_date: '2026-10-21 11:52'
updated_date: '2026-10-21 12:55'
labels:
  - server
  - a-02
dependencies:
  - BACK-791
  - BACK-792
  - BACK-793
references:
  - verification/server/a02-verification.json
priority: high
type: feature
ordinal: 395000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ana ajan sahipliği: src/server/central.ts, src/server/auth-types.ts, entegrasyon testleri, README ve verification/server/a02-verification.json ile doc-5 devir kaydı. A-02 kullanıcı talebi onaylı kapsamdır; üç paralel uygulamayı ortak oturum/izin sözleşmesiyle birleştirir. A-03 proje kaydı, A-04 tarihçe ve A-05 agent modu kapsam dışıdır.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Giriş, zorunlu parola değişimi, cookie/CSRF/Origin, kalıcı hız sınırı ve süreler gerçek HTTP üzerinde doğrulanır.
- [x] #2 API, sayfa ve WebSocket erişimleri proje üyeliği ve güncel yetkiyle denetlenir; admin tüm işlemlere erişir.
- [x] #3 Son birleşmiş kaynakta tam Bun, DOM, tip, Biome, build, derlenmiş smoke ve Chromium akışları çalıştırılarak gerçek sonuçlar ve özetler kaydedilir.
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

Ana ajan: auth-types ortak sözleşmesini koru; hesap deposunu HTTP auth/admin uçlarına, her istek ve WS denetimine bağla; gerçek HTTP ve Chromium kabul akışlarını doğrula; tam test/tip/Biome/build/smoke sonuçlarını JSON kanıtı ve CLI devir belgesinde kaydet. Groma bulunamadı; yönetilen dosyalara dokunulmayacak. Başlangıç yedeği /tmp/backlog-a02-start.tar.gz; dal tasks/server-a02-accounts-authorization.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Entegrasyon: gerçek HTTP ilk koşu 19/19 (220 beklenti); son kaynak için HTTPS Secure cookie ve kalıcı 429 senaryosu da eklendi. Son native build ve mevcut CLI/web/MCP smoke başarılı. HeadlessChrome/153 CDP: 28 gerçek tarayıcı iddiası geçti; iki izole hesap, ilk parola değişimi, UI hesap ve proje üyeliği oluşturma, canlı izin aç/kapat, üç tür arşiv/geri getirme/kimlik onaylı silme, gerçek idle expiry sonrası metnin aynı hesapla korunması, farklı hesapta temizlenmesi ve yerel browser. Tam Bun testi son sabit kaynaktan üretilmiş CLI paketiyle sürüyor. Üç bağımsız alt ajan incelemesi tamamlandı; karar oluşturma yarışı, eski hesap state/preferences, Unicode parola ve doğrudan proje kökü sağlayıcı hatası giderildi.

Son kaynak sabitlendi. Tam bun run test ilk tamamlanan koşu: 3688 başarılı, 13 atlanan, 1 başarısız (3702 test/329 dosya/17908 beklenti, 1200.12s). Tek hata güvenli FTP autolink regresyonuydu; src/web/lib/project-scope.ts ftp protokolünü koruyacak şekilde düzeltildi, 30 ilgili test geçti. Son build ve compiled smoke yeniden geçti; son 1440x1000 Chromium 31 iddia ile başarılı (trusted activity ve güvenli FTP dahil). Şu anda aynı son kaynaktan üretilen /tmp/backlog-a02-verification/test-cli/cli.js ile nihai bun run test sürüyor; /tmp/backlog-a02-verification/full-tests.log. Kapanış yardımcıları make-report.py ve update-handoff.py aynı kanıt dizininde; tam koşu ve son tip/Biome geçmeden çalıştırılıp tamamlandı sayılmayacak. Önceki tam hata günlüğü full-tests-ftp-regression.log olarak korundu.

Son entegre kaynak: tam bun run test 3689 başarılı / 13 atlanan / 0 başarısız, 3702 test/329 dosya/17906 beklenti, çıkış 0. Tip kontrolü 567 dosyada geçti; yazmasız Biome ve build başarılı; native CLI/web/MCP smoke ve son 1440x1000 Chromium 31 iddia geçti. Kabul-test eşlemeleri ve SHA-256 özetleri verification/server/a02-verification.json içinde. Üç bağımsız inceleme tamamlandı, açık engelleyici bulgu yok. Sadelik incelemesi ortak SQLite, rota izinleri, Core yaşam döngüsü ve ortak istek istemcisini korudu. README ve doc-5 devir belgesi CLI ile güncellendi. A-03/A-04/A-05 başlatılmadı; Groma yokluğu ve atlanan testler sınır olarak kaydedildi. Son kaynak yerel A-02 özellik dalında commit ile teslim edilecek; push/merge yapılmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A-02, üç alt ajan uygulamasıyla birleştirildi: admin/kullanıcı hesapları, username/parola giriş ve zorunlu değişim, cookie/CSRF/Origin, kalıcı hız sınırı, proje/işlem izinleri ve anlık WS iptali, admin CLI/UI ile üç kayıt türünde arşiv/geri getirme/silme hazır. Son tam test 3689 başarılı/13 atlanan/0 başarısız; tip, yazmasız Biome, build ve native CLI/web/MCP smoke geçti. Gerçek 1440x1000 Chromium 31 iddiayı doğruladı. FTP regresyonu bulundu, düzeltildi ve son tam koşuda geçti. Kanıt a02-verification.json, devir doc-5; Groma yoktu. Yalnız geçici örnek projeler kullanıldı.
<!-- SECTION:FINAL_SUMMARY:END -->
