# AGENTS.md - Project Memory & Documentation Protocol

## 0. Project Locations (read first)

This project is split across TWO folders - keep them straight:

1. Dev source (this repo): the frontend/backend source code.
   On this machine: C:/Users/11495/AppData/Roaming/reasonix/global-workspace/translator-app
2. Runtime folder: the built, portable app + models + project memory (docs/, REASONIX.md, pianhuabiao.txt).
   On this machine: E:/TranslatorApp - portable: copy the whole folder to any drive and it runs.

The docs/ directory referenced below lives in the RUNTIME folder (<runtime>\docs), not in this repo.
On this machine that is E:/TranslatorApp/docs.

---

# AGENTS.md — Project Memory & Documentation Protocol

## 0. Purpose

This repository uses a file-based project memory system.

The goal is to let coding agents recover project context across sessions, understand why the codebase is in its current state, and preserve important knowledge after every meaningful change.

The `docs/` directory is the project's durable memory. It is part of the implementation, not optional documentation.

Agents MUST read the relevant memory before changing the project and MUST update the memory after meaningful changes.

---

## 1. Core Rules

1. **Do not rely on chat history as the source of truth.**
   Durable project knowledge belongs in the repository.

2. **Before making changes, recover context from `docs/`.**
   At minimum read:
   - `docs/README.md`
   - `docs/CURRENT_STATE.md`

   Then read any task-relevant files such as:
   - `docs/PROJECT_OVERVIEW.md`
   - `docs/ARCHITECTURE.md`
   - `docs/FEATURES.md`
   - `docs/DECISIONS.md`
   - `docs/KNOWN_ISSUES.md`
   - `docs/ROADMAP.md`
   - `docs/CHANGELOG.md`
   - `docs/SESSION_LOG.md`

3. **After every meaningful implementation task, update `docs/`.**
   Documentation maintenance is part of the task's Definition of Done.

4. **Never fabricate project history.**
   If historical intent cannot be verified from code, Git history, tests, issue references, or existing docs, mark it as unknown.

5. **Prefer updating existing canonical files over creating redundant documents.**
   The memory system must remain compact enough for agents to use.

6. **Documentation must describe the repository as it actually exists.**
   Do not document planned behavior as implemented behavior.

7. **Code and docs must stay synchronized.**
   If a change makes documentation stale, the task is incomplete until the stale documentation is corrected.

8. **Write project memory in English.**
   All files under `docs/` must be written in English. Keep code identifiers, file paths, shell commands, model names, and proper nouns in their original form; only the surrounding prose is translated. New or updated doc entries must never be written in Chinese.

---

## 2. Required `docs/` Structure

If the following files do not exist, create them before or during the first meaningful task:

```text
docs/
├── README.md
├── PROJECT_OVERVIEW.md
├── CURRENT_STATE.md
├── ARCHITECTURE.md
├── FEATURES.md
├── DECISIONS.md
├── CHANGELOG.md
├── KNOWN_ISSUES.md
├── ROADMAP.md
└── SESSION_LOG.md
```

Do not rename these files without a strong reason, because agents depend on these stable paths for context recovery.

---

## 3. Meaning of Each Memory File

### `docs/README.md`
Navigation map for the memory system.

Keep:
- a one-line description of every memory file;
- recommended reading order;
- rules about which file owns which type of information.

### `docs/PROJECT_OVERVIEW.md`
Stable project identity.

Keep:
- project purpose;
- target users/use cases;
- major constraints;
- main technologies;
- important external systems;
- repository layout;
- how to run/test/build the project.

Do NOT turn this into a chronological log.

### `docs/CURRENT_STATE.md`
The most important short-term memory file.

It MUST remain concise and describe the repository **right now**:
- current working functionality;
- current architecture summary;
- active work;
- recently completed work;
- important technical constraints;
- known regressions/blockers;
- next likely steps.

This is a **snapshot**, not an append-only history.

When project state changes, rewrite stale sections instead of endlessly appending.

### `docs/ARCHITECTURE.md`
Technical system model.

Keep:
- components/modules;
- data/control flow;
- important interfaces;
- storage and external dependencies;
- deployment/runtime topology;
- invariants;
- architecture diagrams in Mermaid when useful.

Update it whenever a change affects system structure or component responsibilities.

### `docs/FEATURES.md`
Canonical feature inventory.

For each important feature record:
- feature name;
- user-visible behavior;
- implementation location;
- configuration;
- limitations;
- status: `implemented`, `partial`, `experimental`, `deprecated`, or `planned`.

Do not mark planned features as implemented.

### `docs/DECISIONS.md`
Lightweight Architecture Decision Record.

Record decisions that future agents might otherwise "undo" because the reason is not obvious.

Each decision should include:
- date;
- title;
- status;
- context/problem;
- decision;
- rationale;
- alternatives considered when known;
- consequences/trade-offs;
- relevant files/issues/commits when available.

Do not record trivial coding choices.

### `docs/CHANGELOG.md`
Chronological record of meaningful project changes.

Use newest-first entries.

Each update should include:
- date;
- concise change title;
- what changed;
- why it changed;
- important files/modules affected;
- migrations or compatibility implications when relevant.

This is a project-engineering log, not a copy of Git diff output.

### `docs/KNOWN_ISSUES.md`
Known defects, technical debt, unresolved questions, and operational hazards.

For each item record:
- status;
- symptoms;
- impact;
- suspected/known cause;
- workaround;
- relevant code;
- next investigation step.

Remove or archive resolved issues instead of leaving them looking active.

### `docs/ROADMAP.md`
Future intent only.

Keep:
- near-term priorities;
- planned improvements;
- deferred work;
- explicitly rejected or out-of-scope directions when useful.

Never use roadmap text as proof that a feature currently exists.

### `docs/SESSION_LOG.md`
Compact handoff log between agent sessions.

Append one short entry after meaningful work.

Each entry should include:
- timestamp/date;
- task objective;
- work completed;
- key files changed;
- tests/validation performed;
- unresolved items;
- recommended next action.

Do NOT paste full conversations, chain-of-thought, raw command logs, or huge diffs.

---

## 4. Agent Startup Protocol

At the beginning of a task:

### Step 1 — Read durable memory

Read:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/CURRENT_STATE.md`

Then selectively read other memory files relevant to the task.

### Step 2 — Verify memory against reality

Inspect relevant:
- source files;
- configuration;
- tests;
- package manifests;
- Git diff/status/history when available.

Documentation may be stale. Code and verified repository state take precedence over unsupported prose.

If docs are stale, fix them as part of the task.

### Step 3 — Establish the change boundary

Before editing, identify:
- what behavior is changing;
- which modules are involved;
- whether architecture or public behavior changes;
- which memory files will require updates.

For trivial edits, avoid unnecessary documentation churn.

---

## 5. Documentation Update Protocol

After implementation and validation, determine which memory files are affected.

### Always consider updating

- `CURRENT_STATE.md`
- `CHANGELOG.md`
- `SESSION_LOG.md`

### Update conditionally

| Change type | Required memory update |
|---|---|
| New/changed user-facing feature | `FEATURES.md` |
| Component/interface/data-flow change | `ARCHITECTURE.md` |
| Important design choice | `DECISIONS.md` |
| New bug/debt/risk discovered | `KNOWN_ISSUES.md` |
| Issue fixed | `KNOWN_ISSUES.md` + `CHANGELOG.md` |
| Priority/future plan changed | `ROADMAP.md` |
| Setup/build/run process changed | `PROJECT_OVERVIEW.md` |
| Current implementation state changed | `CURRENT_STATE.md` |

If no documentation file requires a change, explicitly verify that conclusion before finishing.

---

## 6. What Counts as a "Meaningful Change"

Documentation updates are expected when a task includes one or more of:

- adding/removing a feature;
- changing behavior or API contracts;
- changing architecture or dependencies;
- changing database/schema/storage formats;
- adding or changing configuration;
- fixing a non-trivial bug;
- changing deployment/build/runtime behavior;
- adding a workaround with future implications;
- making a consequential design decision;
- discovering a significant unresolved issue;
- materially changing project priorities.

Usually no history entry is needed for:
- typo-only edits;
- formatting-only changes;
- comments with no behavioral impact;
- mechanical rename with no externally relevant consequence.

Use judgment, but prefer preserving context when future agents would benefit from knowing **what changed and why**.

---

## 7. Writing Standards for Project Memory

Project memory should be optimized for machine and human retrieval.

### Do

- write in English (all `docs/` files must be in English; keep identifiers, paths, commands, and proper nouns in their original form);
- use precise headings;
- use bullets and tables where appropriate;
- mention concrete file/module names;
- state dates in `YYYY-MM-DD`;
- distinguish current facts from plans;
- explain **why**, not only **what**;
- keep entries self-contained;
- link related docs using relative Markdown links;
- keep the most important current context near the top.

### Do not

- write vague statements such as "improved the code";
- dump raw Git diffs;
- copy entire chat conversations;
- preserve obsolete information as if still true;
- duplicate the same fact across many files;
- invent motivations or historical facts;
- store secrets, tokens, passwords, credentials, or sensitive production data;
- use `SESSION_LOG.md` as a hidden reasoning transcript.

---

## 8. Memory Consistency Rules

The following precedence should be used when information conflicts:

1. verified current code/tests/runtime behavior;
2. explicit current project requirements;
3. `CURRENT_STATE.md`;
4. architecture/feature/decision docs;
5. changelog/session history;
6. roadmap/plans.

When a contradiction is found:
- do not silently choose one;
- verify the repository state;
- correct stale canonical documentation;
- record a decision only if a genuine design decision was made.

---

## 9. Managing Documentation Growth

The memory system must remain useful even after hundreds of updates.

### `CURRENT_STATE.md`
Keep concise. Prefer approximately 1–3 screens of high-value context.

### `SESSION_LOG.md`
Keep entries short. When it becomes large:
- archive old entries under `docs/archive/`;
- retain a compact summary of older periods;
- never require an agent to read the entire archive for normal work.

### `CHANGELOG.md`
May grow chronologically, but keep each entry compact.

### `DECISIONS.md`
Keep only consequential decisions. If it becomes large, migrate to:

```text
docs/decisions/
0001-example-decision.md
0002-example-decision.md
```

and turn `DECISIONS.md` into an index.

---

## 10. Git-Aware Memory Behavior

When Git is available:

- inspect `git status` before and after work;
- use Git history to verify historical claims when necessary;
- never overwrite unrelated user changes;
- documentation updates should describe the same logical change as the code change;
- if commit hashes are known and stable, they may be referenced, but docs must remain understandable without them.

Do not assume an uncommitted change was created by the current agent.

---

## 11. End-of-Task Definition of Done

A meaningful task is complete only when:

- [ ] requested code/configuration changes are implemented;
- [ ] relevant validation/tests were run or limitations were stated;
- [ ] `docs/CURRENT_STATE.md` accurately reflects the new state;
- [ ] `docs/CHANGELOG.md` contains the meaningful update when appropriate;
- [ ] `docs/SESSION_LOG.md` contains a concise handoff entry when appropriate;
- [ ] feature/architecture/decision/issue/roadmap docs were updated if affected;
- [ ] no known stale documentation was left behind;
- [ ] no secrets or sensitive data were written into memory files.

---

## 12. Initial Bootstrap Behavior

If `docs/` is missing or empty:

1. inspect the repository before documenting it;
2. create the required files from this protocol;
3. populate facts that can be verified;
4. label unknown areas explicitly instead of guessing;
5. initialize `CURRENT_STATE.md` with the current repository state;
6. initialize `CHANGELOG.md` with a "Documentation memory system initialized" entry;
7. initialize `SESSION_LOG.md` with a bootstrap handoff entry.

Do not spend excessive effort reconstructing ancient history unless the task requires it.

---

## 13. Mandatory Final Check for Every Agent

Before responding to the user after meaningful project work, ask internally:

> "If a new agent starts tomorrow with no conversation history, can it understand the current project state, the important decisions, and what changed today by reading `AGENTS.md` and `docs/`?"

If the answer is no, update the project memory before finishing.
