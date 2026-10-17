import type { Route } from '@/types';
import { getTsdmForumFeed } from '@/utils/tsdm39-forum';

export const route: Route = {
    path: '/forum/:fid',
    name: '版块主题',
    categories: ['anime'],
    maintainers: ['vizmoe'],
    example: '/tsdm39/forum/31',
    parameters: {
        fid: '版块 ID，即版块页面 URL 中的 fid，例如 702（音乐）、716（EPUB 区）。',
    },
    features: {
        requireConfig: [
            {
                name: 'TSDM39_COOKIES',
                optional: true,
                description: '天使动漫论坛登录后请求中的 Cookie。公开版块可不配置；需要登录的版块（如 702）必须配置，且账号须有相应阅读权限。',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.tsdm39.com/forum.php'],
            target: (_, url) => {
                const params = new URL(url).searchParams;
                const fid = params.get('fid');
                return params.get('mod') === 'forumdisplay' && fid && /^[1-9]\d*$/.test(fid) ? `/tsdm39/forum/${fid}` : '';
            },
        },
    ],
    description: `按发帖时间获取版块第一页的新主题，默认最多 20 条，可使用 RSSHub 通用参数 \`limit\` 调整。订阅内容为首帖正文，正文范围取决于当前账号的阅读权限；单个主题权限不足时保留标题、链接和权限提示。

例如音乐版块 \`https://www.tsdm39.com/forum.php?mod=forumdisplay&fid=702&page=1\` 对应 \`/tsdm39/forum/702\`，EPUB 区对应 \`/tsdm39/forum/716\`。登录受限版块需在自建 RSSHub 中配置环境变量 \`TSDM39_COOKIES\`；Cookie 失效后需要更新。`,
    handler: getTsdmForumFeed,
};
