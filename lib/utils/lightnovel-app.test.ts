import { Buffer } from 'node:buffer';

import { http, HttpResponse } from 'msw';
import Parser from 'rss-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '@/app';
import { config } from '@/config';
import server from '@/setup.test';
import cache from '@/utils/cache';
import { apiBaseUrl, hashPassword, parseCredential, rootUrl } from '@/utils/lightnovel-app';

vi.mock('@/utils/request-rewriter', () => ({}));

const recordSeparator = '\u{1E}';
const validRefreshToken = 'w6JxVr4NphIXOX6PDMDfoZyq3Dc6DDbn';

const createJwt = (expOffsetSeconds = 60) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
    const payload = Buffer.from(
        JSON.stringify({
            sub: '52753',
            exp,
        })
    ).toString('base64url');
    return `${header}.${payload}.signature`;
};

const previousConfig = { ...config.lightnovelApp };

interface HubFixtureConfig {
    refreshSuccess?: boolean;
    loginSuccess?: boolean;
    hubError?: string;
    hubResultSuccess?: boolean;
    hubResultMsg?: string;
}

const setupMockServer = (options: HubFixtureConfig = {}) => {
    const { refreshSuccess = true, loginSuccess = true, hubError, hubResultSuccess = true, hubResultMsg = '' } = options;
    const issuedJwt = createJwt(60);
    const authCalls: Array<{ endpoint: string; body: unknown; headers: Headers }> = [];
    const hubInvocations: Array<{ target: string; arguments: unknown[] }> = [];
    let pendingHubResponse = '';

    server.use(
        http.post(`${apiBaseUrl}/api/user/refresh_token`, async ({ request }) => {
            const body = await request.json();
            authCalls.push({ endpoint: 'refresh_token', body, headers: request.headers });
            if (!refreshSuccess) {
                return HttpResponse.json({
                    Response: null,
                    Status: 404,
                    Success: false,
                    Msg: '无效token',
                });
            }
            return HttpResponse.json({
                Response: issuedJwt,
                Status: 200,
                Success: true,
                Msg: null,
            });
        }),
        http.post(`${apiBaseUrl}/api/user/login`, async ({ request }) => {
            const body = await request.json();
            authCalls.push({ endpoint: 'login', body, headers: request.headers });
            if (!loginSuccess) {
                return HttpResponse.json({
                    Response: null,
                    Status: 400,
                    Success: false,
                    Msg: '邮箱或密码错误',
                });
            }
            return HttpResponse.json({
                Response: {
                    Token: issuedJwt,
                    RefreshToken: 'logged-in-refresh-token-12345678',
                },
                Status: 200,
                Success: true,
                Msg: null,
            });
        }),
        http.post(`${apiBaseUrl}/hub/api/negotiate`, () =>
            HttpResponse.json({
                negotiateVersion: 1,
                connectionId: 'conn-id-1',
                connectionToken: 'conn-token-1',
            })
        ),
        http.get(`${apiBaseUrl}/hub/api`, () => {
            if (!pendingHubResponse) {
                return new HttpResponse('', { status: 200 });
            }
            const out = pendingHubResponse;
            pendingHubResponse = '';
            return new HttpResponse(out, {
                status: 200,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }),
        http.post(`${apiBaseUrl}/hub/api`, async ({ request }) => {
            const raw = await request.text();
            const frames = raw
                .split(recordSeparator)
                .map((item) => item.trim())
                .filter(Boolean)
                .map((item) => JSON.parse(item));

            const invocation = frames.find((frame) => frame.type === 1);
            if (invocation) {
                hubInvocations.push({
                    target: invocation.target,
                    arguments: invocation.arguments,
                });

                let payload: unknown = null;
                switch (invocation.target) {
                    case 'GetBookList':
                        payload = {
                            page: 1,
                            size: 24,
                            total: 2,
                            totalPages: 1,
                            hasMore: false,
                            data: [
                                {
                                    Id: 21119,
                                    Category: { Name: '录入完成', ShortName: '录入', Color: '#EC1282' },
                                    Title: '魔女不受项圈束缚 2',
                                    UserName: '十六夜小夜',
                                    LastUpdatedAt: '2026-11-07T17:16:40.647376Z',
                                    Cover: 'https://img.lightnovel.life/images/2026/11/08/cover.jpg',
                                    Type: 'Novel',
                                    SeriesTitle: '魔女不受项圈束缚',
                                },
                                {
                                    Id: 21117,
                                    Category: { Name: '翻译完成', ShortName: '翻译', Color: '#1976d2' },
                                    Title: '皇后之碧',
                                    UserName: '十六夜小夜',
                                    LastUpdatedAt: '2026-11-07T09:05:45.017991Z',
                                    Cover: 'https://img.lightnovel.life/images/2026/11/07/cover2.jpg',
                                    Type: 'Novel',
                                    SeriesTitle: '八尺乌系列',
                                },
                            ],
                        };
                        break;
                    case 'GetComicList':
                        payload = {
                            page: 1,
                            size: 24,
                            total: 2,
                            totalPages: 1,
                            hasMore: false,
                            data: [
                                {
                                    id: 21105,
                                    title: '伊藤润二恐怖漫画精选',
                                    originalTitle: '伊藤潤二恐怖マンガCollection',
                                    count: 11,
                                    cover: 'https://img.lightnovel.life/images/2026/11/07/manga1.png',
                                    lastUpdatedAt: '2026-11-07T16:37:39.506171Z',
                                },
                                {
                                    id: 21118,
                                    title: '为了拯救世界，你愿意跟亚人来个早安吻吗？',
                                    originalTitle: '世界を救うために亜人と朝チュンできますか？',
                                    count: 2,
                                    cover: 'https://files.seeusercontent.com/2026/11/07/k3mQ/001.jpg',
                                    lastUpdatedAt: '2026-11-07T15:34:39.153021Z',
                                },
                            ],
                        };
                        break;
                    case 'GetRank':
                        payload = [
                            {
                                Id: 21107,
                                Category: { Name: '录入完成', ShortName: '录入', Color: '#EC1282' },
                                Title: '零居民领主因误会坐拥后宫。 1',
                                UserName: '十六夜小夜',
                                LastUpdatedAt: '2026-11-06T16:28:21.11328Z',
                                Cover: 'https://img.lightnovel.life/images/2026/11/07/rank1.jpg',
                                Type: 'Novel',
                                SeriesTitle: '零居民领主系列',
                            },
                            {
                                Id: 19466,
                                Category: { Name: '连载', ShortName: '连载', Color: '#1976D2' },
                                Title: '学生会也有洞！',
                                UserName: '241823',
                                LastUpdatedAt: '2026-09-04T08:50:56.860733Z',
                                Cover: 'https://img.lightnovel.life/images/2026/08/14/rank2.jpg',
                                Type: 'Comic',
                                SeriesTitle: '学生会也有洞！',
                            },
                        ];
                        break;
                    case 'GetBookInfo': {
                        const reqId = (invocation.arguments?.[0] as { Id?: number })?.Id;
                        payload =
                            reqId === 21105
                                ? {
                                      book: {
                                          id: 21105,
                                          type: 'Comic',
                                          cover: 'https://img.lightnovel.life/images/2026/11/07/manga1.png',
                                          title: '伊藤润二恐怖漫画精选',
                                          author: '伊藤润二',
                                          introduction: '<p>日本恐怖漫画大师经典短篇集。</p>',
                                          user: { id: 28962, userName: 'pikeduo' },
                                          extra: {
                                              classification: {
                                                  tags: ['恐怖', '惊悚'],
                                                  author: '伊藤润二',
                                              },
                                          },
                                          chapters: [
                                              {
                                                  id: 299989,
                                                  sortNum: 1,
                                                  title: '第 2 卷',
                                                  createdAt: '2026-11-06T16:31:39.808041Z',
                                                  updatedAt: '2026-11-06T16:32:21.802704Z',
                                                  pageCount: 251,
                                              },
                                          ],
                                      },
                                  }
                                : {
                                      book: {
                                          id: 21119,
                                          type: 'Novel',
                                          cover: 'https://img.lightnovel.life/images/2026/11/08/cover.jpg',
                                          title: '魔女不受项圈束缚 2',
                                          author: '梦见夕利',
                                          introduction: '<div><p>奇幻动作故事第二集！</p></div>',
                                          user: { id: 40269, userName: '十六夜小夜' },
                                          extra: {
                                              classification: {
                                                  tags: ['奇幻', '魔法'],
                                                  author: '夢見夕利',
                                              },
                                          },
                                          chapters: [
                                              {
                                                  id: 300160,
                                                  sortNum: 1,
                                                  title: '第一章 序幕',
                                                  createdAt: '2026-11-07T17:16:40.647408Z',
                                                  updatedAt: null,
                                                  pageCount: 0,
                                              },
                                              {
                                                  id: 300161,
                                                  sortNum: 2,
                                                  title: '第二章 圣女',
                                                  createdAt: '2026-11-07T18:00:00.000000Z',
                                                  updatedAt: null,
                                                  pageCount: 0,
                                              },
                                          ],
                                      },
                                  };
                        break;
                    }
                    default:
                        break;
                }

                const completionFrame = hubError
                    ? {
                          type: 3,
                          invocationId: invocation.invocationId,
                          error: hubError,
                      }
                    : {
                          type: 3,
                          invocationId: invocation.invocationId,
                          result: {
                              response: payload,
                              status: hubResultSuccess ? 200 : 400,
                              success: hubResultSuccess,
                              msg: hubResultMsg,
                          },
                      };

                pendingHubResponse = `{}${recordSeparator}${JSON.stringify(completionFrame)}${recordSeparator}`;
            }

            return new HttpResponse('', { status: 200 });
        }),
        http.delete(`${apiBaseUrl}/hub/api`, () => new HttpResponse('', { status: 200 }))
    );

    return { authCalls, hubInvocations };
};

beforeEach(() => {
    config.lightnovelApp = {
        cookie: validRefreshToken,
        email: undefined,
        password: undefined,
    };
    cache.clients.memoryCache?.clear();
});

afterEach(() => {
    config.lightnovelApp = { ...previousConfig };
});

describe('lightnovel.app credential helpers', () => {
    it('parses raw RefreshToken, Cookie string, Bearer JWT, and JSON credentials', () => {
        const jwt = createJwt(120);
        expect(parseCredential(validRefreshToken)).toEqual({
            refreshToken: validRefreshToken,
        });
        expect(parseCredential(`RefreshToken=${validRefreshToken}; token=${jwt}`)).toEqual({
            refreshToken: validRefreshToken,
            accessToken: jwt,
        });
        expect(parseCredential(`Bearer ${jwt}`)).toEqual({
            accessToken: jwt,
        });
        expect(parseCredential(JSON.stringify({ RefreshToken: validRefreshToken, Token: jwt }))).toEqual({
            refreshToken: validRefreshToken,
            accessToken: jwt,
        });
        expect(parseCredential('')).toEqual({});
    });

    it('hashes plaintext passwords with SHA-256 and preserves pre-hashed hex strings', () => {
        const expected = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b';
        expect(hashPassword('secret')).toBe(expected);
        expect(hashPassword(expected.toUpperCase())).toBe(expected);
    });
});

describe('lightnovel.app routes & authentication', () => {
    it('fetches the novel list using Cookie/RefreshToken authentication', async () => {
        const { authCalls, hubInvocations } = setupMockServer();

        const response = await app.request('/lightnovel.app/novel/new/1?limit=1');
        expect(response.status).toBe(200);

        const feed = await new Parser().parseString(await response.text());
        expect(feed.title).toBe('轻书架 - 小说列表 - 录入完成（上架时间）');
        expect(feed.link).toBe(`${rootUrl}/novel/list`);
        expect(feed.items).toHaveLength(1);
        expect(feed.items[0]).toMatchObject({
            title: '魔女不受项圈束缚 2',
            link: `${rootUrl}/book/info/21119`,
            creator: '十六夜小夜',
            categories: ['小说', '录入完成', '魔女不受项圈束缚'],
            isoDate: '2026-11-07T17:16:40.000Z',
        });

        expect(authCalls).toHaveLength(1);
        expect(authCalls[0].endpoint).toBe('refresh_token');
        expect(authCalls[0].body).toEqual({ token: validRefreshToken });
        expect(hubInvocations[0]).toEqual({
            target: 'GetBookList',
            arguments: [
                {
                    Page: 1,
                    Order: 'new',
                    Size: 1,
                    IgnoreJapanese: false,
                    IgnoreAI: false,
                    CategoryId: 1,
                },
                { UseGzip: false },
            ],
        });
    });

    it('authenticates with email and plaintext password and caches the obtained RefreshToken', async () => {
        config.lightnovelApp = {
            cookie: undefined,
            email: 'reader@example.com',
            password: 'secret',
        };
        const { authCalls } = setupMockServer();

        const response1 = await app.request('/lightnovel.app/manga');
        expect(response1.status).toBe(200);
        const feed = await new Parser().parseString(await response1.text());
        expect(feed.title).toBe('轻书架 - 漫画列表（最近更新）');
        expect(feed.link).toBe(`${rootUrl}/manga/list`);
        expect(feed.items).toHaveLength(2);
        expect(feed.items[0]).toMatchObject({
            title: '伊藤润二恐怖漫画精选',
            link: `${rootUrl}/manga/21105`,
            isoDate: '2026-11-07T16:37:39.000Z',
        });

        expect(authCalls).toHaveLength(1);
        expect(authCalls[0].endpoint).toBe('login');
        expect(authCalls[0].body).toEqual({
            email: 'reader@example.com',
            password: hashPassword('secret'),
        });

        // Subsequent request uses the cached RefreshToken instead of logging in again
        const response2 = await app.request('/lightnovel.app/manga/view?limit=1');
        expect(response2.status).toBe(200);
        expect(authCalls).toHaveLength(2);
        expect(authCalls[1].endpoint).toBe('refresh_token');
        expect(authCalls[1].body).toEqual({ token: 'logged-in-refresh-token-12345678' });
    });

    it('falls back to email/password login if configured RefreshToken is expired', async () => {
        config.lightnovelApp = {
            cookie: 'expired-refresh-token',
            email: 'reader@example.com',
            password: 'secret',
        };
        const { authCalls } = setupMockServer({ refreshSuccess: false, loginSuccess: true });

        const response = await app.request('/lightnovel.app/rank/weekly');
        expect(response.status).toBe(200);
        const feed = await new Parser().parseString(await response.text());
        expect(feed.title).toBe('轻书架 - 近期排行（周榜）');
        expect(feed.link).toBe(`${rootUrl}/book/rank/weekly`);
        expect(feed.items).toHaveLength(2);
        expect(feed.items[0].link).toBe(`${rootUrl}/book/info/21107`);
        expect(feed.items[1].link).toBe(`${rootUrl}/manga/19466`);

        expect(authCalls.map((c) => c.endpoint)).toEqual(['refresh_token', 'login']);
    });

    it('fetches novel and manga chapter feeds from GetBookInfo', async () => {
        setupMockServer();

        const novelRes = await app.request('/lightnovel.app/book/21119');
        expect(novelRes.status).toBe(200);
        const novelFeed = await new Parser().parseString(await novelRes.text());
        expect(novelFeed.title).toBe('轻书架 - 魔女不受项圈束缚 2');
        expect(novelFeed.link).toBe(`${rootUrl}/book/info/21119`);
        expect(novelFeed.items).toHaveLength(2);
        expect(novelFeed.items[0]).toMatchObject({
            title: '魔女不受项圈束缚 2 - 第二章 圣女',
            link: `${rootUrl}/read/21119/2`,
            creator: '梦见夕利',
        });

        const comicRes = await app.request('/lightnovel.app/book/21105');
        expect(comicRes.status).toBe(200);
        const comicFeed = await new Parser().parseString(await comicRes.text());
        expect(comicFeed.title).toBe('轻书架 - 伊藤润二恐怖漫画精选');
        expect(comicFeed.link).toBe(`${rootUrl}/manga/21105`);
        expect(comicFeed.items[0]).toMatchObject({
            title: '伊藤润二恐怖漫画精选 - 第 2 卷',
            link: `${rootUrl}/manga/21105/read/299989`,
            creator: '伊藤润二',
        });
        expect(comicFeed.items[0].content).toContain('251P');
    });

    it('throws ConfigNotFoundError when credentials are missing or invalid', async () => {
        config.lightnovelApp = {};
        const resMissing = await app.request('/lightnovel.app/novel');
        expect(resMissing.status).toBe(503);

        config.lightnovelApp = { cookie: 'invalid-token' };
        setupMockServer({ refreshSuccess: false });
        const resInvalid = await app.request('/lightnovel.app/novel');
        expect(resInvalid.status).toBe(503);
    });
});
