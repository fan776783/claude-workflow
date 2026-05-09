# 钉钉文档 MCP — 21 个工具速查

> **参数细节以 `dingtalk-mcp schema doc.<tool>` 为准**。本文件是用途分类 + required 提醒，服务端 schema 变化时这里不会自动同步。

服务端：`https://mcp-gw.dingtalk.com/server/af362c33.../?key=...`

## 术语

- **nodeId / dentryUuid**：文档 / 文件夹 / 文件节点的 32 位字母数字标识；很多工具可接受"节点链接 URL" 或 "纯 dentryUuid"，系统自动识别
- **workspaceId**：知识库 ID
- **folderId**：父文件夹的 nodeId
- **blockId / blockType**：文档块元素的 ID 和类型（paragraph / heading / table / image / ...）

---

## 创建类（6）

| 工具 | required | 说明 |
| --- | --- | --- |
| `create_document` | `name` | 建文字文档（.adoc）。支持三种位置：给 `folderId` / 给 `workspaceId`（建在知识库根）/ 都不给（"我的文档"根）。可选 `markdown` 初始化正文（**真换行符，不是字面量 `\n`**） |
| `create_folder` | `name` | 建文件夹。位置同上 |
| `create_file` | `name`, `type` | 建任意节点类型（sheet/mind-map/aitable/whiteboard/...）；要建钉钉文档用 `create_document` |
| `insert_document_block` | `nodeId`, `block` | 在文档里插块。可指定 `blockId` + 相对位置（head/tail）或 index |
| `get_file_upload_info` | `name` | 获取两阶段上传的凭证（URL + token） |
| `commit_uploaded_file` | - | 上传完成后提交，让文件真正落库（配合 `get_file_upload_info` 用） |

## 读取类（6）

| 工具 | required | 说明 |
| --- | --- | --- |
| `search_documents` | `keyword` | 全局搜当前用户可访问的文档，返回 nodeId + docUrl |
| `list_nodes` | `nodeId` 或 `workspaceId` | 列文件夹 / 知识库的直接子节点 |
| `get_document_info` | `nodeId` | 节点元数据（标题/类型/所有者/权限等） |
| `list_document_blocks` | `nodeId` | 查文档的一级块；支持 `startIndex` / `endIndex` / `blockType` 过滤 |
| `get_document_content` | `nodeId` | **注意：目前只支持钉钉在线文档（.adoc）**，其他扩展名会报 invalidRequest |
| `download_file` | `nodeId` | 获取文件下载凭证（对整个文件节点，不是文档里的附件） |

## 编辑类（3） ⚠️ 写入

| 工具 | required | 说明 | 危险等级 |
| --- | --- | --- | --- |
| `update_document_block` | `nodeId`, `blockId` | 单块内容 / 属性更新 | - |
| `update_document` | `nodeId` | **全量覆盖**文档正文，等同删 + 建 | **CLI 硬门（overwrite）** |
| `delete_document_block` | `nodeId`, `blockId` | 删块 | **CLI 硬门（destroy）** |

## 组织类（4）

| 工具 | required | 说明 | 危险等级 |
| --- | --- | --- | --- |
| `rename_document` | `nodeId`, `name` | 改节点标题 | - |
| `copy_document` | `nodeId`, `targetFolderId` | 复制节点到目标文件夹 | - |
| `move_document` | `nodeId`, `targetFolderId` | 移动节点 | - |
| `delete_document` | `nodeId` | 删节点（文档 / 文件夹 / 文件） | **CLI 硬门（destroy）** |

## 附件类（2）

| 工具 | required | 说明 |
| --- | --- | --- |
| `get_doc_attachment_upload_info` | `nodeId` | 获取向指定文档上传附件的 OSS 凭证 |
| `download_doc_attachment` | `nodeId`, `attachmentId` | 下载文档里的某个附件（**注意**：不同于 `download_file`，后者针对文件节点本身） |

---

## 调用约束

1. **`nodeId` 两种格式任选**：完整链接 URL（如 `https://alidocs.dingtalk.com/i/nodes/{dentryUuid}`）或纯 32 位 dentryUuid；系统自动识别
2. **`markdown` 参数换行**：`create_document` / `update_document` 的 markdown 入参必须用真换行符（U+000A），不是两字符字面量 `\n`。通过 `--json` 传 JSON 时注意 shell 转义
3. **权限**：操作受文档权限控制，没有编辑/查看权限的节点，调用会返回 permission 错误
4. **节点类型混用**：`get_document_content` 只能读 .adoc；文件/脑图/表格等节点类型用对应工具或下载后本地处理

## 危险操作清单（再声明）

无 `--yes` 会被 CLI 硬门拦截（exit 3）：

- `delete_document_block` — 删块
- `delete_document` — 删节点
- `update_document` — 全量覆盖正文

执行前 skill 必须向用户展示 target ID + 影响范围，用户确认后再加 `--yes`。
