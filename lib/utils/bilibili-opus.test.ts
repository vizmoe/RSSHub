import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '@/config';
import bilibiliCache from '@/routes/bilibili/cache';
import server from '@/setup.test';
import cache from '@/utils/cache';

import { extractBilibiliOpusImages, extractBilibiliOpusImagesFromHtml, loginBilibiliWithPassword, parseBilibiliOpusArticle, renderBilibiliImages } from './bilibili-opus';

vi.mock('@/utils/request-rewriter', () => ({}));

describe('Bilibili Opus images', () => {
    it('extracts the images from the current Opus content modules', () => {
        const images = extractBilibiliOpusImages({
            data: {
                item: {
                    id_str: '1223675872465125381',
                    modules: [
                        {
                            module_type: 'MODULE_TYPE_CONTENT',
                            module_content: {
                                paragraphs: [
                                    {
                                        para_type: 1,
                                        text: {
                                            nodes: [
                                                {
                                                    word: {
                                                        words: '前两天有人信誓旦旦说印度把苹果机密给泄麻了, 现在看不如 Close AI 一根.',
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        para_type: 2,
                                        pic: {
                                            pics: [
                                                {
                                                    url: 'http://i0.hdslb.com/bfs/new_dyn/45b7f7a65626f65bfef1f6bd1d731287546418.png',
                                                    width: 1376,
                                                    height: 2640,
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        });

        expect(images).toEqual([
            {
                url: 'https://i0.hdslb.com/bfs/new_dyn/45b7f7a65626f65bfef1f6bd1d731287546418.png',
                width: 1376,
                height: 2640,
            },
        ]);
        expect(renderBilibiliImages(images)).toBe('<img src="https://i0.hdslb.com/bfs/new_dyn/45b7f7a65626f65bfef1f6bd1d731287546418.png" width="1376" height="2640">');
    });

    it('normalizes scheme-relative URLs and removes duplicate images', () => {
        const images = extractBilibiliOpusImages({
            data: {
                item: {
                    modules: [
                        {
                            module_type: 'MODULE_TYPE_CONTENT',
                            module_content: {
                                paragraphs: [
                                    {
                                        para_type: 2,
                                        pic: {
                                            pics: [
                                                {
                                                    url: '//i0.hdslb.com/bfs/new_dyn/example.png',
                                                },
                                                {
                                                    url: 'https://i0.hdslb.com/bfs/new_dyn/example.png',
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        });

        expect(images).toEqual([{ url: 'https://i0.hdslb.com/bfs/new_dyn/example.png' }]);
    });

    it('renders a complete article from the Opus detail API', () => {
        const article = parseBilibiliOpusArticle({
            code: 0,
            data: {
                item: {
                    modules: [
                        {
                            module_type: 'MODULE_TYPE_TITLE',
                            module_title: {
                                text: 'Subscriber article',
                            },
                        },
                        {
                            module_type: 'MODULE_TYPE_AUTHOR',
                            module_author: {
                                name: 'Capital_12',
                                pub_ts: 1_752_748_280,
                            },
                        },
                        {
                            module_type: 'MODULE_TYPE_CONTENT',
                            module_content: {
                                paragraphs: [
                                    {
                                        para_type: 1,
                                        text: {
                                            nodes: [
                                                {
                                                    word: {
                                                        words: 'Full body',
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        para_type: 2,
                                        pic: {
                                            pics: [
                                                {
                                                    url: '//i0.hdslb.com/bfs/new_dyn/article.png',
                                                    width: 1200,
                                                    height: 800,
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        para_type: 5,
                                        list: {
                                            items: [
                                                {
                                                    order: 1,
                                                    nodes: [
                                                        {
                                                            word: {
                                                                words: 'First item',
                                                            },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        });

        expect(article).toEqual({
            title: 'Subscriber article',
            description: '<p>Full body</p><figure><img src="https://i0.hdslb.com/bfs/new_dyn/article.png" width="1200" height="800"></figure><ol><li>First item</li></ol>',
            author: 'Capital_12',
            pubDate: 1_752_748_280,
        });
    });

    it('includes title album images from the Opus top module', () => {
        const response = {
            code: 0,
            data: {
                item: {
                    id_str: '1236434128653516805',
                    modules: [
                        {
                            module_type: 'MODULE_TYPE_TOP',
                            module_top: {
                                display: {
                                    album: {
                                        pics: [
                                            {
                                                url: 'http://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg',
                                                width: 5712,
                                                height: 4284,
                                            },
                                            {
                                                url: 'http://i0.hdslb.com/bfs/new_dyn/135f21e519b0650f9694680d8b8bf3e8546418.jpg',
                                                width: 4032,
                                                height: 3024,
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                        {
                            module_type: 'MODULE_TYPE_CONTENT',
                            module_content: {
                                paragraphs: [
                                    {
                                        para_type: 1,
                                        text: {
                                            nodes: [
                                                {
                                                    word: {
                                                        words: 'See what surprise is waiting next week',
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        };

        expect(extractBilibiliOpusImages(response)).toEqual([
            {
                url: 'https://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg',
                width: 5712,
                height: 4284,
            },
            {
                url: 'https://i0.hdslb.com/bfs/new_dyn/135f21e519b0650f9694680d8b8bf3e8546418.jpg',
                width: 4032,
                height: 3024,
            },
        ]);
        expect(parseBilibiliOpusArticle(response)).toMatchObject({
            description:
                '<figure><img src="https://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg" width="5712" height="4284"><img src="https://i0.hdslb.com/bfs/new_dyn/135f21e519b0650f9694680d8b8bf3e8546418.jpg" width="4032" height="3024"></figure><p>See what surprise is waiting next week</p>',
        });
    });

    it('extracts title album images from an Opus page fallback', () => {
        const images = extractBilibiliOpusImagesFromHtml(`
            <html>
                <body>
                    <script>
                        window.__INITIAL_STATE__={"detail":{"id_str":"1236434128653516805","modules":[{"module_type":"MODULE_TYPE_TOP","module_top":{"display":{"album":{"pics":[{"url":"http://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg","width":5712,"height":4284}]}}}}]}};(function() {})();
                    </script>
                </body>
            </html>
        `);

        expect(images).toEqual([
            {
                url: 'https://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg',
                width: 5712,
                height: 4284,
            },
        ]);
    });

    it('extracts current content-module images from an Opus page fallback', () => {
        const images = extractBilibiliOpusImagesFromHtml(`
            <html>
                <body>
                    <script>
                        window.__INITIAL_STATE__={"detail":{"id_str":"1223675872465125381","modules":[{"module_type":"MODULE_TYPE_CONTENT","module_content":{"paragraphs":[{"para_type":2,"pic":{"pics":[{"url":"http://i0.hdslb.com/bfs/new_dyn/45b7f7a65626f65bfef1f6bd1d731287546418.png","width":1376,"height":2640}]}}]}}]}};(function() {})();
                    </script>
                </body>
            </html>
        `);

        expect(images).toEqual([
            {
                url: 'https://i0.hdslb.com/bfs/new_dyn/45b7f7a65626f65bfef1f6bd1d731287546418.png',
                width: 1376,
                height: 2640,
            },
        ]);
    });
});

describe('Bilibili password authentication', () => {
    const previousUsername = config.bilibili.username;
    const previousPassword = config.bilibili.password;
    const previousUsernames = { ...config.bilibili.usernames };
    const previousPasswords = { ...config.bilibili.passwords };
    const { publicKey: publicKeyObject, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 1024,
    });
    const publicKey = publicKeyObject.export({
        type: 'spki',
        format: 'pem',
    }) as string;

    afterEach(() => {
        config.bilibili.username = previousUsername;
        config.bilibili.password = previousPassword;
        config.bilibili.usernames = { ...previousUsernames };
        config.bilibili.passwords = { ...previousPasswords };
        cache.clients.memoryCache?.clear();
    });

    it('encrypts password with RSA salt and returns authenticated session cookies for BILIBILI_USERNAME_{uid} and BILIBILI_PASSWORD_{uid}', async () => {
        config.bilibili.usernames['760451'] = 'user@example.com';
        config.bilibili.passwords['760451'] = 'my_secret_pwd';

        let decryptedPayload = '';
        server.use(
            http.get('https://passport.bilibili.com/x/passport-login/web/key', () =>
                HttpResponse.json({
                    code: 0,
                    data: {
                        hash: 'salt_hash_123_',
                        key: publicKey,
                    },
                })
            ),
            http.post('https://passport.bilibili.com/x/passport-login/oauth2/login', async ({ request }) => {
                const body = new URLSearchParams(await request.text());
                expect(body.get('username')).toBe('user@example.com');
                expect(body.get('sign')).toMatch(/^[a-f0-9]{32}$/);
                const encrypted = Buffer.from(body.get('password')!, 'base64');
                decryptedPayload = privateDecrypt(
                    {
                        key: privateKey,
                        padding: constants.RSA_PKCS1_PADDING,
                    },
                    encrypted
                ).toString('utf8');

                return HttpResponse.json({
                    code: 0,
                    data: {
                        status: 0,
                        cookie_info: {
                            cookies: [
                                { name: 'SESSDATA', value: 'sessdata_from_pwd' },
                                { name: 'bili_jct', value: 'csrf_token_123' },
                                { name: 'DedeUserID', value: '2267573' },
                            ],
                        },
                    },
                });
            })
        );

        const cookie = await bilibiliCache.getAuthenticatedCookie();
        expect(decryptedPayload).toBe('salt_hash_123_my_secret_pwd');
        expect(cookie).toContain('SESSDATA=sessdata_from_pwd');
        expect(cookie).toContain('bili_jct=csrf_token_123');
        expect(cookie).toContain('DedeUserID=2267573');
        expect(cookie).toMatch(/b_lsid=[0-9A-F]+_[0-9A-F]+/);
    });

    it('throws CaptchaError when Bilibili passport triggers Geetest verification', async () => {
        server.use(
            http.get('https://passport.bilibili.com/x/passport-login/web/key', () =>
                HttpResponse.json({
                    code: 0,
                    data: {
                        hash: 'salt_hash_123_',
                        key: publicKey,
                    },
                })
            ),
            http.post('https://passport.bilibili.com/x/passport-login/oauth2/login', () =>
                HttpResponse.json({
                    code: -105,
                    message: '验证码错误',
                    data: {
                        status: 0,
                        url: 'https://www.bilibili.com/h5/project-msg-auth/verify?ct=geetest',
                    },
                })
            )
        );

        await expect(loginBilibiliWithPassword('user@example.com', 'secret')).rejects.toMatchObject({
            name: 'CaptchaError',
        });
    });
});
