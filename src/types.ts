export interface VideoItem {
  id: string;
  platform: string;
  platformName: string;
  title: string;
  url: string;
  cover: string;
  author: string;
  authorUrl: string;
  publishedAt: string;
  publishedTs: number;
  duration: number;
  views: number;
  danmaku: number;
  replies: number;
  likes: number;
  description: string;
  topic: string;
  topicLabel: string;
  channel: string;
  via: string;
  score: number;
  hits: number;
}

export interface FeedMeta {
  generatedAt: string;
  durationMs: number;
  mode: 'full' | 'quick' | 'edge';
  stale: boolean;
  newSinceLastRun?: number;
  cacheAge?: number;
  servedBy?: 'edge' | 'snapshot';
  sourceStats?: Record<string, number>;
  dropped?: Record<string, number>;
  topics: { id: string; label: string }[];
  summary: {
    total: number;
    freshLast24h: number;
    byPlatform: Record<string, number>;
    byTopic: Record<string, number>;
  };
  note?: string;
}

export interface Feed {
  meta: FeedMeta;
  items: VideoItem[];
}

export type SortMode = 'smart' | 'latest' | 'hot';
export type WindowMode = '24h' | '72h' | '7d' | 'all';
