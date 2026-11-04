import { PROVENANCE_DATE_PATTERN } from './provenance.ts';
import { BASIS_KINDS, LIMITS } from './types.ts';

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

const provenanceDateSchema = {
  type: 'string',
  maxLength: LIMITS.maxProvenanceDateLength,
  pattern: PROVENANCE_DATE_PATTERN,
};

/**
 * 模型声称的来源。url 只做长度与文本约束；是否 https、是否含凭据或私有主机
 * 由界面在展示时标注，避免一个不可靠链接让整份界面退回原始 JSON。
 * 插件不请求该地址，也不把任何来源标为「已验证」。
 */
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label'],
  properties: {
    id: idSchema,
    label: { type: 'string', minLength: 1, maxLength: LIMITS.maxSourceLabelLength },
    url: {
      type: 'string',
      minLength: 1,
      maxLength: LIMITS.maxSourceUrlLength,
    },
    publisher: { type: 'string', minLength: 1, maxLength: LIMITS.maxPublisherLength },
    publishedAt: provenanceDateSchema,
    retrievedAt: provenanceDateSchema,
    note: { type: 'string', minLength: 1, maxLength: LIMITS.maxSourceNoteLength },
  },
};

const basisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: BASIS_KINDS },
    sourceId: idSchema,
    note: { type: 'string', minLength: 1, maxLength: LIMITS.maxBasisNoteLength },
    asOf: provenanceDateSchema,
    validUntil: provenanceDateSchema,
  },
};

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
const conditionRef = { $ref: '#/definitions/condition' };
const elementRef = { $ref: '#/definitions/element' };

const numberStateVariableSchema = {
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
};

const selectStateVariableSchema = {
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
};

const stateVariableSchema = {
  oneOf: [numberStateVariableSchema, selectStateVariableSchema],
};

/** v4 状态项：在 v2/v3 字段上增加可选 basis。 */
const v4StateVariableSchema = {
  oneOf: [
    {
      ...numberStateVariableSchema,
      properties: {
        ...numberStateVariableSchema.properties,
        basis: { $ref: '#/definitions/basis' },
      },
    },
    {
      ...selectStateVariableSchema,
      properties: {
        ...selectStateVariableSchema.properties,
        basis: { $ref: '#/definitions/basis' },
      },
    },
  ],
};

const numberInputElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'bind'],
  properties: { kind: { const: 'number-input' }, bind: idSchema },
};

const sliderElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'bind'],
  properties: { kind: { const: 'slider' }, bind: idSchema },
};

const selectElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'bind'],
  properties: { kind: { const: 'select' }, bind: idSchema },
};

const valueSourceSchema = {
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
};

const valueElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label', 'source'],
  properties: {
    kind: { const: 'value' },
    label: labelSchema,
    source: valueSourceSchema,
    unit: unitSchema,
  },
};

/** v4 数值项：可显式说明结果依据；缺省时渲染器回落到来源状态/派生值的 basis。 */
const v4ValueElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label', 'source'],
  properties: {
    kind: { const: 'value' },
    label: labelSchema,
    source: valueSourceSchema,
    unit: unitSchema,
    basis: { $ref: '#/definitions/basis' },
  },
};

const interactiveElementSchema = {
  oneOf: [
    textElementSchema,
    numberInputElementSchema,
    sliderElementSchema,
    selectElementSchema,
    valueElementSchema,
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
      items: {
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

const sectionSchema = {
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
      items: elementRef,
    },
  },
};

const columnsSchema = {
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
        items: elementRef,
      },
    },
  },
};

const elementDefinition = {
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
    chartLineSchema,
    tableSchema,
    sectionSchema,
    columnsSchema,
  ],
};

/** v4 柱/饼图：元素与每个条目都可声明 basis。 */
const v4ChartBarPieSchema = {
  ...chartBarPieSchema,
  properties: {
    ...chartBarPieSchema.properties,
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
          basis: { $ref: '#/definitions/basis' },
        },
      },
    },
    basis: { $ref: '#/definitions/basis' },
  },
};

/** v4 折线图：元素与每个系列都可声明 basis。 */
const v4ChartLineSchema = {
  ...chartLineSchema,
  properties: {
    ...chartLineSchema.properties,
    series: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxChartSeries,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'points'],
        properties: {
          label: labelSchema,
          color: colorSchema,
          smooth: { type: 'boolean' },
          basis: { $ref: '#/definitions/basis' },
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
      },
    },
    basis: { $ref: '#/definitions/basis' },
  },
};

/** v4 表格：列、行与整个表格都可声明 basis；单元格仍用 null 表示缺失。 */
const v4TableSchema = {
  ...tableSchema,
  properties: {
    ...tableSchema.properties,
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
          basis: { $ref: '#/definitions/basis' },
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
          basis: { $ref: '#/definitions/basis' },
        },
      },
    },
    basis: { $ref: '#/definitions/basis' },
  },
};

const v4SectionSchema = {
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
      items: { $ref: '#/definitions/elementV4' },
    },
  },
};

const v4ColumnsSchema = {
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
        items: { $ref: '#/definitions/elementV4' },
      },
    },
  },
};

const v4ElementDefinition = {
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
    v4ValueElementSchema,
    noteSchema,
    v4ChartBarPieSchema,
    v4ChartLineSchema,
    v4TableSchema,
    v4SectionSchema,
    v4ColumnsSchema,
  ],
};

const v4DerivedValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'expression'],
  properties: {
    id: idSchema,
    label: labelSchema,
    unit: unitSchema,
    expression: expressionRef,
    basis: { $ref: '#/definitions/basis' },
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
    sources: {
      type: 'array',
      maxItems: LIMITS.maxSources,
      items: { $ref: '#/definitions/source' },
    },
    state: {
      type: 'array',
      maxItems: LIMITS.maxStateVariables,
      items: v4StateVariableSchema,
    },
    derived: {
      type: 'array',
      maxItems: LIMITS.maxDerivedValues,
      items: v4DerivedValueSchema,
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElementsV3,
      items: { $ref: '#/definitions/elementV4' },
    },
  },
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

/**
 * Versioned genui JSON Schema.
 *
 * v1 remains available for existing static cards. v2 adds bounded state,
 * controls, output references, and a recursive but finite arithmetic whitelist.
 * v3 adds composition elements (note/chart/table/section/columns) plus
 * conditional display, all bound to the same state/derived values.
 * v4 adds optional provenance: declared sources plus a per-datum basis.
 * Semantic checks that JSON Schema cannot express (references, dependency
 * cycles, URL/date sanity) run after generated-schema validation in validate.ts.
 */
export const genuiSchema = {
  oneOf: [v1Schema, v2Schema, v3Schema, v4Schema],
  definitions: {
    expression: expressionDefinitions.expression,
    condition: conditionDefinition,
    element: elementDefinition,
    elementV4: v4ElementDefinition,
    source: sourceSchema,
    basis: basisSchema,
  },
};
