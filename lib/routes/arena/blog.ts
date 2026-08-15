import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://arena.ai';
const targetUrl = `${baseUrl}/blog`;

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/arena/blog',
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
            source: ['arena.ai/blog', 'arena.ai/blog/:slug'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['vizmoe'],
    handler,
    url: 'arena.ai/blog',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

    const response = await ofetch(targetUrl);
    const $ = load(response);

    const list = $('a[href^="/blog/"]')
        .toArray()
        .flatMap((element): DataItem[] => {
            const href = $(element).attr('href');
            if (!href) {
                return [];
            }
            const pathname = new URL(href, baseUrl).pathname.replace(/\/$/, '');
            if (pathname === '/blog' || pathname.startsWith('/blog/category')) {
                return [];
            }

            return [
                {
                    title: pathname.split('/').pop() ?? href,
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
                const body = $$('[class*="postBody"]').first();
                body.find('nav, aside').remove();
                const published = $$('meta[property="article:published_time"]').attr('content');

                return {
                    title: $$('h1').first().text() || $$('meta[property="og:title"]').attr('content') || entry.title,
                    link: entry.link,
                    description: body.html() ?? undefined,
                    pubDate: published ? parseDate(published) : undefined,
                    image: $$('meta[property="og:image"]').attr('content'),
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: 'Arena Blog',
        description: 'Latest updates, research, and leaderboard changes from Arena',
        link: targetUrl,
        language: 'en' as Language,
        item,
    };
}
