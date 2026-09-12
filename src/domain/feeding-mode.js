// 三层喂养模式：A 纯鲜食 / B 狗粮+辅食（获客主入口）/ C 混合
// 热量分配规则见规则引擎 R003
export const FEEDING_MODES = {
  A: { key: 'A', label: '纯鲜食', kibbleKcalRatio: 0, supplementKcalRatio: 1, freshMealsPerWeek: 7, desc: '全餐鲜食' },
  B: { key: 'B', label: '狗粮+辅食', kibbleKcalRatio: 0.9, supplementKcalRatio: 0.1, freshMealsPerWeek: 0, desc: '主粮吃狗粮，辅食补结构' },
  C: { key: 'C', label: '混合', kibbleKcalRatio: 0.7, supplementKcalRatio: 0.3, freshMealsPerWeek: 3, desc: '狗粮为主 + 每周 2-4 顿鲜食' }
};

export function allocateKcal(modeKey, derKcal) {
  const mode = FEEDING_MODES[modeKey];
  if (!mode) throw new Error(`未知喂养模式: ${modeKey}`);
  return {
    mode: mode.key,
    derKcal: round1(derKcal),
    kibbleKcal: round1(derKcal * mode.kibbleKcalRatio),
    supplementKcal: round1(derKcal * mode.supplementKcalRatio),
    freshMealsPerWeek: mode.freshMealsPerWeek
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
