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
| **Studio AI 对话（session + tool calling）** | `.../studio/ai/conversation-sessions` + `.../studio/ai/v1/chat/completions` | 同上 | **待实现**（见 §11、§15） |
| **需求确认书修订** | `.../studio/requirements-document` | 同上 | **待实现**（见 §11） |
| **URDF+STL 再生成** | `.../studio/mesh/regenerate` + `.../mesh/job` + `.../mesh/import-grant` | 同上 | **待实现**（见 §14） |

**不要**让 Studio 调用主站通用 `/agent/chat` 或其它未在本文定义的 Agent 路由。Studio 对话 Modal 以 §11 的 conversation session + completions + 确认书修订为准。

**已移除：** legacy `POST .../studio/ai/chat`（客户端 `context`/`history` SSE）已下线；勿再实现或调用。

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
POST {api_base_url}/me/projects/{order_id}/studio/ai/conversation-sessions
PUT  {api_base_url}/me/projects/{order_id}/studio/ai/conversation-sessions/{session_id}
POST {api_base_url}/me/projects/{order_id}/studio/ai/v1/chat/completions
```

示例（`api_base_url = https://api.enkeebot.com/api/v1`，`order_id = ord_abc123`）：

```text
POST https://api.enkeebot.com/api/v1/me/projects/ord_abc123/studio/ai/v1/chat/completions
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
- 方法 `POST`（以及 session 的 `PUT` / `DELETE`）

`/v1/chat/completions` 响应为 SSE 时，还需允许浏览器读取流式 body（`Content-Type: text/event-stream`）。

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
5. **返回原始模型文本**（`/generate`、`/inspect`）或 **OpenAI SSE**（`/v1/chat/completions`）。

Studio 在收到 `data.content` 或 SSE delta 后 **自行 JSON 解析 / Markdown 渲染**；BFF **不要**返回已解析的 `InspectionReport` 等业务对象，除非未来双方显式升级契约。

### 5.1 推荐生成参数

| 端点 | 建议 |
|------|------|
| `/generate` | `response_format: json_object`，`temperature: 0.7` |
| `/inspect` | `response_format: json_object`，`temperature: 0.7` |
| `/v1/chat/completions` | 普通文本流 + tool calling；`temperature: 0.3` |

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

## 8. 对话（session + completions）

Legacy `POST .../studio/ai/chat` 已移除。对话统一走：

1. `POST/PUT .../studio/ai/conversation-sessions` — BFF 持有 snapshot + history
2. `POST .../studio/ai/v1/chat/completions` — `{ studio: { session_id, user_message } }`

完整契约见 §11.4。

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

## 11. 对话 Modal：会话快照 + completions + 确认书修订（2026-08-27）

设计 spec：

- 确认书 / mesh：`docs/superpowers/specs/2026-08-27-robots-conversation-requirements-regen-design.md`
- 安全加固（BFF 会话快照）：robots 仓库 [`docs/superpowers/specs/2026-08-27-studio-ai-security-hardening-design.md`](../../../robots/docs/superpowers/specs/2026-08-27-studio-ai-security-hardening-design.md)

robots BFF 实现细节：`robots/docs/integrations/studio-requirements-revision.md`（同 workspace）

| 能力 | 端点 |
|------|------|
| 创建 / 同步 / 删除对话会话 | `POST` / `PUT` / `DELETE .../studio/ai/conversation-sessions` |
| 流式对话 + function calling | `POST .../studio/ai/v1/chat/completions` |
| 读/写需求确认书 | `GET` / `PATCH .../studio/requirements-document` |
| Team Mesh 再生成 | `POST .../studio/mesh/regenerate`，`GET .../studio/mesh/job` |
| 重载 import grant | `POST .../studio/mesh/import-grant` → Studio `POST /api/download-asset` |

**范围**：仅 `package_type=urdf_stl` 订单。对话内 **放弃** URDF edit agent 与 BYOK。

**Phase 2 约束（2026-08-27 安全加固）：** 浏览器 **不再** 向 completions 发送 `context` / `history` / `mode` / `lang`。Studio 在打开 Modal 时 `POST` 会话，在机器人/审阅上下文变化时 debounced `PUT` 快照，发送前 `ensureSynced()`；completions 的 `studio` wrapper 仅含 `session_id` + `user_message`。BFF 从 PostgreSQL `studio_conversation_sessions` 读取 snapshot 与 history（最多 8 轮），流式完成后 append assistant 回复。

### 11.1 `POST .../studio/ai/conversation-sessions`

创建空会话（无 request body）。

**Response 201**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "expires_at": "2026-08-27T10:00:00Z"
}
```

| 字段 | 说明 |
|------|------|
| `session_id` | UUID；后续 PUT / completions / DELETE 使用 |
| `expires_at` | ISO 8601；TTL 与 `STUDIO_SESSION_TOKEN_EXPIRE_MINUTES` 对齐（默认 120 分钟） |

### 11.2 `PUT .../studio/ai/conversation-sessions/{session_id}`

上传机器人快照。Studio `buildConversationContext()` 输出经 `conversationSessionApi.ts` 序列化。

**Request body**

```json
{
  "mode": "general",
  "lang": "zh",
  "snapshot_revision": 1,
  "snapshot": {
    "robot": {
      "name": "demo",
      "rootLinkId": "base",
      "linkCount": 1,
      "jointCount": 0,
      "links": [
        {
          "id": "base",
          "name": "base_link",
          "visualType": "box",
          "collisionType": "box",
          "mass": 1.0
        }
      ],
      "joints": []
    },
    "inspectionReport": null,
    "selectedEntity": null,
    "focusedIssue": null
  }
}
```

| 字段 | 说明 |
|------|------|
| `mode` | `"general"` \| `"inspection-followup"` |
| `lang` | UI 语言 |
| `snapshot_revision` | 单调递增；旧 revision → **409** `stale_snapshot_revision` |
| `snapshot` | 严格 schema（字段白名单；见 BFF `conversation_session_schemas.py`） |

**Response 200**

```json
{
  "snapshot_revision": 1
}
```

| HTTP | 含义 |
|------|------|
| **404** | `session_not_found`（不存在或 `order_id` 不匹配） |
| **409** | `stale_snapshot_revision`（客户端 bump revision 后重试 PUT） |

成功 PUT 会续期 `expires_at`。

### 11.3 `DELETE .../studio/ai/conversation-sessions/{session_id}`

可选清理（Modal 关闭时）。**Response 204**，无 body。

### 11.4 `POST .../studio/ai/v1/chat/completions`（session 契约）

OpenAI Chat Completions 兼容路径；`stream: true` **必填**。

**Request body（当前 Studio 客户端）**

```json
{
  "stream": true,
  "studio": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_message": "这个关节限位合理吗？"
  }
}
```

| 字段 | 说明 |
|------|------|
| `stream` | 必须为 `true` |
| `studio.session_id` | 有效且未过期的会话 UUID |
| `studio.user_message` | 当前用户输入（非空 trim） |

**BFF 处理**

1. 加载 session；校验 `order_id` + 未过期。
2. 用 DB 中 `snapshot` 构建 system prompt；`history` 从 DB 读取（max 8 turns）。
3. 流式 LLM + tool calling（与 §11 确认书 / mesh 流程相同）。
4. 完成后 append user + assistant 到 DB history。

**Breaking change：** 若请求含 legacy `studio.context` / `studio.history` / `studio.mode` / `studio.lang` 且无 `session_id`，BFF 返回 **400** `session_required`。URDF-Studio 与 robots **须同版本部署**。

**Response：** 标准 OpenAI SSE（`chat.completion.chunk`），以 `data: [DONE]` 结束。

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
- [ ] conversation session CRUD + `/v1/chat/completions` 返回 OpenAI SSE，以 `data: [DONE]` 结束
- [ ] 401 / 403 / 502 语义与 §4 一致
- [ ] 提示词模板与 URDF-Studio `aiPromptTemplates.md` 同步
- [ ] LLM Provider 密钥仅在后端配置
- [ ] 集成测试：用有效 `studio_token` curl generate / inspect / completions

---

## 14. curl 联调示例

替换 `TOKEN`、`ORDER`、`API_BASE`、`STUDIO_ORIGIN`、`SESSION_ID`。

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

### conversation session + completions

```bash
# 1. Create session
curl -sS -X POST \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/conversation-sessions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Origin: ${STUDIO_ORIGIN}"
# → {"session_id":"...","expires_at":"..."}

SESSION_ID="<session_id from above>"

# 2. Sync snapshot (before or after edits)
curl -sS -X PUT \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/conversation-sessions/${SESSION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "general",
    "lang": "zh",
    "snapshot_revision": 1,
    "snapshot": {
      "robot": {
        "name": "test",
        "rootLinkId": "base",
        "linkCount": 1,
        "jointCount": 0,
        "links": [{ "id": "base", "name": "base", "visualType": "box", "collisionType": "box" }],
        "joints": []
      }
    }
  }'

# 3. Stream completions (session_id + user_message only)
curl -N -X POST \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/v1/chat/completions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"stream\": true,
    \"studio\": {
      \"session_id\": \"${SESSION_ID}\",
      \"user_message\": \"这个机器人有几条连杆？\"
    }
  }"

# 4. Optional cleanup
curl -sS -X DELETE \
  "${API_BASE}/me/projects/${ORDER}/studio/ai/conversation-sessions/${SESSION_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

期望 completions 输出含 OpenAI `chat.completion.chunk` 与 `data: [DONE]`。

---

## 15. 变更与版本

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.2 | 2026-08-27 | §11：BFF 会话快照 API；completions `studio` 仅 `session_id` + `user_message`（见 security hardening spec） |
| 1.1 | 2026-08-27 | §11：对话 completions + 确认书修订 + mesh regen（见 `docs/superpowers/specs/2026-08-27-robots-conversation-requirements-regen-design.md`） |
| 1.0 | 2026-08-22 | 初版：对齐 Studio Mode B spec 与 `aiBackendTransport` |

破坏性变更（路径、字段、SSE 事件）需 robots 与 URDF-Studio **同步 bump** 并更新本文档。
