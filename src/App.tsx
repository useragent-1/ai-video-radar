import { useEffect, useMemo, useState } from 'react';
import { useFeed } from './hooks/useFeed';
import { Masthead } from './components/Masthead';
import { Controls } from './components/Controls';
import { Lede } from './components/Lede';
import { Entry } from './components/Entry';
import { Trends } from './components/Trends';
import { Coverage } from './components/Coverage';
import { Empty, ErrorState, Skeleton } from './components/States';
import { dayLabel } from './lib/format';
import type { KindFilter, SortMode, VideoItem, WindowMode } from './types';

const PAGE = 40;
const WINDOW_MS: Record<WindowMode, number> = {
  '24h': 86_400_000,
  '72h': 3 * 86_400_000,
  '7d': 7 * 86_400_000,
  all: Number.POSITIVE_INFINITY,
};

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('radar-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('radar-theme', theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

/** 输入防抖：搜索时避免每个按键都重算整份列表 */
function useDebounced<T>(value: T, delay = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function App() {
  const { feed, loading, refreshing, error, reload } = useFeed();
  const { theme, toggle } = useTheme();

  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [tutorialOnly, setTutorialOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('smart');
  const [timeWindow, setTimeWindow] = useState<WindowMode>('all');
  const [page, setPage] = useState(1);

  const debouncedQuery = useDebounced(query);

  useEffect(
    () => setPage(1),
    [debouncedQuery, topic, platform, kind, tutorialOnly, sort, timeWindow],
  );

  const items = feed?.items ?? [];

  const topics = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const it of items) {
      const cur = counts.get(it.topic);
      if (cur) cur.count += 1;
      else counts.set(it.topic, { label: it.topicLabel, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const platforms = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const it of items) {
      const cur = counts.get(it.platform);
      if (cur) cur.count += 1;
      else counts.set(it.platform, { label: it.platformName, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const cutoff = Date.now() - WINDOW_MS[timeWindow];

    const list = items.filter((it) => {
      if (topic !== 'all' && it.topic !== topic) return false;
      if (platform !== 'all' && it.platform !== platform) return false;
      if (kind !== 'all' && it.kind !== kind) return false;
      if (tutorialOnly && !it.isTutorial) return false;
      if (new Date(it.publishedAt).getTime() < cutoff) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.author.toLowerCase().includes(q) ||
        it.platformName.toLowerCase().includes(q) ||
        it.topicLabel.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q)
      );
    });

    const sorters: Record<SortMode, (a: VideoItem, b: VideoItem) => number> = {
      smart: (a, b) => b.score - a.score,
      latest: (a, b) => b.publishedTs - a.publishedTs,
      // 文章没有播放量，按最热排时让它们退到视频之后，而不是混在中间显示 0
      hot: (a, b) => b.views - a.views,
    };
    return [...list].sort(sorters[sort]);
  }, [items, debouncedQuery, topic, platform, kind, tutorialOnly, sort, timeWindow]);

  const tutorialCount = useMemo(() => items.filter((it) => it.isTutorial).length, [items]);

  const noFilters =
    !debouncedQuery &&
    topic === 'all' &&
    platform === 'all' &&
    kind === 'all' &&
    !tutorialOnly &&
    timeWindow === 'all' &&
    sort === 'smart';
  const lede = noFilters ? filtered.slice(0, 4) : [];
  const rest = filtered.slice(lede.length);
  const paged = rest.slice(0, page * PAGE);

  // 按自然日分组，形成时间刻度轴
  const groups = useMemo(() => {
    const map = new Map<string, { main: string; sub: string; items: VideoItem[] }>();
    for (const it of paged) {
      const { key, main, sub } = dayLabel(it.publishedAt);
      const g = map.get(key);
      if (g) g.items.push(it);
      else map.set(key, { main, sub, items: [it] });
    }
    return [...map.entries()];
  }, [paged]);

  const resetAll = () => {
    setQuery('');
    setTopic('all');
    setPlatform('all');
    setKind('all');
    setTutorialOnly(false);
    setSort('smart');
    setTimeWindow('all');
  };

  return (
    <div className="shell">
      <Masthead meta={feed?.meta ?? null} visible={filtered.length} />

      <Trends trends={feed?.trends ?? []} />

      <Controls
        query={query}
        onQuery={setQuery}
        topics={topics}
        activeTopic={topic}
        onTopic={setTopic}
        platforms={platforms}
        activePlatform={platform}
        onPlatform={setPlatform}
        kind={kind}
        onKind={setKind}
        tutorialOnly={tutorialOnly}
        onTutorialOnly={setTutorialOnly}
        tutorialCount={tutorialCount}
        sort={sort}
        onSort={setSort}
        timeWindow={timeWindow}
        onWindow={setTimeWindow}
        theme={theme}
        onTheme={toggle}
        onRefresh={() => reload({ force: true })}
        refreshing={refreshing}
      />

      <main className="main">
        {feed?.meta.stale && (
          <div className="notice">
            <strong>上游抓取暂时失败。</strong>
            当前展示的是上一次成功抓取的快照，内容可能不是最新的。
          </div>
        )}

        {loading && <Skeleton />}
        {!loading && error && <ErrorState message={error} onRetry={() => reload()} />}

        {!loading && !error && filtered.length === 0 && (
          <Empty query={debouncedQuery} onReset={resetAll} />
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <Lede items={lede} />

            <div className="stream">
              {groups.map(([key, g]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <div className="stream__tick">
                    <b>{g.main}</b>
                    <span>{g.sub}</span>
                  </div>
                  <div className="stream__group">
                    {g.items.map((it) => (
                      <Entry key={it.id} item={it} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {paged.length < rest.length && (
              <button className="load-more" onClick={() => setPage((p) => p + 1)}>
                继续加载 · 还有 {rest.length - paged.length} 条
              </button>
            )}
          </>
        )}
      </main>

      <Coverage meta={feed?.meta ?? null} />

      <footer className="colophon">
        <p>
          <strong>数据说明。</strong>
          视频来自哔哩哔哩（搜索 + 分区最新投稿）、AcFun、爱奇艺（科技与资讯频道）的公开接口；
          资讯来自量子位、雷峰网、IT 之家、爱范儿、钛媒体、少数派的公开订阅源；
          风向条取自哔哩哔哩与微博热搜中的 AI 相关词条。每小时自动抓取一次，
          页面上的「重新抓取」会触发边缘实时拉取。
        </p>
        <p>
          抖音与西瓜视频需要 a_bogus 签名，快手要过滑块验证，腾讯视频搜索接口需签名，
          优酷与好看视频直接判爬虫 —— 这些平台在无凭证环境下拿不到数据，
          已在上方「覆盖」里如实列出并给了站内搜索直达入口。与其伪装覆盖，不如把话说清楚。
        </p>
        {feed?.meta.dropped && (
          <p>
            上一轮抓取共剔除{' '}
            <span className="num">
              {Object.values(feed.meta.dropped).reduce((a, b) => a + b, 0)}
            </span>{' '}
            条：其中娱乐区玩梗 <span className="num">{feed.meta.dropped.offtopic ?? 0}</span> 条、
            无关内容 <span className="num">{feed.meta.dropped.irrelevant ?? 0}</span> 条、
            引流营销 <span className="num">{feed.meta.dropped.spam ?? 0}</span> 条。
          </p>
        )}
        <p>
          所有内容版权归原作者与平台所有，本站仅做标题与链接的索引聚合，不存储、不转码任何视频文件。
        </p>
      </footer>
    </div>
  );
}
