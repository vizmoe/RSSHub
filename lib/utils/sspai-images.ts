import { load } from 'cheerio';

import { config } from '@/config';
import md5 from '@/utils/md5';

const imageHosts = new Set(['cdnfile.sspai.com', 'cdn.sspai.com']);

export function parseSspaiImageUrl(source: string): URL | undefined {
    try {
        const url = new URL(source);
        if (url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.port && !url.username && !url.password) {
            url.hash = '';
            return url;
        }
    } catch {
        // Leave malformed or unrelated image URLs to the normal feed processing.
    }
}

export function proxySspaiImages(html: string, instanceUrl: URL): string {
    const $ = load(html, undefined, false);
    $('img').each((_, image) => {
        const $image = $(image);
        const source = $image.attr('data-original') || $image.attr('data-src') || $image.attr('src');
        const upstream = source && parseSspaiImageUrl(source);
        if (!upstream) {
            return;
        }
        // Library consumers do not expose an HTTP endpoint for the relay.
        if (config.isPackage) {
            $image.attr('referrerpolicy', 'origin');
            return;
        }

        // The entire upstream URL is in the path so access codes authorize one image only.
        const path = `/api/sspai/image/${Buffer.from(upstream.href).toString('base64url')}`;
        const url = new URL(path, instanceUrl);
        if (config.accessKey) {
            url.searchParams.set('code', md5(path + config.accessKey));
        }
        $image.attr('src', url.href);
        $image.removeAttr('data-original data-src srcset sizes');
        $image.attr('referrerpolicy', 'no-referrer');
    });
    return $.html();
}
