/**
 * 本地状态身份用的稳定字符串哈希（cyrb53）。
 *
 * 用途仅限「同一文档/同一消息」的匹配键：
 * - 不用于安全校验，碰撞只会导致状态按不兼容处理（重置），不会跨会话串用；
 * - 同步实现，内容脚本在扫描与挂载路径上不能等待异步摘要 API；
 * - 结果转 36 进制，长度短，便于写入 chrome.storage 的键与本地缓存。
 */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
