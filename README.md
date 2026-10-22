<p align="center">
  <img src="./.github/backlog-logo.png" alt="Backlog.md logo" width="120">
</p>

<h1 align="center">Backlog.md</h1>
<p align="center"><strong>Markdown‑native Task Manager &amp; Kanban visualizer for any Git repository</strong></p>
<p align="center">AI agents write the code. You review the tasks: before, during, and after.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/backlog.md"><img src="https://img.shields.io/npm/v/backlog.md?color=brightgreen" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/backlog.md"><img src="https://img.shields.io/npm/dm/backlog.md" alt="npm downloads"></a>
  <a href="https://github.com/MrLesk/Backlog.md/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MrLesk/Backlog.md" alt="MIT license"></a>
  <a href="https://github.com/MrLesk/Backlog.md"><img src="https://img.shields.io/github/stars/MrLesk/Backlog.md?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
<code>npm i -g backlog.md</code>
</p>

![Backlog demo GIF using: backlog board](./.github/backlog-v1.40.gif)


---

> **Backlog.md** turns any folder into a **self‑contained project board**
> powered by plain Markdown files and a zero‑config CLI.

## Why Backlog.md in the AI era

AI agents can now produce more plausible code in an hour than you can carefully read in a day.
The bottleneck is no longer writing code. It's your attention. You can't meaningfully review
15,000 generated lines in one sitting, but you can read a screenful of task specs with acceptance
criteria before any code exists, and push back while a misunderstanding is still one sentence,
not a rebuilt feature.

Backlog.md structures agent work around **three review checkpoints**:

1. **Review the spec:** the agent decomposes your idea into tasks with descriptions, acceptance
   criteria, and milestones before implementation starts.
2. **Review the plan:** the agent researches your codebase and writes its implementation plan
   into the task. Approve it or steer before any code is written.
3. **Review the code:** one task = one context window = one PR. Diffs stay a size a human can
   actually read.

Afterwards, the completed tasks remain in Git as a permanent record of what was attempted and why,
legible to you, your team, and the next agent.

**Dogfooded:** nearly all of Backlog.md's own code is written by AI agents working through
Backlog.md itself. The full task ledger lives in this repo's [backlog folder](backlog/tasks).

📺 **See it in action:** [Devoxx Belgium 2025](https://www.youtube.com/watch?v=LSoDQU_9MMA) · [AI Engineer Code Summit 2025](https://www.youtube.com/watch?v=zMXKhhwiCIc)

## Features

* 🤖 **AI-ready** -- works with Claude Code, Gemini CLI, Codex, Kiro & any other MCP or CLI compatible AI assistant

* 📝 **Markdown-native tasks** -- every task is a plain `.md` file in your repo

* ✅ **Acceptance criteria & Definition of Done** -- verifiable scope per task, plus a reusable DoD checklist for every new task

* 🎯 **Milestones & dependencies** -- structure bigger efforts and make execution order reviewable, with task detail showing what a task waits on and what waits on it

* 📊 **Terminal Kanban** -- `backlog board` paints a live board in your shell; `backlog board export` creates shareable markdown reports

* 🌐 **Web UI** -- `backlog browser` serves a local Kanban board with drag-and-drop and task editing forms

* 🔍 **Search** -- fuzzy search across tasks, docs & decisions with `backlog search`

* 🔒 **Local-first** -- no server, no account, no telemetry; tasks are plain files in your repo, and remote Git operations are optional

* 💻 Cross-platform (macOS, Linux, Windows) · 🆓 MIT-licensed & open-source


---

## <img src="./.github/5-minute-tour-256.png" alt="Getting started" width="28" height="28" align="center"> Getting started

```bash
# Install
npm i -g backlog.md
# or: bun add -g backlog.md
# or: brew install backlog-md
# or: nix run github:MrLesk/Backlog.md

# Initialize in any Git repo
backlog init "My Awesome Project"

# Or initialize without Git for local/non-code projects
backlog init "Personal Planning" --no-git
```

> [!TIP]
> **Trying it without installing?** Use the full package name: `npx backlog.md init "My Project"`, `npx backlog.md board`.

### Run with Nix

Run Backlog.md directly from the repository flake:

```bash
nix run github:MrLesk/Backlog.md -- --version
```

Or install the named package into your Nix profile:

```bash
nix profile install github:MrLesk/Backlog.md#backlog-md
```

The Nix flake supports `x86_64-linux`, `aarch64-linux`, and
`aarch64-darwin`. The x86_64 Linux package uses
[Bun's unified x64 runtime](https://bun.com/docs/installation#cpu-requirements),
with an SSE4.2 minimum and automatic CPU-specific paths. Pre-AVX2 compatibility
is checked under Ivy Bridge emulation. Intel macOS users can use the npm, Bun,
or Homebrew installation instead.

The init wizard will ask how you want to connect AI tools:
- **CLI instructions** (recommended): creates a short instruction file that tells agents to run `backlog instructions overview`.
- **MCP connector**: optionally auto-configures Claude Code, Codex, Gemini CLI, Kiro or Cursor for teams that prefer MCP.
- **Skip**: no AI setup; use Backlog.md purely as a task manager.

For Cursor with CLI instructions, select AGENTS.md or pass `--agent-instructions cursor`; both use the same AGENTS.md target. Backlog.md preserves existing AGENTS.md content and does not migrate or remove unrelated user-managed `.cursor/rules` files.

Everything is stored as human-readable Markdown in a project-local backlog folder such as `backlog/`, `.backlog/`, or a custom project-relative path configured through `backlog.config.yml` (e.g. `backlog_directory: my-backlog`). Task IDs use a configurable prefix (`backlog init --task-prefix`): the default produces `TASK-1`-style IDs, while this repository uses `back`, so examples below show `BACK-1`-style IDs. Git is optional: `backlog init --no-git` creates a filesystem-only project.

> [!TIP]
> **Want an architecture diagram of your repo, kept up to date automatically?** See the [Backlog.md + Groma.md integration](#groma-md) below.

---

## Working with AI agents

This is the recommended flow for Claude Code, Codex, Gemini CLI, Kiro and similar tools, following the **spec‑driven AI development** approach.
After running `backlog init`, agents should start by running `backlog instructions overview`. Work in this loop:

**Step 1: Describe your idea.** Tell the agent what you want to build and ask it to split the work into small tasks with clear descriptions and acceptance criteria.

**🤖 Ask your AI Agent:**
> I want to add a search feature to the web view that searches tasks, docs, and decisions. Please decompose this into small Backlog.md tasks.

> [!NOTE]
> **Review checkpoint #1:** read the task descriptions and acceptance criteria.

**Step 2: One task at a time.** Work on a single task per agent session, one PR per task. Good task splitting means each session can work independently without conflicts. Make sure each task is small enough to complete in a single conversation. You want to avoid running out of context window.

**Step 3: Plan before coding.** Ask the agent to research and write an implementation plan in the task. Do this right before implementation so the plan reflects the current state of the codebase.

**🤖 Ask your AI Agent:**
> Work on BACK-10 only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.

> [!NOTE]
> **Review checkpoint #2:** read the plan. Does the approach make sense? Approve it or ask the agent to revise.

**Step 4: Implement and verify.** Let the agent implement the task.

> [!NOTE]
> **Review checkpoint #3:** review the code, run tests, check linting, and verify the results match your expectations.

Mark verified work Done (or the configured final status). During periodic cleanup, `backlog task archive` moves it off the board; the same command takes canceled, duplicate, or invalid work off the board at any time. An archived task keeps its ID, record, and dependency links, stays readable with `backlog task view`, and is read-only. `backlog task restore` brings an archived task back to the board with the same ID. To remove a task for good, archive it and then run `backlog task delete`, which releases its ID once no other branch or worktree still holds the task.

If the output is not good enough: clear the plan/notes/final summary, refine the task description and acceptance criteria, and run the task again in a fresh session.

---

## Working without AI agents

Use Backlog.md as a standalone task manager from the terminal or browser.

```bash
# Create and refine tasks
backlog task create "Render markdown as kanban"
backlog task edit BACK-1 -d "Detailed context" --ac "Clear acceptance criteria"

# Track work
backlog task list -s "To Do"
backlog task list --json | jq '.tasks[] | .id'
backlog task edit BACK-1 --comment "Can we split the UI work into a separate PR?" --comment-author @sara
backlog search "kanban"
backlog board

# Work visually in the browser
backlog browser
```

You can switch between AI-assisted and manual workflows at any time; both operate on the same Markdown task files. Just prefer Backlog.md commands (CLI/MCP/Web) over hand-editing task files, so field types and metadata stay consistent.

Read commands support stable, versioned JSON for scripts and integrations. Use `--json` with `task list`, `task view`, the `task <id>` shorthand, and `search`. JSON mode is noninteractive and keeps successful stdout machine-readable. Add `--watch` to `task list --json` for an initial full list followed by changed full replacements, using the exact same JSON format. Read successive complete JSON values; each response replaces the previous list.

**Learn more:** [CLI reference](CLI-INSTRUCTIONS.md) | [Advanced configuration](ADVANCED-CONFIG.md)

---

<a id="groma-md"></a>

## 🗺️ Backlog.md + Groma.md

Backlog.md keeps the spec, the plan and the code reviewable. [Groma.md](https://groma.md) adds the
architecture: it scans your repository into a C4 map that you or your coding agent curate, stored next
to your code as an [Open Knowledge Format 0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
bundle. It reads your Backlog.md tasks, so the two work well together:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/groma-map-dark.webp">
  <img src="./.github/groma-map-light.webp" alt="Backlog.md's own architecture in Groma.md: Backlog.md tasks pinned to the components they touch, with one task selected and its acceptance criteria open" width="100%">
</picture>

* 📍 **Tasks on the map** -- every task is pinned to the components it touches, so you see where the work lands in your system, not only in a list

* 👀 **Who is doing what** -- with several agents at work, the map shows where each one is busy

* 🔍 **Review a task by its architecture** -- select a task to highlight the components it touches and inspect its changes without leaving the map

* 📦 **Open Knowledge Format 0.2** -- one Markdown document per element, so the map stays portable and readable without Groma.md

* 📝 **Still plain files** -- both run locally, need no account, and keep everything as Markdown in your repo

Groma.md is a separate install, and Backlog.md works fine without it. To add the map to a repo that
already uses Backlog.md:

```bash
npm i -g groma.md
groma web
```

Backlog.md uses it on itself: every push to main updates its map, and every pull request gets a comment
showing what it changes in the architecture.

👉 **[Get started at groma.md](https://groma.md)**

🗺️ **[Explore Backlog.md's own architecture, live](https://mrlesk.github.io/Backlog.md/architecture/auto/)**

---

## <img src="./.github/web-interface-256.png" alt="Web Interface" width="28" height="28" align="center"> Web Interface

Launch a web interface for visual task management on the local machine. The server listens on `127.0.0.1` and is not
reachable from other devices on the LAN or VPN:

```bash
# Start the web server (opens browser automatically)
backlog browser

# Custom port
backlog browser --port 8080

# Don't open browser automatically
backlog browser --no-open
```

**Features:**
- Interactive Kanban board with drag-and-drop
- Multi-select cards to move several tasks to one column
- Task creation and editing with forms
- Interactive acceptance criteria editor with checklists
- Real-time updates across all views
- Responsive design for desktop and mobile
- Task archiving with confirmation dialogs
- Seamless CLI integration - all changes sync with markdown files

![Web Interface Screenshot](./.github/web.jpeg)

To keep the Web UI running as an auto-starting local service, see [Running Backlog.md as a Service](backlog/docs/doc-003%20-%20Running-Backlog-Browser-as-a-Service.md).

### Server project records

This fork provides persistent project registration as the foundation for its central project tracking application.
Choose an explicit data directory for the server's `server.sqlite` database:

```bash
backlog server --data-dir ./server-data project register /path/to/project --name "Example"
backlog server --data-dir ./server-data project preview /path/to/project --name "Example" --json
backlog server --data-dir ./server-data project list --json
backlog server --data-dir ./server-data project view 1
backlog server --data-dir ./server-data user init-admin admin
backlog server --data-dir ./server-data start --port 6420 --public-url https://backlog.example.com
```

Registration records an existing Backlog project's directory without modifying its Markdown or configuration.
The display name belongs to the server record; the numeric project ID is persistent and separate from tasks' `project` field.
Duplicate directory aliases and overlapping project roots are rejected. Paths resolve from the terminal working directory;
`BACKLOG_CWD` does not select server data or projects. Standard, hidden, and configured custom Backlog directories are supported.

All three commands accept `--json`. Single-record responses use `{ schemaVersion: 1, kind: "server-project", project }`;
lists use `{ schemaVersion: 1, kind: "server-project-list", projects }`. A project contains `id` (string), `name`, `rootPath`,
`createdAt` (UTC), and `tracking` (boolean). Reads return stored metadata, including untracked projects and when the source directory is unavailable. Reading a missing
database produces an empty list or a not-found error without creating files. Invalid databases are reported without being rebuilt.

`start` listens on `127.0.0.1` at port `6420` by default and opens a browser only with `--open`. Visit `/projects` to
select a registered project; project switching reloads the page. The selected board and its existing screens use
`/projects/<id>/...`, with data under `/api/projects/<id>/...` and attachments under `/api/projects/<id>/assets/...`.
Central mode reads tasks only from each registered working directory. Its settings screen edits the default status,
Definition of Done, date format, empty-column visibility, and maximum column width. Git fetch, cross-branch task merging,
automatic commits, and status commands are disabled in this mode. The existing `backlog browser` command keeps its local
behavior.

The project selector offers **Register project** to administrators and users with personal folder areas. Projects must
already be configured separately with Backlog.md. Preview shows the selected configuration, record counts and issues;
registration never creates a Backlog structure or changes source Markdown/configuration. Invalid configuration and unsafe
paths prevent registration; individual malformed records and identity collisions appear as warnings. A preview does not
reserve a project or grant permission: registration checks the current session, account, folder area, paths and existing
project roots again. The project and its creator's standard membership are recorded in one SQLite transaction.

Administrators manage personal areas and tracking in **Users**, or through the local CLI:

```bash
backlog server --data-dir ./server-data folder-area set <userId> /srv/projects/alice --json
backlog server --data-dir ./server-data folder-area list --user <userId> --json
backlog server --data-dir ./server-data folder-area remove <areaId> --json
backlog server --data-dir ./server-data project tracking 1 --enabled false --json
backlog server --data-dir ./server-data project tracking 1 --enabled true --json
```

A personal area permits registration inside its canonical directory; different users' areas cannot overlap. Removing an
area affects future registration and preserves existing memberships. Administrators can register directories accessible
to the server's service account. All project files, including configuration, records and attachments, must resolve inside
the same project root. Central reads check opened files as well as paths, so changed symbolic links cannot publish outside
content through an index, cache or live connection. The central server's guarded file reader targets the supported Linux
server environment.

Stopping tracking hides a project from the normal selector and closes its API, page and live access. The admin list and
CLI metadata commands retain it. Resuming tracking validates the prepared directory again and preserves its ID and
memberships. Source directories and files stay unchanged in both operations. New registrations also reserve untracked
project roots against duplicates and overlaps.

The existing cookie, Origin and CSRF requirements apply to these API operations:

| Operation | Request | Result |
| --- | --- | --- |
| Preview | `POST /api/projects/preview` with `{name,path}` | Configuration, counts, issues, `canRegister` |
| Register | `POST /api/projects` with `{name,path}` | Project metadata (201); identity comes from the session |
| Registration access | `GET /api/projects/registration` | `{allowed,areas}`; only the current user's areas |
| Admin areas | `GET/POST /api/admin/folder-areas`; POST `{userId,path}` | Area list or assigned area |
| Remove area | `DELETE /api/admin/folder-areas/:id` | `{success:true}` |
| Admin projects | `GET /api/admin/projects` | Tracked and untracked project metadata |
| Change tracking | `PUT /api/admin/projects/:id/tracking` with `{tracking:boolean}` | Updated project metadata |

API errors keep `{error:string}`. Unauthorized folders return 403 without disclosing other project names or paths;
duplicates/overlaps return 409, invalid prepared projects 400, and unavailable authorized project content 503. Untracked,
hidden and missing projects return 404 on normal project routes. Preview CLI JSON uses
`{schemaVersion:1,kind:"server-project-preview",preview}`; folder-area JSON uses `server-folder-area` (field `area`),
`server-folder-area-list` (field `areas`) and `server-folder-area-remove` (field `id`). Local management commands run with
the invoking service account's access; remote user registration uses the authenticated API.

### Server accounts and permissions

Create the first administrator locally with `user init-admin <username>`. Passwords come from a hidden terminal prompt,
or from `--password-stdin` for automation; never pass a password in a command argument. Initial and reset passwords require
replacement on the next login. Every self-service password change requires a different password; reusing the current
password returns HTTP 400 without changing the account or its sessions. Usernames are immutable, normalized to lowercase,
and accept 3–64 characters from
`a-z`, `0-9`, `.`, `_`, and `-`. Passwords accept 15–128 characters, preserving spaces, and use Bun Argon2id
with 19456 KiB memory and two iterations. See [Bun hashing](https://bun.sh/docs/runtime/hashing) and the
[OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

```bash
backlog server --data-dir ./server-data user create alice
backlog server --data-dir ./server-data user list --json
backlog server --data-dir ./server-data user view <userId> --json
backlog server --data-dir ./server-data user edit <userId> --display-name "Alice" --active false
backlog server --data-dir ./server-data user reset-password <userId>
backlog server --data-dir ./server-data project member set 1 <userId>
backlog server --data-dir ./server-data project member list 1 --json
backlog server --data-dir ./server-data project member remove 1 <userId>
```

Use command help for role and individual permission flags. Management commands support versioned `schemaVersion: 1`
JSON. Accounts are deactivated rather than deleted; the last active administrator cannot be deactivated or demoted.
Administrators automatically access every project and operation. A membership gives a normal user read access and, by
default, task/draft/milestone editing, document editing, and proposed-decision editing. Decision management, archive/restore,
and permanent deletion require separate grants. All decision status changes and edits to decisions beyond `proposed`
require decision management as well as decision editing. Settings, access management, and identity repair require admin.
The Users and Project access screens expose the same management operations.

The listener stays on `127.0.0.1`; place it behind an HTTPS reverse proxy and set `--public-url` to its exact public origin.
The URL must contain no credentials, path, query, or fragment. For local development only, use an explicit loopback origin:

```bash
backlog server --data-dir ./server-data start --public-url http://127.0.0.1:6420 --allow-http-loopback
```

Startup requires an initialized admin. An existing A-01 SQLite database upgrades additively on its first mutation;
read commands neither create files nor upgrade schemas. Project identities and Markdown records are preserved.
Invalid databases fail clearly. Further recovery uses the local `user reset-password` command; `init-admin` cannot run again.

Sessions live in SQLite with hashed identifiers and a 12-hour absolute / 2-hour idle limit. The browser carries its identifier
only in an HttpOnly, SameSite=Lax cookie, with Secure on HTTPS, Path=/, and no Domain. Only visible user interactions send
idle activity, at most once a minute; polling and WebSocket traffic do not extend the idle limit. Resetting a password or
deactivating an account invalidates its sessions. Changing your own password invalidates old sessions and rotates the current
browser's cookie. Logging out asks before discarding unsaved edits; canceling or a failed logout preserves the editor.
Login accepts JSON from the exact configured Origin; authenticated mutations require the session's
in-memory `X-CSRF-Token`. Login is limited to five failures per username in 15 minutes and 60 service-wide attempts per minute,
persisted across restarts; limited requests return 429 and Retry-After. See the
[OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and
[CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

The API returns 401 for invalid sessions, 403 for denied operations, and 404 for unknown or unjoined projects. Permissions
apply to searches, statistics, attachments, archive operations, and live connections. WebSockets recheck before every send
and close within one second after revocation. API permission changes take effect on the next check. Writes recheck current
grants immediately before durable intent; an operation already past that point may finish.

Project archives list tasks, documents, and decisions and allow viewing, restoring, or permanently deleting an archived record.
Deletion requires explicit confirmation naming the record and refuses active records or tasks with existing subtasks.
Reference cleanup and affected-record information follow the existing CLI/Core behavior. The API exposes
`GET /api/projects/:id/{tasks|docs|decisions}/archived`, `POST .../:recordId/restore`, and `DELETE .../:recordId`.
Mutations are never automatically retried. On session expiry an open editor retains unsaved text in the current page's
memory; logging in with the same account resumes it, while switching accounts clears the previous account's UI state.

### Server writes and history

Markdown remains the source of record content. The same `server.sqlite` stores stable internal record keys, durable write
intent, safe operation results, and immutable history. Initial attachment records one inventory event and preserves source
dates; it does not infer when an old completed task was finished. New event times are UTC.

Central task, draft, document, decision and milestone responses carry `recordKey` and an opaque `revision` bound to the
same content snapshot. These values are not written to frontmatter. Configuration uses an `ETag`; task list/search responses
also carry `X-Backlog-Tasks-Revision` for the full active task collection, including ordering. Local `backlog browser` retains
its existing protocol.

After the initial inventory, a guarded read can register a newly discovered local file path with a new record key, so CLI/MCP
additions remain readable. Unmatched external moves also receive a new key. These identity entries do not invent history
events; external move recognition and continuous external-change history remain in the next stage. Discovery is paused
while that project has pending recovery.

Central content writes and non-password management writes require a client-generated UUID `Idempotency-Key`. Updates,
archive/restore, and deletes also send the revision they read as `If-Match`; creates need only the operation key. Bulk move
and reorder send `expectedRevisions` keyed by `recordKey`; reorder additionally sends the collection revision as `If-Match`.
Cleanup and duplicate repair retain their preview fingerprint checks. Folder-area upsert creates a grant or returns the same
existing grant, so it needs no revision; removal does. The server uses the existing Core validation and serializers and
records the complete file plan before applying it. Result and history finalize before success or live publication.

Repeating the same key, actor, scope and request returns the stored result. Reusing a key for another request fails. The browser
preserves a dirty editor's starting revision through background refresh, and queries `GET /api/operations/:operationId` after
an uncertain network result. This endpoint requires the operation owner or an administrator and current project/admin access.
It reports `pending`, `completed`, `not_applied`, or `recovery_required` and a safe result when available. Mutations are not
automatically retried. Password-bearing user creation, reset and change retain their session behavior and receive safe audit
only; password bytes and password request hashes never enter operation history. Login/logout/activity are outside replay.

Mutation errors add a machine-readable `code` to `{error}`:

| Status | Code | Meaning |
| --- | --- | --- |
| 428 | `PRECONDITION_REQUIRED` | Missing operation key or required revision |
| 409 | `REVISION_CONFLICT` | The edit snapshot is stale; the user's draft is preserved |
| 409 | `AMBIGUOUS_ID` / `WRITE_LOCKED` | Identity is ambiguous or the shared file lock is held |
| 409 | `IDEMPOTENCY_KEY_REUSED` | This key belongs to a different request, actor, or scope |
| 409 | `OPERATION_IN_PROGRESS` / `OPERATION_NOT_APPLIED` | Check the recorded operation before another action |
| 409 | `OPERATION_RESOLVED` | An interrupted operation was resolved separately; review current data before another action |
| 503 | `RECOVERY_REQUIRED` | The project is temporarily read-only pending inspection |

Project history is available at `GET /api/projects/:id/history?recordKey=&kind=&cursor=&limit=`. Administrators read management
history at `GET /api/admin/history` (`scope=registration` selects registration audit). Pages contain `{items,nextCursor}`;
limits are 1–100. One logical write produces one event containing all record changes; a no-op can store its result without
adding a change event. Project history excludes private management paths and permissions. CLI management changes record an
unknown local operator with source `server-cli` rather than claiming a web identity.

```bash
backlog server --data-dir ./server-data history list --project 1 --json
backlog server --data-dir ./server-data operation view <operationId> --json
backlog server --data-dir ./server-data recovery list --json
backlog server --data-dir ./server-data recovery view <operationId> --json
backlog server --data-dir ./server-data recovery resolve <operationId> --accept-observed --expected-fingerprint <hash> --json
```

Startup compares pending intent with the files. All-before becomes `not_applied`; all-after finalizes its recorded result and
single event. Mixed or unreadable state blocks that project's central writes while healthy projects continue. Recovery reports
show paths, hashes and a current fingerprint. Accepting the observed state rechecks the fingerprint, parsers, identities and
path boundaries, then adds a separate recovery event; the original operation remains unsuccessful and links to `resolvedBy`.
There is no automatic partial replay or rollback. The project response exposes `writeState: ready | recovery_required`, and
the browser shows the read-only state.

The first server version supports one Linux application instance. Shared locks and revision checks protect cooperating
writers; a writer that ignores those locks can race a physical write. Continuous external-change attribution and server-connected
agent credentials belong to the next stage; full history and user acceptance screens follow separately.

---

## 🔧 MCP Integration (Model Context Protocol)

CLI instructions are the default AI setup. MCP remains supported for AI coding assistants like Claude Code, Codex, Gemini CLI and Kiro when you explicitly prefer an MCP connector.
You can run `backlog init` (even if you already initialized Backlog.md) and choose MCP integration, or follow the manual steps below.

### Client guides

<details>
  <summary><strong>Claude Code</strong></summary>

  ```bash
  claude mcp add backlog --scope user -- backlog mcp start
  ```

</details>

<details>
  <summary><strong>Codex</strong></summary>

  ```bash
  codex mcp add backlog -- backlog mcp start
  ```

</details>

<details>
  <summary><strong>Gemini CLI</strong></summary>

  ```bash
  gemini mcp add backlog -s user backlog mcp start
  ```

</details>

<details>
  <summary><strong>Kiro</strong></summary>

  ```bash
  kiro-cli mcp add --scope global --name backlog --command backlog --args mcp,start
  ```

</details>

<details>
  <summary><strong>Cursor / other MCP clients</strong></summary>

  Use the manual JSON config below in your client's MCP settings.

</details>

Use the shared `backlog` server name everywhere. The server finds the active project from your client's MCP roots, and re-resolves when you switch workspace or worktree. A single user-scope server covers every repo.

<details>
  <summary><strong>Manual config</strong></summary>

```json
{
  "mcpServers": {
    "backlog": {
      "command": "backlog",
      "args": ["mcp", "start"],
      "env": {
        "BACKLOG_CWD": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Set `BACKLOG_CWD` to pin the server to one project and stop workspace following. Use it to always target the same backlog, or when your client can't report MCP roots.
If your IDE supports custom args but not env vars, you can also use `["mcp", "start", "--cwd", "/absolute/path/to/your/project"]`.
Until the server finds an initialized project, it serves `backlog://init-required`.

</details>

> [!IMPORTANT]
> When adding the MCP server manually, add a short instruction to your CLAUDE.md/AGENTS.md files telling agents to read `backlog://workflow/overview`.
> This step is not required when using `backlog init` as it adds these instructions automatically.
> For CLI-based setups, use `backlog instructions overview` to fetch the current workflow guidance.


Once connected, agents can read the Backlog.md workflow instructions via `backlog://workflow/overview`, with detailed guides at `backlog://workflow/task-creation`, `backlog://workflow/task-execution`, and `backlog://workflow/task-finalization`.
Use `/mcp` command in your AI tool (Claude Code, Codex, Kiro) to verify if the connection is working.

---

## <img src="./.github/cli-reference-256.png" alt="CLI Reference" width="28" height="28" align="center"> CLI reference

Full command reference covering task management, search, board, docs, decisions, and more: **[CLI-INSTRUCTIONS.md](CLI-INSTRUCTIONS.md)**

Quick examples: `backlog`, `backlog instructions`, `backlog task create`, `backlog task list`, `backlog task edit`, `backlog milestone add`, `backlog milestone rename`, `backlog milestone remove`, `backlog search`, `backlog board`, `backlog browser`.

Full help: `backlog --help`

---

## <img src="./.github/configuration-256.png" alt="Configuration" width="28" height="28" align="center"> Configuration

Backlog.md works with zero configuration. Settings merge from CLI flags, then the project config file (`backlog.config.yml` when present, otherwise `backlog/config.yml` or `.backlog/config.yml`), then built‑in defaults.

Run `backlog config` with no arguments to launch the interactive wizard (the same experience triggered from `backlog init` advanced setup). It walks through cross-branch accuracy (`checkActiveBranches`, `remoteOperations`, `activeBranchDays`), Git workflow (`autoCommit`, `bypassGitHooks`), ID formatting (`zeroPaddedIds`), editor integration (`defaultEditor`), Definition of Done defaults, and Web UI defaults (`defaultPort`, `autoOpenBrowser`). Skipping the wizard applies the safe built-in defaults, and rerunning `backlog init` or `backlog config` pre-populates prompts with your current values.

For filesystem-only projects (`backlog init --no-git`), the saved config forces `checkActiveBranches=false`, `remoteOperations=false`, and `autoCommit=false` so CLI, Web, and MCP local-file workflows do not depend on a Git repository.

### Definition of Done defaults

Set project-wide DoD items with `backlog config` (or during `backlog init` advanced setup), in the Web UI (Settings → Definition of Done Defaults), or by editing the project config file directly:

```yaml
definition_of_done:
  - Tests pass
  - Documentation updated
  - No regressions introduced
```

When a project uses root config discovery, edit `backlog.config.yml` instead of `backlog/config.yml`.

These items are added to every new task by default. You can add more on create with `--dod`, or disable defaults per task with `--no-dod-defaults`.

For the full configuration reference (all options, default values, commands, and detailed notes), see **[ADVANCED-CONFIG.md](ADVANCED-CONFIG.md)**.

---

## Troubleshooting

### Apple Silicon (macOS)

On M-series Macs, `backlog` can fail with `illegal hardware instruction` or `Binary package not installed for darwin-...` when Node, Bun, or Homebrew run under Rosetta (x64 emulation) and install the Intel binary instead of the arm64 one — or the other way around. The launcher runs whichever darwin variant (arm64 or x64) is actually installed, but a clean native-arch install is the reliable fix.

Check what your tools report:

```bash
uname -m                            # arm64 = Apple Silicon hardware; x86_64 = Intel or a Rosetta shell
node -p process.arch                # architecture of your Node/Bun runtime
sysctl -in sysctl.proc_translated   # 1 = current shell runs under Rosetta
which brew                          # /opt/homebrew = arm64 brew, /usr/local = Intel brew
```

If the architectures disagree, reinstall with the native one:

```bash
# Homebrew: make sure `which brew` prints /opt/homebrew, then
brew reinstall backlog-md

# npm
arch -arm64 npm i -g backlog.md

# Bun
arch -arm64 bun add -g backlog.md
```

Running an x64 Node under Rosetta on purpose also works: `backlog` falls back to whichever `backlog.md-darwin-*` package is present.

---

## 📺 Talks & Community

Watch Backlog.md in action:

- **Devoxx Belgium 2025**: [the spec-driven agent workflow behind Backlog.md, live on stage](https://www.youtube.com/watch?v=LSoDQU_9MMA)
- **AI Engineer Code Summit 2025**: [Backlog.md: task management for AI agents](https://www.youtube.com/watch?v=zMXKhhwiCIc)
- Slides from these and more talks: [mrlesk.com/talks](https://mrlesk.com/talks)

### Community tools

- **[vscode-backlog-md](https://marketplace.visualstudio.com/items?itemName=ysamlan.vscode-backlog-md)** - VS Code extension with issues panel, kanban view, and editing. ([ysamlan/vscode-backlog-md](https://github.com/ysamlan/vscode-backlog-md))

---

## License

Backlog.md is released under the **MIT License**: do anything, just give credit. See [LICENSE](LICENSE).
