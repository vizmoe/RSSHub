import { load } from 'cheerio';

import type { DataItem, Language, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const targetUrl = 'https://platform.kimi.ai/blog/posts/changelog';

export const route: Route = {
    path: '/changelog',
    categories: ['program-update'],
    example: '/kimi/changelog',
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
            source: ['platform.kimi.ai/blog/posts/changelog'],
            target: '/changelog',
        },
    ],
    name: 'Changelog',
    maintainers: ['vizmoe'],
    handler,
    url: 'platform.kimi.ai/blog/posts/changelog',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;

    const response = await ofetch(targetUrl);
    const $ = load(response);
    const article = $('article').first();

    const item = article
        .find('h2')
        .toArray()
        .flatMap((heading): DataItem[] => {
            const $heading = $(heading);
            const title = $heading.text().trim();
            if (!title) {
                return [];
            }

            const description = $heading
                .nextUntil('h2')
                .toArray()
                .map((element) => $.html(element))
                .join('');
            const anchor = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

            return [
                {
                    title,
                    description,
                    pubDate: parseDate(title),
                    link: `${targetUrl}#${anchor}`,
                    guid: `kimi-changelog-${anchor}`,
                },
            ];
        })
        .slice(0, limit);

    return {
        title: 'Kimi Open Platform Changelog',
        description: 'New feature release log for the Kimi Open Platform',
        link: targetUrl,
        language: 'en' as Language,
        item,
    };
}
