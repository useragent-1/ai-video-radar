/**
 * HTTP 基础设施：带超时的 JSON 请求、B 站游客 Cookie、并发池。
 * 同时运行于 Node 22 与 Cloudflare Workers（两者都有全局 fetch / AbortSignal）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

/** 带超时与一次重试的文本请求。返回 null 表示彻底失败。 */
export async function fetchText(url, { headers = {}, timeoutMs = 12_000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 + attempt * 600));
    }
  }
  console.error(`[http] 请求失败 ${url.slice(0, 90)}: ${lastErr?.message}`);
  return null;
}

/** 带超时与一次重试的 JSON 请求。上游偶发抖动是常态，不重试就是给自己找茬。 */
export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[http] JSON 解析失败 ${url.slice(0, 90)}: ${err.message}`);
    return null;
  }
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

/* ----------------------------------- WBI 签名 ----------------------------------- */
/**
 * B 站搜索 / 分区等 web 接口逐步强制 WBI 签名，缺签直接返回 412 风控页。
 * 签名 = md5(排序后的参数字符串 + mixinKey)，mixinKey 由 nav 下发的
 * img_key/sub_key 经固定置换表截取前 32 位得到。
 *
 * Cloudflare Workers 的 SubtleCrypto 没有 MD5，所以这里用一份纯 JS 实现，
 * Node 与 Workers 通用。nav 本身不签名即可拿到密钥，无鸡生蛋问题。
 */

/** 纯 JS MD5（小端字节序输出），Node + Workers 通用。 */
function md5Hex(str) {
  const rotateLeft = (l, s) => (l << s) | (l >>> (32 - s));
  const add = (x, y) => {
    const lo = (x & 0xffff) + (y & 0xffff);
    const hi = (x >> 16) + (y >> 16) + (lo >> 16);
    return (hi << 16) | (lo & 0xffff);
  };
  const cmn = (q, a, b, x, s, t) => {
    a = add(add(a, q), add(x, t));
    return add(rotateLeft(a, s), b);
  };
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const utf8 = new TextEncoder().encode(str);
  const len = utf8.length;
  const nblk = ((len + 8) >> 6) + 1;
  const blks = new Array(nblk * 16).fill(0);
  for (let i = 0; i < len; i++) blks[i >> 2] |= utf8[i] << ((i % 4) * 8);
  blks[len >> 2] |= 0x80 << ((len % 4) * 8);
  blks[nblk * 16 - 2] = len * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < nblk * 16; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    const r1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    for (let n = 0; n < 16; n++) { const x = blks[i + r1[n]]; a = ff(a, b, c, d, x, S[n % 4], K[n]); const t = a; a = d; d = c; c = b; b = t; }
    const r2 = [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12];
    for (let n = 0; n < 16; n++) { const x = blks[i + r2[n]]; a = gg(a, b, c, d, x, S[4 + (n % 4)], K[16 + n]); const t = a; a = d; d = c; c = b; b = t; }
    const r3 = [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2];
    for (let n = 0; n < 16; n++) { const x = blks[i + r3[n]]; a = hh(a, b, c, d, x, S[8 + (n % 4)], K[32 + n]); const t = a; a = d; d = c; c = b; b = t; }
    const r4 = [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9];
    for (let n = 0; n < 16; n++) { const x = blks[i + r4[n]]; a = ii(a, b, c, d, x, S[12 + (n % 4)], K[48 + n]); const t = a; a = d; d = c; c = b; b = t; }
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (n) => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      const v = (n >>> (i * 8)) & 0xff;
      s += ('0' + v.toString(16)).slice(-2);
    }
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 11, 13, 7, 34, 54, 29, 37,
  42, 49, 39, 4, 25, 33, 16, 20, 57, 17, 44, 36, 28, 9, 41, 61, 59, 60, 6, 55, 52, 62, 63, 56,
  1, 21, 12, 43, 38, 24, 51, 22, 19, 30, 48, 5, 58, 40, 14, 26,
];

let wbiMixinCache = null;

/** 从 nav 接口拿 wbi_img 密钥并算出 mixinKey，进程内缓存。 */
async function getWbiMixin(cookie) {
  if (wbiMixinCache !== null) return wbiMixinCache;
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    const img = String(json?.data?.wbi_img?.img_url || '').split('/').pop().split('.')[0];
    const sub = String(json?.data?.wbi_img?.sub_url || '').split('/').pop().split('.')[0];
    const raw = img + sub;
    let mixin = '';
    for (const i of MIXIN_KEY_ENC_TAB) mixin += raw[i] || '';
    wbiMixinCache = mixin.slice(0, 32);
  } catch {
    wbiMixinCache = '';
  }
  return wbiMixinCache;
}

/**
 * 对 B 站接口参数做 WBI 签名，返回完整 query 串（含 wts + w_rid）。
 * 拿不到密钥时返回 null —— 调用方应退化为无签名请求，保留历史可用路径。
 */
export async function wbiSignedQuery(params, cookie) {
  const mixin = await getWbiMixin(cookie);
  if (!mixin) return null;
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const chr = /[!'()*]/g;
  const query = Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(chr, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5Hex(query + mixin)}`;
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
