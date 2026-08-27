# robots 主站 BFF：Studio AI 托管接口

面向 **Agile Robot / robots 主站与 API 后端** 开发人员。

Studio 侧 AI 生成 / 审阅 / 对话已改为 **Mode B（托管后端）**：浏览器只 POST 结构化上下文，**不在 bundle 内携带 LLM Provider 密钥**；**BYOK（`VITE_OPENAI_*`）已移除**。主站需在与即梦 / 混元相同的 BFF 层提供 **Studio AI** 路由。

- Studio 设计 spec：[../superpowers/specs/2026-08-22-robots-exclusive-studio-mode-b-design.md](../superpowers/specs/2026-08-22-robots-exclusive-studio-mode-b-design.md)
- 安全加固 spec（BYOK 移除 + BFF 会话快照 + Edit Agent 删除）：robots 仓库 [`docs/superpowers/specs/2026-08-27-studio-ai-security-hardening-design.md`](../../../robots/docs/superpowers/specs/2026-08-27-studio-ai-security-hardening-design.md)
- 已有 BFF（即梦 / 混元）：[urdf-studio.md](urdf-studio.md) §4
- Studio 传输层实现（只读参考）：`src/features/ai-assistant/services/aiBackendTransport.ts`
- 提示词模板 source of truth：`src/features/ai-assistant/config/aiPromptTemplates.md` → 生成 `aiPromptTemplates.generated.ts`

**状态：主站尚未实现。** 本文是主站落地契约；Studio 侧 BFF-only wiring 已完成（Phase 1）。

**Phase 1 约束：** `generate`、`inspect`、`conversation` 三者均依赖有效 bootstrap（`order_id` + `studio_token`）；无 bootstrap 时 AI 不可用，3D 预览仍可加载。

---

## 1. 与现有 BFF 的关系

| 能力 | 路径前缀 | 鉴权 | 状态 |
|------|----------|------|------|
| 即梦改图 | `.../studio/jimeng/edit` | `Bearer studio_token` | 已有 |
| 混元 3D | `.../studio/hunyuan/submit` + `.../job` | 同上 | 已有 |
| **Studio AI 生成** | `.../studio/ai/generate` | 同上 | **待实现** |
| **Studio AI 审阅** | `.../studio/ai/inspect` | 同上 | **待实现** |
| **Studio AI 对话** | `.../studio/ai/chat` | 同上 | **待实现** |
| **Studio AI 对话（tool calling）** | `.../studio/ai/v1/chat/completions` | 同上 | **待实现**（见 §14） |
| **需求确认书修订** | `.../studio/requirements-document` | 同上 | **待实现**（见 §14） |
| **URDF+STL 再生成** | `.../studio/mesh/regenerate` + `.../mesh/job` + `.../mesh/import-grant` | 同上 | **待实现**（见 §14） |

**不要**让 Studio 调用主站通用 `/agent/chat` 或其它未在本文定义的 Agent 路由。Studio 对话 Modal 以 §14 的 completions + 确认书修订为准；`/chat` SSE 保留给兼容或弃用路径。

**不要**在 Studio 部署环境配置 LLM Provider AK/SK；密钥只存在于 robots 后端（或 BotPilot 等上游）。

---

## 2. 前置条件：bootstrap 与 `studio_token`

Studio 从主站「预览」打开时会收到 bootstrap（`#robots-bootstrap=` 或 `postMessage`），其中包含：

| 字段 | Studio 用途 |
|------|-------------|
| `studio_token` | 所有 BFF 请求的 `Authorization: Bearer` |
| `order_id` | 拼进 AI BFF URL 路径 |
| `api_base_url` | 与即梦/混元相同；Studio 生产 env 也可固定为同一 API 根 |

AI 功能 **依赖有效 bootstrap**（含 `order_id` + `studio_token`）。纯 URDF 包预览（仅 `?import=`）可以没有 bootstrap，此时 3D 正常但 AI 不可用——与即梦/混元行为一致。

`studio_token` 校验逻辑 **应与** `studio/jimeng/*`、`studio/hunyuan/*` **完全一致**（同一签发、同一过期策略，建议默认约 60 分钟）。

---

## 3. 路由与 Base URL

### 3.1 完整路径

```http
POST {api_base_url}/me/projects/{order_id}/studio/ai/generate
POST {api_base_url}/me/projects/{order_id}/studio/ai/inspect
POST {api_base_url}/me/projects/{order_id}/studio/ai/chat
```

示例（`api_base_url = https://api.enkeebot.com/api/v1`，`order_id = ord_abc123`）：

```text
POST https://api.enkeebot.com/api/v1/me/projects/ord_abc123/studio/ai/chat
```

### 3.2 路径参数

| 参数 | 来源 | 说明 |
|------|------|------|
| `order_id` | bootstrap | 必须与 `studio_token` 绑定订单一致；不匹配 → **403** |
| `api_base_url` | 环境固定 | 无尾斜杠；与 preview-url 返回的 `api_base_url` 一致 |

### 3.3 CORS

与即梦/混元相同：对 Studio 部署 origin 放行（例如 `https://urdf.enkeebot.com`、联调 `http://127.0.0.1:3000`）。

预检需允许：

- `Authorization`
- `Content-Type: application/json`
- 方法 `POST`

`/chat` 响应为 SSE 时，还需允许浏览器读取流式 body（`Content-Type: text/event-stream`）。

---

## 4. 鉴权

```http
Authorization: Bearer <studio_token>
Content-Type: application/json
```

| HTTP | 含义 | Studio UX |
|------|------|-----------|
| **401** | token 缺失 / 无效 / 过期 | 提示用户回主站重新点击「预览」 |
| **403** | token 有效但 `order_id` 无权 | 同上或权限错误文案 |
| **404** | 路由未部署 | Studio 显示请求失败（勿与 401 混淆） |
| **502** | 上游 LLM / BotPilot 失败 | 通用 AI 错误 |

错误 JSON 建议（与 Studio 解析一致）：

```json
{
  "success": false,
  "message": "Human-readable error"
}
```

Studio 会读取 `message` 字段展示给用户。

---

## 5. 服务端职责（主站 / BotPilot）

浏览器 **只发送结构化 JSON**；以下工作 **必须在服务端完成**：

1. **校验** `studio_token` 与 `order_id`。
2. **加载提示词模板**（与 URDF-Studio 仓库镜像一致，见 §8）。
3. **注入占位符**（robot 快照、criteria、history 等）。
4. **调用 LLM Provider**（OpenAI 兼容或其它已接入网关）。
5. **返回原始模型文本**（`/generate`、`/inspect`）或 **SSE 增量**（`/chat`）。

Studio 在收到 `data.content` 或 SSE delta 后 **自行 JSON 解析 / Markdown 渲染**；BFF **不要**返回已解析的 `InspectionReport` 等业务对象，除非未来双方显式升级契约。

### 5.1 推荐生成参数

| 端点 | 建议 |
|------|------|
| `/generate` | `response_format: json_object`，`temperature: 0.7` |
| `/inspect` | `response_format: json_object`，`temperature: 0.7` |
| `/chat` | 普通文本流，无 `json_object` 约束 |

若 Provider 支持 thinking/reasoning，建议对对话关闭或 strip 思考标签，避免污染 SSE。

---

## 6. `POST .../studio/ai/generate`

自然语言生成 / 修改机器人（旧版整包 JSON 路径，仍走 backend transport）。

### 6.1 Request body

```json
{
  "prompt": "Add a lidar link on top of the base",
  "robot": {
    "name": "my_robot",
    "rootId": "base",
    "links": [
      {
        "id": "base",
        "name": "base_link",
        "visual": { "...": "..." },
        "inertial": { "...": "..." }
      }
    ],
    "joints": [
      {
        "id": "j1",
        "name": "joint1",
        "type": "revolute",
        "parent": "base",
        "child": "link1",
        "origin": { "...": "..." },
        "axis": { "...": "..." },
        "limit": { "...": "..." },
        "hardware": { "...": "..." }
      }
    ]
  },
  "motorLibrary": [
    {
      "brand": "Unitree",
      "motors": [
        { "name": "GO-M8010-6", "effort": 23.7, "velocity": 30.0, "weight": 0.05 }
      ]
    }
  ],
  "lang": "en"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | 用户自然语言 |
| `robot` | object | 当前机器人精简快照（见 Studio `aiService.ts` `contextRobot`） |
| `motorLibrary` | array | 电机库精简列表 |
| `lang` | `"en"` \| `"zh"` \| … | 影响 system prompt 语言指令 |

### 6.2 Response `200`

```json
{
  "success": true,
  "data": {
    "content": "{\"explanation\":\"...\",\"actionType\":\"modification\",\"robotData\":{...}}"
  }
}
```

| 要求 | 说明 |
|------|------|
| `data.content` | **必填** non-empty string |
| 内容格式 | **纯 JSON 字符串**（模型输出），结构见 §9.1 |
| 空 content | Studio 抛 `AI backend returned an empty response` |

---

## 7. `POST .../studio/ai/inspect`

AI 审阅机器人结构。

### 7.1 Request body

```json
{
  "robot": { "...": "inspection robot snapshot, see buildInspectionRobotContext" },
  "criteriaDescription": "Enabled profile criteria text...",
  "inspectionNotes": "Supplemental notes from local evidence...",
  "lang": "zh"
}
```

| 字段 | 说明 |
|------|------|
| `robot` | Studio `buildInspectionRobotContext()` 输出（含 `inspectionContext` 等） |
| `criteriaDescription` | 已启用 inspection profile 的可执行检查项描述 |
| `inspectionNotes` | 本地规则补充说明（可为空字符串） |
| `lang` | `"en"` / `"zh"` 等 |

审阅标准 Markdown（服务端组装 criteria 时可参考）：

- `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
- `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`

### 7.2 Response `200`

```json
{
  "success": true,
  "data": {
    "content": "{\"summary\":\"...\",\"issues\":[...]}"
  }
}
```

内容格式见 §9.2。Studio 会继续做本地 evidence 合并与 profile 过滤。

---

## 8. `POST .../studio/ai/chat`

对话助手（流式 SSE）。

### 8.1 Request body

```json
{
  "mode": "general",
  "lang": "zh",
  "context": "{\n  \"mode\": \"general\",\n  \"robot\": { ... },\n  \"inspectionReport\": { ... }\n}",
  "history": [
    { "role": "user", "content": "这个关节限位合理吗？" },
    { "role": "assistant", "content": "..." }
  ],
  "userMessage": "如果改成 90 度上限呢？"
}
```

| 字段 | 说明 |
|------|------|
| `mode` | `"general"` \| `"inspection-followup"` |
| `lang` | UI 语言 |
| `context` | **JSON 字符串**（不是 nested object），由 Studio `buildConversationContext()` 生成 |
| `history` | 最近最多 **8** 轮 `{role, content}`；不含当前 `userMessage` |
| `userMessage` | 当前用户输入（已 trim） |

服务端应：

1. 用 `conversation.en` / `conversation.zh` 模板构建 system prompt。
2. 将 `context` 填入 `__CONVERSATION_CONTEXT__`。
3. `history` + `userMessage` 组装为 chat messages（**不要**在 system 里重复 history）。

### 8.2 Response：`200` + SSE

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

事件格式（UTF-8，事件以 `\n\n` 分隔）：

```
data: {"delta":"第一段文本"}

data: {"delta":"第二段"}

data: {"done":true}
```

| 事件 | 含义 |
|------|------|
| `{"delta":"<string>"}` | 增量文本；Studio 追加到回复 |
| `{"done":true}` | **必须**发送；否则 Studio 报 `stream ended unexpectedly` |
| `{"error":"<string>"}` | 协议错误；Studio 中断并展示 error |

**非 200**：返回 JSON `{ "success": false, "message": "..." }`（Studio 不读 SSE）。

**注意：** 当前 `/chat` 契约 **不含 tool_calls**。即梦改图 / 混元 3D 仍由 Studio 在客户端执行（`useAgileRobotTools` → 现有 `jimeng` / `hunyuan` BFF），不经过 `/studio/ai/chat`。

---

## 9. 模型输出格式（BFF 原样放入 `content` / delta）

### 9.1 Generate — JSON object

```json
{
  "explanation": "Text explanation or advice",
  "actionType": "generation",
  "robotData": { }
}
```

`actionType`：`"generation"` | `"modification"` | `"advice"`。  
无 `robotData` 时可为 advice。Studio 会 `JSON.parse` 并 normalize。

### 9.2 Inspect — JSON object

```json
{
  "summary": "Overall inspection summary",
  "issues": [
    {
      "type": "error",
      "title": "Issue title",
      "description": "Detailed description",
      "profileId": "base.robot_model",
      "itemId": "reference_integrity",
      "score": 3,
      "relatedIds": ["link_1", "joint_2"]
    }
  ]
}
```

`type`：`error` | `warning` | `suggestion`。每个 issue **必须**含 `profileId` + `itemId`（与 enabled profile 对齐）。

### 9.3 Chat — Markdown 文本

普通 Markdown 即可；除非用户明确要求，**不要**输出 JSON。

---

## 10. 提示词模板（BotPilot 镜像）

服务端 system prompt **必须与** URDF-Studio 生成物一致。维护流程：

1. 编辑 URDF-Studio：`src/features/ai-assistant/config/aiPromptTemplates.md`
2. 运行 `npm run ai-prompts:generate` → `aiPromptTemplates.generated.ts`
3. 将同内容同步到 BotPilot：`workflows/urdf_studio/prompt_templates.py`（或你们现有镜像路径）

占位符注入参考 Studio `src/features/ai-assistant/config/prompts.ts`：

| 模板 | 占位符 |
|------|--------|
| generation | `__ROBOT_CONTEXT__`, `__MOTOR_LIBRARY_CONTEXT__` |
| inspection | `__CRITERIA_DESCRIPTION__`, `__INSPECTION_NOTES__`, `__LANGUAGE_INSTRUCTION__` |
| conversation | `__CONVERSATION_MODE__`, `__CONVERSATION_CONTEXT__`, `__CONVERSATION_HISTORY__`, `__LANGUAGE_INSTRUCTION__` |

---

## 11. 对话 Modal：completions + 确认书修订（2026-08-27）

设计 spec：`docs/superpowers/specs/2026-08-27-robots-conversation-requirements-regen-design.md`  
robots BFF 契约：`robots/docs/integrations/studio-requirements-revision.md`（同 workspace）

| 能力 | 端点 |
|------|------|
| 流式对话 + function calling | `POST .../studio/ai/v1/chat/completions` |
| 读/写需求确认书 | `GET` / `PATCH .../studio/requirements-document` |
| Team Mesh 再生成 | `POST .../studio/mesh/regenerate`，`GET .../studio/mesh/job` |
| 重载 import grant | `POST .../studio/mesh/import-grant` → Studio `POST /api/download-asset` |

**范围**：仅 `package_type=urdf_stl` 订单。对话内 **放弃** URDF edit agent 与 BYOK。

---

## 12. 不在本契约范围内

| 项 | 说明 |
|----|------|
| URDF edit agent（`runRobotEditAgent`） | 对话内 **已放弃**；见 §11 |
| `/agent/chat` | Studio **不会**调用 |
| URDF+STL `POST /api/download-asset` | 见 [robots-urdf-stl-preview.md](robots-urdf-stl-preview.md) |
| GLB `?mesh=` 下载 | 见 [urdf-studio.md](urdf-studio.md) §3.1 |

---

## 13. 主站实现 Checklist

- [ ] 三个路由挂在现有 `studio` 命名空间下，与 jimeng/hunyuan 同级
- [ ] 复用 `studio_token` 校验中间件
- [ ] 校验 URL 中 `order_id` 与 token 所属订单一致
- [ ] CORS 放行 Studio origin
- [ ] `/generate`、`/inspect` 返回 `{ success, data: { content } }`
- [ ] `/chat` 返回 SSE，且以 `data: {"done":true}` 结束
- [ ] 401 / 403 / 502 语义与 §4 一致
- [ ] 提示词模板与 URDF-Studio `aiPromptTemplates.md` 同步
- [ ] LLM Provider 密钥仅在后端配置
- [ ] 集成测试：用有效 `studio_token` curl 三个端点

---

## 14. curl 联调示例

替换 `TOKEN`、`ORDER`、`API_BASE`、`STUDIO_ORIGIN`。

### generate

```bash
curl -sS -X POST \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/generate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${STUDIO_ORIGIN}" \
  -d '{
    "prompt": "Describe this robot briefly",
    "robot": { "name": "test", "rootId": "base", "links": [], "joints": [] },
    "motorLibrary": [],
    "lang": "en"
  }'
```

### inspect

```bash
curl -sS -X POST \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/inspect" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "robot": { "name": "test", "links": {}, "joints": {} },
    "criteriaDescription": "...",
    "inspectionNotes": "",
    "lang": "en"
  }'
```

### chat（SSE）

```bash
curl -N -X POST \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/chat" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "general",
    "lang": "zh",
    "context": "{}",
    "history": [],
    "userMessage": "你好"
  }'
```

期望输出片段：

```text
data: {"delta":"你好"}

data: {"done":true}
```

---

## 15. 变更与版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.1 | 2026-08-27 | §11：对话 completions + 确认书修订 + mesh regen（见 `docs/superpowers/specs/2026-08-27-robots-conversation-requirements-regen-design.md`） |
| 1.0 | 2026-08-22 | 初版：对齐 Studio Mode B spec 与 `aiBackendTransport` |

破坏性变更（路径、字段、SSE 事件）需 robots 与 URDF-Studio **同步 bump** 并更新本文档。
