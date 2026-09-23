import type { Context } from 'hono';
import { http, HttpResponse } from 'msw';
import Parser from 'rss-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../lib/app';
import { config } from '../lib/config';
import { route } from '../lib/routes/tsdm39/forum';
import server from '../lib/setup.test';
import type { Data } from '../lib/types';
import cache from '../lib/utils/cache';

vi.mock('../lib/utils/request-rewriter', () => ({}));

const rootUrl = 'https://www.tsdm39.com';
const cookie = 'test-only-session=value';
const previousCookie = config.tsdm39.cookie;
const requests: Request[] = [];
const loginPage = '<div id="messagetext"><p>抱歉，您尚未登录，没有权限访问该版块</p></div><div id="messagelogin"></div>';
const deniedPage = '<div id="messagetext"><p>抱歉，您没有权限访问该版块</p></div>';

// Minimal fixtures follow the live Discuz X5 list and first-post markup.
const threadRow = (tid: number, customTheme = false) => `
<tbody ${customTheme ? 'class="tsdm_normalthread"' : `id="normalthread_${tid}"`}><tr>
    <th><em>[<a href="forum.php?mod=forumdisplay&amp;fid=702&amp;filter=typeid&amp;typeid=172">动画资讯</a>]</em>
        <a class="xst" href="${customTheme ? `thread-${tid}-1-1.html` : `forum.php?mod=viewthread&amp;tid=${tid}&amp;extra=page%3D1`}">主题 ${tid}</a></th>
    <td class="by"><cite><a href="home.php?mod=space&amp;uid=1">发帖人</a></cite><em><span><span title="2026-9-23">昨天 23:57</span></span></em></td>
    <td class="by"><cite>最后回复者</cite><em><span title="2026-9-24 03:00">今天 03:00</span></em></td>
</tr></tbody>`;

const forumPage = (
    rows = `${threadRow(100)}${threadRow(101, true)}${threadRow(100)}
<tbody id="normalthread_ad"><tr><th><a class="xst">Advertisement</a></th></tr></tbody>`
) => `
<title>测试版块 - 天使动漫 - Powered by Discuz!</title><h1><a>测试版块</a><span>今日：1</span></h1>
<table id="threadlisttableid">
    <tbody id="stickthread_99"><tr><th><a class="xst" href="forum.php?mod=viewthread&amp;tid=99">置顶公告</a></th></tr></tbody>
    ${rows}
</table>`;

const threadPage = `<div id="postlist">
    <div id="post_1000"><div class="authi"><em id="authorposton1000">发表于 <span title="2026-9-23 23:57:24">昨天 23:57</span></em></div>
        <table><tr><td id="postmessage_1000"><p>首帖正文</p>
            <img src="static/image/common/none.gif" file="data/attachment/forum/image.jpg" zoomfile="data/attachment/forum/full.jpg">
            <a href="forum.php?mod=viewthread&amp;tid=102">相关主题</a><div class="locked">本帖隐藏的内容需要回复才可以浏览</div>
            <script>window.unwanted = true;</script>
        </td></tr></table><div class="sign">用户签名</div></div>
    <div id="post_1001"><table><tr><td id="postmessage_1001">回复正文</td></tr></table></div>
</div>`;

const invoke = async (fid = '702', limit?: string) => (await route.handler({ req: { param: () => fid, query: (name: string) => (name === 'limit' ? limit : undefined) } } as unknown as Context)) as Data;

function respondWith(list: string, detail = threadPage) {
    server.use(
        http.get(`${rootUrl}/forum.php`, ({ request }) => {
            requests.push(request);
            return HttpResponse.html(new URL(request.url).searchParams.get('mod') === 'forumdisplay' ? list : detail);
        })
    );
}

beforeEach(() => {
    config.tsdm39.cookie = cookie;
    requests.length = 0;
    cache.clients.memoryCache?.clear();
    respondWith(forumPage());
});

afterEach(() => {
    config.tsdm39.cookie = previousCookie;
});

describe('TSDM forum subscriptions', () => {
    it('renders an RSS feed with unique topic links and the first post, using the configured login on every request', async () => {
        const response = await app.request('/tsdm39/forum/702');
        expect(response.status).toBe(200);
        const feed = await new Parser().parseString(await response.text());
        expect(feed.title).toBe('天使动漫论坛 - 测试版块');
        expect(feed.link).toBe(`${rootUrl}/forum.php?mod=forumdisplay&fid=702`);
        expect(feed.items).toHaveLength(2);
        expect(feed.items[0]).toMatchObject({
            title: '主题 100',
            link: `${rootUrl}/forum.php?mod=viewthread&tid=100`,
            creator: '发帖人',
            categories: ['动画资讯'],
            isoDate: '2026-09-23T15:57:24.000Z',
        });
        expect(new Set(feed.items.map((item) => item.guid)).size).toBe(2);
        const content = feed.items[0].content!;
        expect(content).toContain('首帖正文');
        expect(content).toContain(`${rootUrl}/data/attachment/forum/image.jpg`);
        expect(content).toContain(`${rootUrl}/forum.php?mod=viewthread`);
        expect(content).toContain('需要回复才可以浏览');
        expect(content).not.toMatch(/回复正文|用户签名|<script|none\.gif/);
        expect(requests).toHaveLength(3);
        for (const request of requests) {
            expect(request.method).toBe('GET');
            expect(request.headers.get('cookie')).toBe(cookie);
            expect(new URL(request.url).searchParams.get('page')).toBe('1');
        }
        const listQuery = new URL(requests[0].url).searchParams;
        expect(listQuery.get('orderby')).toBe('dateline');
        expect(listQuery.get('fid')).toBe('702');
    });

    it('reads public boards without a Cookie header and applies the common limit before fetching details', async () => {
        config.tsdm39.cookie = '';
        const feed = await invoke('31', '1');
        expect(feed.item).toHaveLength(1);
        expect(requests).toHaveLength(2);
        expect(requests.every((request) => !request.headers.has('cookie'))).toBe(true);
    });

    it('retains a source list date when a post date is missing and never fabricates absent dates', async () => {
        respondWith(forumPage(), '<div id="postlist"><div id="postmessage_1">Content without a date</div></div>');
        const feed = await invoke('31', '1');
        expect(feed.item![0].pubDate).toEqual(new Date('2026-09-22T16:00:00Z'));

        cache.clients.memoryCache?.clear();
        respondWith(forumPage(threadRow(102).replace(/<em><span>[\s\S]*?<\/span><\/em>/, '')), '<div id="postlist"><div id="postmessage_1">Content without a date</div></div>');
        const undated = await invoke('31', '1');
        expect(undated.item![0].pubDate).toBeUndefined();
    });

    it('interprets historical post dates as UTC+8 independently of server daylight saving time', async () => {
        respondWith(forumPage(threadRow(100)), threadPage.replace('2026-9-23 23:57:24', '2026-1-2 08:30:00'));
        const feed = await invoke();
        expect(feed.item![0].pubDate).toEqual(new Date('2026-01-02T00:30:00Z'));
    });

    it.each(['', cookie])('reports missing or expired login instead of an empty feed (cookie=%s)', async (value) => {
        config.tsdm39.cookie = value;
        respondWith(loginPage);
        await expect(invoke()).rejects.toMatchObject({ name: 'ConfigNotFoundError', message: expect.stringContaining(value ? '登录失效' : '需要登录') });
        expect(requests).toHaveLength(1);
    });

    it('reports insufficient account permissions separately from login expiry', async () => {
        respondWith(deniedPage);
        await expect(invoke()).rejects.toMatchObject({ name: 'RejectError', message: expect.stringContaining('阅读权限') });
        expect(requests).toHaveLength(1);
    });

    it('reports login expiry while fetching a first post', async () => {
        respondWith(forumPage(threadRow(100)), loginPage);
        await expect(invoke()).rejects.toMatchObject({ name: 'ConfigNotFoundError' });
    });

    it('retains a listed topic when only its first post requires higher permissions', async () => {
        respondWith(forumPage(threadRow(100)), deniedPage);
        const feed = await invoke();
        expect(feed.item).toHaveLength(1);
        expect(feed.item![0]).toMatchObject({ title: '主题 100', link: `${rootUrl}/forum.php?mod=viewthread&tid=100`, description: expect.stringContaining('当前账号无法阅读') });
    });

    it('preserves a visible paid-content notice without buying or posting', async () => {
        respondWith(forumPage(threadRow(100)), '<div id="postlist"><div class="locked">本主题需支付 10 天使币</div></div>');
        const feed = await invoke();
        expect(feed.item![0].description).toBe('本主题需支付 10 天使币');
        expect(requests.every((request) => request.method === 'GET')).toBe(true);
    });

    it('fails visibly when first-post markup is missing', async () => {
        respondWith(forumPage(threadRow(100)), '<title>Unexpected page</title>');
        await expect(invoke()).rejects.toThrow('未找到天使动漫论坛首帖正文');
    });

    it('preserves RSSHub empty-feed detection when list markup changes', async () => {
        respondWith(forumPage(''));
        const response = await app.request('/tsdm39/forum/702');
        expect(response.status).not.toBe(200);
        expect(requests).toHaveLength(1);
    });

    it.each(['0', '-1', '702&fid=85', 'invalid'])('rejects invalid board IDs before requesting the site: %s', async (fid) => {
        await expect(invoke(fid)).rejects.toMatchObject({ name: 'InvalidParameterError' });
        expect(requests).toHaveLength(0);
    });

    it('caches first posts and keeps cached content separate across login cookies', async () => {
        await invoke('702', '1');
        await invoke('702', '1');
        expect(requests.filter((request) => new URL(request.url).searchParams.get('mod') === 'viewthread')).toHaveLength(1);
        config.tsdm39.cookie = 'another-test-session=value';
        await invoke('702', '1');
        expect(requests.filter((request) => new URL(request.url).searchParams.get('mod') === 'viewthread')).toHaveLength(2);
    });

    it('bounds concurrent first-post requests', async () => {
        let active = 0;
        let maximum = 0;
        server.use(
            http.get(`${rootUrl}/forum.php`, async ({ request }) => {
                if (new URL(request.url).searchParams.get('mod') === 'forumdisplay') {
                    return HttpResponse.html(forumPage(Array.from({ length: 8 }, (_, index) => threadRow(200 + index)).join('')));
                }
                active++;
                maximum = Math.max(maximum, active);
                await new Promise((resolve) => setTimeout(resolve, 10));
                active--;
                return HttpResponse.html(threadPage);
            })
        );
        const feed = await invoke();
        expect(feed.item).toHaveLength(8);
        expect(maximum).toBeGreaterThan(1);
        expect(maximum).toBeLessThanOrEqual(3);
    });

    it('maps only forum-display URLs to subscriptions', () => {
        const target = route.radar![0].target;
        if (typeof target !== 'function') {
            throw new TypeError('Expected a Radar target function');
        }
        expect(target({}, `${rootUrl}/forum.php?mod=forumdisplay&fid=702&page=1`)).toBe('/tsdm39/forum/702');
        expect(target({}, `${rootUrl}/forum.php?mod=viewthread&tid=100`)).toBe('');
        expect(target({}, `${rootUrl}/forum.php?mod=forumdisplay&fid=invalid`)).toBe('');
    });
});
