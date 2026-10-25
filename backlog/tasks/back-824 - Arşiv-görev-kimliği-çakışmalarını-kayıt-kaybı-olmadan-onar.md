---
id: BACK-824
title: Arşiv görev kimliği çakışmalarını kayıt kaybı olmadan onar
status: Done
assignee:
  - '@codex'
created_date: '2026-10-25 09:05'
updated_date: '2026-10-25 09:16'
labels:
  - server
  - data-repair
dependencies: []
documentation:
  - backlog/docs/server/doc-5 - Sunucu-geliştirmesi-devir-notu.md
priority: high
type: bug
ordinal: 429000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kullanıcının merkezi Backlog.md panosunda 10 grup/20 dosya için Duplicate task IDs uyarısı var. A-00 başlangıcından kalan arşiv/completed çakışmaları bazı kayıtların görünmesini ve kimlikle erişimini engelliyor. Kullanıcı 25 Ekim 2026 tarihinde kayıtların korunarak onarılmasını istedi; mevcut A-07/BACK-823 yerel çalışmaları korunacak.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Yerel aktif ve arşiv görevleri arasında aynı kanonik kimliği kullanan kayıt kalmaz; 10 eski kimliğin korunacak görevleri ve yeni kimlik eşlemesi kayıtlıdır.
- [x] #2 Görev içerikleri ve durumları korunur; dosya taşıma ve kimlik değişiklikleri öncesi yedek, dosya özetleri ve etkilenen referans incelemesi vardır.
- [x] #3 Pano için kullanılan çakışma önizlemesi boş gruplar döndürür ve onarılan eski/yeni kimlikler okunur; kaynak gözlemi sağlıklıdır.
- [x] #4 Önceki A-07/BACK-823 kaynak/kanıt kayıtları korunur, sonuçlar ve devir CLI ile güncellenir; Finbee ve A-08 kapsamı değişmez.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Başlangıç Git farklarını, Backlog/kanıt kayıtlarını ve SQLite online yedeğini özel server-data/repair-backups altında koru; ayrı özellik dalında önceki A-07/BACK-823 çalışmalarını taşı. 2. Kanonik doctor önizlemesini ve referans listesini incele; tam geçici kopyada doctor --fix --yes ile 10 kimlik değişikliğini ve completed arşiv taşımasını prova et, tüm önceki kayıtların içerik eşlemesini doğrula. 3. Gerçek kökte aynı kanonik onarımı uygula; eski kimliklerin completed kayıtlarında kalmasını, yeni kimliklerin boş ve çakışmasız olmasını ve taşınan kayıtların gövde/metadata bütünlüğünü dosya özetleriyle kanıtla. 4. Pano API ve gözlem sağlığını izole native sunucuda doğrula; belirsiz eski referansların anlamını kaynaklarla incele, tahmini yeniden bağlama yapma. 5. En küçük çözümü koru: ürün koduna değişiklik ekleme; kalıcı onarım raporu, görev kapanışı ve doc-5 devrini CLI ile güncelle. Finbee/A-08 ve commit/push kapsamına girme.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Kullanıcı onayıyla görev @codex üzerine açıldı, tasks/server-duplicate-task-ids dalı oluşturuldu; başlangıç Git/kayıt/SQLite online yedeği özel server-data/repair-backups/20261025T090420Z-duplicate-ids-bwggsfme altında. Kanonik doctor önce tam kopyada, sonra gerçek kökte uygulandı: 10 arşiv kaydı BACK-825–834 olarak yeniden numaralandı, asıl eski kimlikler korundu, 585 completed kaydı arşive taşındı. 867 dosyanın tamamı eşlendi; 10 id alanı dışında içerik/metadata değişmedi. Son iş akışı yazımları yalnız bu görev ve doc-5; kalan 865 kayıt korundu. Önceki A-07/BACK-823 dahil 37 kaynak/kanıt özeti aynı. Beş tarihsel referans incelendi: BACK-570 eski branch-local kaydı artık BACK-834 olarak eşler; BACK-585 atıfları 670c5bd7 ile asıl BACK-569 kaydına gider; iki doc-5 satırı geçmiş durumdur. Bağımlılıklara tahmini kimlik yazılmadı. Gerçek tarama 857 girdi/0 sorun/0 çakışma, CLI eski/yeni20 okuma başarılı. Native sunucu açık tam kopyada onarım öncesi10 grup/409, sonrası API grupları boş/ready ve20 HTTP200; Chromium9/9/runtime0, ekran gözle incelendi. Yazmasız Biome554 geçti; server-data Git dışında korunur. git diff --check yalnız taşınan özgün BACK-41 içeriğindeki üç mevcut sondaki boşluğu bildiriyor; diğer yollar geçti. Tam CI/tip/build tekrar koşulmadı; ürün kodu/binary bu işte değişmedi, sadelik incelemesi mevcut kanonik onarımla sınırlı kaldı. Kişisel oturum kullanılmadı/süreç yeniden başlatılmadı. Finbee/A-08/commit/push/merge yok. Kanıt verification/server/back-824-verification.json ve ekran görüntüsü; doc-5 güncellendi.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Panodaki 10 kimlik çakışması kanonik doctor ile onarıldı. Eski kimlikler asıl kayıtlarda korundu; çakışan arşivler BACK-825–834 oldu ve 585 completed dosyası arşive taşındı. 867 dosyada içerik/metadata koruması, gerçek kaynakta sıfır çakışma,20 CLI okuması ve native Chromium9/9 doğrulandı. Kalıcı özel yedek ve eşleme raporu var;5 tarihsel referans incelendi. Ürün kodu/binary değişmedi, önceki A-07/BACK-823 kayıtları korundu. Kişisel panoyu yenilemek yeterli; commit/push/merge yapılmadı. Diğer Git dallarındaki tarihsel çakışma tanıları ayrı kalır.
<!-- SECTION:FINAL_SUMMARY:END -->
