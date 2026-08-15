import { load } from 'cheerio';

import type { DataItem, Language, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://artificialanalysis.ai';
const targetUrl = `${baseUrl}/changelog`;

export const route: Route = {
    path: '/changelog',
    categories: ['program-update'],
    example: '/artificialanalysis/changelog',
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
            source: ['artificialanalysis.ai/changelog'],
            target: '/changelog',
        },
    ],
    name: 'Changelog',
    maintainers: ['vizmoe'],
    handler,
    url: 'artificialanalysis.ai/changelog',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 30;

    const response = await ofetch(targetUrl);
    const $ = load(response);
    const items: DataItem[] = [];

    for (const heading of $('h4').toArray()) {
        const date = $(heading).text().replaceAll(/\s+/g, ' ').trim();
        if (!/^\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/.test(date)) {
            continue;
        }

        let sibling = $(heading).next();
        while (sibling.length && !sibling.is('h4')) {
            sibling.find('a[href]').each((_, link) => {
                const $link = $(link);
                const title = $link.find('h3').first().text().trim() || $link.text().replaceAll(/\s+/g, ' ').trim();
                const href = $link.attr('href');
                if (!title || !href) {
                    return;
                }

                items.push({
                    title,
                    pubDate: parseDate(date),
                    link: new URL(href, baseUrl).href,
                    guid: `artificialanalysis-${date}-${title}`,
                });
            });
            sibling = sibling.next();
        }
    }

    const item = items.filter((entry, index, list) => list.findIndex((other) => other.link === entry.link && other.title === entry.title) === index).slice(0, limit);

    return {
        title: 'Artificial Analysis Changelog',
        description: 'Changelog and evaluation updates from Artificial Analysis',
        link: targetUrl,
        language: 'en' as Language,
        item,
    };
}
