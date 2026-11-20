# Coffee Illy v97.0 — Полная двусторонняя синхронизация Дашборд ↔ Терминал

## Что исправлено в v97.0
1. **100% покрытие `bumpDataRev_()` в `Code.gs`**:
   - Добавлен `bumpDataRev_()` в 9 ранее пропущенных функций записи (`reportIncident_`, `saveSetting_`, `saveSettingSecure_`, `updateExpense_`, `deleteIncident_`, `deleteChecklistBlock_`, `bindTelegramUser_`, `changeStaffPin_`, `saveStaffPins_`). Теперь **любое** изменение с телефона бариста или ПК владельца обновляет `DATA_REV` и прилетает на второе устройство за ~0.9–1.8 сек.
2. **Исправлен приоритет планов и графика (`getDailyPlansAndRosterFromSheet_`)**:
   - Ранее сохранённые планы (`DAILY_PLANS_JSON`) и график (`SHIFT_ROSTER_JSON`) перезаписывались старыми значениями листа `Планы`. Теперь актуальные правки из дашборда имеют приоритет и сразу доходят до терминала.
3. **Защита от гонок и дублей (`js/cloud-sync-v97.js`)**:
   - Добавлены `_mutationEpoch` (устаревший сетевой ответ `pullNow()` больше не может затереть свежее локальное действие) и `_pullInFlight` (один активный запрос без наслоения), а в `index.html` убран двойной POST при прохождении шага чек-листа.
4. **Полный паритет данных между `owner.html` и `index.html`**:
   - В `owner.html` (вкладка **Команда**) добавлен блок **«📢 Объявления для терминала»** (`+ Объявление` / `✕ Удалить`).
   - В `index.html` добавлены живой **«🎯 План смены на сегодня»** (вкладка **Касса**) и **«📦 Склад и сроки годности»** (`+ Срок` / `✓ Списать`) + **«✨ Карта добрых дел»** (вкладка **Задачи**).

## Установка (2 шага)
1. **Google Apps Script**: замените код в проекте Apps Script содержимым `Coffee_Illy_Code_v97.0.gs.txt`, сохраните и нажмите **Развернуть → Управление развёртываниями → Редактировать → Новая версия → Развернуть**.
2. **GitHub Pages**: распакуйте `coffee-illy-v97.0-m3soft-production.zip` в `C:\Users\COMP\Documents\GitHub\coffee-illy` с заменой файлов и выполните:
   ```bash
   cd /c/Users/COMP/Documents/GitHub/coffee-illy
   git add -A
   git commit -m "Release v97.0: full Dashboard <-> Terminal data parity and race-free sync"
   git push origin main
   ```
