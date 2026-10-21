# DECISIONS â€” school/backend

Log non-obvious choices here instead of silently diverging. Frontend UI decisions live in `academic/DECISIONS.md`.

## 2026-10-04 â€” AUTH_NO_SESSION bypass removed (dev backdoor closed)

- **What:** `AUTH_NO_SESSION=true` in `backend/.env` short-circuited `JwtAuthGuard` (no token verification, `request.user` unset) while `TenantGuard` fabricated a full-privilege tenant. Every identity-derived lookup degraded: `resolveTeacher` ran `findFirst({tenantId, userId: undefined})`, Prisma dropped the `undefined` key, and all `/teachers/me/*` routes served the first teacher row (26CPM007) to any caller â€” including unauthenticated ones. Proven live: no-token â†’ 200 + full profile; forged-sub â†’ 200 + full profile.
- **Fix:** flag set to `false` (one-line config, no code changes â€” guards and queries were already correct and spec-covered). Post-restart gate: no-token â†’ 401, forged-sub â†’ 403 with zero data, each teacher login â†’ own profile.
- **Open follow-up:** the academic app (`:5000`) has no login and rode this bypass â€” expect 401s there until it gets one. `ACADEMIC_NO_AUTH` / `TEACHER_NO_AUTH` frontend flags and any other `AUTH_NO_SESSION`-style bypass must never reach production; verify before every deploy.

## 2026-09-28 â€” Section removal deployed (20260928140000_remove_sections)

- **No Neon snapshot was confirmable from here**, so a restorable JSON backup of every affected table (sections, section_subjects, enrollments, sessions, records, exam_subjects, classes) was taken first to `section-backup/`. Tiny dataset: 2 sections, 2 assignments, 3 enrollments, 0 attendance/exam rows.
- Deploy applied cleanly with zero guard aborts. After-counts: `class_subjects` = 2 (both teachers kept), enrollments = 3 re-keyed, 1 class supervisor moved, `sections`/`section_subjects` tables gone.
- Verified the exact P2022 path (`studentEnrollment` include of `schoolClass`) live before closing.

## 2026-09-28 â€” Teacher list selects full document rows

- **List/detail select parity for documents.** The teachers list selected only `documentType` + `objectKey`, but the edit form round-trips list rows straight into the update payload, whose DTO requires `originalName`, `contentType`, and `size` â€” so every teacher update with stored documents failed validation. The list now selects the full row (same shape as `teacherSelect`). Rule: any list whose rows feed an update payload must select every field that payload's DTO requires; a regression spec pins the shape.

## 2026-09-25 â€” Examination Center foundation
- **Live-only, no seeds:** exam-center ships against real APIs with empty-states. No `SEED_*` for exams (project-wide no-mocks direction; confirmed 2026-09-25).
- **Staff-only actor:** Academic Affairs is the sole actor. No teacher login, no supervisor identity system in this scope.
- **Supervisor review as plain data:** `ExamSubject.reviewedByName/reviewNote/reviewedAt`, `ExamResult.moderatedByName/moderationNote` are scalar strings, not user FKs. Upgrades to real references when supervisor identity arrives, without remodeling.
- **Enum extension, not remap:** `ExamStatus` += MARKS_OPEN/MODERATION/PROCESSED/CLOSED, `ResultStatus` += SUBMITTED/MODERATED/LOCKED. Existing DRAFT/PUBLISHED rows keep meaning.
- **New `ExamTimetableSlot` model** instead of reusing `ExamSubject.examDate` or class-timetable `TimetableEntry`: slots need hall + time window + seat linkage. School-schedule vs exam-schedule stay separate domains.
- **One recheck per mark:** `@@unique([examResultId, tenantId])` on recheck_requests; re-file after reject = update the existing request.
- **Subject moderation completeness is derived** (all subject results MODERATED) â€” no extra status column to desync; `reviewedBy*` records who/when it was raised.
- **`Exam.examTypeId` nullable + app-enforced:** protects pre-existing exam rows without a type; new creates validate the type (404 otherwise). Delete of a type in use â†’ 409 (Restrict).
- **Migration hand-authored** (`20260925133914_examination_center`): `migrate dev` refuses non-interactive shells, so SQL follows repo conventions and was reviewed pre-deploy. Purely additive (no DROP/ALTER COLUMN/data rewrite).
- **Read paths use `withTenantRead`** (no interactive tx) for all new list/findOne methods, per the P2028 pool-starvation fix. Writes keep `withTenant`.
- **Publish sets `publishedAt`** alongside status PUBLISHED; downstream gating (report cards, analytics, rechecks) keys off it.
- **Hall delete-guard** counts slots + seats + duties; department-style teacher-count guard pattern reused.

## 2026-09-25 - Exam Setup slice
- **Subject add/remove are standalone endpoints** (POST/DELETE /exams/:id/subjects[/:subjectId]), not only inline wizard creates ï¿½ the detail page manages subjects post-creation. Duplicate section-subject per exam -> 409 (P2002 backstop over @@unique([examId, sectionSubjectId])).
- **Subject removal blocked when marks exist** (409, delete marks first) ï¿½ cascade would silently destroy entered results.
- **Wizard requires type + term** (sitemap chain); dates and subjects optional in-wizard, completable later on the detail page.
- **Scale edit covers name/isDefault only; bands are create-time immutable** via current API (updateScale ignores bands). Changing that needs a bands-replace endpoint ï¿½ deferred, not assumed.
- **Pre-existing cascade noted, not changed:** deleting a grading scale cascades to linked exam subjects (onDelete: Cascade in schema). UI delete dialog warns; altering the FK rule is out of scope for this slice.

## 2026-09-25 ï¿½ Exam sample upload (slice 2)
- **Single nullable sampleObjectKey on exams** (no metadata columns): name/size are upload-time display data; the key + storage stat call provide the rest. Keeps the migration to one ADD COLUMN.
- **EXAM_SAMPLE added to the shared upload allowlist** (not a separate endpoint): staging, size limits, and key builders all reuse the storage module. Controller enforces PDF-only for this type; images remain allowed for profile/ID documents.
- **Move-before-tx + compensate** (teachers pattern): staged file moves to exams/{tenant}/{examId}/ before the tx opens; tx failure deletes the moved file; replace deletes the old file post-commit; remove clears the key and deletes post-commit.
- **Download reuses GET /storage/download** ï¿½ no new endpoint; frontend streams via the existing helper.

## 2026-09-25 ï¿½ Scheduling endpoints: include-name blind spot (bug caught by smoke)
- **Bug:** listSlots used include key duties but the schema relation is invigilationDuties -> PrismaClientValidationError at runtime. **tsc did not catch it** because withTenant callbacks type 	x as ny, which swallows include-name checking. Lesson: for complex includes, live smoke (or a type-level Prisma.ExamTimetableSlotInclude assertion) is the real guard ï¿½ unit mocks cannot catch this class.
- **Seat numbering by submission order** (1-based) doubles as the per-hall seat uniqueness mechanism and feeds the printable room card directly.

## 2026-09-25 ï¿½ Scheduling endpoints + rooms UI (slice 3)
- **No new ExamRoom table:** rooms render from timetable slots + halls + seats + duties grouped per exam. A separate room table would duplicate halls and desync per-slot seating.
- **Seat numbers assigned by submission order** (1-based) ï¿½ satisfies the per-hall seat unique constraint and feeds the print card.
- **Double-booking is a warning, never a block** (overlap flags in UI, backend permits) ï¿½ legitimate exceptions exist.
- **Capacity overflow warns, does not block.** No backend enforcement.
- **Controllers split one-per-file** (slots/duties) to match house convention; exam-scoped slot routes live on ExamsController (same prefix, same domain).
- **Student multi-select built from primitives** (checkbox list in Dialog) ï¿½ no Command/combobox primitive exists and no new dep was approved.
- **Inline hall quick-create in Add Room dialog** (no separate halls UI exists yet); full hall management arrives with the Scheduling section.

## 2026-09-25 ï¿½ Room print card (slice 4)
- **One card per (exam, hall), sections per slot:** a hall can host several sessions; the card groups the exam's slots filtered by hall instead of assuming one session per room.
- **window.print() + print: CSS, no PDF library:** shell chrome hidden via print:hidden (reusable by future printable pages); browser Save-as-PDF covers download. Dedicated pdfkit endpoint deferred.
- **No school name/logo on the card:** no tenant-branding source exists in the API; header carries exam + subject + hall + date/time + invigilator instead. Branding arrives with Settings/templates.
- **Seat list embedded in listSlots** (ordered by seatNumber) so the print page renders in one round trip.

## 2026-09-26 ï¿½ Students redesign backend (table + details support)
- **Fire/Postpone reasons go to Student.metadata.statusChange + statusHistory** (not AuditLog): zero existing AuditLog writers in src, so standing up that path mid-slice adds untested machinery; metadata is queryable, displayed, and recorded. Promote to AuditLog rows in a later slice if needed.
- **Guardian row deleted only when its last link is removed** (shared guardians survive); primary flag is exclusive per student (reset siblings).
- **Detail reads co-located on students.service** (listStudentResults, listStudentAttendanceRecords): codebase avoids service-to-service injection, so student-detail aggregation lives here rather than calling exams/attendance services.
- **Kind/status visibility is presentation policy:** API returns full result history for staff tooling; the Performances tab applies Major-PUBLISHED-only / Casual-SUBMITTED+ / never-DRAFT.

## 2026-09-26 ï¿½ Auto-designed teacher employee IDs (Task #2)
- **Format YY + <=3 dept initials + 3-digit seq** (e.g. 26AL001): initials of up to first 3 words (letter-led only), GEN fallback without department, no hard cap (padding accommodates growth past 100).
- **Sequence = max-suffix+1 per YY+letters within tenant** (derived from data, no counter row). Existing free-text numbers untouched; explicit numbers still allowed and keep exact-check behavior.
- **Single attempt, no silent retry:** a same-dept same-moment collision surfaces as 409 via the existing unique constraint + P2002 mapping. Retrying would require rolling back the already-created user/membership rows ï¿½ cost exceeds the microscopic race risk. Stated downgrade from the initially promised bounded retry.
- **Shared pure generator** (	eachers/employee-number.ts, no service imports) consumed by both 	eachers.create and provisionTeacher; no service-to-service coupling. Frontend untouched (no employee input exists ï¿½ display + search only).

## 2026-10-01 ï¿½ Examination Center redesign Phase 1 (schema + migration deployed)
- **Evolve in place, no parallel tables:** approved after 8 confirmations (seat-level kept, publish gate kept, authorId?User with role derived from membership, examGroupId plain nullable key, partial lock on first room assignment, recharts deferred).
- **New room-centric aggregate:** ExamRoomAssignment(exam,hall) + ExamRoomInvigilator(teacher) + ExamRoomStudent(student,seatOrder) + Exam.authorId/examGroupId + ExamResult.submittedBy + SeatAssignment.seatOrder. Migration 20260928150000_exam_center_redesign, purely additive, deployed to Neon production (soft-king-48752322, neondb); pre-counts exams/subjects/results all 0, verified post: 4 tables + 3 columns present.
- **Production was missing the legacy scheduling tables** (halls, slots, seats, duties, audits, rechecks, types, scales ï¿½ only exams/exam_subjects/exam_results exist): migration creates minimal halls (IF NOT EXISTS + hall_type enum guard) as the Rooms-wizard prerequisite; seat_order guarded by information_schema check. Legacy-table backfill deferred; Phase 2 endpoints must not touch missing tables.
- **Gap: prisma/validate-prisma.mjs is referenced by the migration workflow but does not exist in the repo** ï¿½ validation done manually (generate + Neon pre/post counts). Migration bookkeeping note: _prisma_migrations on production records only 0001_init; post-init migrations applied via direct SQL per standing convention.

## 2026-10-01 ï¿½ Examination Center redesign Phase 2 (backend rooms + authorship)
- **Author RBAC:** create/update/marks/rooms open to ADMIN + ACADEMIC_ADMIN + TEACHER via RolesGuard; service-level authorship lets a TEACHER touch only exams they authored (legacy authorless exams are staff-only). TEACHER can never change status (publish gate stays ADMIN-only on POST /exams/:id/publish). Missing actor = legacy internal call, no authorship check.
- **Group fan-out:** POST /exams with classIds creates one Exam row per class sharing an examGroupId (single class or none -> standalone, examGroupId null); each row keeps only its class's subjects and a subject outside the requested classes is 400. authorId stamped from the JWT user.
- **Partial lock:** first room assignment freezes subject add/remove (409, lifted when the last room is removed); scalar edits (name/dates) stay allowed. submittedBy stamped on result create only (updates keep the original submitter).
- **Room-centric endpoints on ExamsController** (house convention): POST/GET /exams/:id/rooms, PUT .../invigilators (replace set), PUT .../students/order (all ids must already be seated, else 404), DELETE room, GET /exams/:id/analytics (per-subject avg/high/low/pass-rate + overall). Auto-fill seats from ACTIVE enrollments of the exam's classes sorted by last/first name, seatOrder 1..N.
- **Browse payload:** findAll/findOne now include author (id/first/last) + room counts; findOne embeds room assignments with hall + student/invigilator counts.
- **Hash workflow note:** prisma:generate (script) also syncs prisma/schema.hash ï¿½ running bare prisma generate leaves the freshness spec red; always use the npm script or follow with scripts/sync-prisma-schema-hash.mjs.
- **Verification:** 166/166 jest (11 new), tsc clean, nest build clean.

## 2026-10-01 ï¿½ Exam-center parity backfill (migration 20261001090000)
- **Production was missing 3 migrations' exam effects** (only 0001_init is bookkept; the rest went via direct SQL and 3 were skipped): all 7 scheduling tables, 2 enums, 9 enum values, and 11 columns incl. exams.exam_type_id/sample_object_key/published_at, exam_subjects.weight+review columns, exam_results.kind/moderation columns. The Types tab, weights, samples, and marks entry were broken in prod because of this.
- **Also added student_status POSTPONED/FIRED** (same unapplied migration file; shipped fire/postpone flows need them). Deliberately did NOT audit other modules' parity ï¿½ separate task.
- **.env points at the students-api-test branch, not production:** prisma db execute landed the backfill there first (harmless + useful dry run: proved ADD VALUE inside guarded DO blocks works on PG18). Production applied via 32 MCP statements in 5 ordered batches (enums ? tables ? columns ? indexes ? FKs); file restructured into 1+7+3+20+1 statements to match 1:1. Verified post: 7 tables, 11 columns, 14 enum values, sampled FKs, row counts unchanged (0/0/0/1).
- **Verification:** prisma validate clean, 166/166 jest, tsc + nest build clean. schema.prisma untouched (tables were already modeled) so schema.hash unchanged.

## 2026-10-01 ï¿½ P2021 exam_room_assignments on dev server (branch drift, not a code bug)
- **Root cause:** the dev backend runs on backend/.env, which points at the students-api-test branch (ep-square-frog), not production (ep-dawn-smoke). Phase-1 redesign went to production only; the test branch lacked the 3 room tables + author/group/submitter columns, so findAll's room-count include threw P2021. Fixed by syncing the test branch to the exact Phase-1 definitions (columns + 3 tables + 9 indexes + 11 FKs, seat_order via ADD COLUMN IF NOT EXISTS since the backfill had already created that table without it).
- **Proof:** the exact failing relation shape (exams LEFT JOIN users + subject/room counts) runs error-free on the test branch; exams jest suites 32/32 green. No code changed ï¿½ the running server heals on its next request.
- **Standing rule: .env targets the test branch ï¿½ every production migration must also be applied to br-soft-lab-b3nfqnyx** (or dev will break the same way on the next schema change). Verify target with the endpoint host before any direct-SQL apply.

## 2026-10-01 ï¿½ Branch parity checker (npm run db:parity) + surprise finding
- **New tool:** scripts/check-branch-parity.ts (tsx, zero new deps: PrismaNeon+PrismaClient) snapshots tables/columns/indexes/FKs/enums on production vs the test branch and exits 1 on drift. Pure diff lives in src/prisma/branch-parity.ts with 7 unit specs. PROD_DATABASE_URL stays out of .env by design (dev can never write to prod); usage: \='...' ; npm run db:parity. PrismaNeon cannot deserialize pg catalog name-typed columns ï¿½ every selected catalog field is cast to ::text.
- **First run found the drift is REVERSED from the assumption:** production (45 tables) is BEHIND the test branch (49 tables) by 89 items ï¿½ prod still has sections/section_subjects, school_classes.name/code, students.admission_number, and lacks class_subjects, departments, student/teacher documents, credentials, sport timetables, and 6 enums. I.e. all recent migrations went to the test branch; production only ever received the two exam migrations applied via MCP. My two exam migrations are present on both sides (no exam drift reported).
- **Nothing auto-synced:** forwarding production across ~10 migrations (incl. destructive section removal) needs explicit approval + a data check (prod holds 61 users / 6 tenants / 1 student).

## 2026-10-01 ï¿½ Production promoted via redesignation (not migration replay)
- **Child branches cannot be snapshotted** (Neon 400), so instead of copying data: renamed stale br-mute-surf-b3kmv02w to production-legacy-stale-20261001, renamed br-soft-lab-b3nfqnyx to production, and set it as the default branch. Zero bytes moved; fully reversible by flipping the default back. Safety snapshot pre-sync-backup-20261001 (snap-bold-glade-b34katt0) retained.
- **Verified:** new default serves the exact P2021 query shape error-free; npm run db:parity reports 49 tables / 28 enums on both sides with 0 drift. .env already points at this branch, so dev and default are now the same data.
- **Open:** stale legacy branch still exists (rollback net). Delete only on explicit approval. Going forward db:parity compares the deploy-target URL against .env ï¿½ both must be supplied per run.

## 2026-10-02 ï¿½ External teacher-portal slice audit (second agent, 04:25ï¿½07:01) + fixes
- **What they built:** teachers/me self-service API (profile/dashboard/classes/timetable/attendance/marks/exams/students/announcements; 1354-line service + 19 specs incl. two-teacher gates, 404-not-403, roster anti-spoof), auth self update-me + change-password (current-password verified), teacher-scope guards on admin attendance mark/create (actor pattern, admins keep permissive behavior), exam create class-scope + enter-marks assigned-teacher access, teacher-app shadcn install (base-nova tokens, teal brand, button only, port 5100, tenant resolved at login). No schema/migration changes; nothing logged by them ï¿½ logged here instead.
- **Deviations from confirmed spec:** (1) attendance edit window is 7 days, not the confirmed same-day-only ï¿½ needs your call; (2) teachers CAN compose class-scoped announcements (spec default was read-only) ï¿½ needs your call; (3) portal brand is teal, not admin-neutral ï¿½ kept, coherent and documented in-file.
- **Breakages found by verification and fixed:** teachers-me.service.spec did not compile (DeepMock typed models as jest.Mock; fixed with ModelMock record type) and teacher button imported cn from 'cn' (fixed to @/lib/utils). After fixes: backend tsc + 192/192 jest + nest build clean; teacher tsc + eslint + next build clean; teacher npm audit 0 vulns.
- **Review notes (Optional):** me-controller has no RolesGuard ï¿½ safe because resolveTeacher 403s non-teachers, but explicit @Roles would document intent; getExamDetail rosters loop N+1 over visible classes (small N, fine); listExams take:100 unpaginated (fine for v1); TeacherDashboardQueryDto unused (dead, remove when convenient).

## 2026-10-02 ï¿½ Attendance window clamped to same-day + compose kept (user calls)
- **Same-day wins:** ATTENDANCE_EDIT_WINDOW_DAYS 7 -> 1; canEditAttendance is now dateKey === todayKey; removed the orphaned shiftDateKey helper. Spec rewritten TDD-style (yesterday-must-fail first, then clamped). Error message stays dynamic ('the edit window is 1 days' reads awkwardly ï¿½ kept as-is for now; reword when touching that line next).
- **Teacher announcement compose kept:** class-scoped fan-out to students/guardians with accounts stays; confirmed spec amended (was read-only default).

## 2026-10-02 -- Seeded 16 school classes (records, not rules)
- **Script:** backend/scripts/seed-school-classes.mjs posts the 16 records through POST /classes (real validation path), skips existing names: created=16 on first run, created=0 skipped=16 on re-run (idempotency proof). Tenant 11111111-... now holds 20 classes (4 pre-existing + 16). Distinct names used throughout (name-unique constraint untouched, no migration).
- **Probe finding (not acted on):** INTERMEDIATE+GIRLS returned 201 ï¿½ backend still lacks gender x level validation (that was the killed rules task). Probe record deleted immediately after (DELETE 200). Track rules verified enforced (SECOND without track 400, FIRST+ART 400).

## 2026-10-02 -- Gender gate on classes (records task follow-up, TDD)
- **Rule:** INTERMEDIATE requires BOYS; SECONDARY requires BOYS/GIRLS (MIXED rejected everywhere); legacy NULL-gender rows grandfathered until a gender is set. Update path merges existing gender into the validated shape. Specs: 3 new (girls-intermediate 400, mixed 400, valid first-girls create).
- **Deploy note:** the dev backend serves compiled dist, so source edits need nest build + process restart to take effect (killed stale PID, relaunched; verified live: INT+GIRLS 400, SEC+MIXED 400, INT+BOYS 201; probes cleaned up). Suite 195/195, tsc + build clean.

## 2026-10-02 -- Seeded 13 subjects + fixed batch timeout bug (TDD)
- **Records:** all 13 subjects created with correct departments (Quran + Islamic Studies -> religion education; Military Sciences -> new Military Sciences dept created first). Lowercase dup rows (arabic language, mathematics) KEPT: both are assigned to classes (DELETE 409), per the delete-only-if-unused agreement.
- **Latent bug found by the seed:** POST /subjects/batch 500s at ~8+ rows (interactive-tx default 5s timeout over remote roundtrips; 6-7 rows pass, 8/10/12 fail). Fixed by single-roundtrip createMany + ordered re-read (same {created} shape); new subjects-batch.spec (order + dup-rejection). Suite 197/197, tsc + build clean, backend restarted to pick it up.
- **Anomaly (honest log):** mid-session the 12 rows appeared from an unattributed write while my probes ran ï¿½ freebuff agent process is active on this machine and is the likely concurrent writer. Final state verified by direct query (15 rows, correct depts) + seed re-run idempotency (created=0 skipped=13). Probe scripts removed.

## 2026-10-02 -- Seeded 63 teachers (5 per dept, 3M+2F) + P2028 fix on create
- **Roster:** 13 departments x 5 (Arabic/math topped from 1); deterministic Sudanese names, unique +249 phones, adult DOBs, dept specialization, auto employee numbers, uniform Comboni@123. Verified per-dept 5/3M/2F via DB; phone login 201 with TEACHER role; re-run idempotent (created=0).
- **P2028 on POST /teachers:** ~10 sequential statements exceeded the 5s interactive-tx default over remote latency. Fixed via optional {timeout} on withTenant (default unchanged) + {timeout:30000} on teachers.create; regression spec asserts the option. Same bug class as the batch fix.
- **My own counting errors, honestly logged:** (1) miscounted 12 vs 13 departments (Military Sciences made 13) - script tops up by headcount so the total self-corrected to 63; (2) fixed the phone padder the wrong way first (7 instead of 8 digits) - reverted after the API proved me wrong. Suite 198/198, tsc + build clean, backend restarted.

## 2026-10-03 -- Guardian numbers (26CPGNNNN) + enrollment field (backend+DB+frontend)
- **Guardian:** Guardian.guardianNumber (nullable unique per tenant) + yearly generator (fixed CPG, walk-from-1 gap reuse, 9999 cap with clear error) wired into admission + create-guardian paths with explicit-override support; P2002 backstop. Frontend: number column in guardians table, auto-assign hint in admissions; display selects extended.
- **Field:** StudentEnrollment.field (StudentField enum, nullable); required+restricted for 3rd Secondary (SCIENCE: COMPUTER/BIOLOGY/ENGINEERING; ART: MILITARY_SCIENCES/ISLAMIC_STUDIES), forbidden elsewhere. Enforced on admission/enroll/update; transfers bypass (documented gap). Frontend: picker in admission + edit wizards, review rows, enrollments history column.
- **Proven live:** guardian create -> 26CPG0001; enroll 3rd-sci without field / wrong field / field-on-1st all 400 with spec messages. Specs: 5 generator + 5 service; suite green, tsc + nest build clean, academic build 55 pages.
- **Stale-server lesson (again):** the running instance predated the build (PID from 02:25); dist had the code but the server did not. Restarted from fresh dist before proving. Backend left RUNNING (user terminal instance replaced).

## 2026-10-15 â€” DiscountEligibility + Topper rules + payment-time application (backend mechanics)

- **Migration hand-authored** (same standing convention as 2026-09-25: `migrate dev`
  refuses non-interactive shells; additive SQL folder, reviewed pre-deploy).
  New: enum `discount_source_type`, tables `discount_eligibilities`,
  `topper_discount_rules`, `discount_applications`. `prisma:generate` (npm script)
  also refreshes `prisma/schema.hash` â€” never run bare `prisma generate`.
- **Models follow the house finance shape:** `uuid` ids, `tenantId` on every row,
  `@@unique([id, tenantId])`, FK pairs `(id, tenantId)`, `Money = Decimal(12,2)`,
  `DeductionValueType` reused (no new PERCENTAGE/FIXED enum invented).
- **Eligibility bridge, not a parallel pipeline:** the three existing approve
  endpoints (`approveStudentDiscount`, `approveDiscount`, `approveFamilyCondition`)
  materialize a `DiscountEligibility` in the same `withTenant` transaction
  (keyed by `sourceRefId`; idempotent on re-approve). Reject paths create
  nothing. Sibling sync / family CRUD / approval-queue UI are untouched.
- **One-time consumption:** `value âˆ’ Î£ DiscountApplication.amount =
  appliedAmount` on the row; each eligibility reduces a payment at most to that
  remainder, then stops. Verified by multi-payment specs in
  `finance-portal.record-payment.spec.ts`.
- **Balance math:** `buildSchedules` becomes
  `totalFee âˆ’ totalPaid âˆ’ Î£DiscountApplication` (REFUNDED payments keep
  excluding their cash, discounts stay counted). The over-allocation guard
  (`recordPayment`) compares each INSTALLMENT allocation against
  `fi.amount âˆ’ paidByNo âˆ’ discountedByNo` so a discounted installment cannot be
  paid in full again.
- **Percentage base = the resolved structure's `totalFee`** (annual total),
  fixed = absolute currency. Combined reductions capped at the outstanding
  (zero floor, never negative); pay-all amount = outstanding âˆ’ selected
  discounts. Roles for all new endpoints live in the existing
  `finance-portal.roles.ts` sets (= `['ACCOUNTANT']` since 2026-10; covered by
  `finance-role-sets.spec.ts`).
- **Deploy 2026-10-15:** `20261015100000_discount_eligibility` applied via
  `prisma db execute` to the `.env` branch (`ep-square-frog`, neondb) â€”
  user-approved; verified live (3 tables + `discount_source_type` =
  SIBLING,TOPPER,FAMILY_CONDITION,MANUAL). Purely additive, no data touched.
  Restart order: migration first, then backend rebuild â€” new code queries the
  new tables.

## 2026-10-15 — Unified discount ledger + rules endpoints; assign hardening (2-tab workspace backend)

- **New `GET /finance/discounts/assigned`** (`FinancePortalService.listAssignedDiscounts`): unions StudentDiscounts (SIBLING iff `relationApplied` else MANUAL) + FamilyConditions (SPECIAL_DISCRETION, reason redacted unless `FAMILY_CONDITION_VIEW`) + TOPPER eligibilities (active/expired from `expiresAt`, no actions). Rows carry `source` so the client routes approve/reject to the owning endpoint. Ordering is source-grouped (deterministic; cross-source recency sort deliberately avoided — incomparable timestamps). Unknown `DiscountType.kind` maps to `valueType: null` (mirrors the rules union; the bridge drops unknown kinds, so the ledger must not display a confident wrong type). No pagination params — house take-cap convention (200/200/200, `Promise.all` fan-out).
- **New `GET /finance/discount-rules`** (`FinanceDiscountsService.listDiscountRules`): unions sibling rules (description encodes relation + min count), topper rules, discount types (MANUAL, `value: null` — types carry no stored value; value is set at assign time).
- **Reason redaction + audit parity:** the assigned route derives `canViewReason` exactly like `FinanceFamilyController` and `listAssignedDiscounts` delegates to `FinancePayrollService.recordFamilyConditionView` when reasons are visible (same `FAMILY_CONDITION_VIEWED` trail as the family list endpoint). `FinancePayrollService` injected into `FinancePortalService` (same module, payroll depends only on Prisma — no cycle).
- **`POST /finance/discounts/assign` hardened (was blind-insert + FK-500s):** verifies student and type inside the tenant (404s), optional `category/valueType/name` with find-or-create DiscountType scoped by `{tenantId, name, kind}`; P2002 race re-reads the winner (name-only, since unique is `[tenantId, name]`); opposite-kind winner -> honest 400. Value guard resolved against the *effective* kind (legacy `discountTypeId` path included): `>= 0`, percentage `<= 100`. SIBLING assigns stamp `relationApplied: MANUAL_ASSIGN` (classifies + bridges as SIBLING; bridge comment updated) and `snapshotValue`. `CreateFamilyConditionDto` + `CreateSiblingRuleDto` replace `any` bodies (whitelist pipe enforces); sibling/family creates share the same range guard.
- **Blind cross-tenant writes closed (review findings):** `rejectDiscount` now 404s unknown ids and only transitions PENDING rows; `update/deleteTopperRule` and `deleteSiblingRule` tenant-scope before mutating. `listAssignableStudents` also matches `roleNumber` (additive output field).
- **Known residual risks (documented, not fixed):** (1) concurrent double-approve can double-bridge — `insertIfAbsent` is check-then-create with no unique on `(tenantId, sourceRefId)`; airtight fix needs a migration (unique constraint) — proposed as follow-up, NOT applied (DB-touch rule). Client disables action buttons while a request is in flight. (2) Pre-existing `void recordFamilyConditionView` fire-and-forget on the *old* family list endpoint (unhandled-rejection crash risk) — untouched, flagged. (3) `StudentDiscount` has no `createdAt`, so ledger order within the discount group is `id desc` (CUIDs, not time-ordered) — accepted. (4) Sibling/topper *update* paths and pre-existing rule validators outside the touched surface were left as-is.
- **Deploy note:** no schema change in this task (code-only). New endpoints 404 until the backend is rebuilt + restarted (user-owned step).

## 2026-10-15 - Expenses ledger hardening for the 2-tab workspace (code-only, no migration)

- **List mapper extended** (`FinancePortalService.listExpenses`): now returns `title` (= description) and `vendor` (= payee) alongside the existing fields. Purely additive output; existing consumers unaffected.
- **`createExpense` extended:** accepts `{ category, amount, title?, description?, vendor?, date? }` with `title -> description`, `vendor` (falls back to title for legacy `description`-only callers), `date` (defaults to today), plus new guards (category required, amount > 0). Category find-or-create by name retained. The old double-write (create then update description) is gone - a single create carries both fields.
- **New `updateExpense` / `deleteExpense`** (`PUT`/`DELETE /finance/expenses/:id`, WRITE role): tenant-scoped (`findFirst { id, tenantId }` -> 404, no blind cross-tenant writes) and PENDING-only (400 otherwise - approved/paid rows are immutable financial records). Portal layer resolves category *names* to ids and maps `title -> description` so the modal stays label-based.
- **`rejectExpense` accepts an optional reason:** empty-string reasons 400 (`Rejection reason is required`); a valid reason is forwarded but NOT persisted - the Expense model has no rejection-reason column (same documented-limitation pattern as the discount double-approve race). Follow-up migration can add the column; the API contract already carries it.
- **Cosmetic:** `FinanceExpensesController` ApiTag renamed `Finance — Expenses & Refunds` -> `Finance — Expenses`. `FinanceRefundsController` and `GET /finance/refunds` untouched and live (UI-only deprecation).
- **Tests:** new `finance-expenses.spec.ts`, 10 tests RED-first (mapper vendor/title, create mapping, reject validation/forwarding, update/delete 404 + PENDING guards) - all GREEN. Suite now 20 suites / 187 tests.
- **Deploy note:** no schema change (code-only). New PUT/DELETE routes and extended mapper fields 404/miss until the backend is rebuilt + restarted (user-owned step).

## 2026-10-15 (addendum) - Expense `date` PrismaClientValidationError: bare YYYY-MM-DD rejected by Prisma DateTime

- **Symptom (live):** `POST /finance/expenses` 500d with `Invalid value for argument date: premature end of input. Expected ISO-8601 DateTime` - the portal layer passed `"2026-10-15"` straight into `tx.expense.create()`. Latent in the old code too (`slice(0, 10)` produced the same shape); it surfaced once the new modal started sending real dates.
- **Fix (central, code-only):** `FinanceExpensesService.toIsoDateTime` normalizes YYYY-MM-DD -> `T00:00:00.000Z` ISO in `createExpense`, and patch dates in `updateExpense` - every caller is safe regardless of incoming shape. Regression tests added (create + update normalization); suite now 20 suites / 189 tests.
- **Deploy note:** backend rebuild + restart required to pick this up (user-owned step).

## 2026-10-15 - Treasury backend: closings list + expected endpoint, transfer pairing (code-only, no migration)

- **New `GET /finance/closings`** (`FinancePortalService.listClosings` over `FinanceCashService.listClosings`): maps DailyCashClosing rows with account name, cashier name (global User lookup by closedBy id), amounts, variance, and derived status (`variance == 0 -> CLOSED` else `FLAGGED_REVIEW`). No APPROVED state - the model has no status/approver column.
- **New `GET /finance/closings/expected?accountId=`**: credits-minus-debits for the account, mirroring `dailyClosing` math exactly so the modal preview matches the stored variance. (Note: this intentionally excludes `openingBalance`, matching pre-existing closing semantics even though the accounts-balance endpoint includes it.)
- **`POST /finance/closings`** (new portal route, CASHIER_WRITE, over hardened `FinanceCashService.dailyClosing`): account tenant-verified (404, closes the blind cross-tenant write), invalid-date 400, duplicate account+date (P2002 on `@@unique([tenantId, accountId, date])`) mapped to a friendly 400, optional notes accepted-but-unpersisted (no column - documented).
- **Transfers without a migration:** `POST /finance/transfers` (CASHIER_WRITE) -> `FinanceCashService.transferFunds` writes paired DEBIT/CREDIT `FinancialTransaction` rows sharing `XFER:<uuid>` in `referenceType` (41 chars, fits VarChar(50)) inside one `withTenant` callback; `GET /finance/transfers` pairs legs back into transfer rows (orphan legs skipped, 200 cap). Guards: distinct accounts, amount > 0, both accounts tenant-verified. Notes/recordedBy accepted but unpersisted - follow-up migration can add a real `fund_transfers` table (from/to/amount/currency/reference/notes/recordedBy) if history needs to survive transaction pruning.
- **Roles:** lists on READ, creates on CASHIER_WRITE (cashier operations; ACCOUNTANT holds both since 2026-10).
- **Tests:** new `finance-treasury.spec.ts`, 9 tests RED-first (closing status derivation + cashier names, expected math, transfer pairing/validation, duplicate-close + unknown-account guards) - all GREEN. Suite now 21 suites / 198 tests.
- **Deploy note:** no schema change (code-only). New routes 404 until the backend is rebuilt + restarted (user-owned step).

## 2026-10-15 - Staff positions + portal-access gating (code-only, no migration)

- **Position vocabulary:** `CreateStaffDto`/`UpdateStaffDto` now take prompt-key `position` (7 keys) + optional `customPositionTitle`, mapped to stored slugs (FINANCIAL_AFFAIRS->ACCOUNTANT, ACADEMIC_AFFAIRS->ACADEMIC_ADMIN, operational slugs as-is, CUSTOM mints per-staff `CUSTOM_<token>` with the title in `role.name`). Legacy `role` slug still accepted and mapped (deprecated, prevents a deploy-order 400 cliff for old clients).
- **Access rules enforced server-side:** system positions require email + password>=8 (400 otherwise); operational/CUSTOM with a password 400s (`must not set a password`); CUSTOM without a title 400s. Operational staff persist with `passwordHash: null` + email optional, holding a membership + position role row so they appear in the directory.
- **Directory scope widened:** list/find/update/status/delete filters replaced the 3-slug `in:` list with system+operational slugs OR `startsWith CUSTOM_`; rows shaped with `position` (prompt key), `positionTitle`, `hasSystemAccess` (memberships kept for compat). Role filter query accepts prompt keys + CUSTOM.
- **Single-position invariant:** `update` now REPLACES membership roles (deleteMany + create) instead of appending, so system->operational transitions actually revoke access. Update re-reads via `findOne` after commit (in-transaction reads would see stale memberships).
- **New `PATCH /staff/:id/password`** (ADMIN/SYSTEM_ADMIN, self-reset forbidden like other self-mutations): 400s for targets without portal access; bcrypt-hashes the new password. Staff-number prefixes extended (PRI/JAN/LIB/CUS).
- **Tests:** new `staff-access.spec.ts`, 10 tests RED-first (system create w/ email+hash, missing-password/email 400s, operational null-hash + password-rejection, CUSTOM title validation + per-staff role, directory filter coverage, reset scoping, role replacement) - all GREEN.
- **Deploy note:** no schema change (User.passwordHash/email already nullable). Frontend + backend ship together; legacy `role` fallback covers ordering skew.

## 2026-10-15 (addendum) - Staff email wiped; next-number preview endpoint

- **Email wiped from the staff module** (user directive: staff ID + password is the credential): removed from `CreateStaffDto`/`UpdateStaffDto`, create/update persistence, list/findOne selects, and the directory search OR-clause. System-role validation is now password-only. `User.email` column left alone (nullable; unrelated flows untouched).
- **New `GET /staff/next-number?position=`** (ADMIN/SYSTEM_ADMIN, declared before `:id`): returns the next position-prefixed staff number via the existing `generateStaffNumber` sequence without creating. Powers the add-form preview. Same-`position` concurrent previews may collide visually; writes still sequence correctly.
- **Tests:** email specs replaced with no-email creation assertion + 2 preview tests (prefix sequencing, unknown-key 400). Suite: staff 11/11 GREEN.

## 2026-10-15 - Monthly pay register (2-tab payroll workspace, code-only, no migration)

- **Roster = memberships UNION active teachers, deduped by user** (`listPayrollRegister`): no manual assignment step. Role label from membership slug, `Teacher` for academic teachers. Students/guardians excluded.
- **Monthly lock without schema change**: a PAID `SalaryPayout` with `paidAt` in the current calendar month locks the row (`PAID FOR <Month Year>` badge). Next eligible = `addMonthsClamped(lastPaidAt, 1)` — Jan 31 re-opens Feb 28 (Feb 29 leap), never overflows into March. Pure helper, unit-tested.
- **Shortage engine**: `computeShortage(absent x daily + late x rate)`; counts from `StaffAttendance` in the cycle month joined via `Teacher.userId`. Rates persist as **inactive reserved** `SalaryDeductionRule` rows (`__SHORTAGE_ABSENT_DAILY__`, `__SHORTAGE_LATE__`) so the generic payout engine and the rules list never see them (`listDeductionRules` excludes `__SHORTAGE_*`). No `LATE` status exists in `StaffAttendanceStatus` yet — late rate is stored, counts read 0 until it lands.
- **`POST /finance/payroll/pay`** (ACCOUNTANT): validates method enum, 400s on duplicate-cycle pay and on missing active assignment (payout FK requires it — assign a position first). Single call chains create(DRAFT, rule lines + ad-hoc shortage lines with null ruleId) -> APPROVED -> PAID + DEBIT transaction + audit. Reference/notes optional.
- **Setup tab writes**: `PUT /finance/payroll/salary` sets assignment `salaryOverride` (same-position, no history churn); position base edits reuse `PUT /finance/positions/:id`; `PUT /finance/payroll/shortage-rates` upserts reserved rows (>= 0).
- **Tests**: `finance-payroll-register.spec.ts` 13/13 GREEN (union/dedupe, paid lock + next date, 2x$10=$20 net math, dup-pay 400, no-assignment 400, rate validation/defaults, month-end clamping). Suites: staff+finance 232/232.

## 2026-10-15 (addendum) - Position-based salary linkage + ADMIN exclusion

- **Personnel exclusion**: `STAFF_ROLE_BLOCK` now also drops `ADMIN`, `SUPER_ADMIN`, `SYSTEM_ADMIN` memberships from the pay register (and the employees list) — the admin accounts never appear in payroll. Teachers + all operational staff stay included.
- **Position base is the single source of truth**: register and `paySalary` both use `position.baseSalary`; per-person `salaryOverride` is ignored for payroll math so a Positions-tab edit propagates to every holder instantly (spec: Janitor $600 -> net $600; override $900 ignored). `PUT /finance/payroll/salary` endpoint retained for API compat.

## 2026-10-15 (addendum) - Caller-scoped position dropdown

- **Form dialogue rule** (user directive): Academic Affairs callers see only TEACHER positions; admin-side callers see everything except admin-titled positions (ADMIN self never assignable).
- `GET /finance/positions` now takes the caller userId and scopes server-side: membership roles containing TEACHER/ACADEMIC_AFFAIRS (without any admin/accountant role) -> `title contains teach` filter; everyone else -> full list minus ADMIN/SUPER_ADMIN/SYSTEM_ADMIN titles. Route guard widened to ACCOUNTANT + TEACHER + ACADEMIC_AFFAIRS (reads only; all writes stay ACCOUNTANT-only). Frontend modal unchanged — it renders whatever the API returns.
- **Tests**: +3 scope specs (academic-only filter, accountant full-minus-admin, teacher+admin falls back to full). Register spec 19/19; staff+finance 238/238.

## 2026-10-15 (addendum) - Staff-based salary form (people, not positions)

- **Form dialogue select lists PEOPLE** (user directive): new `GET /finance/payroll/staff-options` returns `{academic, admin}` groups scoped by caller role — academic callers (TEACHER/ACADEMIC_AFFAIRS, no full-scope role) get teachers only; accountants get teachers + admin staff minus any STAFF_ROLE_BLOCK account (ADMIN self never assignable). Guard widened to ACCOUNTANT + TEACHER + ACADEMIC_AFFAIRS (read-only).
- **Saving assigns**: `POST /finance/payroll/assign-salary` (ACCOUNTANT) resolves the role (teacher record -> Teacher, else first non-blocked membership slug), find-or-creates the position by title, ensures an active assignment, and sets the position base. Register is position-driven so the amount propagates to every holder instantly. 400s on negative, unknown person, or role-less/blocked accounts.
- **Tests**: +4 specs (academic-only options, accountant full-minus-admin, teacher assign creates Teacher position @ amount, negative 400). Register spec 23/23; staff+finance 238+ total green.

## 2026-10-15 (addendum) - Position salary upsert contract (empty-base fix)

- **Root cause of empty/$0 bases**: three divergent write paths (PUT by id / POST create-by-title / roster-pick) could disagree on position identity (case, stale ids), so the tab wrote one row while the register read another.
- **Single contract**: `POST /finance/payroll/positions` `{ positionKey, baseSalary }` (ACCOUNTANT, validated DTO, global transform pipe coerces numbers). Key normalized title-case, matched case-insensitively, ADMIN keys rejected, negatives/blank rejected. Edit-by-id PUT retained only for the in-table Edit flow.
- **Tests**: +3 upsert specs (case-insensitive update, create-on-new, 400s). Register spec 26/26; staff+finance 245/245.

## 2026-10-15 (addendum) - Role-derived position fallback (Adil/Hisham fix)

- **Verified root cause in live DB**: only Iman had an active assignment; Adil/Hisham (TEACHER, ACTIVE) had none, so the register computed base 0. Restarting servers could never fix it — Academic Affairs teachers never get assignments.
- **Register**: also fetches active positions; members without an assignment fall back to their role-derived title (teacher record -> Teacher, else title-cased slug) matched via shared `normTitle` identity (case-insensitive, `_`/space equal — covers Academic_admin). New `payable` field = base > 0; `hasAssignment` retained for compat.
- **`paySalary`**: new `ensureAssignment` auto-links on pay (find-or-create position by role title, create assignment) instead of 400ing; added 400 when resolved base is 0 (set salary first). Unknown/blocked persons still 404/400.
- **Tests**: +4 (fallback resolves Teacher base+payable; no-match unpayable; auto-link pays; zero-salary 400) plus rewritten no-assignment spec. Register 30/30; staff+finance 249/249.

## 2026-10-15 (addendum) - Parents out of the pay register (register-scoped)

- **Leak**: the roster loop only skipped memberships with roles that were all blocked, so role-less memberships (parents) passed through into the register.
- **Fix**: skip memberships with zero roles OR fully-blocked slugs. Teacher-record members without memberships still enter via the teacher loop (Adil/Hisham path intact). Scoped to the register only — `listEmployees` untouched per user directive.
- **Tests**: +3 (role-less excluded, GUARDIAN excluded, teacher-without-membership kept). Register 33/33.

## 2026-10-15 (addendum) - Parents out of payroll (live leak fixed)

- **Live finding**: 246 PARENT-slugged memberships in the tenant were reaching the register — STAFF_ROLE_BLOCK never contained PARENT (only STUDENT/GUARDIAN/ADMIN/...). GUARDIAN/role-less were already covered.
- **Fix**: new REGISTER_ROLE_BLOCK = STAFF_ROLE_BLOCK + PARENT, applied to the register roster, staff-options dropdown (both tabs), salary assignment, and pay auto-link. `listEmployees` deliberately keeps the narrower block (per user directive).
- **Live verified**: all 246 PARENT memberships are single-role, so all drop out with zero dual-role edge cases. Specs: register 36/36 (incl. new PARENT register/options/assign specs).

## 2026-10-15 - Financial reports backend (code-only, no migration)

- New `FinanceReportsService` + `FinanceReportsController` (ACCOUNTANT-only): `GET /finance/reports/summary?from&to` (COMPLETED payments / PAID expenses + PAID payout nets / DiscountApplication sums, net = collections - expenses, per-method count/total/share) and `GET /finance/reports/ledger?from&to&type` (union of payments/expenses/paid-payouts/discount-applications, signed amounts, newest-first, take 500/source). 400 on bad/inverted range.
- Locked decisions: Recorded By = approver where the model has one else "--" (Payment has no recorder field); discounts = payment-time DiscountApplication rows. Paid expenses = status PAID (APPROVED listed in ledger for audit visibility).
- Tests: `finance-reports.spec.ts` 6/6 (sums, shares total 100, ledger union/order/signs, type isolation). Suites: staff+finance 261/261.

## 2026-10-15 (addendum) - Ledger Recorded-By names (UUID fix)

- **Issue**: ledger `by` column rendered raw `approvedBy` UUIDs (live: expense approver, payout approver).
- **Fix**: `getLedger` collects distinct approver IDs from expense + payout rows and resolves them with one batched `user.findMany` (no per-row queries, no migration, shape unchanged). Null/unknown IDs -> "--" (covers legacy rows and deleted users).
- **Tests**: +1 spec file case (Hassan Shaiba resolution, ghost-ID fallback); reports 7/7 GREEN. Frontend untouched (renders `by` as-is).

## 2026-10-15 - Financial controls workspace (migration 20261016090000_financial_controls)

- **Migration** (applied live, verified via information_schema): `approval_thresholds` table + `financial_payment_methods.account_name/account_number`. Settings prefixes/grace deliberately NOT migrated — they live in the existing `tenant.settings` JSON finance bag (default receipt SCH-REC-, voucher SCH-EXP-, grace 7); currency writes `tenant.currencyCode`.
- **Code**: `setPeriodLock` (lock stamps closedBy/At, unlock clears; double-lock/unlock 400), `setMethodActive` + `setMethodDetails` (receipt-display only, never ledger math), thresholds CRUD with approverRole validated against tenant+system role slugs, `get/updateFinanceSettings` with merge-without-clobber semantics. Portal routes: periods POST/lock/unlock, methods PUT (single-concern guard), thresholds CRUD, settings PUT. Period date validation added to legacy `createPeriod` too.
- **Deferred**: lock enforcement on payment/expense edit paths (nothing checks isClosed today) — follow-up task. Payments-page method-dropdown sourcing flagged for verification.
- **Tests**: `finance-controls.spec.ts` 14/14 GREEN.

## 2026-10-15 - Student ledger endpoint (code-only, no migration)

- New `GET /finance/students/:id/ledger` reusing `buildSchedules` as the single source of installment math. Fee itemization follows the model (Base Tuition + Registration rows with per-target discount buckets). Statuses: schedule balance<=0 -> FULLY_PAID, overdue -> OVERDUE, else PARTIALLY_PAID; installments PAID/PARTIAL/PENDING/OVERDUE by complete/overdue/paid. Collected-by = "--" (payments carry no recorder; locked reports rule). Grade-only display (no section field on the model). 404 unknown student.
- Tests: `finance-student-ledger.spec.ts` 5/5 (totals math, installment statuses incl. explicit past-due OVERDUE, payment targets/refs, 404).

## 2026-10-15 - Dashboard outflows + headcount + activity (additive)

- Extended `getStats` additively (old fields unchanged): `payroll` + `outflows` (PAID expenses + PAID payout nets; APPROVED-unpaid money excluded by design), net = collections - outflows, `collectionsLastMonth` + null-safe change pct, ACTIVE-only student/teacher headcounts, `recentActivity` (latest 10 merged/sorted across payments/expenses/payouts, signed amounts). Positions reuse existing endpoint.
- Tests: `finance-dashboard.spec.ts` 4/4 (exact outflows sum, ACTIVE filters, pct null-safe, activity merge/limit/signs).

## 2026-10-15 (addendum) - Dashboard tenant identity (debugging aid)

- `getStats` now returns `tenant: { id, name }` so the dashboard can prove which school its numbers belong to. Guards the recurring wrong-tenant vs stale-backend confusion at the source. Spec +1.

## 2026-10-15 (addendum) - Restart-that-wasnt: entry point + stale processes

- Dashboard zeros traced to a backend that never reloaded: `node dist/src/main` (no extension) dies instantly and silently, so the old process kept port 3000. Correct entry is `node dist/src/main.js`. Both servers were stopped, rebuilt (`nest build`, `next build` — incl. clean `/students/[id]` partial prerender), and restarted fresh (backend PID on :3000, frontend on :5500); boot log confirms all new routes mapped (`payroll/positions`, `reports/*`, `students/:id/ledger`, `approval-thresholds`, dashboard stats).

## 2026-10-17 - Dashboard outflows: APPROVED expenses now count + payout data correction

- getStats (finance.service.ts): expenses/outflows/recentActivity now aggregate Expense status in [APPROVED, PAID] (user override of the earlier PAID-only lock). Live: Maintenance expense 400,000 (approved) flows into Total Outflows and recent activity.
- Live data correction (user-directed): Iman Eltigani's two salary_payouts carried smoke-test snapshots (gross 1,500, deductions 150, net 1,350 from the wiped "Smoke Test Teacher" base) while pointed at the real Teacher position. Corrected to gross 1,000,000 / deductions 0 / net 1,000,000 for both the PAID and DRAFT rows.
- Dashboard spec renamed to "approved-or-paid expenses plus paid payroll nets" and asserts the where-in clause (5/5).
- Note: only Iman currently has a staff_position_assignments row; Teacher base 1,000,000 applies per-assignment. Other teachers need assignment rows to be payable.

## 2026-10-21 - Platform control plane P2: cross-tenant read/write API

- **New slice** `src/platform/` (module `platform`, controller prefix `platform`): `GET /platform/stats`, `GET /platform/tenants` (search/status/plan filters + pagination, page size clamped to 100), `GET /platform/tenants/:id` (profile, licenses, modules, flags, counts, invoices, last 20 audit entries), `PATCH /platform/tenants/:id/status|modules/:module|flags/:key`.
- **Auth**: every route sits behind `PlatformAdminGuard` (scope `platform` + ACTIVE `platform_admin` row). Writes additionally pass `PlatformRoleGuard` (`@PlatformRoles('SUPER_ADMIN')`), so SUPPORT is read-only. `PlatformActor` (admin id, role, ip, user agent) is built by `platformActor(request)` and every mutation writes a `platform_audit_logs` row (action, entity, tenant, old/new values).
- **Status machine** (locked, delete = archive only): ACTIVE/TRIAL/PENDING -> {ACTIVE,TRIAL,PENDING,SUSPENDED,ARCHIVED}; SUSPENDED -> {ACTIVE,ARCHIVED}; ARCHIVED -> terminal (reactivation is a 400). Same-status writes are a no-op and are not audited.
- **MRR = sum(price/12) over ACTIVE ANNUAL licenses** (LIFETIME licenses are excluded in the query and re-checked in code); revenue = sum of PAID `platform_invoices`; due invoices and licenses expiring within 30 days are counted.
- **Deliberately outside a tenant transaction**: platform operations are global, so they do not use `withTenant`/`withTenantRead` and never inherit a tenant GUC context.
- **Tests**: `platform-tenants.service.spec.ts` (MRR/revenue math, filters, pagination clamp, detail shape, status rules, upsert + audit payloads) and `platform-role.guard.spec.ts` (SUPER_ADMIN vs SUPPORT). Live smoke `scripts/smoke-platform-tenants.ts` 14/14 against the real DB, reverting every mutation it makes.

## 2026-10-21 - Platform control plane P3/P4: audit trail, announcements, provisioning

- **P3 audit + announcements** (`src/platform/platform-ops.service.ts`): `GET /platform/audit` (filters tenantId/actorId/action, page size clamped to 100, resolves tenant and actor names in two batched lookups instead of per row) and `GET|POST|PATCH /platform/announcements`. Announcements are published/withdrawn (`isActive`), never hard-deleted; every write is audited. Both writes are SUPER_ADMIN-only, reads are open to SUPPORT.
- **P4 provisioning** (`src/platform/platform-provisioning.service.ts`, `POST /platform/tenants`): one transaction creates tenant + administrator user + ACTIVE membership + ADMIN role + portal switches + feature flags + first license; the plan is resolved before the transaction so an unknown plan fails fast, and bcrypt runs before it so no pooled connection is held during hashing. Password rule: >= 8 chars with a letter and a number. Duplicate slug / duplicate admin email -> 409. The provisioning action is audited with the new tenant id.
- **New endpoint** `GET /platform/plans` (active plans) so the console can offer a plan choice.
- **Tests**: `platform-ops.service.spec.ts` (audit filters/resolution, announcement publish/withdraw/audit, SUPPORT refusal) and `platform-provisioning.service.spec.ts` (slug/email conflicts, weak password, unknown plan, default modules, audit payload, SUPPORT refusal). Live smokes: `scripts/smoke-platform-ops.ts` 9/9 and `scripts/smoke-platform-provisioning.ts` 9/9 - the latter proves the provisioned administrator can sign in to the *school* portal and is scoped to the new tenant, then removes everything it created.
- **Caught by the live smoke, not by unit tests**: `@Length(200)` in `ProvisionTenantDto` means "exactly 200 characters" (class-validator), not "at most 200" - every provision request was rejected with 400. Fixed to `@MaxLength(200)`. Unit tests with a mocked DTO boundary could not have seen this.

## 2026-10-21 - Platform financial affairs: currencies, expenses, payments

- **New tables** `platform_currencies` (ISO code as primary key, rate to 1 USD, per-currency auto-sync switch), `platform_expenses` (category, optional country allocation, amount + currency, paid date) and `platform_payments` (money received against a school's license, method, type, reference). New enums `platform_expense_category`, `platform_payment_method`, `platform_payment_type` - separate from the tenant finance enums, because the platform books money against licenses in many currencies, not against a fee schedule. The migration is additive only and documents its down path.
- **Two accounting rules, applied consistently:**
  1. *Revenue is cash received* (`platform_payments`), not invoices. An invoice is a document, a payment is money in; they are never added together, so issuing a receipt for a payment cannot be counted twice. The receipt endpoint creates a PAID `platform_invoice` as the billing document.
  2. *Conversions happen at read time* with the current rate, so a rate change moves the P&L immediately. The trade-off: a past month restated after a rate change differs from what was reported then.
- **A currency with no rate is never treated as 1:1.** A school billing in an unconfigured currency shows as `UNPRICED` with no local price, and its payments/expenses are counted as `unconverted*` rather than being silently converted. This was found by the live smoke: one seeded school bills in EUR, which was missing from the table.
- **`PaymentGatewayAdapter`** is the seam for how money arrives: a manual adapter today (which remembers the intents it created so a later reconciliation can ask about a reference), plus a registry that resolves an adapter by currency and falls back to manual. A bank integration (Tap, MyFatoorah, Bankak, a core-banking webhook) becomes a second adapter - the schema already stores amount, currency, method, type, reference and paidAt, so no schema change is needed.
- **API**: `GET /platform/financials/overview|subscriptions|currencies|expenses|payments`, `PATCH /platform/financials/currencies/:code`, `POST /platform/financials/expenses|payments|receipts`. Reads are open to any platform admin, writes are SUPER_ADMIN-only, and every write is audited (payments, expenses, receipts, and rate changes).
- **Two bugs caught by the live smoke that unit tests could not see:** a type-only `import type { PrismaService }` broke Nest dependency injection (the emitted metadata had no token - the service is only constructed by the injector, never by a unit test); and a currency code was written into `platform_audit_logs.entity_id`, which is a uuid column.
- **Tests**: `platform-financials.service.spec.ts` (P&L math, country split, global costs, subscription status, unpriced currency, rate validation, payment/expense recording), `platform-currency-catalogue.spec.ts`, `payment-gateway.adapter.spec.ts`. Live smoke `scripts/smoke-platform-financials.ts` 19/19, covering the spec's three verification steps (overview totals and country breakdown, a rate change moving converted subscription values, a manual payment moving a subscription from OVERDUE to PAID); it removes everything it creates.
