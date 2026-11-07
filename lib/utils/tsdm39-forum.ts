import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import RejectError from '@/errors/types/reject';
import type { Data, DataItem } from '@/types';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

interface DiscuzForumSite {
    cachePrefix: string;
    cookieEnvName: string;
    usernameEnvName: string;
    passwordEnvName: string;
    rootUrl: string;
    siteName: string;
    getCredentials: () => {
        cookie?: string;
        username?: string;
        password?: string;
    };
}

interface DiscuzSessionState {
    cookie?: string;
    source: 'cookie' | 'password' | 'none';
    username?: string;
    password?: string;
}

const tsdmSite: DiscuzForumSite = {
    cachePrefix: 'tsdm39',
    cookieEnvName: 'TSDM39_COOKIES',
    usernameEnvName: 'TSDM39_USERNAME',
    passwordEnvName: 'TSDM39_PASSWORD',
    rootUrl: 'https://www.tsdm39.com',
    siteName: '天使动漫论坛',
    getCredentials: () => config.tsdm39,
};

const ritdonSite: DiscuzForumSite = {
    cachePrefix: 'ritdon',
    cookieEnvName: 'RITDON_COOKIES',
    usernameEnvName: 'RITDON_USERNAME',
    passwordEnvName: 'RITDON_PASSWORD',
    rootUrl: 'https://ritdon.com',
    siteName: '深夜读书会',
    getCredentials: () => config.ritdon,
};

function extractSetCookies(headers: Headers): Record<string, string> {
    const rawCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie')?.split(/,(?=[^;=]+=[^;])/) ?? []);
    const cookies: Record<string, string> = {};
    for (const rawCookie of rawCookies) {
        const firstPart = rawCookie.split(';', 1)[0]?.trim();
        if (!firstPart) {
            continue;
        }
        const eqIndex = firstPart.indexOf('=');
        if (eqIndex <= 0) {
            continue;
        }
        const name = firstPart.slice(0, eqIndex).trim();
        const value = firstPart.slice(eqIndex + 1).trim();
        if (name && value && value !== 'deleted') {
            cookies[name] = value;
        }
    }
    return cookies;
}

function extractLoginErrorMessage(rawXml: string): string {
    const cdata = rawXml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? rawXml;
    const withoutScripts = cdata.replaceAll(/<script[\s\S]*?<\/script>/gi, '');
    const text = load(withoutScripts).text().trim();
    return text;
}

async function loginDiscuzWithPassword(site: DiscuzForumSite, username: string, password: string): Promise<string> {
    const loginField = username.includes('@') ? 'email' : 'username';
    const body = new URLSearchParams({
        fastloginfield: loginField,
        loginfield: loginField,
        username,
        password,
        quickforward: 'yes',
        handlekey: 'ls',
        cookietime: '2592000',
        questionid: '0',
        answer: '',
    }).toString();

    const response = await ofetch.raw(`${site.rootUrl}/member.php?mod=logging&action=login&loginsubmit=yes&infloat=yes&lssubmit=yes&inajax=1`, {
        method: 'POST',
        responseType: 'text',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${site.rootUrl}/forum.php`,
        },
        body,
    });

    const cookies = extractSetCookies(response.headers);
    const hasAuthCookie = Object.keys(cookies).some((name) => name === 'auth' || name.endsWith('_auth'));
    if (!hasAuthCookie) {
        const reason = extractLoginErrorMessage(response._data ?? '');
        throw new ConfigNotFoundError(`${site.siteName}登录失效，账号密码登录失败：${reason || `请检查 ${site.usernameEnvName} 与 ${site.passwordEnvName}。`}`);
    }

    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

async function getPasswordSessionCookie(site: DiscuzForumSite, username: string, password: string, forceRefresh = false): Promise<string> {
    const cacheKey = `${site.cachePrefix}:auth:${md5(`${username}:${password}`)}`;
    if (forceRefresh) {
        const cookie = await loginDiscuzWithPassword(site, username, password);
        await cache.set(cacheKey, cookie, config.cache.contentExpire);
        return cookie;
    }

    return (await cache.tryGet(cacheKey, () => loginDiscuzWithPassword(site, username, password), config.cache.contentExpire, false)) as string;
}

async function createSessionState(site: DiscuzForumSite): Promise<DiscuzSessionState> {
    const credentials = site.getCredentials();
    const configuredCookie = credentials.cookie?.trim() || undefined;
    const username = credentials.username?.trim() || undefined;
    const password = credentials.password || undefined;

    if (configuredCookie) {
        return {
            cookie: configuredCookie,
            source: 'cookie',
            username,
            password,
        };
    }

    if (username && password) {
        const cookie = await getPasswordSessionCookie(site, username, password);
        return {
            cookie,
            source: 'password',
            username,
            password,
        };
    }

    return {
        cookie: undefined,
        source: 'none',
    };
}

async function requestForumDocument(url: string, cookie: string | undefined) {
    const html = await ofetch(url, {
        responseType: 'text',
        headers: cookie ? { Cookie: cookie } : undefined,
    });
    const $ = load(html);
    const message = $('#messagetext').text().trim();
    const loginRequired = Boolean($('#messagelogin, form[id^="loginform"]').length || /尚未登录|请先登录/.test(message));

    return {
        $,
        message,
        loginRequired,
    };
}

async function fetchPage(site: DiscuzForumSite, url: string, sessionState: DiscuzSessionState) {
    let result = await requestForumDocument(url, sessionState.cookie);

    if (result.loginRequired && sessionState.username && sessionState.password) {
        sessionState.cookie = await getPasswordSessionCookie(site, sessionState.username, sessionState.password, true);
        sessionState.source = 'password';
        result = await requestForumDocument(url, sessionState.cookie);
    }

    if (result.loginRequired) {
        throw new ConfigNotFoundError(
            sessionState.cookie
                ? `${site.siteName}登录失效，请更新 ${site.cookieEnvName} 或检查 ${site.usernameEnvName} 与 ${site.passwordEnvName}。`
                : `此版块或主题需要登录，请配置 ${site.cookieEnvName}，或配置 ${site.usernameEnvName} 与 ${site.passwordEnvName}。`
        );
    }
    if (result.message) {
        throw new RejectError(`${site.siteName}拒绝访问，请确认版块或主题存在，且 ${site.cookieEnvName} 或登录账号有阅读权限。`);
    }

    return result.$;
}

function parseForumDate(value: string | undefined) {
    if (!value) {
        return;
    }
    const date = parseDate(`${value.replace(/^发表于\s*/, '').trim()} +0800`, ['YYYY-M-D HH:mm:ss ZZ', 'YYYY-M-D HH:mm ZZ', 'YYYY-M-D ZZ']);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

async function getDiscuzForumFeed(ctx: Context, site: DiscuzForumSite): Promise<Data> {
    const fid = ctx.req.param('fid');
    if (!fid || !/^[1-9]\d*$/.test(fid)) {
        throw new InvalidParameterError('版块 ID 必须为正整数。');
    }

    const link = `${site.rootUrl}/forum.php?mod=forumdisplay&fid=${fid}`;
    const sessionState = await createSessionState(site);
    const $ = await fetchPage(site, `${link}&filter=author&orderby=dateline&page=1`, sessionState);
    const threads = new Map<string, DataItem & { link: string }>();

    $('tbody[id^="normalthread_"], tbody.tsdm_normalthread').each((_, row) => {
        const $row = $(row);
        const title = $row.find('a.xst').first();
        const href = title.attr('href');
        if (!href) {
            return;
        }

        const url = new URL(href, site.rootUrl);
        const tid = url.searchParams.get('tid') || url.pathname.match(/^\/thread-(\d+)-/)?.[1];
        if (!tid || !/^\d+$/.test(tid) || threads.has(tid)) {
            return;
        }

        const author = $row.find('td.by').first();
        const date = author.find('em');
        threads.set(tid, {
            title: title.text(),
            link: `${site.rootUrl}/forum.php?mod=viewthread&tid=${tid}`,
            author: author.find('cite').text().trim() || undefined,
            pubDate: parseForumDate(date.find('[title]').first().attr('title') || date.text()),
            category: $row
                .find('th em a')
                .toArray()
                .map((element) => $(element).text().trim())
                .filter(Boolean),
        });
    });

    const requestedLimit = Number(ctx.req.query('limit'));
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const items = await pMap(
        threads.values().take(limit).toArray(),
        async (item) => {
            try {
                const detail = await cache.tryGet(`${site.cachePrefix}:thread:${md5(sessionState.cookie || '')}:${item.link}`, async () => {
                    const $ = await fetchPage(site, `${item.link}&page=1`, sessionState);
                    const post = $('#postlist [id^="postmessage_"]').first();
                    const content = post.length ? post : $('#postlist .locked').first();
                    if (!content.length) {
                        throw new Error(`未找到${site.siteName}首帖正文，请检查主题的阅读权限或页面结构。`);
                    }

                    content.find('script, style, .attach_nopermission').remove();
                    content.find('img').each((_, image) => {
                        const $image = $(image);
                        const src = $image.attr('file') || $image.attr('zoomfile') || $image.attr('src');
                        if (src) {
                            $image.attr('src', new URL(src, site.rootUrl).href);
                        }
                        $image.removeAttr('file zoomfile');
                    });
                    content.find('a[href]').each((_, anchor) => {
                        const $anchor = $(anchor);
                        $anchor.attr('href', new URL($anchor.attr('href')!, site.rootUrl).href);
                    });

                    const date = $('[id^="authorposton"]').first();
                    const pubDate = parseForumDate(date.find('[title]').first().attr('title') || date.text());
                    return {
                        description: content.html() ?? undefined,
                        ...(pubDate && { pubDate }),
                    };
                });
                return { ...item, ...detail };
            } catch (error) {
                if (error instanceof RejectError) {
                    return { ...item, description: '当前账号无法阅读此主题正文，请在论坛查看权限要求。' };
                }
                throw error;
            }
        },
        { concurrency: 3 }
    );

    return {
        title: `${site.siteName} - ${$('h1 a').first().text().trim() || $('title').text().split(' - ', 1)[0].trim()}`,
        link,
        language: 'zh-CN',
        item: items,
    };
}

export function getTsdmForumFeed(ctx: Context): Promise<Data> {
    return getDiscuzForumFeed(ctx, tsdmSite);
}

export function getRitdonForumFeed(ctx: Context): Promise<Data> {
    return getDiscuzForumFeed(ctx, ritdonSite);
}
