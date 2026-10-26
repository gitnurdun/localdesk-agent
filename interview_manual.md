# LocalDesk interview manual

Prepared: 2026-10-10. Implementation snapshot: LocalDesk 0.2.0.

This is an interview preparation guide for the actual JavaScript project in this folder, not a claim that every proposed feature is finished. It contains 200 numbered questions and answers, résumé wording, architecture notes, demonstrations, debugging stories and a preparation plan. No document can predict every possible interview question; these cover the major technical and behavioral directions relevant to this project.

Read README.md for operation and TODO.md for the future engineering roadmap. Answers describe implemented behavior unless explicitly labeled “future improvement.” Replace personal ownership statements with what you actually did and understand. This was an AI-assisted build; do not present generated work, measurements or decisions as personally performed if they were not.

## 1. Evidence and claims you can defend

| Item | Verified implementation or saved evidence |
| --- | --- |
| Language and runtime | JavaScript ES modules; Node.js 22+; native HTTP and browser APIs |
| External npm dependencies | None declared in package.json |
| Local inference | Ollama; configured model qwen3:1.7B |
| Model-size caveat | Despite the tag, inspected metadata reports 2,031,739,904 parameters. The installed, explicitly requested Qwen model is the exception to the otherwise under-2B policy. |
| Context | Default 8,192 tokens; configurable 4,096–31,999; 32,000 or above rejected |
| Default output | 1,200 tokens; temperature 0; Chat thinking disabled |
| Tool budget | 18 global steps, 8 worker steps, up to 3 delegations |
| Tools | 38 built-in tools, plus permitted MCP and browser scheduling tools |
| Agent execution | Serial specialist delegation and serial top-level task queue |
| Persistent state | JSON files and JSONL event logs, not a database server |
| Retrieval | BM25-like lexical ranking and overlapping document chunks; not vector search |
| Interface | Browser conversation list, Chat/Work, activity, sources, artifacts, management panels |
| Extension points | Owner-authored skills, limited MCP client, owner-defined CLI recipes |
| Scheduling | In-process one-shot and interval schedules; requires app running |
| Automated suite | Build validation recorded 47 passing tests; this documentation pass did not rerun them |
| Real-model tool smoke suite | 13/13 saved checks; data/latest-evaluation.json; run 2026-10-10T03-26-01-570Z |
| Real-model app smoke suite | 11/11 saved checks; data/latest-app-evaluation.json; run 2026-10-10T03-35-14-667Z |
| Small tool-suite latency | 0.3–3.5 seconds across those 13 warm-machine tasks; not production p95 |
| Validation machine | i7-12700H, 16 GB installed RAM, RTX 3050 Laptop GPU with 4 GB VRAM |
| Web limitation | Direct HTTPS reading worked; public search encountered an anti-bot challenge. Mocked SearXNG checks are not proof of a live deployment. |
| Security boundary | Application-level path, tool and process checks; not an OS sandbox |

The saved 24 real-model checks are small functional smoke suites. They do not demonstrate frontier-model equivalence, statistically established accuracy, production adoption or a percentage improvement over another agent.

## 2. Résumé wording and interview pitches

### Suggested project entry

**LocalDesk — Local-first JavaScript AI assistant powered by Ollama**

- Built an AI-assisted local agent prototype with a persistent Chat/Work interface, 38 built-in tools, file-backed memory, document retrieval, skills, limited MCP integration and in-process scheduling.
- Designed a bounded-context execution loop for a small local model using structured tool actions, selected tool catalogs, serial specialists, runtime argument checks and evidence-based completion gates.
- Added path restrictions, verified file-edit receipts, backups, cancellation and audit logs; build validation recorded 47 automated tests and 24 real-model functional smoke checks.

Only retain bullets you can explain and demonstrate. If you mainly integrated and reviewed the AI-generated implementation, say so. Do not add invented users, revenue, production uptime, speedups or authorship.

### 30-second pitch

“LocalDesk is a local-first assistant I developed with AI assistance in JavaScript. It uses an installed small Ollama model, offers persistent Chat and Work modes, and can manage files and run selected local tools. The interesting part is making a small model dependable: I narrow its choices, keep context bounded, validate actions and require tool evidence before declaring supported tasks complete. It is a tested prototype, not a frontier-model replacement or a hardened sandbox.”

### 90-second pitch

“The goal was a lightweight desktop assistant without downloading a large model or adding a heavy framework. The browser connects to a loopback Node server, which manages conversations, a serial task queue and an Ollama client. Chat streams ordinary answers; Work can route to a structured action loop.

The model proposes an action, but deterministic code decides whether the tool is available, whether its arguments are valid, whether the paths and operation are permitted, and whether its result satisfies a recognized requirement. I use selected tools, short recent history, retrieved context and serial specialist workers rather than placing everything in one prompt.

It supports local document retrieval, file-backed facts and episodes, skills, limited MCP integrations, schedules and artifact links. The saved validation includes 47 automated tests and 24 real-model smoke checks. Important limitations are lexical retrieval, regex-based intent and permission heuristics, application-level isolation, incomplete MCP coverage and scheduling that currently lacks durable exactly-once guarantees.”

### Five-minute presentation outline

1. Problem and constraints: small model, local inference, JavaScript, limited installation and context.
2. Browser-to-agent architecture and Chat/Work distinction.
3. One concrete file task from request to verified artifact.
4. Small-model optimizations and why they reduce the decision space.
5. Memory, retrieval, extensions and scheduling.
6. Test evidence, one failure story and two honest limitations.
7. Next priorities: stronger authorization, crash-safe scheduling and held-out evaluation.

## 3. Architecture and code tour

~~~text
Browser conversation UI
        |
Loopback HTTP API + SSE
        |
Conversations / task queue / schedules
        |
Agent: route -> prepare context -> converse OR work loop
                                      |
                            Ollama structured action
                                      |
                   schema + scope + path + process checks
                                      |
                          built-in / MCP / app tool
                                      |
                   receipt -> logs -> contract check
                                      |
                         final answer + artifacts
~~~

Workers reuse the same local model and global task budget. They have narrower state and cannot recursively delegate. They do not run in parallel or acquire extra authority.

| File | What to explain |
| --- | --- |
| src/agent.mjs | Lifecycle, context preparation, action loop, delegation, receipts |
| src/router.mjs / src/contract.mjs | Intent routing and recognized completion obligations |
| src/context.mjs / src/ollama.mjs | Prompt packing, output limits, streaming and structured generation |
| src/policy.mjs / src/scope.mjs | Path boundaries and task-derived capabilities |
| src/tools.mjs / src/files.mjs / src/process.mjs | Tool catalog, file operations and controlled child processes |
| src/store.mjs / src/conversations.mjs | Tasks, logs, memories and persistent conversation history |
| src/retrieval.mjs | Ranked document context and source labels |
| src/skills.mjs / src/mcp.mjs / src/web.mjs | Skill selection, external tools and network access |
| src/application.mjs / src/management.mjs | API, queue, conversation updates and schedules |
| public/app.js / public/markdown.js | Interactive UI, streaming and safe rendering |
| scripts/evaluate.mjs / scripts/live-app-evaluate.mjs | Real-model validation |
| test/ | Automated behavior and safety fixtures |

Read the code in this order for an interview: config → application → agent → contract → tools → policy → context → storage → integrations. Start with one vertical request, not every file at once.

## 4. The 200 interview questions and answers

### A. Product, scope and ownership

#### Q001. What problem does LocalDesk solve?

It provides a local conversational interface for bounded computer-management tasks: inspecting system information, finding and editing permitted files, processing documents and creating scheduled work. Its engineering focus is making a small local model useful through deterministic orchestration. It does not replace unrestricted remote desktop control or promise autonomous management of every installed application.

#### Q002. Why build this instead of just using Ollama directly?

Ollama provides inference, not the complete application workflow. LocalDesk adds conversation persistence, action selection, permissions, tool execution, retrieval, cancellation, evidence, artifacts and scheduling. The important separation is that language generation proposes behavior while application code controls side effects and records what actually happened.

#### Q003. What is the difference between Chat and Work?

Chat generates conversational answers and does not enter the model-driven tool loop. It can receive prepared attachments, retrieval and explicitly enabled web context. Work can execute permitted tools when the request calls for action; an explanatory Work request can still route to conversation. Therefore Chat is not necessarily “no preprocessing” or “always offline.”

#### Q004. What makes the project distinctive?

It deliberately designs around small-model weaknesses. Examples include limited catalogs, structured action output, mandatory probes for recognized requirements, deterministic arithmetic tools, canonical schedule receipts, bounded repair attempts and serial specialist contexts. These are engineering strategies to improve task reliability, not evidence that a 1.7B-tagged model matches a large model across general reasoning tasks.

#### Q005. What constraints shaped your decisions?

The user requested JavaScript, fast local inference, context below 32K, minimal installation and a small model. Existing Git Bash and document tools were reused. Default context is 8K, no npm dependencies are declared, and the architecture avoids a vector database or heavy frontend framework. The requested installed Qwen tag has a documented parameter-count exception.

#### Q006. What can the current prototype actually demonstrate?

It can demonstrate persistent conversations, streamed Chat, Work activity and artifacts, permitted file operations, document tools, lexical retrieval, skills, an explicitly connected local MCP server and schedule management. Demonstrate public search only with a working provider: the build encountered a DuckDuckGo challenge, so claiming universal working web search would be inaccurate.

#### Q007. What are the biggest limitations?

The main limitations are heuristic routing and capabilities, incomplete completion contracts, lexical rather than semantic retrieval, serial execution, application-level isolation and a scheduler without durable exactly-once handling. MCP support is a defined subset. Conversation summaries are excerpts, not semantic compression. These are documented improvements rather than hidden assumptions.

#### Q008. How should you describe AI assistance?

Explain your real role: specifying constraints, reviewing architecture, testing behavior, understanding code and choosing improvements, if those are activities you performed. Say the implementation was AI-assisted. An interviewer may ask you to modify the code or diagnose a failure; your ability to do that is more convincing than pretending all lines were handwritten.

#### Q009. Which measurable results are safe to put on a résumé?

Use the saved counts: 47 automated tests during build validation, 13 real-model tool checks and 11 app checks. State the model and context. The small tool suite recorded 0.3–3.5 second task durations on the validation machine. Avoid converting that into production latency, general accuracy or a comparative speedup without repeated independent measurements.

#### Q010. How would you define success for the next version?

Success means more tasks complete correctly with verifiable artifacts, fewer unsafe or unauthorized attempts and predictable latency under the same model and context budget. Establish a held-out task set, failure categories and repeated runs first. Then measure improvements. More features or a prettier interface alone do not establish better agent reliability.

### B. Architecture and boundaries

#### Q011. Describe the end-to-end request flow.

The browser submits a conversation turn. The server persists message/task state and queues execution. The agent routes the request, gathers bounded context and either streams Chat or runs a structured Work loop. Tool results become receipts and events; completion checks inspect those receipts. The server updates the assistant message and broadcasts activity and artifacts to the UI.

#### Q012. Why separate the model from the executor?

A model is probabilistic and may invent APIs, arguments or success. The executor is deterministic code that owns the tool registry, validates inputs, enforces access and performs operations. This lets a mistaken action fail safely without granting arbitrary shell access, while a successful operation produces evidence independent of the model’s wording.

#### Q013. Why choose JavaScript and Node?

Node offers native HTTP, streaming, subprocess management and filesystem APIs, while JavaScript can also implement the browser UI. ES modules keep the project straightforward. This choice reduces deployment dependencies for a personal prototype. It does not make Node automatically sandboxed, and CPU-heavy indexing would need careful offloading or a different storage design at scale.

#### Q014. Why not use a large agent framework?

The prototype prioritizes small prompts, explicit control and a small installation footprint. A minimal implementation makes state transitions and side effects inspectable. The tradeoff is owning schema validation, MCP compatibility, persistence and cancellation complexity. A maintained library can be preferable later when it improves correctness without violating size and deployment constraints.

#### Q015. How modular is the architecture?

Inference, context, policies, tools, persistence, retrieval and integrations are separate modules. For example, a new built-in tool belongs in the registry and should use shared path/process checks rather than duplicating them. The modules still share application state and some heuristic coupling; this is a modular prototype, not a distributed microservice architecture.

#### Q016. What are the main trust boundaries?

User requests, model output, retrieved documents, web pages and external MCP results have different trust levels. Tool definitions, owner-authored skills and configured recipes are privileged configuration. Untrusted content should be treated as data, not authorization. Application checks reduce risk, but arbitrary trusted integrations execute under the user’s OS permissions.

#### Q017. Is this an event-sourced system?

Not fully. Tasks have JSON snapshots plus append-only JSONL event logs, which support auditing and partial reconstruction. The application does not derive every state transition exclusively from replayable events or guarantee atomic snapshot-and-event transactions. It is more accurate to call it file-backed state with an audit trail.

#### Q018. What is a task versus a conversation?

A conversation is a persistent thread of messages and settings. A task is a specific execution attempt with status, results and events. Multiple tasks can belong to a conversation, including scheduled runs. Resuming creates a new attempt with prior context rather than continuing an exact suspended instruction pointer.

#### Q019. Why use a serial task queue?

A single queue reduces contention on the small local model and makes side effects easier to reason about on limited VRAM. It also simplifies cancellation and activity ordering. The downside is head-of-line blocking and potential schedule backlog. Controlled concurrency should be evaluated against resource capacity rather than added solely because asynchronous JavaScript allows it.

#### Q020. Where would you add a new feature?

Follow its authority and lifecycle. A file operation is a validated tool; a conversation setting belongs in conversation storage and the UI; an integration belongs in MCP/web configuration; a schedule action belongs in management plus app tools. Add behavior tests and real-model checks where appropriate. Avoid putting everything into the model prompt or frontend handler.

### C. Model and inference fundamentals

#### Q021. Did you train a model?

No. The project uses an existing installed Ollama model and changes the application around inference. There is no fine-tuning, LoRA adapter, distillation or custom inference kernel. “Small-model optimization” here means constrained orchestration, prompt/context selection, tools and deterministic verification—not modifying the model weights.

#### Q022. Is qwen3:1.7B strictly below two billion parameters?

Not according to the inspected metadata, which reports 2,031,739,904 parameters. Model tags are not an authoritative exact count. The installed model was explicitly requested and treated as an exception. Other configured models above the limit are rejected. State this clearly instead of rounding away an inconvenient requirement mismatch.

#### Q023. What does quantization change?

Quantization represents model weights at lower precision, reducing memory and storage requirements with potential quality tradeoffs. LocalDesk delegates actual inference and model storage to Ollama; it does not implement quantization. When discussing model fit, distinguish disk size, weight memory, runtime buffers and context/KV-cache memory rather than treating parameter count as the only cost.

#### Q024. Why can a small model be useful here?

Many computer tasks combine modest language understanding with deterministic operations. A model can select “read file” or “calculate,” while exact computation and verification happen in tools. Narrow choices and strong feedback reduce avoidable errors. This helps constrained workflows; it does not remove the capacity gap on difficult reasoning or ambiguous long-horizon planning.

#### Q025. Why use temperature zero?

It reduces sampling variation and makes structured action selection more consistent. The implementation also supplies a seed. Neither setting guarantees identical results across runtime versions, hardware or all inference behaviors. Repeated evaluations remain necessary, especially when a one-run success rate would otherwise hide instability.

#### Q026. Why disable thinking in Chat?

The default prioritizes quick answers and bounded output from the small model. Chat explicitly disables thinking; Work uses the configured setting. This is a latency/quality tradeoff, not a universal conclusion that extra reasoning is useless. Compare controlled runs on representative tasks before changing it.

#### Q027. How does Ollama integration work?

The client uses local HTTP endpoints for model discovery, model metadata and chat inference. Work requests structured JSON via a supplied schema; Chat consumes streamed NDJSON. Requests enforce time/output limits and use configured context settings. Model-generated JSON is still validated by application code before dispatch.

#### Q028. What happens if Ollama is unavailable?

Startup and diagnostics check the local service. The launcher can start an already installed Ollama service when appropriate; it does not automatically pull a new model. Failures should surface as actionable connection/model errors rather than invented answers. Existing service settings are not silently overwritten to force new parallelism behavior.

#### Q029. How are streamed responses parsed?

The client decodes incoming byte chunks, accumulates incomplete lines and parses complete NDJSON records. Token text is emitted progressively, while final metadata completes the result. Network chunk boundaries need not match JSON or UTF-8 boundaries, so incremental decoding and buffering matter. Test malformed records, cancellation and output limits as well as the happy path.

#### Q030. How would you compare alternative models?

Keep the same tasks, tools, policy, context, hardware and evaluation criteria. Record exact tags and metadata, cold/warm conditions, completion success, unsafe attempts and latency distributions over repeated runs. Respect the installation budget. A model replacement should improve measured workflow outcomes; a few appealing conversational answers are not sufficient evidence.

### D. Targeted small-model engineering

#### Q031. Why limit the tool catalog?

Every additional tool creates another selection opportunity and consumes prompt capacity. LocalDesk groups tools and ranks relevant candidates, usually limiting a group catalog to seven entries. Common tools, delegation, skills, MCP and app tools can increase the total; do not claim an absolute seven-tool limit.

#### Q032. How is the tool group selected?

The implementation uses task wording and regex-based heuristics to infer categories such as files, documents or system inspection. Within the group, relevant tools are ranked and recognized required tools are pinned. This is cheap and inspectable, but can misclassify unusual wording; it is not a learned router.

#### Q033. What are completion contracts?

A contract derives specific obligations from recognized user requests, such as reading a named file, inspecting GPU information or creating a particular output. The loop checks successful tool receipts before accepting a final answer. It prevents some premature completion, but its parser covers limited patterns rather than all possible user intent.

#### Q034. Why sometimes force an initial probe?

If a task clearly requires current system data, letting the model answer from memory would be unreliable. The catalog can be narrowed to a mandatory probe until the obligation is satisfied. This reduces choice overload and ensures evidence exists. The risk is incorrectly inferred requirements, so contracts need negative and paraphrase tests.

#### Q035. What does a final-only schema accomplish?

When known requirements are fulfilled, the loop can ask only for a final answer instead of another tool action. This limits unnecessary extra actions and cycles. It depends on the contract being correct; it should not be described as a proof that every aspect of an open-ended task is complete.

#### Q036. How do you handle malformed model output?

Structured generation is backed by local parsing and validation. Errors are reported to the loop, with a bounded allowance rather than unlimited retries; repeated parse/validation errors block the task. This keeps latency and risk bounded. Future improvements should measure repair success by error category instead of increasing retries blindly.

#### Q037. How do you prevent repetitive tool loops?

The loop tracks identical action signatures and blocks before executing the same signature a third time. Global steps, worker steps, delegation and timeout limits provide additional bounds. This catches exact repetition, not semantic equivalence, and does not provide idempotency for external side effects.

#### Q038. Why use deterministic tools for arithmetic and schedules?

The model should not need to invent exact arithmetic or paraphrase a schedule’s next-run time. Arithmetic is computed, and supported scheduling requests are normalized from the original instruction with canonical results taken from receipts. This reduces hallucinations in narrow domains. JavaScript floating-point arithmetic still has precision limitations.

#### Q039. Can these strategies make a small model compete with a large one?

They can plausibly narrow the gap on specific tool workflows by shifting exact work into code and reducing ambiguity. The project has not performed a controlled large-model comparison, so equivalence is unproven. Distinguish task-system performance from raw model ability and propose a benchmark before making a competitive claim.

#### Q040. What ablation experiments would you run?

Compare the baseline against variants without catalog pruning, contracts, retrieval, specialist contexts or receipt-grounded summaries. Use held-out tasks and repeated runs, measuring artifact correctness, unsafe attempts, latency and token use. Change one variable at a time. Some mechanisms may help one task family while harming another.

### E. Context management

#### Q041. How do you stay below the context limit?

The configuration rejects contexts of 32K or above. Packing reserves output and overhead, clips sections conservatively and selects recent history and retrieved excerpts instead of injecting all data. The current byte-based accounting is approximate, not an exact tokenizer proof. A second request-size guard reduces overflow risk.

#### Q042. What is the default prompt budget?

With 8,192 context tokens, 1,200 output tokens and an 850-unit packing reserve, the main context packer starts from a budget of 6,142 approximate units. These units use conservative byte heuristics. Actual inference token counts can differ because of tokenization, chat templates and schemas.

#### Q043. What receives priority in context?

System instructions, the current goal and tool-related state take priority. Bounded conversation excerpts, summaries, memories, skills and source snippets receive allocated portions. This reflects the need to keep the present request actionable. Fixed caps are pragmatic defaults, not an optimal allocation proven for every task.

#### Q044. Is character count equivalent to token count?

No. English, Chinese, code, paths and punctuation tokenize differently; JavaScript string lengths also differ from UTF-8 bytes. The implementation estimates with bytes and adds reserves. An exact or conservative model-aware estimator, Unicode-safe clipping and boundary tests are future improvements in TODO.md.

#### Q045. How is long conversation history handled?

All messages are persisted up to a configured store cap, but only bounded recent messages enter inference. Older messages contribute deterministic excerpt summaries. Chat uses this summary alongside recent turns. The archive and the inference context are separate; saved messages are not automatically accessible to the model in full.

#### Q046. Is the conversation summary generated by the LLM?

No. It extracts bounded older exchanges and some regex-recognized facts. This avoids another inference call and keeps cost predictable, but it can miss meaning or lose an important old fact. Describe it as excerpt-based compaction, not a semantic summarizer with guaranteed recall.

#### Q047. How does Work differ from Chat history packing?

Work uses compact loop state and a small recent conversation slice, while Chat explicitly packs the conversation summary and recent history. Their history treatment is not identical. A future improvement should preserve useful continuity in Work without allowing earlier messages to grant new task permissions.

#### Q048. How are large tool results handled?

Tool outputs are bounded; events preserve more evidence on disk while recent loop state retains only a small action/result window and compact summaries. Paging or task-reading tools can recover selected details. A result being truncated must remain visible so the model cannot mistake an excerpt for a complete scan.

#### Q049. How do attachments enter context?

The agent reads up to five supplied attachments through document-reading tools and includes bounded excerpts with source metadata. Errors are surfaced rather than silently treated as successful reads. The current excerpt approach can miss relevant content in a long document; targeted retrieval over uploaded files is a future improvement.

#### Q050. What should happen when context is still insufficient?

The assistant should narrow the task, retrieve a specific passage, page a file or delegate a bounded subtask. If necessary it should stop with an explicit incomplete result, not hallucinate missing evidence. Increasing context is only one option and must preserve the user’s less-than-32K constraint.

### F. Tool schemas and execution contracts

#### Q051. What does a model action look like?

Work responses conform to a schema selecting either a tool name with arguments or a final answer. The agent then parses and validates the response against the available catalog. The model does not invoke JavaScript directly. Dispatch is a lookup into trusted implementations, followed by scope and runtime checks.

#### Q052. Why validate JSON after structured generation?

Structured output constrains generation but is not a substitute for a security boundary. Responses may be malformed, truncated or inconsistent with the expected shape, and external tools may supply unsupported schemas. Local validation catches these before dispatch. Runtime checks must additionally verify paths and operation permissions because a well-formed argument can still be unsafe.

#### Q053. Is your validator a complete JSON Schema implementation?

No. It handles a selected subset, including object properties, required fields, enums, arrays, lengths, integers and some alternatives. It does not fully implement references, composition, formats or all numeric constraints. A future version should reject unsupported schemas or adopt a maintained validator within the dependency budget.

#### Q054. How does the tool registry help?

It centralizes names, descriptions, schemas, grouping and executable handlers. The same registry supports catalog construction and deterministic dispatch. New tools should reuse existing policy and process helpers. Keeping registry entries small also reduces prompt size; placing a huge help manual in every tool description would undermine the context budget.

#### Q055. What are the common tools?

The common set includes memory_search, memory_store, task_plan, task_read and calculate. Availability is further constrained by task scope. These provide cross-cutting planning, recall, audit access and deterministic computation. “Common” means broadly useful in the catalog, not an exemption from permissions.

#### Q056. Does writing a plan prove the task is complete?

No. A plan is recorded intent, not successful execution. Completion should depend on appropriate receipts or artifacts. The implementation checks recognized obligations and catches some unsupported success claims. A model-generated checklist marked “done” alone is insufficient evidence.

#### Q057. How do you know a file was really created?

The tool writes the file, rereads it, checks bytes and returns a hash/path receipt. Artifact links are based on successful tool outputs rather than invented model paths. A truthful final answer should refer to that evidence. This verifies that write operation, not the semantic quality of every generated document.

#### Q058. Can the contract verifier fully prevent hallucinations?

No. It verifies narrow obligations and some claim patterns. It cannot generally prove that a summary is accurate, an explanation is logically correct or every requested business requirement is fulfilled. Stronger verification needs domain-specific checks, structured outputs, artifact tests and explicit uncertainty for unverifiable assertions.

#### Q059. How are tool failures represented?

Tool execution produces results or errors that enter the task event stream and the loop’s recent state. The agent can recover within its budgets or finish as blocked/failed. Distinguish a tool’s nonzero exit, policy rejection and empty successful output. UI text should not convert any of these into a success merely because inference completed.

#### Q060. How would you add a safe deletion tool?

Do not expose recursive arbitrary deletion. Define narrow targets, check write scope and paths, require clear task authorization, preserve recoverable bytes and emit an audited receipt. Test symlinks, control files and ambiguous targets. The existing trash tool handles one file with an application backup; it is not a general directory deletion interface.

### G. Files, CLI tools and recovery

#### Q061. How do read and write permissions differ?

Read roots include the permitted user folders and workspace; write access defaults to the workspace unless explicitly configured otherwise. Root membership alone does not grant a task permission to mutate files. Scope checks and control-file exclusions also apply. Wider filesystem access should require a deliberate owner configuration change.

#### Q062. How do you avoid blind overwrites?

Normal agent file creation is new-file-only. Existing text edits require reading the current file and replacing one unique exact substring. A stored read-version hash detects changes since inspection. This reduces accidental damage, although a concurrent filesystem actor can still introduce a time-of-check/time-of-use race.

#### Q063. Why use exact-match replacement instead of whole-file rewriting?

A unique literal replacement limits the affected region and makes the intended edit reviewable. It also avoids the small model reconstructing unrelated contents from a clipped read. It is less flexible for large refactors or repeated matches; those should be broken into carefully verified operations or supported by a dedicated patch workflow.

#### Q064. What happens if a file changes after the agent reads it?

The edit wrapper compares the current hash with the recorded read version and should reject a stale edit. The agent must read again and reassess. This is optimistic concurrency control, not a filesystem transaction or file lock that excludes all writers.

#### Q065. How do backups work?

Before supported mutations, the application stores the original bytes and metadata in its backup area, subject to a size limit. Restore uses a checked destination and can back up the current version first. These backups are application-managed, not Windows Recycle Bin entries or guaranteed full operation rollback.

#### Q066. Is a move operation atomic?

The implementation copies exclusively to a new destination, verifies content and then unlinks the source, with backup support. A failure can leave both copies. Restoring the source backup does not automatically remove the destination. Therefore it is a verified copy-then-delete workflow, not an atomic rename transaction or a perfect undo.

#### Q067. Can the agent run arbitrary Bash commands?

No built-in general shell tool is exposed. Git Bash operations use fixed command templates and positional arguments, with an operation enum. Model text is not interpolated into an arbitrary shell script. Owner-defined recipes and MCP servers are more powerful trust decisions and must not be described as equally restricted.

#### Q068. How do text pipelines avoid shell injection?

They select from fixed steps such as literal filtering, sorting, deduplication, head/tail and counting. Programs receive argument arrays and piped input rather than a model-generated shell pipeline. Step count and output limits are bounded. New output paths are checked to avoid replacing existing files.

#### Q069. How are Pandoc and qpdf integrated?

They are existing external executables invoked through controlled arguments and path policies. Pandoc handles supported document extraction/conversion, qpdf performs selected PDF checks and manipulation, and pdftotext extracts PDF text. Supported formats are bounded; a malformed PDF or third-party parser vulnerability is not eliminated by argument validation.

#### Q070. How is duplicate detection implemented?

The tool groups by size, then hashes bounded candidate files with SHA-256 under file-count and byte budgets. Matching hashes provide strong evidence of identical bytes. It does not determine whether two differently formatted documents have equivalent meaning, and bounded scans must disclose that they do not cover every file.

### H. Security and threat modeling

#### Q071. What is the threat model?

Main threats include incorrect model actions, prompt injection from documents or web pages, unsafe paths, subprocess abuse and external integration behavior. The intended deployment is a single-user local prototype. It is not designed to isolate hostile code with the strength of a container, VM or multi-tenant service.

#### Q072. How do you stop path traversal?

Paths are resolved relative to permitted locations and tested for containment. Existing paths and ancestors are canonicalized so symlinks/junctions cannot simply disguise an out-of-root destination. Windows-specific checks reject problematic path forms. Test both lexical and real paths; checking whether a string begins with a root is insufficient.

#### Q073. Why reject UNC paths and alternate data streams?

They introduce access patterns beyond ordinary local regular files, including network shares or hidden stream content. Device paths and trailing-dot/space ambiguities can also bypass naive assumptions. The policy narrows accepted path semantics rather than attempting to support every Windows path feature.

#### Q074. Which files are intentionally protected?

Credential/control locations such as .ssh, .aws, .env variants and private-key names are excluded. The application’s configuration, source, state and extension control paths are protected from normal agent tools. This reduces secret exposure and self-modification, but it is not a universal classifier for every possible secret filename.

#### Q075. Is this a real sandbox?

No. Child processes run with the current user’s OS permissions. Path checks, fixed arguments, time limits and tool filtering are application-level controls. Trusted recipes or MCP executables can act outside those boundaries. A low-privilege worker or OS sandbox is a future architecture option, not an implemented claim.

#### Q076. How is prompt injection mitigated?

Retrieved content is labeled as data, while tool access and task capabilities are enforced outside the model. Workers inherit the parent scope. However the capability parser is keyword-based and not a semantic authorization engine. Resume also needs immutable capability handling, so do not claim prompt injection is solved.

#### Q077. What is the resume authorization risk?

Resume builds a new goal containing the original request and prior evidence. If capability checks derive permissions from this combined text, words from untrusted prior output may influence authority. A stronger design persists immutable capabilities from the original request and treats resumed evidence strictly as data. TODO.md prioritizes this.

#### Q078. How is the browser API protected?

The server binds to loopback, checks Host and cross-site request context, uses a random session token, constrains JSON body sizes and sends defensive headers. This mitigates ordinary cross-site requests. It is not user authentication against another local process running as the same user.

#### Q079. Is the network policy fully SSRF-proof?

No. The web reader checks HTTPS URLs, resolved IP addresses and every redirect, blocking private ranges. DNS validation and actual connection resolution are separate, and proxy behavior complicates the guarantee. DNS pinning or equivalent transport controls would be needed for a stronger claim.

#### Q080. What does cancellation guarantee?

It stops future agent progress, aborts requests and terminates owned child processes where supported. It does not undo a completed write, remote API call or other irreversible side effect. Reliable cancellation needs clear receipts and recoverability, not a promise that stopping the task restores the entire computer.

### I. Persistence, concurrency and failure recovery

#### Q081. Why use JSON files?

They are inspectable, portable and sufficient for the current personal prototype. They avoid a server dependency and make backup simple. Their limitations are whole-file read/modify/write races, growing scans and weak cross-file transactions. SQLite is a plausible future upgrade when measured load or correctness requirements justify it.

#### Q082. Which state is persisted?

Tasks, events, conversations, factual memories, episodes, integration configuration, knowledge chunks, schedules and backups are file-backed. The UI stores selected conversation identity locally, but authoritative conversation data is on the backend. Some intermediate streaming text exists only in memory until final persistence.

#### Q083. What is the purpose of JSONL event logs?

Each line represents an event, allowing append-oriented auditing and inspection of action/result sequences. This preserves evidence beyond the model’s context. Logs need bounds, corruption handling and redaction; append-only format alone does not guarantee durable flushes, atomic multi-file updates or safe storage of secrets.

#### Q084. Are state writes atomic?

Some JSON snapshots use temporary-file-and-rename replacement, reducing partial-file risk. Working-file tool writes are not implemented as fully atomic transactions. Atomic rename also does not by itself guarantee durability after power loss or atomic consistency across related files. Distinguish these levels when explaining persistence.

#### Q085. What concurrency is serialized?

Conversation mutations, memories and schedules use promise chains within their instances. The task queue serializes normal executions, and a runner lock protects a data-directory runner. These are not universal cross-process locks. Other configuration/index read-modify-write paths still need consistent serialization.

#### Q086. What does the runner lock prevent?

It uses exclusive creation and PID checks to prevent overlapping runners sharing the same configured data folder, with stale-lock handling. It does not reserve the GPU globally or prevent another independent application from sending Ollama requests. A machine-wide inference scheduler would require separate coordination.

#### Q087. What happens to running tasks after restart?

Previously running tasks are marked interrupted, and queued tasks can be recovered from persisted state. Recovery order is not guaranteed to preserve original FIFO because startup reads stored tasks in a different ordering. A durable monotonic queue sequence would improve predictable recovery.

#### Q088. How would you recover from corrupted JSON?

A robust future approach validates structure on load, quarantines damaged files, attempts a known-good backup and reports the recovery. Do not silently discard user data or assume an empty file means no conversations. Add fault-injection tests for truncated writes and incompatible schema versions before claiming automatic recovery.

#### Q089. Why are IDs important?

UUIDs separate task and conversation identity from titles and paths. They reduce accidental collisions and make references stable when a user renames a chat. They are not authentication secrets. The API must still validate IDs and authorize file access rather than treating possession of an ID as permission.

#### Q090. How would you migrate to SQLite?

First define explicit records and schema versions for tasks, messages, memories, chunks and schedules. Build transactional imports that preserve IDs and backup original files. Test replay and rollback before switching. Keep the same tool policy and use appropriate indexes; changing storage does not automatically improve model reasoning.

### J. Conversation and memory

#### Q091. What is short-term memory here?

The working prompt contains bounded recent turns, a summary, compact task state and recent tool exchanges. It is temporary inference context, not everything saved on disk. The objective is preserving the information required for the current decision without exhausting the small model’s context.

#### Q092. What is long-term memory?

Facts and task episodes persist separately from conversation history. Facts can be searched and incorporated into future context. Episodes record outcomes and evidence references. This is file-backed application memory; the model weights are unchanged and do not permanently learn a fact from a chat.

#### Q093. How do you distinguish trusted facts from model notes?

Stored facts include provenance, such as user-provided versus agent-note-unverified. Normal context retrieval favors factual records rather than indiscriminately adding episodes. This helps prevent a model’s earlier mistake becoming a trusted premise, but provenance alone cannot establish that every user claim is objectively true.

#### Q094. How are memories ranked?

The store performs BM25-like lexical scoring using query terms, approximate frequency and document length. It is a lightweight scan of records, not vector embedding similarity. Exact-text deduplication prevents identical fact entries, but near-duplicate or contradictory memories require a richer policy.

#### Q095. Can the assistant remember everything forever?

No. Facts and episodes have caps, conversations have a message cap, and prompts include only selected excerpts. Older facts may remain stored yet not be retrieved. An honest interface should explain these limits rather than presenting long-term storage as unlimited, perfect memory.

#### Q096. How are conversation updates kept consistent?

Each conversation has a serialized mutation chain, reducing races between queued placeholders, streaming completion and metadata changes within the server instance. The agent awaits lifecycle notifications where necessary. This does not eliminate multi-process writers or every cross-file task/message consistency issue.

#### Q097. Does archiving delete a conversation?

No. Archive is a soft state flag affecting the visible list. Deletion, retention and backup policies are separate concerns. Interviews should distinguish “hidden from active UI,” “removed from storage” and “erased from backups,” especially if users later request privacy-related cleanup.

#### Q098. How do you handle contradictory memories?

The current system does not offer sophisticated conflict resolution. A future approach records provenance and timestamps, detects conflicting keys, asks for confirmation on consequential facts and supports correction/deletion. Do not merely let retrieval return whichever contradictory sentence has the highest lexical score.

#### Q099. Should the agent automatically store every message as a fact?

No. That would add noise, private data and unverified inferences. Explicit memory authorization and provenance are safer defaults. Future memory suggestions can be reviewed by the user. Keep conversation archives separate from carefully curated durable facts.

#### Q100. How would you test memory quality?

Test fact insertion, deduplication, correction, permitted deletion, provenance filtering and retrieval in paraphrased or bilingual follow-ups. Include negative cases where an old model hallucination must not override a new user fact. Measure retrieval relevance and answer grounding separately from whether a JSON file exists.

### K. Retrieval-augmented generation

#### Q101. What is RAG in this project?

Retrieval-augmented generation means selecting relevant document excerpts and supplying them as labeled context before inference. LocalDesk indexes extracted text into chunks and ranks them lexically. The model can then answer using those excerpts and source labels. It is not an embedding-based vector database implementation.

#### Q102. How are documents chunked?

Indexed text is divided into 1,200-character chunks with a 1,000-character stride, creating 200 characters of overlap. Each chunk records its path, offset, indexing time, trust label and content fingerprint. Character boundaries are simple rather than paragraph-aware, so a chunk can divide a sentence or structured section.

#### Q103. Why overlap chunks?

Overlap reduces the chance that a relevant phrase or context is completely split between independent chunks. It also creates redundant retrieval results and increases index size. The current fixed overlap is a pragmatic choice; evaluate chunk sizes and diversity on actual questions rather than assuming more overlap is always better.

#### Q104. Is the ranking algorithm canonical BM25?

It is BM25-like, not a textbook token-index implementation. Frequency is approximated using substring occurrences with a cap, document length uses rough splitting, and multilingual terms include Han bigrams. It scans records directly. These approximations are small and useful but create false matches and language-specific ranking limitations.

#### Q105. How does Chinese retrieval work?

The tokenizer adds Han bigrams alongside ordinary Unicode terms to improve matching when words are not whitespace-separated. This is a heuristic, not complete Chinese segmentation; collecting Han characters can cross separators. Use bilingual relevance tests and Unicode boundary checks before claiming equivalent performance across languages.

#### Q106. How do you limit indexing cost?

Folder walks, file sizes, extracted text length and total stored chunks are bounded. Errors are skipped rather than allowing a single parser failure to consume unlimited work. The index currently caps at 10,000 chunks. Bounds keep the prototype responsive but also mean “indexed folder” is not necessarily exhaustive.

#### Q107. How do you handle stale documents?

Retrieval checks that sources remain permitted and present. It compares modification time with indexing time and marks potentially stale sources. It does not reread and hash every source before using it. Reindexing replaces chunks for successfully indexed files, while skipped changed files can leave stale records.

#### Q108. What do citations prove?

A source label proves the referenced excerpt was supplied, not that the model’s sentence is entailed by that excerpt. The answer formatter normalizes recognized labels and removes unsupported numbered labels. Stronger grounding would require answer-to-passage checks, clearer excerpt presentation and tests for unsupported or contradictory claims.

#### Q109. When would vector search help?

It may improve paraphrase retrieval and semantic similarity where exact wording differs. It also requires an embedding model, index lifecycle and more installation/runtime cost. First compare lexical, hybrid and vector approaches on held-out queries. Do not add a large embedding dependency before measuring a real retrieval gap.

#### Q110. How would you improve RAG without a new model?

Add a proper inverted index, better multilingual tokenization, paragraph-aware chunks, deduplication/diversity, file-hash freshness and query normalization. Test retrieval independently from generation. These changes can improve relevance under the existing download budget; their benefit should be measured rather than presumed.

### L. Specialist workers and delegation

#### Q111. Are the subagents separate models?

No. They are specialist execution contexts using the same configured Ollama model and parent task infrastructure. Different worker goals and narrower state provide separation of concerns. This is serial delegated orchestration, not a collection of independently trained models or parallel GPU workers.

#### Q112. What is the benefit of a worker with a small model?

A worker can focus on a narrow task with a smaller relevant context, returning compact evidence instead of polluting the main loop with every intermediate detail. This can reduce decision complexity. The additional inference and handoff cost can outweigh the benefit for trivial tasks.

#### Q113. How are delegation budgets enforced?

The defaults allow up to three delegations, eight local worker steps and eighteen global tool steps. Workers share the global budget and cannot recursively delegate. The overall task timeout also applies. This prevents workers from becoming an unbounded way to escape the parent’s execution limits.

#### Q114. Can a worker grant itself write permission?

No. Runtime scope is based on the parent’s original goal rather than the worker-generated goal. A worker’s prompt cannot independently widen permissions. This protection should remain explicit in future designs, especially when resume or other context transformations change the text seen by capability derivation.

#### Q115. Do workers have isolated state?

They have separate recent-action, evidence, repetition and read-version state, but share the task/store and overall runtime. They are not separate OS processes or security sandboxes. Their separation primarily manages context and reasoning, not hostile-code containment.

#### Q116. Why not let workers delegate recursively?

Recursive delegation can explode inference cost, obscure responsibility and exhaust limited context or steps. A flat parent-to-specialist structure is easier to audit. Deeper hierarchies might help complex workflows later, but require explicit depth, cost and authority controls plus evidence that the added complexity improves outcomes.

#### Q117. Why not run multiple workers in parallel?

The validation machine has limited VRAM, and parallel requests can increase latency or memory pressure. Concurrent side effects also complicate safety and evidence ordering. Start with serial workers. Add read-only concurrency only after measurements and a shared resource/capability design justify it.

#### Q118. How should the main agent trust worker output?

Treat the worker summary as an interpretation backed by receipts, not as unquestionable truth. The parent should verify consequential artifacts or inspect evidence references before claiming success. A confident worker sentence is not a stronger guarantee than a confident main-model sentence.

#### Q119. What tasks should not be delegated?

A one-step calculation or a clearly identified read may be faster directly. Tasks with tightly coupled edits can suffer from stale read versions if split unnecessarily. Delegate independent, bounded investigations or preparation steps where context isolation materially helps, not every request simply to appear “multi-agent.”

#### Q120. How would you evaluate delegation?

Compare the same tasks with direct and delegated execution. Measure completion correctness, global steps, latency, prompt size, redundant reads and unauthorized attempts. Include tasks where delegation should be avoided. A good policy selects delegation when beneficial rather than maximizing the number of workers used.

### M. Skills and instruction extensions

#### Q121. What is a skill here?

A skill is an owner-authored local instruction package with metadata and a SKILL.md body. It can guide response style or a workflow and be selected explicitly or by triggers. It does not automatically install software, execute scripts or grant filesystem permissions.

#### Q122. How are skills selected?

Explicit selection or a $skill-ID reference receives high priority; trigger substring matches add scores. Enabled state and supported mode filter candidates, and at most two are selected. This is lightweight matching rather than semantic skill search, so broad triggers can activate an irrelevant skill.

#### Q123. How much skill text enters the prompt?

Chat uses a bounded skill allocation within its context budget, capped per selected skill. Work includes a short initial excerpt and can page more with skill_read. This makes instruction overhead predictable. Important instructions buried far into a long skill may not be visible immediately.

#### Q124. Does a skill’s toolGroups metadata restrict access?

Not currently. It is stored metadata, not a security permission or a complete routing hook. Real access comes from catalog filtering and runtime policy. A future version should either implement clear group-selection semantics or label the field as informational so users do not assume nonexistent restrictions.

#### Q125. Can untrusted documents create skills automatically?

They should not. Skill creation is an owner management action, and control directories are protected from normal agent tools. Otherwise a malicious document could install persistent instructions. If importing skills later, validate content and metadata and require an explicit trust decision.

#### Q126. How does responseStyle work?

A skill can request maximum sentences or characters. The final formatter applies simple truncation after generation. This makes a narrow style setting enforceable, but sentence splitting is naive and can mishandle abbreviations or decimals. Safety/context error warnings can be appended afterward and exceed a style limit.

#### Q127. What is the difference between a skill and a tool?

A skill tells the assistant how to approach or present work. A tool performs a concrete operation through trusted code and returns a result. A skill may recommend a tool but cannot make an unavailable operation legal. Keeping these concepts separate prevents prompt instructions from becoming implicit executable authority.

#### Q128. How should a skill be tested?

Use explicit and trigger-based activation tests, disabled/mode mismatch tests and a representative task where its instructions matter. Test limits and malicious instruction attempts. Compare responses with and without the skill; merely confirming that SKILL.md was read does not prove it improved task quality.

#### Q129. How would you improve the skill system?

Add reliable examples, clearer metadata semantics, version/hash tracking and tests for conflicts between selected skills. Improve Unicode-safe style controls and compact instruction structure. Avoid unrestricted automatic self-rewriting; instruction changes should remain reviewable, because skills persist across future tasks.

#### Q130. Are these exactly Codex skills?

No compatibility guarantee is made. The package uses familiar SKILL.md conventions but has its own selection, metadata and bounded-context behavior. It is inspired by extensible coding assistants, not an exact implementation of every other product’s skill lifecycle or permission model.

### N. Model Context Protocol integrations

#### Q131. Why support MCP?

It offers a common way to connect external tool servers without adding a bespoke adapter for every service. The owner can explicitly connect a server and allow selected tools. This extends capability while keeping built-ins small. Every external server remains a trust and data-sharing decision.

#### Q132. Which transports are implemented?

The client supports stdio and a limited HTTP POST workflow with JSON or SSE responses. It initializes a session, lists tools and invokes allowed tools. It does not claim complete support for all MCP transports, extensions or authentication systems.

#### Q133. What is the connection handshake?

The client sends initialize, handles the negotiated protocol response, sends the initialized notification and requests tools/list. It supports configured protocol versions 2025-06-18 and 2025-03-26. It also handles selected notifications and server requests. Refer to this implementation’s supported subset rather than claiming universal spec conformance.

#### Q134. How are tools selected for the model?

Connected, owner-allowed tools are converted into bounded catalog entries with limited description/schema sizes. Lexical matching selects up to three, with special handling for exact names. A large server catalog is not dumped wholesale into the small model’s prompt.

#### Q135. What does the allowlist protect?

Only explicitly allowed names, or an intentional wildcard, are exposed. An empty selection allows none. The owner also classifies write tools. These controls reduce accidental use but rely on the server behaving honestly; a “read-only” advertised tool can still execute arbitrary server-side code.

#### Q136. How are JSON-RPC requests correlated?

Requests have IDs and a pending-request map. Responses resolve the appropriate promise; timeouts and cancellation clean up pending work. Stdio messages are newline framed, while HTTP SSE data is parsed for the relevant response. Tests should include late replies, malformed messages and connection shutdown races.

#### Q137. How does MCP cancellation work?

The client uses timeouts, abort signals and cancellation notifications where supported, and closes owned processes on shutdown. Cancellation is cooperative for remote servers and cannot guarantee reversal of completed side effects. A response timeout also does not prove the server never performed the action.

#### Q138. What MCP features are missing?

There is no complete OAuth flow, legacy SSE GET/resumption support, comprehensive prompts/resources APIs, sampling implementation or full schema coverage. Configuration secrets are local plaintext with status redaction, not encrypted secret storage. These are explicit roadmap items, not features to list as finished on a résumé.

#### Q139. Is starting an MCP server equivalent to launching a safe built-in tool?

No. A configured absolute executable may be an interpreter or powerful service running with user privileges. Rejecting relative launchers and batch files avoids some ambiguity but does not sandbox it. Review the executable, arguments, environment, tool permissions and data destination before connecting.

#### Q140. Would you replace the handcrafted client with an SDK?

Possibly, after evaluating dependency size, compatibility, licensing and maintained behavior. An SDK could reduce protocol maintenance risk but would not solve tool trust or authorization. First write compatibility fixtures so a replacement preserves bounded catalogs, cancellation and fail-closed behavior.

### O. Web access, proxies and grounding

#### Q141. Is LocalDesk completely offline?

Local inference and ordinary local tools can work offline. Enabling web context sends queries to a search provider, and external MCP servers may communicate remotely. The per-conversation web toggle is off by default. “Local-first” is accurate; “no information can ever leave the machine” is not.

#### Q142. How does Chat web context work?

When enabled, preparation searches using a bounded prefix of the current message and adds labeled results. It is not a semantic query-rewriting subsystem. Because the current message may contain private details, a future version should let users preview/edit the outgoing query and display what is being shared.

#### Q143. Which search providers exist?

The implementation supports DuckDuckGo HTML parsing and a configurable SearXNG JSON endpoint. Results are bounded. DuckDuckGo returned an anti-bot challenge during validation, and SearXNG behavior was tested with fixtures rather than a deployed instance. Provider code existing does not establish live reliability.

#### Q144. What should happen when a provider challenges automation?

Report the failure clearly and offer a configured supported provider or direct source URL. Do not attempt CAPTCHA bypass or pretend an empty/challenge page is a valid search result. Evaluation should distinguish blocked provider access from model failure and parsing errors.

#### Q145. How does direct page reading work?

The newer web reader accepts public HTTPS pages, validates DNS/IP targets and redirects, limits time and bytes, and accepts bounded textual formats. It returns source content for grounding. It is not a general browser engine and will not reliably execute JavaScript-heavy sites or authenticated applications.

#### Q146. Why was Windows proxy handling necessary?

The validation environment used an enabled system proxy, and direct Node fetch behavior did not provide the required path automatically. The adapter reads relevant Windows settings and reuses installed curl for bounded web requests. It does not modify system proxy or certificate settings.

#### Q147. Does the proxy adapter cover all cases?

No. Its implemented path does not provide general PAC, authenticated proxy or HTTPS-proxy support, and the HTTP MCP transport uses a different request path. Centralizing network configuration is a future improvement. Avoid claiming all integrations respect every Windows networking setup.

#### Q148. What limits exist on page reading?

Requests have a timeout, response-size cap, allowed content classes and a redirect limit. Private/local targets are rejected by the public reader. Limits reduce resource abuse but do not constitute complete SSRF protection or guarantee that extracted content is accurate or safe to trust.

#### Q149. What is the older web_fetch tool?

It is a separate host-allowlisted path with an empty default allowlist. Its network policy differs from the newer public reader. Maintaining two paths risks confusion, so a future refactor should preserve intended restrictions while unifying validation and configuration rather than accidentally widening access.

#### Q150. How would you evaluate web grounding?

Use stable fixture pages for parsing and injection tests, plus optional live checks that clearly report connectivity. Test source-label correctness, unsupported claims, redirects, private IPs, oversized responses and proxy failures. Never make offline unit tests depend on a provider that can rate-limit or challenge requests.

<!-- CONTINUE_MANUAL_Q151 -->

