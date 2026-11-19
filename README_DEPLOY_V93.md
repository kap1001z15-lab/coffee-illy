# Coffee Illy v93.0 M3 Soft — Production Deploy Guide

## Что нового в v93.0
- **Кросс-устройственная и кросс-ОС синхронизация (iPhone / Android / iPad / Windows / macOS / Telegram)**: мгновенная синхронизация через Google Таблицу `Coffee_illy`, авто-пробуждение при возврате из фона (`pageshow` для iOS Safari bfcache, `visibilitychange`, `focus`, `online`), кнопка ручной синхронизации `↻` и живой статус RTT / очереди.
- **Выбор времени в стиле Google Pixel (Material 3 Time Picker)**: раздельный выбор часов (`00–23`) и минут (`00–59`), интерактивный циферблат 24ч/60м, кнопки `±` и быстрые пресеты для времени смены и окон чек-листов.
- **Умная финансовая аналитика с прогрессивным раскрытием**: переключение периодов (**Сегодня / День / Неделя / Месяц / Период**), верхний слой с 4 ключевыми метриками, дельтой к прошлому периоду, 1–3 умными инсайтами и графиком выручки, плюс раскрываемые разделы детализации (расходы по категориям, эффективность бариста, поиск по сменам, планы Пн–Вс).
- **Единый стиль Material 3 Soft везде**: все выпадающие списки и календари заменены на фирменные M3-меню (плавающее меню на ПК и bottom-sheet на мобильных).

## Установка на GitHub Pages (Git Bash)
1. Распакуйте архив `coffee-illy-v93.0-m3soft-production.zip` в `C:\Users\COMP\Documents\GitHub\coffee-illy` с заменой файлов.
2. Выполните в Git Bash:
```bash
cd /c/Users/COMP/Documents/GitHub/coffee-illy
git pull --rebase origin main
git add -A
git commit -m "Release v93.0 M3 Soft (Cross-OS Sync, Pixel Time Picker, Smart Finance Analytics)"
git push origin main
```
3. Если вы не меняли `Code.gs` с версии v92.0, повторно деплоить Apps Script не нужно — эндпоинт полностью совместим.
