# Ollama on your computer or network

Framecraft's AI panel offers **Codex CLI** and **Ollama · Local / network**. Ollama mode runs its own agent loop in Framecraft and connects to the actual Framecraft MCP server. It does not launch Codex or require an OpenAI account. Each provider keeps a separate conversation.

1. Install a model that supports **tools** on your Ollama server. For source-frame inspection and Automatic Cuts, it must also support **vision**. Framecraft checks the model's reported capabilities; cloud-backed model entries are excluded.
2. Open the editor's Codex/AI panel. Expand **AI provider**, select **Ollama · Local / network**, and enter the server URL, for example `http://192.168.1.50:11434`.
3. Click **Save provider settings**, then **Load Ollama models**. Select an installed model and click **Start Ollama**.
4. Send an editing request. Real tool calls and results appear in the conversation and Activity. Approve editing actions individually, or enable **Auto-allow**. Stop interrupts generation and further tool calls; already completed edits remain available to Undo.

The address is accessed from the **Framecraft server**, not the browser. If Ollama runs on another machine, configure that machine's Ollama service with `OLLAMA_HOST=0.0.0.0:11434`, restart it and allow the port through its firewall for your LAN. Use the machine's LAN IP in Framecraft. This is an environment variable on both Windows and Linux; the method for setting it depends on how you run Ollama. Browser CORS changes are unnecessary.

Prompts, requested tool results and inspected frame images are sent to the configured Ollama host. Media processing, projects and exports remain on the Framecraft machine. HTTPS reverse proxies with a path prefix are supported; authenticated gateways requiring a custom token are not currently configurable. For local voice recognition, keep **Speech recognition → Local** selected.

## Models and memory

The model menu comes from `/api/tags`, capabilities from `/api/show`, and streamed responses from `/api/chat`. Choose the model before starting if the default model lacks tools. Thinking controls follow the selected model's capabilities; Codex fast/service-tier controls do not apply to Ollama.

For a **16 GB GPU**, click **Use 16 GB context preset**, then save: it sets 16,384 context tokens. Start with an installed quantized 8–14B model reporting both tools and vision. Thinking defaults to **off** where supported (low for models requiring a thinking level); it remains selectable. Each generation uses temperature 0.1 and at most 4,096 output tokens. A truncated response executes no tools. One generation has a three-minute deadline; the overall editing task can contain as many successful steps as needed. Existing context settings are preserved until you save a change.

After the first response, provider settings show actual model allocation from Ollama's `/api/ps`, prompt tokens and generation tokens/second. Allocation outside GPU memory can explain slow responses. Download size alone does not establish whether a model plus its context fits VRAM. Ollama retains the model for five minutes between calls to avoid repeated loading. Concurrent rendering/inference still share hardware when hosted on the same machine.

The Ollama adapter has its own shorter instructions and ten compact commands: `add_text_clip`, `add_media_clip`, `update_clip`, `split_clip`, `remove_clip`, `move_clip_to_track`, `add_track`, `move_track`, `clear_track`, and `rename_project`. They validate explicit revisions and translate to the same `edit_project` MCP transaction, approval and Undo path. Timeline/source offsets in these commands use **project frames**; visual inspection/cut proposals use **source seconds**. The original advanced editor tools remain accessible. Large advanced schemas can be read through a locally archived reference and invoked with `call_editor_tool`.

Discovery selects schema hints, not execution permissions. Known tools can be called directly without rediscovery. A small selection of recent/relevant schemas is shown at once; other tools remain discoverable. Exact names in the latest request are selected up front; failed calls are prioritized for correction. Original schemas validate arguments **before approval**. MCP errors and exceptions share a per-tool guard: three repetitions of the same error or eight unsuccessful attempts stop the loop. Correcting one defect before encountering another does not immediately exhaust the repeated-error allowance; unrelated successful reads cannot reset it. Empty completions, unresolved failures and truncated output are reported as incomplete work.

When the active tool selection changes, previous calls to inactive tools are represented through the permanently declared `call_editor_tool` wrapper in the request sent to Ollama. Their names, arguments and results remain intact; saved history is unchanged. This keeps model templates from rejecting old calls with “tool not found” without loading every tool schema or re-enabling disabled workspace access.

Ollama receives simplified schema hints with explicit object properties, including fields originally inside `oneOf`/`anyOf` branches. The original MCP/workspace schemas still validate execution. If a model serializes an expected object or array as a JSON string, Framecraft decodes that container before validation and approval, and records the normalization in Chat. JSON-looking text fields, numeric strings and ambiguous values are not coerced. Raw tool tokens printed as prose trigger one request for a real native tool call; prose is never executed as a command.

Ollama's `inspect_video` uses flat arguments: `reportId` plus `page`, `time`, or `start`/`end`. The adapter also accepts older wrapped `inspection` objects and translates both forms to the unchanged MCP interface. This read-only tool accepts finite numeric strings such as `"310"`; it never guesses timecode units, clamps ranges, or fixes contradictory modes. Source-duration validation still runs on the server. This numeric conversion does not apply to editing or command tools.

`save_video_cut` checks known source bounds before approval. Every shot needs both `start` and `end` in source seconds; evidence must satisfy `start <= timestamp < end` (the end is excluded). Saving reports all invalid shot/evidence paths together, the actual source duration and existing evidence inside each affected shot. The agent can correct the numeric fields without rescanning the footage. Framecraft does not silently clamp cut boundaries or discard evidence.

Failed proposals with valid field types are retained as local repair drafts, including across restarts. `repair_video_cut` accepts the returned `draftId` and changes to individual shot IDs (`start`, `end`, `evidence`), retaining other shots, descriptions and metadata exactly. It validates and saves through the normal MCP approval path; it does not apply the cut. Source ranges are independent of proposal ordering: the next shot's source start need not equal the previous shot's end. Reversed or zero-length ranges report their actual start/end and evidence together with other range errors.

When a conversation approaches its estimated input budget, **Compacting conversation** appears in Chat/Activity. Framecraft writes a local checkpoint with excerpts of recent tool arguments/results, user constraints and assistant notes. This is deterministic: no additional Ollama generation is used for compaction. The latest request stays verbatim, and the newest complete tool exchange and its images remain in context. Older reasoning traces are excluded from normal prompts. The conversation continues after the checkpoint is saved; visible chat history remains intact.

Project and visual-report responses use structured projections: exact IDs/revision/fps, clip placement, report duration, overview-page count and coverage. Large lists expose complete items, totals and exact pointers to omitted details. Raw results are saved in `data/ollama-context/`; `read_context_result` retrieves exact fields through JSON pointers and paged text. Other oversized results and old exchanges are archived with labeled excerpts. Compaction itself never edits or grants approvals.

Visual memory is separate from the chat checkpoint. After `inspect_video`, ordinary assistant commentary about a single image batch is saved automatically with its source timestamps. `record_video_observations` is optional for precise per-frame notes; inspection and editing do not wait for this extra call. Automatic comments remain batch-level model claims and do not mark every frame as reviewed. Notes require exact timestamps from images actually supplied to the model, and explicit confidence. Unclear frames can be recorded as uncertain; the adapter cannot verify the model's semantic interpretation. Coverage distinguishes returned pages from pages whose frames all have notes. Original requests, observations, project identity and recent completed operations persist in work state; a brief “continue” cannot replace the original request. `read_work_state` pages the full notes, automatic comments and requests. Raw reasoning is not used as durable visual memory.

Token estimates are approximate and image costs depend on the model. Compaction retains the latest image batch and its timestamp map even after a prose-only reply, and removes rediscoverable schemas before sacrificing the latest results. If the request, instructions and newest image batch still cannot fit, Framecraft reports the limit instead of silently dropping the images and restarting inspection.

Conversations, work state and provider settings persist locally in `data/ollama-session.json` and `data/agent-provider.json` (or your configured data directory). Image bytes are not embedded in saved history. After restarting, recorded observations remain available; a new visual review requires reinspection. Existing chats from before structured visual memory cannot recover observations that were already discarded; start a fresh chat for a clean comparison after upgrading.

## Capabilities and limits

All editor MCP tools can be discovered: project and timeline edits, cuts, grading, opacity, speed, saved asset recipes, sound tools, analysis and exports. The same server-side validation and revision checks apply, and edits appear live in Framecraft.

A text-only model can edit timeline metadata, but cannot visually judge footage. These changes fix orchestration and memory defects; they do not make an 8–14B model equivalent to a large cloud agent. Dense gameplay, brief events, scene meaning and long editorial plans can still be misunderstood. Review saved Automatic Cuts before applying when visual judgment matters. Provider changes are blocked while a response is running. Codex's instructions and MCP contracts are independent of this adapter.

## Reproduce a real local integration check

Run this optional probe against your own installed model:

```text
node --import tsx scripts/probe-ollama.ts --url http://HOST:11434 --model MODEL --context 16384 --vision
```

It creates an isolated temporary editor, asks the real model to add/update/split a title, and asserts the resulting timeline through HTTP. `--vision` adds a generated RED/GREEN source, inspections, persistent observations and a saved cut. FFmpeg is required for that phase. The probe prints timings, tool failures and Ollama runtime allocation, then removes only its temporary data. It never connects the agent to your open project. This checks basic execution and perception, not editorial quality on an arbitrary rush.

### Optional workspace files and commands

In **AI provider → Workspace access**, choose **Editor + read and edit files** or **Editor + files and commands**. Set an existing **Workspace folder** on the Framecraft machine (blank defaults to the Framecraft repository), save, then start Ollama again. Older installations default to **Editor tools only**.

The assistant can discover `list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `edit_workspace_file`, and, in command mode, `run_workspace_command`. They share the existing conversation, discovery, approval and context-compaction flow with the editor MCP tools; workspace tools execute directly in Framecraft, not through a separate Codex process or on your remote Ollama server. For example, ask it to write a Node script generating an SVG or sound, run it, import the result and place it on the timeline. Supported asset recipes remain preferable for reusable editable effects.

File reads are paged, writes check the previous content hash, and direct file tools reject paths or symlinks escaping the workspace. They also block writes to Framecraft's active data directory and Git metadata. File reads of up to 2 MB are supported; use commands for larger files. File changes persist on disk and are **not part of timeline Undo**.

Commands run with the Framecraft host account's permissions: **the workspace is a working directory, not an OS sandbox**. They can access outside it. Writes and commands ask for approval unless **Auto-allow** is enabled; every call appears in Chat. Only enable command mode for trusted users of your Framecraft server. File contents and command output requested by the model are sent to the configured Ollama server.

Commands take an executable and literal arguments, use no implicit shell, have closed stdin and a configurable 1–600 second timeout (60 seconds by default). `node` uses Framecraft's Node executable on Windows and Linux. Invoke a shell explicitly for shell syntax or Windows `.cmd` scripts. Output is bounded to the last 32,000 characters per stream; nonzero exits and timeouts are reported as tool failures. Stop cancels the active command and attempts to terminate its process tree. Interactive terminals and persistent background jobs are not supported. This provides code execution, not dedicated image/video synthesis models; installed generators can be invoked by command. Code changes may require rebuilding/restarting Framecraft.

If Ollama reports an XML/tool-call parser error, Framecraft discards that response's partial output and retries once without streaming. Further responses in that turn also use nonstreaming mode, so text arrives when generation finishes. Completed tool calls remain in context and are not replayed by the retry. A recovery activity shows the outcome. If the fallback also fails, the task stops with the server error; updating Ollama or switching models may be necessary. Memory and connection errors are not automatically retried.

Reference: [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [chat API](https://docs.ollama.com/api/chat), [network configuration](https://docs.ollama.com/faq).
