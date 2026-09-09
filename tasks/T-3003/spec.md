---
id: T-3003
title: [TEST] zero-node publish via gateway (E2E)
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-10-01T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-LOCAL01
input_ref: none
bidding: false
output_schema: |
  result/result.md: result summary file
acceptance:
  - {type: "file_exists", path: "result/ok.md"}
---
# T-3003 · [TEST] zero-node publish via gateway (E2E)

End-to-end verification of the /publish comment gateway after enabling Actions direct-push (D-128). Worker: create result/ok.md containing exactly: OK
