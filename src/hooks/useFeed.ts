import { useCallback, useEffect, useRef, useState } from 'react';
import type { Feed } from '../types';

/**
 * 双通道取数：优先走边缘实时接口，失败时回落到构建期静态快照。
 * 任何一侧可用，站点就有内容 —— 这是抓取型站点最容易被忽略的可用性设计。
 */
export function useFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => void (mounted.current = false), []);

  const load = useCallback(async (opts: { force?: boolean } = {}) => {
    const isRefresh = Boolean(opts.force);
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);

    const attempts: { url: string; servedBy: 'edge' | 'snapshot' }[] = [
      { url: `/api/feed${opts.force ? '?refresh=1' : ''}`, servedBy: 'edge' },
      { url: `/data/feed.json?t=${Math.floor(Date.now() / 60_000)}`, servedBy: 'snapshot' },
    ];

    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Feed;
        if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('空数据');
        if (!mounted.current) return;
        setFeed({ ...data, meta: { ...data.meta, servedBy: attempt.servedBy } });
        setLoading(false);
        setRefreshing(false);
        return;
      } catch {
        // 继续尝试下一个通道
      }
    }

    if (!mounted.current) return;
    setError('两条数据通道都没能取到内容。可能是网络问题，也可能是上游接口临时抽风。');
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { feed, loading, refreshing, error, reload: load };
}
