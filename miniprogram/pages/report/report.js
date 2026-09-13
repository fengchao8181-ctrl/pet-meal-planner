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
        // D4 体重趋势：预计算每根柱子高度（相对最大值 %）+ 短日期（WXML 不做方法调用/===，全部预计算）
        var wpts = (report && report.weightPoints || []).map(function (w) {
          return { date: w.date, weightKg: w.weightKg, shortDate: w.date ? w.date.slice(5) : '', barH: w.barH || 40 };
        });
        var maxW = 0;
        wpts.forEach(function (w) { if (w.weightKg > maxW) maxW = w.weightKg; });
        if (maxW > 0) {
          var floor = maxW * 0.9; // 以最大值9折为基准，让波动更可见
          wpts = wpts.map(function (w) {
            var h = Math.round(((w.weightKg - floor) / (maxW - floor || 1)) * 60 + 25); // 25%~85% 区间
            w.barH = Math.max(20, Math.min(90, h));
            return w;
          });
        }
        var m = u.buildReportModel(report, breakdown);
        m.weightPoints = wpts;
        self.setData({ m: m });
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