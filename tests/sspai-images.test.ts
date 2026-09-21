import { load } from 'cheerio';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../lib/app';
import { config } from '../lib/config';
import server from '../lib/setup.test';
import cache from '../lib/utils/cache';
import md5 from '../lib/utils/md5';
import ofetch from '../lib/utils/ofetch';

vi.mock('../lib/utils/request-rewriter', () => ({}));

const source = 'https://cdnfile.sspai.com/2026/09/12/32887265aa63018a36fa7df7238c8481.jpg';
const testKey = 'test-only-access-key';
const previousKey = config.accessKey;
const previousHotlink = { ...config.hotlink };
const previousIsPackage = config.isPackage;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const imagePath = (url: string) => `/api/sspai/image/${Buffer.from(url).toString('base64url')}`;

beforeEach(() => {
    config.accessKey = testKey;
    config.hotlink = {};
    cache.clients.memoryCache?.clear();
    server.use(
        http.get('https://sspai.com/api/v1/article/index/page/get', () => HttpResponse.json({ data: [{ id: 114495, title: 'Article', released_time: 1_789_920_000, author: { nickname: 'Author' } }] })),
        http.get('https://sspai.com/api/v1/article/info/get', () =>
            HttpResponse.json({
                data: {
                    promote_image: source,
                    body: `<figure><img src="${source}?imageView2/2/w/1120" data-original="${source}?imageView2/2/format/webp"></figure>`,
                },
            })
        )
    );
});

afterEach(() => {
    config.accessKey = previousKey;
    config.hotlink = { ...previousHotlink };
    config.isPackage = previousIsPackage;
    vi.restoreAllMocks();
});

async function feedImages(origin = 'https://rsshub.example', headers?: Record<string, string>) {
    const response = await app.request(`${origin}/sspai/index?key=${config.accessKey}&format=json`, { headers });
    expect(response.status).toBe(200);
    const feed = await response.json();
    expect(feed.items[0].title).toMatch(/^(Article|Cached)$/);
    return load(feed.items[0].content_html)('img');
}

describe('SSPAI images in authenticated feeds', () => {
    it('serves images through the instance without putting its access key in image URLs', async () => {
        const images = await feedImages();
        expect(images).toHaveLength(2);
        for (const image of images) {
            const url = new URL(image.attribs.src);
            expect(url.origin).toBe('https://rsshub.example');
            expect(url.pathname).toMatch(/^\/api\/sspai\/image\//);
            expect(url.searchParams.has('key')).toBe(false);
            expect(url.searchParams.get('code')).toMatch(/^[\da-f]{32}$/);
            expect(url.href).not.toContain(testKey);
            expect(image.attribs.referrerpolicy).toBe('no-referrer');
        }
    });

    it('rewrites old cached descriptions as well as fresh upstream responses', async () => {
        const cached = { title: 'Cached', link: 'https://sspai.com/post/114495', description: `<img src="${source}" referrerpolicy="origin">` };
        vi.spyOn(cache, 'tryGet').mockResolvedValueOnce(cached);
        const images = await feedImages();
        expect(new URL(images[0].attribs.src).origin).toBe('https://rsshub.example');
        expect(images[0].attribs.referrerpolicy).toBe('no-referrer');
    });

    it('returns actual image bytes without a client Referer and never forwards client credentials', async () => {
        server.use(
            http.get(source, ({ request }) => {
                expect(request.headers.get('referer')).toBe('https://sspai.com/');
                expect(request.headers.get('authorization')).toBeNull();
                expect(request.headers.get('cookie')).toBeNull();
                return new HttpResponse(png, { headers: { 'Content-Type': 'image/png' } });
            })
        );
        const images = await feedImages();
        const response = await app.request(images[0].attribs.src, { headers: { Authorization: 'test-only-client', Cookie: 'reader=test-only' } });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('cache-control')).toContain('max-age=');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    });

    it('requires a code for that exact image path', async () => {
        const images = await feedImages();
        const url = new URL(images[0].attribs.src);
        expect((await app.request(url.origin + url.pathname)).status).toBe(403);
        url.pathname = `/api/sspai/image/${Buffer.from(source + '?other-image').toString('base64url')}`;
        expect((await app.request(url.href)).status).toBe(403);
    });

    it('uses the current origin and key on feed cache hits, including HTTPS reverse proxies', async () => {
        const before = await feedImages();
        config.accessKey = 'rotated-test-only-key';
        const after = await feedImages('http://internal:1200', { 'x-forwarded-host': 'feeds.example', 'x-forwarded-proto': 'https' });
        const url = new URL(after[0].attribs.src);
        expect(url.origin).toBe('https://feeds.example');
        expect(url.searchParams.get('code')).toBe(md5(url.pathname + config.accessKey));
        expect(url.searchParams.get('code')).not.toBe(new URL(before[0].attribs.src).searchParams.get('code'));
    });

    it('separates forwarded origins in HTTP caches and uses the proxy-appended hop', async () => {
        const response = await app.request(`https://rsshub.example/sspai/index?key=${testKey}&format=json`);
        expect(response.headers.get('vary')?.toLowerCase()).toContain('x-forwarded-host');
        expect(response.headers.get('vary')?.toLowerCase()).toContain('x-forwarded-proto');
        const images = await feedImages('http://internal:1200', {
            'x-forwarded-host': 'attacker.example, feeds.example',
            'x-forwarded-proto': 'http, https',
        });
        expect(new URL(images[0].attribs.src).origin).toBe('https://feeds.example');
    });

    it('leaves custom image proxy configuration in control', async () => {
        config.hotlink.template = 'https://images.example/${href_ue}';
        const images = await feedImages();
        expect(new URL(images[0].attribs.src).origin).toBe('https://images.example');
        expect(decodeURIComponent(new URL(images[0].attribs.src).pathname)).toBe('/' + source);
    });

    it('respects paths excluded from the configured image proxy', async () => {
        config.hotlink.template = 'https://images.example/${href_ue}';
        config.hotlink.excludePaths = ['/sspai'];
        const images = await feedImages();
        expect(images[0].attribs.src).toBe(source);
    });

    it('works without access control and leaves external images and inline images alone', async () => {
        config.accessKey = '';
        vi.spyOn(cache, 'tryGet').mockResolvedValueOnce({
            title: 'Cached',
            link: 'https://sspai.com/post/114495',
            description: `<img src="${source}" srcset="${source} 2x"><img src="https://example.com/image.png"><img src="data:image/png;base64,${png.toString('base64')}">`,
        });
        const images = await feedImages();
        expect(new URL(images[0].attribs.src).search).toBe('');
        expect(images[0].attribs.srcset).toBeUndefined();
        expect(images[1].attribs.src).toBe('https://example.com/image.png');
        expect(images[2].attribs.src).toBe(`data:image/png;base64,${png.toString('base64')}`);
    });

    it('preserves direct images for library users without a public HTTP server', async () => {
        config.isPackage = true;
        const response = await app.request(`/sspai/index?key=${testKey}`);
        expect(response.status).toBe(200);
        const feed = await response.json();
        const image = load(feed.item[0].description)('img').first();
        expect(image.attr('src')).toBe(source);
        expect(image.attr('referrerpolicy')).toBe('origin');
    });
});

describe('SSPAI image endpoint boundaries', () => {
    beforeEach(() => {
        config.accessKey = '';
    });

    it.each(['https://example.com/image.png', 'https://cdnfile.sspai.com.example.com/image.png', 'https://cdnfile.sspai.com@127.0.0.1/image.png', 'http://cdnfile.sspai.com/image.png', 'https://cdnfile.sspai.com:444/image.png'])(
        'does not fetch disallowed source %s',
        async (url) => {
            const fetchImage = vi.spyOn(ofetch, 'raw');
            expect((await app.request(imagePath(url))).status).toBe(400);
            expect(fetchImage).not.toHaveBeenCalled();
        }
    );

    it.each([
        [302, 'image/png'],
        [403, 'text/html'],
        [200, 'text/html'],
        [200, 'image/svg+xml'],
    ])('rejects upstream status %s and type %s without following redirects', async (status, type) => {
        const forbidden = vi.fn(() => new HttpResponse(png, { headers: { 'Content-Type': 'image/png' } }));
        server.use(
            http.get(source, () => new HttpResponse('unavailable', { status, headers: { 'Content-Type': type, Location: 'https://example.com/private' } })),
            http.get('https://example.com/private', forbidden)
        );
        const response = await app.request(imagePath(source));
        expect(response.status).toBe(502);
        expect(response.headers.get('cache-control')).toBeNull();
        expect(forbidden).not.toHaveBeenCalled();
    });

    it('bounds image size even when the upstream omits Content-Length', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1));
            },
            cancel,
        });
        vi.spyOn(ofetch, 'raw').mockResolvedValueOnce(Object.assign(new Response(null, { headers: { 'Content-Type': 'image/png' } }), { _data: body }));
        const response = await app.request(imagePath(source));
        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Image too large');
        expect(cancel).toHaveBeenCalledOnce();
    });
});
