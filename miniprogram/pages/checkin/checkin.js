// 「有爱」每日喂食打卡页
var api = require('../../utils/request.js');
var config = require('../../utils/config.js');
var u = require('../../utils/checkin.js');

Page({
  data: {
    petKey: '',
    petName: '小可爱',
    today: '',
    checked: false,
    moodOptions: u.MOOD_OPTIONS,
    selMood: null,
    grid: [],
    streak: 0,
    feedback: '',
    milestone: null,   // 里程碑庆祝内容（命中才弹）
    reminderOn: false
  },

  onLoad: function () {
    var plan = getApp().globalData.plan;
    var pet = (plan && plan.pet) || {};
    var petKey = (pet.name || 'guest') + '|' + (pet.breed || '');
    var today = u.todayStr();
    this.setData({ petKey: petKey, petName: pet.name || '小可爱', petBreed: pet.breed || '', today: today });
    this.refreshRecords();
  },

  refreshRecords: function () {
    var self = this;
    var from = this.dateStrDaysAgo(30);
    api.get('/api/checkins?petKey=' + encodeURIComponent(this.data.petKey) + '&from=' + from + '&to=' + this.data.today)
      .then(function (body) {
        var records = body.records || [];
        var checked = u.isCheckedToday(records, self.data.today);
        var grid = u.buildCheckinGrid(records, 7, self.data.today);
        var streak = u.computeStreakLocal(records, self.data.today);
        self.setData({ checked: checked, grid: grid, streak: streak });
      })
      .catch(function () { self.setData({ checked: false, grid: [], streak: 0 }); });
  },

  dateStrDaysAgo: function (n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d.getDate() < 10 ? '0' + d.getDate() : d.getDate());
  },

  onMoodSelect: function (e) {
    this.setData({ selMood: e.currentTarget.dataset.key });
  },

  onCheckin: function () {
    var self = this;
    if (this.data.checked) return; // 防重复
    api.post('/api/checkins', {
      petKey: this.data.petKey,
      date: this.data.today,
      mood: this.data.selMood,
      ownerOpenid: getApp().globalData.openid || wx.getStorageSync('openid') || ''
    })
      .then(function () {
        // 重新拉取以刷新 grid + streak
        var from = self.dateStrDaysAgo(30);
        return api.get('/api/checkins?petKey=' + encodeURIComponent(self.data.petKey) + '&from=' + from + '&to=' + self.data.today);
      })
      .then(function (body) {
        var records = body.records || [];
        var streak = u.computeStreakLocal(records, self.data.today);
        var grid = u.buildCheckinGrid(records, 7, self.data.today);
        var feedback = u.afterCheckinFeedback(streak, self.data.selMood);
        var milestone = u.milestoneHit(streak) ? { text: '连续 ' + streak + ' 天，你是它最认真的家人 🎉' } : null;
        self.setData({ checked: true, grid: grid, streak: streak, feedback: feedback, milestone: milestone });
        if (milestone) {
          wx.showModal({ title: '里程碑达成 🎉', content: milestone.text, showCancel: false });
        }
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || '打卡失败', icon: 'none' });
      });
  },

  onEnableReminder: function () {
    var self = this;
    // 后端登记进「每日推送」名单（H5 公众号每日柔性触达 + 小程序订阅关键触发），凭证齐备即可真实下发
    var openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    api.post('/api/push/subscribe', {
      petKey: this.data.petKey,
      petName: this.data.petName,
      breed: this.data.petBreed || '',
      miniOpenid: openid
    })
      .then(function () {
        var templateId = config.REMIND_TEMPLATE_ID;
        if (!templateId) {
          self.setData({ reminderOn: true });
          wx.showToast({ title: '已开启每日推送，即将上线送达', icon: 'none' });
          return;
        }
        // 小程序订阅消息（一次性）：再次补授权，拿下一次关键触达名额
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: function (res) {
            self.setData({ reminderOn: res[templateId] === 'accept' });
            wx.setStorageSync('reminder_accept', res[templateId] === 'accept');
            wx.showToast({ title: res[templateId] === 'accept' ? '已开启每日喂食提醒' : '已登记每日推送', icon: 'none' });
          }
        });
      })
      .catch(function () {
        wx.showToast({ title: '开启失败，请稍后再试', icon: 'none' });
      });
  },

  onGoReport: function () { wx.navigateTo({ url: '/pages/report/report?petKey=' + encodeURIComponent(this.data.petKey) + '&petName=' + encodeURIComponent(this.data.petName) }); }
});