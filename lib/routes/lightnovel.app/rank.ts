import type { Route } from '@/types';
import { getLightNovelRankFeed, rankTypeOptions, requireConfig } from '@/utils/lightnovel-app';

export const route: Route = {
    path: '/rank/:type?',
    name: '近期排行',
    categories: ['reading'],
    maintainers: ['vizmoe'],
    example: '/lightnovel.app/rank/daily',
    parameters: {
        type: {
            description: '排行榜类型，默认为 `daily`',
            default: 'daily',
            options: Object.entries(rankTypeOptions).map(([value, { label }]) => ({ value, label })),
        },
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
            source: ['www.lightnovel.app/book/rank/:type'],
            target: '/rank/:type',
        },
    ],
    description: `支持通过 \`LIGHTNOVEL_APP_COOKIE\`（填入浏览器 IndexedDB \`LightNovelShelf\` 中的 \`RefreshToken\` 或 \`RefreshToken=...\` Cookie 字符串）或 \`LIGHTNOVEL_APP_EMAIL\` + \`LIGHTNOVEL_APP_PASSWORD\` 账号密码认证。

| 排行榜类型 | \`:type\`   |
| ---------- | --------- |
| 日榜       | \`daily\`   |
| 周榜       | \`weekly\`  |
| 月榜       | \`monthly\` |`,
    handler: getLightNovelRankFeed,
};
