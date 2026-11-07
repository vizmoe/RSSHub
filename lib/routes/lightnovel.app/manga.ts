import type { Route } from '@/types';
import { getLightNovelMangaFeed, novelOrderOptions, requireConfig } from '@/utils/lightnovel-app';

export const route: Route = {
    path: '/manga/:order?',
    name: '漫画列表',
    categories: ['anime'],
    maintainers: ['vizmoe'],
    example: '/lightnovel.app/manga',
    parameters: {
        order: {
            description: '排序方式，默认为 `latest`',
            default: 'latest',
            options: Object.entries(novelOrderOptions).map(([value, label]) => ({ value, label })),
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
            source: ['www.lightnovel.app/manga/list'],
            target: '/manga',
        },
    ],
    description: `支持通过 \`LIGHTNOVEL_APP_COOKIE\`（填入浏览器 IndexedDB \`LightNovelShelf\` 中的 \`RefreshToken\` 或 \`RefreshToken=...\` Cookie 字符串）或 \`LIGHTNOVEL_APP_EMAIL\` + \`LIGHTNOVEL_APP_PASSWORD\` 账号密码认证。

| 排序方式 | \`:order\` |
| -------- | -------- |
| 最近更新 | \`latest\` |
| 上架时间 | \`new\`    |
| 总点击量 | \`view\`   |`,
    handler: getLightNovelMangaFeed,
};
