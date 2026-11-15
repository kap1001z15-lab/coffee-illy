# DATA MODEL — Единая модель данных Coffee Illy (Этап 2)
Актуальная версия: v71

Каждый бизнес-объект системы имеет постоянный строковый идентификатор `id` (никогда не используется номер строки Google Sheets в качестве постоянного ID), метки времени `createdAt` / `updatedAt`, автора `actor` / `author`, `status`, версию записи и явные связи с другими объектами.

## 1. Схема 16 базовых объектов
1. **Кофейня (`Shop`)**: `{ id: 'shop_1', name: 'Кофейня №1', plan: 2500, currency: 'руб.', timezone: 'Europe/Chisinau', active: true, updatedAt }`
2. **Сотрудник (`Staff`)**: `{ id: 'st_sonya', name: 'Соня', role: 'Бариста', pinHash: 'sha256...', tgId: '', shop: 'Кофейня №1', active: 'да', createdAt, updatedAt }`
3. **Смена (`Shift`)**: `{ id: 'sh_2026-11-15_sonya', date: '2026-11-15', staffId: 'st_sonya', staffName: 'Соня', shopId: 'shop_1', status: 'active' | 'closed', startedAt, closedAt }`
4. **Чек-лист (`ChecklistBlock`)**: `{ id: 'blk_open', name: 'Открытие', openTime: '07:30', deadline: '08:30', isCash: false, order: 1, updatedAt }`
5. **Задача (`Task`)**: `{ id: 'OP-01', block: 'Открытие', groupName: 'Бар', title: 'Проверить чистоту кофемашины', instruction: '...', criteria: '...', photoMode: 'да' | 'нет' | 'при проблеме', responsible: 'Администратор', active: 'да', updatedAt }`
6. **Выполнение чек-листа (`ChecklistSubmission`)**: `{ sid: 'chk_...', operationId: 'op_...', date: '2026-11-15', time: '08:12', block: 'Открытие', who: 'Соня', startedAt: '07:55', deadline: '08:30', isLate: false, status: 'Выполнено', problems: 0, photos: [...], items: [...] }`
7. **Кассовая операция (`CashDay`)**: `{ id: 'cash_2026-11-15', date: '2026-11-15', barista: 'Алина, Соня', cash: 1450, card: 909, zTotal: 2359, checks: 74, writeoff: 12, writeoffShots: 1, counterStart: 648, counterEnd: 735, coffeeQty: 52, nonCoffeeQty: 41, reviewQty: 5, unaccountedShots: 34, status: 'confirmed' | 'needs_review', updatedAt }`
8. **Продажа (`SaleItem`)**: `{ id: 'sale_...', date: '2026-11-15', name: 'Капучино ILLY', kind: 'coffee' | 'non_coffee' | 'review', qty: 28, price: 45, sum: 1260, ttkId: 'ttk_cappuccino', fileHash: 'sha256...' }`
9. **Техкарта (`TTK`)**: `{ id: 'ttk_cappuccino', name: 'Капучино ILLY', volume: '250 мл (M)', category: 'Классика', price: 45, costBeans: 6.5, costMilk: 4.5, costSyrup: 0, costCup: 2.3, recipe: '...', serving: '...', version: 2, updatedAt }`
10. **Списание (`WriteOff`)**: `{ id: 'wo_...', date: '2026-11-15', itemId: 'inv_milk', itemName: 'Молоко 3.2%', qty: 500, unit: 'мл', costRub: 12, reason: 'Проработка / пролив', actor: 'Соня', createdAt }`
11. **Складская операция (`InventoryItem` & `InventoryMovement`)**:
    - Остаток: `{ id: 'inv_beans', name: 'Кофе в зёрнах ILLY', category: 'Кофе', unit: 'г', stock: 4200, minStock: 1000, supplier: 'ООО Кофе-Трейд', updatedAt }`
    - Движение: `{ id: 'mov_...', time: '15.11.2026 09:00', item: 'Кофе в зёрнах ILLY', type: 'Приход' | 'Ревизия' | 'Списание' | 'Автосписание по ТТК', delta: '+1000 г', prevStock: 3200, newStock: 4200, supplier: '...', reason: '...', actor: 'Администратор' }`
12. **Расход (`Expense`)**: `{ id: 'EXP-101', date: '2026-11-15', category: 'Закупка продуктов', amount: 420, supplier: 'Молочная ферма', docNum: 'ТН-402', comment: '...', actor: 'Администратор', updatedAt }`
13. **Инцидент (`Incident`)**: `{ id: 'INC-20261115-01', date: '2026-11-15', time: '09:15', block: 'Открытие', step: 'Кофемашина', incType: 'Поломка оборудования', text: '...', priority: 'Критично' | 'Терпит', status: 'Новая проблема' | 'Принята в работу' | 'Ожидает решения' | 'Решена' | 'Закрыта', who: 'Соня', owner: 'Техник', reviewer: 'Управляющий', photo: 'idb://...', history: [...] }`
14. **Медиафайл (`MediaAsset`)**: `{ id: 'med_...', localRef: 'idb://photo/...', driveFileId: '1AbC...', driveUrl: 'https://drive.google.com/...', mimeType: 'image/jpeg' | 'video/webm', relatedType: 'checklist' | 'cash' | 'incident', relatedId: '...', actor: 'Соня', createdAt }`
15. **Уведомление (`LiveNotification`)**: `{ id: 'ntf_...', priority: 'P0' | 'P1' | 'P2', level: 'critical' | 'warn' | 'ok', type: 'incident' | 'overdue' | 'cash' | 'stock' | 'checklist', dedupKey: 'inc:INC-01', title: '...', text: '...', date: '2026-11-15', time: '09:15', actor: 'Соня', read: false, resolved: false }`
16. **Запись аудита (`AuditEntry`)**: `{ id: 'aud_...', date: '2026-11-15', time: '09:20', actor: 'Администратор', role: 'admin', action: 'admin_cash', targetId: 'cash_2026-11-15', details: '...', operationId: 'op_...' }`
