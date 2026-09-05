# L0 断言 DSL · 1.0
> 状态：**确定（locked）** · 对应 PROTOCOL §4/§6（D-39/D-40/D-30）
> 目的：让「验收标准」从自然语言变成**机器可执行断言**，审核 = 跑断言 + 哈希校验，O(1)，零人工。

## 放置位置
任务 `tasks/<id>/spec.md` 的 frontmatter `acceptance:` 数组；相对路径均以**任务目录 `tasks/<id>/`** 为根。

## 断言类型（5 种，KISS）

| type | 字段 | 语义 | 通过条件 |
|---|---|---|---|
| `file_exists` | `path` | 结果文件必须存在 | 文件存在即过 |
| `row_count` | `path, op, value` | CSV 数据行数（不含表头）比较 | `rows op value` |
| `col_check` | `path, col, op, value` | CSV 指定列逐行满足条件 | 每行数值均满足 |
| `json_path` | `path, path_expr, op, value` | JSON 路径取值比较（`$.a.b[0]`） | `val op value`（数值容差 1e-6） |
| `hash_match` | `path, sha256` | 结果文件哈希比对（防篡改/保证确定性） | SHA-256 全等 |

op 仅允许：`eq, ne, gt, ge, lt, le`。
value 类型：数值或字符串（`eq/ne` 支持字符串）。

## 语义约束
- 断言**全部**必须通过 → 任务验收通过；任一失败 → 拒绝，按 `timeout_penalty`/押金规则处理（D-12/D-40）。
- `hash_match` 强制在输出为**确定性生成物**的任务中使用；无确定性输出（如综述类）改用 `row_count`+`col_check` 等结构断言。
- 拒绝语义词：`基本完成` / `看起来不错` / `符合要求` 等无法机器判定的措辞在 `acceptance` 中**禁止**（D-40）。

## 校验器
`tools/verify.js`（参考实现，Node 无依赖）：`node tools/verify.js <taskDir>` →
- 输出 `tasks/<id>/result/verify-result.json`：
  ```json
  { "task":"T-2000", "ts":"...", "total":5, "passed":5,
    "assertions":[ {"type":"row_count","passed":true,"detail":"5 ge 5"} , ...],
    "verdict":"PASS" }
  ```
- 退出码 0 = PASS，1 = FAIL。
- 校验器自身用同一 `hash_match` 逻辑独立重算，不信任 worker 自报哈希（防伪）。
