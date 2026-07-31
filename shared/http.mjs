/**
 * HTTP 基础设施：带超时的 JSON 请求、B 站游客 Cookie、并发池。
 * 同时运行于 Node 22 与 Cloudflare Workers（两者都有全局 fetch / AbortSignal）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

/** 带超时与一次重试的 JSON 请求。上游偶发抖动是常态，不重试就是给自己找茬。 */
export async function fetchJson(url, { headers = {}, timeoutMs = 12_000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 + attempt * 600));
    }
  }
  console.error(`[http] 请求失败 ${url.slice(0, 90)}: ${lastErr?.message}`);
  return null;
}

/**
 * B 站搜索接口要求携带 buvid3 Cookie（游客身份即可），否则返回错误页。
 * 访问首页拿一次 Set-Cookie，进程内缓存复用。
 */
let biliCookieCache = null;

export async function getBiliCookie() {
  if (biliCookieCache) return biliCookieCache;
  try {
    const res = await fetch('https://www.bilibili.com/', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    const cookies = [];
    // Workers 有 getSetCookie；Node undici 也支持
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of setCookies) {
      const kv = String(line).split(';')[0];
      if (/^(buvid3|buvid4|b_nut|bili_ticket)=/.test(kv)) cookies.push(kv);
    }
    biliCookieCache = cookies.join('; ');
  } catch {
    biliCookieCache = '';
  }
  return biliCookieCache;
}

export function biliHeaders(cookie) {
  return {
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

/**
 * 并发池：限制同时在途的请求数，返回所有成功结果的扁平数组。
 * 单个任务失败不影响整体 —— 聚合器的天职是「能拿多少拿多少」。
 */
export async function pooled(tasks, concurrency, run) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        const out = await run(task);
        if (Array.isArray(out)) results.push(...out);
      } catch (err) {
        console.error('[pool] 任务失败:', err?.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
