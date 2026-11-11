# Alma Devin CLI Native ACP Plugin

Select **Devin CLI (ACP)** in Alma to chat, including from the Alma mobile app connected to the same Mac.
This is an installable Alma **integration plugin**, not a terminal transcript reader or a proxy for Devin's private APIs.

> **Known limitations when tools remain in Thinking (Alma 0.4.570):** Approval state is confirmed to be lost when it arrives before the tool part is persisted. One observed incident also involved home-directory searches producing no output for ten minutes. The plugin does not control the host's ACP lifecycle, and passing the text-only SSE test in 0.1.1 does not establish that tools work on mobile. See [incident evidence and the minimal host-side proposal](docs/tool-stall-2026-11-11.md). This work provides diagnostics and regression coverage; it does not claim to have fixed the mobile issue.

## Regression checks with real tools

```sh
npm run smoke:tools
npm run check:host
```

The first command uses small temporary files to verify native file tools, multiple tools, errors, denials, cancellation during execution, subsequent turns, and Alma SSE with actual terminal tool states. It may incur real model usage and does not depend on herdr.
The second command inspects the host read-only and reproduces the permission race in isolated, synthetic memory. The known-affected version, 0.4.570, should exit with code 1; this does not mean the repository's unit tests failed. A passing native probe does not establish that mobile approval and cancellation interactions work.
The tool smoke test recognizes the repository-managed Devin adapter but rejects unknown launch configurations and never overwrites the provider. Use `DEVIN_PROBE_COMMAND=/path/to/devin npm run smoke:tools -- --native-only` to test only an independent native subprocess; its results do not validate the currently installed host integration.

## Architecture and established API boundaries

```text
Alma mobile app → connected Mac's Alma service → Alma native ACP client → bypass launcher → devin acp
```

- Uses Devin's built-in `acp` subcommand; chat, models, and tool execution still come from Devin's native ACP implementation. Version 0.1.2 uses the official `@agentclientprotocol/sdk` for a thin launcher. After creating, loading, or resuming a session, it calls the standard `session/set_mode` method to select native `bypass` mode. All other requests, notifications, and extension methods are forwarded in both directions; it does not imitate Devin's private APIs.
- The official plugin API's `providers.register()` registers custom providers, but offers no API for registering persistent native ACP configurations. This plugin therefore uses Alma's supported local Provider REST API to create or reuse a `type: acp` provider and registers status-check and model-refresh commands.
- Prefers reusing `devin-cli-acp` and also detects providers running `devin acp` under other IDs. It refuses to overwrite an ID conflict or multiple matching nonstandard IDs. Only the matching Devin provider's `acpCommand/acpArgs` are migrated to the launcher. The original Devin command and arguments, model selection, enabled state, and MCP configuration are preserved; other providers and global security settings are not changed.
- Does not apply the subscription OAuth/custom fetch approach from `openai-codex-auth` to Devin. The Codex CLI ACP adapter is a separate project; Devin already supports ACP natively and does not need an additional adapter.
- **herdr's terminal-session import/monitoring and chat ACP are separate features.** This plugin does not read, import, restore, or modify herdr records, and does not promise to import existing terminal-based Devin sessions.
- Devin does not run on the phone. **The mobile app must use Alma's own device-connection feature to connect to the Mac running Devin.** Alma must be running and reachable on that Mac. The plugin does not implement device pairing, tunnels, or native mobile binaries, and does not open new public network ports.

## Prerequisites and sign-in

1. Alma is installed and running on the Mac. Development was checked against Alma server **0.4.570**; compatibility with older APIs is not guaranteed.
2. Node.js 22+, Git, and an installed Devin CLI with `acp` support. Check with:

   ```sh
   node --version
   devin version
   devin acp --help
   devin auth login
   devin auth status
   ```

3. Sign in interactively to your own Devin account in the Mac's terminal. No Devin token, cookie, or API key needs to be entered into Alma; the ACP subprocess reuses the local Devin login. Do not commit or publish the personal account output from `auth status`.
4. Devin must be able to reach its servers, and the account must have available usage and access to the selected model. Chat smoke tests may incur real usage.

## Installation (recommended)

```sh
git clone https://github.com/tiensonqin/alma-devin-cli.git
cd alma-devin-cli
npm ci --ignore-scripts
npm test
npm run install:alma
npm run doctor
```

The runtime uses pinned versions of the official ACP SDK and its dependencies. `npm ci --ignore-scripts` installs the dependencies from the lockfile; there is no automatic npm lifecycle installation script. The installer:

1. Finds Devin on PATH, launches the Node wrapper with an argument array, then starts the original `devin acp` directly without a shell.
2. Checks for and reuses an existing provider, or creates `devin-cli-acp` if none exists, without changing the global default model.
3. Asks Alma to discover models dynamically through native ACP rather than using a hard-coded catalog. It enables the first discovered model only if the model selection is empty. Existing nonempty selections are preserved even if currently unavailable, leaving the decision to the user.
4. Stages only the manifest, package metadata, `main.js`, `lib/`, `bin/`, and the two required runtime dependencies, then installs them through Alma's plugin installation API. Git history, tests, logs, and personal configuration are not copied. The staging directory is removed afterward.

Reinstalling the same version reuses the existing plugin and provider. If an older version is detected, the plugin is reinstalled using the upgrade procedure below; the provider is preserved.
If an installation step fails, an already-created provider may remain. The installer does not destructively roll back or delete user configuration; fix the login issue and retry.

The repository is currently private. Clone it with authenticated Git, then run the installer. Alma's GitHub URL downloader is not guaranteed to authenticate to private repositories; do not make the repository public to work around this limitation. Do not install directly from a source directory without installing its dependencies, or the launcher will lack the SDK.
The installer saves the actual Node executable path so Alma's bundled server is not mistaken for a Node runtime. Use `DEVIN_COMMAND` to specify Devin's path for a new provider; existing providers retain their original command.
If direct installation shows the plugin but no models, run the **Devin CLI: Refresh Native ACP Models** command from the command palette.
Do not guess plugin directory paths from outdated online documentation: the installer uses Alma's own installation API and does not write to the application bundle.

## Configuration and model selection

- The default local API is `http://localhost:23001`. For a nondefault port, set the `ALMA_API_URL` environment variable and, after installation, configure the same address in the plugin's `devin.apiUrl` setting. Only credential-free HTTP loopback root URLs are allowed; remote addresses and redirects are rejected.
- The installer accepts `DEVIN_COMMAND` to specify the local Devin executable; this environment variable affects only **new** providers. The plugin's `devin.command` setting behaves the same way. For existing providers, change the command in Alma's provider settings.
- In Alma's **Settings → Providers**, find **Devin CLI (ACP)**, confirm that it is enabled, and select models your account actually supports. Choose a model under that provider in the chat input's model selector.
- If a disabled provider is reused, the plugin does not enable it automatically; enable it yourself.
- After connecting the phone to the Mac, refresh the model list and select a model from the same provider. The plugin name is not a separate model provider to select.
- **At the user's explicit request, this plugin enforces Bypass Permissions: all native tools are automatically allowed.** Devin CLI help calls this behavior `permission_mode=dangerous`. However, on local version 3000.12.43, passing only `--permission-mode dangerous`, environment variables, or a separate configuration to `acp` still produced `accept-edits` from `session/new`. Changing launch arguments alone is therefore not proof of success. The launcher waits for standard `session/set_mode: bypass` to succeed before returning a ready session to Alma. If the mode is unavailable or setting it fails, the launcher reports an error rather than silently falling back.
- Subsequent mode changes in the session also remain in `bypass`. This applies only to this plugin's Devin subprocesses: it does not write Devin's global configuration, change Alma's security configuration, or automatically add MCP integrations. Organization-enforced policies remain subject to Devin's server; the plugin does not bypass them.
- **High-risk behavior: bypass can automatically run tools that delete or write files, execute network commands, and more. Use it only in trusted workspaces.** It is not a sandbox and does not make operations read-only.

## Upgrades and existing sessions

After pulling the code, rerun `npm ci --ignore-scripts && npm run install:alma`. The installer detects the version, uninstalls/reinstalls only this plugin, and restores its settings, permission grants/denials, and disabled state. It does not globally refresh all plugins. Reinstalling the same version does not trigger another reinstall. Plugin activation and status-check commands also migrate older native Devin provider configurations so upgrades do not leave them using the `accept-edits` launch configuration.

Upgrading does not terminate or rewrite running ACP sessions. Existing processes do not retroactively change when provider configuration changes. Verify in a new chat; if an old turn remains stuck, stop that turn in Alma yourself and start a new chat. The plugin does not automatically approve expired requests or interrupt other chats.

To copy updated files for a development fix without changing the version, run `npm run install:alma -- --force`. This still reinstalls only this plugin and preserves its settings. Before migration, the installer rereads Devin's launch configuration and stops rather than overwriting a detected concurrent change. The host REST API has no atomic version lock, so cross-process writes cannot be guaranteed race-free.

```sh
npm run models
npm run doctor
npm run smoke
npm run smoke:tools
npm run smoke:bypass
```

`models` discovers models through Alma's native ACP and refreshes the cache. `doctor` tests the handshake and model discovery. `smoke` runs two text-conversation turns through Alma's chat REST API, checks the response marker and context, then tests a streaming response in a separate session. The streaming test requires both the expected text and SSE `[DONE]`; error events, premature disconnection, or invalid JSON cause failure. Partial responses do not count as success. This only parses Alma's existing SSE output; it is not a separate implementation of Devin's ACP protocol.

The first currently enabled model is used by default. Set `DEVIN_TEST_MODEL` to select another enabled model. A text smoke run sends three prompts and may incur real usage. Text smoke prompts do not use tools; `tools: none` only disables Alma-provided tools and is not a sandbox guarantee for Devin's built-in tools. The test uses a separate temporary working directory and removes it afterward.

`smoke:tools` extracts the native command from the recognized installed Devin provider and runs independent file-tool, multiple-tool, error, denial, in-flight cancellation, and follow-up checks in `auto` mode. It then checks actual tool results and SSE through the current Alma provider using its authorized bypass configuration. See the [incident report](docs/tool-stall-2026-11-11.md) for the test boundaries.

`smoke:bypass` starts an independent ACP subprocess using the actually installed provider. It uses the official SDK to check that the session mode is `bypass`, requests a non-writing `printf ... | cat` command, and checks for an actual completed exec event and a random output marker, with zero permission requests. If an unexpected approval request occurs, the test client cancels and fails rather than approving on behalf of native bypass. It closes only processes it started. These tests may incur model usage; Alma/Devin may retain their own session metadata, and the plugin does not clear their history.

## Uninstallation

```sh
npm run uninstall:alma
```

Use this command: it first restores the saved native Devin command and arguments for the provider managed by this plugin, then uninstalls the plugin, avoiding paths to a deleted launcher. **The ACP provider, model selection, chats, and Devin login are preserved.** Bypass is no longer guaranteed after uninstalling; native default permissions apply. If deleting the plugin directly in Alma's plugin settings, first restore the native Devin command and `acp` arguments in the provider settings. Delete the provider separately if you no longer need its model entries. To sign out of Devin, run `devin auth logout` in the terminal. Do not modify the Alma application bundle.

## Security and troubleshooting

- The source does not read Devin credentials, log full provider responses, or upload personal configuration. Sensitive fields returned by the local API are passed only in memory, and diagnostics output only allowlisted fields.
- ACP is an agent with local tool capabilities, and this plugin explicitly enables automatic approval for all tools. Use only trusted workspaces, and do not expose Alma's local API directly to the public internet.
- Command not found: confirm the Devin executable path available to the Mac GUI, correct it in provider settings, and retest.
- Model discovery fails: run `devin auth login` on the same Mac, check network access, account model permissions, and `devin acp --help`, then refresh models.
- Models exist but do not appear on mobile: confirm that the phone is connected to the Mac running the service, the provider is enabled, and models are selected. The plugin cannot replace Alma's device-connection feature.
- This plugin depends on the Alma REST routes listed below. If a future version removes them or restricts local plugin access, the plugin must be adapted to the host's public interfaces; modifying the application bundle to bypass restrictions is not acceptable.

## References and verification

- Official plugin specification and examples: [yetone/alma-plugins](https://github.com/yetone/alma-plugins). See the [verification record](docs/verification.md) for the checked commit. The review covered `packages/plugin-api/src/index.ts`, hello-world, openai-codex-auth, and existing installed plugins.
- Codex's standalone ACP adapter: [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp). The old [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp) README documents the migration. Only its ACP layering was used as a reference; this plugin does not install or replace the existing Codex installation.
- Alma's locally generated `api-spec.md` and read-only inspection of the installed host's interfaces. Interfaces used: `GET/POST /api/providers`, `POST /api/providers/:id/test`, `POST /api/providers/:id/models/fetch`, `PUT /api/providers/:id/models`, `POST /api/chat/completions`, plugin list/install/uninstall endpoints, and the command registration API.
- Devin's built-in CLI help: `devin acp --help` and `devin auth --help`; no reliance on unverified private API documentation.

Physical mobile pairing, permission dialogs, attachments, multimodal input, cancellation, and long disconnections/reconnections are not included in the current automated pass claims. See the verification record.
