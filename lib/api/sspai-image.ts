import type { Handler } from 'hono';

import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseSspaiImageUrl } from '@/utils/sspai-images';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const maxImageBytes = 20 * 1024 * 1024;

export const sspaiImageHandler: Handler = async (ctx) => {
    const source = ctx.req.param('source');
    if (!source || source.length > 4096 || !/^[\w-]+$/.test(source)) {
        return ctx.text('Invalid image URL', 400);
    }
    const decoded = Buffer.from(source, 'base64url');
    const url = parseSspaiImageUrl(decoded.toString());
    if (!url || decoded.toString('base64url') !== source) {
        return ctx.text('Invalid image URL', 400);
    }

    try {
        const response = await ofetch.raw<ReadableStream<Uint8Array>, 'stream'>(url.href, {
            headers: { Referer: 'https://sspai.com/' },
            responseType: 'stream',
            redirect: 'manual',
            ignoreResponseError: true,
            retry: 0,
            signal: AbortSignal.timeout(15000),
        });
        const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        const body = response._data;
        if (response.status !== 200 || !type || !imageTypes.has(type) || Number(response.headers.get('content-length')) > maxImageBytes || !body) {
            // Cancellation can wait on a cloned body; do not delay the error response.
            void body?.cancel().catch((error) => logger.debug('Could not cancel SSPAI image response', error));
            return ctx.text('Image unavailable', 502);
        }

        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
            while (true) {
                // Read serially so the byte limit also bounds buffered image data.
                // oxlint-disable-next-line no-await-in-loop
                const { done, value } = await reader.read(); // eslint-disable-line no-await-in-loop
                if (done) {
                    break;
                }
                length += value.byteLength;
                if (length > maxImageBytes) {
                    void reader.cancel().catch((error) => logger.debug('Could not cancel oversized SSPAI image response', error));
                    return ctx.text('Image too large', 502);
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }

        return new Response(Buffer.concat(chunks, length), {
            headers: {
                'Content-Type': type,
                'Cache-Control': 'public, max-age=86400',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch {
        return ctx.text('Image unavailable', 502);
    }
};
