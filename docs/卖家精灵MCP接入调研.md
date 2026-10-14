# 卖家精灵（SellerSprite）MCP 服务接入调研

- 调研时间：2026-09-16
- 调研方式：官方文档页面原文抓取 + 对 `https://mcp.sellersprite.com/mcp` 的 HTTP 实测探测（curl）+ 社区文章交叉验证
- 用途：在自研 Node.js 后台 AI Agent 服务中实现 MCP 客户端并接入卖家精灵 MCP 工具

> 说明：带「实测」标记的结论由本次直接请求端点得出，可复现；带「官方文档」的来自 open.sellersprite.com；带「第三方」的来自社区/第三方仓库，需保留怀疑。
> 无有效密钥（本环境无卖家精灵账号）时，无法验证有效密钥下的 `tools/list` 真实返回，相关处已标注。

---

## 一、接入端点（endpoint URL）

**结论**

| 项 | 值 |
|---|---|
| 完整 URL | `https://mcp.sellersprite.com/mcp` |
| 传输方式 | **Streamable HTTP**（JSON-RPC over POST），**不是** SSE |
| HTTP 方法 | 只接受 **POST** |
| 是否带尾斜杠 | **不能带**，`/mcp/` 返回 404 |
| 是否有 session | 无状态服务，响应头无 `mcp-session-id` |

**证据**

- 官方文档「接入方式」页明写：「对外MCP的请求域名为：https://mcp.sellersprite.com/mcp」，并标注类型为 `streamableHttp`。
  <https://open.sellersprite.com/mcp/16>
- 实测（2026-09-16）：
  - `GET https://mcp.sellersprite.com/mcp` → **HTTP 405**（`server: Tengine`，空 body）
  - `POST https://mcp.sellersprite.com/mcp/` → **HTTP 404**
  - `DELETE` / `PUT` → **HTTP 404**
  - `GET https://mcp.sellersprite.com/sse` → 15s 超时无响应（curl exit 28），**不存在 SSE 端点**
  - `POST` + `initialize` → HTTP 200，`content-type: application/json`，响应头中**没有** `mcp-session-id`
- 异常方法探测返回的 Java 堆栈显示服务端使用 `io.modelcontextprotocol.server.transport.WebMvcStatelessServerTransport`（Spring Boot，Jackson，Java 17.0.9），类名中的 `Stateless` 印证无状态传输。
  同一堆栈中的 `com.iyunya.open.mcp.config.SecurityFilter` 为卖家精灵侧鉴权过滤器。
- 官方「概览」页文案提到「实时数据流：支持 SSE 模式」，这与实测不符：该表述仅指 Streamable HTTP 的 `text/event-stream` 兼容能力，实际响应为普通 JSON。
  <https://open.sellersprite.com/mcp/15>

**注意**：官方文档只给出 `mcp.sellersprite.com` 这一个生产域名；`open.sellersprite.com/mcp/<id>` 是**文档页面**，不是 MCP 端点，不要混淆。

---

## 二、认证方式与密钥获取

**结论**

- 主方式：**HTTP 请求头** `secret-key`（名称固定，不可自定义），值填密钥字符串。
- 备用方式：**URL query 参数** `?secret-key=<密钥>`，等价可用。
- 不使用 `Authorization: Bearer`。官方文档全站未出现 `Authorization` / `Bearer` 字样。
- 密钥获取路径：登录 `open.sellersprite.com` → 右上角账号 / 「获取密钥」→ **我的密钥** 页面新建密钥。
  实测该入口页面为 `https://open.sellersprite.com/app/list`（未登录访问 → `302` 跳转到 `https://open.sellersprite.com/sign/in?url=%2Fapp%2Flist`）。
- 需先购买 MCP 套餐：`https://open.sellersprite.com/pricing/mcp`。

**证据**

- 官方原文（接入方式页）：
  - 请求头形式：`"headers": { "secret-key": "Your Secret" }`
  - URL 直连形式：`https://mcp.sellersprite.com/mcp?secret-key=Your Secret`
  - 「Header 名称固定为 `secret-key`，不可自定义，不可更改」；「Header 值填写您在『卖家精灵数据开放平台』-『我的密钥』中获取的密钥字符串」
  - 「密钥名称（如 `sj-prod-xxx`）只是你在后台管理时看的标签，**不要**把它当成 header 的 key」
  - 反例警示：把密钥名称当作 header 名（`"sj-xxxx-xxxx": "your-secret-value"`）是错的。
  <https://open.sellersprite.com/mcp/16>
- Cherry Studio 配置页：URL 填 `https://mcp.sellersprite.com/mcp`，请求头填 `secret-key=复制粘贴你在卖家精灵MCP中获取的密钥`；并说明「点击右上角的账号，进入【我的密钥】创建密钥」。
  <https://open.sellersprite.com/mcp/17>
- Claude Code CLI 官方命令带 `--header "secret-key:Your Secret"`；Claude Desktop 用 query 参数形式。
  <https://open.sellersprite.com/mcp/35>
- ChatGPT 网页版官方要求把密钥放 query：`https://mcp.sellersprite.com/mcp?secret-key=密钥`（原因是 ChatGPT 自定义连接器不提供自定义 header 输入）。
  <https://open.sellersprite.com/mcp/52>
- 社区文章同样确认 URL 直连写法。
  <https://aicoding.csdn.net/6a3ce8c610ee7a33f2823a5d.html>
- 社区文章提醒：「注意是 MCP Key，不是 API Key，别拿错」（MCP 密钥与 API 密钥是两套，MCP 套餐单独购买）。
  <https://mjzj.com/article/fxixm9iiidq8>
- 第三方 MCP API 参考也确认 header 优先、query 兜底。
  <https://raw.githubusercontent.com/Ethan-paseya/amazon-sellersprite-research-MCP-skill/main/references/sellersprite-mcp-api.md>

**实测补充**：用 `secret-key: fake-key-test` 与完全不带密钥，`tools/list` 返回完全相同的 `secret_invalid` 伪工具；用 query 传 `?secret-key=fake-key` 结果也相同。因此**无法从错误信息区分「未带密钥」与「密钥错误」**，实现时必须自行前置校验密钥是否配置。

---

## 三、IP 白名单 / 权限开通 / 套餐限制

**3.1 IP 白名单**

- **未查到**任何「IP 白名单」配置功能或文档。官方文档、帮助中心、定价页均无白名单设置项；密钥管理页也没有该字段。
- 但官方有**基于 IP 的风控监测**（不是白名单，而是异常检测），原文列出的监测维度包括：
  「调用来源 IP / 地域异常 / 多客户端同时使用」「并发量、调用频率显著超出正常使用范围」「多环境、多主体同时使用同一密钥」。
  <https://open.sellersprite.com/help/36>

**3.2 是否需要额外开通 MCP 权限**

- 需要。MCP 是独立于 API 的付费服务，需在 `https://open.sellersprite.com/pricing/mcp` 单独购买套餐。
- 购买后可能需要**手动启用**：官方帮助页指出若【我的服务】中状态为「未开始」，需手动点击「启用」按钮激活服务。
  <https://open.sellersprite.com/help/54>
- 另有**工具授权**机制（按需开放工具子集）：在「我的密钥」里点击对应密钥的「授权」，勾选场景所需工具；未授权的工具不会出现在模型上下文中。可用于压缩上下文（官方称全量 42 个工具 → 选品场景约 8 个，节省约 79%）。
  <https://open.sellersprite.com/mcp/46>

**3.3 套餐与配额（官方定价页原文数据）**

| 套餐 | 周期 | 价格 | 速率 | 次数 | 密钥数 |
|---|---|---|---|---|---|
| Basic | 月 | ¥99.00（原 ¥199.00） | 40 次/分钟 | 1000 次/月 | 1 个用户（密钥） |
| Pro | 月 | ¥299.00（原 ¥599.00） | 40 次/分钟 | 4000 次/月 | 1 个用户（密钥） |
| Max | 月 | ¥599.00（原 ¥1,199.00） | 40 次/分钟 | 10000 次/月 | 1 个用户（密钥） |
| Basic | 年 | ¥990.00（原 ¥1,990.00） | 40 次/分钟 | 4000 次/月 | 1 个用户（密钥） |
| Pro | 年 | ¥1,990.00（原 ¥3,999.00） | 60 次/分钟 | 10000 次/月 | 3 个用户（密钥） |
| Max | 年 | ¥2,990.00（原 ¥5,990.00） | 80 次/分钟 | 15000 次/月 | 5 个用户（密钥） |

来源：<https://open.sellersprite.com/pricing/mcp>

- 次数分配规则：套餐次数按自然月分配，非 1 号购买会拆分为「当月+次月」两段，首月/次月支持跨月调配。
  同页提示 + <https://open.sellersprite.com/help/57>
- 计数口径：**一次 HTTP 请求计一次**，与返回数据量无关；MCP 与 API 计数规则相同。注意「提一个问题模型可能发起多次调用」，因此 Agent 端要按 HTTP 请求数而非对话轮次估算配额。
  <https://open.sellersprite.com/help/6>

**3.4 ⚠️ 对「自研后台 AI Agent 系统」的关键合规风险**

官方《密钥使用规范》原文：

> 注：MCP 仅授权个人使用，不得集成至企业内部系统、统一服务平台或供多个人员共享使用；涉及系统集成、企业平台开发、多人共享调用等场景，请使用 API 服务

其余条款：每个密钥仅限单一账号/单一主体/单一业务人员使用；禁止共享、转借、出售、出租或对外分发；禁止以爬虫形式批量获取数据。违规可导致限流、暂停、禁用密钥、终止服务且不退款。

来源：<https://open.sellersprite.com/help/36>

**这条直接命中本次需求（把 MCP 接入自研后台 Agent 系统）**。后续实现前建议与卖家精灵官方（MCP 沟通群 / fiona@sellersprite.com）确认：内部单账号自用是否可接受，或改走 API 服务（`open.sellersprite.com/api`）。

---

## 四、暴露的工具清单

**官方口径（数量）**：平台提供 **42 个**数据工具 —— 产品工具 11 个、关键词工具 13 个、市场工具 14 个、商标工具 4 个。
来源：<https://open.sellersprite.com/mcp/46>

**第三方整理的 42 个工具清单**（数量与官方 42 恰好吻合；分类计数 11 + 13 + 14 + 4 = 42，与官方分类一一对应）。
来源：<https://raw.githubusercontent.com/Ethan-paseya/amazon-sellersprite-research-MCP-skill/main/references/sellersprite-mcp-api.md>

### 产品 / ASIN / 选品（11）

| 工具名 | 作用 |
|---|---|
| `asin_detail` | 商品详情：标题、品牌、价格、评分、评论数、类目、卖家、上架质量、徽章 |
| `asin_sales_trend` | 月度销量、销售额、价格、父子体趋势 |
| `asin_prediction` | 销量 / 排名预测 |
| `bsr_prediction` | BSR 排名预测 |
| `keepa_info` | Keepa 风格历史价格 / 排名 |
| `asin_coupon_trend` | 优惠券趋势 |
| `asin_detail_with_coupon_trend` | 商品详情 + 优惠券趋势 |
| `review` | 评论标题 / 内容 / 评分 / 日期 / 类型筛选（支持 `starList` 分组） |
| `product_research` | 多条件筛选商品（选品） |
| `competitor_lookup` | 按 ASIN / 关键词 / 品牌 / 卖家 / 节点检索或对比竞品（单次最多 40 个 ASIN） |
| `product_node` | 按关键词 / 名称 / 节点路径搜索类目节点 |

### 关键词 / 流量（13）

| 工具名 | 作用 |
|---|---|
| `traffic_keyword` | ASIN 流量关键词明细（反查） |
| `traffic_keyword_stat` | ASIN 流量关键词按来源汇总 |
| `traffic_source` | ASIN 或关键词的流量来源结构 |
| `traffic_extend` | 关键词 / 竞品流量拓展 |
| `traffic_listing` | 与流量词关联的 Listing 列表 |
| `keyword_miner` | 关键词挖掘：需求、竞争、PPC 竞价、购买率、垄断度、相关性 |
| `keyword_research` | 关键词市场筛选（带过滤条件） |
| `keyword_research_trends` | 关键词趋势 |
| `keyword_order` | ABA 关键词排名 / 竞品反查（`reverseType: "W"` 周 / `"M"` 月） |
| `aba_research_trend` | ABA 关键词趋势 |
| `aba_research_monthly` | ABA 月度市场筛选 |
| `aba_research_weekly` | ABA 周度市场筛选 |
| `google_trend` | Google 搜索趋势验证 |

### 类目 / 市场（14）

| 工具名 | 作用 |
|---|---|
| `market_research` | 类目市场筛选与可排序指标 |
| `market_research_statistics` | 类目汇总统计 |
| `market_trend` | 类目市场趋势 |
| `market_product_demand_trend` | 类目需求量趋势 |
| `market_price_distribution` | 价格带数量 / 销量占比 / 效率分布 |
| `market_rating_distribution` | 评分分布与市场成熟度 |
| `market_ratings_count_distribution` | 评论数护城河分布 |
| `market_product_concentration` | 头部商品集中度 |
| `market_brand_concentration` | 头部品牌集中度 |
| `market_seller_concentration` | 头部卖家集中度 |
| `market_seller_country_distribution` | 卖家国别分布 |
| `market_seller_type_concentration` | FBA / FBM / 亚马逊自营结构 |
| `market_listing_date_distribution` | 上架时间分布 |
| `market_listing_trend_distribution` | 新品趋势分布 |
| `market_ebc_distribution` | EBC / A+ 采用率分布 |

### 商标（4）

| 工具名 | 作用 |
|---|---|
| `trademark_country_list` | 可查询的商标局范围 |
| `trademark_list` | 按文本 / 品牌 / 申请人 / 状态 / 类别检索商标 |
| `trademark_stats` | 商标统计 |
| `trademark_detail` | 商标记录详情 |

**以上清单的不确定性**：
- 该清单来自第三方 GitHub 项目（基于官方文档与运行时 schema 整理），**本次未能用有效密钥实测 `tools/list` 核对**。
- 官方另一处仓库 `opensellersprite/sellersprite-skills` 的说明文档写的是「MCP 工具清单 (38个)」，且包含本清单没有的 `traffic_listing_stat`、缺少 `asin_sales_trend`，说明工具集在版本间有增减。
  <https://raw.githubusercontent.com/opensellersprite/sellersprite-skills/master/agent-instructions.md>
- **建议**：接入时以实际 `tools/list` 返回为准（该接口只返回工具名、描述和 `inputSchema`，不返回工具文档），并把清单差异做成配置而非硬编码。

**调用约定（第三方整理，供实现参考）**
- 部分工具是包装结构：`{ "request": { ... } }`（如 `traffic_keyword`、`keyword_miner`、`market_*`）；产品类工具（`asin_detail`、`review`、`asin_prediction` 等）多为顶层平铺参数。
- 几乎都要求 `marketplace`；列表类用 `page` + `size`（`size` 默认 50、最大 100）。
- 支持 `returnFields` 字段过滤（多个字段逗号分隔），官方称配合工具授权可把上下文压到原来的约 4%。
  <https://open.sellersprite.com/mcp/46>
- 官方默认值：`marketplace=US`，`matchType=2`（1 词组 / 2 模糊 / 3 精准），`size=50`。
  <https://github.com/opensellersprite/sellersprite-skills>
- 站点代码：官方帮助页说支持 9 国（US、JP、UK、DE、FR、IT、ES、CA、IN）。
  <https://open.sellersprite.com/help/2>
  第三方文档列出 13 个（增加 MX、BR、AU、AE）并按运行时 schema 给出。
  <https://raw.githubusercontent.com/Ethan-paseya/amazon-sellersprite-research-MCP-skill/main/references/sellersprite-mcp-api.md>
  两者不一致，**以实际 schema / 官方帮助页为准**。

---

## 五、官方配置 JSON 原文（逐字抄录）

### 5.1 通用 Streamable HTTP 配置（官方「接入方式」页原文，单行形式）

```json
{ "mcpServers":{ "sellersprite-mcp":{ "type":"streamableHttp", "url":"https://mcp.sellersprite.com/mcp", "description":"SellerSpriteMCP", "headers":{ "secret-key": "Your Secret" } } } }
```

来源：<https://open.sellersprite.com/mcp/16>

### 5.2 Antigravity 专用（同页，多行形式）

> 官方注：「它有自己的配置规则，直接拷贝下面的配置，只需要将 Your Secret 更改为你自己的密钥即可」

```json
{
"mcpServers": {
"sellersprite-mcp": {
"serverUrl": "https://mcp.sellersprite.com/mcp",
"headers": {
"secret-key": "Your Secret"
}
}
}
}
```

来源：<https://open.sellersprite.com/mcp/16>

### 5.3 URL 直连方式（同页原文）

```text
https://mcp.sellersprite.com/mcp?secret-key=Your Secret
```

来源：<https://open.sellersprite.com/mcp/16>

### 5.4 Claude Code（官方「配置-Claude」页原文命令）

```bash
claude mcp add --transport http sellersprite-mcp https://mcp.sellersprite.com/mcp --header "secret-key:Your Secret"
claude mcp list
```

来源：<https://open.sellersprite.com/mcp/35>

### 5.5 Claude Desktop（官方步骤，无 JSON，只有 UI 填写项）

官方给的填写值：

- 名称：`sellersprite-mcp`（官方注：「名称必须为英文，否则会话中无法调用卖家精灵MCP工具」）
- URL：`https://mcp.sellersprite.com/mcp?secret-key=此处替换成你自己的密钥`
- 路径：左下角用户名 → Settings → Connectors → Add Custom Connector

来源：<https://open.sellersprite.com/mcp/35>

### 5.6 Cherry Studio（官方步骤）

- 名称：`卖家精灵MCP`
- 类型：`可流式传输的HTTP（streamableHttp）`
- URL：`https://mcp.sellersprite.com/mcp`
- 请求头：`secret-key=复制粘贴你在卖家精灵MCP中获取的密钥`

来源：<https://open.sellersprite.com/mcp/17>

### 5.7 社区给出的 Cherry Studio / MyLevis 变体 JSON（非官方，仅供参考）

```json
{
  "mcpServers": {
    "sellersprite-mcp": {
      "url": "https://mcp.sellersprite.com/mcp?secret-key=【在这里填写你的密钥APIKey，然后删掉这段文字和两边的括号】",
      "transport": "http",
      "disabled": false
    }
  }
}
```

来源：<https://mjzj.com/article/fxixm9iiidq8>

### 5.8 其他官方客户端配置页（链接，便于后续核对）

| 客户端 | 官方文档 |
|---|---|
| Chatbox | <https://open.sellersprite.com/mcp/18> |
| Cherry Studio | <https://open.sellersprite.com/mcp/17> |
| Claude（Code + Desktop） | <https://open.sellersprite.com/mcp/35> |
| Codex 客户端（现已并入 ChatGPT 客户端） | <https://open.sellersprite.com/mcp/40> |
| ChatGPT 网页版 | <https://open.sellersprite.com/mcp/52> |
| Antigravity | <https://open.sellersprite.com/mcp/41> |
| Coze（扣子） | <https://open.sellersprite.com/mcp/53> |
| OpenClaw | <https://open.sellersprite.com/mcp/43> |
| Accio | <https://open.sellersprite.com/mcp/45> |
| Refly AI | <https://open.sellersprite.com/mcp/19> |
| WorkBuddy | <https://open.sellersprite.com/mcp/49> |
| CodeBuddy | <https://open.sellersprite.com/mcp/50> |

### 5.9 关于 `@sendsprite/mcp`（澄清）

npm 上的 `@sendsprite/mcp` **与卖家精灵无关**：其描述为「Model Context Protocol server for Sendsprite: send email, check status, search, domains, templates, contacts and stats.」，仓库为 `github.com/defy-works/sendsprite`（邮件服务，名字是 "Sendsprite" 而非 "SellerSprite"）。
来源：<https://www.npmjs.com/package/@sendsprite/mcp>

---

## 六、协议版本与初始化握手要求

**结论（均为对端点的实测结果）**

| 项 | 实测结果 |
|---|---|
| 服务端 `protocolVersion` | `"2025-06-18"` |
| 版本协商行为 | 请求 `2024-11-05` 或 `2025-06-18`，服务端**一律回 `2025-06-18`**（忽略客户端请求版本） |
| `serverInfo.name` | `"sellersprite-mcp-server"` |
| `serverInfo.version` | `"1.0.0"` |
| `capabilities` | `{"completions":{},"prompts":{"listChanged":false},"resources":{"subscribe":false,"listChanged":false},"tools":{"listChanged":false}}` |
| `initialize` 是否需密钥 | **不需要**，无密钥也返回 200 + 完整初始化结果 |
| `Accept` 头 | **必须**同时包含 `application/json` 与 `text/event-stream` |
| 响应 `Content-Type` | `application/json`（普通 JSON-RPC 响应，**不是** SSE 帧） |
| 会话 | 无状态，无 `mcp-session-id`，跳过 `initialize` 直接 `tools/call` 亦可通（HTTP 200） |
| `notifications/initialized` | HTTP **202**，空 body（符合规范） |
| `prompts/list` | `{"prompts":[]}`（空） |
| `resources/list` | `{"resources":[]}`（空） |

**可复现的探测命令**

```bash
curl -i -X POST "https://mcp.sellersprite.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "secret-key: <你的密钥>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}'
```

实测返回：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"completions":{},"prompts":{"listChanged":false},"resources":{"subscribe":false,"listChanged":false},"tools":{"listChanged":false}},"serverInfo":{"name":"sellersprite-mcp-server","version":"1.0.0"}}}
```

**`Accept` 头的严格性（实测，非常重要）**

| 请求 `Accept` | 结果 |
|---|---|
| 不设置 | **HTTP 400**（空 body） |
| `application/json`（仅此一个） | **HTTP 400**（空 body） |
| `application/json, text/event-stream` | HTTP 200，正常返回 |

即客户端必须同时声明两种媒体类型，且两者顺序上 `application/json` 在前即可通过。Node.js 侧若用 `fetch`，默认 `Accept: */*` 会直接被拒，必须显式设置。

---

## 七、常见坑与故障排查

以下 **1–6 全部为本次实测结果**，是本项目自研客户端最需要防的点。

**1. 密钥无效时 `tools/list` 不报错，而是返回一个伪工具 —— 最容易误导客户端**

无密钥或错误密钥时，`tools/list` 返回 **HTTP 200**，body 为：

```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"secret_invalid","description":"密钥不合法","inputSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false}}]}}
```

后果：MCP 客户端会认为「连接成功、有 1 个工具」，用户看到的是「工具不返回数据 / 只有一个叫 secret_invalid 的工具」，而不是 401/403。
**规避**：客户端在 `tools/list` 后显式检查工具列表是否只含 `secret_invalid`，命中即判定密钥无效并抛出明确错误。

**2. 完全不带密钥调用工具时，返回的是 Java 内部报错文本（`isError: true`）**

```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Parameter specified as non-null is null: method okhttp3.Request$Builder.addHeader, parameter value"}],"isError":true}}
```

（说明服务端用 OkHttp 回源转发，未鉴权时 header 未注入导致 NPE。）

**3. 带无效密钥调用工具时，错误被包成「正常数据」返回（`isError: false`）—— 最危险**

```json
{"jsonrpc":"2.0","id":11,"result":{"content":[{"type":"text","text":"{\"code\":\"ERROR_UNAUTHORIZED\",\"message\":\"未授权\"}"}],"isError":false}}
```

后果：`isError=false`，宿主客户端不会标记为失败，模型会把 `ERROR_UNAUTHORIZED` 当成业务数据继续分析，产生幻觉。
**规避**：对工具返回文本做二次解析，检测 `ERROR_UNAUTHORIZED` / `未授权` / `secret_invalid` 等模式并升级为错误。

**4. 必须用 POST，GET 返回 405**

`GET https://mcp.sellersprite.com/mcp` → **405**（Tengine，空 body）。没有 SSE 长连接端点可退。

**5. URL 尾斜杠导致 404**

`POST https://mcp.sellersprite.com/mcp/` → **404**。端点路径必须精确为 `/mcp`。

**6. 未知 JSON-RPC 方法会吐完整 Java 堆栈**

发送不存在的方法（如 `no_such_method`）时，返回体是 Spring `DispatcherServlet` 的完整 `stackTrace` 数组（含 `io.modelcontextprotocol.server.transport.WebMvcStatelessServerTransport`、`com.iyunya.open.mcp.config.SecurityFilter`、Java 17.0.9 等），体积巨大。
**规避**：客户端不要发未实现的方法；若收到超大响应，考虑限制 `Content-Length` 上限。

**7. 密钥过期 / 服务未启用（官方帮助页）**

官方《密钥过期问题》给出的排查顺序：

1. 登录开放平台进入【我的服务】确认 MCP 服务是否在有效期内，过期需重新购买套餐；
2. 状态若为「未开始」，需**手动点击「启用」**；
3. 之后必须**彻底退出客户端进程**（非仅关闭窗口）并重启，且**新建对话**（不能沿用旧对话）。

同时明确「不同客户端之间需要分别执行重启+新建对话」。

来源：<https://open.sellersprite.com/help/54>

**8. MCP Key 与 API Key 混用（社区坑）**

社区文章明确提醒：「注意是 MCP Key，不是 API Key，别拿错」——卖家精灵的 API 服务与 MCP 服务是两套独立套餐和密钥。
来源：<https://mjzj.com/article/fxixm9iiidq8>

**9. 超时 / 网络与代理（官方 FAQ）**

官方 FAQ Q3 列出「验证网络：确保您的网络环境可以正常访问卖家精灵的MCP服务地址，无公司防火墙或代理阻挡」，以及建议用客户端的「测试连接」和日志定位。本文实测中 `/sse` 请求出现 15 秒无响应，说明部分非法路径表现为静默超时而非明确报错，客户端应设置明确超时（建议 10–30s）。

官方 FAQ Q4 指出「没反应或报错（如限流）」多来自所选 LLM 服务商，而非卖家精灵 MCP，建议使用稳定支持工具调用的模型服务。
来源：<https://open.sellersprite.com/mcp/23>

**10. 客户端侧玄学（官方 FAQ Q5）**

官方建议：先禁用 MCP 再启用；仍不行则关闭工具再打开；Refly 工具参数填错后必须重新配置（改无效）。
来源：<https://open.sellersprite.com/mcp/23>

**11. 上下文膨胀导致工具「像是不返回」（官方说明）**

42 个工具全量加载会挤占上下文，导致模型响应变慢、推理变浅。官方方案：在「我的密钥」里做**工具授权**（只开放所需工具），调用时用 `returnFields` 做**字段过滤**；两者叠加可把上下文压到约 4%。
来源：<https://open.sellersprite.com/mcp/46>

---

## 八、给 Node.js 自研客户端的实现要点（基于以上实证）

1. **端点**：`POST https://mcp.sellersprite.com/mcp`（无尾斜杠、无 GET）。
2. **必需请求头**：
   - `Content-Type: application/json`
   - `Accept: application/json, text/event-stream`（缺任一项 → 400）
   - `secret-key: <密钥>`（或改用 URL query `?secret-key=`）
3. **握手**：发 `initialize`（`protocolVersion: "2025-06-18"`），收到的 `protocolVersion` 一律是 `2025-06-18`；随后可发 `notifications/initialized`（服务端回 202，可不等待）。
4. **无状态**：不需要维护 `mcp-session-id`；但为兼容标准流程，仍建议按规范走 initialize → initialized → tools/list。若多次调用，可复用同一进程的连接池。
5. **响应解析**：响应是 `application/json`（单 JSON 对象），不必实现 SSE 解析；但需容忍服务端未来切换为 `text/event-stream`（按规范解析 `data:` 行更稳妥）。
6. **错误检测**（关键）：
   - `tools/list` 结果只含 `secret_invalid` → 密钥无效；
   - 工具返回文本包含 `ERROR_UNAUTHORIZED` / `未授权` 且 `isError:false` → 必须自行升级为错误；
   - HTTP 400 → 检查 `Accept` 头；HTTP 405 → 误用 GET；HTTP 404 → 检查尾斜杠。
7. **配额治理**：一次 HTTP 请求 = 一次配额（不是一次对话）。建议在 Agent 层做请求计数与限流（Basic 40 次/分钟是多数月付档上限），并配合工具授权 + `returnFields` 降低消耗。
8. **合规前置确认**：官方明确「MCP 仅授权个人使用，不得集成至企业内部系统」，本项目为自研后台系统集成，**建议先与官方确认或改用 API 服务**（<https://open.sellersprite.com/help/36>）。

---

## 九、未能查清 / 需用户确认的事项

1. **有效密钥下 `tools/list` 的真实完整返回**（工具名、描述、`inputSchema` 字段细节）—— 本环境无账号密钥，未验证。请用户用真实密钥执行一次 `tools/list` 并以返回为准。
2. **工具「授权」子集的实际生效方式**（未授权工具是彻底不出现，还是调用时报错）—— 官方仅称「未授权的工具不会出现在模型的上下文中」，未给出接口层行为，未查到。
3. **是否存在 IP 白名单**：未查到该功能；仅有 IP/地域维度的风控监测。如需确认，建议向官方客服核实。
4. **`tool` 调用对 `Accept`/并发/超时的服务端硬限制**（除 40–80 次/分钟的套餐速率外）—— 未查到。
5. **站点代码最终口径**（9 个 vs 13 个）—— 官方帮助页与第三方 schema 不一致，未查清。
6. **该 MCP 是否提供标准 OAuth**（ChatGPT 官方教程要求选「未授权（NONE）」）—— 未查到 OAuth 支持说明。
