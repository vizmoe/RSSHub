import type { Route } from '@/types';
import { getLightNovelListFeed, novelCategoryOptions, novelOrderOptions, requireConfig } from '@/utils/lightnovel-app';

export const route: Route = {
    path: '/novel/:order?/:category?',
    name: '小说列表',
    categories: ['reading'],
    maintainers: ['vizmoe'],
    example: '/lightnovel.app/novel',
    parameters: {
        order: {
            description: '排序方式，默认为 `latest`',
            default: 'latest',
            options: Object.entries(novelOrderOptions).map(([value, label]) => ({ value, label })),
        },
        category: {
            description: '小说类型 ID，默认为 `all`（全部类型）',
            default: 'all',
            options: Object.entries(novelCategoryOptions).map(([value, { label }]) => ({ value, label })),
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
            source: ['www.lightnovel.app/novel/list'],
            target: '/novel',
        },
    ],
    description: `支持通过 \`LIGHTNOVEL_APP_COOKIE\`（填入浏览器 IndexedDB \`LightNovelShelf\` 中的 \`RefreshToken\` 或 \`RefreshToken=...\` Cookie 字符串）或 \`LIGHTNOVEL_APP_EMAIL\` + \`LIGHTNOVEL_APP_PASSWORD\` 账号密码认证。

| 排序方式 | \`:order\` |
| -------- | -------- |
| 最近更新 | \`latest\` |
| 上架时间 | \`new\`    |
| 总点击量 | \`view\`   |

| 小说类型 | \`:category\` |
| -------- | ----------- |
| 全部类型 | \`all\`       |
| 录入完成 | \`1\`         |
| 翻译完成 | \`2\`         |
| 翻译中   | \`3\`         |
| 录入中   | \`4\`         |
| 转载     | \`5\`         |
| 原创     | \`7\`         |
| AI 翻译  | \`8\`         |`,
    handler: getLightNovelListFeed,
};
