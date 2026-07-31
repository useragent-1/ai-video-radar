/** 加载骨架、空状态、错误状态 —— 三种状态都要说人话 */

export function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="正在载入">
      {Array.from({ length: 7 }, (_, i) => (
        <div className="skeleton__row" key={i}>
          <div className="shimmer" style={{ aspectRatio: '16 / 10' }} />
          <div style={{ display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
            <div className="shimmer" style={{ height: '1.1rem', width: `${88 - i * 6}%` }} />
            <div className="shimmer" style={{ height: '0.8rem', width: '62%' }} />
            <div className="shimmer" style={{ height: '0.7rem', width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <div className="empty">
      <div className="empty__mark">◦</div>
      <h2>{query ? `没有匹配「${query}」的内容` : '当前筛选下没有内容'}</h2>
      <p>
        情报台只收录科技、知识、财经类分区里的 AI 内容，娱乐区的玩梗视频会被挡在门外。
        换个关键词，或者把时间范围放宽一些。
      </p>
      <button className="chip" onClick={onReset}>
        清空全部筛选
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty">
      <div className="empty__mark">✕</div>
      <h2>没能取到数据</h2>
      <p>{message}</p>
      <button className="chip" onClick={onRetry}>
        重试一次
      </button>
    </div>
  );
}
