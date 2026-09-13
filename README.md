# 宠物餐单定制服务（pet-meal-planner）

三层喂养模式（纯鲜食 A / 狗粮+辅食 B / 混合 C）的宠物餐单生成系统。模式 B 为获客主入口：不换主粮，按类型建议选粮 + 每周辅食配方，辅食热量 ≤10%，**不推荐品牌只建议类型**。

## 技术栈

- 纯 Node ESM + 零第三方依赖（Node ≥20），EdgeOne 云函数兼容：导出 `handler(request, env)` 即可部署
- 领域层（`src/domain`）：规则引擎（NRC/AAFCO 基线、可审计决策链 R001-R006）、宠物档案、三层喂养模式、餐单生成
- 存储（`src/services`）：仓储接口对齐飞书多维表格语义；内置 `FeishuRepository`（飞书 bitable OpenAPI，配置化接入），未配置飞书时自动退回 Mock 内存实现
- 支付（`src/services/wechat-pay-provider.js`）：微信支付 V3 / JSAPI 接入（零依赖，仅 `node:crypto`），配置商户凭证后启用，未配置时退回 Stub 兜底
- 前端（`src/web`）：原生 H5，移动优先，无构建步骤
- 小程序端（`miniprogram/`）：原生微信小程序（wxml/wxss/js），延续零依赖理念；可测逻辑抽离到 `miniprogram/utils`，与后端领域层对齐并可单测

## 运行与测试

```bash
npm start        # http://127.0.0.1:3000
npm test         # node:test 单元测试
node test/miniprogram.test.cjs   # 小程序端纯逻辑单测（CJS）
```

## 目录

```
src/domain/      规则引擎、档案、喂养模式、餐单生成、订阅订单状态机（纯逻辑，可移植）
src/services/    仓储抽象 + FeishuRepository + Mock + 支付提供方
src/server/      EdgeOne 兼容入口 + 本地服务器
src/web/         H5 前端（问诊 → 生成 → 展示）
miniprogram/     原生微信小程序端（问诊建档 / 餐单结果 / 订阅下单）
test/            单元测试（含 miniprogram.test.cjs）
```

## 小程序端

原生微信小程序，三条页面链路完整对接后端：**问诊建档（index）→ 餐单结果（result）→ 订阅下单（subscribe）**。

对接口径（信封统一 `{ok:true, ...}`，无 `wx` 依赖的逻辑已单测覆盖）：

| 小程序调用 | 后端路由 | 返回 |
|---|---|---|
| `POST /api/auth/login` | 微信登录换 openid（`code`+`deviceId`） | `{ ok, openid, unionid }` |
| `POST /api/plans/generate` | 生成餐单 | `{ ok, plan }` |
| `GET /api/skus` | 订阅 SKU 列表 | `{ ok, skus }` |
| `POST /api/orders` | 创建订单（pending） | `{ ok, order, payment }` |
| `POST /api/orders/:id/pay-callback` | 模拟支付回调（→paid） | `{ ok, order }` |
| `POST /api/checkins` | 每日喂食打卡 | `{ ok, record }` |
| `GET /api/checkins/:petKey` | 打卡历史 | `{ ok, records }` |
| `GET /api/reports/:petKey` | 健康周报 | `{ ok, weekly, history }` |
| `POST /api/push/subscribe` | 开启每日推送订阅（幂等） | `{ ok, subscriber }` |
| `POST /api/push/unsubscribe` | 退订 | `{ ok }` |
| `POST /api/push/daily` | 触发一次每日推送下发 | `{ ok, sent, skipped, errors }` |
| `POST /api/events` | 上报埋点事件 | `{ ok }` |
| `GET /api/stats` | 埋点计数 + 推送日志快照 | `{ ok, counters, recent, pushLogs }` |

### 身份打通（openid）

`app.js` 在 `onLaunch` 调 `wx.login` → `POST /api/auth/login` 换取稳定 `openid` 存入本地缓存，供后续推送订阅 / 支付订单使用。未配置微信凭证时后端用 `deviceId` 降级生成稳定的 `dev_` 前缀 openid（`provider: mock`）；配置了 `WX_APPID`/`WX_APP_SECRET` 后走官方 `code2session`（`provider: wechat`）。

### 埋点统计

后端 `Analytics` 服务按白名单记录北极星指标相关事件计数与最近 30 条明细：`profile_created`（建档）、`plan_generated`（生成餐单）、`order_created`/`order_paid`（订阅转化）、`checkin_created`（每日打卡）、`push_subscribe`/`push_daily_sent`/`push_daily_error`（推送触达）。`GET /api/stats` 一键导出，用于验证建档完成率、免费→订阅转化率等上线后的真实效果。

本地联调步骤：

1. 启动后端：`npm run dev`（优先用这个：自动加载 `.env` 启用飞书持久化，并监听 `0.0.0.0` 便于真机）。未配置 `.env` 时才退回内存 Mock / Stub 支付，此时用 `npm start` 即可。
2. 微信开发者工具导入 `miniprogram/` 目录
3. 打开「详情 → 本地设置」，勾选「不校验合法域名」
4. `BASE_URL` 已在 `miniprogram/utils/config.js` 默认指向 `http://127.0.0.1:3000`
   - 模拟器（PC 上跑）：不用改
   - 真机预览（手机扫码）：把 `BASE_URL` 改成电脑的局域网 IP（如 `http://192.168.x.x:3000`），手机与电脑需同一网络。启动 `npm run dev` 时控制台会打印出可用的局域网地址。
5. 编译运行，走一遍 **问诊建档 → 餐单结果 → 订阅下单 → 模拟支付** 闭环；数据会真实落入你的飞书多维表格，可在表格里核对。

> 上线前：把 `BASE_URL` 换成你已配置合法域名的 EdgeOne 云函数地址，并移除去本地校验域名的勾选。

## 飞书多维表格接入

服务用飞书多维表格（Base）做持久化存储，三张基础表分别承载宠物档案 / 餐单 / 订阅订单。
`FeishuRepository` 基于官方 bitable v1 OpenAPI：每条记录用「ID 字段」精确过滤定位，用「JSON 字段」
无损承载完整领域对象，另展开关键字段便于表格人工可读。鉴权走应用身份 tenant_access_token。

通过环境变量配置后自动启用（本地未配置时退回 Mock，便于开发/CI）：

| 环境变量 | 说明 |
|---|---|
| `FEISHU_APP_ID` | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret |
| `FEISHU_BASE_TOKEN` | Base token（多维表格 app token） |
| `FEISHU_TABLE_PROFILE` | 档案表 table_id |
| `FEISHU_TABLE_PLAN` | 餐单表 table_id |
| `FEISHU_TABLE_ORDER` | 订阅订单表 table_id |

表结构（Records 写入的关键字段）：

- **档案表** `档案ID · 档案JSON · 宠物昵称 · 品种 · 体重kg · 月龄 · 生命阶段 · 活动量 · 已绝育 · 喂养模式 · 过敏史 · 主粮标签 · 创建时间`
- **餐单表** `餐单ID · 餐单JSON · 宠物昵称 · DER热量 · 喂养模式 · 创建时间`
- **订阅订单表** `订单ID · 订单JSON · 会员 · 金额(分) · 支付单号 · SKU · SKU名称 · 状态 · 创建时间`

### 开通飞书持久化的步骤（一次性）

运行时走「应用身份」鉴权，需你在飞书开放平台创建自建应用并授权 Base，约 5 分钟：

1. 打开 [飞书开放平台](https://open.feishu.cn) → 开发者后台 → 「创建企业自建应用」，填入名称提交
2. 在应用「权限管理」中勾选「多维表格」以下**精确 scope**（在权限搜索框逐个搜并开通）：
   - `bitable:app`（多维表格全部能力）**或**逐项：`base:record:create`、`base:record:read`、`base:record:update`、`base:record:delete`、`base:app:read`
3. **发布应用版本（关键！）**：去「版本管理与发布」→ 创建版本 → 申请发布并**等待审核通过**。未发版的权限不生效，运行时会报 `Access denied ... scope is required`（鉴权本身会成功，但读写被拒，即上文的报错）
4. 在应用「凭证与基础信息」页复制 **App ID** 与 **App Secret**
5. 回到目标多维表格 Base → 右上角「... / 更多」→ **分享或协作者** → 添加成员：**应用名称**（选「可编辑」）
6. 脚本位于仓库根 `scripts/feishu-e2e.mjs`，配置好后运行 `node scripts/feishu-e2e.mjs` 做真实写入·读回自检（自动清理测试记录）

完成后把 App ID / App Secret 填进 `.env`（参考 `.env.example`），或部署到 EdgeOne 时在「环境变量」面板配置同名变量。`FEISHU_BASE_TOKEN` 与三张 `FEISHU_TABLE_*` 已按你账号的现有 Base 填写好。

## 微信支付接入（M2.02）

`WechatPayProvider` 基于 APIv3（JSAPI）实现，零第三方依赖（`node:crypto` 完成 RSA 签名与 AES-256-GCM 加解密）。
配置了商户凭证后 `app.js` 自动启用，缺省仍走 Stub 兜底（本地/演示）。纯函数（签名、验签、解密、prepay 参数）已离线单测覆盖。

| 环境变量 | 说明 |
|---|---|
| `WXPAY_MCHID` | 商户号（存在即视为启用微信支付） |
| `WXPAY_APPID` | 小程序 AppID |
| `WXPAY_SERIAL_NO` | 商户 API 证书序列号 |
| `WXPAY_PRIVATE_KEY` | 商户私钥（PEM 字符串） |
| `WXPAY_API_V3_KEY` | 商户 APIv3 密钥（32 字节） |
| `WXPAY_NOTIFY_URL` | 支付回调 HTTPS 地址（需为已备案合法域名，指向 `/api/orders/:orderId/pay-callback`） |
| `WXPAY_PLATFORM_PUBLIC_KEY` | 微信支付平台公钥（PEM，回调验签用） |
| `WXPAY_DEFAULT_OPENID` | 可选：默认测试 openid（正式环境下端上先 `wx.login` 换取） |

回调接口与 Stub 共用 `/api/orders/:orderId/pay-callback`：真实微信通知走到同一条幂等状态机（验签→解密 resource→`pay` 事件→`paid`）。

## 安全红线（上线前必读）

按一次完整安全审查（R1–R7）落地以下防线，**本地缺省不启用、上线务必配置**：

| 防护 | 说明 | 触发开关 |
|---|---|---|
| 管理接口鉴权 | `INTERNAL_KEY` 配置后，`/api/stats`、`/api/push/daily`、`/api/push/logs`、`/api/push/trigger` 需携带 `X-Admin-Key` 请求头，否则 401。防他人批量下发推送 / 读取内部埋点与 openid 日志 | `INTERNAL_KEY` |
| Stub 支付回调密钥 | 未配 `WXPAY_*` 走 Stub 时，若配置 `CALLBACK_SECRET`，支付回调需带 `X-Callback-Secret`，否则拒绝标 paid。防空转一个回调把订单标已支付 | `CALLBACK_SECRET` |
| 档案身份归属（owner） | 打卡 / 推送订阅携带 `ownerOpenid` 时，首个写入者锁定为 owner；他人 openid 写同一 petKey → 403 `OWNER_MISMATCH`。防越权覆盖他人档案 / 向他人 openid 订阅 | 客户端带 openid 即生效 |
| H5 输出转义 | 结果页所有用户可控字段经 `esc()` 转义，防存储型 XSS | 内置 |
| 静态目录穿越防护 | `serveStatic` 规范化路径并限制在 WEB_DIR 内，`..`/反斜杠/二次绝对路径 → 404 | 内置 |
| 内部错误脱敏 | 仅 400 客户端错误回传具体 message；500 统一「服务器内部错误」，不泄漏堆栈 | 内置 |

> 注意：默认（未配置开关）这些接口在本地按可访问处理以保持开发/测试畅通；**生产必须配置对应环境变量**，否则仍存在 R3/R2 所述滥用面。

## 合规红线

- 类型建议只给参数（蛋白/脂肪/钙磷比/谷物），不出现品牌名
- 不贬低狗粮、不做医疗断言
- 食材过犬安全黑名单（洋葱/葡萄/巧克力等）与过敏史过滤
- 餐单附审计决策链（规则 id + 版本），可追溯

## 现状与下一步

- 已完成：M0 规则引擎 + 宠物档案、M1 餐单生成（三模式）＋ 共享读取 API（GET /api/plans/:id）＋ H5
- 已完成：M2.01 订阅 SKU + 5 态订单状态机（pending/paid/active/cancelled/expired，含回调幂等、退订/续费/到期）
- 已完成：飞书多维表格接入（FeishuRepository 配置化持久化档案 / 餐单 / 订单）
- 已完成：原生微信小程序端（问诊建档 → 餐单结果 → 订阅下单，逻辑层单测 + HTTP 链路冒烟通过）
- 已完成：M2.02 微信支付接入（WechatPayProvider，APIv3/JSAPI 签名与回调验签解密，离线单测覆盖）
- 已完成：飞书真实环境联调（自建应用鉴权 + 三表读写往返 ALL PASS，`scripts/feishu-e2e.mjs`；修复 filter 用 POST /records/search、富文本读回两处 bug）
- 已完成：「有爱」留存功能线（每日喂食打卡 + 连续天数 + 打卡网格 + 健康周报；P0 免费体验优化、P1 付费转化优化均已落地）
- 已完成：微信身份打通（`POST /api/auth/login`，无凭证降级 mock openid）+ 每日推送自动调度（`npm run dev` 内置 `startDailyScheduler`，到每日 `PUSH_HOUR` 触发一次 `sendDaily`，幂等去重）+ 埋点统计（`/api/events` + `/api/stats`）
- 已完成：平台单测（analytics / auth）与冒烟测试全绿（85 单测 + 45 冒烟 + 0 模板扫描问题，含 `wx` storage/login shim）
- 待做：微信推送真实下发需配置 `WX_APPID`/`WX_APP_SECRET`/`H5_TEMPLATE_ID` 与服务号服务通知权限；生产环境改用 EdgeOne scheduled trigger 定时绑定（逻辑与本地 scheduler 同一 `sendDaily`）
- 待做：M2.02 需填入真实商户凭证联调、微信开发者工具实机联调（后端已就绪，`npm run dev` 一键启动）
