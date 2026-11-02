/**
 * 以协议 ID 为键的普通对象读取（state、draft、fieldError、计算结果）。
 *
 * 协议允许的合法 ID 可以与 Object.prototype 的继承属性同名
 * （constructor、toString、valueOf 等），直接 `record[id]` 会在键
 * 缺失时沿原型链取到函数值，导致输入框显示异常或伪造错误。
 * 所有以 ID 为键的读取与存在性判断必须经过这里，只认自有属性。
 */

/** 读取自有属性；键不存在（含与继承属性同名）时返回 undefined。 */
export function getOwn<T>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/** 判断键是否为自有属性（替代 `id in record`，避免命中原型链）。 */
export function hasOwn(record: Record<string, unknown>, id: string): boolean {
  return Object.hasOwn(record, id);
}
