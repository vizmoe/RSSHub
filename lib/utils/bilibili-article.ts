import { load } from 'cheerio';

import { parseBilibiliOpusArticleFromHtml } from '@/utils/bilibili-opus';

interface BilibiliArticleData {
    title?: string;
    description?: string;
    author?: string;
    pubDate?: number | string;
}

interface BilibiliArticleFeedItemOptions {
    article: BilibiliArticleData;
    fallbackTitle: string;
    link: string;
    authenticated: boolean;
}

const authenticatedFullTextGuidSuffix = '#rsshub-authenticated-fulltext-v1';

export function buildBilibiliArticleFeedItem({ article, fallbackTitle, link, authenticated }: BilibiliArticleFeedItemOptions) {
    const description = article.description?.trim();

    // Do not let a transient authenticated fetch failure become a permanent
    // title-only entry in feed readers. The item will be retried on the next
    // route refresh instead.
    if (authenticated && !description) {
        return;
    }

    return {
        title: article.title || fallbackTitle,
        link,
        guid: authenticated ? `${link}${authenticatedFullTextGuidSuffix}` : link,
        description: description || fallbackTitle,
        pubDate: article.pubDate,
        author: article.author,
    };
}

export function parseBilibiliArticlePage(data: string) {
    const $ = load(data);
    const documentTitle = $('title').text().trim();

    if (documentTitle.startsWith('验证码_') || $('.geetest_panel').length > 0) {
        return {};
    }

    const opusArticle = parseBilibiliOpusArticleFromHtml(data);
    const title = $('.opus-module-title__text').first().text().trim() || opusArticle.title || $('meta[property="og:title"]').attr('content')?.trim() || documentTitle.replace(/\s*-\s*哔哩哔哩\s*$/, '');
    const description = opusArticle.description || $('.opus-module-content').first().html()?.trim();
    const author = $('.opus-module-author__name').first().text().trim() || opusArticle.author;
    const pubDate =
        $('.opus-module-author__pub__text')
            .first()
            .text()
            .trim()
            .replace(/^编辑于\s*/, '') || opusArticle.pubDate;

    return {
        title: title || undefined,
        description: description || undefined,
        author: author || undefined,
        pubDate: pubDate || undefined,
    };
}
