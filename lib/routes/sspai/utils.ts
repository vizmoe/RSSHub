import { load } from 'cheerio';

/** Strip Qiniu imageView2 and allow a document origin referrer. cdnfile.sspai.com 403s with no Referer. */
export function rewriteSspaiImages(html: string | undefined): string {
    if (!html) {
        return '';
    }

    const $ = load(html, undefined, false);
    $('img').each((_, el) => {
        const $el = $(el);
        const src = $el.attr('data-original') || $el.attr('data-src') || $el.attr('src');
        if (!src) {
            return;
        }

        try {
            const url = new URL(src, 'https://cdnfile.sspai.com/');
            if ((url.hostname === 'cdnfile.sspai.com' || url.hostname === 'cdn.sspai.com') && url.search.startsWith('?imageView2')) {
                url.search = '';
            }
            $el.attr('src', url.href);
        } catch {
            $el.attr('src', src.startsWith('//') ? `https:${src}` : `https://cdnfile.sspai.com/${src.replace(/^\//, '')}`);
        }

        $el.removeAttr('data-original');
        $el.removeAttr('data-src');
        $el.attr('referrerpolicy', 'origin');
    });

    return $.html();
}
