/**
 * 各平台适配器。每个适配器把平台原始结构映射成统一的 Item。
 *
 * 关于覆盖范围的诚实说明：
 * 抖音、西瓜需要 a_bogus 签名，快手要过滑块验证，腾讯视频搜索接口返回
 * ret 10401，优酷 / 搜狐 / 好看视频直接判爬虫 —— 无凭证环境下都拿不到数据。
 * 实测可稳定抓取的视频平台是 B 站、AcFun、爱奇艺三家，
 * 再用 AI 垂直媒体 RSS 补齐「文字情报」，用热搜接口补齐「风向」。
 * 抓不到的平台在 WALLED_PLATFORMS 里如实列出并给直达入口，不假装覆盖。
 */

import { fetchJson, fetchText, getBiliCookie, biliHeaders, pooled } from './http.mjs';
import { parseFeed } from './rss.mjs';
import {
  SEARCH_KEYWORDS,
  BILI_ZONES,
  MEDIA_FEEDS,
  IQIYI_CHANNELS,
  iqiyiChannelName,
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
    /** video = 视频平台内容，article = 媒体图文。前端按此分栏 */
    kind: raw.kind || 'video',
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
    /** 让适配器自己声明可信度，避免 B 站分区表被套用到别的平台上 */
    tierHint: raw.tierHint || '',
    /** 媒体源权重，参与排序 */
    weight: raw.weight || 1,
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

/**
 * 排行榜源已停用。
 *
 * ranking/v2 现在走 WBI 风控，无签名直接返回 code -352。补签名需要 MD5，
 * 而 Workers 的 SubtleCrypto 只提供 SHA 系列，得手写一份 MD5 塞进边缘包体。
 * 权衡下来不值：排行榜给的是「高热度」，而本站主打「最新」，
 * 搜索源（按 pubdate 排序）已经覆盖了同一批内容。保留函数供日后需要时启用。
 */
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

/* ---------------------------------- 爱奇艺 ---------------------------------- */

/**
 * 爱奇艺搜索。html5 端点无需签名，是三大长视频平台里唯一还能直连的。
 *
 * 两个坑：
 * 1. sortType 参数实测无效，返回顺序恒定按相关度，所以「最新」只能靠 refine 阶段按时间筛。
 * 2. 结果里混着大量盗版网课与蹭标签的短剧，靠频道白名单在源头拦掉，
 *    只放行「科技」「资讯」两个频道。
 */
async function iqiyiSearch(keyword) {
  const url =
    'https://search.video.iqiyi.com/o?if=html5&pageNum=1&pageSize=30&key=' +
    encodeURIComponent(keyword);
  const json = await fetchJson(url, { headers: { Referer: 'https://www.iqiyi.com/' } });
  const docs = json?.data?.docinfos;
  if (!Array.isArray(docs)) return [];

  const out = [];
  for (const doc of docs) {
    const album = doc?.albumDocInfo;
    if (!album) continue;

    const channel = iqiyiChannelName(album.channel);
    if (!IQIYI_CHANNELS.has(channel)) continue;

    // 一个 album 可能挂多集，只取前两条，避免长剧集霸屏
    for (const v of (album.videoinfos || []).slice(0, 2)) {
      const iso = v.initialIssueTime;
      if (!iso) continue;
      // 接口返回北京时间且不带时区，显式补 +08:00，否则会被当成 UTC 差 8 小时
      const ts = Math.floor(Date.parse(iso.replace(' ', 'T') + '+08:00') / 1000);
      if (!ts || Number.isNaN(ts)) continue;

      out.push(
        makeItem({
          platform: 'iqiyi',
          platformName: '爱奇艺',
          nativeId: String(v.tvId || v.qipu_id || v.vid),
          title: v.itemTitle || album.albumTitle,
          description: album.description || '',
          url: String(v.itemLink || album.albumLink || '').replace(/^http:/, 'https:'),
          cover: v.itemHImage || v.itemVImage || album.albumImg,
          author: v.uploader_name || '',
          authorUrl: v.uploader_id ? `https://www.iqiyi.com/u/${v.uploader_id}` : '',
          publishedAt: ts,
          duration: v.timeLength || 0,
          views: 0, // 搜索接口不返回播放量
          channel,
          tierHint: 'core', // 已经过频道白名单，视同核心分区
          via: `搜索·${keyword}`,
        }),
      );
    }
  }
  return out;
}

/* -------------------------------- 资讯媒体 RSS -------------------------------- */

/** 媒体 RSS → 统一 Item。媒体本身就是强意图信号，tierHint 给 core。 */
async function mediaFeed(feed) {
  const xml = await fetchText(feed.url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
  });
  if (!xml) return [];

  return parseFeed(xml)
    .filter((e) => e.publishedAt > 0 && isAiRelated(e.title, e.description))
    .map((e) =>
      makeItem({
        platform: feed.id,
        platformName: feed.name,
        kind: 'article',
        nativeId: e.link.replace(/[?#].*$/, '').slice(-64),
        title: e.title,
        description: e.description,
        // 去掉 utm 追踪参数，同一篇文章不同入口才能正确去重
        url: e.link.replace(/[?&]utm_[^&]+/g, '').replace(/\?$/, ''),
        cover: e.cover,
        author: e.author || feed.name,
        publishedAt: e.publishedAt,
        tierHint: 'core',
        weight: feed.weight ?? 1,
        via: '媒体订阅',
      }),
    );
}

/* --------------------------------- 热搜风向 --------------------------------- */

/**
 * 热搜榜只用来回答「此刻大家在聊什么 AI」，不进主 Feed。
 * 它的价值在于捕捉那些还没有人做成视频、但已经在发酵的话题。
 */
async function biliTrending() {
  const json = await fetchJson(
    'https://api.bilibili.com/x/web-interface/search/square?limit=30',
    { headers: biliHeaders('') },
  );
  const list = json?.data?.trending?.list;
  if (!Array.isArray(list)) return [];

  return list
    .filter((x) => isAiRelated(x.keyword || x.show_name))
    .map((x, i) => ({
      source: '哔哩哔哩',
      keyword: x.show_name || x.keyword,
      rank: i + 1,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(x.keyword)}`,
    }));
}

async function weiboTrending() {
  const json = await fetchJson('https://weibo.com/ajax/side/hotSearch', {
    headers: { Referer: 'https://weibo.com/' },
  });
  const list = json?.data?.realtime;
  if (!Array.isArray(list)) return [];

  return list
    .filter((x) => isAiRelated(x.word || x.note))
    .map((x) => ({
      source: '微博',
      keyword: x.word_scheme || x.word,
      rank: x.rank ?? 0,
      heat: x.raw_hot || x.num || 0,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(x.word)}`,
    }));
}

/** 抓热搜。失败不影响主流程，返回空数组即可。 */
export async function collectTrends() {
  const results = await Promise.allSettled([biliTrending(), weiboTrending()]);
  const trends = [];
  for (const r of results) if (r.status === 'fulfilled') trends.push(...r.value);
  // 同一话题两个平台都上榜时保留热度更高的那条
  const seen = new Map();
  for (const t of trends) {
    const key = t.keyword.toLowerCase().replace(/\s+/g, '');
    const prev = seen.get(key);
    if (!prev || (t.heat || 0) > (prev.heat || 0)) seen.set(key, t);
  }
  return [...seen.values()].slice(0, 24);
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

  // 爱奇艺搜索结果按相关度返回且噪音重，只用最能命中情报类内容的几个词
  const iqiyiKeywords = ['人工智能', '大模型', 'AI芯片', 'AI应用', 'DeepSeek', 'ChatGPT'].slice(
    0,
    quick ? 3 : 6,
  );

  const tasks = [
    ...keywords.map((kw) => () => biliSearch(kw, cookie).then((r) => track('bili_search', r))),
    ...(quick ? [] : BILI_ZONES).map(
      (z) => () => biliZone(z, cookie).then((r) => track('bili_zone', r)),
    ),
    // 排行榜见 biliRanking 上方说明，已停用，不再浪费 3 次必失败的请求
    ...keywords.slice(0, quick ? 3 : 8).map(
      (kw) => () => acfunSearch(kw).then((r) => track('acfun', r)),
    ),
    ...iqiyiKeywords.map((kw) => () => iqiyiSearch(kw).then((r) => track('iqiyi', r))),
    ...MEDIA_FEEDS.map((f) => () => mediaFeed(f).then((r) => track(`media_${f.id}`, r))),
  ];

  const raw = await pooled(tasks, 8, (task) => task());
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

  // 媒体文章没有播放量，若按视频口径算热度会被系统性压到底部。
  // 它们的价值在时效与信源本身，因此给一个由信源权重决定的基础热度。
  // 基准值取 2.8，大致对应一个十万播放量级视频，这样量子位这类高权重信源
  // 能跟中部视频正面竞争，而不是永远沉在第 200 名之后。
  const heat =
    item.kind === 'article'
      ? 2.8 * (item.weight || 1)
      : Math.log10(1 + item.views) * 1.0 +
        Math.log10(1 + item.danmaku) * 0.6 +
        Math.log10(1 + item.replies) * 0.5;

  let modifier = 1;
  if (item.kind !== 'article' && item.duration > 0 && item.duration < 30) modifier *= 0.65; // 过短多为切片搬运
  if (item.noise === 1) modifier *= 0.55; // 软噪音：资源分发、标题党
  if (item.relevance >= 2) modifier *= 1.12; // 标题强信号
  if (item.tier === 'neutral') modifier *= 0.75; // 中性分区可信度较低
  modifier *= 1 + Math.min(item.hits - 1, 3) * 0.08; // 多入口命中说明确实在被讨论

  return (freshness * 6 + heat * 0.9) * modifier;
}

/**
 * 首屏多样性重排。
 *
 * B 站条目占了总量的八成，纯按分数排会让前十条清一色是 B 站，
 * 「全网聚合」的价值就没了。这里做一次滑动窗口约束：
 * 任意连续 window 条里，同一平台最多占 maxPerWindow 条，
 * 超了就把后面其它平台的内容提上来。分数序在窗口内仍然保持。
 */
function diversify(list, { window = 6, maxPerWindow = 3 } = {}) {
  const out = [];
  const pending = list.slice();

  while (pending.length) {
    let pick = pending.findIndex((item) => {
      const recent = out.slice(-window);
      return recent.filter((x) => x.platform === item.platform).length < maxPerWindow;
    });
    // 剩下的全是同一平台，只能按原序继续
    if (pick === -1) pick = 0;
    out.push(pending.splice(pick, 1)[0]);
  }
  return out;
}

/**
 * 去重 → 相关性过滤 → 噪音治理 → 打分排序 → 多样性重排。
 * 过滤统计会一并返回，方便在站点上透明展示「筛掉了什么」。
 */
export function refine(items, { maxAgeDays = 21, limit = 300 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - maxAgeDays * 24 * HOUR;
  const seen = new Map();
  const titleIndex = new Map();
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

    // 同一篇报道常被多家媒体转载，标题高度相似。按归一化标题再去一次重，
    // 否则首屏容易被同一条新闻的五个版本占满。
    const titleKey = item.title.toLowerCase().replace(/[\s\p{P}]/gu, '').slice(0, 28);

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

    // 跨平台同题去重：B 站搬运号与媒体转载经常撞题
    const byTitle = titleIndex.get(titleKey);
    if (byTitle) {
      dropped.duplicate++;
      byTitle.hits += 1;
      continue;
    }

    const entry = { ...item, hits: 1, noise, relevance, tier };
    seen.set(item.id, entry);
    if (titleKey.length >= 10) titleIndex.set(titleKey, entry);
  }

  const ranked = [...seen.values()]
    .map((item) => ({ ...item, score: Number(score(item, now).toFixed(3)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const list = diversify(ranked)
    // 内部判定字段不下发，省流量也免得前端误用
    .map(({ noise, relevance, tier, tierHint, weight, hits, ...rest }) => ({ ...rest, hits }));

  return { list, dropped };
}
