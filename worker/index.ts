/**
 * 边缘 Worker：实时抓取接口 + 静态资源托管 + 定时自刷新。
 *
 * 与 GitHub Actions 快照构成双通道：
 *   慢通道 = Actions 每小时抓取，提交 public/data/feed.json，随构建发布
 *   快通道 = 本 Worker 按需实时抓取，结果写入 KV 缓存
 * 任一通道存活，站点就有内容。
 */

// @ts-expect-error —— 与 Node 抓取脚本共用同一份 .mjs 规则，避免两套逻辑漂移
import { collectAll, collectTrends, refine, mergeFeeds } from '../shared/sources.mjs';
// @ts-expect-error 同上
import { TOPICS, WALLED_PLATFORMS } from '../shared/taxonomy.mjs';
// 构建期把最新快照烘焙进 Worker，保证边缘接口在「无缓存 + 上游被风控」时仍有兜底内容。
// 每次 Actions 流水线（抓取→构建→部署）都会把它刷新为最新快照。
// @ts-expect-error JSON 快照由 esbuild 直接注入
import BAKED_SNAPSHOT from '../public/data/feed.json';

interface Env {
  ASSETS: Fetcher;
  FEED_CACHE?: KVNamespace;
}

const CACHE_KEY = 'feed:v1';
const TTL_SECONDS = 900; // 15 分钟

const json = (data: unknown, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });

interface Payload {
  meta: Record<string, unknown>;
  trends?: unknown[];
  items: unknown[];
}

const snapshot = BAKED_SNAPSHOT as Payload;

/**
 * 边缘取数：实时抓取结果 ∪ 构建期快照。
 *
 * 实测边缘只能抓到媒体源与爱奇艺（B 站、AcFun 对 CF 出口 IP 有风控），
 * 单靠实时会把首屏从 300 条打到 80 条、且丢掉全部视频平台内容；
 * 单靠快照则损失这一小时内的新稿。所以两者取并集，实时结果排在前面参与去重。
 */
async function buildFeed(): Promise<Payload> {
  const started = Date.now();

  const [collected, trends] = await Promise.all([
    collectAll({ quick: true }).catch(() => ({ items: [], stats: {} })),
    collectTrends().catch(() => []),
  ]);

  const { list: live, dropped } = refine(collected.items, { limit: 220 });
  const snapshotItems = (snapshot?.items as any[]) ?? [];
  const list = mergeFeeds(live, snapshotItems, { limit: 300 }) as any[];

  const dayAgo = Date.now() - 86_400_000;
  const byPlatform: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const it of list) {
    byPlatform[it.platformName] = (byPlatform[it.platformName] || 0) + 1;
    byTopic[it.topic] = (byTopic[it.topic] || 0) + 1;
    byKind[it.kind || 'video'] = (byKind[it.kind || 'video'] || 0) + 1;
  }

  const trendList = (trends as unknown[]).length
    ? (trends as unknown[])
    : ((snapshot?.trends as unknown[]) ?? []);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      mode: 'edge',
      stale: false,
      sourceStats: collected.stats,
      dropped,
      topics: TOPICS,
      summary: {
        total: list.length,
        freshLast24h: list.filter((i) => new Date(i.publishedAt).getTime() > dayAgo).length,
        byPlatform,
        byTopic,
        byKind,
      },
      walled: WALLED_PLATFORMS,
      // 把两条通道各自的产出量如实标出来，方便判断是哪一侧出了问题
      channels: {
        edge: live.length,
        snapshot: snapshotItems.length,
        snapshotAt: (snapshot?.meta as any)?.generatedAt ?? null,
      },
      note: '边缘实时抓取与每小时快照的并集；B 站/AcFun 对云厂商 IP 有风控，其内容主要来自快照通道。',
    },
    trends: trendList,
    items: list,
  };
}

async function readCache(env: Env): Promise<{ payload: Payload; age: number } | null> {
  if (!env.FEED_CACHE) return null;
  try {
    const raw = await env.FEED_CACHE.get(CACHE_KEY, 'json');
    if (!raw) return null;
    const wrapped = raw as { at: number; payload: Payload };
    return { payload: wrapped.payload, age: Math.floor((Date.now() - wrapped.at) / 1000) };
  } catch {
    return null;
  }
}

async function writeCache(env: Env, payload: Payload) {
  if (!env.FEED_CACHE) return;
  try {
    await env.FEED_CACHE.put(CACHE_KEY, JSON.stringify({ at: Date.now(), payload }), {
      expirationTtl: 86_400, // 保留一天，供上游抓挂时兜底
    });
  } catch {
    /* 缓存写入失败不影响本次响应 */
  }
}

async function handleFeed(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  const cached = await readCache(env);

  if (cached && !force && cached.age < TTL_SECONDS) {
    return json(
      { ...cached.payload, meta: { ...cached.payload.meta, cacheAge: cached.age } },
      { 'Cache-Control': 'public, max-age=120', 'X-Cache': 'HIT' },
    );
  }

  try {
    const payload = await buildFeed();
    if (payload.items.length === 0) throw new Error('实时抓取零产出');
    ctx.waitUntil(writeCache(env, payload));
    return json(payload, { 'Cache-Control': 'public, max-age=120', 'X-Cache': 'MISS' });
  } catch (err) {
    // 上游被风控时退回陈旧缓存，也好过给用户一个 500
    if (cached) {
      return json(
        {
          ...cached.payload,
          meta: { ...cached.payload.meta, stale: true, cacheAge: cached.age },
        },
        { 'X-Cache': 'STALE' },
      );
    }

    // 连缓存都没有（如刚部署）：逐级回退，保证 /api/feed 永远有内容。
    // B 站对 Cloudflare 数据中心 IP 有风控，边缘实时抓取可能长期零产出。
    // 回退顺序：① 构建期烘焙进 Worker 的快照（最稳，无运行时依赖）
    //           ② 构建产物 dist/data/feed.json（ASSETS）
    //           ③ 仓库内最新快照（GitHub raw）
    const GITHUB_RAW =
      'https://raw.githubusercontent.com/useragent-1/ai-video-radar/main/public/data/feed.json';

    // ① 烘焙快照：编译进 Worker，必定可用
    try {
      const payload = snapshot;
      if (payload?.items?.length) {
        return json(
          { ...payload, meta: { ...payload.meta, stale: false, servedVia: 'baked' } },
          { 'Cache-Control': 'public, max-age=300', 'X-Cache': 'BAKED' },
        );
      }
    } catch {
      /* 理论不可达 */
    }

    // ② 构建产物（ASSETS）
    try {
      const snapshot = await env.ASSETS.fetch(new Request(new URL('/data/feed.json', request.url)));
      if (snapshot.ok) {
        const payload = (await snapshot.json()) as Payload;
        return json(
          { ...payload, meta: { ...payload.meta, stale: false, servedVia: 'asset-fallback' } },
          { 'Cache-Control': 'public, max-age=300', 'X-Cache': 'ASSET-FALLBACK' },
        );
      }
    } catch {
      /* 继续下一档 */
    }

    // ③ 仓库内最新快照
    try {
      const res = await fetch(GITHUB_RAW, { headers: { 'User-Agent': 'ai-video-radar/1.0' } });
      if (res.ok) {
        const payload = (await res.json()) as Payload;
        return json(
          { ...payload, meta: { ...payload.meta, stale: false, servedVia: 'github-raw' } },
          { 'Cache-Control': 'public, max-age=300', 'X-Cache': 'GITHUB-RAW' },
        );
      }
    } catch {
      /* 全部失败才报错 */
    }

    return json(
      { error: '实时抓取失败', detail: (err as Error).message },
      { 'X-Cache': 'MISS' },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/feed') return handleFeed(request, env, ctx);

    if (url.pathname === '/api/health') {
      const cached = await readCache(env);
      return json({
        ok: true,
        time: new Date().toISOString(),
        cache: cached ? { age: cached.age, items: cached.payload.items.length } : null,
        kv: Boolean(env.FEED_CACHE),
      });
    }

    return env.ASSETS.fetch(request);
  },

  /** Cron 触发：让边缘缓存自己保鲜，不完全依赖 GitHub Actions */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const payload = await buildFeed();
          if (payload.items.length > 0) await writeCache(env, payload);
          console.log(`[cron] 刷新完成，${payload.items.length} 条`);
        } catch (err) {
          console.error('[cron] 刷新失败:', (err as Error).message);
        }
      })(),
    );
  },
};
