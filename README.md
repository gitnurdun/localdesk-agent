# LocalDesk 0.2 — local Chat & Work

## Clone and configure

Requires an existing Node.js 22+ installation, Ollama, and a local model. No npm dependencies are required.

```powershell
git clone https://github.com/gitnurdun/localdesk-agent.git
cd localdesk-agent
Copy-Item config.example.json config.json
node src/cli.mjs serve
```

Choose any additional read/write folders explicitly in your local `config.json`. Local chats, task data, workspaces, backups, and machine-specific configuration are excluded from Git.

A JavaScript assistant around your installed `qwen3:1.7B` in Ollama. It has a persistent conversation interface, an action mode, local tools, skills, MCP connections, document retrieval, memory and scheduled work. It is inspired by the workflow of coding assistants, not a clone or a promise of frontier-model reasoning.

No packages, new models or extra runtimes were installed. It uses Node.js 22+ and your existing programs.

## Start here

Project folder:

```text
C:\path\to\localdesk-agent
```

Double-click **Start LocalDesk.cmd**. It starts a hidden background server, reuses an existing instance, and opens **http://127.0.0.1:4317** in your browser. The launcher window can close. **Stop LocalDesk.cmd** stops the dashboard; Ollama remains available. **Chat LocalDesk.cmd** opens the terminal interface.

A background dashboard may already be running from setup. The launcher detects and reuses it instead of starting another instance on the same port.

From PowerShell in this folder:

```powershell
node src/cli.mjs serve
node src/cli.mjs chat
node src/cli.mjs run "Inspect my CPU, RAM and GPU."
node src/cli.mjs doctor
```

## Chat and Work

Create a conversation from the left sidebar. Both modes put user messages, answers and results in the same saved chat list.

- **Chat**: streaming discussion, explanations, conversation follow-ups, optional indexed documents, attachments and web context. It does not execute model-selected computer tools.
- **Work**: decide whether an action or current evidence is needed, select a few relevant tools, execute one action at a time, and show activity, results, backup IDs and file downloads below the answer. A greeting or a general explanation can be answered directly without unnecessary tools.
- **Stop / Continue**: cancel active or queued work; continue an interrupted or blocked task with its previous evidence.
- **Rename / archive / export**: manage conversations and export their messages as Markdown.
- **Compact context**: the ≋ button refreshes a bounded excerpt summary without deleting any messages. Longer conversations also compact automatically.

Enter sends; Shift+Enter adds a line. The **Knowledge**, **Web** and skill controls apply to the next message and are remembered for that conversation. Attach up to five documents, each at most 5 MB; uploaded copies go to `workspace/uploads/`.

Try:

```text
Chat: Explain what a local language model is in two sentences.
Work: Inspect my CPU, RAM, free disk space and GPU.
Work: Create hello.txt containing exactly: Hello local world
Work: Read budget.txt. Use calculate to sum the amounts. Save the total in total.txt.
Work: Replace "old title" with "new title" in notes.md, then read it back.
Work: Convert notes.md to notes.docx.
Work: Extract pages 1-3 from report.pdf to short-report.pdf.
Work: Find duplicate files in my workspace. Report them without deleting anything.
Work: Delegate a system specialist to inspect CPU and RAM, then summarize its findings.
```

Be explicit about filenames, desired changes and the expected output. Very large or vague assignments still require smaller tasks.

## Skills

Open **Skills** to create, edit or disable reusable owner instructions. Select a skill in the composer, mention `$skill-id`, or configure trigger phrases. At most two skills are selected for one task.

Skills live in:

```text
extensions/skills/<skill-id>/skill.json
extensions/skills/<skill-id>/SKILL.md
```

Three starter skills are included: precise file work, source-grounded answers and brief answers. Skills are instructions, not executable packages. The model can read a selected Work skill in pages. Short Chat skills fit directly into context; keep them concise.

Example metadata:

```json
{
  "name": "Brief answers",
  "description": "Concise conversational replies",
  "triggers": ["brief reply"],
  "modes": ["chat", "work"],
  "toolGroups": [],
  "enabled": true,
  "responseStyle": { "maxSentences": 1, "maxCharacters": 300 }
}
```

The optional responseStyle limits are enforced on the final response. The controller also recognizes the simple instruction "exactly one short sentence". Other skill instructions guide the model but are not guaranteed to be followed perfectly. Skill toolGroups are metadata for extension authors; they do not grant permissions or install tools.

## MCP connections

Open **Connections** to add an existing server. New connections are saved disconnected; inspect the configuration, then press Connect.

Supported transports: newline JSON-RPC **stdio** and **Streamable HTTP** (JSON or SSE replies). Protocol versions 2025-06-18 and 2025-03-26 are accepted. A bundled local-clock server demonstrates genuine discovery and tool calls without installing anything.

Example stdio configuration, using an already installed executable:

```json
{
  "id": "my-server",
  "name": "My MCP server",
  "transport": "stdio",
  "command": "C:/Program Files/nodejs/node.exe",
  "args": ["C:/path/to/your/server.mjs"],
  "allowedTools": ["search_notes"],
  "writeTools": [],
  "env": {}
}
```

Example HTTP configuration:

```json
{
  "id": "my-http-server",
  "name": "My HTTP server",
  "transport": "http",
  "url": "http://127.0.0.1:3000/mcp",
  "allowedTools": ["search_notes", "create_note"],
  "writeTools": ["create_note"],
  "headers": {}
}
```

Use exact allowedTools names. An empty list grants no tools; "*" grants all discovered tools and should be used cautiously. Mark every mutating tool in writeTools. Such tools also require an original user request that authorizes a write. Naming an MCP tool in your request helps a tiny model select it.

Only connect trusted servers: they run or communicate with the privileges you grant them, and a dishonest server can misdescribe a write as a read. LocalDesk's file boundaries do not sandbox an external MCP process. Server secrets in env/headers stay in local configuration, not the connection status panel, but this storage is not encrypted.

Remote endpoints require HTTPS; loopback HTTP is allowed. Absolute installed executables are required for stdio. Automatic npx/npm package installation is not supported. OAuth, legacy HTTP+SSE, server-initiated sampling, and every MCP extension are not implemented. HTTP MCP currently uses Node's network connection, so a remote endpoint may need suitable network settings.

## Knowledge and memory

Open **Knowledge** to index a file or folder within your read roots, search passages, or remove a document from the index. The model uses a few relevant chunks, with source paths and labels such as [S1].

Retrieval is BM25-like lexical scoring with Chinese bigrams, not vector embeddings. No vector database or second model is needed. It is fast and local, but synonyms and paraphrases can be missed. Index entries are snapshots: reindex changed documents. Responses show source links even when the model omits an inline label. Invented numbered citation markers are removed from final answers; a supplied citation does not prove every claim is correct.

Open **Memory** to add or forget facts and preferences that should survive separate conversations. Model-created notes keep an unverified provenance label. Relevant notes are retrieved selectively. Conversation history, older user statements, summaries, task plans and tool evidence provide short-term continuity without placing the full archive in the prompt.

Forgetting a note does not remove old conversations or audit logs containing it. Do not store secrets. Data is not separately encrypted from Windows.

## Web search

The Web toggle sends a concise query to the configured provider; it does not send all your conversation history or attachments. Still, a query can contain private details from the current message, so leave Web off for sensitive requests.

- **DuckDuckGo public search**: no key required; returns source links. The live connection on this computer presented a bot challenge during validation. The app reports this as a context/tool error instead of claiming search succeeded.
- **SearXNG**: configure an existing instance in Settings. Its JSON search format must be enabled. Loopback HTTP or remote HTTPS is supported. No SearXNG software was installed.
- **Web read**: a Work tool can extract bounded text from a public HTTPS page. Private addresses, credential-bearing URLs, nonstandard ports and unchecked redirects are rejected.

On Windows, page/search requests reuse the enabled system proxy through installed curl when needed. The application never changes your proxy settings or disables certificate checks. Provider availability and site restrictions still apply. Search snippets are not verified full-page evidence.

Local inference remains in Ollama. Optional web requests and remote MCP servers are the only deliberately configured network features; disable them for local-only operation.

## Local tools

| Area | Implemented tools |
|---|---|
| Files | List, read, page, literal search, create, exact replacement, copy, move, recoverable trash and restore |
| Organization | Folder size, largest files, SHA-256 duplicate detection |
| Documents | PDF/DOCX/ODT/EPUB/RTF text extraction; Pandoc conversion; qpdf inspection, extraction and merging |
| Git Bash | Count, sort, head/tail, hash; filter/sort/unique pipelines |
| Development | Git status/log/diff, installed-tool discovery, owner-configured executable recipes |
| Computer | CPU/RAM/disk, labeled NVIDIA GPU readings, process memory, software inventory, disk/Defender/battery health |
| Research | Document indexing/retrieval, public search and HTTPS text pages |
| Coordination | Plans, receipts, specialist workers, serial queue, cancel/resume, one-time and interval schedules |

There is no unrestricted model-authored shell tool. Installed CLI programs are reached through narrow, validated operations. To expose another command, add an owner-controlled recipe to config.json or connect a trusted MCP server.

## Scheduled work

Open **Scheduled work** to create a one-time task or a repeating interval, choose Chat or Work, pause/enable it, and open its result conversation.

In the browser's Work mode, you can also ask "Schedule a CPU and RAM report every 60 minutes" or "List my scheduled tasks". Scheduling tools are exposed only for relevant requests. Prefer the time picker for precise dates: tiny models can misinterpret natural-language dates, so check the saved next-run time before relying on it.

Results appear as ordinary user/assistant messages, not just a background log. Schedules are persisted, but run only while LocalDesk's server is running. No Windows startup task was installed. Missed intervals are skipped rather than replayed in a burst; a due one-time task runs after the server returns. Times are displayed in Asia/Shanghai. Avoid scheduling destructive or externally consequential actions.

Scheduled jobs cannot create more scheduled jobs. The future prompt must describe the work to perform, not repeat the instruction to schedule it.

## Small-model speciality: controller-assisted work

The design spends code on reliable mechanics and model context on the next decision:

1. Separate discussion from actions before presenting a tool catalog.
2. Record the full task on disk; pre-read explicitly named text inputs.
3. Select a small tool catalog rather than presenting every tool at once.
4. Use schema-constrained actions and deterministic argument validation.
5. Narrow mandatory tool choices and hide completed probes while others remain.
6. Check recognized output files and requested tools before accepting completion.
7. Save full receipts on disk; carry only compact recent evidence and verified facts.
8. Give specialists isolated contexts and require their evidence to return to the main task.
9. Preserve older user statements in bounded conversation summaries and retrieve relevant long-term notes.
10. Bound steps, repeated actions, output size, timeouts and delegation.

Workers share one model and run serially. This avoids competing copies on your 4 GB GPU. It improves narrow-task consistency; it cannot give a tiny model the general reasoning ability of a frontier model. Read the visible receipts when correctness matters.

## Access and recovery

Relative paths resolve inside workspace/. Reading is initially allowed in this user's Desktop, Documents and Downloads; writes, renames and trash are limited to workspace/. Edit specific readRoots/writeRoots in config.json and restart to grant another folder. Avoid granting entire drives.

The agent cannot alter its control files, trusted skills/extensions, configuration, internal data or history snapshots through its tools. Credential folders, junction/symlink escapes, Windows device paths, UNC paths and alternate streams are blocked.

Existing edits require a fresh read and unique exact replacement, then backup and verification. To undo, ask: `Restore backup <ID>`. Restoring saves another backup of the current version. Recoverable trash handles one file, not a recursive directory purge. A move backs up its source; restoring that backup recreates the source while leaving the destination intact.

These are **application-level checks, not an OS sandbox**. Custom recipes and MCP processes execute with your normal account privileges. The local server binds only to 127.0.0.1, checks Host/Origin, and requires a session token. Do not expose its port to a network.

A conservative original-request scope check prevents read-only requests from gaining writes through a document or worker prompt. It understands English and selected Chinese verbs, not every phrasing. Clarify the intended action rather than weakening safety checks.

## Context and model

Default: **8,192 context tokens**, **1,200 output tokens**, thinking disabled, one active task at a time. Configurations at or above 32,000 are rejected. UTF-8 byte packing plus reserves keeps model prompts bounded; long files and evidence are paginated.

The installed tag says qwen3:1.7B, but metadata reports 2,031,739,904 stored parameters. This explicitly requested installed model is retained. Other configured models over 2 billion parameters are rejected. Nothing automatically pulls models. The default keep-alive is 10 minutes.

## Files and extension recipes

```text
local_agent/
  src/                        Agent, tools, storage, routing, MCP and server
  public/                     Chat & Work interface
  extensions/skills/          Owner instructions
  extensions/mcp/             Bundled example server
  scripts/                    Real-model evaluations
  test/                       Automated checks
  workspace/                  Writable working files and uploaded documents
  data/
    conversations/            Full chat history and compact summaries
    tasks/<id>/               Task state and full JSONL receipts
    memory/                   Facts, episodes and document chunks
    integrations/             MCP and web settings
    backups/                  Previous bytes and restoration metadata
    schedules.json            Saved schedules
    logs/                     Dashboard setup/output logs
  .history/                   Pre-upgrade source archive
  config.json                 Model, boundaries, budgets and command recipes
  Start LocalDesk.cmd
  Stop LocalDesk.cmd
  Chat LocalDesk.cmd
  README.md
```

Source-relative paths follow the project if you relocate it. Historical audit records may quote the old Documents/Codex location; they are preserved unchanged. Ollama models remain in Ollama's own storage and are not copied here.

Example custom recipe:

```json
"recipes": {
  "qpdf-version": {
    "description": "Show the installed qpdf version",
    "executable": "C:/Program Files/qpdf 12.4.2/bin/qpdf.exe",
    "args": ["--version"],
    "inputs": [],
    "timeoutMs": 5000
  }
}
```

Declared inputs can be readPath, writePath or text, referenced by {0}, {1}, etc. They become arguments, not shell source. A recipe can still be powerful; add only commands you understand. Recipe writes do not automatically receive built-in edit backups.

## Validation and limits

```powershell
node --test test/*.test.mjs
node scripts/evaluate.mjs
node scripts/live-app-evaluate.mjs
```

Automated checks cover persistence, context, skills, source handling, both MCP transports, schedules posting to chat, permissions, backups, cancellation, HTTP boundaries and the actual installed document tools.

The two evaluation scripts use your actual Qwen model on disposable samples and write data/latest-evaluation.json and data/latest-app-evaluation.json. Reports include individual outcomes and timing, including failed runs. These are functional smoke tests, not broad capability benchmarks; model outputs can vary.

Latest validation on 2026-10-10: **47/47 automated checks**, **13/13 real-model tool tasks**, and **11/11 real-model app checks** passed. The app checks include a future scheduled job actually executing and posting its result without creating another schedule. Browser checks covered shared Chat/Work history, a real file download link, adding a skill, connecting the MCP example, and indexing/searching a document. Direct HTTPS reading worked through the existing proxy; public search remained challenged. Nothing was downloaded or installed. Source, runtime records and tests totaled roughly 1 MB before screenshots.

Known limits: small-model reasoning and instruction following remain imperfect; retrieval is lexical; HTTP MCP is a limited protocol client, not all MCP features; public search can be challenged; schedules require a running server; arbitrary desktop mouse/keyboard automation and unrestricted shell execution are not included.

Protocol references: [Ollama chat](https://docs.ollama.com/api/chat), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [SearXNG search API](https://docs.searxng.org/dev/search_api.html).
