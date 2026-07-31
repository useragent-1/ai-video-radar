import type { FeedMeta } from '../types';
import { absoluteTime } from '../lib/format';

/** 报头：刊名、期号信息、核心统计 */
export function Masthead({ meta, visible }: { meta: FeedMeta | null; visible: number }) {
  const today = new Date();
  const dateLine = today.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <header className="masthead">
      <div className="masthead__top">
        <span>每小时自动更新 · 双通道容灾</span>
        <span>{dateLine}</span>
      </div>

      <h1 className="masthead__title">
        AI 视频<em>情报台</em>
      </h1>
      <p className="masthead__sub">
        聚合中文视频平台的最新 AI 内容 —— 模型发布、AIGC 创作、Agent 应用、具身智能、芯片算力，
        经三层过滤剔除玩梗与引流内容。
      </p>

      <div className="masthead__bar">
        <div className="stats">
          <div className="stat">
            <span className="stat__value">{meta?.summary.total ?? '—'}</span>
            <span className="stat__label">收录条目</span>
          </div>
          <div className="stat">
            <span className="stat__value stat__value--live">
              {meta?.summary.freshLast24h ?? '—'}
            </span>
            <span className="stat__label">24 时内新发</span>
          </div>
          <div className="stat">
            <span className="stat__value">{visible}</span>
            <span className="stat__label">当前可见</span>
          </div>
          <div className="stat">
            <span className="stat__value">
              {meta ? Object.keys(meta.summary.byPlatform).length : '—'}
            </span>
            <span className="stat__label">数据源</span>
          </div>
        </div>

        {meta && (
          <div style={{ fontSize: '0.72rem', color: 'var(--ink-faint)', textAlign: 'right' }}>
            <div>
              数据截至 <time dateTime={meta.generatedAt}>{absoluteTime(meta.generatedAt)}</time>
            </div>
            <div>
              {meta.servedBy === 'edge' ? '边缘实时通道' : '静态快照通道'}
              {typeof meta.cacheAge === 'number' && ` · 缓存 ${Math.round(meta.cacheAge / 60)} 分钟`}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
