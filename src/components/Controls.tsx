import { useEffect, useRef } from 'react';
import type { KindFilter, SortMode, WindowMode } from '../types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  topics: { id: string; label: string; count: number }[];
  activeTopic: string;
  onTopic: (id: string) => void;
  platforms: { id: string; label: string; count: number }[];
  activePlatform: string;
  onPlatform: (id: string) => void;
  kind: KindFilter;
  onKind: (v: KindFilter) => void;
  sort: SortMode;
  onSort: (v: SortMode) => void;
  timeWindow: WindowMode;
  onWindow: (v: WindowMode) => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'video', label: '视频' },
  { id: 'article', label: '资讯' },
];

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'smart', label: '综合' },
  { id: 'latest', label: '最新' },
  { id: 'hot', label: '最热' },
];

const WINDOWS: { id: WindowMode; label: string }[] = [
  { id: '24h', label: '24 时' },
  { id: '72h', label: '3 天' },
  { id: '7d', label: '7 天' },
  { id: 'all', label: '全部' },
];

export function Controls(p: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 「/」聚焦搜索，Esc 清空 —— 高频扫读场景值得一个快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && typing) {
        p.onQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  return (
    <div className="controls">
      <label className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder="搜索标题、UP 主、主题"
          aria-label="搜索"
        />
        {!p.query && <kbd>/</kbd>}
      </label>

      <div className="seg" role="group" aria-label="内容类型">
        {KINDS.map((k) => (
          <button key={k.id} aria-pressed={p.kind === k.id} onClick={() => p.onKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="排序方式">
        {SORTS.map((s) => (
          <button key={s.id} aria-pressed={p.sort === s.id} onClick={() => p.onSort(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="时间范围">
        {WINDOWS.map((w) => (
          <button key={w.id} aria-pressed={p.timeWindow === w.id} onClick={() => p.onWindow(w.id)}>
            {w.label}
          </button>
        ))}
      </div>

      <button
        className="icon-btn"
        onClick={p.onRefresh}
        data-busy={p.refreshing}
        title="重新抓取"
        aria-label="重新抓取"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>

      <button
        className="icon-btn"
        onClick={p.onTheme}
        title={p.theme === 'dark' ? '切到浅色' : '切到深色'}
        aria-label="切换配色"
      >
        {p.theme === 'dark' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>

      <div className="chips" role="group" aria-label="主题筛选">
        <button className="chip" aria-pressed={p.activeTopic === 'all'} onClick={() => p.onTopic('all')}>
          全部主题
        </button>
        {p.topics.map((t) => (
          <button
            key={t.id}
            className="chip"
            aria-pressed={p.activeTopic === t.id}
            onClick={() => p.onTopic(t.id)}
          >
            {t.label}
            <span className="chip__count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="chips chips--platform" role="group" aria-label="信源筛选">
        <button
          className="chip"
          aria-pressed={p.activePlatform === 'all'}
          onClick={() => p.onPlatform('all')}
        >
          全部信源
        </button>
        {p.platforms.map((s) => (
          <button
            key={s.id}
            className="chip"
            aria-pressed={p.activePlatform === s.id}
            onClick={() => p.onPlatform(s.id)}
          >
            {s.label}
            <span className="chip__count">{s.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
