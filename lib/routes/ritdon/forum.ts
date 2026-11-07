import type { Route } from '@/types';
import { getRitdonForumFeed } from '@/utils/tsdm39-forum';

export const route: Route = {
    path: '/forum/:fid',
    name: '版块主题',
    categories: ['reading'],
    maintainers: ['vizmoe'],
    example: '/ritdon/forum/39',
    parameters: {
        fid: '版块 ID，即版块页面 URL 中的 fid，例如 39（轻小说版块）、40（水区）。',
    },
    features: {
        requireConfig: [
            {
                name: 'RITDON_COOKIES',
                optional: true,
                description: '深夜读书会论坛登录后请求中的 Cookie。公开版块（如 40）可不配置；需要登录的版块（如 39）可配置此项，或配置 RITDON_USERNAME 与 RITDON_PASSWORD。',
            },
            {
                name: 'RITDON_USERNAME',
                optional: true,
                description: '深夜读书会论坛登录用户名或邮箱（配合 RITDON_PASSWORD 使用）。',
            },
            {
                name: 'RITDON_PASSWORD',
                optional: true,
                description: '深夜读书会论坛登录密码（配合 RITDON_USERNAME 使用）。',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    description: `按发帖时间获取版块第一页的新主题，默认最多 20 条，可使用 RSSHub 通用参数 \`limit\` 调整。订阅内容为首帖正文，正文范围取决于当前账号的阅读权限；单个主题权限不足时保留标题、链接和权限提示。

例如 \`https://ritdon.com/forum.php?mod=forumdisplay&fid=39\` 对应 \`/ritdon/forum/39\`，水区 \`https://ritdon.com/forum.php?mod=forumdisplay&fid=40\` 对应 \`/ritdon/forum/40\`。登录受限版块需在自建 RSSHub 中配置环境变量 \`RITDON_COOKIES\`，或配置 \`RITDON_USERNAME\` 与 \`RITDON_PASSWORD\`。

当前 RSSHub Radar 无法从论坛 URL 的查询参数中识别版块。请在 RSS 阅读器中手动添加 RSSHub 实例地址加上 \`/ritdon/forum/<fid>\`，并将 \`<fid>\` 替换为版块 ID。`,
    handler: getRitdonForumFeed,
};
