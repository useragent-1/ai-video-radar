# AI 视频情报台

聚合中文视频平台最新 AI 内容的自动化情报站。报纸编辑部风格界面，每小时自动更新。

## 架构：双通道 + 烘焙快照兜底

站点由同一条流水线自维护（`.github/workflows/crawl.yml`，每小时 cron + 手动触发）：

```
GitHub Actions（每小时）
  ├─ crawl   → scripts/crawl.mjs → public/data/feed.json
  ├─ build   → vite build（把最新快照烘焙进 dist/ 与 Worker）
  ├─ deploy  → wrangler deploy（Worker + 静态资源 → Cloudflare）
  └─ commit  → 把快照提交回仓库，保住「仓库即数据源」
```

线上请求 `/api/feed` 时，Cloudflare Worker 的回退链保证「永远有内容」：

```
① 边缘实时抓取（buildFeed）→ 成功则写入 KV 缓存，直接返回
② KV 缓存（15min TTL，30min cron 自刷新）→ 命中即返回
③ 烘焙快照：构建期把 public/data/feed.json 编译进 Worker 本体
   → 边缘实时抓取被风控（B 站对数据中心 IP 限流）时，零运行时依赖直接返回
④ ASSETS 静态资源 dist/data/feed.json
⑤ GitHub raw：仓库内最新快照（兜底中的兜底）
```

> 关键事实：B 站对 Cloudflare 数据中心 IP 有风控，边缘实时抓取长期零产出，
> 因此**烘焙快照（③）是线上内容的主兜底**，④⑤ 为额外保险。任一档可用，站点就有内容。

前端优先请求 `/api/feed`，失败自动回落 `/data/feed.json`。

## 数据源

| 平台 | 入口 | 状态 |
|------|------|------|
| 哔哩哔哩 | 搜索（28 关键词）+ 6 分区最新投稿 + 3 排行榜 | ✅ 主力 |
| AcFun | 关键词搜索 | ✅ 补充 |
| 抖音 / 快手 / 西瓜 / 腾讯视频 / 爱奇艺 | — | ❌ 需私有签名或登录态，暂无法稳定接入 |

## 内容质量治理

1. **词边界匹配** —— 英文信号词一律 `(?<![a-z0-9])word(?![a-z0-9])`，避免 `ai` 误伤 `said/main/air`
2. **分区白名单三档制** —— 核心区直收、中性区要求标题强信号、娱乐区一律不收（挡住"拿 AI 玩梗"的内容）
3. **噪音分级** —— 硬噪音（代充引流、灰产）直接剔除；软噪音（资源分发刷屏）降权
4. **排序算法** —— 指数时间衰减（36h 半衰期）× 对数热度 + 多入口命中加权

## 开发

```bash
pnpm install
pnpm crawl        # 抓取数据 → public/data/feed.json
pnpm dev          # Vite 开发服务器
pnpm build        # 构建 dist/
pnpm deploy       # 抓取 + 构建 + wrangler deploy
```

## 部署

- **Cloudflare Workers**（静态资源 + `/api/feed` 边缘接口 + KV 缓存 + cron）
- 需要绑定 KV namespace：`FEED_CACHE`
- GitHub Actions 每小时自动 抓取 → 构建 → 部署 → 提交快照，无需人工介入
- 部署所需密钥（Repository Secrets）：
  - `CLOUDFLARE_API_TOKEN` —— 具备 Workers 编辑 / KV 写入权限
  - `CLOUDFLARE_ACCOUNT_ID` —— 账户 ID

## 版权

所有视频内容版权归原作者与平台所有。本站仅做标题与链接的索引聚合，不存储、不转码任何视频文件。
