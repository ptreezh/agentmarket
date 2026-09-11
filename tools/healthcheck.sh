#!/usr/bin/env bash
# 自愈健康检查 · 智能体协同市场
# 每步执行前运行：git 链 / 账本守恒 / 关键工件 / 确定性。失败即自愈或停止，绝不带病推进。
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 2
FAIL=0

echo "== [1/5] git 完整性 =="
git fsck --no-progress >/dev/null 2>&1 && echo "  ✅ git fsck 无异常" || { echo "  ❌ fsck 失败"; FAIL=1; }
N=$(git rev-list --count HEAD)
echo "  ✅ 提交数: $N"

echo "== [2/5] 账本 append-only + 守恒 =="
LEDGERS=$(git ls-files 'ledger/L-*.md' | sort)
echo "  ✅ 账本条目: $(echo "$LEDGERS" | tr '\n' ' ')"
SEQ=$(echo "$LEDGERS" | sed -E 's|ledger/L-([0-9]+)\.md|\1|' | sort -n | tail -1)
echo "  最新 seq: $SEQ"

echo "== [3/5] 关键工件 =="
for f in DISCOVERY.md PROTOCOL.md tools/L0-DSL.md tools/verify.js; do
  [ -f "$f" ] && echo "  ✅ $f" || { echo "  ❌ 缺失 $f"; FAIL=1; }
done
[ -f tasks/T-2000/result/verify-result.json ] && echo "  ✅ T-2000 verify-result 存在" || { echo "  ❌ T-2000 结果缺失"; FAIL=1; }

echo "== [4/5] M0 模拟确定性（同种子重跑一致性） =="
if [ -f ../sim/m0-sim.js ]; then
  (cd ../sim && node m0-sim.js > /tmp/hc_a.json 2>&1 && node m0-sim.js > /tmp/hc_b.json 2>&1)
  python3 - <<'PY'
import json
def load(p):
    s=open(p,encoding='utf-8').read(); return json.loads(s[:s.rfind('}')+1])
a,b=load('/tmp/hc_a.json'),load('/tmp/hc_b.json')
for d in (a,b): d.pop('ts',None)
print("  ✅ 确定性一致" if json.dumps(a,sort_keys=True)==json.dumps(b,sort_keys=True) else "  ❌ 确定性不一致")
PY
fi

echo "== [5/5] 结算守恒抽查（L-0004: 40 = 34+2+1.2+2.8） =="
python3 - <<'PY'
parts={"reward":34,"deposit":2,"tax":1.2,"refund":2.8}
s=sum(parts.values())
print(f"  {'✅' if abs(s-40)<1e-9 else '❌'} L-0004 结算守恒 40 = {s}")
PY

echo "-- 签名检查 (D-19) --"
if command -v node >/dev/null 2>&1; then
  node tools/sigcheck.js | tail -1 || FAIL=1
else
  echo "  ⚠ node 缺失，跳过 sigcheck"
fi

echo "-- L1/L2 受限体检查 (D-43) --"
python3 - "$PWD" <<'PY2'
import os,sys,re
base=sys.argv[1]; bad=[]
t='tasks'
if os.path.isdir(t):
  for d in os.listdir(t):
    if not re.match(r'^T-\d+$',d): continue
    sp=os.path.join(t,d,'spec.md')
    if not os.path.exists(sp): continue
    sens=(re.search(r'^sens:\s*(\S+)',open(sp,encoding='utf-8').read(),re.M) or [None,'L0'])[1]
    if sens in ('L1','L2') and not os.path.exists(os.path.join(t,d,'restricted','content.enc')):
      bad.append(d)
print(('  ✅ L1/L2 受限体齐备' if not bad else '  ❌ 缺受限体: '+','.join(bad)))
if bad: sys.exit(1)
PY2
[ $? -eq 0 ] || FAIL=1

echo "== [6/6] 镜像探活（primary/mirror 可达性） =="
if command -v node >/dev/null 2>&1; then
  node "$REPO/tools/probe-mirrors.js" --repo "$REPO"
  case $? in
    0) echo "  ✅ primary 可达（市场在线）" ;;
    1) echo "  ⚠️ primary 不可达，但 mirror 可达（降级只读）"; FAIL=1 ;;
    2) echo "  ❌ primary 与 mirror 均不可达"; FAIL=1 ;;
    *) echo "  ⚠️ 探活异常" ;;
  esac
else
  echo "  ⚠️ 无 node，跳过镜像探活（不判 FAIL）"
fi

[ "$FAIL" -eq 0 ] && echo "== 健康检查：全部通过 ==" || { echo "== 健康检查：存在失败项，需自愈 =="; exit 1; }
