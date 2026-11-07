import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import type { Context } from 'hono';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import RejectError from '@/errors/types/reject';
import type { Data, DataItem } from '@/types';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const rootUrl = 'https://www.lightnovel.app';
export const apiBaseUrl = 'https://api.lightnovel.life';

const recordSeparator = '\u{1E}';
const defaultLimit = 24;

export const novelOrderOptions = {
    latest: '最近更新',
    new: '上架时间',
    view: '总点击量',
} as const;

export const novelCategoryOptions: Record<string, { id?: number; label: string }> = {
    all: { label: '全部类型' },
    '1': { id: 1, label: '录入完成' },
    '2': { id: 2, label: '翻译完成' },
    '3': { id: 3, label: '翻译中' },
    '4': { id: 4, label: '录入中' },
    '5': { id: 5, label: '转载' },
    '7': { id: 7, label: '原创' },
    '8': { id: 8, label: 'AI翻译' },
};

export const rankTypeOptions: Record<string, { days: number; label: string }> = {
    daily: { days: 1, label: '日榜' },
    weekly: { days: 7, label: '周榜' },
    monthly: { days: 31, label: '月榜' },
};

export const requireConfig = [
    {
        name: 'LIGHTNOVEL_APP_COOKIE',
        optional: true,
        description: '轻书架认证凭据（支持填入浏览器 IndexedDB `LightNovelShelf` 中的 `RefreshToken`、`RefreshToken=...` Cookie 字符串或 `Bearer` JWT Token）；与账号密码二选一配置即可。',
    },
    {
        name: 'LIGHTNOVEL_APP_EMAIL',
        optional: true,
        description: '轻书架登录邮箱（也可使用 `LIGHTNOVEL_APP_USERNAME`）；若未配置 `LIGHTNOVEL_APP_COOKIE`，则需与 `LIGHTNOVEL_APP_PASSWORD` 一起配置。',
    },
    {
        name: 'LIGHTNOVEL_APP_PASSWORD',
        optional: true,
        description: '轻书架登录密码（支持明文密码或 SHA-256 十六进制哈希值）。',
    },
];

interface ParsedCredential {
    refreshToken?: string;
    accessToken?: string;
}

interface BookCategory {
    Name?: string;
    ShortName?: string;
    Color?: string;
    name?: string;
    shortName?: string;
    color?: string;
}

interface BookCardItem {
    Id?: number;
    id?: number;
    Title?: string;
    title?: string;
    Cover?: string;
    cover?: string;
    UserName?: string;
    userName?: string;
    LastUpdatedAt?: string;
    lastUpdatedAt?: string;
    Type?: 'Novel' | 'Comic';
    type?: 'Novel' | 'Comic';
    SeriesTitle?: string;
    seriesTitle?: string;
    Category?: BookCategory;
    category?: BookCategory;
}

interface PagedBookResponse {
    Data?: BookCardItem[];
    data?: BookCardItem[];
}

interface ComicListItem {
    Id?: number;
    id?: number;
    Title?: string;
    title?: string;
    OriginalTitle?: string;
    originalTitle?: string;
    Count?: number;
    count?: number;
    Cover?: string;
    cover?: string;
    LastUpdatedAt?: string;
    lastUpdatedAt?: string;
}

interface PagedComicResponse {
    Data?: ComicListItem[];
    data?: ComicListItem[];
}

interface ChapterSummary {
    Id?: number;
    id?: number;
    SortNum?: number;
    sortNum?: number;
    Title?: string;
    title?: string;
    CreatedAt?: string;
    createdAt?: string;
    UpdatedAt?: string | null;
    updatedAt?: string | null;
    PageCount?: number;
    pageCount?: number;
}

interface BookDetail {
    Id?: number;
    id?: number;
    Type?: 'Novel' | 'Comic';
    type?: 'Novel' | 'Comic';
    Cover?: string;
    cover?: string;
    Title?: string;
    title?: string;
    Author?: string;
    author?: string;
    Introduction?: string;
    introduction?: string;
    LastUpdatedAt?: string;
    lastUpdatedAt?: string;
    Category?: BookCategory;
    category?: BookCategory;
    User?: {
        UserName?: string;
        userName?: string;
    };
    user?: {
        UserName?: string;
        userName?: string;
    };
    Extra?: {
        classification?: {
            author?: string;
            series_name?: string;
            series_name_cn?: string;
            tags?: string[];
        };
    };
    extra?: {
        classification?: {
            author?: string;
            series_name?: string;
            series_name_cn?: string;
            tags?: string[];
        };
    };
    Chapters?: ChapterSummary[];
    chapters?: ChapterSummary[];
}

interface BookInfoResponse {
    Book?: BookDetail;
    book?: BookDetail;
    SeriesTitle?: string;
    seriesTitle?: string;
}

const isJwt = (value: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value);

const isJwtValid = (token: string): boolean => {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return false;
    }
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: number };
        if (typeof payload.exp === 'number') {
            return payload.exp * 1000 > Date.now() + 3000;
        }
        return true;
    } catch {
        return false;
    }
};

export const parseCredential = (raw?: string): ParsedCredential => {
    const trimmed = raw?.trim();
    if (!trimmed) {
        return {};
    }

    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const refreshToken = [parsed.RefreshToken, parsed.refreshToken, parsed.refresh_token].find((v): v is string => typeof v === 'string' && v.trim().length > 0)?.trim();
            const accessToken = [parsed.Token, parsed.token, parsed.accessToken, parsed.access_token].find((v): v is string => typeof v === 'string' && v.trim().length > 0)?.trim();
            return {
                ...(refreshToken && { refreshToken }),
                ...(accessToken && { accessToken: accessToken.replace(/^Bearer\s+/i, '').trim() }),
            };
        } catch {
            // Fall through to string parsing
        }
    }

    if (/^Bearer\s+/i.test(trimmed)) {
        const token = trimmed.replace(/^Bearer\s+/i, '').trim();
        return isJwt(token) ? { accessToken: token } : { refreshToken: token };
    }

    if (trimmed.includes('=')) {
        let refreshToken: string | undefined;
        let accessToken: string | undefined;
        for (const part of trimmed.split(';')) {
            const separatorIndex = part.indexOf('=');
            if (separatorIndex <= 0) {
                continue;
            }
            const key = part.slice(0, separatorIndex).trim().toLowerCase();
            const value = part
                .slice(separatorIndex + 1)
                .trim()
                .replaceAll(/^"|"$/g, '');
            if (!value) {
                continue;
            }
            if (key === 'refreshtoken' || key === 'refresh_token') {
                refreshToken = value;
            } else if (['token', 'accesstoken', 'access_token', 'authorization'].includes(key)) {
                const normalized = value.replace(/^Bearer\s+/i, '').trim();
                if (isJwt(normalized)) {
                    accessToken = normalized;
                } else if (!refreshToken) {
                    refreshToken = normalized;
                }
            }
        }
        if (refreshToken || accessToken) {
            return {
                ...(refreshToken && { refreshToken }),
                ...(accessToken && { accessToken }),
            };
        }
    }

    return isJwt(trimmed) ? { accessToken: trimmed } : { refreshToken: trimmed };
};

export const hashPassword = (password: string): string => {
    const trimmed = password.trim();
    if (/^[a-f\d]{64}$/i.test(trimmed)) {
        return trimmed.toLowerCase();
    }
    return createHash('sha256').update(trimmed).digest('hex');
};

const getCommonHeaders = (deviceId: string, accessToken?: string): Record<string, string> => ({
    Accept: 'application/json',
    Origin: rootUrl,
    Referer: `${rootUrl}/`,
    'x-id': deviceId,
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
});

const exchangeRefreshToken = async (refreshToken: string, deviceId: string): Promise<{ token?: string; message?: string }> => {
    const response = await ofetch<{
        Response?: string | null;
        response?: string | null;
        Success?: boolean;
        success?: boolean;
        Msg?: string | null;
        msg?: string | null;
    }>(`${apiBaseUrl}/api/user/refresh_token`, {
        method: 'POST',
        headers: {
            ...getCommonHeaders(deviceId),
            'Content-Type': 'application/json',
        },
        body: { token: refreshToken },
    });

    const success = response?.Success ?? response?.success;
    const token = response?.Response ?? response?.response;
    const message = response?.Msg ?? response?.msg ?? undefined;
    if (success && typeof token === 'string' && token.length > 0) {
        return { token };
    }
    return { message: message || '无效token' };
};

const loginWithPassword = async (email: string, passwordHash: string, deviceId: string): Promise<{ accessToken: string; refreshToken?: string }> => {
    const response = await ofetch<{
        Response?: { Token?: string; RefreshToken?: string; token?: string; refreshToken?: string } | null;
        response?: { Token?: string; RefreshToken?: string; token?: string; refreshToken?: string } | null;
        Success?: boolean;
        success?: boolean;
        Msg?: string | null;
        msg?: string | null;
    }>(`${apiBaseUrl}/api/user/login`, {
        method: 'POST',
        headers: {
            ...getCommonHeaders(deviceId),
            'Content-Type': 'application/json',
        },
        body: {
            email,
            password: passwordHash,
        },
    });

    const success = response?.Success ?? response?.success;
    const payload = response?.Response ?? response?.response;
    const accessToken = payload?.Token ?? payload?.token;
    const refreshToken = payload?.RefreshToken ?? payload?.refreshToken;
    const message = response?.Msg ?? response?.msg;

    if (!success || !accessToken) {
        throw new ConfigNotFoundError(`轻书架账号登录失败（${message || '账号或密码错误'}），请检查 LIGHTNOVEL_APP_EMAIL 和 LIGHTNOVEL_APP_PASSWORD。`);
    }

    return {
        accessToken,
        ...(refreshToken && { refreshToken }),
    };
};

const getAccessToken = async (): Promise<{ accessToken: string; deviceId: string }> => {
    const { refreshToken: configuredRefreshToken, accessToken: configuredAccessToken } = parseCredential(config.lightnovelApp.cookie);
    const email = config.lightnovelApp.email?.trim();
    const password = config.lightnovelApp.password?.trim();

    if (!configuredAccessToken && !configuredRefreshToken && !(email && password)) {
        throw new ConfigNotFoundError('轻书架路由需要认证，请配置 LIGHTNOVEL_APP_COOKIE 或 LIGHTNOVEL_APP_EMAIL + LIGHTNOVEL_APP_PASSWORD。');
    }

    const identitySeed = configuredRefreshToken || email || configuredAccessToken || 'rsshub';
    const deviceId = md5(`lightnovel.app:device:${identitySeed}`);

    if (configuredAccessToken) {
        if (isJwtValid(configuredAccessToken)) {
            return { accessToken: configuredAccessToken, deviceId };
        }
        if (!configuredRefreshToken && !(email && password)) {
            throw new ConfigNotFoundError('轻书架 Token 已过期，请更新 LIGHTNOVEL_APP_COOKIE 或配置账号密码。');
        }
    }

    if (configuredRefreshToken) {
        const refreshed = await exchangeRefreshToken(configuredRefreshToken, deviceId);
        if (refreshed.token) {
            return { accessToken: refreshed.token, deviceId };
        }
        if (!(email && password)) {
            throw new ConfigNotFoundError(`轻书架 Cookie/RefreshToken 失效（${refreshed.message}），请更新 LIGHTNOVEL_APP_COOKIE。`);
        }
    }

    const passwordHash = hashPassword(password!);
    const refreshCacheKey = `lightnovel.app:refresh-token:${md5(`${email}:${passwordHash}`)}`;
    const cachedRefreshToken = await cache.get(refreshCacheKey);
    if (cachedRefreshToken) {
        const refreshed = await exchangeRefreshToken(cachedRefreshToken, deviceId);
        if (refreshed.token) {
            return { accessToken: refreshed.token, deviceId };
        }
    }

    const loginResult = await loginWithPassword(email!, passwordHash, deviceId);
    if (loginResult.refreshToken) {
        await cache.set(refreshCacheKey, loginResult.refreshToken, config.cache.contentExpire);
    }
    return { accessToken: loginResult.accessToken, deviceId };
};

export const invokeHubMethod = async <T>(target: string, arg: Record<string, unknown>): Promise<T> => {
    const { accessToken, deviceId } = await getAccessToken();
    const headers = getCommonHeaders(deviceId, accessToken);

    const negotiation = await ofetch<{
        connectionToken?: string;
        connectionId?: string;
    }>(`${apiBaseUrl}/hub/api/negotiate?negotiateVersion=1`, {
        method: 'POST',
        headers,
        body: '',
    });

    const connectionToken = negotiation?.connectionToken || negotiation?.connectionId;
    if (!connectionToken) {
        throw new Error('轻书架实时接口握手失败：未返回 connectionToken。');
    }

    const hubUrl = `${apiBaseUrl}/hub/api?id=${encodeURIComponent(connectionToken)}`;

    try {
        await ofetch(`${hubUrl}&_=${Date.now()}`, {
            method: 'GET',
            headers,
            responseType: 'text',
        });

        const frames = `${JSON.stringify({ protocol: 'json', version: 1 })}${recordSeparator}${JSON.stringify({
            type: 1,
            invocationId: '1',
            target,
            arguments: [arg, { UseGzip: false }],
        })}${recordSeparator}`;

        await ofetch(hubUrl, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'text/plain;charset=UTF-8',
            },
            body: frames,
            responseType: 'text',
        });

        for (let attempt = 0; attempt < 3; attempt++) {
            // eslint-disable-next-line no-await-in-loop
            const pollResponse = await ofetch(`${hubUrl}&_=${Date.now() + attempt + 1}`, {
                method: 'GET',
                headers,
                responseType: 'text',
            });

            for (const rawFrame of pollResponse.split(recordSeparator)) {
                const trimmedFrame = rawFrame.trim();
                if (!trimmedFrame) {
                    continue;
                }
                const message = JSON.parse(trimmedFrame) as {
                    type?: number;
                    invocationId?: string;
                    error?: string;
                    result?: {
                        response?: T;
                        Response?: T;
                        success?: boolean;
                        Success?: boolean;
                        msg?: string;
                        Msg?: string;
                    };
                };

                if (message.type !== 3 || message.invocationId !== '1') {
                    continue;
                }

                if (message.error) {
                    if (message.error.toLowerCase().includes('user is unauthorized')) {
                        throw new ConfigNotFoundError('轻书架登录状态未授权或已失效，请检查认证配置。');
                    }
                    throw new RejectError(`轻书架接口调用失败：${message.error}`);
                }

                const result = message.result;
                const success = result?.success ?? result?.Success;
                const msg = result?.msg ?? result?.Msg ?? '';
                if (!success) {
                    if (msg.toLowerCase().includes('user is unauthorized')) {
                        throw new ConfigNotFoundError('轻书架登录状态未授权或已失效，请检查认证配置。');
                    }
                    throw new RejectError(`轻书架接口返回错误：${msg || '未知错误'}`);
                }

                return (result?.response ?? result?.Response) as T;
            }
        }

        throw new Error(`轻书架接口 ${target} 未返回调用结果。`);
    } finally {
        try {
            await ofetch(hubUrl, {
                method: 'DELETE',
                headers,
                responseType: 'text',
            });
        } catch {
            // Ignore transport cleanup errors
        }
    }
};

const parseLimit = (ctx: Context, fallback = defaultLimit): number => {
    const requested = Number(ctx.req.query('limit'));
    return Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 50) : fallback;
};

const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const formatBookCardItem = (book: BookCardItem, rank?: number): DataItem => {
    const id = book.Id ?? book.id;
    const title = (book.Title ?? book.title)?.trim();
    const cover = book.Cover ?? book.cover;
    const username = (book.UserName ?? book.userName)?.trim();
    const lastUpdatedAt = book.LastUpdatedAt ?? book.lastUpdatedAt;
    const type = book.Type ?? book.type ?? 'Novel';
    const seriesTitle = (book.SeriesTitle ?? book.seriesTitle)?.trim();
    const categoryName = (book.Category?.Name ?? book.category?.name)?.trim();
    const link = type === 'Comic' ? `${rootUrl}/manga/${id}` : `${rootUrl}/book/info/${id}`;

    const metaParts: string[] = [];
    if (rank !== undefined) {
        metaParts.push(`<p><strong>排名：</strong>#${rank}</p>`);
    }
    metaParts.push(`<p><strong>类型：</strong>${type === 'Comic' ? '漫画' : '小说'}${categoryName ? ` · ${escapeHtml(categoryName)}` : ''}</p>`);
    if (seriesTitle) {
        metaParts.push(`<p><strong>系列：</strong>${escapeHtml(seriesTitle)}</p>`);
    }
    if (username) {
        metaParts.push(`<p><strong>发布者：</strong>${escapeHtml(username)}</p>`);
    }
    if (cover) {
        metaParts.unshift(`<p><img src="${escapeHtml(cover)}" alt="${escapeHtml(title || '')}"></p>`);
    }

    const categories = [type === 'Comic' ? '漫画' : '小说', categoryName, seriesTitle].filter((item): item is string => Boolean(item));
    const pubDate = lastUpdatedAt ? parseDate(lastUpdatedAt) : undefined;

    return {
        title: title || `作品 #${id}`,
        link,
        description: metaParts.join(''),
        ...(username && { author: username }),
        ...(categories.length > 0 && { category: categories }),
        ...(pubDate && !Number.isNaN(pubDate.getTime()) && { pubDate }),
        ...(cover && { image: cover }),
    };
};

export async function getLightNovelListFeed(ctx: Context): Promise<Data> {
    const order = ctx.req.param('order') ?? 'latest';
    if (!Object.hasOwn(novelOrderOptions, order)) {
        throw new InvalidParameterError(`不支持的排序方式：${order}，可选值为 latest、new、view。`);
    }

    const categoryKey = ctx.req.param('category') ?? 'all';
    const categoryOption = novelCategoryOptions[categoryKey];
    if (!categoryOption) {
        throw new InvalidParameterError(`不支持的小说类型：${categoryKey}。`);
    }

    const limit = parseLimit(ctx);
    const response = await invokeHubMethod<PagedBookResponse>('GetBookList', {
        Page: 1,
        Order: order,
        Size: limit,
        IgnoreJapanese: false,
        IgnoreAI: false,
        ...(categoryOption.id && { CategoryId: categoryOption.id }),
    });

    const books = response?.Data ?? response?.data ?? [];
    const items = books.slice(0, limit).map((book) => formatBookCardItem(book));
    const orderLabel = novelOrderOptions[order as keyof typeof novelOrderOptions];

    return {
        title: `轻书架 - 小说列表 - ${categoryOption.label}（${orderLabel}）`,
        link: `${rootUrl}/novel/list`,
        description: `轻书架小说列表 - ${categoryOption.label} - ${orderLabel}`,
        language: 'zh-CN',
        item: items,
    };
}

export async function getLightNovelMangaFeed(ctx: Context): Promise<Data> {
    const order = ctx.req.param('order') ?? 'latest';
    if (!Object.hasOwn(novelOrderOptions, order)) {
        throw new InvalidParameterError(`不支持的排序方式：${order}，可选值为 latest、new、view。`);
    }

    const limit = parseLimit(ctx);
    const response = await invokeHubMethod<PagedComicResponse>('GetComicList', {
        Page: 1,
        Size: limit,
        Order: order,
    });

    const comics = response?.Data ?? response?.data ?? [];
    const items: DataItem[] = comics.slice(0, limit).map((comic) => {
        const id = comic.Id ?? comic.id;
        const title = (comic.Title ?? comic.title)?.trim() || `漫画 #${id}`;
        const originalTitle = (comic.OriginalTitle ?? comic.originalTitle)?.trim();
        const count = comic.Count ?? comic.count;
        const cover = comic.Cover ?? comic.cover;
        const lastUpdatedAt = comic.LastUpdatedAt ?? comic.lastUpdatedAt;
        const pubDate = lastUpdatedAt ? parseDate(lastUpdatedAt) : undefined;

        const descriptionParts: string[] = [];
        if (cover) {
            descriptionParts.push(`<p><img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}"></p>`);
        }
        if (originalTitle) {
            descriptionParts.push(`<p><strong>原名：</strong>${escapeHtml(originalTitle)}</p>`);
        }
        if (typeof count === 'number') {
            descriptionParts.push(`<p><strong>当前话数：</strong>共 ${count} 话</p>`);
        }

        return {
            title,
            link: `${rootUrl}/manga/${id}`,
            description: descriptionParts.join(''),
            category: ['漫画', ...(originalTitle ? [originalTitle] : [])],
            ...(pubDate && !Number.isNaN(pubDate.getTime()) && { pubDate }),
            ...(cover && { image: cover }),
        };
    });

    const orderLabel = novelOrderOptions[order as keyof typeof novelOrderOptions];

    return {
        title: `轻书架 - 漫画列表（${orderLabel}）`,
        link: `${rootUrl}/manga/list`,
        description: `轻书架漫画列表 - ${orderLabel}`,
        language: 'zh-CN',
        item: items,
    };
}

export async function getLightNovelRankFeed(ctx: Context): Promise<Data> {
    const type = ctx.req.param('type') ?? 'daily';
    const rankOption = rankTypeOptions[type];
    if (!rankOption) {
        throw new InvalidParameterError(`不支持的排行榜类型：${type}，可选值为 daily、weekly、monthly。`);
    }

    const limit = parseLimit(ctx, 50);
    const books = await invokeHubMethod<BookCardItem[]>('GetRank', {
        Days: rankOption.days,
    });

    const items = (books ?? []).slice(0, limit).map((book, index) => formatBookCardItem(book, index + 1));

    return {
        title: `轻书架 - 近期排行（${rankOption.label}）`,
        link: `${rootUrl}/book/rank/${type}`,
        description: `轻书架近期排行 - ${rankOption.label}`,
        language: 'zh-CN',
        item: items,
    };
}

export async function getLightNovelBookFeed(ctx: Context): Promise<Data> {
    const idParam = ctx.req.param('id');
    if (!idParam || !/^[1-9]\d*$/.test(idParam)) {
        throw new InvalidParameterError('作品 ID 必须为正整数。');
    }

    const bookId = Number(idParam);
    const limit = parseLimit(ctx, 50);
    const response = await invokeHubMethod<BookInfoResponse>('GetBookInfo', {
        Id: bookId,
    });

    const book = response?.Book ?? response?.book;
    if (!book) {
        throw new RejectError(`未找到 ID 为 ${bookId} 的作品。`);
    }

    const id = book.Id ?? book.id ?? bookId;
    const type = book.Type ?? book.type ?? 'Novel';
    const isComic = type === 'Comic';
    const title = (book.Title ?? book.title)?.trim() || `作品 #${id}`;
    const cover = book.Cover ?? book.cover;
    const classification = book.Extra?.classification ?? book.extra?.classification;
    const author = (book.Author ?? book.author ?? classification?.author ?? book.User?.UserName ?? book.user?.userName)?.trim();
    const rawIntroduction = (book.Introduction ?? book.introduction)?.trim() || '';
    const $intro = load(rawIntroduction);
    $intro('script, style').remove();
    const plainIntro = $intro.text().trim();
    const cleanIntroHtml = $intro('body').html()?.trim() || '';

    const tags = [isComic ? '漫画' : '小说', ...(classification?.tags ?? [])].filter((tag): tag is string => Boolean(tag));
    const chapters = [...(book.Chapters ?? book.chapters ?? [])].toReversed().slice(0, limit);

    const items: DataItem[] = chapters.map((chapter) => {
        const chapterId = chapter.Id ?? chapter.id;
        const sortNum = chapter.SortNum ?? chapter.sortNum ?? 1;
        const chapterTitle = (chapter.Title ?? chapter.title)?.trim() || `第 ${sortNum} 章`;
        const dateValue = chapter.UpdatedAt ?? chapter.updatedAt ?? chapter.CreatedAt ?? chapter.createdAt;
        const pubDate = dateValue ? parseDate(dateValue) : undefined;
        const pageCount = chapter.PageCount ?? chapter.pageCount;

        const descParts: string[] = [];
        if (cover) {
            descParts.push(`<p><img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}"></p>`);
        }
        descParts.push(`<p><strong>《${escapeHtml(title)}》</strong> - ${escapeHtml(chapterTitle)}</p>`);
        if (isComic && typeof pageCount === 'number' && pageCount > 0) {
            descParts.push(`<p><strong>页数：</strong>${pageCount}P</p>`);
        }
        if (cleanIntroHtml) {
            descParts.push(cleanIntroHtml);
        }

        return {
            title: `${title} - ${chapterTitle}`,
            link: isComic ? `${rootUrl}/manga/${id}/read/${chapterId}` : `${rootUrl}/read/${id}/${sortNum}`,
            description: descParts.join(''),
            ...(author && { author }),
            ...(tags.length > 0 && { category: tags }),
            ...(pubDate && !Number.isNaN(pubDate.getTime()) && { pubDate }),
            ...(cover && { image: cover }),
        };
    });

    return {
        title: `轻书架 - ${title}`,
        link: isComic ? `${rootUrl}/manga/${id}` : `${rootUrl}/book/info/${id}`,
        ...(plainIntro && { description: plainIntro }),
        ...(cover && { image: cover }),
        language: 'zh-CN',
        item: items,
    };
}
