# 验证记录

日期：2026-11-11。仅记录脱敏结果，不包含账号、凭据、个人配置、会话记录或本机绝对路径。

## 0.1.2：Devin 专属 Bypass

本次按用户明确授权将插件管理的 Devin 会话固定为全工具自动放行，没有修改其他提供商或全局权限配置。

- 核对本机 `devin --help`：`permission_mode=dangerous` 表示自动批准所有工具。
- 分别实测 `--permission-mode dangerous acp`、`DEVIN_PERMISSION_MODE=dangerous`、独立 `--config` 文件；原生 `session/new` 均仍返回 `accept-edits`，因此这些选项不足以证明 ACP 已进入 bypass。
- 原生 ACP 实际公布 `bypass`（Bypass Permissions）模式。使用官方 `@agentclientprotocol/sdk@2.6.0` 和标准 `session/set_mode` 设置后，原生发出 `current_mode_update: bypass`。启动层只处理模式约束，其余协议双向转发，不添加私有方法。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 20 项通过：包含旧提供商迁移、并行修改拒绝、幂等安装、升级保留设置／权限／停用状态、卸载还原原命令、标准 new/load/resume 模式约束、双向扩展和通知转发、能力缺失拒绝降级，以及原有聊天／SSE 回归 |
| 本机升级 | 从 0.1.1 升至 0.1.2，插件启用，仍复用唯一 `devin-cli-acp`；安装器支持同版本 `--force` 复制更新，没有全局刷新其他插件 |
| 配置范围 | 对比升级前后其他提供商字段：只有宿主动态生成的 `createdAt/updatedAt` 发生变化，其他配置字段未变；提供商总数未变 |
| 真实模型发现 | 安装时经 Alma 原生 ACP 发现 144 个模型 |
| `npm run doctor` | 经本机 Alma 连接成功 |
| `npm run smoke` | 经 Alma 的两轮上下文和独立 SSE 流式聊天均通过 |
| `npm run smoke:tools` | 使用实际安装的提供商启动独立 ACP，确认原生 mode 更新为 bypass；1 次 exec 已完成并返回随机标记；权限请求数为 0 |
| 经 Alma 的真实工具链路 | 独立测试聊天使用 SWE-2 High 执行只读 `printf ... \| cat` 后返回随机标记；该测试关联的原生日志显示 `Permission decision for tool exec: auto-decided Some(Allow) by cog`，没有 `prompting user` |

### 本次仍存在的边界

- 没有替用户在手机触屏上重试；宿主链路及原生模式已验证，手机仍须连接运行 Devin 的 Mac。
- 未终止或改写用户已有 ACP 进程、故障 thread 或旧的待审批轮次；启动配置变更不会追溯改变旧进程。需要在新聊天验证，旧轮次由用户自行停止。
- 先前宿主“审批早于工具部分持久化”的竞态并未修改。原生 bypass 避免普通工具进入该审批路径，不等于修复 Alma 的通用审批 UI；组织强制审批仍可能产生请求。
- 真实原生 new／工具已测；load/resume 的模式约束使用模拟原生端回归测试，没有加载用户现有会话来测试。云模式、组织强制策略、附件、断线恢复仍未验证。
- 宿主 Provider REST 没有原子版本锁。插件迁移前二次读取以避免明显的并行覆盖，但不能保证读取与写入之间完全没有外部修改。

以下为先前版本的历史验证记录，不代表 0.1.2 仍只使用直接 `devin acp` 启动参数。

## 依据与环境

- 当前工作区及已检查祖先目录未发现 `AGENTS.md`；官方 Alma 插件仓库也未发现该文件。
- 官方插件仓库 `yetone/alma-plugins` 核对提交：`a7fa8285cf263afbd73a1f59b48ce02b753da2b8`。
- 检查官方插件规范、`packages/plugin-api/src/index.ts`、hello-world、openai-codex-auth，以及本机已安装插件结构。
- 检查旧 `zed-industries/codex-acp` README（提交 `296069e841634cd4bb9bc4515602d836e49231ec`）及其指向的新 `agentclientprotocol/codex-acp` README；确认 Codex 独立适配器与 Devin 原生 ACP 的区别。
- 只读核对本机 Alma 的 Provider／插件 REST 路由、ACP 模型发现和聊天消息转换；没有改动 Alma 应用包或数据库。
- Alma server：0.4.570。Devin CLI：3000.12.43（517d03d73926）。Node.js：24.13.0。
- 已有 `devin-cli-acp` 提供商，启用状态为 true，原生命令参数为 `devin acp`；安装过程中复用，没有另建提供商，没有改全局默认模型。

## 已通过

| 检查 | 结果 |
| --- | --- |
| `npm test` | 15 项通过：包含去重、冲突拒绝、安装卸载、消息格式、两轮上下文、分片 UTF-8／CRLF／多行 SSE、提前断流、流内错误脱敏、格式错误、事件大小限制及 HTTP 错误回归 |
| 实际安装 | 0.1.1 已经实际卸载重装；Alma 接受 manifest、加载 ESM 模块，权限已授予，插件 enabled |
| 重复安装 | 复用现有插件及提供商，无重复记录 |
| 实际卸载／重装 | 卸载插件成功，提供商保留；重装成功，Devin ACP 提供商仍只有 1 个 |
| 插件命令 | `alma-devin-cli.status` 与 `alma-devin-cli.refreshModels` 经宿主命令执行接口成功 |
| 原生连接 | `npm run doctor` 握手、初始化会话及模型发现成功 |
| 原生模型目录 | Alma 调用 Devin ACP 发现 144 个模型，不使用硬编码目录 |
| 模型选择器接口 | `GET /api/models` 返回同一个 `devin-cli-acp` 下 144 个可选模型入口 |
| 两轮聊天 | `npm run smoke`，已启用模型 `adaptive`，两轮都返回 `ALMA_DEVIN_OK` |
| 流式聊天 | 0.1.1 的 `npm run smoke` 实测 `stream: passed`、6 个非空文本分片，收到预期标记及 SSE `[DONE]`；不再依赖一次性的手动验证命令 |

首次聊天测试曾使用 OpenAI 风格 `content` 消息，宿主返回 `Invalid prompt: messages must not be empty`。
只读核对宿主后改用 Alma 实际要求的 `{ id, role, parts: [{ type: 'text', text }] }`，新增回归测试，重新执行两轮聊天通过。没有修改宿主来迁就测试。

## 尚未实测／限制

- 没有手机实机配对和触屏交互测试。模型入口在 Mac 的共享服务侧验证，不等同于已证实手机完成配对。
- 手机必须连接运行 Devin 的 Mac；插件没有权限／接口实现 Alma 手机设备配对或替代 Mac 服务。
- 权限弹窗、附件、多模态、取消、长时间断线恢复和 Devin 云模式未验证。文本及流式通过不等于这些特性也通过。
- 真机环境已经存在提供商，所以“全新环境创建”走了模拟宿主集成测试，没有为了测试删除现有提供商。新插件的真实安装／卸载已经验证。
- 原生提供商独立于插件保存；卸载插件后模型入口可继续存在，这是保护已有配置的设计，不是卸载失败。
- 宿主 ACP 层负责会话生命周期；smoke 使用独立会话标识，不清理 Alma／Devin 自身保留的历史元数据。
- 私有仓库推荐认证 Git 克隆＋本地安装器；未宣称 Alma 的 GitHub URL 下载器能认证 private 仓库。
