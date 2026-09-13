// 问诊建档页：步骤1 宠物档案 → 步骤2 喂养模式 + 主粮标签 → 生成餐单
var api = require('../../utils/request.js');
var profileUtil = require('../../utils/profile.js');

var LIFE_STAGES = [
  { label: '幼犬（1 岁以下）', value: 'puppy' },
  { label: '成犬（1-7 岁）', value: 'adult' },
  { label: '老年犬（7 岁以上）', value: 'senior' }
];
var ACTIVITIES = [
  { label: '低（宅家为主）', value: 'low' },
  { label: '中（每日散步）', value: 'mid' },
  { label: '高（运动犬）', value: 'high' }
];
var MODES = [
  { key: 'B', name: '狗粮 + 辅食', desc: '不换主粮，按类型建议选粮 + 每周辅食配方', tag: '门槛最低 · 推荐' },
  { key: 'C', name: '混合喂养', desc: '狗粮为主 + 每周 2-4 顿鲜食', tag: '进阶' },
  { key: 'A', name: '纯鲜食', desc: '全餐鲜食，每日配方', tag: '全换粮' }
];
var ALLERGY_OPTIONS = ['牛肉', '鸡肉', '鱼肉', '谷物', '乳制品', '鸡蛋'];
var AVOID_OPTIONS = ['牛肉', '鸡肉', '鱼肉', '谷物'];

Page({
  data: {
    step: 1,
    stepsList: [{ label: '宠物档案' }, { label: '喂养方式' }, { label: '生成餐单' }],
    form: { petName: '', breed: '', weightKg: '', ageMonths: '', neutered: false },
    lifeStageIndex: 1,
    activityIndex: 1,
    stageOptions: LIFE_STAGES.map(function (s) { return s.label; }),
    activityOptions: ACTIVITIES.map(function (a) { return a.label; }),
    stageOptionList: LIFE_STAGES,
    activityOptionList: ACTIVITIES,
    modes: MODES,
    selectedMode: 'B',
    allergyOptions: ALLERGY_OPTIONS,
    allergies: [],
    allergyMap: {},
    showLabel: true, // 初始模式为 B，默认显示主粮标签表单
    labelForm: { proteinPct: 30, fatPct: 16, fiberPct: 4, kcalPer100g: 380, grainFree: false },
    avoidOptions: AVOID_OPTIONS,
    avoidSources: [],
    avoidMap: {},
    error: '',
    generating: false
  },

  onLifeStageSelect: function (e) { this.setData({ lifeStageIndex: Number(e.currentTarget.dataset.idx) }); },
  onActivitySelect: function (e) { this.setData({ activityIndex: Number(e.currentTarget.dataset.idx) }); },
  onNeuterChange: function (e) { this.setData({ 'form.neutered': e.detail.value }); },

  onFormInput: function (e) {
    var set = { ['form.' + e.currentTarget.dataset.key]: e.detail.value };
    if (this.data.error) set.error = '';
    this.setData(set);
  },

  onModeTap: function (e) {
    var mode = e.currentTarget.dataset.mode;
    var showLabel = mode !== 'A';
    this.setData({ selectedMode: mode, showLabel: showLabel });
  },
  onGrainFree: function (e) { this.setData({ 'labelForm.grainFree': e.detail.value }); },

  onLabelInput: function (e) {
    this.setData({ ['labelForm.' + e.currentTarget.dataset.key]: e.detail.value });
  },

  toggleChips: function (key, value, items, mapKey) {
    var idx = items.indexOf(value);
    if (idx >= 0) items.splice(idx, 1);
    else items.push(value);
    var map = {};
    for (var i = 0; i < items.length; i++) map[items[i]] = true;
    this.setData({ [key]: items, [mapKey]: map });
  },
  onAllergyTap: function (e) { this.toggleChips('allergies', e.currentTarget.dataset.value, this.data.allergies.slice(), 'allergyMap'); },
  onAvoidTap: function (e) { this.toggleChips('avoidSources', e.currentTarget.dataset.value, this.data.avoidSources.slice(), 'avoidMap'); },

  onBack: function () { this.setData({ step: 1, error: '' }); },
  onProfileNext: function () {
    var d = this.data;
    if (!(Number(d.form.weightKg) > 0) || !(Number(d.form.ageMonths) > 0)) {
      this.setData({ error: '请填写有效的体重与月龄' });
      return;
    }
    // 进入步骤 2 时根据当前模式决定是否显示主粮标签表单，避免初始态不一致
    var showLabel = d.selectedMode !== 'A';
    this.setData({ step: 2, error: '', showLabel: showLabel });
  },

  onGenerate: function () {
    var d = this.data;
    var raw = {
      petName: d.form.petName,
      breed: d.form.breed,
      weightKg: d.form.weightKg,
      ageMonths: d.form.ageMonths,
      lifeStage: LIFE_STAGES[d.lifeStageIndex].value,
      activity: ACTIVITIES[d.activityIndex].value,
      neutered: d.form.neutered,
      allergies: d.allergies,
      feedingMode: d.selectedMode,
      kibbleLabel: d.showLabel ? {
        proteinPct: d.labelForm.proteinPct,
        fatPct: d.labelForm.fatPct,
        fiberPct: d.labelForm.fiberPct,
        kcalPer100g: d.labelForm.kcalPer100g,
        grainFree: d.labelForm.grainFree,
        avoidSources: d.avoidSources
      } : null
    };
    var errs = profileUtil.validateProfile(raw);
    if (errs.length > 0) {
      this.setData({ error: errs.join('；') });
      return;
    }
    this.setData({ generating: true, error: '' });
    var payload = profileUtil.buildPayload(raw);
    var that = this;
    api.post('/api/plans/generate', payload).then(function (res) {
      getApp().globalData.plan = res.plan;
      wx.navigateTo({ url: '/pages/result/result' });
    }).catch(function (err) {
      that.setData({ error: err.message || '生成失败，请重试' });
    }).then(function () {
      that.setData({ generating: false });
    });
  }
});