import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

const baseUrl = 'https://openclaw.ai';

export const route: Route = {
    path: '/blog',
    categories: ['programming'],
    example: '/openclaw/blog',
    radar: [
        {
            source: ['openclaw.ai/blog', 'openclaw.ai/blog/:slug'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['vizmoe'],
    handler,
    url: 'openclaw.ai/blog',
    description: 'Full-text blog feed. The official RSS only contains summaries. Returns the latest 20 posts by default; use the common `limit` parameter to adjust the number of posts.',
    view: ViewType.Articles,
};

async function handler(ctx: Context): Promise<Data> {
    const xml = await ofetch(`${baseUrl}/rss.xml`);
    const feed = await parser.parseString(xml);
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const list = feed.items.filter((entry) => entry.link).slice(0, limit);

    const item = await pMap(
        list,
        (entry) =>
            cache.tryGet(entry.link!, async () => {
                const html = await ofetch(entry.link!);
                const $ = load(html);
                const content = $('.article-content').first();
                if (!content.length || !content.text().trim()) {
                    throw new Error(`Article content is missing at ${entry.link}; the site layout may have changed.`);
                }

                content.find('[srcset]').each((_, element) => {
                    const image = $(element);
                    const srcset = image
                        .attr('srcset')!
                        .split(',')
                        .map((candidate) => {
                            const [url, ...descriptor] = candidate.trim().split(/\s+/);
                            return [new URL(url, entry.link).href, ...descriptor].join(' ');
                        })
                        .join(', ');
                    image.attr('srcset', srcset);
                });

                const published = entry.isoDate || entry.pubDate;

                return {
                    title: entry.title ?? '',
                    link: entry.link,
                    description: content.html(),
                    pubDate: published ? parseDate(published) : undefined,
                    author:
                        $('.byline-names a')
                            .toArray()
                            .map((author) => $(author).text())
                            .join(', ') || undefined,
                    category: $('.footer-tags span')
                        .toArray()
                        .map((tag) => $(tag).text()),
                    image: $('meta[property="og:image"]').attr('content'),
                } satisfies DataItem;
            }),
        { concurrency: 5 }
    );

    return {
        title: feed.title ?? 'OpenClaw Blog',
        link: `${baseUrl}/blog`,
        description: feed.description,
        language: 'en',
        item,
    };
}
