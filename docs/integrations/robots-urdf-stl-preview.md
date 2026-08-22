# robots 主站 → URDF Studio：URDF + STL 预览接口

面向 **Agile Robot / robots 主站** 开发人员。说明如何打开 Studio，预览「一份 URDF + 若干 mesh（STL/DAE/OBJ 等）」而不是单个 GLB。

- GLB / 混元单文件预览：见 [urdf-studio.md](urdf-studio.md)（`?mesh=` + `mesh_auth`）
- 本文只覆盖 **多文件机器人包**。不要把 URDF 或 ZIP 塞进 `?mesh=`

Studio 接收端已落地，主站只需按本文打开 URL，并实现文件列表接口。

---

## 1. 选哪条打开链路

| 资产形态 | 打开方式 | 说明 |
|----------|----------|------|
| 单个 `.glb` / `.gltf` | `?mesh=` + `?mesh_auth=` | 现有协议，见 [urdf-studio.md](urdf-studio.md) §3.1 |
| `.urdf` + `meshes/*.stl`（及 DAE/OBJ/贴图） | **`?import=` + `from=`** | 本文 |
| 已打好的 `.zip`（包内是 URDF + mesh） | 也走本文；列表里只返回那一个 zip | 可工作，但无单文件进度；优先展开成文件列表 |

`?mesh=` 只会 `GET` **一个**文件，并按 GLB 导入。URDF 引用的 STL 相对路径会丢失。

---

## 2. 端到端（主站视角）

```
[用户在主站已登录]
        │
        ▼
点击「预览」（资产是 URDF 包，不是 GLB）
        │
        ▼
主站签发短时 preview grant（assetId），有效期建议 ≤ 60 分钟
        │
        ▼
window.open(
  VITE_ROBOT_VIEWER_URL
    + "?import=" + encodeURIComponent(assetId)
    + "&from="   + encodeURIComponent(主站 origin)
  [可选] + "#robots-bootstrap=" + ...
)
        │
        ▼
Studio 新标签
        │
        ├─ 立刻从地址栏去掉 import / from（防止刷新重复导入）
        ├─ 若已有 Studio 标签打开：1s 内由旧标签认领，新标签可能关闭
        │
        ▼
POST {from}/api/download-asset
  body: { "assetId": "<同上>" }
  不带 Cookie；默认也不带 Authorization
        │
        ▼
主站返回 { success, data: { files[], rootFolderName } }
        │
        ▼
Studio 对每个 files[i].url 做 GET（不带 Cookie / Authorization）
        │
        ▼
按 webkitRelativePath = rootFolderName + "/" + path 还原目录后导入
```

登录、对象存储、授权仍由主站负责。Studio 不读 `ar_session`，也不直连 MinIO。

---

## 3. 打开 URL（主站构造）

```
https://<studio-host>/?import=<assetId>&from=<encodeURIComponent(fromOrigin)>
```

| 参数 | 必填 | 含义 |
|------|------|------|
| `import` | 是 | 预览授予 ID。Studio 原样放进 `POST /api/download-asset` 的 `assetId` |
| `from` | 是 | 主站 **origin**（`scheme://host[:port]`），用来拼下载接口并做白名单 |
| `convertTo` | 否 | 导入后打开导出对话框；预览不要带 |
| `jwt` | 否 | 历史参数，Studio 会从 URL 剥掉，**不会**用来拉文件 |

示例：

```text
https://urdf.enkeebot.com/?import=pvw_8f3a1c&from=https%3A%2F%2Frobots.enkeebot.com
```

本地：

```text
http://127.0.0.1:3000/?import=pvw_dev_001&from=http%3A%2F%2F127.0.0.1%3A5173
```

### 3.1 `import`（assetId）约定

- 任意非空字符串，**不要**以 `collection:` 开头（那是图库批量导入）
- 当作 **capability**：知道它就能列出并下载该包。用不可猜测的短时 ID，不要用可遍历的订单号
- 建议与 GLB 的 `preview_token` 一样，默认约 **60 分钟**过期；过期后用户回主站再点「预览」
- **不要**把长期 `studio_token` / 用户 JWT 写进可分享的 query

### 3.2 `from` 约定

- 必须是 http(s) origin，不要带 path / query / hash
- 必须出现在 Studio 的 `VITE_HANDOFF_ORIGINS`（逗号分隔，支持 `*`）
- 生产默认：`https://*.enkeebot.com,https://*.enkeebot.cn`
- 本地 Studio 默认 **不**放行 `localhost`，主站联调要让 Studio 加上：

```env
VITE_HANDOFF_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

未在白名单 → Studio 报 `Unauthorized origin`，不会调你的接口。

### 3.3 与 AI / bootstrap 并存

URDF 包预览 **不需要** `?mesh=`。若同一订单还要开 Studio 内 AI（即梦 / 混元），可继续带 `#robots-bootstrap=` 或 `postMessage`，契约见 [urdf-studio.md](urdf-studio.md) §3.2。

混元 `done` 后的 `preview_url` 仍是 **GLB 热重载**，不会替换当前 URDF 包。

### 3.4 主站打开示例

```ts
function openUrdfPackagePreview(opts: {
  studioUrl: string; // 例如 https://urdf.enkeebot.com 或 http://127.0.0.1:3000
  assetId: string;
  fromOrigin: string; // 例如 https://robots.enkeebot.com
}) {
  const url = new URL(opts.studioUrl);
  url.searchParams.set('import', opts.assetId);
  url.searchParams.set('from', opts.fromOrigin);
  window.open(url.toString(), '_blank');
}
```

---

## 4. 主站必须实现的接口

Studio 在校验 `from` 后调用：

```http
POST {fromOrigin}/api/download-asset
Content-Type: application/json
```

路径以开源 Core 为准，**就是** `/api/download-asset`，不是 `/api/v1/...`。  
若主站只想挂在 `/api/v1/me/projects/...`，需要 Studio 宿主注入 `setAssetDownloadEndpointResolver`（另约，本文按默认路径写）。

### 4.1 Request

```json
{
  "assetId": "pvw_8f3a1c"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `assetId` | string | 与 URL `import` 相同 |

鉴权（按当前 Studio 行为，不要假设浏览器会带登录态）：

| 项 | 实际行为 | 主站应怎么做 |
|----|----------|--------------|
| Cookie | **不发送**（无 `credentials: 'include'`） | 不要用 `ar_session` 鉴权这个接口 |
| `Authorization` | 仅当 Studio **宿主壳**注入了服务令牌才有 `Bearer ...`；开源 Core 默认 **没有** | 列表接口应靠 `assetId` 本身鉴权（短时 grant） |
| 文件 GET | 不带 Cookie，不加 Authorization | 每个 `files[].url` 必须自带凭证（预签名或 `?preview_token=`） |

### 4.2 CORS

Studio 从自己的 origin 跨域 POST。主站需：

```http
Access-Control-Allow-Origin: <Studio origin>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

`CORS_ORIGINS` 放行生产 / 本地 Studio（例如 `https://urdf.enkeebot.com`、`http://127.0.0.1:3000`）。  
不要用 `*` 再配 `Authorization`（浏览器会拒）。

对象存储上的预签名 GET 也要允许 Studio origin 读（或走带 CORS 的同源反代）。

### 4.3 Response 200（成功）

```json
{
  "success": true,
  "data": {
    "rootFolderName": "go2_description",
    "files": [
      {
        "path": "urdf/go2.urdf",
        "url": "https://objects.example.com/orders/123/urdf/go2.urdf?<presign>"
      },
      {
        "path": "meshes/base_link.stl",
        "url": "https://objects.example.com/orders/123/meshes/base_link.stl?<presign>"
      },
      {
        "path": "meshes/calf.stl",
        "url": "https://objects.example.com/orders/123/meshes/calf.stl?<presign>"
      }
    ]
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `success` | 是 | 必须为 `true` |
| `data.files` | 是 | 非空；缺省或空数组视为失败 |
| `data.files[].path` | 是 | 包内相对路径，用 `/`，**不要**前导 `/` |
| `data.files[].url` | 是 | 浏览器可 `GET` 的 http(s) 地址；可与 API 不同源 |
| `data.rootFolderName` | 是 | 虚拟根目录名，拼到每个文件的 `webkitRelativePath` |
| `data.urdfFile` | 否 | 类型里有；**当前 Studio 不读**，入口 URDF 由导入器从文件列表自行选择 |
| `message` | 否 | `success: false` 时给原因 |

失败时：

```json
{
  "success": false,
  "message": "preview_grant_expired"
}
```

HTTP 非 2xx 也会失败。建议：

| HTTP | 场景 |
|------|------|
| 200 + `success: false` | 业务失败（过期、找不到包） |
| 404 | grant / 资产不存在 |
| 401 / 403 | grant 无效（若你额外校验了 Bearer） |
| 502 | 对象存储列目录失败 |

### 4.4 TypeScript（主站可对照）

```ts
type AssetDownloadRequest = {
  assetId: string;
};

type FileDownloadInfo = {
  path: string;
  url: string;
};

type AssetDownloadResponse = {
  success: boolean;
  message?: string;
  data?: {
    files: FileDownloadInfo[];
    rootFolderName: string;
    urdfFile?: string; // 预留，Studio 暂不消费
  };
};
```

---

## 5. 目录与 URDF 引用（最容易错）

Studio 会把每个文件变成：

```text
webkitRelativePath = rootFolderName + "/" + path
```

例如 `rootFolderName=go2_description`、`path=meshes/base_link.stl` →  
`go2_description/meshes/base_link.stl`。

URDF 里的 mesh 必须能解析到列表中的文件：

```xml
<!-- 相对路径：相对该 .urdf 所在目录 -->
<mesh filename="../meshes/base_link.stl" />

<!-- 或 package://<包名>/... ；包名建议等于 rootFolderName -->
<mesh filename="package://go2_description/meshes/base_link.stl" />
```

推荐打包：

```text
go2_description/                  ← rootFolderName
  urdf/go2.urdf
  meshes/base_link.stl
  meshes/calf.stl
```

对应 `files[].path`：

- `urdf/go2.urdf`
- `meshes/base_link.stl`
- `meshes/calf.stl`

规则：

1. 列出 URDF **实际引用到的**全部资源（STL / DAE / OBJ / MTL / 贴图）。缺一个，对应 link 就没 mesh
2. `path` 保持包内相对位置，不要把所有文件拍扁到同一层（除非 URDF 也是扁的）
3. 不要返回 `.git` / `__MACOSX` / 以 `.` 开头的目录（Studio 会跳过隐藏路径）
4. 一个包里可以有多个 `.urdf`；Studio 会按现有导入启发选择入口，不必再传 `urdfFile`
5. 支持的 mesh 与本地导入相同：STL、DAE、OBJ、GLB/GLTF 等。纹理按 URDF / DAE 引用带上即可

### 5.1 只返回一个 ZIP

可以：

```json
{
  "success": true,
  "data": {
    "rootFolderName": "bundle",
    "files": [
      {
        "path": "go2_description.zip",
        "url": "https://objects.example.com/orders/123/go2_description.zip?<presign>"
      }
    ]
  }
}
```

ZIP 内部仍须是完整目录树（URDF + meshes），不要只压一个 `.urdf`。  
能展开成文件列表时优先展开：导入进度按文件走，也避免套一层压缩。

---

## 6. 限制（Studio 侧硬门槛）

超过任一上限会直接失败，主站应在签发 grant 前裁剪或拒绝预览。

| 项 | 上限 |
|----|------|
| 文件数 | 2000 |
| 单文件 | 512 MB |
| 合计 | 512 MB |
| 下载并发 | 8（Studio 限流，主站无需对齐） |

预签名 URL 有效期应 **≥** grant 寿命；用户点预览后下载可能持续数十秒。

---

## 7. 已有 Studio 标签

同一浏览器里若已有 Studio 页，新打开的预览标签会先广播 `botworld-handoff`，等 1 秒：

- 旧标签回复 `import-accepted` → 由旧标签下载导入，**新标签可能 `window.close()`**
- 无人认领 → 当前新标签自己导入

主站不要依赖「每次预览都留下一个新标签」，也不要靠 `window.opener` 做后续协议。

---

## 8. 不要做

- 不要对 URDF 包使用 `?mesh=` / `?mesh_auth=`
- 不要让 Studio 带 Cookie 调本接口（当前不会带）
- 不要返回磁盘路径（`/var/www/...`）或 `file://`
- 不要在 `files[].url` 上再要求 `Authorization` 头
- 不要把 MinIO 永久公开读；用短时预签名
- 不要把 `studio_token` 写进可复制的 URL

---

## 9. 联调检查清单

主站：

- [ ] 预览按钮：URDF 包走 `?import=` + `from=`，GLB 仍走 `?mesh=`
- [ ] 实现 `POST /api/download-asset`，按 `assetId` 返回文件列表
- [ ] `files[].url` 预签名，浏览器无头可 GET
- [ ] CORS 放行 Studio origin
- [ ] `path` 与 URDF 内 `filename` 对得上
- [ ] grant 过期后用户回主站再点预览即可恢复

Studio（本地）：

- [ ] `VITE_HANDOFF_ORIGINS` 含主站 origin
- [ ] `VITE_ROBOT_VIEWER_URL`（主站侧）指向本机 Studio，如 `http://127.0.0.1:3000`
- [ ] 打开后出现导入遮罩，随后 3D 视图出现整机（含 STL），不是空 link

冒烟失败对照：

| 现象 | 先查 |
|------|------|
| `Unauthorized origin` | `from` 不在 `VITE_HANDOFF_ORIGINS`，或带了 path |
| 遮罩停在 fetching | `/api/download-asset` 404 / CORS / 非 JSON |
| 模型在、全是白块 / 没 mesh | `path` 对不上 URDF，或 STL 没进 `files` |
| 401 后回主站 | grant 过期，重新点预览 |

---

## 10. 与 GLB 预览对照

| | GLB（已有） | URDF + STL（本文） |
|--|-------------|-------------------|
| URL | `?mesh=` + `?mesh_auth=` | `?import=` + `from=` |
| Studio 拉数 | `GET` 单个 GLB，`Authorization: Bearer mesh_auth` | `POST /api/download-asset` 再 `GET` 多个预签名 URL |
| 主站接口 | `.../attachments/{id}/preview-url` | **新增** `POST /api/download-asset` |
| Cookie | 仅主站自己换 preview-url 时用 | 列表接口不要依赖 Cookie |
| AI bootstrap | 可选，同一套 | 可选，同一套 |

两条链路可以同时存在：主站按附件类型分支即可。
