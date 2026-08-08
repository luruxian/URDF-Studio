# URDF-Studio ↔ Agile Robot（robots）集成设计

> 状态：设计完成，待审阅 | 2026-08-08
> 契约来源：[docs/integrations/urdf-studio.md](../integrations/urdf-studio.md)
> 实现计划：待 writing-plans 产出

---

## 1. 角色边界（复述契约）

| 能力 | 谁负责 |
|------|--------|
| 用户登录 | robots 主站（Cookie `ar_session`） |
| 打开工作台 | robots「我的项目 → **预览**」 |
| AI 对话 | URDF-Studio 内部 LLM（`OPENAI_*`） |
| 即梦改图 | robots BFF，Studio 只调 BFF |
| 混元 3D | robots BFF，Studio 只调 BFF |
| 读 GLB | robots GET + `preview_token` |
| MinIO / DB | robots 后端，Studio 永不直连 |

**要点**：Studio 管对话与 3D UI；robots 管登录、资产与云厂商密钥。

---

## 2. 端到端流程

```
[用户在 robots 主站已登录]
        │
        ▼
点击「预览」
        │
        ▼
POST /api/v1/me/projects/{order_id}/attachments/{attachment_id}/preview-url
  → 返回 { url, studio_token, api_base_url, order_id, ... }
        │
        ├─► window.open(studioUrl + "?mesh=" + encodeURIComponent(url))
        └─► child.postMessage({ type: "robots:studio-bootstrap", bootstrap }, studioOrigin)

[URDF-Studio 标签]
        │
        ├─► useMeshPreviewFromUrl（已有，不改）
        │     读取 ?mesh= → fetch GLB → handleImport → 进入完整 Editor
        │
        ├─► useAgileRobotBootstrap（新增）
        │     监听 message → 校验 origin → sessionStorage 存 bootstrap
        │
        └─► AI 对话（修改，通用化工具支持）
              tools 非空 → MiniMax function calling 注册 edit_robot_appearance / regenerate_robot_3d
              LLM 返回 tool_calls → 确认 UI → 用户确认 → 执行
              edit_robot_appearance: jimeng/edit → hunyuan/submit → 轮询 → reload mesh
              regenerate_robot_3d:      hunyuan/submit → 轮询 → reload mesh
```

---

## 3. 模块结构

```
src/integrations/agile-robot/
  index.ts               # 公开入口（只 export 外部合约）
  types.ts               # RobotsStudioBootstrap, API request/response
  constants.ts            # MESSAGE_TYPE, origin 白名单, 轮询间隔
  bootstrap.ts            # getBootstrap / hasBootstrap / clearBootstrap（纯函数，仅依赖 sessionStorage）
  api.ts                  # jimengEdit / hunyuanSubmit / hunyuanPollJob（Bearer token 注入）
  meshReload.ts           # reloadMeshFromUrl（fetch GLB → blob → assetsStore → viewer 更新）
  components/
    ToolConfirmBanner.tsx  # 确认 UI（summary + 确认/取消 + 执行中/完成/失败状态）
  hooks/
    useAgileRobotBootstrap.ts  # postMessage 监听 → 写 sessionStorage
    useAgileRobotTools.ts      # 工具定义 + 确认状态机
```

### 依赖方向

```
app/ (AppContent, AIConversationConnector)
  └─► integrations/agile-robot/ (hooks, api, types)
        ├─► bootstrap.ts → sessionStorage only
        ├─► api.ts → bootstrap.ts (读 token/base_url)
        └─► meshReload.ts → assetsStore (Zustand)
```

---

## 4. 启动参数处理

### 4.1 `?mesh=` — 不改动

沿用现有 [useMeshPreviewFromUrl](../../src/app/hooks/useMeshPreviewFromUrl.ts)：
1. 读取 `mesh` query
2. `fetch(meshUrl)` 加载 GLB
3. 走 `handleImport` 进入完整 Editor

`preview_token` 在 URL 中，无需额外处理。

### 4.2 `postMessage` bootstrap — 新增

**消息类型常量**：`robots:studio-bootstrap`（固定）

**Bootstrap 数据结构**（[types.ts]）：

```ts
interface RobotsStudioBootstrap {
  studio_token: string
  studio_expires_at: string       // ISO 8601
  order_id: string
  attachment_id: string
  conversation_id: string | null
  input_image_path: string
  fallback_input_image_path: string
  api_base_url: string            // 含 /api/v1，无尾斜杠
}
```

**监听逻辑**（[useAgileRobotBootstrap.ts]）：

```ts
const MESSAGE_TYPE = 'robots:studio-bootstrap' as const

window.addEventListener('message', (event) => {
  // 校验 origin（VITE_AGILE_ROBOT_ORIGINS 白名单）
  if (!ALLOWED_ORIGINS.includes(event.origin)) return
  if (event.data?.type !== MESSAGE_TYPE) return

  const bootstrap = event.data.bootstrap
  sessionStorage.setItem('robots_studio_bootstrap', JSON.stringify(bootstrap))
})
```

**安全要求**：
- `studio_token` 只存 `sessionStorage`（标签关闭即清），不出现在 URL
- 校验 `event.origin`
- origin 白名单从 `VITE_AGILE_ROBOT_ORIGINS` 环境变量读取（遵循 `VITE_HANDOFF_ORIGINS` 模式）

---

## 5. AI 对话工具

### 5.1 设计原则

- **LLM 识别意图**：通过 MiniMax function calling 原生支持，自动判断用户是否在请求改图/重生 3D
- **用户手动确认**：LLM 结构化参数后，`ToolConfirmBanner` 展示确认 UI，用户点「确认」才执行
- **不暴露中间过程**：用户只看到「正在生成新的 3D 模型…」，内部 jimeng 改图步骤不单独展示
- **结构化即梦提示词**：LLM 调用 `edit_robot_appearance` 时，`prompt` 参数必须按图生图最佳实践结构化生成（见 5.4），不得直接透传用户原话

### 5.2 工具定义

| function name | 用途 | 参数 | 内部流程 |
|---|---|---|---|
| `edit_robot_appearance` | 修改外观并重新生成 3D | `{ prompt: string }` | jimeng/edit → hunyuan/submit → 轮询 → reload mesh |
| `regenerate_robot_3d` | 直接用现有图片重新生成 3D | `{ image_size?: string }` | hunyuan/submit → 轮询 → reload mesh |

两个工具对用户展示相同的执行文案：「正在生成新的 3D 模型…」

### 5.3 流程

```
用户: "把机身改成橙色"
  │
  ▼
LLM (MiniMax function calling)
  │ 返回 tool_calls: [{ name: "edit_robot_appearance", arguments: { prompt: "<结构化提示词>" } }]
  │ prompt 按图生图最佳实践生成（见 5.4），非用户原话直传
  ▼
确认 UI（ToolConfirmBanner）
  ┌─────────────────────────────────────────────┐
  │ 🎨 将机身改为橙色，保留原视角  [确认] [取消]  │
  └─────────────────────────────────────────────┘
  │
  ├─ 取消 → append "已取消" → 继续对话
  │
  └─ 确认 → ⏳ 正在生成新的 3D 模型…
              │
              ├─ edit_robot_appearance:
              │     ① POST jimeng/edit { prompt, source_path }
              │     ② POST hunyuan/submit { image_path }
              │     ③ 每 4s 轮询 GET hunyuan/job
              │     ④ done → reloadMeshFromUrl(preview_url) → ✅ 3D 模型已更新
              │
              └─ regenerate_robot_3d:
                    ① POST hunyuan/submit
                    ② + ③ + ④ 同上
```

### 5.4 即梦改图 Prompt 结构规范

LLM 调用 `edit_robot_appearance` 时，`prompt` 参数必须按以下结构生成。系统指令中应明确要求 LLM 遵循此规范。

#### 5.4.1 结构化维度

| 维度 | 内容 | 示例 |
|------|------|------|
| **主体描述** | 对最终图片的详细描述：材质、颜色、形状、结构细节 | "机器人机身改为亮橙色(#FF8C00)，保留金属拉丝质感" |
| **保留约束** | 必须保留的元素 | "保持原有摄像机视角、机器人结构、关节位置和背景完全不变" |
| **图片规格** | 输出尺寸 | "输出尺寸 512×512 像素" |
| **风格/质量** | 渲染风格与质量标准 | "工业设计渲染风格，影棚灯光，高清晰度" |
| **负面约束** | 不要改变的内容 | "不要改变机器人结构、不要变形、不要添加文字或logo" |

#### 5.4.2 系统指令片段

LLM 对话 system prompt 中，`edit_robot_appearance` 工具的 description 应包含以下规范：

```
当用户请求修改机器人外观时，你必须生成结构化的图片编辑提示词，而非直接使用用户原话。
提示词必须包含以下五个维度，用自然段落表达：

1. 主体描述：将用户需求翻译为精确的视觉描述（材质、颜色、形状、结构），
   使用具体颜色名和色值（如"亮橙色 #FF8C00"、"哑光黑"、"拉丝金属"）
2. 保留约束：明确列出必须保留的元素（视角、结构、关节、背景）
3. 图片规格：输出尺寸为 512×512 像素
4. 风格/质量：工业设计渲染，影棚灯光，高清晰度，photorealistic
5. 负面约束：不要改变机器人结构、不要变形、不要添加文字或logo

示例——用户说"把机身改成橙色"，你应该生成：
"修改机器人机身颜色为亮橙色(#FF8C00)，保留原有金属材质质感和反光特性。保持原有摄像机视角、机器人结构、关节位置和背景完全不变。输出尺寸 512×512 像素。工业设计渲染风格，影棚灯光，高清晰度，photorealistic。不要改变机器人结构、不要变形、不要添加文字或logo。"
```

#### 5.4.3 确认 UI 展示

确认 UI 中展示的 `summary` 为 LLM 用简短中文概括的用户意图（如「将机身改为橙色，保留原视角」），而非完整的结构化 prompt。完整 prompt 通过 API 直接传给 jimeng，不展示给用户。

### 5.5 conversationService.ts 改动

`sendConversationTurnStream` 新增可选参数：

```ts
interface ConversationToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// 新增参数
tools?: ConversationToolDefinition[]
onToolCalls?: (toolCalls: ChatToolCall[]) => void
```

当 LLM 返回 `finish_reason: "tool_calls"` 时：
1. 调用 `onToolCalls(toolCalls)` 回调
2. 停止 streaming
3. 调用方（UI）负责展示确认 + 执行

### 5.6 AIConversationModal 改动

新增 **optional** prop `toolsConfig`：

```ts
interface AIConversationToolsConfig {
  tools: ConversationToolDefinition[]
  onExecute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
}
```

- `toolsConfig` 为空（默认）→ 行为与现在完全一致
- `toolsConfig` 非空 → 传给 `sendConversationTurnStream`，收到 tool_calls 后展示确认 UI

### 5.7 ToolConfirmBanner UI

位于最后一条 assistant 消息下方、输入框上方。

| 状态 | 展示 |
|------|------|
| **待确认** | 🎨 `{summary}` — [确认] [取消] |
| **执行中** | ⏳ 正在生成新的 3D 模型… |
| **完成** | ✅ 3D 模型已更新（3s 后自动消失） |
| **失败** | ❌ 生成失败：`{message}` — [重试] [取消] |

### 5.8 状态机 (useAgileRobotTools)

```
IDLE
  │
  ├─ LLM 返回 tool_calls → PARSED
  │     │
  │     ├─ 用户点「取消」→ CANCELLED → append "已取消" → IDLE
  │     │
  │     └─ 用户点「确认」→ EXECUTING
  │           │
  │           ├─ API 成功 → DONE → 3s 后 → IDLE
  │           └─ API 失败 → ERROR
  │                 │
  │                 ├─ 用户点「重试」→ EXECUTING
  │                 └─ 用户点「取消」→ IDLE
```

---

## 6. BFF API 调用

基址：`bootstrap.api_base_url`
鉴权：`Authorization: Bearer <studio_token>`

### 6.1 即梦改图

```http
POST {api_base_url}/me/projects/{order_id}/studio/jimeng/edit
Content-Type: application/json
Authorization: Bearer <studio_token>

{ "prompt": "...", "source_path": "orders/{order_id}/model_input.png" }
```

→ 200: `{ output_path, bytes_count, task_id }`

### 6.2 提交混元 3D

```http
POST {api_base_url}/me/projects/{order_id}/studio/hunyuan/submit
Content-Type: application/json
Authorization: Bearer <studio_token>

{ "image_path": "orders/{order_id}/model_input_customized.png" }
```

→ 202: `{ job_id, status: "pending", trigger_source: "studio" }`
→ 409: 已有进行中任务

### 6.3 轮询混元任务

```http
GET {api_base_url}/me/projects/{order_id}/studio/hunyuan/job
Authorization: Bearer <studio_token>
```

→ 200: `{ job_id, status, attachment_id, error_code, error_message, preview_url }`
- `preview_url` 仅在 `status === "done"` 时有值
- 轮询间隔 **4 秒**，超时 **5 分钟**

---

## 7. Mesh 热更新

[meshReload.ts] — 独立函数，不耦合 React 组件：

```ts
async function reloadMeshFromUrl(previewUrl: string): Promise<void> {
  const response = await fetch(previewUrl)  // preview_token 在 URL 中
  if (!response.ok) throw new Error(`Failed to fetch mesh: ${response.status}`)
  const blob = await response.blob()
  const file = new File([blob], 'updated_model.glb', { type: 'model/gltf-binary' })
  // 通过现有的 import 管线更新 workspace
  // ... 具体实现依赖现有 handleImport / assetsStore 接口
}
```

---

## 8. 错误码与用户提示

| HTTP / 状态 | 含义 | 用户提示 |
|---|---|---|
| 401 | `studio_token` 无效或过期 | 「会话已过期，请回到 Agile Robot 主站重新点击预览」 |
| 403 | scope / 归属不符 | 「无权限访问该项目」 |
| 404 | 源图或附件不存在 | 「订单资产缺失，请联系支持」 |
| 400 `input_image_missing` | 没有可用输入图 | 「未找到输入图片，请先改图后再生成 3D」 |
| 409 | 混元任务进行中 | 「3D 生成任务正在进行中，请等待完成」 |
| 502 | 即梦/混元上游失败 | 展示后端返回 detail，「可稍后重试」 |
| job `failed` | 异步混元失败 | 展示 `error_message` |

---

## 9. 边界情况

| 场景 | 处理 |
|---|---|
| **postMessage 未收到** | 静默降级：`?mesh=` 正常加载，AI 工具不可用 |
| **postMessage 来自非白名单 origin** | 静默忽略 |
| **token 在对话中途过期** | 下次 API 调 401 → 工具展示「会话已过期」提示 |
| **`?mesh=` GLB 加载失败** | 现有 `useMeshPreviewFromUrl` 已有错误处理 |
| **hunyuan 轮询超时（5 分钟）** | 展示「生成超时，请稍后重试」，停止轮询，`AbortController` 清理 |
| **用户关闭标签页** | `AbortController` 随组件卸载 abort |
| **重复点确认** | 状态机在 EXECUTING 状态忽略重复点击 |
| **非 robots 会话（普通 dev）** | `toolsConfig` 为空，行为完全不变 |

---

## 10. App 侧接线点

| 接线点 | 位置 | 改动 |
|---|---|---|
| `useAgileRobotBootstrap()` | `AppContent.tsx` | 新增一行 hook 调用 |
| `toolsConfig` 传入 | `AIConversationConnector.tsx` | 从 `useAgileRobotTools()` 获取并传入 |
| `conversationService` tools 参数 | `conversationService.ts` | 新增可选 `tools` + `onToolCalls` 参数 |
| `AIConversationModal` 确认 UI | `AIConversationModal.tsx` | 新增可选 `toolsConfig` prop + `ToolConfirmBanner` 渲染 |
| `VITE_AGILE_ROBOT_ORIGINS` | `.env.example` | 新增环境变量说明 |

---

## 11. 明确不做

- 不新增登录 / 用户会话管理
- 不调 `/api/v1/agent/chat` 或 agent-runtime
- 不直连 MinIO、火山、腾讯 3D API
- 不新增 robots 主站「编辑」按钮（入口永远是「预览」）
- 不把 `studio_token` 写入 URL
- 不在 .env 中配置即梦/混元密钥
- 不新建 viewer 模式（使用完整 Editor）
- 不改动 `?mesh=` 加载逻辑

---

## 12. 测试要点

| 测试对象 | 类型 | 覆盖内容 |
|---|---|---|
| `bootstrap.ts` | 单元 | origin 校验、畸形消息、sessionStorage 往返 |
| `api.ts` | 单元 | 请求/响应 shape、错误状态映射、token 注入 |
| `meshReload.ts` | 单元 | blob 创建、assetsStore 集成 |
| `useAgileRobotTools.ts` | 单元 | 状态机转换、重复确认防护 |
| `ToolConfirmBanner.tsx` | 组件 | 各状态渲染、确认/取消回调 |
| `conversationService` tools | 单元 | tools 参数传递、tool_calls 回调 |
