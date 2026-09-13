// 「有爱」健康周报页
var api = require('../../utils/request.js');
var u = require('../../utils/checkin.js');

Page({
  data: {
    petName: '小可爱',
    m: null,
    showBreakdown: false,
    history: []
  },

  onLoad: function (query) {
    query = query || {};
    var petKey = decodeURIComponent(query.petKey || 'guest|');
    var petName = decodeURIComponent(query.petName || '小可爱');
    this.setData({ petName: petName });
    this.load(petKey, petName);
  },

  load: function (petKey, petName) {
    var self = this;
    api.get('/api/reports/week?petKey=' + encodeURIComponent(petKey) + '&petName=' + encodeURIComponent(petName))
      .then(function (body) {
        var report = body.report;
        var breakdown = self.breakdownOf(report);
        self.setData({ m: u.buildReportModel(report, breakdown) });
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || '周报加载失败', icon: 'none' });
      });
    api.get('/api/reports?petKey=' + encodeURIComponent(petKey))
      .then(function (body) {
        var history = (body.reports || []).map(function (r) {
          return { weekEnd: r.weekEnd, loveScore: r.loveScore, checkRate: r.checkRate };
        });
        self.setData({ history: history });
      })
      .catch(function () {});
  },

  breakdownOf: function (r) {
    var checkDays = r.checkRate != null ? Math.round(r.checkRate / 100 * 7) : 0;
    var ec = r.avgExec;
    var wc = (r.weightPoints || []).length;
    return '本周打卡 ' + checkDays + '/7 天 · 平均执行 ' + (ec == null ? '—' : ec + '%') + ' · 记录 ' + wc + ' 次体重';
  },

  onToggleBreakdown: function () { this.setData({ showBreakdown: !this.data.showBreakdown }); },
  goCheckin: function () { wx.navigateBack(); }
});