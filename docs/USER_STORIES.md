# Solana — User Stories (130)
> Format: Given / When / Then  
> 12 feature groups · Manual testing checklist  
> Generated: 2026-05-1


Solana — User Stories (130)



Format: Given / When / Then
12 feature groups · Manual testing checklist
Generated: 2026-05-19



Group 1 · Authentication & Session (12)





US-001 Given I am on the login screen, When I enter valid credentials and tap Login, Then I am taken to the dashboard and my name appears in the header.



US-002 Given I am on the login screen, When I enter an incorrect password, Then an error message is shown and I remain on the login screen.



US-003 Given I am logged in, When my session token expires and I make an API call, Then the token is silently refreshed and the action completes without logging me out.



US-004 Given I am logged in, When I tap Sign Out, Then I am returned to the login screen and my session token is cleared.



US-005 Given I close the browser tab and reopen the app, When my session is still valid, Then I am taken directly to the dashboard without re-logging in.



US-006 Given I have forgotten my password, When I tap "Forgot password" and enter my email, Then I receive a reset email and a confirmation message is shown.



US-007 Given I am a new user, When an admin creates my account and I first log in, Then I am prompted to set a new password.



US-008 Given I am on the login screen, When I leave both fields empty and tap Login, Then validation errors appear on both fields.



US-009 Given my account is pending approval, When I try to log in, Then I see a message that my account is awaiting admin approval.



US-010 Given I am idle for the session timeout period, When I attempt any action, Then I am redirected to the login screen with a session-expired message.



US-011 Given I am logged in on two devices, When I sign out on one, Then the other device session remains valid until its own expiry.



US-012 Given I am a superadmin, When I log in, Then I see the superadmin settings sections that regular users do not see.



Group 2 · Expense Management — CRUD (13)





US-013 Given I am logged in, When I tap "Nuevo gasto" and fill all required fields, Then the expense is saved and appears in my expense list.



US-014 Given I am creating an expense, When I leave the amount field empty and tap Save, Then a validation error is shown and the form is not submitted.



US-015 Given I am creating an expense, When I leave the description empty and tap Save, Then a validation error is shown.



US-016 Given I am creating an expense, When I do not select a category, Then a validation error is shown.



US-017 Given I am creating an expense, When I do not select a department, Then a validation error is shown.



US-018 Given I have a saved expense, When I tap Edit and change the amount, Then the updated amount is persisted after refresh.



US-019 Given I have a saved expense, When I tap Delete and confirm, Then the expense is removed from my list.



US-020 Given I am a regular user, When I try to delete another user's expense, Then I receive a 403 error and the expense is not deleted.



US-021 Given I have many expenses, When I filter by status "Pendiente", Then only pending expenses are shown.



US-022 Given I have expenses of different types, When I filter by "Gastos" only, Then invoice-type items are hidden.



US-023 Given I have expenses of different types, When I filter by "Facturas" only, Then regular expense items are hidden.



US-024 Given I am creating an expense, When I select a non-EUR currency from the allowed list, Then the currency is saved on the expense.



US-025 Given I have an approved expense, When I try to edit it as a regular user, Then the edit is blocked or triggers a re-approval flow.



Group 3 · Invoice Management (11)





US-026 Given I am creating a new entry, When I tick the "Es factura de proveedor" checkbox, Then the form reveals vendor, proveedor, and payment term fields.



US-027 Given I am creating an invoice, When I leave the vendor field empty and tap Save, Then a validation error is shown.



US-028 Given I am creating an invoice, When I select a payment term of 30 days, Then the due date is automatically calculated as date + 30 days.



US-029 Given I am creating an invoice, When I select "Personalizado" as payment term, Then a date picker appears for manual due date entry.



US-030 Given I have a saved invoice, When I mark it as paid, Then its payment status changes to "Pagado" and it moves out of the unpaid queue.



US-031 Given I have invoices with different due dates, When I view the invoice list, Then overdue invoices are visually distinguished.



US-032 Given I am creating a recurring invoice, When I select monthly cadence, Then the recurrenceRule is set to "monthly" on the saved record.



US-033 Given I am creating a recurring invoice, When I select "Personalizado" cadence and enter 2 months, Then recurrenceRule is set to "custom:2".



US-034 Given I have a recurring invoice, When the due date passes, Then the next occurrence is generated automatically.



US-035 Given I have an invoice in "unpaid" status, When I view the invoice detail, Then I can see the vendor name, due date, and payment terms.



US-036 Given I am a superadmin, When I configure payment term options as [0, 30, 60], Then the invoice form only shows those three options plus Personalizado.



Group 4 · Approval Workflow (12)





US-037 Given I submit an expense, When the amount is below the approval threshold, Then it is auto-approved without requiring manual review.



US-038 Given I submit an expense above the threshold, When it is saved, Then its status is "Pendiente" and approvers are notified.



US-039 Given I am an approver, When I open the Approvals tab, Then I see all expenses awaiting my vote.



US-040 Given I am an approver, When I tap Approve on a pending expense, Then the expense status updates to "Aprobado" and the submitter is notified.



US-041 Given I am an approver, When I tap Reject with a note, Then the expense status changes to "Rechazado" and the rejection note is visible to the submitter.



US-042 Given a category has two assigned approvers, When both approve, Then the expense status becomes "Aprobado".



US-043 Given a category has two assigned approvers, When one rejects, Then the expense status becomes "Rechazado" immediately.



US-044 Given I submitted an expense and it was rejected, When I edit and resubmit it, Then approval votes are reset and the workflow starts fresh.



US-045 Given I am the submitter of an expense, When I am also an approver for that category, Then my approval is counted automatically.



US-046 Given a category has no approvers assigned, When an expense is submitted in that category, Then the default approvers (configured by superadmin) receive the request.



US-047 Given I am a regular user, When I try to access the Approvals tab, Then it is either hidden or shows only expenses I submitted.



US-048 Given I am a superadmin, When I configure default approvers in settings, Then expenses with no category-specific approvers route to those users.



Group 5 · Receipt Handling (10)





US-049 Given I am creating an expense, When I tap "Escanear cámara" and capture a photo, Then the receipt image is attached to the form.



US-050 Given I am creating an expense, When I tap "Subir archivo" and select a PDF, Then the PDF is attached and a PDF badge is shown instead of an image preview.



US-051 Given I am creating an expense, When I attach a receipt via camera scan, Then the AI attempts to prefill amount, date, and category from the image.



US-052 Given I have an expense with an attached receipt, When I view the expense detail, Then I can see or download the receipt.



US-053 Given I have an expense with a PDF receipt, When I view it on desktop, Then a PDF viewer or download link is shown.



US-054 Given I try to upload a file larger than the max allowed size, When I select the file, Then an error is shown and the file is not attached.



US-055 Given I have attached a receipt, When I tap Remove, Then the attachment is cleared from the form.



US-056 Given I have an expense with a receipt saved on the server, When I view the expense list, Then a receipt thumbnail is shown in the row.



US-057 Given my expense amount exceeds the "require receipt above" threshold, When I try to submit without a receipt, Then a validation warning is shown.



US-058 Given I attach a HEIC image (iPhone format), When it is uploaded, Then it is recognised as an image type and previewed correctly.



Group 6 · Split Allocation (8)





US-059 Given I am creating an expense, When I enable split allocation, Then I see a list of team members with amount inputs.



US-060 Given I have split allocation enabled, When I tap "Igual", Then the total amount is divided equally among selected members.



US-061 Given I have split allocation in "amount" mode, When the sum of splits does not equal the total, Then a validation error is shown on submit.



US-062 Given I have split allocation in "percentage" mode, When the percentages do not sum to 100%, Then a validation error is shown on submit.



US-063 Given I have a split expense, When it is approved, Then each person's share appears in their individual report totals.



US-064 Given I have a split expense, When I view the detail, Then each team member's name and share amount are shown.



US-065 Given I am creating a split expense with a non-EUR currency, When the splits are saved, Then the currency symbol next to each split input matches the selected currency.



US-066 Given I disable split allocation after enabling it, When I save the expense, Then it is saved as a non-split expense assigned to the owner only.



Group 7 · Departments & Budgets (10)





US-067 Given I am a superadmin, When I add a new department with a budget, Then it appears in the department list and in the expense form dropdown.



US-068 Given I am a superadmin, When I edit a department's budget, Then the updated budget is reflected in the budget tracker.



US-069 Given I am a superadmin, When I archive a department, Then it no longer appears in the expense form dropdown but existing expenses retain their department.



US-070 Given a department has expenses linked to it, When I try to delete it, Then deletion is blocked with a message to reassign expenses first.



US-071 Given I am viewing the dashboard, When a department has spent more than its annual budget, Then an "over budget" badge is shown.



US-072 Given I am viewing the budget tracker, When I look at a department, Then I can see annual budget, amount spent, and amount remaining.



US-073 Given I am creating an expense, When I select a department, Then the expense is attributed to that department's spend.



US-074 Given I am a regular user, When I try to access department management settings, Then the section is not visible.



US-075 Given approved expenses exist for a department, When I view its tracker, Then only approved expenses (not pending) count toward the spend total.



US-076 Given I am a superadmin, When I have no departments defined yet, Then the expense form shows an appropriate fallback or prompts me to create one.



Group 8 · Reports & Export (10)





US-077 Given I am an admin, When I open the Reports tab, Then I see total spend, spend by category, and spend per person.



US-078 Given I am viewing reports, When I change the date range filter, Then all report figures update to reflect only that period.



US-079 Given I am viewing reports, When I click on a category bar, Then the expense list is filtered to that category.



US-080 Given I am an admin, When I tap "Exportar CSV", Then a CSV file downloads containing all expenses for the selected period.



US-081 Given I export a CSV, When I open it, Then it contains columns for date, description, amount, category, department, submitter, and status.



US-082 Given I am viewing reports, When I filter by "Aprobados" only, Then pending and rejected expenses are excluded from totals.



US-083 Given I am viewing the 12-month trend chart, When I look at the current month, Then the bar reflects actual approved spend to date.



US-084 Given I am a regular user, When I open Reports, Then I only see my own expenses, not the full team view.



US-085 Given I am an admin, When I view the per-person breakdown, Then I can expand each person to see their individual expense log.



US-086 Given there are no expenses in the selected date range, When I view reports, Then an empty-state message is shown instead of broken charts.



Group 9 · Superadmin Settings (12)





US-087 Given I am a superadmin, When I add a new expense category, Then it immediately appears in the expense form category dropdown.



US-088 Given I am a superadmin, When I archive a category, Then it disappears from the expense form but existing expenses retain their category label.



US-089 Given I am a superadmin, When I assign approvers to a category, Then new expenses in that category are routed to those approvers.



US-090 Given I am a superadmin, When I change the IVA rate values, Then the new rates appear in the expense form IVA selector.



US-091 Given I am a superadmin, When I change the default IVA rate, Then new expense forms open with that rate pre-selected.



US-092 Given I am a superadmin, When I update the approval threshold, Then expenses below the new threshold are auto-approved.



US-093 Given I am a superadmin, When I configure default approvers, Then expenses with no category-specific approvers use those users.



US-094 Given I am a superadmin, When I add "90" to the payment terms options list, Then "90 días" appears as a selectable option in invoice forms.



US-095 Given I am a superadmin, When I remove "15" from the payment terms options list, Then "15 días" no longer appears in invoice forms.



US-096 Given I am a superadmin, When I add "USD" to allowed currencies, Then the currency selector in expense forms includes USD.



US-097 Given I am a superadmin, When I try to remove the last remaining currency, Then the action is blocked with an error message.



US-098 Given I am a superadmin, When I update the company name, Then the new name appears in report headers and email footers.



Group 10 · User Management (10)





US-099 Given a new user has signed up, When I am an admin and open Settings, Then I see the user in the "Pendientes de aprobación" list.



US-100 Given a user is pending approval, When I tap Approve, Then the user can log in and access the app.



US-101 Given a user is pending approval, When I tap Deny, Then the user cannot log in and receives a rejection notification.



US-102 Given I am an admin, When I view the team member list, Then I see each user's name, email, role, and account status.



US-103 Given I am a superadmin, When I change a user's role to "admin", Then that user gains approval and reporting permissions.



US-104 Given I am logged in, When I open "Tu perfil" and update my display name, Then the new name appears in the header and expense history.



US-105 Given I am logged in, When I change my password with a valid current password, Then the change is saved and I can log in with the new password.



US-106 Given I am logged in, When I try to change my password with an incorrect current password, Then an error is shown and the password is not changed.



US-107 Given I am a superadmin, When I view the app log (audit trail), Then I can see a history of key actions with timestamps and user IDs.



US-108 Given I am a regular user, When I try to access user management settings, Then the section is not visible to me.



Group 11 · Offline & PWA (10)





US-109 Given I lose network connectivity, When I create a new expense, Then a "guardado localmente" toast is shown and the expense appears in my list immediately.



US-110 Given I have a queued offline expense, When my connection is restored, Then the expense is automatically synced and a "sincronizado" toast is shown.



US-111 Given I have a queued offline edit, When my connection is restored, Then the edited expense is updated on the server.



US-112 Given I am offline, When I try to approve an expense, Then the action is queued and applied when connectivity returns.



US-113 Given the app is installed as a PWA, When I open it from the home screen, Then it launches in standalone mode without a browser URL bar.



US-114 Given the app is installed as a PWA, When I view the app icon on the home screen, Then the correct Solana icon is shown (not a blank placeholder).



US-115 Given I am offline and open the app, When the app shell loads from cache, Then the login screen or last view is shown without a blank white page.



US-116 Given I have multiple queued offline operations, When I reconnect, Then they are flushed in order without duplicates.



US-117 Given I create an expense offline that gets a temporary client ID, When it syncs, Then the expense ID updates to the server ID and detail navigation still works.



US-118 Given the service worker is registered, When the app shell assets are updated, Then the new version is activated on next load without requiring a manual cache clear.



Group 12 · Security & Access Control (12)





US-119 Given I am a regular user, When I try to call PUT /expenses/:id for another user's expense via the API, Then I receive a 403 or 404 response.



US-120 Given I am a regular user, When I try to call DELETE /expenses/:id for another user's expense via the API, Then I receive a 403 or 404 response.



US-121 Given the login endpoint is called more than the rate limit threshold, When the limit is exceeded, Then the server responds with 429 and an error message.



US-122 Given the signup endpoint is called more than the rate limit threshold, When the limit is exceeded, Then the server responds with 429.



US-123 Given the forgot-password endpoint is called repeatedly, When the limit is exceeded, Then the server responds with 429.



US-124 Given I inspect the server response headers, When the app is deployed, Then I see X-Content-Type-Options, X-Frame-Options, and Referrer-Policy headers.



US-125 Given ALLOW_SEED is not set to true in production, When I call POST /admin/seed/bootstrap, Then I receive a 403 response.



US-126 Given I call GET /admin/backups without the X-Admin-Key header, When the request is made, Then I receive a 401 or 403 response.



US-127 Given I am an admin, When I trigger a database backup, Then a backup file is created and listed in the backup UI.



US-128 Given I am a superadmin, When I download a backup via the UI, Then a valid SQLite file is downloaded.



US-129 Given I call POST /ai/scan-receipt without a Bearer token, When the request is made, Then I receive a 401 response.



US-130 Given I am logged in as a regular user, When I try to access GET /settings/schema (superadmin only), Then I receive a 403 response.



Summary







Group



Stories



Range





1 · Authentication & Session



12



US-001–012





2 · Expense Management CRUD



13



US-013–025





3 · Invoice Management



11



US-026–036





4 · Approval Workflow



12



US-037–048





5 · Receipt Handling



10



US-049–058





6 · Split Allocation



8



US-059–066





7 · Departments & Budgets



10



US-067–076





8 · Reports & Export



10



US-077–086





9 · Superadmin Settings



12



US-087–098





10 · User Management



10



US-099–108





11 · Offline & PWA



10



US-109–118





12 · Security & Access Control



12



US-119–130





Total



130
