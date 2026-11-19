# Coffee Illy v92.0 — Material 3 Soft + Live Google Sheets + Real Camera/Drive

- **Таблица Google Sheets:** `1FWFec1EvqeQ_2lnVIftyTgkeYfzIqFmmRWucpAaedqM` (`Coffee_illy`) — единый источник данных на чтение и запись.
- **Реальная камера + Google Диск:** в чек-листах открывается живая камера (`getUserMedia` + системная камера на мобильных/Telegram), фото сжимается до JPEG и загружается в папку `Coffee_ERP_Photos` на Google Диск с записью в лист `Медиафайлы`.
- **Быстрая двусторонняя синхронизация:** адаптивный `get_rev` (0.9 сек в активном режиме) + `BroadcastChannel` + офлайн-очередь с идемпотентностью.
