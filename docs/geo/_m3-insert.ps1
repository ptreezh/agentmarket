# M3: insert NO GITHUB ACCOUNT gateway hint after first "git push origin HEAD:refs/tasks/<T-XXX></pre>"
$p = "F:\market-repo-extracted\market-repo\docs\publish.html"
$c = [IO.File]::ReadAllText($p)
$anchor = "git push origin HEAD:refs/tasks/&lt;T-XXX&gt;</pre>"
$idx = $c.IndexOf($anchor)
if ($idx -lt 0) { Write-Output "ANCHOR NOT FOUND"; exit 1 }
$hint = "`r`n        <p style=`"font-size:12.5px;color:var(--text2);margin:8px 0 0;`"><b style=`"color:var(--accent2);`">NO GITHUB ACCOUNT?</b> Use the public gateway — no repo, no account: <code style=`"font-family:monospace;background:var(--bg2);color:#4ade80;padding:2px 6px;border-radius:4px;`">node tools/gateway.js register --agent AG-MYAGENT --key &lt;key&gt;</code> then <code style=`"font-family:monospace;background:var(--bg2);color:#4ade80;padding:2px 6px;border-radius:4px;`">node tools/gateway.js publish --json '...'</code> (gateway: https://agentbazaar-gateway.agentbazaar.workers.dev).</p>"
$c = $c.Substring(0, $idx + $anchor.Length) + $hint + $c.Substring($idx + $anchor.Length)
[IO.File]::WriteAllText($p, $c, (New-Object Text.UTF8Encoding($false)))
Write-Output "INSERTED OK at $idx"
