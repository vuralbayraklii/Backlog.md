---
id: BACK-822
title: A-06 inceleme yanıt bağları ve serileştirme düzeltmeleri
status: Done
assignee:
  - '@codex'
created_date: '2026-10-23 20:40'
updated_date: '2026-10-24 07:43'
labels:
  - server
  - a-06
dependencies: []
references:
  - src/server/central.ts
  - src/core/backlog.ts
  - src/core/task-review.ts
  - verification/server/back-822-verification.json
priority: high
type: bug
ordinal: 427000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review üç olası hata bildiriyor: yeniden kullanılan talep numarasına eski doğrulanmış yanıtın bağlanması, boş Acceptance Criteria bölümünün yazımda kaldırılmasıyla ilk talebin hemen eskimesi ve YAML anahtar sırasının güveni düşürmesi. Her bulgu ayrı ayrı doğrulanıp yalnız gerçek hatalar dar kapsamda düzeltilecek.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Eski doğrulanmış yanıt veya iptal, yeniden kullanılan numaradaki farklı talebi kapatamaz; gerçek talepler kendi yanıtlarıyla kapanır.
- [x] #2 İnceleme kayıtlarının içerik özeti gerçekten kaydedilen içerikle eşleşir; boş bölüm serileştirmesi tek başına yanıtı engellemez.
- [x] #3 Yalnız YAML nesne anahtar sırası değişimi güvenilir inceleme kayıtlarını veya kabul özetini bozmaz; anlamlı değişiklikler güven kazanmaz.
- [x] #4 Bulgular eski kaynakta regresyonlarla kanıtlanır; düzeltmeler sonrası ilgili testler, tip ve Biome sonuçları ile devir kaydı güncellenir.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Eski kaynağa karşı gerçek API regresyonlarıyla yeniden kullanılan talep numarası, boş checklist serileştirmesi ve YAML anahtar sırasını ayrı ayrı doğrula; yerel Core yolunu da kapsa.
2. Güven taramasında yanıt/iptalin referans verdiği talebi olay görüntüsüyle karşılaştır; nesne karşılaştırmasını anahtar sırasından bağımsız yap. İçerik özetini ortak serializer/parser ile gerçekten kalıcılaşan görevden hesapla.
3. İlgili review, Markdown ve yazım testlerini; tip, yazmasız Biome ve diff kontrollerini çalıştır. En küçük ortak uygulamayı gözden geçir, sonuçları ve doc-5 devrini kaydet.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Başlangıç dalı tasks/server-a06-review-history ve mevcut çalışmalar korundu. Başlangıç diff/indeks/izlenmeyen kayıt yedeği /tmp/backlog-review-three-lsr_rl80. Kişisel server-data okunmadı. Groma komutu bulunamadı. Yeni görev standart CLI allocator ile @codex üzerine alındı.

Üç bulgu doğrulandı: eski kaynakta 8 regresyon başarısız. Eski yanıt/iptal, güncel talep olayın özgün talebiyle aynı olmadıkça güven kazanmaz. Anahtar sırasından bağımsız derin karşılaştırma YAML biçimlendirmesinde güveni korur. Ortak içerik özeti serializer/parser sonucundan hesaplanır; boş AC/DoD serileştirmesi yerel ve HTTP yanıtını artık eskitmez. Üretim değişikliği yalnız central.ts ve core/task-review.ts içinde. Son ilgili grup 198/0, DOM20/0: toplam218 başarılı/0 hata/0 atlama. Tip637, yazmasız Biome, diff, geçici paket/native build ve CLI/web/MCP smoke geçti. Tam CI/native Chromium yeniden koşulmadı. Kişisel server-data/süreç ve dist/backlog değiştirilmedi. Kanıt verification/server/back-822-verification.json, devir doc-5 güncellendi. Sadelik incelemesi mevcut iki üretim dosyası ve ortak serializer/parser ile sınırlı; yeni servis/depo/API/UI yok.

Kullanıcı A-06 ve son düzeltmeler için uygunluk denetimi ardından commit/push yapılmasını onayladı. Başlangıç diff, indeks ve kişisel server-data hariç izlenmeyen kaynak/kayıt yedeği /tmp/backlog-a06-git-delivery-prqf3t99 içinde korundu. BACK-820 tam CI kaynak manifesti ile BACK-821/BACK-822 dosya özetleri birleştirildi: 662 kaynak/derleme girdisi birebir eşleşiyor; ek veya eksik src dosyası yok. Birleşik manifest SHA-256 4238d1ec03be82004bc49909823d49adb1b5c189738b32bc4d2fc9a1f45efecc. BACK-820/821/822 ham kanıt dosyalarının 48 özeti doğrulandı. Kaynak değişikliği gerekmedi; tam CI ve tarayıcı yeniden çalıştırılmadı. Git diff kontrolü geçti; normal pre-commit kancasıyla mevcut özellik dalına teslim hazırlanıyor.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Üç gerçek review hatası küçük ortak düzeltmelerle kapandı: yanıt ve iptal özgün talebe bağlanır; içerik özeti gerçekten kalıcılaşan görevden alınır; YAML nesne anahtar sırası güveni düşürmez. Eski kaynakta 8 başarısız regresyon; son kaynakta 218 başarılı, 0 hata, 0 atlama. Tip/Biome/build/compiled smoke geçti. Kanıt back-822-verification.json ve devir doc-5. Tam CI/Chromium yeniden koşulmadı; kişisel binary/süreç ve mevcut yerel çalışmalar korundu, commit/push yapılmadı.
<!-- SECTION:FINAL_SUMMARY:END -->
