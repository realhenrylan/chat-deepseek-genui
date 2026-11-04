```genui
{
  "type": "genui",
  "version": 5,
  "title": "四款笔记本加权评分对比",
  "state": [
    { "id": "wPrice", "label": "价格权重", "kind": "number", "initial": 40, "min": 0, "max": 100, "step": 5, "unit": "%" },
    { "id": "wWeight", "label": "重量权重", "kind": "number", "initial": 30, "min": 0, "max": 100, "step": 5, "unit": "%" },
    { "id": "wBattery", "label": "续航权重", "kind": "number", "initial": 30, "min": 0, "max": 100, "step": 5, "unit": "%" },
    { "id": "budget", "label": "预算上限", "kind": "number", "initial": 8000, "min": 4000, "max": 12000, "step": 500, "unit": "元" },
    { "id": "maxWeight", "label": "重量上限", "kind": "number", "initial": 2, "min": 1, "max": 2.5, "step": 0.1, "unit": "kg" }
  ],
  "derived": [
    {
      "id": "dCoverage",
      "label": "D 得分覆盖权重",
      "unit": "%",
      "expression": {
        "op": "divide",
        "left": {
          "op": "multiply",
          "left": { "op": "const", "value": 100 },
          "right": {
            "op": "add",
            "left": { "op": "state", "id": "wPrice" },
            "right": { "op": "state", "id": "wWeight" }
          }
        },
        "right": {
          "op": "max",
          "left": {
            "op": "add",
            "left": {
              "op": "add",
              "left": { "op": "state", "id": "wPrice" },
              "right": { "op": "state", "id": "wWeight" }
            },
            "right": { "op": "state", "id": "wBattery" }
          },
          "right": { "op": "const", "value": 1 }
        }
      }
    }
  ],
  "models": [
    {
      "kind": "preference",
      "id": "rank",
      "label": "笔记本综合评分",
      "precision": 2,
      "dimensions": [
        { "id": "price", "label": "价格", "weight": { "op": "state", "id": "wPrice" }, "direction": "lower" },
        { "id": "weight", "label": "重量", "weight": { "op": "state", "id": "wWeight" }, "direction": "lower" },
        { "id": "battery", "label": "续航", "weight": { "op": "state", "id": "wBattery" }, "direction": "higher" }
      ],
      "candidates": [
        { "label": "A 款", "values": { "price": 6999, "weight": 1.4, "battery": 8 } },
        { "label": "B 款", "values": { "price": 5499, "weight": 1.8, "battery": 6 } },
        { "label": "C 款", "values": { "price": 7999, "weight": 1.2, "battery": 10 } },
        { "label": "D 款", "values": { "price": 6299, "weight": 1.5, "battery": null } }
      ],
      "filters": [
        { "dimension": "price", "max": { "op": "state", "id": "budget" } },
        { "dimension": "weight", "max": { "op": "state", "id": "maxWeight" } }
      ]
    }
  ],
  "elements": [
    {
      "kind": "text",
      "value": "初始权重（价格 40 / 重量 30 / 续航 30）下：C 与 D 几乎同分，A 居中，B 垫底；调整权重或收紧预算、重量上限可看排名变化。"
    },
    {
      "kind": "note",
      "text": "参数取自题目：价格、重量、续航均为给定值；D 续航未提供，按缺失处理，不计 0，也不计入其得分分母。",
      "tone": "info"
    },
    {
      "kind": "section",
      "title": "权重调整",
      "children": [
        { "kind": "slider", "bind": "wPrice" },
        { "kind": "slider", "bind": "wWeight" },
        { "kind": "slider", "bind": "wBattery" }
      ]
    },
    {
      "kind": "section",
      "title": "筛选上限",
      "children": [
        { "kind": "slider", "bind": "budget" },
        { "kind": "slider", "bind": "maxWeight" }
      ]
    },
    {
      "kind": "columns",
      "columns": [
        [
          { "kind": "value", "label": "通过筛选", "source": { "kind": "model", "model": "rank", "key": "eligibleCount" } }
        ],
        [
          { "kind": "value", "label": "最高综合分", "source": { "kind": "model", "model": "rank", "key": "topScore" } }
        ],
        [
          { "kind": "value", "label": "D 得分覆盖权重", "source": { "kind": "derived", "id": "dCoverage" }, "unit": "%" }
        ]
      ]
    },
    {
      "kind": "table",
      "title": "排名与综合得分",
      "source": { "kind": "model", "model": "rank", "view": "ranking" },
      "sortable": true,
      "emptyText": "没有机型通过当前筛选。"
    },
    {
      "kind": "chart",
      "chartType": "bar",
      "title": "综合得分对比",
      "legend": false,
      "source": { "kind": "model", "model": "rank" }
    },
    {
      "kind": "table",
      "title": "分项明细（原始值、归一化、加权贡献）",
      "source": { "kind": "model", "model": "rank", "view": "breakdown" },
      "sortable": true,
      "emptyText": "没有机型通过当前筛选。"
    },
    {
      "kind": "explain",
      "model": "rank",
      "title": "评分口径与诊断"
    },
    {
      "kind": "note",
      "text": "D 没有续航数据：该维度对 D 为空值，只按价格与重量计分，得分不能与 A/B/C 直接比较。",
      "tone": "warn"
    },
    {
      "kind": "note",
      "text": "提高价格权重更有利于 B，提高重量权重更有利于 C；D 的得分不受续航权重影响，调高续航权重只改变 A/B/C。",
      "tone": "info"
    },
    {
      "kind": "table",
      "title": "原始参数（题目给定）",
      "columns": [
        { "key": "model", "label": "机型" },
        { "key": "price", "label": "价格（元）", "numeric": true },
        { "key": "weight", "label": "重量（kg）", "numeric": true },
        { "key": "battery", "label": "续航（小时）" }
      ],
      "rows": [
        { "cells": { "model": "A 款", "price": 6999, "weight": 1.4, "battery": 8 } },
        { "cells": { "model": "B 款", "price": 5499, "weight": 1.8, "battery": 6 } },
        { "cells": { "model": "C 款", "price": 7999, "weight": 1.2, "battery": 10 } },
        { "cells": { "model": "D 款", "price": 6299, "weight": 1.5, "battery": "未提供" } }
      ]
    }
  ]
}
```
