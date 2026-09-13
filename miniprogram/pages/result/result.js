// 餐单结果页：读取上一页生成的 plan，渲染为展示模型
var planUtil = require('../../utils/plan.js');

Page({
  data: {
    m: null,
    showAudit: false,
    auditText: '',
    lockedPerks: ['品牌 / 电商选购清单', '每周换菜配方建议', '兽医复核意见', '体重打卡与周报曲线']
  },

  onLoad: function () {
    var plan = getApp().globalData.plan;
    if (!plan) {
      wx.navigateBack();
      return;
    }
    var m = planUtil.buildPlanModel(plan);
    var auditText = (m.decisionsJson || '').split('\n').slice(0, 60).join('\n');
    this.setData({ m: m, auditText: auditText });
  },

  onToggleAudit: function () { this.setData({ showAudit: !this.data.showAudit }); },
  goRestart: function () { wx.navigateBack(); },
  goSubscribe: function () { wx.navigateTo({ url: '/pages/subscribe/subscribe' }); },
  goCheckin: function () { wx.navigateTo({ url: '/pages/checkin/checkin' }); }
});