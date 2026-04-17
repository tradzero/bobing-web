/**
 * contact-equation 实验固定对照基线。
 *
 * 运行时默认值允许继续演进，但 sweep 脚本必须保留旧基线，
 * 否则升级默认值后会丢失历史 A/B 对照能力。
 */
export const CONTACT_EQUATION_BASELINE = {
  diceDiceContactEquationStiffness: 1e7,
  diceDiceContactEquationRelaxation: 3,
} as const