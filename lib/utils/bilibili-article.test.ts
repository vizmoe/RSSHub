import { describe, expect, it } from 'vitest';

import { buildBilibiliArticleFeedItem, parseBilibiliArticlePage } from './bilibili-article';

describe('buildBilibiliArticleFeedItem', () => {
    it('does not publish an authenticated title-only fallback', () => {
        const item = buildBilibiliArticleFeedItem({
            article: {
                title: 'Subscriber article',
            },
            fallbackTitle: 'Subscriber article',
            link: 'https://www.bilibili.com/opus/123',
            authenticated: true,
        });

        expect(item).toBeUndefined();
    });

    it('marks an authenticated full-text upgrade with a distinct stable guid', () => {
        const item = buildBilibiliArticleFeedItem({
            article: {
                title: 'Subscriber article',
                description: '<p>Full subscriber body</p>',
            },
            fallbackTitle: 'Subscriber article',
            link: 'https://www.bilibili.com/opus/123',
            authenticated: true,
        });

        expect(item).toMatchObject({
            guid: 'https://www.bilibili.com/opus/123#rsshub-authenticated-fulltext-v1',
            description: '<p>Full subscriber body</p>',
        });
    });

    it('retains the title preview for anonymous feeds', () => {
        const item = buildBilibiliArticleFeedItem({
            article: {},
            fallbackTitle: 'Public preview',
            link: 'https://www.bilibili.com/opus/123',
            authenticated: false,
        });

        expect(item).toMatchObject({
            guid: 'https://www.bilibili.com/opus/123',
            description: 'Public preview',
        });
    });
});

describe('parseBilibiliArticlePage', () => {
    it('extracts the complete opus body and metadata', () => {
        const article = parseBilibiliArticlePage(`
            <html>
                <head><title>Fallback title - 哔哩哔哩</title></head>
                <body>
                    <div class="opus-module-title__text">Full article title</div>
                    <div class="opus-module-author__name">Capital_12</div>
                    <div class="opus-module-author__pub__text">编辑于 2026年07月17日 16:38</div>
                    <div class="opus-module-content"><h2>Heading</h2><p>Subscriber-visible body</p></div>
                    <div class="opus-module-paywall">Paywall prompt</div>
                </body>
            </html>
        `);

        expect(article).toEqual({
            title: 'Full article title',
            description: '<h2>Heading</h2><p>Subscriber-visible body</p>',
            author: 'Capital_12',
            pubDate: '2026年07月17日 16:38',
        });
    });

    it('includes title album images from the Opus page state', () => {
        const article = parseBilibiliArticlePage(`
            <html>
                <head><title>LuvLetter的动态 - 哔哩哔哩</title></head>
                <body>
                    <div class="opus-module-author__name">LuvLetter</div>
                    <div class="opus-module-author__pub__text">2026年08月14日 22:35</div>
                    <div class="opus-module-content"><p>See what surprise is waiting next week</p></div>
                    <script>
                        window.__INITIAL_STATE__={"detail":{"id_str":"1236434128653516805","modules":[{"module_type":"MODULE_TYPE_TOP","module_top":{"display":{"album":{"pics":[{"url":"http://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg","width":5712,"height":4284},{"url":"http://i0.hdslb.com/bfs/new_dyn/135f21e519b0650f9694680d8b8bf3e8546418.jpg","width":4032,"height":3024}]}}}},{"module_type":"MODULE_TYPE_CONTENT","module_content":{"paragraphs":[{"para_type":1,"text":{"nodes":[{"word":{"words":"See what surprise is waiting next week"}}]}}]}}]}};(function() {})();
                    </script>
                </body>
            </html>
        `);

        expect(article).toMatchObject({
            description:
                '<figure><img src="https://i0.hdslb.com/bfs/new_dyn/d77f6f90a886f82d047e05c13283fa08546418.jpg" width="5712" height="4284"><img src="https://i0.hdslb.com/bfs/new_dyn/135f21e519b0650f9694680d8b8bf3e8546418.jpg" width="4032" height="3024"></figure><p>See what surprise is waiting next week</p>',
            author: 'LuvLetter',
            pubDate: '2026年08月14日 22:35',
        });
    });

    it('falls back to the document title when the opus title is unavailable', () => {
        const article = parseBilibiliArticlePage('<html><head><title>Fallback title - 哔哩哔哩</title></head><body></body></html>');

        expect(article.title).toBe('Fallback title');
        expect(article.description).toBeUndefined();
    });

    it('ignores Bilibili verification pages', () => {
        const article = parseBilibiliArticlePage('<html><head><title>验证码_哔哩哔哩</title></head><body></body></html>');

        expect(article).toEqual({});
    });
});
