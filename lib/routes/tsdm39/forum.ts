import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import RejectError from '@/errors/types/reject';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.tsdm39.com';

export const route: Route = {
    path: '/forum/:fid',
    name: '版块主题',
    categories: ['anime'],
    maintainers: ['vizmoe'],
    example: '/tsdm39/forum/31',
    parameters: {
        fid: '版块 ID，即版块页面 URL 中的 fid，例如 702（音乐）、716（EPUB 区）。',
    },
    features: {
        requireConfig: [
            {
                name: 'TSDM39_COOKIES',
                optional: true,
                description: '天使动漫论坛登录后请求中的 Cookie。公开版块可不配置；需要登录的版块（如 702）必须配置，且账号须有相应阅读权限。',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.tsdm39.com/forum.php'],
            target: (_, url) => {
                const params = new URL(url).searchParams;
                const fid = params.get('fid');
                return params.get('mod') === 'forumdisplay' && fid && /^[1-9]\d*$/.test(fid) ? `/tsdm39/forum/${fid}` : '';
            },
        },
    ],
    description: `按发帖时间获取版块第一页的新主题，默认最多 20 条，可使用 RSSHub 通用参数 \`limit\` 调整。订阅内容为首帖正文，正文范围取决于当前账号的阅读权限；单个主题权限不足时保留标题、链接和权限提示。

例如音乐版块 \`https://www.tsdm39.com/forum.php?mod=forumdisplay&fid=702&page=1\` 对应 \`/tsdm39/forum/702\`，EPUB 区对应 \`/tsdm39/forum/716\`。登录受限版块需在自建 RSSHub 中配置环境变量 \`TSDM39_COOKIES\`；Cookie 失效后需要更新。`,
    handler,
};

async function fetchPage(url: string, cookie: string | undefined) {
    const html = await ofetch(url, {
        responseType: 'text',
        headers: cookie ? { Cookie: cookie } : undefined,
    });
    const $ = load(html);
    const message = $('#messagetext').text().trim();

    if ($('#messagelogin, form[id^="loginform"]').length || /尚未登录|请先登录/.test(message)) {
        throw new ConfigNotFoundError(cookie ? '天使动漫论坛登录失效，请更新 TSDM39_COOKIES。' : '此版块或主题需要登录，请配置 TSDM39_COOKIES。');
    }
    if (message) {
        throw new RejectError('天使动漫论坛拒绝访问，请确认版块或主题存在，且 TSDM39_COOKIES 对应的账号有阅读权限。');
    }

    return $;
}

function parseForumDate(value: string | undefined) {
    if (!value) {
        return;
    }
    const date = parseDate(`${value.replace(/^发表于\s*/, '').trim()} +0800`, ['YYYY-M-D HH:mm:ss ZZ', 'YYYY-M-D HH:mm ZZ', 'YYYY-M-D ZZ']);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

async function handler(ctx: Context): Promise<Data> {
    const fid = ctx.req.param('fid');
    if (!fid || !/^[1-9]\d*$/.test(fid)) {
        throw new InvalidParameterError('版块 ID 必须为正整数。');
    }

    const link = `${rootUrl}/forum.php?mod=forumdisplay&fid=${fid}`;
    const cookie = config.tsdm39.cookie;
    const $ = await fetchPage(`${link}&filter=author&orderby=dateline&page=1`, cookie);
    const threads = new Map<string, DataItem & { link: string }>();

    $('tbody[id^="normalthread_"], tbody.tsdm_normalthread').each((_, row) => {
        const $row = $(row);
        const title = $row.find('a.xst').first();
        const href = title.attr('href');
        if (!href) {
            return;
        }

        const url = new URL(href, rootUrl);
        const tid = url.searchParams.get('tid') || url.pathname.match(/^\/thread-(\d+)-/)?.[1];
        if (!tid || !/^\d+$/.test(tid) || threads.has(tid)) {
            return;
        }

        const author = $row.find('td.by').first();
        const date = author.find('em');
        threads.set(tid, {
            title: title.text(),
            link: `${rootUrl}/forum.php?mod=viewthread&tid=${tid}`,
            author: author.find('cite').text().trim() || undefined,
            pubDate: parseForumDate(date.find('[title]').first().attr('title') || date.text()),
            category: $row
                .find('th em a')
                .toArray()
                .map((element) => $(element).text().trim())
                .filter(Boolean),
        });
    });

    const requestedLimit = Number(ctx.req.query('limit'));
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const items = await pMap(
        threads.values().take(limit).toArray(),
        async (item) => {
            try {
                const detail = await cache.tryGet(`tsdm39:thread:${md5(cookie || '')}:${item.link}`, async () => {
                    const $ = await fetchPage(`${item.link}&page=1`, cookie);
                    const post = $('#postlist [id^="postmessage_"]').first();
                    const content = post.length ? post : $('#postlist .locked').first();
                    if (!content.length) {
                        throw new Error('未找到天使动漫论坛首帖正文，请检查主题的阅读权限或页面结构。');
                    }

                    content.find('script, style').remove();
                    content.find('img').each((_, image) => {
                        const $image = $(image);
                        const src = $image.attr('file') || $image.attr('zoomfile') || $image.attr('src');
                        if (src) {
                            $image.attr('src', new URL(src, rootUrl).href);
                        }
                        $image.removeAttr('file zoomfile');
                    });
                    content.find('a[href]').each((_, anchor) => {
                        const $anchor = $(anchor);
                        $anchor.attr('href', new URL($anchor.attr('href')!, rootUrl).href);
                    });

                    const date = $('[id^="authorposton"]').first();
                    const pubDate = parseForumDate(date.find('[title]').first().attr('title') || date.text());
                    return {
                        description: content.html() ?? undefined,
                        ...(pubDate && { pubDate }),
                    };
                });
                return { ...item, ...detail };
            } catch (error) {
                if (error instanceof RejectError) {
                    return { ...item, description: '当前账号无法阅读此主题正文，请在论坛查看权限要求。' };
                }
                throw error;
            }
        },
        { concurrency: 3 }
    );

    return {
        title: `天使动漫论坛 - ${$('h1 a').first().text().trim() || $('title').text().split(' - ', 1)[0].trim()}`,
        link,
        language: 'zh-CN',
        item: items,
    };
}
