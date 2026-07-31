import type { VideoItem } from '../types';
import { formatCount, formatDuration, relativeTime } from '../lib/format';

const FRESH_MS = 6 * 3600_000;

/** 时间流中的单条条目 */
export function Entry({ item }: { item: VideoItem }) {
  const fresh = Date.now() - new Date(item.publishedAt).getTime() < FRESH_MS;

  return (
    <article className="entry" data-fresh={fresh}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img
          className="entry__thumb"
          src={item.cover}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </a>

      <div className="entry__body">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <h3 className="entry__title">{item.title}</h3>
        </a>

        {item.description && <p className="entry__desc">{item.description}</p>}

        <div className="entry__meta">
          <span className="tag tag--topic">{item.topicLabel}</span>
          <span className="tag tag--platform">{item.platformName}</span>
          {item.duration > 0 && <span className="dur num">{formatDuration(item.duration)}</span>}
          <a
            className="entry__author"
            href={item.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.author}
          </a>
          <span className="sep">/</span>
          <span className="num">{formatCount(item.views)} 播放</span>
          {item.danmaku > 0 && (
            <>
              <span className="sep">/</span>
              <span className="num">{formatCount(item.danmaku)} 弹幕</span>
            </>
          )}
          <span className="sep">/</span>
          <time dateTime={item.publishedAt} title={item.via}>
            {relativeTime(item.publishedAt)}
          </time>
        </div>
      </div>
    </article>
  );
}
