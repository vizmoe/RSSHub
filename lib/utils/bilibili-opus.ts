import { constants, publicEncrypt } from 'node:crypto';

import { load } from 'cheerio';
import { encodeXML } from 'entities';

import { config } from '@/config';
import CaptchaError from '@/errors/types/captcha';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';
import ofetch from '@/utils/ofetch';

export interface BilibiliOpusImage {
    url: string;
    width?: number;
    height?: number;
}

interface BilibiliOpusParagraph {
    para_type?: number;
    text?: {
        nodes?: BilibiliOpusTextNode[];
    };
    pic?: {
        pics?: BilibiliOpusImage[];
    };
    line?: {
        pic?: BilibiliOpusImage;
    };
    list?: {
        style?: number;
        items?: Array<{
            order?: number;
            nodes?: BilibiliOpusTextNode[];
        }>;
    };
    heading?: {
        level?: number;
        nodes?: BilibiliOpusTextNode[];
    };
    blockquote?: {
        nodes?: BilibiliOpusTextNode[];
    };
    code?: {
        content?: string;
        lang?: string;
    };
}

interface BilibiliOpusTextNode {
    word?: {
        words?: string;
        jump_url?: string;
    };
    rich?: {
        text?: string;
        jump_url?: string;
    };
    formula?: {
        latex_content?: string;
    };
    user?: {
        name?: string;
        jump_url?: string;
    };
}

interface BilibiliOpusModule {
    module_type?: string;
    module_title?: {
        text?: string;
    };
    module_author?: {
        name?: string;
        pub_ts?: number;
    };
    module_content?: {
        paragraphs?: BilibiliOpusParagraph[];
    };
    module_top?: {
        display?: {
            album?: {
                pics?: BilibiliOpusImage[];
            };
        };
    };
}

interface BilibiliOpusItem {
    id_str?: string;
    modules?: BilibiliOpusModule[];
}

interface BilibiliOpusDetailResponse {
    code?: number;
    data?: {
        item?: BilibiliOpusItem;
    };
}

export const normalizeBilibiliImageUrl = (url: string) => {
    if (url.startsWith('//')) {
        return `https:${url}`;
    }
    if (url.startsWith('http://')) {
        return `https://${url.slice('http://'.length)}`;
    }
    return url;
};

const normalizeBilibiliImages = (images: BilibiliOpusImage[]) => {
    const seen = new Set<string>();
    const normalized: BilibiliOpusImage[] = [];

    for (const image of images) {
        if (!image.url) {
            continue;
        }
        const url = normalizeBilibiliImageUrl(image.url);
        if (seen.has(url)) {
            continue;
        }
        seen.add(url);
        normalized.push({
            url,
            width: image.width,
            height: image.height,
        });
    }

    return normalized;
};

const extractBilibiliOpusTopImages = (item?: BilibiliOpusItem) => item?.modules?.filter((module) => module.module_type === 'MODULE_TYPE_TOP').flatMap((module) => module.module_top?.display?.album?.pics ?? []) ?? [];

const extractBilibiliOpusContentImages = (item?: BilibiliOpusItem) =>
    item?.modules
        ?.filter((module) => module.module_type === 'MODULE_TYPE_CONTENT')
        .flatMap((module) => (module.module_content?.paragraphs ?? []).flatMap((paragraph) => [...(paragraph.pic?.pics ?? []), ...(paragraph.line?.pic ? [paragraph.line.pic] : [])])) ?? [];

const extractBilibiliOpusItemImages = (item?: BilibiliOpusItem) => normalizeBilibiliImages([...extractBilibiliOpusTopImages(item), ...extractBilibiliOpusContentImages(item)]);

export const extractBilibiliOpusImages = (response: BilibiliOpusDetailResponse): BilibiliOpusImage[] => extractBilibiliOpusItemImages(response.data?.item);

const renderBilibiliOpusTextNodes = (nodes: BilibiliOpusTextNode[] = []) =>
    nodes
        .map((node) => {
            const text = node.word?.words || node.rich?.text || node.user?.name || node.formula?.latex_content;
            if (!text) {
                return '';
            }

            const content = encodeXML(text).replaceAll('\n', '<br>');
            const url = node.word?.jump_url || node.rich?.jump_url || node.user?.jump_url;
            return url ? `<a href="${encodeXML(normalizeBilibiliImageUrl(url))}">${content}</a>` : content;
        })
        .join('');

const renderBilibiliOpusParagraph = (paragraph: BilibiliOpusParagraph) => {
    if (paragraph.pic?.pics?.length) {
        return `<figure>${renderBilibiliImages(paragraph.pic.pics)}</figure>`;
    }
    if (paragraph.line?.pic) {
        return `<figure>${renderBilibiliImages([paragraph.line.pic])}</figure>`;
    }
    if (paragraph.list?.items?.length) {
        const tag = paragraph.list.items.some((item) => item.order !== undefined) ? 'ol' : 'ul';
        const items = paragraph.list.items.map((item) => `<li>${renderBilibiliOpusTextNodes(item.nodes)}</li>`).join('');
        return `<${tag}>${items}</${tag}>`;
    }
    if (paragraph.heading?.nodes?.length) {
        const level = Math.min(Math.max(paragraph.heading.level || 2, 1), 6);
        return `<h${level}>${renderBilibiliOpusTextNodes(paragraph.heading.nodes)}</h${level}>`;
    }
    if (paragraph.blockquote?.nodes?.length) {
        return `<blockquote>${renderBilibiliOpusTextNodes(paragraph.blockquote.nodes)}</blockquote>`;
    }
    if (paragraph.code?.content) {
        const language = paragraph.code.lang ? ` class="language-${encodeXML(paragraph.code.lang)}"` : '';
        return `<pre><code${language}>${encodeXML(paragraph.code.content)}</code></pre>`;
    }

    const text = renderBilibiliOpusTextNodes(paragraph.text?.nodes);
    return text ? `<p>${text}</p>` : '';
};

export const parseBilibiliOpusArticle = (response: BilibiliOpusDetailResponse) => {
    if (response.code !== undefined && response.code !== 0) {
        return {};
    }

    const item = response.data?.item;
    const modules = item?.modules ?? [];
    const title = modules.find((module) => module.module_type === 'MODULE_TYPE_TITLE')?.module_title?.text;
    const author = modules.find((module) => module.module_type === 'MODULE_TYPE_AUTHOR')?.module_author;
    const topImages = normalizeBilibiliImages(extractBilibiliOpusTopImages(item));
    const description = [
        topImages.length ? `<figure>${renderBilibiliImages(topImages)}</figure>` : '',
        ...modules
            .filter((module) => module.module_type === 'MODULE_TYPE_CONTENT')
            .flatMap((module) => module.module_content?.paragraphs ?? [])
            .map((paragraph) => renderBilibiliOpusParagraph(paragraph)),
    ]
        .filter(Boolean)
        .join('');

    return {
        title: title || undefined,
        description: description || undefined,
        author: author?.name || undefined,
        pubDate: author?.pub_ts,
    };
};

const parseBilibiliOpusInitialState = (data: string) => {
    const $ = load(data);
    const script = $('script:contains("window.__INITIAL_STATE__")').first().html();
    const initialState = script?.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;\s*\(function\(/s)?.[1];
    if (!initialState) {
        return;
    }

    try {
        return (JSON.parse(initialState) as { detail?: BilibiliOpusItem }).detail;
    } catch {
        return;
    }
};

export const parseBilibiliOpusArticleFromHtml = (data: string) => {
    const item = parseBilibiliOpusInitialState(data);
    if (!item) {
        return {};
    }

    return parseBilibiliOpusArticle({
        code: 0,
        data: { item },
    });
};

export const extractBilibiliOpusImagesFromHtml = (data: string): BilibiliOpusImage[] => {
    const images = extractBilibiliOpusItemImages(parseBilibiliOpusInitialState(data));
    if (images.length) {
        return images;
    }

    const $ = load(data);
    const parsedImages: BilibiliOpusImage[] = [];
    for (const element of $('.opus-module-content img').toArray()) {
        const image = $(element);
        const url = image.attr('src');
        if (!url) {
            continue;
        }
        const width = Math.trunc(Number(image.attr('width') || '')) || undefined;
        const height = Math.trunc(Number(image.attr('height') || '')) || undefined;
        parsedImages.push({ url, width, height });
    }

    return normalizeBilibiliImages(parsedImages);
};

export const renderBilibiliImages = (images: BilibiliOpusImage[]) =>
    images
        .filter((image) => image.url)
        .map((image) => {
            const attributes = [`src="${encodeXML(normalizeBilibiliImageUrl(image.url))}"`, image.width ? `width="${image.width}"` : '', image.height ? `height="${image.height}"` : ''].filter(Boolean);

            return `<img ${attributes.join(' ')}>`;
        })
        .join('');

const bilibiliOauthAppKey = 'bca7e84c2d947ac6';
const bilibiliOauthAppSecret = '60698ba2f68e01ce44738920a0ffe768';

export const encryptBilibiliPassword = (publicKeyPem: string, hash: string, password: string): string =>
    publicEncrypt(
        {
            key: publicKeyPem,
            padding: constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(`${hash}${password}`, 'utf8')
    ).toString('base64');

export const signBilibiliOauthParams = (params: Record<string, string>, appSecret = bilibiliOauthAppSecret): string => {
    const searchParams = new URLSearchParams(params);
    searchParams.sort();
    const sign = md5(`${searchParams.toString()}${appSecret}`);
    searchParams.set('sign', sign);
    return searchParams.toString();
};

const extractSetCookiesFromHeaders = (headers: Headers): Record<string, string> => {
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
};

interface BilibiliKeyResponse {
    code?: number;
    message?: string;
    data?: {
        hash?: string;
        key?: string;
    };
}

interface BilibiliOauthLoginResponse {
    code?: number;
    message?: string;
    data?: {
        status?: number;
        message?: string;
        url?: string;
        cookie_info?: {
            cookies?: Array<{
                name?: string;
                value?: string;
            }>;
        };
    };
}

export const loginBilibiliWithPassword = async (username: string, password: string): Promise<string> => {
    const keyResponse = await ofetch<BilibiliKeyResponse>('https://passport.bilibili.com/x/passport-login/web/key', {
        headers: {
            Referer: 'https://passport.bilibili.com/login',
            'User-Agent': config.ua,
        },
    });
    if (keyResponse.code !== 0 || !keyResponse.data?.hash || !keyResponse.data?.key) {
        throw new ConfigNotFoundError(`Bilibili 登录公钥获取失败：${keyResponse.message || keyResponse.code}`);
    }

    const encryptedPassword = encryptBilibiliPassword(keyResponse.data.key, keyResponse.data.hash, password);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const body = signBilibiliOauthParams({
        appkey: bilibiliOauthAppKey,
        password: encryptedPassword,
        ts: String(nowSeconds),
        username,
    });

    const response = await ofetch.raw<BilibiliOauthLoginResponse>('https://passport.bilibili.com/x/passport-login/oauth2/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: 'https://passport.bilibili.com/login',
            'User-Agent': config.ua,
        },
        body,
    });

    const payload = response._data;
    const message = payload?.data?.message || payload?.message || '';
    if (payload?.code === -105 || payload?.data?.url?.includes('geetest') || message.includes('验证码')) {
        throw new CaptchaError('Bilibili 账号密码登录触发源站验证码风控，请配置 BILIBILI_COOKIE_* 或稍后再试。');
    }
    if (payload?.code !== 0 || (payload.data?.status !== undefined && payload.data.status !== 0)) {
        throw new ConfigNotFoundError(`Bilibili 账号密码登录失败：${message || payload?.code}`);
    }

    const cookies: Record<string, string> = extractSetCookiesFromHeaders(response.headers);
    const cookieItems = payload.data?.cookie_info?.cookies ?? [];
    for (const item of cookieItems) {
        if (item.name && item.value) {
            cookies[item.name] = item.value;
        }
    }
    if (payload.data?.url) {
        try {
            const callbackUrl = new URL(payload.data.url);
            for (const key of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']) {
                const value = callbackUrl.searchParams.get(key);
                if (value) {
                    cookies[key] = value;
                }
            }
        } catch {
            // Ignore malformed callback URLs when cookies were already extracted.
        }
    }

    if (!cookies.SESSDATA && Object.keys(cookies).length === 0) {
        throw new ConfigNotFoundError('Bilibili 账号密码登录未返回有效会话 Cookie。');
    }

    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
};

const resolveBilibiliPasswordCredentials = (loginUid?: string): { username: string; password: string } | undefined => {
    if (loginUid) {
        const uidUsername = config.bilibili.usernames?.[loginUid]?.trim();
        const uidPassword = config.bilibili.passwords?.[loginUid];
        if (uidUsername && uidPassword) {
            return { username: uidUsername, password: uidPassword };
        }
    } else {
        const uidKeys = Object.keys(config.bilibili.usernames ?? {}).filter((uid) => config.bilibili.usernames[uid]?.trim() && config.bilibili.passwords?.[uid]);
        if (uidKeys.length > 0) {
            const randomIndex = Math.floor(Math.random() * uidKeys.length);
            const selectedUid = uidKeys[randomIndex];
            return {
                username: config.bilibili.usernames[selectedUid]!.trim(),
                password: config.bilibili.passwords[selectedUid]!,
            };
        }
    }

    const fallbackUsername = config.bilibili.username?.trim();
    const fallbackPassword = config.bilibili.password;
    if (fallbackUsername && fallbackPassword) {
        return { username: fallbackUsername, password: fallbackPassword };
    }
};

export const getBilibiliPasswordCookie = async (loginUid?: string, forceRefresh = false): Promise<string | undefined> => {
    const credentials = resolveBilibiliPasswordCredentials(loginUid);
    if (!credentials) {
        return;
    }

    const { username, password } = credentials;
    const cacheKey = `bilibili:auth:password:${md5(`${username}:${password}`)}`;
    if (forceRefresh) {
        const cookie = await loginBilibiliWithPassword(username, password);
        await cache.set(cacheKey, cookie, config.cache.contentExpire);
        return cookie;
    }

    return (await cache.tryGet(cacheKey, () => loginBilibiliWithPassword(username, password), config.cache.contentExpire, false)) as string;
};
