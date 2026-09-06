import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://platform.kimi.ai';
const targetUrl = `${baseUrl}/blog`;

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/moonshot/blog',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['platform.kimi.ai/blog', 'platform.moonshot.ai/blog', 'platform.kimi.ai/blog/posts/:slug', 'platform.moonshot.ai/blog/posts/:slug'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['vizmoe'],
    handler,
    url: 'platform.kimi.ai/blog',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

    const response = await ofetch(targetUrl);
    const $ = load(response);

    const list = $('a[href^="/blog/posts/"]')
        .toArray()
        .flatMap((element): DataItem[] => {
            const href = $(element).attr('href');
            const title = $(element).text().replaceAll(/\s+/g, ' ').trim();
            if (!href || href.endsWith('/changelog') || !title) {
                return [];
            }

            return [
                {
                    title,
                    link: new URL(href, baseUrl).href,
                },
            ];
        })
        .filter((item, index, items) => items.findIndex((other) => other.link === item.link) === index)
        .slice(0, limit);

    const item = await pMap(
        list,
        (entry) =>
            cache.tryGet(entry.link!, async () => {
                const detail = await ofetch(entry.link!);
                const $$ = load(detail);
                const article = $$('article').first();
                const title = article.find('h1').first().text() || entry.title;
                const published = article.find('time').first().attr('datetime') ?? article.find('time').first().text();
                const category = article
                    .find('a[href^="/blog/tags/"]')
                    .toArray()
                    .map((tag) => $$(tag).text().trim())
                    .filter(Boolean);
                article.find('h1').first().remove();
                article.find('time').first().closest('div').remove();

                return {
                    title,
                    link: entry.link,
                    description: article.html() ?? undefined,
                    pubDate: published ? parseDate(published) : undefined,
                    category: category.length > 0 ? category : undefined,
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: 'Moonshot AI Blogs',
        description: 'Blog posts from the Kimi / Moonshot AI open platform',
        link: targetUrl,
        language: 'en' as Language,
        item,
    };
}
