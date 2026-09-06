import type { DataItem, Language, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const markdownUrl = 'https://docs.z.ai/release-notes/new-released.md';
const pageUrl = 'https://docs.z.ai/release-notes/new-released';

const updatePattern = /<Update label="([^"]+)" description="\s*([^"\s][^"]*)">([\s\S]*?)<\/Update>/g;

export const route: Route = {
    path: '/release-notes',
    categories: ['program-update'],
    example: '/zai/release-notes',
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
            source: ['docs.z.ai/release-notes/new-released'],
            target: '/release-notes',
        },
    ],
    name: 'Release Notes',
    maintainers: ['vizmoe'],
    handler,
    url: 'docs.z.ai/release-notes/new-released',
};

async function handler(ctx) {
    const requestedLimit = Math.trunc(Number(ctx.req.query('limit')));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 30;

    const markdown = await ofetch(markdownUrl);
    const item: DataItem[] = [];

    for (const match of markdown.matchAll(updatePattern)) {
        const [, date, title, body] = match;
        const description = body
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');

        item.push({
            title: title.trim(),
            description,
            pubDate: parseDate(date),
            link: `${pageUrl}#${date}`,
            guid: `zai-release-notes-${date}-${title.trim()}`,
        });
    }

    return {
        title: 'Z.ai Release Notes',
        description: 'Release notes from Z.ai developer docs',
        link: pageUrl,
        language: 'en' as Language,
        item: item.slice(0, limit),
    };
}
