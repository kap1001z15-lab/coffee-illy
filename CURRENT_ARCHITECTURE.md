# CURRENT ARCHITECTURE — Архитектура системы Coffee Illy (v71)
Актуальная версия: v71

## 1. Общая схема архитектуры
Система построена на безсборочном (Zero-Build) стеке **HTML5 + CSS3 + Vanilla JavaScript (ES6+) + Google Apps Script + Google Sheets + Google Drive + IndexedDB + Telegram Bot API**:
1. **Уровень представления (3 ролевых пространства)**:
   - **Barista Terminal (`index.html`)**: Mobile-First интерфейс с 4 нижними вкладками (`Смена`, `Касса`, `Знания`, `Проблемы`), компактным меню профиля (`#baristaProfileDlg`) и офлайн-индикацией.
   - **Admin Workspace (`owner.html` / `admin.html`, 11 разделов)**: оперативное управление сменами, таймлайном, задачами (Список + Канбан 5 колонок), кассовой сверкой, персоналом, инцидентами, стандартами ТТК, складом, расходами, аудитом и настройками.
   - **Owner Workspace (`owner.html` / `dashboard.html` / `report.html`, 9 разделов)**: бизнес-обзор с KPI и SVG-графиками, финансовый P&L в 3 режимах (`Сводка`, `Детализация`, `Анализ`), мастер-деталь продаж по напиткам, себестоимость, склад, персонал, операции, симулятор прибыли и настройки.
2. **Локальный уровень хранения и синхронизации**:
   - **`Permanent Owner Vault` (`localStorage` + резервный `_memVaultFallback`)**: хранит нормализованное состояние всех 16 коллекций объектов.
   - **`CoffeeIDB` (`IndexedDB`)**: хранит тяжёлые медиафайлы (`idb://photo/...`), разгружая `localStorage`.
   - **`FIFO Outbox` (`coffee_api_outbox_v1`)**: гарантирует доставку операций с уникальным `operationId` и защитой от потери при обрыве связи.
   - **`AutoBackupManager` (`coffee_auto_backups_v1`)**: автоматически создаёт ежедневные снимки состояния и страховочные копии перед импортом/миграцией.
3. **Серверный уровень (`Code.gs` + Google Sheets + Google Drive)**:
   - Проверка авторизации (`auth_login`, `staff_login`, проверка `sessionToken` и ролей).
   - Идемпотентный журнал операций (`API_OPERATIONS`) по `operationId`.
   - Хранение данных на 16 специализированных листах Google Таблицы и медиафайлов в папке Google Drive `Coffee_ERP_Photos`.
