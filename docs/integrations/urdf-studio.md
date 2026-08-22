# URDF-Studio ↔ Agile Robot（robots）对接指南

面向 [URDF-Studio](https://github.com/luruxian/URDF-Studio) 开发者：说明如何与本仓库（Agile Robot / robots）对接。

- **契约来源**：[`docs/superpowers/specs/2026-08-08-studio-jimeng-hunyuan-bff-design.md`](../superpowers/specs/2026-08-08-studio-jimeng-hunyuan-bff-design.md)
- **robots 实现计划**：[`docs/superpowers/plans/2026-08-08-studio-jimeng-hunyuan-bff.md`](../superpowers/plans/2026-08-08-studio-jimeng-hunyuan-bff.md)
- **状态**：robots 侧 BFF 按该 plan 落地；本文档定义 Studio 侧应对齐的接口与行为

---

## 1. 角色边界（先读这段）

| 能力 | 谁负责 | 说明 |
|------|--------|------|
| 用户登录 | robots 主站 | Cookie 会话 `ar_session`；Studio **不**做登录 |
| 打开工作台 | robots「我的项目 → **预览**」 | **没有**单独的「编辑」按钮；预览即入口 |
| AI 对话 | **URDF-Studio 内部** | 用 Studio 自有 LLM（`OPENAI_*` 等）；**不要**调 robots `/agent/chat` |
| 即梦改图 | robots BFF | Studio 只调 BFF；**不要**在 Studio 配火山 AK/SK |
| 混元 3D | robots BFF | Studio 只调 BFF；**不要**在 Studio 配腾讯密钥 |
| 读 GLB | robots GET + `preview_token` | 通过 `?mesh=` 传入的绝对 URL |
| 读 URDF + STL | `?import=` + `POST /api/download-asset` | 多文件包；契约见 [robots-urdf-stl-preview.md](robots-urdf-stl-preview.md) |
| MinIO / DB | robots 后端 | Studio 永不直连对象存储 |

**一句话**：Studio 管对话与 3D UI；robots 管登录、资产与即梦/混元密钥。

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
  （Cookie；仅主站调用）
        │
        ▼
返回 { url, studio_token, api_base_url, order_id, ... }
        │
        ├─► window.open( VITE_ROBOT_VIEWER_URL + "?mesh=" + encodeURIComponent(url) )
        │
        └─► child.postMessage({ type: "robots:studio-bootstrap", bootstrap }, studioOrigin)

[URDF-Studio 新标签]
        │
        ├─► 解析 ?mesh= → fetch GLB（无 Authorization，靠 URL 内 preview_token）
        ├─► 监听 message → 保存 studio_token / api_base_url / order_id ...
        │
        ├─► 用户与 Studio AI 对话
        │         │
        │         ├─► POST .../studio/jimeng/edit     Bearer studio_token
        │         └─► POST .../studio/hunyuan/submit  Bearer studio_token
        │                   → 轮询 GET .../studio/hunyuan/job
        │                   → done 时用 preview_url 重载 mesh
```

---

## 3. 启动参数

### 3.1 URL：`?mesh=`（必做）

主站打开形式：

```
https://<studio-host>/?mesh=<encodeURIComponent(glbAbsoluteUrl)>
```

示例（解码后）：

```
https://api.example.com/api/v1/me/projects/<order_id>/attachments/<attachment_id>?preview_token=<token>
```

Studio 需要：

1. 读取 `mesh` query
2. `fetch(meshUrl)` 加载 GLB（跨域；robots 已在 `CORS_ORIGINS` 放行 Studio origin）
3. 用现有 GLTF / mesh 管线渲染

`preview_token` 默认约 **60 分钟**有效；过期后需用户回主站再点「预览」。

### 3.2 `postMessage` bootstrap（必做）

主站在 `window.open` 后向 Studio 窗口发送：

```ts
type RobotsStudioBootstrapMessage = {
  type: 'robots:studio-bootstrap'
  bootstrap: {
    studio_token: string
    studio_expires_at: string // ISO 8601
    order_id: string
    attachment_id: string
    conversation_id: string | null
    input_image_path: string
    fallback_input_image_path: string
    api_base_url: string // 含 /api/v1，无尾斜杠，例如 https://api.example.com/api/v1
  }
}
```

**消息类型常量（固定）**：`robots:studio-bootstrap`

Studio 侧建议：

```ts
const MESSAGE_TYPE = 'robots:studio-bootstrap' as const

window.addEventListener('message', (event) => {
  // 生产环境必须校验 origin（主站域名白名单）
  // if (!ALLOWED_ORIGINS.includes(event.origin)) return

  if (event.data?.type !== MESSAGE_TYPE) return
  const bootstrap = event.data.bootstrap
  sessionStorage.setItem('robots_studio_bootstrap', JSON.stringify(bootstrap))
  // 进入「已接入 robots」工作流
})
```

**安全要求**：

- `studio_token` **不要**长期写在 URL query 里
- 校验 `event.origin`
- token 存 `sessionStorage`（标签关闭即清）即可

若 `postMessage` 因时序丢失，可约定 fallback：主站把 bootstrap 放在 URL hash（一次性读完后 `history.replaceState` 清掉）。优先实现 `postMessage`。

---

## 4. BFF API（Studio → robots）

基址：`bootstrap.api_base_url`  
订单：`bootstrap.order_id`  
鉴权（所有写接口）：

```http
Authorization: Bearer <studio_token>
Content-Type: application/json
```

**不要**带 Cookie；**不要**用 `preview_token` 调这些接口。

### 4.1 即梦改图

```http
POST {api_base_url}/me/projects/{order_id}/studio/jimeng/edit
```

**Request**

```json
{
  "prompt": "把机身改成橙色，保留原视角",
  "source_path": "orders/{order_id}/model_input.png"
}
```

- `prompt`：必填；Studio AI 解析出的自然语言即可
- `source_path`：可选；省略时后端用 bootstrap 的 `input_image_path` / fallback
- 路径必须以 `orders/` 开头，且 `order_id` 与 token 一致

**Response 200**

```json
{
  "output_path": "orders/{order_id}/model_input_customized.png",
  "bytes_count": 123456,
  "task_id": "volc-..."
}
```

后端可能对 prompt 再包一层中文模板（配置 `STUDIO_JIMENG_WRAP_PROMPT`，默认 true）。Studio **无需**自己拼火山 API。

### 4.2 提交混元 3D

```http
POST {api_base_url}/me/projects/{order_id}/studio/hunyuan/submit
```

**Request**

```json
{
  "image_path": "orders/{order_id}/model_input_customized.png"
}
```

- `image_path`：可选；默认 customized 图；不存在则 **400** `input_image_missing`
- 建议：用户说「重生 3D」前先确认已有改图结果（或明确使用 `fallback` / 原图路径）

**Response 202**

```json
{
  "job_id": "...",
  "status": "pending",
  "trigger_source": "studio"
}
```

同一订单同时只能有一个进行中的 job；若已在 `submitting` / `running` → **409**。

### 4.3 轮询混元任务

```http
GET {api_base_url}/me/projects/{order_id}/studio/hunyuan/job
```

**Response 200**

```json
{
  "job_id": "...",
  "status": "pending|submitting|running|done|failed",
  "attachment_id": "...",
  "error_code": null,
  "error_message": null,
  "preview_url": "https://api.../attachments/{id}?preview_token=..."
}
```

- `preview_url` **仅**在 `status === "done"` 时有值
- 建议轮询间隔 **3–5 秒**，超时自行提示用户
- `done` 后：`fetch(preview_url)` 热更新 viewport 中的 mesh（不必整页刷新）
- `failed`：展示 `error_message` / `error_code`

---

## 5. Studio 侧建议实现清单

建议在 URDF-Studio 增加薄集成层（示例路径）：

```
src/integrations/agile-robot/
  bootstrap.ts      # postMessage + sessionStorage
  api.ts            # jimeng / hunyuan / job
  meshFromQuery.ts  # ?mesh= deep link
  types.ts
```

### Checklist

- [ ] 解析 `?mesh=` 并加载外部 GLB
- [ ] 监听 `robots:studio-bootstrap`，校验 origin，持久化 bootstrap
- [ ] `api.ts`：三个 BFF 调用 + 统一 401/409/502 处理
- [ ] AI Assistant 增加两个工具/动作：
  - **改图** → `jimeng/edit`
  - **重生 3D** → `hunyuan/submit` + 轮询 `hunyuan/job`
- [ ] job `done` → 用新 `preview_url` 重载 mesh
- [ ] token 过期 UI：提示「请回到 Agile Robot 主站重新点击预览」
- [ ] **不要**在 Studio 配置即梦 / 混元云厂商密钥（订单流水线）
- [ ] Studio 自有 `OPENAI_*` 仅用于对话 UI（可选）

### AI 工具伪代码

```ts
async function toolEditAppearance(prompt: string) {
  const b = getBootstrap()
  return fetch(`${b.api_base_url}/me/projects/${b.order_id}/studio/jimeng/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${b.studio_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      source_path: b.input_image_path || b.fallback_input_image_path,
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`jimeng ${r.status}`)
    return r.json()
  })
}

async function toolRegenerate3d(imagePath?: string) {
  const b = getBootstrap()
  const submit = await fetch(
    `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/submit`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${b.studio_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(imagePath ? { image_path: imagePath } : {}),
    },
  )
  if (submit.status === 409) throw new Error('job_in_progress')
  if (!submit.ok) throw new Error(`hunyuan submit ${submit.status}`)

  for (;;) {
    await sleep(4000)
    const job = await fetch(
      `${b.api_base_url}/me/projects/${b.order_id}/studio/hunyuan/job`,
      { headers: { Authorization: `Bearer ${b.studio_token}` } },
    ).then((r) => r.json())

    if (job.status === 'done' && job.preview_url) {
      await reloadMeshFromUrl(job.preview_url)
      return job
    }
    if (job.status === 'failed') throw new Error(job.error_message || 'hunyuan failed')
  }
}
```

---

## 6. 错误码与用户提示

| HTTP / 状态 | 含义 | Studio 建议提示 |
|-------------|------|-----------------|
| 401 | `studio_token` 无效或过期 | 回到主站重新点「预览」 |
| 403 | scope / 归属不符 | 无权限（一般不应出现） |
| 404 | 源图或附件不存在 | 订单资产缺失，联系主站流程 |
| 409 | 混元任务进行中 | 请等待当前 3D 任务完成 |
| 400 `input_image_missing` | 没有可用输入图 | 先改图，或检查订单是否已有 `model_input.png` |
| 502 | 即梦/混元上游失败 | 展示后端 detail，可重试 |
| job `failed` | 异步混元失败 | 展示 `error_message` |

---

## 7. 本地联调

### robots 侧

| 进程 | 典型地址 |
|------|----------|
| backend | `http://127.0.0.1:8000` |
| frontend | `http://127.0.0.1:5173` |

环境变量要点：

```env
# backend
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]
PUBLIC_API_BASE_URL=http://127.0.0.1:8000
# 即梦 / 混元 / MinIO 按 backend/.env.example

# frontend（构建期）
VITE_ROBOT_VIEWER_URL=http://127.0.0.1:3000
```

### Studio 侧

```bash
cd URDF-Studio
npm install
npm run dev   # 默认 http://127.0.0.1:3000
```

冒烟：

1. 主站登录 → 有完成混元的订单 → **预览**
2. Studio 打开且加载 GLB
3. DevTools → 收到 `robots:studio-bootstrap`
4. 触发改图 / 重生 3D，Network 出现 `/studio/jimeng/edit`、`/studio/hunyuan/*`

---

## 8. 生产部署注意

| 项 | 要求 |
|----|------|
| Studio 托管 | HTTPS；响应头含 COOP / COEP / CORP（见 URDF-Studio README） |
| robots `CORS_ORIGINS` | 含生产 Studio origin |
| robots `PUBLIC_API_BASE_URL` | 公网 API（Edge）地址，供 bootstrap `api_base_url` |
| robots `VITE_ROBOT_VIEWER_URL` | 生产 Studio URL（主站构建时写入） |
| `postMessage` | Studio 白名单主站 origin |
| 密钥 | 即梦/混元只在 robots；Studio 不持有 |

---

## 9. 明确不做（Studio 不要做）

- 登录 / 刷新 robots 用户会话
- 调用 `/api/v1/agent/chat` 或 agent-runtime
- 直连 MinIO、火山、腾讯 3D API（订单流水线）
- 依赖主站新增「编辑」按钮（入口永远是「预览」）
- 把 JWT / `studio_token` 永久写进可分享的 URL

---

## 10. 联调联系与变更

- robots 契约变更以本仓库 `docs/superpowers/specs/2026-08-08-studio-jimeng-hunyuan-bff-design.md` 为准
- 消息类型 `robots:studio-bootstrap` 与路径前缀 `/me/projects/{order_id}/studio` 视为稳定契约；破坏性变更需双方同步 bump

如有歧义，以该 design spec 的 API 契约章节为准。
