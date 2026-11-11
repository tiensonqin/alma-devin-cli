# 验证记录

日期：2026-11-11。仅记录脱敏结果，不包含账号、凭据、个人配置、会话记录或本机绝对路径。

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
