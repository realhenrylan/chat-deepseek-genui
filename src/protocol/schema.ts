import { LIMITS } from './types.ts';

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: LIMITS.maxIdLength,
  pattern: '^[A-Za-z][A-Za-z0-9_]*$',
};

const labelSchema = { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength };
const unitSchema = { type: 'string', minLength: 1, maxLength: LIMITS.maxUnitLength };
const boundedNumberSchema = {
  type: 'number',
  minimum: -LIMITS.maxNumberMagnitude,
  maximum: LIMITS.maxNumberMagnitude,
};
// 只接受 6 位十六进制颜色，避免远程 paint server / 任意 CSS 值进入 SVG。
const colorSchema = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };

const textElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: {
    kind: { const: 'text' },
    value: { type: 'string', maxLength: LIMITS.maxTextLength },
  },
};

const v1Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'elements'],
  properties: {
    type: { const: 'genui' },
    version: { const: 1 },
    title: labelSchema,
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElements,
      items: textElementSchema,
    },
  },
};

const expressionRef = { $ref: '#/definitions/expression' };
const expressionV5Ref = { $ref: '#/definitions/expressionV5' };
const functionExpressionRef = { $ref: '#/definitions/functionExpression' };
const conditionRef = { $ref: '#/definitions/condition' };
const conditionV5Ref = { $ref: '#/definitions/conditionV5' };
const elementRef = { $ref: '#/definitions/element' };
const elementV4Ref = { $ref: '#/definitions/elementV4' };
const elementV5Ref = { $ref: '#/definitions/elementV5' };

const stateVariableSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'label', 'kind', 'initial', 'min', 'max', 'step'],
      properties: {
        id: idSchema,
        label: labelSchema,
        kind: { const: 'number' },
        initial: boundedNumberSchema,
        min: boundedNumberSchema,
        max: boundedNumberSchema,
        step: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: LIMITS.maxNumberMagnitude,
        },
        unit: unitSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'label', 'kind', 'initial', 'options'],
      properties: {
        id: idSchema,
        label: labelSchema,
        kind: { const: 'select' },
        initial: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: LIMITS.maxSelectOptions,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'value'],
            properties: {
              label: labelSchema,
              value: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
            },
          },
        },
      },
    },
  ],
};

const interactiveElementSchema = {
  oneOf: [
    textElementSchema,
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'number-input' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'slider' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'select' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'label', 'source'],
      properties: {
        kind: { const: 'value' },
        label: labelSchema,
        source: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'id'],
              properties: { kind: { const: 'state' }, id: idSchema },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'id'],
              properties: { kind: { const: 'derived' }, id: idSchema },
            },
          ],
        },
        unit: unitSchema,
      },
    },
  ],
};

const expressionDefinitions = {
  expression: {
    // Keep recursion linear: a recursive oneOf per operator causes exponential
    // validation cost. Operator-specific required keys are checked by the
    // semantic pass, while this schema enforces the property and type whitelist.
    type: 'object',
    additionalProperties: false,
    required: ['op'],
    properties: {
      op: {
        enum: [
          'const', 'state', 'derived', 'negate', 'abs', 'round', 'floor', 'ceil',
          'add', 'subtract', 'multiply', 'divide', 'min', 'max',
        ],
      },
      id: idSchema,
      value: { anyOf: [boundedNumberSchema, expressionRef] },
      left: expressionRef,
      right: expressionRef,
    },
  },
  /**
   * v4: function-curve expressions allow the curve-local variable `x`. A
   * separate recursive definition keeps `x` out of every other expression
   * position (derived/points/conditions/domain bounds are still checked
   * against the plain `expression` definition).
   */
  functionExpression: {
    type: 'object',
    additionalProperties: false,
    required: ['op'],
    properties: {
      op: {
        enum: [
          'x', 'const', 'state', 'derived', 'negate', 'abs', 'round', 'floor', 'ceil',
          'add', 'subtract', 'multiply', 'divide', 'min', 'max',
        ],
      },
      id: idSchema,
      value: { anyOf: [boundedNumberSchema, functionExpressionRef] },
      left: functionExpressionRef,
      right: functionExpressionRef,
    },
  },
  /**
   * v5: expressions may read a scalar from an earlier semantic model. The
   * operator/key whitelist is enforced here and the semantic pass additionally
   * checks declaration order, model kind, and the model's scalar key set.
   */
  expressionV5: {
    type: 'object',
    additionalProperties: false,
    required: ['op'],
    properties: {
      op: {
        enum: [
          'const', 'state', 'derived', 'model', 'negate', 'abs', 'round', 'floor', 'ceil',
          'add', 'subtract', 'multiply', 'divide', 'min', 'max',
        ],
      },
      id: idSchema,
      model: idSchema,
      key: { type: 'string', minLength: 1, maxLength: LIMITS.maxIdLength, pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
      value: { anyOf: [boundedNumberSchema, expressionV5Ref] },
      left: expressionV5Ref,
      right: expressionV5Ref,
    },
  },
};

const conditionDefinition = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'id', 'value'],
      properties: {
        op: { enum: ['state-eq', 'state-neq'] },
        id: idSchema,
        value: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'left', 'right'],
      properties: {
        op: { enum: ['num-eq', 'num-neq', 'num-gt', 'num-gte', 'num-lt', 'num-lte'] },
        left: expressionRef,
        right: expressionRef,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'conditions'],
      properties: {
        op: { enum: ['and', 'or'] },
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: conditionRef,
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'condition'],
      properties: {
        op: { const: 'not' },
        condition: conditionRef,
      },
    },
  ],
};

const conditionDefinitionV5 = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'id', 'value'],
      properties: {
        op: { enum: ['state-eq', 'state-neq'] },
        id: idSchema,
        value: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'left', 'right'],
      properties: {
        op: { enum: ['num-eq', 'num-neq', 'num-gt', 'num-gte', 'num-lt', 'num-lte'] },
        left: expressionV5Ref,
        right: expressionV5Ref,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'conditions'],
      properties: {
        op: { enum: ['and', 'or'] },
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: conditionV5Ref,
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'condition'],
      properties: {
        op: { const: 'not' },
        condition: conditionV5Ref,
      },
    },
  ],
};

const v3TextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: {
    kind: { const: 'text' },
    value: { type: 'string', maxLength: LIMITS.maxTextLength },
    visibleIf: conditionRef,
  },
};

const noteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'text'],
  properties: {
    kind: { const: 'note' },
    text: { type: 'string', minLength: 1, maxLength: LIMITS.maxTextLength },
    tone: { enum: ['info', 'warn', 'error'] },
    visibleIf: conditionRef,
  },
};

const chartBarPieSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'items'],
  properties: {
    kind: { const: 'chart' },
    chartType: { enum: ['bar', 'pie'] },
    title: labelSchema,
    legend: { type: 'boolean' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartItems,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: {
          label: labelSchema,
          value: expressionRef,
        },
      },
    },
  },
};

const discreteChartSeriesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'points'],
  properties: {
    label: labelSchema,
    color: colorSchema,
    smooth: { type: 'boolean' },
    points: {
      type: 'array',
      minItems: 2,
      maxItems: LIMITS.maxChartPointsPerSeries,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: boundedNumberSchema,
          y: expressionRef,
        },
      },
    },
  },
};

/** v4 函数曲线定义：y=f(x) 表达式 + 可选域/采样数/特征覆盖。 */
const chartFunctionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expression'],
  properties: {
    expression: functionExpressionRef,
    domain: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: { start: expressionRef, end: expressionRef },
    },
    samples: {
      type: 'integer',
      minimum: 5,
      maximum: LIMITS.maxFunctionSamples,
    },
    features: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      uniqueItems: true,
      items: { enum: ['zero'] },
    },
  },
};

const chartLineSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'series'],
  properties: {
    kind: { const: 'chart' },
    chartType: { const: 'line' },
    title: labelSchema,
    xLabel: labelSchema,
    yLabel: labelSchema,
    legend: { type: 'boolean' },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartSeries,
      items: discreteChartSeriesSchema,
    },
  },
};

/** v4 折线图：离散系列与函数曲线系列可在同一 series 数组内混用。 */
const chartLineSchemaV4 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'series'],
  properties: {
    kind: { const: 'chart' },
    chartType: { const: 'line' },
    title: labelSchema,
    xLabel: labelSchema,
    yLabel: labelSchema,
    legend: { type: 'boolean' },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartSeries,
      items: {
        oneOf: [
          discreteChartSeriesSchema,
          {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'function'],
            properties: {
              label: labelSchema,
              color: colorSchema,
              function: chartFunctionSchema,
            },
          },
        ],
      },
    },
  },
};

const tableCellValueSchema = {
  anyOf: [
    { type: 'string', maxLength: LIMITS.maxLabelLength },
    boundedNumberSchema,
    { type: 'null' },
    expressionRef,
  ],
};

const tableSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'columns', 'rows'],
  properties: {
    kind: { const: 'table' },
    title: labelSchema,
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxTableColumns,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label'],
        properties: {
          key: idSchema,
          label: labelSchema,
          numeric: { type: 'boolean' },
          unit: unitSchema,
        },
      },
    },
    rows: {
      type: 'array',
      maxItems: LIMITS.maxTableRows,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['cells'],
        properties: {
          cells: {
            type: 'object',
            minProperties: 1,
            propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
            patternProperties: {
              '^[A-Za-z][A-Za-z0-9_]*$': tableCellValueSchema,
            },
            additionalProperties: false,
          },
          visibleIf: conditionRef,
        },
      },
    },
    sortable: { type: 'boolean' },
    selectable: { type: 'boolean' },
    initialSort: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'dir'],
      properties: {
        key: idSchema,
        dir: { enum: ['asc', 'desc'] },
      },
    },
    emptyText: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
    visibleIf: conditionRef,
  },
};

const modelPrecisionSchema = { type: 'integer', minimum: 0, maximum: 4 };
const modelViewSchema = { enum: ['summary', 'items', 'plans', 'ranking', 'breakdown'] };

const budgetModelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'income', 'expenses'],
  properties: {
    kind: { const: 'budget' },
    id: idSchema,
    label: labelSchema,
    unit: unitSchema,
    precision: modelPrecisionSchema,
    income: expressionV5Ref,
    expenses: {
      type: 'array',
      maxItems: LIMITS.maxBudgetExpenses,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'amount'],
        properties: {
          label: labelSchema,
          amount: expressionV5Ref,
        },
      },
    },
  },
};

const costModelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'horizon', 'plans'],
  properties: {
    kind: { const: 'cost' },
    id: idSchema,
    label: labelSchema,
    unit: unitSchema,
    useUnit: unitSchema,
    precision: modelPrecisionSchema,
    horizon: expressionV5Ref,
    plans: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxCostPlans,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'fee', 'coverage', 'usesPerPeriod'],
        properties: {
          label: labelSchema,
          fee: expressionV5Ref,
          coverage: {
            type: 'number',
            exclusiveMinimum: 0,
            maximum: LIMITS.maxNumberMagnitude,
          },
          usesPerPeriod: expressionV5Ref,
        },
      },
    },
  },
};

const preferenceModelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'candidates', 'dimensions'],
  properties: {
    kind: { const: 'preference' },
    id: idSchema,
    label: labelSchema,
    precision: modelPrecisionSchema,
    candidates: {
      type: 'array',
      maxItems: LIMITS.maxPreferenceCandidates,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'values'],
        properties: {
          label: labelSchema,
          values: {
            type: 'object',
            maxProperties: LIMITS.maxPreferenceDimensions,
            propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
            patternProperties: {
              '^[A-Za-z][A-Za-z0-9_]*$': {
                anyOf: [boundedNumberSchema, { type: 'null' }],
              },
            },
            additionalProperties: false,
          },
        },
      },
    },
    dimensions: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxPreferenceDimensions,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'weight', 'direction'],
        properties: {
          id: idSchema,
          label: labelSchema,
          weight: {
            type: 'number',
            minimum: 0,
            maximum: LIMITS.maxPreferenceWeight,
          },
          direction: { enum: ['higher', 'lower'] },
        },
      },
    },
    filters: {
      type: 'array',
      maxItems: LIMITS.maxPreferenceFilters,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dimension'],
        properties: {
          dimension: idSchema,
          min: expressionV5Ref,
          max: expressionV5Ref,
        },
      },
    },
  },
};

const semanticModelSchema = {
  oneOf: [budgetModelSchema, costModelSchema, preferenceModelSchema],
};

const modelValueSourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'model', 'key'],
  properties: {
    kind: { const: 'model' },
    model: idSchema,
    key: { type: 'string', minLength: 1, maxLength: LIMITS.maxIdLength, pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
  },
};

const valueElementSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label', 'source'],
  properties: {
    kind: { const: 'value' },
    label: labelSchema,
    source: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: { kind: { const: 'state' }, id: idSchema },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: { kind: { const: 'derived' }, id: idSchema },
        },
        modelValueSourceSchema,
      ],
    },
    unit: unitSchema,
  },
};

const chartBarPieSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'items'],
  properties: {
    kind: { const: 'chart' },
    chartType: { enum: ['bar', 'pie'] },
    title: labelSchema,
    legend: { type: 'boolean' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartItems,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: {
          label: labelSchema,
          value: expressionV5Ref,
        },
      },
    },
  },
};

const modelChartSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'source'],
  properties: {
    kind: { const: 'chart' },
    chartType: { enum: ['bar', 'pie'] },
    title: labelSchema,
    legend: { type: 'boolean' },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['model'],
      properties: { model: idSchema },
    },
  },
};

const discreteChartSeriesSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'points'],
  properties: {
    label: labelSchema,
    color: colorSchema,
    smooth: { type: 'boolean' },
    points: {
      type: 'array',
      minItems: 2,
      maxItems: LIMITS.maxChartPointsPerSeries,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: boundedNumberSchema,
          y: expressionV5Ref,
        },
      },
    },
  },
};

const chartLineSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'chartType', 'series'],
  properties: {
    kind: { const: 'chart' },
    chartType: { const: 'line' },
    title: labelSchema,
    xLabel: labelSchema,
    yLabel: labelSchema,
    legend: { type: 'boolean' },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartSeries,
      items: {
        oneOf: [
          discreteChartSeriesSchemaV5,
          {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'function'],
            properties: {
              label: labelSchema,
              color: colorSchema,
              function: chartFunctionSchema,
            },
          },
        ],
      },
    },
  },
};

const chartElementSchemaV5 = {
  oneOf: [chartBarPieSchemaV5, modelChartSchema, chartLineSchemaV5],
};

const tableCellValueSchemaV5 = {
  anyOf: [
    { type: 'string', maxLength: LIMITS.maxLabelLength },
    boundedNumberSchema,
    { type: 'null' },
    expressionV5Ref,
  ],
};

const tableSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'columns', 'rows'],
  properties: {
    kind: { const: 'table' },
    title: labelSchema,
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxTableColumns,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label'],
        properties: {
          key: idSchema,
          label: labelSchema,
          numeric: { type: 'boolean' },
          unit: unitSchema,
        },
      },
    },
    rows: {
      type: 'array',
      maxItems: LIMITS.maxTableRows,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['cells'],
        properties: {
          cells: {
            type: 'object',
            minProperties: 1,
            propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
            patternProperties: {
              '^[A-Za-z][A-Za-z0-9_]*$': tableCellValueSchemaV5,
            },
            additionalProperties: false,
          },
          visibleIf: conditionV5Ref,
        },
      },
    },
    sortable: { type: 'boolean' },
    selectable: { type: 'boolean' },
    initialSort: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'dir'],
      properties: {
        key: idSchema,
        dir: { enum: ['asc', 'desc'] },
      },
    },
    emptyText: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
    visibleIf: conditionV5Ref,
  },
};

const modelTableSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'source'],
  properties: {
    kind: { const: 'table' },
    title: labelSchema,
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['model'],
      properties: {
        model: idSchema,
        view: modelViewSchema,
      },
    },
    sortable: { type: 'boolean' },
    selectable: { type: 'boolean' },
    initialSort: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'dir'],
      properties: {
        key: idSchema,
        dir: { enum: ['asc', 'desc'] },
      },
    },
    emptyText: { type: 'string', minLength: 1, maxLength: LIMITS.maxLabelLength },
    visibleIf: conditionV5Ref,
  },
};

const tableElementSchemaV5 = {
  oneOf: [tableSchemaV5, modelTableSchema],
};

const explainSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'model'],
  properties: {
    kind: { const: 'explain' },
    model: idSchema,
    title: labelSchema,
    visibleIf: conditionV5Ref,
  },
};

const makeSectionSchema = (selfRef: { $ref: string }) => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'children'],
  properties: {
    kind: { const: 'section' },
    title: labelSchema,
    children: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: selfRef,
    },
  },
});

const makeColumnsSchema = (selfRef: { $ref: string }) => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'columns'],
  properties: {
    kind: { const: 'columns' },
    columns: {
      type: 'array',
      minItems: LIMITS.minColumns,
      maxItems: LIMITS.maxColumnsLayout,
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: selfRef,
      },
    },
  },
});

/** 组合元素定义按目标折线 schema 与自引用参数化（v3/v4 共用同一份叶元素白名单）。 */
const makeElementDefinition = (chartLine: object, selfRef: { $ref: string }) => ({
  oneOf: [
    v3TextSchema,
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'number-input' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'slider' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'select' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'label', 'source'],
      properties: {
        kind: { const: 'value' },
        label: labelSchema,
        source: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'id'],
              properties: { kind: { const: 'state' }, id: idSchema },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'id'],
              properties: { kind: { const: 'derived' }, id: idSchema },
            },
          ],
        },
        unit: unitSchema,
      },
    },
    noteSchema,
    chartBarPieSchema,
    chartLine,
    tableSchema,
    makeSectionSchema(selfRef),
    makeColumnsSchema(selfRef),
  ],
});

const elementDefinition = makeElementDefinition(chartLineSchema, elementRef);
const elementDefinitionV4 = makeElementDefinition(chartLineSchemaV4, elementV4Ref);

const v5TextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: {
    kind: { const: 'text' },
    value: { type: 'string', maxLength: LIMITS.maxTextLength },
    visibleIf: conditionV5Ref,
  },
};

const noteSchemaV5 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'text'],
  properties: {
    kind: { const: 'note' },
    text: { type: 'string', minLength: 1, maxLength: LIMITS.maxTextLength },
    tone: { enum: ['info', 'warn', 'error'] },
    visibleIf: conditionV5Ref,
  },
};

/** v5 元素：在 v3 叶元素基础上增加模型来源与本地解释。 */
const elementDefinitionV5 = {
  oneOf: [
    v5TextSchema,
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'number-input' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'slider' }, bind: idSchema },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'bind'],
      properties: { kind: { const: 'select' }, bind: idSchema },
    },
    valueElementSchemaV5,
    noteSchemaV5,
    chartElementSchemaV5,
    tableElementSchemaV5,
    explainSchema,
    makeSectionSchema(elementV5Ref),
    makeColumnsSchema(elementV5Ref),
  ],
};

const v2Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'state', 'derived', 'elements'],
  properties: {
    type: { const: 'genui' },
    version: { const: 2 },
    title: labelSchema,
    state: {
      type: 'array',
      maxItems: LIMITS.maxStateVariables,
      items: stateVariableSchema,
    },
    derived: {
      type: 'array',
      maxItems: LIMITS.maxDerivedValues,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'expression'],
        properties: {
          id: idSchema,
          label: labelSchema,
          unit: unitSchema,
          expression: expressionRef,
        },
      },
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElementsV2,
      items: interactiveElementSchema,
    },
  },
};

const v3Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'state', 'derived', 'elements'],
  properties: {
    type: { const: 'genui' },
    version: { const: 3 },
    title: labelSchema,
    state: {
      type: 'array',
      maxItems: LIMITS.maxStateVariables,
      items: stateVariableSchema,
    },
    derived: {
      type: 'array',
      maxItems: LIMITS.maxDerivedValues,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'expression'],
        properties: {
          id: idSchema,
          label: labelSchema,
          unit: unitSchema,
          expression: expressionRef,
        },
      },
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElementsV3,
      items: elementRef,
    },
  },
};

const v4Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'state', 'derived', 'elements'],
  properties: {
    type: { const: 'genui' },
    version: { const: 4 },
    title: labelSchema,
    state: {
      type: 'array',
      maxItems: LIMITS.maxStateVariables,
      items: stateVariableSchema,
    },
    derived: {
      type: 'array',
      maxItems: LIMITS.maxDerivedValues,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'expression'],
        properties: {
          id: idSchema,
          label: labelSchema,
          unit: unitSchema,
          expression: expressionRef,
        },
      },
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElementsV3,
      items: elementV4Ref,
    },
  },
};

const v5Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'state', 'derived', 'models', 'elements'],
  properties: {
    type: { const: 'genui' },
    version: { const: 5 },
    title: labelSchema,
    state: {
      type: 'array',
      maxItems: LIMITS.maxStateVariables,
      items: stateVariableSchema,
    },
    derived: {
      type: 'array',
      maxItems: LIMITS.maxDerivedValues,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'expression'],
        properties: {
          id: idSchema,
          label: labelSchema,
          unit: unitSchema,
          // derived 仍只使用不含模型引用的表达式，避免声明顺序上的环。
          expression: expressionRef,
        },
      },
    },
    models: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxModels,
      items: semanticModelSchema,
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElementsV3,
      items: elementV5Ref,
    },
  },
};

/**
 * Versioned genui JSON Schema.
 *
 * v1 remains available for existing static cards. v2 adds bounded state,
 * controls, output references, and a recursive but finite arithmetic whitelist.
 * v3 adds composition elements (note/chart/table/section/columns) plus
 * conditional display, all bound to the same state/derived values.
 * v4 adds function-curve chart series (y=f(x) with curve-local `x`,
 * state-driven domain and bounded sampling) next to the discrete series.
 * v5 adds declarative semantic models (budget/cost/preference) whose
 * locally-computed snapshots drive values, tables and charts; expressions may
 * read scalars from earlier models only.
 * Semantic checks that JSON Schema cannot express (references, model order,
 * view compatibility and dependency cycles) run after generated-schema
 * validation in validate.ts.
 */
export const genuiSchema = {
  oneOf: [v1Schema, v2Schema, v3Schema, v4Schema, v5Schema],
  definitions: {
    expression: expressionDefinitions.expression,
    expressionV5: expressionDefinitions.expressionV5,
    functionExpression: expressionDefinitions.functionExpression,
    condition: conditionDefinition,
    conditionV5: conditionDefinitionV5,
    element: elementDefinition,
    elementV4: elementDefinitionV4,
    elementV5: elementDefinitionV5,
  },
};
