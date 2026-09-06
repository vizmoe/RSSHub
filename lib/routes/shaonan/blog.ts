import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

const baseUrl = 'https://shaonan.blog';

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/shaonan/blog',
    radar: [
        {
            source: ['shaonan.blog', 'shaonan.blog/posts/:slug', 'shaonan.blog/jiguangpianyu/:slug', 'shaonan.blog/duanzhang/:slug'],
            target: '/blog',
        },
    ],
    name: '全文',
    maintainers: ['vizmoe'],
    handler,
    url: 'shaonan.blog',
    description: '官方 RSS 仅提供摘要，此路由补全文章正文和图片，包含普通文章、年度总结和断章。默认返回最新 20 篇，可使用通用参数 `limit` 调整数量。',
    view: ViewType.Articles,
};

async function handler(ctx: Context): Promise<Data> {
    const xml = await ofetch(`${baseUrl}/index.xml`);
    const feed = await parser.parseString(xml);
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const list = feed.items.filter((item) => item.link && /^https:\/\/shaonan\.blog\/(?:posts|jiguangpianyu|duanzhang)\//.test(item.link)).slice(0, limit);

    const item = await pMap(
        list,
        (entry) =>
            cache.tryGet(entry.link!, async () => {
                const html = await ofetch(entry.link!);
                const $ = load(html);
                const content = $('.post-content').first();
                if (!content.length || !content.text().trim()) {
                    throw new Error(`Article content is missing at ${entry.link}; the site layout may have changed.`);
                }

                content.find('.anchor').remove();
                const cover = $('figure.entry-cover').first();
                const published = entry.isoDate || entry.pubDate;

                return {
                    title: entry.title ?? '',
                    link: entry.link,
                    description: (cover.length ? $.html(cover) : '') + content.html(),
                    pubDate: published ? parseDate(published) : undefined,
                    author: $('meta[name="author"]').attr('content') || entry.creator || entry.author,
                    category: $('.post-tags a')
                        .toArray()
                        .map((tag) => $(tag).text()),
                    image: $('meta[property="og:image"]').attr('content'),
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: feed.title ?? '少楠的松节油',
        link: `${baseUrl}/`,
        description: feed.description,
        language: 'zh-CN',
        item,
    };
}
