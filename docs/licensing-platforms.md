# 收费模式 - 第三方平台对比

## 免费或有免费额度的平台

| 平台 | 月费 | 收费模式 | 适合场景 |
|------|------|----------|----------|
| **Cryptolens** | $0 起 | 免费额度有限，付费按量 | 桌面应用 license 验证 |
| **Keygen.sh** | $0 起 | 免费有额度限制 | API 优先的 license 管理 |
| **LicenseSpring** | 有免费计划 | 免费版有限制 | 跨平台桌面应用 |

## 按交易抽成（无月费）的平台

| 平台 | 月费 | 抽成 | 特点 |
|------|------|------|------|
| **Gumroad** | $0 | 10% 每笔交易 | 最简单，适合独立开发者 |
| **LemonSqueezy** | $0 | 5% + 50¢ 每笔交易 | 现代化，支持 SaaS 订阅 |
| **Paddle** | $0 | 5% + 50¢ 每笔交易 | 功能最全，自动处理税务 |

## 推荐方案

### 方案 A：Gumroad（最简单）
- 0 月费，卖出才收 10%
- 内置 license key API，验证很简单
- Rust 端一个 HTTP 请求搞定
- 适合刚起步、用户量小的阶段

### 方案 B：Cryptolens（技术最灵活）
- 免费额度足够小项目使用
- 支持离线验证、试用期、功能锁定
- 纯 license API，支付部分用支付宝/微信收款也行
- 适合想自己控制支付流程的

### 方案 C：完全自建（零成本但花时间）
- 用 RSA/Ed25519 自己签 license
- 前端验证，不依赖任何第三方
- 支付走支付宝当面付或微信支付
- 适合有精力维护的开发者

## 参考链接

- [Cryptolens](https://cryptolens.io)
- [Keygen.sh](https://keygen.sh)
- [Gumroad](https://gumroad.com)
- [LemonSqueezy](https://lemonsqueezy.com)
- [Paddle](https://paddle.com)
- [LicenseSpring](https://licensespring.com)
