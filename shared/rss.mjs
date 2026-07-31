/**
 * 极简 RSS / Atom 解析器。
 *
 * 为什么不用现成的 xml 库：Cloudflare Workers 没有 DOMParser，
 * 而 fast-xml-parser 之类会把 bundle 撑大一截。RSS 的结构足够规整，
 * 正则足以覆盖，代价是不支持 CDATA 嵌套等边角情况 —— 对聚合场景够用。
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', mdash: '—', hellip: '…', middot: '·',
};

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** 去标签 + 解实体 + 压空白，CDATA 包裹会被剥掉 */
export function clean(s = '') {
  return decodeEntities(
    String(s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 取第一个匹配标签的内容，兼容带命名空间与属性的写法 */
function pick(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  return re.exec(block)?.[1] ?? '';
}

/** Atom 的链接在属性里：<link href="..." /> */
function pickLink(block) {
  const plain = pick(block, 'link');
  if (plain && !/^\s*<;/.test(plain)) {
    const text = clean(plain);
    if (text.startsWith('http')) return text;
  }
  const href = /<link[^>]*\shref=["']([^"']+)["']/i.exec(block)?.[1];
  return href ? decodeEntities(href) : '';
}

function parseDate(raw) {
  if (!raw) return 0;
  const t = Date.parse(clean(raw));
  if (!Number.isNaN(t)) return Math.floor(t / 1000);
  return 0;
}

/**
 * 解析 RSS 2.0 / Atom，返回统一结构。
 * @returns {{title:string,link:string,description:string,publishedAt:number,author:string,cover:string}[]}
 */
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return [];

  const blocks =
    xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ||
    xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ||
    [];

  return blocks
    .map((b) => {
      const description =
        pick(b, 'description') || pick(b, 'summary') || pick(b, 'content:encoded') || pick(b, 'content');

      // 封面：优先 media 标签，其次正文里的第一张图
      const cover =
        /<media:(?:content|thumbnail)[^>]*\surl=["']([^"']+)["']/i.exec(b)?.[1] ||
        /<enclosure[^>]*\surl=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i.exec(b)?.[1] ||
        /<img[^>]*\ssrc=["']([^"']+)["']/i.exec(decodeEntities(description))?.[1] ||
        '';

      return {
        title: clean(pick(b, 'title')),
        link: pickLink(b),
        description: clean(description).slice(0, 300),
        publishedAt: parseDate(
          pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date'),
        ),
        author: clean(pick(b, 'dc:creator') || pick(b, 'author') || pick(b, 'source')),
        cover: cover ? decodeEntities(cover).replace(/^http:/, 'https:') : '',
      };
    })
    .filter((x) => x.title && x.link);
}
