---
id: BACK-806
title: Sunucu ekranlarını mevcut Backlog.md arayüzü ve tema akışıyla bütünleştir
status: Done
assignee:
  - '@codex'
created_date: '2026-10-22 11:32'
updated_date: '2026-10-22 12:09'
labels:
  - server
  - frontend
  - ui
dependencies:
  - BACK-798
  - BACK-803
references:
  - src/web/components/ProjectSelector.tsx
  - src/web/components/Layout.tsx
  - src/web/components/Navigation.tsx
  - src/web/contexts/ThemeContext.tsx
  - src/web/main.tsx
  - verification/server/back-806-ui.json
documentation:
  - backlog/docs/server/doc-4 - Backlog.md-çoklu-proje-takip-sistemi-planı.md
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
priority: high
type: bug
ordinal: 411000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kullanıcı, boş Projects ekranını mevcut Finbee önizlemesindeki Backlog.md arayüzüyle karşılaştırdı ve özelleştirmelerin mevcut frontend ve akış üzerine kurulması gerektiğini yeniden belirtti. Proje içindeki ekranlar mevcut App/Layout yolunda olsa da global proje seçimi, giriş/parola ve yönetim sayfaları ayrı dar düzen ve tema kapsamıyla kalmış. Kapsam bu görsel bütünlük eksikliğini gidermektir; A-05 başlamaz, gerçek Finbee bağlanmaz ve örnek kayıt üretilmez.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Giriş/parola, Projects/proje kaydı ve Users ekranları mevcut Backlog.md renkleri, tipografi, başlık ve uygun gezinme düzenini paylaşır; proje içi mevcut Layout da ortak çerçeveyi kullanır.
- [x] #2 Tek tema sağlayıcısı giriş öncesinden proje içi ekranlara kadar kaydedilmiş açık/koyu temayı ve sistem tercihini uygular; tema düğmesi ve tercih kalıcılığı tutarlıdır.
- [x] #3 Giriş, zorunlu parola değişimi, yetkili proje listesi, önizleme/kayıt ve mevcut proje panosuna geçiş aynı rotalarda kalır; proje izinleri, kirli form uyarıları ve mevcut pano/belge/karar akışları korunur.
- [x] #4 Derlenmiş arayüz boş ve kayıtlı proje durumlarında açık/koyu temayla gerçek Chromium üzerinde incelenir; ilgili DOM/regresyon, tip ve değişen TSX dahil yazmasız Biome sonuçları ve kalıtımlı sınırlar kaydedilir.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Mevcut Layout/Navigation/ThemeProvider ile global Projects/hesap/yönetim ekranlarını karşılaştır; kullanıcı görsellerindeki tasarım kopukluğunu aynı akış içinde gider. 2. Mevcut Layout çerçevesini küçük ortak AppFrame bileşenine ayır; global ServerLayout bunu aynı Navigation/ThemeToggle ile kullansın. Global menü yalnız Projects ve izinli Users yollarını gösterir; proje seçimi olmadan görev içeriği veya sahte sayaç yüklemez. 3. Tek ThemeProvider uygulama girişinde AuthProvider üstünde çalışsın; AppContent içindeki yinelenen sağlayıcılar kaldırılır. Giriş/parola, Projects/register ve Users mevcut form/istek işleyicileriyle aynı görsel çerçeveye alınır; mevcut projelerin panosu/düzenleyicileri kullanılır. 4. Mevcut DOM testlerini gerçek kök sağlayıcı düzenine uyarlayıp tema kalıcılığı ve auth/register/dirty-navigation regresyonlarını doğrula; değişen TSX için yazmasız kontrolü HEAD borcundan ayır. 5. Kullanıcının açık sunucusunu değiştirmeden ayrı /tmp native binary ve izole örnek proje ile gerçek Chromium açık/koyu, boş/dolu proje, kayıt-pano-Users-parola ve dar ekran akışlarını incele; PNG/kanıt ve CLI devir kaydıyla tamamla.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Kullanıcı görselleriyle doğrulanan eksiklik, global Projects/hesap/yönetim sayfalarının mevcut proje arayüzünden ayrı düzen ve tema kapsamıyla kalmasıydı. Mevcut Layout ortak AppFrame bileşenini kullanıyor; ServerLayout aynı çerçeve, Navigation ve ThemeToggle ile global ekranları gösteriyor. ThemeProvider main.tsx içinde AuthProvider üstüne taşındı; AppContent içindeki yinelenen sağlayıcılar kaldırıldı. Formların mevcut istek/izin/dirty guard işleyicileri korundu. Proje seçilmeden görev içeriği veya sahte sayaç üretilmez; kayıt sonrası mevcut App panosuna aynı rota ile gidilir.

45 dosyada 446 web testi, 2800 beklenti, 0 hata; 604 dosyada tip, varsayılan yazmasız Biome, native build ve derlenmiş CLI/web/MCP smoke çıkış 0. Değişen 19 TSX aynı kurallarla HEAD karşılaştırmasında mevcut4hata/31uyarı, başlangıç19hata/31uyarı; yeni tanı0. Ham TSX çıkış1 ve kalıtımlı tanılar ayrı raporlandı. Yeni iki bileşende tanı yok.

Ayrı derlenmiş sunucuda gerçek Chromium23kontrol/0runtimeerror: sistem/kayıtlı açık-koyu tema, reload, login/zorunlu parola, boş/dolu Projects, kirli kayıt formu iptali, kayıt sonrası mevcut pano/Milestones/belge/karar, Users/parola ve390px ekran. Boş Projects dark/light, mevcut Milestones dark ve Users mobile light PNG'leri gözle incelendi. Kaynak özeti747d58c4d5f5274b441f48341671aa454f5bf7cac131fd76f2ec07ad121bf0d7 son kontroller sonrasında aynı.

Kalıcı rapor verification/server/back-806-ui.json; üç karşılaştırılabilir PNG aynı klasörde. Ham kanıt /tmp/backlog-server-ui altında, kalıcı yedek değildir. Kullanıcı sunucusu veya veritabanı yeniden başlatılmadı/değiştirilmedi; gerçek Finbee bağlanmadı. Doğrulanmış binary atomik olarak dist/backlog'a alındı; aynı data-dir ile kullanıcı yeniden başlattığında yeni görünüm açılır. Doc-5 CLI üzerinden güncellendi. Sadelik incelemesi ortak küçük çerçeve/başlık/tema ve eski form/rota işleyicilerini kullandı; ayrı backend/ikinci görev arayüzü eklenmedi. Groma yoktu; yönettiği dosyalar ve manifesto değişmedi. Düzeltme tasks/server-ui-consistency dalında yerel, commit/push yapılmadı.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Global Projects, giriş/parola ve Users ekranları mevcut Backlog.md çerçevesi, başlığı, renkleri ve tema düğmesiyle bütünleştirildi. Tek tema sağlayıcısı uygulama girişinde çalışıyor; kayıtlı/sistem teması oturum ve proje geçişlerinde korunuyor. Mevcut pano, Milestones, belge/karar ve yetki/dirty guard akışları aynı bileşenler ve rotalarla sürüyor.

446 web testi, tip, varsayılan Biome, build ve derlenmiş smoke geçti. Gerçek Chromium23kontrol ve0runtimeerror; değişen TSX'te yeni tanı0, kalıtımlı borç ayrı kaydedildi. Kabul/screenshot: verification/server/back-806-ui.json. Yeni binary dist/backlog'da hazır; açık kişisel sunucu aynı data-dir ile yeniden başlatılmalıdır. Gerçek proje/Finbee veya kişisel sunucu verisi değiştirilmedi. Doc-5 güncellendi; değişiklikler yerel, commit/push yapılmadı.
<!-- SECTION:FINAL_SUMMARY:END -->
