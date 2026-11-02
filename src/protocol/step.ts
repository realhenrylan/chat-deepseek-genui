/**
 * 数值状态的步长对齐判断——协议语义校验（validate.ts）与交互输入
 * （Card.tsx）共用的唯一实现，避免两份容差逻辑漂移。
 *
 * 对齐定义：value 与 min 的差是 step 的整数倍（允许浮点表示误差）。
 * 容差取 `min(16 ulp 估计, step/4)`：
 *   - 按数值本身的双精度 ulp 估计，不随步数（offset/step）增长，
 *     大步数下半步等明显非法值不会因 steps 变大而被放行；
 *   - step/4 封顶保证任何量级下都拒绝 ≥ 半步的偏差；
 *   - 十进制浮点兼容：step=0.1 时 0.3 等由二进制舍入产生的
 *     微小偏差（远小于 ulp 级别）仍被接受。
 *
 * 已知限制：当 step 远小于该量级的双精度分辨率时（如 1e12 处
 * ulp≈1.2e-4 而 step=1e-6），半步偏移在数值上不可区分，属双精度
 * 表示极限，协议不做超精度判断。
 */
export function isStepAligned(value: number, min: number, step: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(step) || step <= 0) {
    return false;
  }
  const offset = value - min;
  if (!Number.isFinite(offset)) return false;
  const steps = offset / step;
  if (!Number.isFinite(steps)) return false;

  const nearest = Math.round(steps);
  const remainder = Math.abs(offset - nearest * step);
  const scale = Math.max(Math.abs(value), Math.abs(min), Math.abs(nearest * step), Math.abs(step));
  const tolerance = Math.min(16 * Number.EPSILON * scale, Math.abs(step) / 4);
  return remainder <= tolerance;
}
