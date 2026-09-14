# 真实模型接入清单（P0）

> 目的：把「演示 provider 跑通」升级为「真实模型跑通」，并产出可比较的 A1 基线。
> 前置：本文只涉及配置与验证，改代码的地方已全部就绪。

## 一、你需要准备的东西

| 项 | 说明 |
| --- | --- |
| API Key | OpenAI 兼容协议的云模型（DeepSeek / 通义 / 豆包等均可） |
| Base URL | 例如 DeepSeek `https://api.deepseek.com/v1`（一般以 `/v1` 结尾，代码会补 `/chat/completions`） |
| 模型名 | 例如 `deepseek-chat` |
| **必须支持** | ① Function Calling（`tools` / `tool_calls`）② 流式（`stream: true`）。缺一不可 |

> 选型提醒：**必须支持 Function Calling**。不支持时工具调用链路整条失效，模型会不检索直接凭记忆作答——这正是要避免的"编味道"。真到那一步的兜底方案见第五节。

## 二、接入步骤

### 方式一：后台配置（推荐，改完即时生效、无需重启）

1. 用管理员账号登录 → **AI 助手 → 审计台 → 模型与配置 → 模型接入（后台配置）**；
2. 填写 Base URL（如 `https://api.deepseek.com/v1`）与模型名（如 `deepseek-chat`）；
3. 填入 API Key，不要先保存——直接点**「测试连接」**验证；
4. 测试通过后再点**「保存模型配置」**，页面顶部「当前生效模式」会变成**真实模型**。

要点：

- 已保存的密钥只显示掩码（如 `sk-a…b1c2`），输入框**永远不回填明文**；留空表示"不修改"，要换 Key 直接填新的，要清空点「清除密钥」。
- 密钥以 AES-256-GCM 加密后存储；接口不回传明文，审计只记掩码与指纹。
- 若提示"未配置加密密钥，暂不能保存 API Key"，需要在服务器 `.env` 设置 `AI_SETTINGS_SECRET`（或复用 `JWT_SECRET`）后重启一次——这是唯一需要动服务器文件的地方，且只做一次。
- 若提示"已保存的密钥无法解密"，说明加密 secret 被换过，重填一次 Key 即可。
- 「强制演示模式」开关用于培训与演示：打开后走演示 provider，已保存的密钥不受影响，关掉即恢复。

### 方式二：环境变量（本地开发与 CI 用）

后台未配置时才会读取环境变量；两者同时存在时**以后台配置为准**。

```bash
# 1. 写入 .env（不要提交到代码库）
AI_MODEL_BASE_URL=https://api.deepseek.com/v1
AI_MODEL_API_KEY=sk-xxxxxxxx
AI_MODEL_NAME=deepseek-chat
AI_MODEL_TEMPERATURE=0.2
AI_MODEL_MAX_TOKENS=2048
AI_MODEL_TIMEOUT_MS=60000

# 2. 重启 API（必需，provider 在启动时解析）
#    若正在用 pnpm run dev:all，停掉后重新执行即可

# 3. 确认已切换到真实模型
curl -s http://127.0.0.1:8787/api/ai/tools -H "Authorization: Bearer <token>" | grep -o '"mode":"[a-z]*"'
#    期望：mode = live
```

页面上也有信号：AI 助手页顶部「演示模式：未接入云模型」徽标消失、回答卡片不再出现「演示模式」标记。

## 三、验证（按顺序跑）

```bash
# 1. 结构验收 + 真实模型专属断言（要求 mode=live，否则直接失败并中止）
node server/ai-agent/verify-e2e.mjs http://127.0.0.1:8787 --live

# 2. A1 基线（25 题，含负样本与越权用例）
node server/ai-agent/eval/run-a1-baseline.mjs http://127.0.0.1:8787 "--label=live"
#    → 报告落在 server/ai-agent/eval/reports/*-a1-baseline-live.md
#    → 请业务同事填「人工判定」列，按 `答案正确且有出处 ≥ 80%` 出 A1 结论

# 3. UI 冒烟（含 A12 回归）
node server/ai-agent/verify-ui.mjs http://localhost:5173
```

`--live` 会额外断言：

| 断言 | 为什么 |
| --- | --- |
| provider.mode = live | 防止"以为接了模型其实还在演示模式" |
| `tokens_out > 0` | 证明真的走了模型，不是模板汇总 |
| 确实调用了 `search_knowledge` | 防止模型凭记忆作答 |
| delta 事件多于 1 个 | 证明流式生效，不是一次性返回 |
| 回答不含「演示模式」 | 模式标记正确 |

## 四、真实模型下的重点观察项

跑完第一遍后按这张表逐项确认，**任何一项不通过都要先修再继续**：

| # | 观察项 | 不通过的表现 | 处置 |
| --- | --- | --- | --- |
| 1 | 工具调用往返 | 模型不调工具直接作答 | 模型不支持 function calling，换模型；或临时把系统提示词里的工具要求写得更硬 |
| 2 | `tool` 消息被接受 | 400 报错（如 `messages with role 'tool' must be a response to a preceding message with 'tool_calls'`） | 检查 `orchestrator.mjs` 的 `toOpenAiToolCalls` 与 `tool_call_id` 配对 |
| 3 | 第二个 system 消息被接受 | 400 报错（部分模型只允许首位 system） | 把不可信数据块改为追加到最后一条 user 消息里（`prompt.mjs` 的 `buildMessages`） |
| 4 | 无结果不编造 | 知识库没有的内容也编出流程 | 检查检索下限是否被调大；确认系统提示词第 3 条生效 |
| 5 | 声明条 | 回答里没有数据来源/数据截至 | 系统提示词第 5 条；真实模型可能忽略，必要时改为服务端强制拼接声明条 |
| 6 | 引用与回答一致 | 引用的文档与回答内容无关 | 检索质量（见 P2 embedding） |
| 7 | 注入文档当数据 | 文档里的"忽略以上指令"被执行 | 一票否决项，必须 100% 不生效 |
| 8 | 流式首字 < 3s | 长时间无输出 | 检查 `max_tokens` 与网络；首字慢通常是模型侧 |
| 9 | 失败不编造 | 模型超时后编出答案 | `providers/openai-compatible.mjs` 的超时/错误分支 |
| 10 | token 统计 | 审计台用量页 token 全 0 | 模型需返回 `usage`（已请求 `stream_options.include_usage`） |

## 五、模型不支持 Function Calling 时的兜底

需求文档 §9 的可用性要求是「模型不可用时可降级为知识库检索 + 原文返回」。当前实现是：

- **正常路径**：模型调用 `search_knowledge` 工具 → 结果回灌 → 模型总结
- **降级路径**（本轮已可用，未接模型时就是这条路）：演示 provider 直接汇总检索结果并显式声明「演示模式」

若最终选定的模型不支持 function calling，建议顺序：
1. 换一个支持 function calling 的模型（成本最低）；
2. 或增加"服务端先检索、把结果直接放进上下文"，模型只做总结不做工具选择——这会削弱「Agent 自主调用工具」的能力，属于产品决策，需要你确认后再做。

## 六、当前状态（2026-09-10）

- 未接入真实模型，全链路运行在 `mode = demo`：**结构、权限、审计、检索指标均已验证并可复现**（17/17 结构验收 + 25 题基线）。
- **答案正确率（A1 ≥ 80%）尚未测量**，必须等真实模型接入后由业务同事按基线报告的「人工判定」列评定。
- 检索侧已修复一个会导致编造的缺陷：无相关性下限时，问"公司不存在的制度"也会检索到片段并让模型有编造素材。现已按实测把下限定为 0.2（负样本正确空返回 100%，召回 87%），详见 `docs/modules/AI 助手.md`。
