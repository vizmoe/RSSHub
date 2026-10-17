import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import RejectError from '@/errors/types/reject';
import type { Data, DataItem } from '@/types';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.tsdm39.com';

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

export async function getTsdmForumFeed(ctx: Context): Promise<Data> {
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
