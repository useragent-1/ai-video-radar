/**
 * 边缘 Worker：实时抓取接口 + 静态资源托管 + 定时自刷新。
 *
 * 与 GitHub Actions 快照构成双通道：
 *   慢通道 = Actions 每小时抓取，提交 public/data/feed.json，随构建发布
 *   快通道 = 本 Worker 按需实时抓取，结果写入 KV 缓存
 * 任一通道存活，站点就有内容。
 */

// @ts-expect-error —— 与 Node 抓取脚本共用同一份 .mjs 规则，避免两套逻辑漂移
import { collectAll, refine } from '../shared/sources.mjs';
// @ts-expect-error 同上
import { TOPICS } from '../shared/taxonomy.mjs';

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
  items: unknown[];
}

async function buildFeed(): Promise<Payload> {
  const started = Date.now();
  const { items: raw, stats } = await collectAll({ quick: true });
  const { list, dropped } = refine(raw, { limit: 220 });

  const dayAgo = Date.now() - 86_400_000;
  const byPlatform: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  for (const it of list as any[]) {
    byPlatform[it.platformName] = (byPlatform[it.platformName] || 0) + 1;
    byTopic[it.topic] = (byTopic[it.topic] || 0) + 1;
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      mode: 'edge',
      stale: false,
      sourceStats: stats,
      dropped,
      topics: TOPICS,
      summary: {
        total: list.length,
        freshLast24h: (list as any[]).filter((i) => new Date(i.publishedAt).getTime() > dayAgo)
          .length,
        byPlatform,
        byTopic,
      },
    },
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
