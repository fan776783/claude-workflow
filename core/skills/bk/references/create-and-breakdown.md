# 创建工作项 / AI 拆任务 / 上传附件

低频 / 进阶场景。主体 skill 已覆盖 80% 日常调用；本文件补齐"写"这一侧。

## 目录

- [create_issue — 建工作项（BUG / 需求 / 任务）](#create_issue)
- [task_breakdown + create_blueking_task — AI 拆分两步式](#task_breakdown)
- [upload_files — 上传附件到 Issue](#upload_files)

---

<a name="create_issue"></a>
## create_issue — 建工作项

### 最简形态（BUG / 需求）

BUG 和需求的必填项少，直接一行：

```bash
node cli/bk.mjs create_issue \
  --project_id v10125 \
  --title "【模块】简短问题描述" \
  --issue_type 缺陷 \
  --priority HIGH \
  --desc "**【测试步骤】**：...\n**【预期】**：...\n**【实际】**：..." \
  --assign_id fanjj
```

`priority` 这里**必须用英文代码**：`URGENT | HIGH | CENTRAL | LOW`。传中文会报 `非法优先级`。
`issue_type` 接受中文名：`缺陷` / `需求` / `任务`。

### "任务"类型：必填自定义字段

建"任务"（TASK）时服务端会强制 5 个自定义字段，只传标题会被挡：

```
以下必填字段缺少值: 「版本」(fieldId=672b5f7d003842e6b8e4141cea6fe139)、
  「经办人」(fieldId=f312b099e572411cbcabbd2592eed55e)、
  「预估工时(h)」(fieldId=81f1320686ac442194ad683f442978b2)、
  「预计开始时间」(fieldId=50872e8b643d42e6b1ba2dcf4387250e)、
  「预计结束时间」(fieldId=46b7d4119bd64c91b119e9a6fb874b51)。
请在 instance_value 中补充 fieldId 与 value。经办人字段可通过 assign_id 或 instance_value 指定。
```

**照报错一次性补齐**，不要一个字段一个字段试：

```bash
node cli/bk.mjs create_issue --json '{
  "project_id": "v10125",
  "title": "修复排行榜刷新逻辑",
  "desc": "承接 p328_8729",
  "priority": "HIGH",
  "issue_type": "任务",
  "parent_id": "11b07d3439914393bc587f3209ef204b",
  "assign_id": "fanjj",
  "instance_value": [
    {"fieldId":"672b5f7d003842e6b8e4141cea6fe139","value":"cac33320538b48b3b08e1d2cca7788c1","displayValue":"V1.00.30"},
    {"fieldId":"f312b099e572411cbcabbd2592eed55e","value":"fanjj","displayValue":"范俊杰"},
    {"fieldId":"81f1320686ac442194ad683f442978b2","value":"2","displayValue":"2"},
    {"fieldId":"50872e8b643d42e6b1ba2dcf4387250e","value":"2026-04-28","displayValue":"2026-04-28"},
    {"fieldId":"46b7d4119bd64c91b119e9a6fb874b51","value":"2026-04-30","displayValue":"2026-04-30"}
  ]
}'
```

### 字段 ID / 选项值怎么拿

字段集按工作项类型分裂（BUG 93+ 字段，TASK 另一套）。拿法：

1. **从同类型已有 Issue 反查**（最快）：
   ```bash
   node cli/bk.mjs update_issue --issue_number <同类型已有> \
     --dry_run true --list_fields true
   ```
   返回的 `available_fields[]` 里每项含 `id / label / options[]`，options 里的 `value` 就是要传的枚举值，`display` 是中文名。

2. **从 `task_breakdown` 的 output_format 反查**：当 `task_description` 明确时，服务端会把必填字段及其候选枚举值列在 prompt 里（见下一节）。

### 返回体

成功：
```json
{
  "success": true,
  "message": "工作项创建成功",
  "issue": {
    "id": "48d2a9d5...",
    "number": "p328_8732",
    "title": "...",
    "state": "3414cfbc1067444c95ddc6dc0e230c9e",
    "state_cn": "待处理",
    "project_id": "v10125",
    "type_classify": "TASK",
    "url": "https://devops.300624.cn/console/vteam/v10125/twTask/IssueDetail?..."
  }
}
```

> **⚠️ 无删除 API**，建错了只能流转到"已取消"或让用户在平台删。写入前让用户确认。

---

<a name="task_breakdown"></a>
## task_breakdown + create_blueking_task — AI 拆分两步式

`task_breakdown` **不直接建子任务**，它返回一段 prompt + output_format，需要当前模型按格式推理，再喂给 `create_blueking_task` 批量建。

### Step 1：让服务端给出拆解指令

```bash
node cli/bk.mjs task_breakdown \
  --project_id v10125 \
  --issue_id 11b07d3439914393bc587f3209ef204b \
  --issue_number p328_8729 \
  --task_description "拆分为前端/后端/测试三条执行路径，前端负责 UI 和交互修复，后端负责数据接口，测试负责回归"
```

> `issue_id` 是内部 UUID（从 `get_issue` 的 `basic_info.id` 拿）；`issue_number` 是 `p328_8729` 形式。两者都是必填。

返回：
```json
{
  "prompt": "请结合当前代码与提示词分析，并按 output_format 输出拆解结果...",
  "output_format": "{ \"issues\": [ { \"title\": \"...\", \"modelTypeId\": \"300c4ff7...\", \"priority\": \"CENTRAL\", \"instanceValue\": [ ... ] } ] }"
}
```

`output_format` 里会列出该项目下"任务"类型的必填 `fieldId` 和可选枚举值，照填即可。

### Step 2：当前模型按 output_format 生成 tasks[]，交用户确认

这一步**在当前会话里做**，不要瞎代用户确认。生成完带着确认再走下一步。

### Step 3：批量建子任务

```bash
node cli/bk.mjs create_blueking_task --json '{
  "project_id": "v10125",
  "parent_issue_id": "11b07d3439914393bc587f3209ef204b",
  "tasks": [
    {
      "title": "[前端] 修复组别切换时排行榜未刷新",
      "modelTypeId": "300c4ff73a4b4490b99771f554c564d1",
      "priority": "HIGH",
      "editorType": "MARKDOWN",
      "desc": "修改 useRank.ts 的 useEffect 依赖",
      "parentId": "11b07d3439914393bc587f3209ef204b",
      "fileVO": [],
      "instanceValue": [
        {"fieldId":"672b5f7d003842e6b8e4141cea6fe139","value":"cac33320538b48b3b08e1d2cca7788c1","displayValue":"V1.00.30"},
        {"fieldId":"f312b099e572411cbcabbd2592eed55e","value":"fanjj","displayValue":"范俊杰"},
        {"fieldId":"81f1320686ac442194ad683f442978b2","value":"2","displayValue":"2"},
        {"fieldId":"50872e8b643d42e6b1ba2dcf4387250e","value":"2026-04-28","displayValue":"2026-04-28"},
        {"fieldId":"46b7d4119bd64c91b119e9a6fb874b51","value":"2026-04-29","displayValue":"2026-04-29"}
      ]
    }
  ]
}'
```

### `instance_value` vs `instanceValue`：命名不一致

- `create_issue` 用 **`instance_value`**（snake_case）
- `create_blueking_task` 里每个 task 用 **`instanceValue`**（camelCase），还必须带 `modelTypeId` / `editorType` / `fileVO`（可 `[]`）

这是服务端历史遗留，CLI 不做翻译，照 schema 传。选错大小写会被 additionalProperties:false 直接拒。

### 返回体

```json
{
  "tasks": [
    {
      "id": "663b929a...",
      "number": "p328_8733",
      "title": "[前端] ...",
      "url": "https://devops.300624.cn/console/vteam/v10125/twTask/IssueDetail?..."
    }
  ]
}
```

---

<a name="upload_files"></a>
## upload_files — 上传附件到 Issue

### Schema

每个文件对象必须是 `{ name, content_base64, size }`，**不接受 `path`**。

### 一行拼 JSON 上传

```bash
# Node 内联生成 JSON，避免手算 base64 / size
node -e '
  const fs = require("fs");
  const path = "/tmp/screenshot.png";
  const b = fs.readFileSync(path);
  console.log(JSON.stringify({
    issue_number: "p328_8729",
    files: [{
      name: require("path").basename(path),
      content_base64: b.toString("base64"),
      size: b.length
    }]
  }));
' > /tmp/upload.json

node cli/bk.mjs upload_files --json "$(cat /tmp/upload.json)"
```

### 多文件

`files[]` 可以放多个对象，一次请求上传。

### 返回体

```json
{
  "success": true,
  "message": "成功上传 1 个文件到工作项 p328_8729",
  "issue_number": "p328_8729",
  "issue_url": "https://...",
  "uploaded_files": [
    {
      "file_name": "screenshot.png",
      "file_id": "f318a14c...",
      "size": 23456
    }
  ]
}
```

要在 `desc` 里引用附件，用服务端返回的路径格式：
```markdown
![screenshot](/ms/vteam/api/user/file/v10125/download/<file_id>)
```

> **⚠️ 无删除 API**，上传后需用户到平台端删。`size` 有校验，用 `Buffer.byteLength` / `wc -c` 拿准确字节数，不要手数。
