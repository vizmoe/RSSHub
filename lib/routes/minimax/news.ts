import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://www.minimax.io';
const listUrl = `${baseUrl}/news`;

interface MiniMaxNewsItem {
    newsId: string;
    title: string;
    summary?: string;
    tags?: string[];
    coverImageUrl?: string;
    publishDate?: number | string;
    slug: string;
}

interface MiniMaxNewsResponse {
    data?: MiniMaxNewsItem[];
}

const parsePublishDate = (value?: number | string) => {
    if (typeof value === 'number') {
        return parseDate(value);
    }
    if (!value) {
        return;
    }
    return parseDate(value);
};

export const route: Route = {
    path: '/news',
    categories: ['program-update'],
    example: '/minimax/news',
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
            source: ['www.minimax.io/news', 'www.minimax.io/news/:slug'],
            target: '/news',
        },
    ],
    name: 'News',
    maintainers: ['vizmoe'],
    handler,
    url: 'www.minimax.io/news',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

    const response = await ofetch<MiniMaxNewsResponse>(`${baseUrl}/api/news`, {
        query: {
            locale: 'en',
        },
    });

    const list: DataItem[] = (response.data ?? []).slice(0, limit).map((entry) => ({
        title: entry.title,
        link: `${baseUrl}/news/${entry.slug}`,
        description: entry.summary,
        pubDate: parsePublishDate(entry.publishDate),
        category: entry.tags,
        image: entry.coverImageUrl,
        guid: entry.newsId,
    }));

    const item = await pMap(
        list,
        (entry) =>
            cache.tryGet(entry.link!, async () => {
                const detail = await ofetch(entry.link!);
                const $ = load(detail);
                const article = $('article .prose').first();
                const dateText = $('time').first().text().trim();

                return {
                    ...entry,
                    title: $('h1').first().text() || entry.title,
                    description: article.html() ?? entry.description,
                    pubDate: dateText ? parseDate(dateText) : entry.pubDate,
                    image: $('meta[property="og:image"]').attr('content') ?? entry.image,
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: 'MiniMax News',
        description: 'MiniMax AI product updates and partner news',
        link: listUrl,
        language: 'en' as Language,
        item,
    };
}
