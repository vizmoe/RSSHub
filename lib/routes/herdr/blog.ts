import { load } from 'cheerio';
import pMap from 'p-map';

import type { Data, DataItem, Language, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://herdr.dev';
const targetUrl = `${baseUrl}/blog/`;

export const route: Route = {
    path: '/blog',
    categories: ['programming'],
    example: '/herdr/blog',
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
            source: ['herdr.dev/blog', 'herdr.dev/blog/:slug'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['vizmoe'],
    handler,
    url: 'herdr.dev/blog',
    view: ViewType.Articles,
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

    const response = await ofetch(targetUrl);
    const $ = load(response);

    const list = $('.posts a[href^="/blog/"]')
        .toArray()
        .flatMap((element): DataItem[] => {
            const $element = $(element);
            const href = $element.attr('href');
            const title = $element.find('h2').first().text();
            if (!href || !title) {
                return [];
            }

            const published = $element.find('time').first().attr('datetime') ?? $element.find('time').first().text();

            return [
                {
                    title,
                    link: new URL(href, baseUrl).href,
                    pubDate: published ? parseDate(published) : undefined,
                },
            ];
        })
        .slice(0, limit);

    const item = await pMap(
        list,
        (entry) =>
            cache.tryGet(entry.link!, async () => {
                const detail = await ofetch(entry.link!);
                const $$ = load(detail);
                const article = $$('article.article-body').first();
                const published = article.find('time').first().attr('datetime') || article.find('time').first().text();
                const author = article.find('.author-name').first().text() || undefined;
                const image = $$('meta[property="og:image"]').attr('content');
                const content = article.clone();
                content.find('.article-meta, h1, .article-rule, .author-card').remove();

                return {
                    title: article.find('h1').first().text() || entry.title,
                    link: entry.link,
                    description: content.html() ?? undefined,
                    pubDate: published ? parseDate(published) : entry.pubDate,
                    author,
                    image,
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: $('title').text() || 'Herdr blog',
        description: $('meta[name="description"]').attr('content'),
        link: targetUrl,
        language: 'en' as Language,
        item,
        image: $('meta[property="og:image"]').attr('content'),
    } satisfies Data;
}
