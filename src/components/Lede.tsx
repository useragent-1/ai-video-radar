import type { VideoItem } from '../types';
import { formatCount, relativeTime } from '../lib/format';

/** 头版区：综合分最高的几条，用报纸头条的排版权重呈现 */
export function Lede({ items }: { items: VideoItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="lede" aria-label="头条">
      {items.map((item, i) => (
        <a
          key={item.id}
          className="lede__item"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="lede__figure">
            <span className="lede__rank">{String(i + 1).padStart(2, '0')}</span>
            <img
              src={item.cover}
              alt=""
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </div>
          <h2 className="lede__title">{item.title}</h2>
          <div className="entry__meta">
            <span className="tag tag--topic">{item.topicLabel}</span>
            <span className="entry__author">{item.author}</span>
            <span className="sep">/</span>
            <span className="num">{formatCount(item.views)} 播放</span>
            <span className="sep">/</span>
            <time dateTime={item.publishedAt}>{relativeTime(item.publishedAt)}</time>
          </div>
        </a>
      ))}
    </section>
  );
}
