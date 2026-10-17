# Plan: BDU audit & code repair (migrations, database, code review fixes)

Date: 2026-10-17
Branch: bdu-audit-repair
Workspace: 177b1-audit-repair

## Context

Three requests from the human partner, all approved on 2026-10-17:

1. Fix everything broken so `npm run dev` runs.
2. Fix everything the two audits found (code audit: security/logic; ponytail audit: over-engineering).
3. Fix the database — table structure, duplicate migrations, redundancy.

## Global Constraints

- TDD applies to every task that changes logic or test-visible behavior.
- Every implementation task ends with its own task review (see
  subagent-driven-development); the controller never fixes findings itself.
- No subagents spawned by implementers — review is always dispatched by the controller.
- Never modify files outside this worktree (the dev database is the only
  shared side effect, and it is already repaired).
- The final whole-branch review is dispatched once, on the most capable model.
- Minor findings are recorded in the ledger, never silently dropped.
- The fix-loop breaker: adjudicate only at round 5; every ruling is a ledger entry.

## Tasks

- [x] Task 1: Apply corrected checksums to `schema_migrations` (versions 58–60). Database-only; no repo commit. Verified: `npm run db:migrate` skips 59/59.
- [x] Task 2: Create migration `061_repair_drifted_objects.sql` (missing tables, leftover table, dead table, redundant indexes) and verify `npm run dev`.
- [ ] Task 3: Fix HIGH — leader-role demotion bug (`student.service.js`).
- [ ] Task 4: Fix MEDIUM — N+1 query in `media-cleanup.service.js`.
- [ ] Task 5: Fix MEDIUM — N+1 query in `identity-admin.service.js`.
- [ ] Task 6: Resolve MEDIUM — missing migration 046 (investigate history; decide restore vs document).
- [ ] Task 7: Add MEDIUM — missing test coverage (leader branch; AvatarOverrideService DB methods).
- [ ] Task 8: Fix LOW — two route guards missing (`broadcast.routes.js`, `identity.routes.js`).
- [ ] Task 9: Fix LOW — avatar override exposes internal fields (`content_hash`, `updated_by_mssv`).
- [ ] Task 10: Fix LOW — shutdown swallows errors (`server.js`).
- [ ] Task 11: Fix LOW — `dangerouslySetInnerHTML` without sanitizer (`GrammarRunner.jsx`, `GrammarLessonPage.jsx`).
- [ ] Task 12: Document retention of applied-but-superseded migrations 016 and 049 (ponytail delete findings). No functional change.

## Notes

- Tasks 1–2 were executed inline before this worktree was created. Their
  artifacts (the corrected checksum rows live in the dev database; the
  migration file lives in this worktree) are recorded as complete here.
- Task 12 makes no code change; it only strengthens the header comments of
  migrations 016 and 049, because both files are referenced by the
  migration ledger and cannot be deleted.
