import type { Route } from '@/types';
import { getLightNovelBookFeed, requireConfig } from '@/utils/lightnovel-app';

export const route: Route = {
    path: '/book/:id',
    name: '作品章节',
    categories: ['reading'],
    maintainers: ['vizmoe'],
    example: '/lightnovel.app/book/21119',
    parameters: {
        id: '作品 ID，可在小说详情页 `/book/info/:id` 或漫画详情页 `/manga/:id` 的 URL 中找到。',
    },
    features: {
        requireConfig,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.lightnovel.app/book/info/:id', 'www.lightnovel.app/manga/:id'],
            target: '/book/:id',
        },
    ],
    description: '订阅指定轻小说或漫画的章节 / 分卷更新，同时支持 `LIGHTNOVEL_APP_COOKIE` 或 `LIGHTNOVEL_APP_EMAIL` + `LIGHTNOVEL_APP_PASSWORD` 认证。',
    handler: getLightNovelBookFeed,
};
