// 营养常量库：热量基线、生命阶段与体型系数、犬安全黑名单、辅食食材营养参考
// 热量采用 NRC/AAFCO 通用的 RER = 70 × W^0.75，DER = RER × 系数
export const RULE_VERSION = '1.0.0';

export const LIFE_STAGES = {
  puppy: { key: 'puppy', label: '幼犬', factor: 2.0, minProtein: 22, note: '干物质基准蛋白 ≥22%' },
  adult: { key: 'adult', label: '成犬', factor: 1.0, minProtein: 18, note: '干物质基准蛋白 ≥18%' },
  senior: { key: 'senior', label: '老年犬', factor: 0.8, minProtein: 18, note: '低脂高纤倾向' }
};

export const BODY_TYPES = {
  MINI: { key: 'mini', label: '迷你', weightMax: 5, factor: 1.1 },
  SMALL: { key: 'small', label: '小型', weightMax: 10, factor: 1.0 },
  MEDIUM: { key: 'medium', label: '中型', weightMax: 25, factor: 0.95 },
  LARGE: { key: 'large', label: '大型', weightMax: 45, factor: 0.9 },
  GIANT: { key: 'giant', label: '巨型', weightMax: Infinity, factor: 0.85 }
};

export const ACTIVITY_LEVELS = {
  low: { key: 'low', label: '低（宅家为主）', factor: 1.0 },
  mid: { key: 'mid', label: '中（每日散步）', factor: 1.2 },
  high: { key: 'high', label: '高（运动犬）', factor: 1.4 }
};

// 绝育系数：未绝育代谢略高（临床常用 1.6/1.8 归一化后取相对值）
export const NEUTER_FACTORS = {
  YES: 1.0,
  NO: 1.1
};

// 犬安全黑名单（任何情况下不得进入餐单/辅食）
export const FORBIDDEN_FOODS = [
  '洋葱', '大葱', '小葱', '韭菜', '蒜', '葡萄', '葡萄干',
  '巧克力', '可可', '木糖醇', '夏威夷果', '酒精', '咖啡因',
  '生土豆皮', '发芽土豆', '牛油果', '生面团'
];

// 辅食食材营养参考：kcal/100g（蒸煮后近似），含水与功能方向
// purpose 用于功能方向匹配：joint 关节 / skin 皮肤毛发 / gut 肠胃 / none 常规
export const SUPPLEMENT_FOODS = {
  chicken_breast: { name: '鸡胸肉', kcalPer100g: 110, protein: 23, purpose: 'skin' },
  salmon: { name: '三文鱼', kcalPer100g: 180, protein: 20, purpose: 'joint' },
  egg: { name: '熟鸡蛋', kcalPer100g: 140, protein: 12, purpose: 'skin' },
  pumpkin: { name: '南瓜', kcalPer100g: 26, protein: 1, purpose: 'gut' },
  carrot: { name: '胡萝卜', kcalPer100g: 35, protein: 1, purpose: 'none' },
  broccoli: { name: '西蓝花', kcalPer100g: 34, protein: 3, purpose: 'none' },
  blueberry: { name: '蓝莓', kcalPer100g: 57, protein: 1, purpose: 'none' },
  oat: { name: '燕麦片', kcalPer100g: 350, protein: 13, purpose: 'gut' },
  apple: { name: '苹果（去核）', kcalPer100g: 52, protein: 0, purpose: 'none' },
  yogurt: { name: '无糖酸奶', kcalPer100g: 60, protein: 3, purpose: 'gut' }
};

// 常见致敏蛋白源（问诊过敏史匹配用）
export const ALLERGEN_SOURCES = ['牛肉', '鸡肉', '鱼肉', '谷物', '乳制品', '鸡蛋'];
