#!/bin/bash
# Post comment to GST-61 via Paperclip API

COMMENT=$(cat <<'MD'
## GST-61: Root Cause Analysis — Why Tasks Are Blocked

### Data Collected
- **28 total commits** across 2 branches (`main`, `clean-main`)
- **2 contributors**: Release Engineer (26 commits), M. Husnul Aqib (2 commits)
- **Branch divergence**: `main` and `clean-main` split at `0ed8477` and were NEVER merged back
- **0 merge commits** in entire history
- **Work span**: Apr 16 – Apr 20 (4 days)

### Root Causes

#### 1. SINGLE-PERSON BOTTLENECK (Critical)
```
Release Engineer:  26 commits (93%)  ██████████████████████████
M. Husnul Aqib:     2 commits  (7%)   ██
```
One person is doing ALL architecture, implementation, releases, and fixes. When that person stops, everything stops.

#### 2. BRANCH DIVERGENCE — Integration Risk (High)
```
main        ───0ed8477───GST-6/GST-7/GST-9/GST-10/GST-11/GST-12 (16 commits, stale since Apr 17)
clean-main  ───0ed8477───GST-19/GST-42/GST-44/GST-59/Phase 2    (10 commits, active)
```
`main` has 16 commits of old foundation work that are NOT in `clean-main`. The CI workflow (`2fa24bc`) was deleted on `main` but exists on `clean-main`. These branches are drifting apart with no merge strategy.

#### 3. NO PARALLEL WORKFLOW (High)
All 26 Release Engineer commits are sequential — no feature branches, no PRs (except 2 from Husnul). This means:
- No code review parallelism
- No one can unblock another
- Single point of failure

#### 4. RELEASE ENGINEER DOING DEV WORK (Medium)
The "Release Engineer" is authoring feature commits (Phase 2, popup foundation, etc.) instead of focusing on release pipeline. Role confusion = context switching = slower throughput.

#### 5. COMMIT TIMELINE — Uneven Work Distribution
```
Apr 16 (Wed): ████████████████ 10 commits — Core packages, CLI, eval
Apr 17 (Thu): ████████████████████████████████████ 14 commits — OODA, NL, E2E, CI, Chrome extension kickoff
Apr 18 (Fri):                                     0 commits — DEAD DAY
Apr 19 (Sat): ██████████ 3 commits — Extension build pipeline, popup
Apr 20 (Sun): ███████████████████████████ 9 commits — Phase 2, LLM tests, keepalive
```

### Recommendations

| Priority | Action | Owner |
|----------|--------|-------|
| P0 | Merge `clean-main` into `main` or rebase — pick one trunk | Release Engineer |
| P0 | Assign GST-59 follow-up to Husnul to break single-person dependency | CTO |
| P1 | Enforce feature branch + PR workflow — no direct commits to main/clean-main | All |
| P1 | Clarify Release Engineer role — should manage releases, not write features | CTO |
| P2 | Set up branch protection rules on main | Release Engineer |

### Verdict
Tasks are blocked because there is effectively **one engineer** doing everything, with no parallel workflow, no branch integration strategy, and no delegation. Fix the workflow before adding more features.
MD
)

API_URL="${PAPERCLIP_API_URL:-http://localhost:8080}"
RUN_ID="${PAPERCLIP_RUN_ID:-unknown}"

BODY=$(jq -n --arg body "$COMMENT" '{body: $body}')

curl -s -X POST "$API_URL/api/issues/GST-61/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $RUN_ID" \
  -H "Content-Type: application/json" \
  -d "$BODY"
