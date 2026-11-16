# COFFEE ILLY v82 — ТЕХНИЧЕСКИЙ АУДИТ БЕЗОПАСНОСТИ И ПОЛНАЯ ПЕРЕРАБОТКА ПОД MATERIAL DESIGN 3

## 1. Закрытие критических замечаний аудита (Документ 1 — P0 / P1 / P2)

| Приоритет | Замечание из аудита | Что исправлено в v82 |
| :--- | :--- | :--- |
| **P0** | Защита привязки Telegram и предотвращение подмены сотрудника (`tgId`) | В `Code.gs` добавлены `verifyTelegramInitDataHmac_()` (проверка HMAC-SHA256 подписи `WebAppData`) и `verifySafeTelegramBindingV82_()`: привязка `tgId` без подтверждённого HMAC или валидной PIN-сессии (`staffSessionToken`) отклоняется с ошибкой `TELEGRAM_BIND_AUTH_REQUIRED`. |
| **P0** | Синхронизация версий (`version.js` vs `Code.gs` vs `sw.js` vs HTML) | Во всех файлах (`version.js`, `Code.gs`, `sw.js`, `index.html`, `owner.html`, `admin.html`, `dashboard.html`, `report.html`, `manual.html`) установлен единый номер версии **v82**. |
| **P0** | Прямое подключение `js/material-design.js` и устранение дублирования в `js/sync.js` | Удалён дублирующийся блок Ripple из `js/sync.js`; модуль `js/material-design.js` напрямую подключён во все 6 HTML-страниц и добавлен в кэш `sw.js`. |
| **P1** | Приватность фотографий в Google Drive | В `Code.gs` функция `applySecureDriveFileSharingV82_(file)` по умолчанию закрывает публичный доступ (`DriveApp.Access.PRIVATE`), открывая ссылку только при явном флаге `ALLOW_PUBLIC_PHOTO_LINKS = '1'`. |
| **P1** | Проверка доставки Telegram-уведомлений (фото, видео, интерактивные кнопки) | В `Code.gs` добавлена функция `sendTelegramVerifiedV82_()`, проверяющая HTTP-код `200` и поле `body.ok === true` ответа Telegram Bot API для `sendMessage`, `sendPhoto` и `sendVideo` с `reply_markup`. |
| **P2** | Контроль расхождения счётчика `+34` и 5 неклассифицированных позиций | Модуль сверки продаж помечает расхождение счётчика и неклассифицированные позиции статусом `warning` (`requiresVerification: true`) в Центре контроля исключений администратора. |

---

## 2. Полная дизайн-система Material Design 3 — Coffee Illy Premium (Документ 2)

### 2.1. Единая цветовая система (`css/light.css`)
Все устаревшие переменные (`--bg`, `--surface`, `--ink`, `--muted`, `--brew`, `--crema`, `--good`, `--warn`, `--bad`) напрямую связаны с токенами `--md-sys-color-*`:

| Роль | Premium Light | Premium Dark |
| :--- | :--- | :--- |
| Основной фон (`--md-sys-color-background`) | `#F5F2ED` | `#151619` |
| Основная поверхность (`--md-sys-color-surface`) | `#FFFBF8` | `#202126` |
| Вторичная поверхность (`--md-sys-color-surface-container`) | `#F1E8E1` | `#292B30` |
| Главный текст (`--md-sys-color-on-surface`) | `#241B16` | `#F3F1ED` |
| Вторичный текст (`--md-sys-color-on-surface-variant`) | `#65574F` | `#C7BDB7` |
| Primary (`--md-sys-color-primary`) | `#8B5022` | `#FFB689` |
| Успех (`--md-sys-color-success`) | `#286B4D` | `#81D5A8` |
| Предупреждение (`--md-sys-color-warning`) | `#805600` | `#F4C66A` |
| Ошибка (`--md-sys-color-error`) | `#BA1A1A` | `#FFB4AB` |

### 2.2. Компонентная библиотека M3 (`js/material-design.js` и `css/light.css`)
- **Кнопки**: `.md3-btn-filled`, `.md3-btn-tonal`, `.md3-btn-outlined`, `.md3-btn-text` с состояниями `hover`, `focus-visible`, `disabled` и поддержкой `prefers-reduced-motion`.
- **Поверхности и диалоги**: 3 уровня поверхностей (`Surface`, `Surface Container`, `Surface Container High`), мобильные `Bottom Sheets` (`border-radius: 28px 28px 0 0` на экранах `< 640px`).
- **Состояния загрузки и пустых списков**: `window.CoffeeMaterialDesign3.renderSkeleton()` и `window.CoffeeMaterialDesign3.renderEmptyState()`.
- **4 честных статуса синхронизации (`window.CoffeeMaterialDesign3.SYNC_STATES`)**:
  1. `local_saved` — «Сохранено на устройстве»
  2. `sending` — «Отправляется»
  3. `server_confirmed` — «Подтверждено сервером»
  4. `send_error` — «Ошибка отправки»
