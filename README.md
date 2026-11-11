# Alma Devin CLI 原生 ACP 插件

在 Alma 中选择 **Devin CLI (ACP)** 并聊天，包括连接同一台 Mac 的 Alma 手机端。
这是可安装的 Alma **integration 插件**，不是终端记录阅读器，也不是 Devin 私有 API 代理。

## 架构与已查明的接口边界

```text
Alma 手机端 → 已连接的 Mac Alma 服务 → Alma 原生 ACP 客户端 → bypass 启动层 → devin acp
```

- 采用 Devin 自带的 `acp` 子命令；聊天、模型、工具执行仍由 Devin 原生 ACP 提供。0.1.2 使用官方 `@agentclientprotocol/sdk` 做薄启动层，只在新建／加载／恢复会话后调用标准 `session/set_mode` 设为原生 `bypass`，其余请求、通知、扩展方法双向转发；不仿造 Devin 私有接口。
- 官方插件 API 的 `providers.register()` 注册的是自定义提供商，不提供注册持久化原生 ACP 配置的接口。因此本插件使用 Alma 实际支持的本机 Provider REST API，创建或复用 `type: acp` 提供商，并注册检查、刷新模型命令。
- 优先复用 `devin-cli-acp`；也会发现其他 ID 下运行 `devin acp` 的提供商。ID 冲突或多个非标准 ID 匹配时拒绝覆盖。只迁移匹配的 Devin 提供商的 `acpCommand/acpArgs` 到启动层，保留原 Devin 命令和参数，以及模型选择、启用状态、MCP 配置；不改其他提供商或全局安全设置。
- 不把 `openai-codex-auth` 的订阅 OAuth／自定义 fetch 方案套在 Devin 上。Codex CLI 的 ACP 适配器是另一个项目；Devin 已原生支持 ACP，不需要额外适配器。
- **herdr 的终端会话导入／监视与聊天 ACP 是两回事**。本插件不读取、导入、恢复或修改 herdr 记录，也不承诺导入终端里已有的 Devin 会话。
- 手机不运行 Devin。**手机端必须通过 Alma 自身的设备连接功能连接运行 Devin 的 Mac**；Mac 上 Alma 需要运行且网络可达。插件不实现设备配对、隧道或手机原生二进制，也不会打开新的公网端口。

## 前置条件与登录

1. Mac 已安装并启动 Alma。开发核对版本：Alma server **0.4.570**；旧版本接口不保证兼容。
2. Node.js 22+，Git，以及已安装、支持 `acp` 的 Devin CLI。检查：

   ```sh
   node --version
   devin version
   devin acp --help
   devin auth login
   devin auth status
   ```

3. 在 Mac 的终端交互登录自己的 Devin 账号。无需把任何 Devin token、Cookie 或 API key 填进 Alma；ACP 子进程复用本机 Devin 登录。不要将 `auth status` 的个人账号输出提交或公开。
4. Devin 必须能访问其服务端、账号有可用额度和模型权限。聊天 smoke 测试可能产生实际用量。

## 安装（推荐）

```sh
git clone https://github.com/tiensonqin/alma-devin-cli.git
cd alma-devin-cli
npm ci --ignore-scripts
npm test
npm run install:alma
npm run doctor
```

运行时使用锁定版本的官方 ACP SDK 及其依赖；`npm ci --ignore-scripts` 安装锁文件中的依赖，没有 npm 生命周期自动安装脚本。安装器：

1. 自动通过 PATH 查找 Devin，以参数数组运行 Node 启动层，再直接启动原 `devin acp`，不经过 shell。
2. 查重／复用提供商；不存在时创建 `devin-cli-acp`，不改变全局默认模型。
3. 请求 Alma 通过原生 ACP 动态发现模型，不硬编码模型目录；只有模型选择为空时才启用首个发现模型。保留已有非空选择，即使其当前不可用，交由用户确认。
4. 只将 manifest、package 元数据、`main.js`、`lib/`、`bin/` 和两个必需的运行时依赖暂存并通过 Alma 插件安装接口安装，不复制 Git 历史、测试、日志或个人配置。暂存目录随后删除。

重复安装相同版本复用已有插件和提供商；检测到旧版本时按下述升级流程重装本插件，提供商保留。
安装某步失败时，已创建的提供商可能仍存在；不会破坏性回滚或删除用户配置，可修复登录后重试。

当前仓库为 private，使用已认证的 Git 克隆再运行安装器；不保证 Alma 的 GitHub URL 下载器能认证私有仓库，不能把仓库改成 public 来绕过此限制。不要直接从未安装依赖的源码目录安装，否则启动层缺少 SDK。
安装器保存实际 Node 路径，避免把 Alma 的打包服务器误当 Node 执行器。新建提供商的 Devin 路径可用 `DEVIN_COMMAND` 指定；已有提供商保留原命令。
若直接安装只看到了插件、没有模型，请执行命令面板里的「Devin CLI：刷新原生 ACP 模型」。
不要根据网上旧文档猜测插件目录：当前安装器使用 Alma 自己的安装接口，不写应用包。

## 配置与选择模型

- 默认本机 API 为 `http://localhost:23001`。非默认端口用环境变量 `ALMA_API_URL`；安装后也需在插件设置中配置相同的 `devin.apiUrl`。仅允许无凭据的 HTTP loopback 根地址，不接受远程地址和重定向。
- 安装器可使用 `DEVIN_COMMAND` 指定本机 Devin 可执行文件；此环境变量只影响**新建**提供商。插件设置的 `devin.command` 同理；已有提供商请在 Alma 提供商设置中修改。
- 在 Alma「设置 → 提供商」找到 **Devin CLI (ACP)**，确认启用并选择账号实际支持的模型。聊天输入区的模型选择器中选择该提供商下的模型。
- 如果复用到停用的提供商，插件不会擅自启用，请自行启用。
- 手机完成与 Mac 的连接后刷新模型列表，选择同一个提供商的模型；不是选择本插件名作为另一套模型供应商。
- **本插件按用户明确要求固定使用 Bypass Permissions：所有原生工具自动放行。** Devin CLI 帮助将此语义称为 `permission_mode=dangerous`；本机 3000.12.43 实测仅传 `--permission-mode dangerous`、环境变量或独立配置给 `acp`，`session/new` 仍返回 `accept-edits`，所以不能只改启动参数就声称成功。启动层会等待标准 `session/set_mode: bypass` 成功，才向 Alma 返回已就绪会话；没有该模式或设置失败则报错，不静默降级。
- 会话中的后续 mode 设置同样保持 `bypass`。这只作用于本插件的 Devin 子进程，不写 Devin 全局配置、不修改 Alma 安全配置、不自动增加 MCP。组织强制策略仍以 Devin 服务端为准，插件不绕过组织政策。
- **高风险提示：bypass 可自动执行删除、写文件、网络命令等工具。只在可信工作区使用。** 它不是沙箱，也不会使操作变为只读。

## 升级与已存在会话

拉取代码后重新执行 `npm ci --ignore-scripts && npm run install:alma`。安装器会检测版本，只卸载／重装本插件并恢复其设置、权限授予／拒绝及停用状态；不会全局刷新所有插件。重复安装相同版本不重复重装。插件激活及检查命令也会迁移旧的原生 Devin 提供商配置，避免升级后仍沿用 `accept-edits` 启动方式。

升级不会终止或改写已运行的 ACP 会话；已有进程不会因提供商配置变更而追溯切换。请在新聊天验证，旧轮次如仍卡住，由用户在 Alma 停止该轮后新建聊天。不会自动批准已过期审批或中断其他聊天。

同版本开发修复需要重新复制文件时可执行 `npm run install:alma -- --force`，仍只重装本插件并保留其设置。迁移前会再次读取 Devin 启动配置，检测到并行变更则停止而不是覆盖；宿主 REST 接口没有原子版本锁，不能承诺跨进程写入完全无竞态。

```sh
npm run models
npm run doctor
npm run smoke
npm run smoke:tools
```

`models` 通过 Alma 原生 ACP 发现并刷新缓存；`doctor` 测试握手和模型发现；`smoke` 经 Alma 聊天 REST 接口做两轮文本对话，验证返回标记与上下文，然后用独立会话测试一次流式响应。流式测试要求收到预期文本及 SSE `[DONE]`，遇到错误事件、提前断流或无效 JSON 会失败，不把部分响应当作成功。这只是解析 Alma 已有的 SSE 输出，不是另写 Devin ACP 协议。

默认使用当前首个已启用模型，也可用 `DEVIN_TEST_MODEL` 指定已启用模型。一次 smoke 共发送三次提示，可能产生实际用量。文本 smoke 提示不使用工具；`tools: none` 只关闭 Alma 提供的工具，不构成对 Devin 内置工具的沙箱承诺。使用独立临时工作目录，测试结束删除。

`smoke:tools` 则从实际已安装提供商启动独立 ACP 子进程，用官方 SDK 检查会话模式为 `bypass`，要求执行无写入的 `printf ... | cat`，并检查真实 exec 完成事件和随机输出标记，要求权限请求数为零。测试客户端遇到意外审批会取消并报错，而不是代替原生 bypass 批准。仅关闭测试自己启动的进程。两种测试均可能产生模型用量；Alma／Devin 自身可能保留会话元数据，插件不清理它们的历史。

## 卸载

```sh
npm run uninstall:alma
```

推荐使用此命令：先把本插件管理的提供商还原为保存的原生 Devin 命令和参数，再卸载插件，避免留下指向已删除启动层的路径。**保留 ACP 提供商、模型选择、聊天和 Devin 登录**；卸载后不再保证 bypass，权限以原生默认配置为准。若直接在 Alma 插件设置删除，应先在提供商设置还原原生 Devin 命令及 `acp` 参数。若不再需要模型入口，可单独删除提供商；如需退出 Devin，在终端执行 `devin auth logout`。不要修改 Alma 应用包。

## 安全与排错

- 源代码不读取 Devin 凭据、不记录完整提供商响应、不上传个人配置；本机 API 返回的敏感字段仅在内存中传递，诊断只输出白名单字段。
- ACP 是有本地工具能力的代理，本插件明确启用全工具自动放行。只选择可信工作区；不要直接暴露 Alma 本机 API 给公网。
- 找不到命令：确认 Mac GUI 可执行的 Devin 路径，在提供商设置更正后重新测试。
- 模型发现失败：在同一 Mac 运行 `devin auth login`；确认网络、账号模型权限及 `devin acp --help`，再刷新模型。
- 模型存在但手机无入口：确认手机连的是这台运行服务的 Mac、提供商已启用、有已选模型；插件无法替代 Alma 的设备连接功能。
- 本插件依赖下面列明的 Alma REST 路由。若未来版本删除路由或限制本机插件访问，需适配公开宿主接口，不能绕过限制改写应用包。

## 依据与验证

- 官方插件规范及示例：[yetone/alma-plugins](https://github.com/yetone/alma-plugins)，本次核对的提交见 [验证记录](docs/verification.md)。检查了 `packages/plugin-api/src/index.ts`、hello-world、openai-codex-auth 及现有已安装插件。
- Codex 的独立 ACP 适配器：[agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp)；旧的 [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp) 已在 README 说明迁移。仅参考其 ACP 分层，不安装或替换现有 Codex。
- 本机 Alma 生成的 `api-spec.md` 及已安装宿主的只读接口核对。使用：`GET/POST /api/providers`、`POST /api/providers/:id/test`、`POST /api/providers/:id/models/fetch`、`PUT /api/providers/:id/models`、`POST /api/chat/completions`、插件列表／安装／卸载接口及命令注册 API。
- Devin 命令行自带帮助：`devin acp --help`、`devin auth --help`；不依赖未经证实的私有 API 文档。

手机实机配对、权限弹窗、附件、多模态、取消与长时间重连不属于当前自动化验证的通过声明，见验证记录。
