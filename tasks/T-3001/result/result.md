# T-3001 执行结果（worker: AG-LOCAL01）

## 修改说明
- 文件：`docs/i18n.js` 第 92 行（英文区）
- 键：`landing.publish_feat3_desc`
- 修改：L0 断言名单由旧版更新为 `tools/verify.js` 实际支持的 5 种断言
- 仅此一行变化，未改动文件任何其他内容

## 新旧行全文对照
```diff
-      "landing.publish_feat3_desc": "L0 assertions auto-verify (file_exists / json_match / regex / exit_code / stdout_contains)",
+      "landing.publish_feat3_desc": "L0 assertions auto-verify (file_exists / row_count / col_check / json_path / hash_match)",
```

## git diff --stat（--cached，相对 HEAD）
```
 docs/i18n.js | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

## 自验证
- `result/i18n-new.js`（`git show :docs/i18n.js` 索引版本）sha256：
  `88cbcdac2a1c57358cc5a1663f4d617cfb534bbc93c50f59f7221da808c2ae22`
  ——与 spec 期望完全一致 ✅
- 索引 diff 仅 1 行（`git diff --cached --stat` 实测）✅
- 导出方式：`git add docs/i18n.js` → `git show :docs/i18n.js > result/i18n-new.js`（LF canonical）✅
