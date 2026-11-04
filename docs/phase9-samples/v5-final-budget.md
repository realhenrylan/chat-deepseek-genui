```genui
{
  "type": "genui",
  "version": 5,
  "title": "月度预算小工具",
  "state": [
    { "id": "dining", "label": "餐饮支出", "kind": "number", "initial": 2600, "min": 0, "max": 5000, "step": 100, "unit": "元" },
    { "id": "other", "label": "其他支出", "kind": "number", "initial": 900, "min": 0, "max": 3000, "step": 100, "unit": "元" }
  ],
  "derived": [
    {
      "id": "ratio",
      "label": "支出占收入比例",
      "expression": {
        "op": "multiply",
        "left": {
          "op": "divide",
          "left": {
            "op": "add",
            "left": {
              "op": "add",
              "left": {
                "op": "add",
                "left": { "op": "const", "value": 4500 },
                "right": { "op": "state", "id": "dining" }
              },
              "right": { "op": "const", "value": 600 }
            },
            "right": { "op": "state", "id": "other" }
          },
          "right": { "op": "const", "value": 12000 }
        },
        "right": { "op": "const", "value": 100 }
      }
    }
  ],
  "models": [
    {
      "kind": "budget",
      "id": "monthly",
      "label": "月度预算",
      "unit": "元",
      "precision": 0,
      "income": { "op": "const", "value": 12000 },
      "expenses": [
        { "label": "房租", "amount": { "op": "const", "value": 4500 } },
        { "label": "餐饮", "amount": { "op": "state", "id": "dining" } },
        { "label": "交通", "amount": { "op": "const", "value": 600 } },
        { "label": "其他", "amount": { "op": "state", "id": "other" } }
      ]
    }
  ],
  "elements": [
    { "kind": "note", "text": "月收入 12000 元为示例设定；房租 4500、交通 600 为固定支出，餐饮与其他可用滑块调整（步长 100 元）。" },
    {
      "kind": "section",
      "title": "调整支出",
      "children": [
        { "kind": "slider", "bind": "dining" },
        { "kind": "slider", "bind": "other" }
      ]
    },
    {
      "kind": "section",
      "title": "预算概览",
      "children": [
        { "kind": "value", "label": "月收入", "source": { "kind": "model", "model": "monthly", "key": "income" }, "unit": "元" },
        { "kind": "value", "label": "支出合计", "source": { "kind": "model", "model": "monthly", "key": "expenses" }, "unit": "元" },
        { "kind": "value", "label": "月余额", "source": { "kind": "model", "model": "monthly", "key": "balance" }, "unit": "元" },
        { "kind": "value", "label": "支出占收入", "source": { "kind": "derived", "id": "ratio" }, "unit": "%" }
      ]
    },
    { "kind": "note", "text": "当前支出未超过收入，余额为正。", "tone": "info", "visibleIf": { "op": "num-lte", "left": { "op": "derived", "id": "ratio" }, "right": { "op": "const", "value": 100 } } },
    { "kind": "note", "text": "当前支出已超过收入，出现超支，请下调餐饮或其他支出。", "tone": "warn", "visibleIf": { "op": "num-gt", "left": { "op": "derived", "id": "ratio" }, "right": { "op": "const", "value": 100 } } },
    { "kind": "table", "title": "各项支出明细", "source": { "model": "monthly", "view": "items" }, "sortable": true },
    { "kind": "chart", "chartType": "bar", "title": "收入与支出对比", "legend": true, "source": { "model": "monthly" } },
    { "kind": "explain", "model": "monthly", "title": "计算依据" }
  ]
}
```
