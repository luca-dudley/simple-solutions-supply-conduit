---
name: session-closeout
description: Exact procedure for git diff audits, database schema synchronization, and memory changelog updates.
---

# Session Closeout Skill

## Purpose
Ensures complete reproducibility and persistence of memory across developer sessions and autonomous agent runs.

## Step-by-Step Closeout Procedure

### Step 1: Remote / Local Database Schema Synchronization
Run the schema sync utility script:
```bash
./scripts/sync_schema.sh
```
Verify that `.ai/SUPABASE_SCHEMA.md` is generated or refreshed with active SQL definitions.

### Step 2: Git Status & Diff Inspection
Check for untracked files or unintended configuration edits:
```bash
git status -s
git diff --stat
```
Ensure:
- No temporary test files (e.g. `test.csv`, `audio_test.ogg`) are lingering.
- No local `.env` or credentials were created in tracked locations.

### Step 3: Project Brain Changelog Update
Open [PROJECT_BRAIN.md](file:///home/luca/dev/simple-solutions-supply-conduit/PROJECT_BRAIN.md) and update **Section 6 (Changelog & Current State)**:
1. Append an entry with the current ISO date and engineer/agent handle.
2. Outline specific features added, bugs resolved, or architectural files generated.
3. State the exact next steps for the upcoming session.

### Step 4: Draft Conventional Commit
Formulate a descriptive commit message following the format:
- `feat(<scope>): <description>`
- `fix(<scope>): <description>`
- `refactor(<scope>): <description>`
- `chore(<scope>): <description>`
