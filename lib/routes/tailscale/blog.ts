import { load } from 'cheerio';

import type { Data, DataItem, Language, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import parser from '@/utils/rss-parser';

const feedUrl = 'https://tailscale.com/blog/index.xml';
const blogUrl = 'https://tailscale.com/blog/';

export const route: Route = {
    path: '/blog',
    categories: ['programming'],
    example: '/tailscale/blog',
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
            source: ['tailscale.com/blog', 'tailscale.com/blog/:slug'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['vizmoe'],
    handler,
    url: 'tailscale.com/blog',
    description: 'Full-text feed for the official Tailscale blog. The upstream RSS at `https://tailscale.com/blog/index.xml` only includes summaries.',
    view: ViewType.Articles,
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const feed = await parser.parseURL(feedUrl);
    const list = Number.isFinite(requestedLimit) && requestedLimit > 0 ? feed.items.slice(0, requestedLimit) : feed.items;

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link!, async () => {
                const html = await ofetch(item.link!);
                const $ = load(html);
                const content = $('.blog-content-prose').first();
                const category = $('main h1').prev().find('span.capitalize').first().text().trim();
                const image = $('meta[property="og:image"]').attr('content');

                return {
                    title: item.title ?? '',
                    link: item.link,
                    description: content.html() ?? item.contentSnippet,
                    pubDate: item.pubDate ?? item.isoDate,
                    author: item.creator || item.author,
                    category: category || undefined,
                    image,
                } satisfies DataItem;
            })
        )
    );

    return {
        title: feed.title ?? 'Blog on Tailscale',
        link: blogUrl,
        description: feed.description,
        language: 'en' as Language,
        item: items,
        image: 'https://tailscale.com/favicon.ico',
    } satisfies Data;
}
