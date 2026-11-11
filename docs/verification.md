# Verification Record

Date: 2026-11-11. Only sanitized results are recorded; no accounts, credentials, personal configuration, session records, or local absolute paths are included.

## 0.1.2: Devin-only bypass

With the user's explicit authorization, this version enforces automatic approval for all tools in plugin-managed Devin sessions. It does not change other providers or global permission configuration.

- Checked local `devin --help`: `permission_mode=dangerous` means automatically approving all tools.
- Tested `--permission-mode dangerous acp`, `DEVIN_PERMISSION_MODE=dangerous`, and a separate `--config` file individually. Native `session/new` still returned `accept-edits` in each case, so these options do not establish that ACP has entered bypass mode.
- Native ACP actually advertises `bypass` (Bypass Permissions) mode. After setting it with the official `@agentclientprotocol/sdk@2.6.0` and standard `session/set_mode`, the native process emitted `current_mode_update: bypass`. The launcher only enforces the mode; all other protocol traffic is forwarded in both directions, without private methods.

| Check | Result |
| --- | --- |
| `npm test` | 20 passed, including legacy provider migration, concurrent-change rejection, idempotent installation, preserving settings/permissions/disabled state during upgrades, restoring the original command on uninstall, standard new/load/resume mode enforcement, bidirectional extension and notification forwarding, rejecting fallback when capabilities are missing, and existing chat/SSE regressions |
| Local upgrade | Upgraded from 0.1.1 to 0.1.2; the plugin is enabled and still reuses the single `devin-cli-acp` provider. The installer supports same-version copying with `--force`, without globally refreshing other plugins |
| Configuration scope | Compared other providers before and after the upgrade: only host-generated `createdAt/updatedAt` changed; all other configuration fields and the total provider count were unchanged |
| Real model discovery | Discovered 144 models through Alma's native ACP during installation |
| `npm run doctor` | Connected successfully through local Alma |
| `npm run smoke` | Both the two-turn context check through Alma and the independent SSE streaming chat passed |
| `npm run smoke:tools` (at that version; now `npm run smoke:bypass`) | Started independent ACP using the actually installed provider and confirmed a native mode update to bypass; one exec completed with a random marker; zero permission requests |
| Real tool execution through Alma | A separate test chat used SWE-2 High to run read-only `printf ... \| cat` and return a random marker. Native logs associated with that test showed `Permission decision for tool exec: auto-decided Some(Allow) by cog`, with no `prompting user` |

### Remaining limitations of this work

- No touch interaction was retried on the user's phone. The host integration and native mode were verified; the phone still needs to connect to the Mac running Devin.
- Existing user ACP processes, the affected thread, and old pending-approval turns were not terminated or rewritten. Launch configuration changes do not retroactively affect old processes. Verify in a new chat; the user must stop old turns themselves.
- The host race where approval arrives before tool-part persistence was not modified. Native bypass keeps ordinary tools off that approval path; it does not fix Alma's general approval UI. Organization-enforced approvals may still generate requests.
- At this stage, real native session creation and tool execution were tested, while mode enforcement for load/resume was covered only by regression tests against a mock native endpoint. The later investigation verified real new/load behavior using its own test sessions, as recorded below; resume remains mock-only. Existing user sessions were not loaded for testing. Cloud mode, organization-enforced policies, attachments, and reconnection remain unverified.
- The host Provider REST API has no atomic version lock. The plugin rereads before migration to avoid obvious concurrent overwrites, but cannot guarantee that no external change occurs between reading and writing.

The following sections preserve the investigation addendum and historical verification records. Earlier records do not mean that 0.1.2 still relies only on direct `devin acp` launch arguments.

## Tool-stall investigation addendum (21:14 incident)

**Approval waiting and subsequent searches producing no output are confirmed; the host race remains unfixed.** The user later explicitly authorized bypass/YOLO for both CLIs. The remote 0.1.2 Devin bypass implementation was retained and integrated to keep ordinary tools off that approval path. This does not fix unbounded search or the mobile approval UI. See [evidence, the minimal host-side proposal, and existing-session recovery](tool-stall-2026-11-11.md). The original session recovered on its own at approximately 21:34:50; this work did not cancel it.

The repair task reported the following final verification results; these are not additional runtime tests performed by the documentation translation task:

- Current `npm test`: 29 passed, covering 0.1.2 mode/upgrade regressions plus new probe cases for permission denial, cancellation notifications, deadlines, process startup failure/exit, merging concurrent terminal states, and rejection of unknown adapters.
- `npm run smoke:tools`: real bounded file-tool execution followed by a final reply, multiple tool results, a missing-file error, denial, cancellation during a `sleep 20` execution, and a subsequent turn passed. Through the current Alma bypass provider, two file tools completed, a missing-file tool reached a failed terminal state followed by a final reply, and all three SSE rounds received `[DONE]`, including a follow-up turn. Host-log evidence was scoped to the independent test thread.
- `npm run smoke:bypass`: native bypass mode, a completed exec, and zero approval requests passed.
- Real ACP new/load checks passed for both configured providers using only newly created test sessions and random fixture files. Each check created a session, performed an actual file read followed by a final reply, closed its subprocess gracefully, then started a new subprocess and used `session/load` with the same test session ID. A fresh file-read tool call after loading also completed with a final reply. Devin remained in `bypass` for both new and loaded sessions; Codex remained in `agent-full-access`. Both providers had zero permission requests. User sessions were untouched, and only test fixture directories were removed. Resume remains covered only by mock regression tests.
- `npm run check:host`: executing the installed host's reducer in isolation **consistently fails (exit code 1)** when approval arrives before the tool part. This is an unfixed host regression and is not counted as a pass.
- Native ACP denial/error/cancellation verification is not mobile UI verification. REST exports only text and cannot verify mobile approval visibility or the Thinking state.
- No application bundle, database, or global tool was modified. Although changing the global default model was authorized, it was not changed unnecessarily for troubleshooting. Codex's launch command/arguments alone were changed through Provider REST, preserving its model selection and other settings without terminating existing sessions.
- The latest supported `npm run install:alma` check reported `installed=true`, `upgraded=false` (0.1.2 was already installed), `enabled=true`, `reusedProvider=true`, `permissionMode=bypass`, and `discoveredModels=146`. This is a later discovery result, not a correction to the historical count of 144. Existing model selections were preserved. Hash comparisons confirmed that six installed runtime files matched the repository; no unnecessary reinstall or global refresh was performed.

### Concurrent changes and validation isolation

When the first complete tool smoke test passed, the provider still used native `devin acp`. A later rerun refused to continue because another task had changed the provider to a Node adapter; it did not overwrite that change.
After read-only inspection, the user explicitly authorized bypass/YOLO. The repository was then fast-forwarded to remote `5e13d90`, preserving the currently installed 0.1.2: `lib/bypass.mjs` enforces `session/set_mode: bypass` after new/load/resume and also rewrites subsequent mode changes. The other task's configuration was not rolled back or misrepresented as a fix for the host race.
For a recognized Devin adapter, `smoke:tools` extracts the native command, runs independent denial/error/cancellation regressions in auto mode, then verifies host tools and SSE through the current Alma provider. `smoke:bypass` specifically checks bypass and zero approvals in the installed adapter. Unknown adapters are still rejected. `--native-only` explicitly skips the host integration.

### Basis for Codex configuration

The locally installed `@agentclientprotocol/codex-acp@2.6.0` README explicitly supports `INITIAL_AGENT_MODE=agent-full-access`. The implementation maps this mode to `approvalPolicy: never` and `dangerFullAccess`. The two permission keys in ordinary `CODEX_CONFIG` are insufficient to change that adapter's default mode; this was demonstrated in an independent new session that still returned `agent`.
Using `PUT /api/providers/codex-acp`, the launcher was set to `/usr/bin/env`, with the environment assignment above and the existing adapter path as arguments. The original model, enabled state, and other provider fields were preserved. A new independent ACP session returned `currentModeId: agent-full-access`; no global tool update or restart of other sessions was needed.
The repair task also reported two random-file tool completions followed by a final reply, a follow-up turn, and zero approval requests in a new Codex ACP session. Through Alma, the two file replies, both SSE `[DONE]` markers, and the follow-up passed. A bounded 2 MiB host-log tail confirmed two real tool completions for the unique test thread. These checks mitigate the approval-wait path; they do not establish a fix for the host race or search stalls.

## Sources and environment

- No `AGENTS.md` was found in the current workspace or the checked ancestor directories, nor in the official Alma plugin repository.
- Checked commit in the official plugin repository, `yetone/alma-plugins`: `a7fa8285cf263afbd73a1f59b48ce02b753da2b8`.
- Reviewed the official plugin specification, `packages/plugin-api/src/index.ts`, hello-world, openai-codex-auth, and the structure of locally installed plugins.
- Reviewed the old `zed-industries/codex-acp` README at commit `296069e841634cd4bb9bc4515602d836e49231ec` and the new `agentclientprotocol/codex-acp` README it links to, confirming the distinction between Codex's separate adapter and Devin's native ACP.
- Inspected local Alma Provider/plugin REST routes, ACP model discovery, and chat-message conversion read-only; no Alma application bundle or database changes were made.
- Alma server: 0.4.570. Devin CLI: 3000.12.43 (517d03d73926). Node.js: 24.13.0.
- A `devin-cli-acp` provider already existed with enabled state true and native command/arguments `devin acp`. Installation reused it, without creating another provider or changing the global default model.

## Historical passed checks

| Check | Result |
| --- | --- |
| `npm test` | 15 passed, covering deduplication, conflict rejection, install/uninstall, message format, two-turn context, split UTF-8/CRLF/multiline SSE, premature disconnection, sanitization of in-stream errors, malformed input, event-size limits, and HTTP errors |
| Actual installation | 0.1.1 was actually uninstalled and reinstalled; Alma accepted the manifest, loaded the ESM module, granted permissions, and enabled the plugin |
| Repeat installation | Reused the existing plugin and provider without duplicate records |
| Actual uninstall/reinstall | Plugin removal succeeded and preserved the provider; reinstallation succeeded, with exactly one Devin ACP provider remaining |
| Plugin commands | `alma-devin-cli.status` and `alma-devin-cli.refreshModels` succeeded through the host command-execution API |
| Native connection | `npm run doctor` completed the handshake, session initialization, and model discovery |
| Native model catalog | Alma discovered 144 models through Devin ACP, without a hard-coded catalog |
| Model-selector API | `GET /api/models` returned 144 selectable model entries under the same `devin-cli-acp` provider |
| Two-turn chat | `npm run smoke`, using enabled model `adaptive`, returned `ALMA_DEVIN_OK` in both turns |
| Streaming chat | The 0.1.1 `npm run smoke` returned `stream: passed`, six nonempty text chunks, the expected marker, and SSE `[DONE]`; it no longer relies on a one-off manual verification command |

The first chat test used OpenAI-style `content` messages, and the host returned `Invalid prompt: messages must not be empty`.
After inspecting the host read-only, the test was changed to Alma's required `{ id, role, parts: [{ type: 'text', text }] }` format. A regression test was added, and the two-turn chat passed on rerun. The host was not modified to accommodate the test.

## Untested features and limitations

- No physical mobile pairing or touch-interaction testing was performed. Model entries were verified on the Mac's shared service; that does not establish successful phone pairing.
- The phone must connect to the Mac running Devin. The plugin has no permission or API to implement Alma mobile device pairing or replace the Mac service.
- Mobile permission dialogs, attachments, multimodal input, recovery after long disconnections, and Devin cloud mode remain unverified. Cancellation was additionally tested only with an independent native ACP probe, not on mobile. Passing text and streaming tests does not establish that these features work.
- A provider already existed in the real environment, so creation in a fresh environment was covered by a mock-host integration test. The existing provider was not deleted just for testing. Actual installation/uninstallation of the new plugin was verified.
- Native providers are stored independently of plugins. Model entries may remain after uninstalling the plugin; this preserves existing configuration and is not an uninstall failure.
- The host ACP layer owns session lifecycle management. Smoke tests use independent session identifiers and do not clear historical metadata retained by Alma/Devin themselves.
- Authenticated Git cloning followed by the local installer is recommended for private repositories. No claim is made that Alma's GitHub URL downloader can authenticate to private repositories.
