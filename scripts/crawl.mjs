#!/usr/bin/env node
/**
 * 离线抓取入口 —— 由 GitHub Actions 定时调用，产出 public/data/feed.json。
 * 这是双通道数据流的「慢通道」：即使 Worker 实时抓取被风控拦下，站点仍有可用快照。
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, refine } from '../shared/sources.mjs';
import { TOPICS } from '../shared/taxonomy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/data/feed.json');
const quick = process.argv.includes('--quick');

/** 读取上一版快照，用于失败兜底与增量对比 */
async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

function summarize(items) {
  const byPlatform = {};
  const byTopic = {};
  for (const it of items) {
    byPlatform[it.platformName] = (byPlatform[it.platformName] || 0) + 1;
    byTopic[it.topic] = (byTopic[it.topic] || 0) + 1;
  }
  const dayAgo = Date.now() - 86400_000;
  return {
    total: items.length,
    freshLast24h: items.filter((i) => new Date(i.publishedAt).getTime() > dayAgo).length,
    byPlatform,
    byTopic,
  };
}

async function main() {
  const started = Date.now();
  console.log(`[crawl] 启动${quick ? '（quick 模式）' : ''} — ${new Date().toISOString()}`);

  const { items: raw, stats } = await collectAll({ quick });
  console.log('[crawl] 各入口原始产出:', stats, `合计 ${raw.length}`);

  const { list: items, dropped } = refine(raw);
  console.log(`[crawl] 保留 ${items.length} 条；过滤明细:`, dropped);

  const previous = await readPrevious();

  // 抓取全面失败时保留旧快照，绝不用空数据覆盖线上内容
  if (items.length === 0) {
    if (previous?.items?.length) {
      console.error('[crawl] 本次零产出，保留上一版快照并标记为 stale');
      previous.meta.stale = true;
      previous.meta.lastAttemptAt = new Date().toISOString();
      await writeFile(OUT, JSON.stringify(previous));
      return;
    }
    throw new Error('抓取零产出且无历史快照可回退');
  }

  const knownIds = new Set(previous?.items?.map((i) => i.id) ?? []);
  const newCount = previous ? items.filter((i) => !knownIds.has(i.id)).length : items.length;

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      mode: quick ? 'quick' : 'full',
      stale: false,
      newSinceLastRun: newCount,
      sourceStats: stats,
      dropped,
      topics: TOPICS,
      summary: summarize(items),
      note: '抖音 / 快手 / 西瓜 / 腾讯视频 / 爱奇艺 的开放接口需要私有签名或登录态，暂无法稳定接入。',
    },
    items,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload));
  console.log(
    `[crawl] 完成：${items.length} 条（新增 ${newCount}），24h 内 ${payload.meta.summary.freshLast24h} 条，` +
      `耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error('[crawl] 失败:', err.message);
  process.exit(1);
});
