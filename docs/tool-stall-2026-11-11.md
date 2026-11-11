# Native Tools Stuck in Thinking: Evidence and Fix Boundaries

Date: 2026-11-11; all times are in Asia/Shanghai. Alma server 0.4.570, Devin CLI 3000.12.43.
This work delivers diagnostics and regression coverage, **not a runtime release that fixes the mobile incident**.

## Confirmed failure sequence

The message API, screenshots, Alma native.log, and logs from the associated Devin process were inspected read-only for the user-specified session.
The investigation did not read credentials, modify the application bundle or database, cancel the original request, terminate other sessions, rescan the home directory, or change permission configuration.

| Time | Evidence | Supported conclusion |
| --- | --- | --- |
| 21:14:21 | Workspace exec and file search both received ACP `completed` | Native tool-result delivery was not universally broken |
| 21:14:29.683 | Devin: `Permission decision for tool exec: prompting user (decision=None, perm_level=AcceptEdits)` | The exec really was waiting for approval; this cannot be inferred merely from its input state |
| 21:14:29 | Alma: `Tool part not found for toolCallId`; the source updates `permission-requested` at this point | Approval state arrived before the tool part was persisted and was not retained |
| 21:14:29.696 | Two file searches were auto-allowed, but no Searching log had appeared yet | The three tool cards at this point cannot be interpreted as three running searches |
| 21:24:29 | Alma: approval `timed out after 600000ms — auto-denying`; Devin received the denial and exec `failed` | The host automatically denied the request on timeout; **there is no evidence that the user manually denied it** |
| 21:24:29.710 | Only then did Devin log the start of two home-directory searches; ACP changed to `in_progress` | The subsequent wait was for unfinished searches, not the same exec approval |
| 21:34:29 | The host logged a stream inactivity timeout; both searches became `output-error`, reporting no tool output for 600 seconds, then entered a retry | The observed behavior was two successive periods of blocking totaling approximately twenty minutes, not proof that execution would never finish |
| 21:34:46–21:34:50 | The original session recovered on its own with two assistant replies; the message API subsequently reported `isGenerating=false` | Recovery was not caused by this work's code changes or manual cancellation; the reply's attribution of the denial to the user was inaccurate |

Relevant Alma native.log line numbers at inspection time: 37087–37100 (approval and tool start), 39278–39290 (timeout denial and search start), 42688–42695 (no-output timeout), and 42957–43022 (retry and subsequent-turn completion).
Raw logs, message bodies, screenshots, and account data are not committed.

**Avoid overstating causality:** Source inspection and isolated reproduction confirmed that the tool card lost its permission state. However, sending and waiting for the approval dialog use a separate mechanism.
The evidence does not prove that the phone failed to receive a dialog, nor distinguish between a dialog not being shown, not being noticed, or a response not reaching the host.
The two prolonged searches are confirmed, but the exact directory, system-permission call, or traversal implementation where they stalled has not been established. There is also no evidence that the plugin dropped parallel tool results.

## Where the root cause resides

The plugin only creates/reuses a provider and registers configuration-check commands; chat does not pass through a plugin-owned transport.
Native tools, approvals, message-part persistence, timeouts, and steering are handled by Alma's ACP layer and Devin's executor.

Specific locations in the locally installed host's `alma-server/lib/server.mjs`:

- `:5602`–`:5603`: The permission bridge first sends `permission-requested`, then waits for approval. A missing title is displayed as `Unknown Tool`.
- `:11251`, `handleACPToolExecutionResult()`: Looks only for an already-existing message part; if none exists, it logs a warning and returns. Only `completed/failed` use the terminal-state cache; approval state is neither cached nor replayed.
- `:2306` and `:11240`, `processACPFullStream`: Tool parts are created and saved from another asynchronous stream, creating an ordering race.
- `:4666`: The approval service waits ten minutes by default. Card state and dialog delivery are separate mechanisms.
- `:11268`–`:11274`, `chatCompletions()`: REST SSE exports only text, not native tool/approval events. Normal completion hard-codes `stop` and `[DONE]`; errors send an error event and then end the stream.

These locations come from read-only inspection of the bundled file. Line numbers may change in later versions; locate the methods by name.
The official plugin API, `packages/plugin-api/src/index.ts`, has no extension point for replacing the native ACP permission handler, message reducer, or session timeout.
Host tool hooks cannot replace Devin's internal tool executor either. Therefore, **a small patch in this repository cannot fundamentally fix this race or impose execution deadlines on native glob searches**.

## Minimal host/executor proposal (not implemented)

1. The host should retain approval state keyed by session/thread + toolCallId, replaying it when tool parts are created and streaming snapshots are merged. Terminal states must take precedence, updates must be idempotent, and older snapshots must not overwrite them.
2. Mobile approval should use a stable requestId to display the tool title, scope, and waiting state, and record delivery, response, and timeout reasons. Automatic and manual denials must be distinguished. Do not enable global auto-approval.
3. Devin file searches need bounded execution and cancellation. The host should track per-session tool deadlines, explicitly end timed-out tools, and cancel the associated prompt without restarting the service or killing other sessions. Adding `[DONE]` is not a fix.
4. Full host regression coverage should include approval-before-part, part-before-approval, parallel tools, denial/error/cancellation, snapshots arriving after terminal states, and subsequent turns. Actual mobile dialog delivery still requires physical-device verification.

Implementing fixes at this layer requires authorization to modify the corresponding host source and a testable build. This work did not patch the application bundle or database.

## Repeatable verification

```sh
npm test
npm run smoke:tools
npm run check:host
```

The default smoke test recognizes the repository-managed Devin adapter but still rejects unknown launch configurations; it does not overwrite the provider. Denial/error/cancellation checks run in an independent subprocess in auto mode, while the host integration uses the currently authorized bypass configuration. These are distinct checks.
To verify only the independent native subprocess, explicitly run `DEVIN_PROBE_COMMAND=/path/to/devin npm run smoke:tools -- --native-only`; the report marks the host integration as skipped.

`smoke:tools` incurs real Devin usage but does not depend on herdr, third-party libraries, or global tool updates:

- Creates a separate temporary directory and two small files with random contents. File contents are not placed in prompts, preventing a text-only false positive.
- Uses process-level `auto` permission mode in a newly created Devin ACP subprocess, without changing user configuration. All approvals are denied by default. The cancellation test allows only one exact, safe `sleep 20` command and does not automatically approve other commands.
- Verifies a single file tool followed by a final reply, two independent file tools reaching terminal states, an actual missing-file failure followed by a final reply, an actual denial with no file written followed by a final reply, cancellation during tool execution with `stopReason: cancelled`, and a subsequent turn in the same session after cancellation.
- Limits each native request to 90 seconds and stops only subprocesses created by the probe. The cancellation test does not wait for the full 20 seconds to elapse and misreport natural completion as successful cancellation.
- Then reads the two small files through Alma REST → native ACP. It filters terminal tool states for the independent test thread from only the newly added host-log window, requiring at least two actual completions. It also checks a missing-file failure followed by a final reply and a follow-up turn. All three rounds check SSE `[DONE]`, with expected markers checked where applicable. Log contents are neither printed nor saved in the repository.
- `tools: none` disables only Alma's additional tools, not Devin's native tools. Actual ACP logs, rather than that field, establish whether tools executed.
- **REST does not expose the mobile generation state or approval/cancellation lifecycle.** Passing native denial/error/cancellation checks does not establish that the same interactions work on mobile or that a fix has been delivered.

`check:host` extracts a single reducer from the installed host and runs it in a separate VM context with synthetic in-memory interfaces. It does not import or start the entire service.
On 0.4.570, approval state is lost when it arrives before the part, and the command exits with code **1**. Denial and error terminal states pass once the part exists. This failure is deliberately retained as evidence of the host regression; assertions are not changed to produce a false pass.
This is not a general-purpose test covering future host implementations. If the method structure is unrecognized, it must stop rather than infer success.

The repair task reported 29 passing `npm test` unit regressions. `check:host` reproduced the failure described above; it is not counted as fixed. The first full real-tool run passed with a native provider. After additional authorization, the currently installed bypass host integration was rerun; see the [verification record](verification.md) for final results. These results were supplied by the repair task, not by additional runtime tests in the documentation translation task.
The initial cancellation attempt used a millisecond-scale file read, which completed normally before cancellation and returned `end_turn`; that attempt did not count as a pass. Cancellation was verified only after switching to a bounded sleep with a clear execution window.

## Existing-session recovery and the local plugin

The original session recovered on its own during this investigation; deleting chats or canceling existing requests is unnecessary. If the phone still shows the old Thinking state, reopen the session to refresh its server-side state.
When continuing work on a project, provide the exact directory and set the workspace to that project before sending a new message. Steering is queued input and is not guaranteed to interrupt a running native search.
If the issue recurs, first inspect that session's tool details/approval. If necessary, stop only the current generation in that session, confirm server-side `isGenerating=false`, then continue. Do not repeatedly append steering, restart the service, or terminate other sessions.

The initial remote baseline was `6c87f1c`. Fast-forwards preserved remote `700e10d` (0.1.1) and `5e13d90` (0.1.2) without overwriting others' commits. The repair work adds diagnostic scripts, regressions, and documentation, while retaining the installed and already-pushed 0.1.2 runtime. **Neither diagnostics nor bypass are presented as a fix for the host race.**

Version 0.1.1 was installed when the investigation began. Another task changed the provider command at 21:41:56 and subsequently installed 0.1.2; the user confirmed that another task may have made the change. Validation was initially paused because full permissions had not been authorized. The user later explicitly authorized bypass/YOLO for Codex and Devin CLI and allowed changing the global default model, so the bypass implementation was retained and integrated. Codex's official adapter environment option was set through the supported Provider PUT API; the default model was not changed unnecessarily.
These diagnostic additions do not change the plugin runtime, so no reinstall was performed solely for the repository scripts; the installed runtime version was checked separately. The installer now packages the manifest, package.json, main.js, lib, bin, and required dependencies, and provides targeted upgrades that preserve settings.
The host's `/api/plugins/:id/update` supports only marketplace installs or an existing GitHub installUrl, not local sourcePath updates. `POST /api/plugins` with the same ID only reuses the old plugin and cannot overwrite it.
`/api/plugins/refresh` reloads all plugins rather than updating one local plugin, so it was not called. Any future actual runtime fix must use the supported targeted installation flow and verify/preserve existing settings and permissions. Directly overwriting the plugin directory or presenting a global refresh as an update is not acceptable.
