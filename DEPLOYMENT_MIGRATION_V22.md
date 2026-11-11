# Deployment and migration checklist — v22 foundation

## Before deployment

1. Make a copy of the production Google Spreadsheet and test against the copy first.
2. Export a backup of all existing tabs, especially `Настройки`, `Задачи`, `Касса`, `Расходы`, `Инциденты`, `Сотрудники`, and `ДельтаСинхр`.
3. Keep the current Apps Script deployment URL and deployment version available for rollback.
4. Review `Code.gs` changes and confirm the Apps Script project has the required spreadsheet and URL Fetch permissions.

## Deploy

1. Replace the Apps Script project source with the updated `Code.gs`.
2. Save and create a new Web App deployment version. Do not change the access policy without confirming who must use the barista terminal.
3. Publish the updated static frontend files together (do not mix v21 HTML with v22 `sync.js`).
4. Open the application in a private browser window and confirm the app points to the intended `/exec` URL in `config.js`.
5. Perform a successful admin login, a barista checklist submission, a cash submission, and an admin-only settings change.
6. Confirm each operation appears once in the appropriate business sheet and once in `API_OPERATIONS`.
7. Repeat a request with the same `operationId` in a test harness and confirm the business action is not repeated.
8. Disconnect the test device from the network, submit a test operation, reconnect, and confirm the outbox clears only after server confirmation.
9. Test two devices submitting separate shifts on the same business date.
10. Verify Telegram notifications are not duplicated and confirm the photo upload placeholder is reported as unsupported.

## Rollback

If a critical workflow fails, restore the previous frontend package and previous Apps Script deployment version. Do not delete `API_OPERATIONS` or any business sheet during rollback; the journal is additive and can remain in the spreadsheet.

## Do not use in production until

- Default PINs have been replaced with unique credentials.
- Staff identity and role enforcement have been reviewed.
- The real spreadsheet and deployment have passed the tests above.
- Backups and rollback have been verified.
