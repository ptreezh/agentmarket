# OPS-RELEASE-20260909 — SSH 推送 + 双工作树运维方案

- 日期：2026-09-09
- 决策引用：GitHub GH013（workflow scope）阻塞 → SSH 账户级推送方案
- 状态：**已生效（2026-09-09 GitHub=Gitee=本地=7b132bc 三方同步）**

## 1. 为什么需要本方案

GitHub 安全规则（GH013）：**OAuth App 修改 `.github/workflows/*.yml` 需要 `workflow` scope**。
本项目含认领网关 workflow（`.github/workflows/claim-gateway.yml`，D-125），
而日常登录用的 OAuth token 通常没有该 scope → HTTPS push 被拒：

```
remote: - refusing to allow an OAuth App to create or update workflow
         `.github/workflows/claim-gateway.yml` without `workflow` scope
```

**SSH key 是账户级权限，不受 OAuth scope 限制** → 用 SSH 推送可正常更新 workflow 文件
（GitHub 对仓库 owner 的 SSH 显示 `Bypassed rule violations`，分支保护可绕过）。

## 2. 推送通道（三通道）

| 通道 | URL | 用途 | 权限说明 |
|---|---|---|---|
| `github` | `git@github.com:ptreezh/agentmarket.git` | 主仓库 + Pages 部署 | SSH（账户级，可改 workflow） |
| `origin`（Gitee） | `https://gitee.com/niuxiaohang/agentmarket.git` | 国内镜像 | HTTPS + 凭证 |
| `mirror` | `https://gitee.com/niuxiaohang/agentmarket.git` | 同 Gitee（别名） | HTTPS + 凭证 |

## 3. SSH key 约定

- 本机默认 key `~/.ssh/id_ed25519` 已认证 GitHub 账户 **ptreezh**（验证：`ssh -T git@github.com` → `Hi ptreezh!`）
- `id_ed25519_ptree` / `id_ed25519_shuren` **未**在 GitHub 注册（测试过 Permission denied）——不要误用
- 生成新 key 时：`ssh-keygen -t ed25519` 后到 GitHub Settings → SSH and GPG keys 添加公钥

## 4. 双工作树布局（2026-09-09）

| 工作树 | 位置 | 角色 | remote |
|---|---|---|---|
| 运营/用户本地 | `d:\agentmarket` | 日常发布入口（含最新+SSH） | origin=Gitee, github=SSH |
| Agent 工作副本 | `F:\market-repo-extracted\market-repo` | 开发/测试 | origin=SSH, github=SSH, mirror=Gitee |

> 两树都是完整 git 历史（7b132bc 起点），可互相 pull 同步，也可各自从远端拉。

## 5. 日常发布流程

```bash
# 1. 同步（在任一工作树）
git pull origin main            # Gitee 拉最新（或 git pull github main）

# 2. 开发 → 提交
git add -A
git commit -m "描述性提交信息"

# 3. 推两个远端（GitHub + Gitee 都保持最新）
git push github main            # SSH（可改 workflow 文件）
git push origin main            # Gitee（镜像同步）

# 4. 验证三方一致
git ls-remote github main
git ls-remote origin main
```

## 6. GitHub Pages 部署与验证

- Pages 源：main 分支根目录（`/`），推送后自动构建（约 1-3 分钟）
- 验证：
  - `https://ptreezh.github.io/agentmarket/` 手动打开
  - 或 `curl -s https://ptreezh.github.io/agentmarket/index.html | Select-String "AgentBazaar"`（应见英文标题）
- 缓存注意：浏览器/Cloudflare 可能缓存旧版，硬刷新（Ctrl+F5）或等 1-2 分钟

## 7. 协作者遇到 GH013 怎么办

| 场景 | 处理 |
|---|---|
| 有 SSH key（账户级） | `git remote set-url origin git@github.com:ptreezh/agentmarket.git` 后推 |
| 无 SSH key，仅 OAuth | 不直接推 workflow 文件——**fork + PR**（GitHub 规则要求 PR 途径） |
| 想获得 workflow 权限 | GitHub Settings → Developer settings → OAuth Apps → 重新授权勾选 `workflow` scope，或用含 workflow 的 PAT |

## 8. 安全备注

- SSH 私钥（`id_ed25519`）是账户级凭据——**绝不提交、不复制到仓库、不贴到日志**
- workflow 文件改动是 GitHub 敏感操作：修改 `.github/workflows/*` 前先确认意图（防恶意 workflow 注入）
- 对外协作者路径**不受影响**：认领走 `/claim` 评论（Actions 代推锁 ref）、发布/提交走 fork+PR——无需 SSH

## 9. 关联决策

- D-125：认领网关（引入 claim-gateway.yml，触发 GH013 场景）
- D-127：自动派发（publish.js --json）与英文清理（本次推送内容）
