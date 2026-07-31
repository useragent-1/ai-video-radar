/**
 * 各视频平台适配器。每个适配器把平台原始结构映射成统一的 VideoItem。
 *
 * 关于覆盖范围的诚实说明：
 * 抖音、快手、西瓜、腾讯视频、爱奇艺、优酷的开放接口均需要私有签名
 * (X-Bogus / a_bogus / vplatform token) 或登录态，无法在无凭证的边缘环境稳定抓取。
 * 因此本项目主力源是 B 站（搜索 + 分区最新 + 排行榜三个维度）与 AcFun。
 */

import { fetchJson, getBiliCookie, biliHeaders, pooled } from './http.mjs';
import {
  SEARCH_KEYWORDS,
  BILI_ZONES,
  aiRelevance,
  noiseLevel,
  isSpamAuthor,
  isPolitical,
  isAiRelated,
  classifyTopic,
} from './taxonomy.mjs';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

/** "12:34" / "1:02:03" → 秒 */
function parseDuration(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '').split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function makeItem(raw) {
  const title = stripTags(raw.title);
  const desc = stripTags(raw.description).slice(0, 200);
  const topic = classifyTopic(title, desc, raw.tags);
  return {
    id: `${raw.platform}:${raw.nativeId}`,
    platform: raw.platform,
    platformName: raw.platformName,
    title,
    url: raw.url,
    cover: String(raw.cover || '').replace(/^http:/, 'https:'),
    author: stripTags(raw.author),
    authorUrl: raw.authorUrl || '',
    publishedAt: new Date(raw.publishedAt * 1000).toISOString(),
    publishedTs: raw.publishedAt,
    duration: raw.duration || 0,
    views: raw.views || 0,
    danmaku: raw.danmaku || 0,
    replies: raw.replies || 0,
    likes: raw.likes || 0,
    description: desc,
    topic: topic.id,
    topicLabel: topic.label,
    channel: raw.channel || '',
    via: raw.via,
  };
}

/* ---------------------------------- 哔哩哔哩 ---------------------------------- */

async function biliSearch(keyword, cookie) {
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&page=1' +
    `&keyword=${encodeURIComponent(keyword)}`;
  const json = await fetchJson(url, { headers: biliHeaders(cookie) });
  const list = json?.data?.result;
  if (!Array.isArray(list)) return [];

  return list.map((v) =>
    makeItem({
      platform: 'bilibili',
      platformName: '哔哩哔哩',
      nativeId: v.bvid,
      title: v.title,
      description: v.description,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      cover: v.pic?.startsWith('//') ? `https:${v.pic}` : v.pic,
      author: v.author,
      authorUrl: `https://space.bilibili.com/${v.mid}`,
      publishedAt: v.pubdate || v.senddate,
      duration: parseDuration(v.duration),
      views: v.play || 0,
      danmaku: v.video_review || 0,
      replies: v.review || 0,
      likes: v.like || 0,
      channel: v.typename || '',
      tags: v.tag || '',
      via: `搜索·${keyword}`,
    }),
  );
}

async function biliZone(zone, cookie) {
  const url = `https://api.bilibili.com/x/web-interface/newlist?rid=${zone.rid}&ps=50&pn=1`;
  const json = await fetchJson(url, { headers: biliHeaders(cookie) });
  const list = json?.data?.archives;
  if (!Array.isArray(list)) return [];

  return list
    .filter((v) => isAiRelated(v.title, v.desc))
    .map((v) =>
      makeItem({
        platform: 'bilibili',
        platformName: '哔哩哔哩',
        nativeId: v.bvid,
        title: v.title,
        description: v.desc,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        cover: v.pic,
        author: v.owner?.name,
        authorUrl: `https://space.bilibili.com/${v.owner?.mid}`,
        publishedAt: v.pubdate,
        duration: v.duration,
        views: v.stat?.view || 0,
        danmaku: v.stat?.danmaku || 0,
        replies: v.stat?.reply || 0,
        likes: v.stat?.like || 0,
        channel: v.tname || zone.name,
        via: `分区最新·${zone.name}`,
      }),
    );
}

async function biliRanking(rid, cookie) {
  const url = `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`;
  const json = await fetchJson(url, { headers: biliHeaders(cookie) });
  const list = json?.data?.list;
  if (!Array.isArray(list)) return [];

  return list
    .filter((v) => isAiRelated(v.title, v.desc))
    .map((v) =>
      makeItem({
        platform: 'bilibili',
        platformName: '哔哩哔哩',
        nativeId: v.bvid,
        title: v.title,
        description: v.desc,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        cover: v.pic,
        author: v.owner?.name,
        authorUrl: `https://space.bilibili.com/${v.owner?.mid}`,
        publishedAt: v.pubdate,
        duration: v.duration,
        views: v.stat?.view || 0,
        danmaku: v.stat?.danmaku || 0,
        replies: v.stat?.reply || 0,
        likes: v.stat?.like || 0,
        channel: v.tname || '',
        via: '排行榜',
      }),
    );
}

/* ----------------------------------- AcFun ---------------------------------- */

async function acfunSearch(keyword) {
  const url = `https://www.acfun.cn/rest/pc-direct/search/video?keyword=${encodeURIComponent(
    keyword,
  )}&pCursor=1`;
  const json = await fetchJson(url, {
    headers: { Referer: 'https://www.acfun.cn/', Origin: 'https://www.acfun.cn' },
  });
  const list = json?.videoList;
  if (!Array.isArray(list)) return [];

  return list.map((v) =>
    makeItem({
      platform: 'acfun',
      platformName: 'AcFun',
      nativeId: String(v.contentId ?? v.id),
      title: v.title || v.emTitle,
      description: '',
      url: `https://www.acfun.cn/v/ac${v.contentId ?? v.id}`,
      cover: v.coverUrl,
      author: v.userName,
      authorUrl: `https://www.acfun.cn/u/${v.userId}`,
      publishedAt: Math.floor((v.ctime || Date.now()) / 1000),
      duration: parseDuration(v.playDuration),
      views: v.viewCount || 0,
      danmaku: v.danmuCount || 0,
      replies: v.commentCount || 0,
      via: `搜索·${keyword}`,
    }),
  );
}

/* --------------------------------- 编排入口 --------------------------------- */

/**
 * 抓取全部源。
 * @param {{quick?: boolean, keywordLimit?: number}} opts quick 模式用于 Worker 实时请求，只跑高价值关键词
 */
export async function collectAll(opts = {}) {
  const { quick = false } = opts;
  const keywordLimit = opts.keywordLimit ?? (quick ? 8 : SEARCH_KEYWORDS.length);
  const keywords = SEARCH_KEYWORDS.slice(0, keywordLimit);
  const cookie = await getBiliCookie();

  const stats = {};
  const track = (name, arr) => {
    stats[name] = (stats[name] || 0) + arr.length;
    return arr;
  };

  const tasks = [
    ...keywords.map((kw) => () => biliSearch(kw, cookie).then((r) => track('bili_search', r))),
    ...(quick ? [] : BILI_ZONES).map(
      (z) => () => biliZone(z, cookie).then((r) => track('bili_zone', r)),
    ),
    ...(quick ? [] : [188, 36, 231]).map(
      (rid) => () => biliRanking(rid, cookie).then((r) => track('bili_rank', r)),
    ),
    ...keywords.slice(0, quick ? 3 : 8).map(
      (kw) => () => acfunSearch(kw).then((r) => track('acfun', r)),
    ),
  ];

  const raw = await pooled(tasks, 6, (task) => task());
  return { items: raw, stats };
}

/* ------------------------------- 去重 · 过滤 · 排序 ------------------------------- */

const HOUR = 3600;

/**
 * 综合排序分：新鲜度为主、热度为辅。
 * 纯按时间排序会让优质内容被水贴淹没；纯按播放排序会让「最新」名存实亡。
 * 这里用指数时间衰减 × 对数热度，24 小时内的内容有明显优势。
 */
function score(item, now) {
  const ageHours = Math.max(0, (now - item.publishedTs) / HOUR);
  const freshness = Math.exp(-ageHours / 36);
  const heat =
    Math.log10(1 + item.views) * 1.0 +
    Math.log10(1 + item.danmaku) * 0.6 +
    Math.log10(1 + item.replies) * 0.5;

  let modifier = 1;
  if (item.duration > 0 && item.duration < 30) modifier *= 0.65; // 过短多为切片搬运
  if (item.noise === 1) modifier *= 0.55; // 软噪音：资源分发、标题党
  if (item.relevance >= 2) modifier *= 1.12; // 标题强信号
  if (item.tier === 'neutral') modifier *= 0.75; // 中性分区可信度较低
  modifier *= 1 + Math.min(item.hits - 1, 3) * 0.08; // 多入口命中说明确实在被讨论

  return (freshness * 6 + heat * 0.9) * modifier;
}

/**
 * 去重 → 相关性过滤 → 噪音治理 → 打分排序。
 * 过滤统计会一并返回，方便在站点上透明展示「筛掉了什么」。
 */
export function refine(items, { maxAgeDays = 21, limit = 300 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - maxAgeDays * 24 * HOUR;
  const seen = new Map();
  const dropped = { expired: 0, offtopic: 0, irrelevant: 0, spam: 0, duplicate: 0 };

  for (const item of items) {
    if (!item || !item.title || !item.publishedTs) continue;
    if (item.publishedTs < cutoff || item.publishedTs > now + 2 * HOUR) {
      dropped.expired++;
      continue;
    }

    const { score: relevance, tier } = aiRelevance(item);
    if (tier === 'casual') {
      dropped.offtopic++;
      continue;
    }
    if (relevance < 1.5) {
      dropped.irrelevant++;
      continue;
    }

    const noise = noiseLevel(item.title, item.description);
    if (noise === 2 || isSpamAuthor(item.author) || isPolitical(item.title, item.description)) {
      dropped.spam++;
      continue;
    }

    const prev = seen.get(item.id);
    if (prev) {
      dropped.duplicate++;
      prev.hits += 1;
      if (item.views > prev.views) {
        Object.assign(prev, item, { hits: prev.hits, noise, relevance, tier });
      }
      continue;
    }
    seen.set(item.id, { ...item, hits: 1, noise, relevance, tier });
  }

  const list = [...seen.values()]
    .map((item) => ({ ...item, score: Number(score(item, now).toFixed(3)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ noise, relevance, tier, hits, ...rest }) => ({ ...rest, hits }));

  return { list, dropped };
}
