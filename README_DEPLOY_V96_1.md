# Coffee Illy v96.1 (M3 Soft Production) — Полная двусторонняя синхронизация Дашборд ↔ Терминал

## Что исправлено в v96.1
1. **Полный паритет данных Дашборд ↔ Терминал (`Code.gs` + `js/cloud-sync-v96.js`)**:
   - В `buildStaffBootstrapDto_` добавлены все ранее отсутствовавшие сущности дашборда: `plan`, `planChecks`, `minAvgCheck`, `woNorm`, `initCounter`, `dailyPlans`, `shiftRoster`, `staff.tgId`, полные `ttk` (`price`, `cost`, `serve`), `cash`, `incidents`, `inventory`, `inventoryMoves`, `expiryItems`, `serviceAudits`, `goodDeeds`, `announcements`, `deadlineExtensions` и `userActiveState`.
   - В `mergeServerIntoState` добавлено слияние `deadlineExtensions` (онлайн-разблокировка и возврат окон чек-листов) и `announcements` (объявления владельца).
2. **Мгновенное обновление `DATA_REV` на всех изменениях**:
   - Исправлены ветки обновления в `saveTtk_` (поддержка `vol`/`cat`/`cost`/`serve` + `bumpDataRev_()`) и `saveStaff_` (сохранение `tgId` и `active` + `bumpDataRev_()`).
   - Добавлен `bumpDataRev_()` в `saveGoodDeed_`, `deleteGoodDeed_`, `saveServiceAudit_`, `deleteServiceAudit_`, `saveAnnouncement_`, `deleteAnnouncement_`, `addExpiryItem_`, `disposeExpiryItem_`, `saveChecklistDraft_` и `save_all_settings`.
3. **Живой прогресс шагов и отображение данных дашборда в терминале (`index.html`)**:
   - Терминал отправляет живой прогресс прохождения чек-листа (`pushLiveProgress`) на сервер, и дашборд владельца на другом устройстве сразу видит `«Открытие» 3/5`.
   - В терминале отображаются объявления от владельца, актуальный план дня на вкладке «Касса», предупреждения по заканчивающимся остаткам склада на вкладке «База» и обновлённые статусы поломок (`Решена`).

## Установка (2 шага)
1. **Google Apps Script**: обновите `Code.gs` содержимым `Coffee_Illy_Code_v96.1.gs.txt`, сохраните и нажмите **Развернуть → Управление развёртываниями → Редактировать → Новая версия → Развернуть**.
2. **GitHub Pages**: распакуйте `coffee-illy-v96.1-m3soft-production.zip` в `C:\Users\COMP\Documents\GitHub\coffee-illy` с заменой файлов и выполните:
   ```bash
   cd /c/Users/COMP/Documents/GitHub/coffee-illy
   git add -A
   git commit -m "Release v96.1: full bidirectional Dashboard <-> Terminal sync"
   git push origin main
   ```
