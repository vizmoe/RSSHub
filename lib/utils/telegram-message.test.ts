import type { Context } from 'hono';
import { Api } from 'teleproto';
import { ChannelPrivateError } from 'teleproto/errors/index.js';
import { returnBigInt } from 'teleproto/Helpers.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '@/routes/telegram/tglib/channel';
import { getClient } from '@/routes/telegram/tglib/client';
import { getTelegramMessageLink, parseTelegramMessageId } from '@/utils/telegram-message';

vi.mock(import('@/routes/telegram/tglib/client'), async (importOriginal) => ({
    ...(await importOriginal()),
    getClient: vi.fn(),
}));
vi.mock('@/utils/cache', () => ({ default: { get: vi.fn(), set: vi.fn() } }));

describe('telegram message link', () => {
    it('builds a canonical message URL', () => {
        expect(getTelegramMessageLink('awesomeRSSHub', 8255)).toBe('https://t.me/awesomeRSSHub/8255');
        expect(getTelegramMessageLink('@awesomeRSSHub', '8255')).toBe('https://t.me/awesomeRSSHub/8255');
    });

    it('parses message ids from data-post and t.me links', () => {
        expect(parseTelegramMessageId('awesomeRSSHub/8255')).toBe('8255');
        expect(parseTelegramMessageId('https://t.me/awesomeRSSHub/8255')).toBe('8255');
        expect(parseTelegramMessageId('https://t.me/s/awesomeRSSHub/8255')).toBe('8255');
        expect(parseTelegramMessageId('https://t.me/awesomeRSSHub/8255?single')).toBe('8255');
        expect(parseTelegramMessageId('https://t.me/awesomeRSSHub/8255#tg-me')).toBe('8255');
        expect(parseTelegramMessageId()).toBeUndefined();
        expect(parseTelegramMessageId('https://t.me/awesomeRSSHub')).toBeUndefined();
    });

    it('keeps canonical links and stable GUIDs in API channel feeds', async () => {
        const peer = new Api.InputPeerChannel({ channelId: returnBigInt(1), accessHash: returnBigInt(2) });
        const entity = new Api.Channel({ id: returnBigInt(1), title: 'RSSHub', photo: new Api.ChatPhotoEmpty(), date: 1_700_000_000 });
        const client = {
            getInputEntity: vi.fn().mockResolvedValue(peer),
            getEntity: vi.fn().mockResolvedValue(entity),
            getMessages: vi.fn().mockResolvedValue([
                { id: 8255, text: 'First message', message: 'First message', date: 1_700_000_001 },
                { id: 8254, text: 'Second message', message: 'Second message', date: 1_700_000_000 },
            ]),
        };
        vi.mocked(getClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof getClient>>);
        const ctx = {
            req: {
                param: (name: string) => (name === 'username' ? 'awesomeRSSHub' : undefined),
                url: 'https://feeds.example/telegram/channel/awesomeRSSHub',
            },
        } as Context;

        const feed = await handler(ctx);

        expect(feed.item).toHaveLength(2);
        expect(feed.item[0]).toMatchObject({ link: 'https://t.me/awesomeRSSHub/8255', guid: 'https://t.me/awesomeRSSHub/8255' });
        expect(feed.item[1]).toMatchObject({ link: 'https://t.me/awesomeRSSHub/8254', guid: 'https://t.me/awesomeRSSHub/8254' });
        expect(feed.item[0].description).toContain('First message');
    });
});

const privateError = () => new ChannelPrivateError({ request: new Api.channels.GetChannels({ id: [] }) });

describe('Telegram API channel forwards', () => {
    const peer = new Api.InputPeerChannel({ channelId: returnBigInt(1), accessHash: returnBigInt(2) });
    const source = new Api.PeerChannel({ channelId: returnBigInt(3) });
    const entity = new Api.Channel({ id: returnBigInt(1), title: 'Public channel', photo: new Api.ChatPhotoEmpty(), date: 1_700_000_000 });
    const client = {
        getInputEntity: vi.fn(),
        getEntity: vi.fn(),
        getMessages: vi.fn(),
    };
    const ctx = {
        req: {
            param: (name: string) => (name === 'username' ? 'public_channel' : undefined),
            url: 'https://feeds.example/telegram/channel/public_channel',
            header: vi.fn(),
        },
    } as unknown as Context;

    function message(id: number, text: string, forwarded = false, photo = false) {
        return {
            id,
            text,
            message: text,
            date: 1_700_000_000 + id,
            ...(forwarded && { fwdFrom: { fromId: source } }),
            ...(photo && { media: new Api.MessageMediaPhoto({ photo: new Api.PhotoEmpty({ id: returnBigInt(id) }) }) }),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof getClient>>);
        client.getInputEntity.mockResolvedValue(peer);
        client.getEntity.mockImplementation((input) => {
            if (input instanceof Api.InputPeerChannel) {
                return Promise.resolve(entity);
            }
            return Promise.reject(privateError());
        });
        client.getMessages.mockResolvedValue([message(100, 'Public forwarded message', true), message(99, 'Other public message')]);
    });

    it('keeps the public feed when a forwarded source is inaccessible', async () => {
        const feed = await handler(ctx);

        expect(feed.item).toHaveLength(2);
        expect(feed.item[0]).toMatchObject({ title: 'Public forwarded message', link: 'https://t.me/public_channel/100', author: 'Public channel' });
        expect(feed.item[0].description).toContain('Public forwarded message');
        expect(feed.item[1].description).toContain('Other public message');
        expect(client.getEntity).toHaveBeenCalledTimes(1);
    });

    it('keeps textless forwarded media as its own item', async () => {
        client.getMessages.mockResolvedValue([message(100, '', true, true), message(99, 'Other public message'), message(98, 'Earlier public message')]);

        const feed = await handler(ctx);

        expect(feed.item).toHaveLength(3);
        expect(feed.item[0].link).toBe('https://t.me/public_channel/100');
        expect(feed.item[0].description).toContain('https://feeds.example/telegram/media/public_channel/100');
        expect(feed.item[1].description).not.toContain('/telegram/media/');
    });

    it('still reports access failures for the subscribed channel itself', async () => {
        const error = privateError();
        client.getEntity.mockRejectedValueOnce(error);

        await expect(handler(ctx)).rejects.toBe(error);
        expect(client.getMessages).not.toHaveBeenCalled();
    });

    it.each([
        ['https://feeds.example/rss/telegram/channel/public_channel?key=secret&limit=5', undefined, 'https://feeds.example/rss/telegram/media/public_channel/100?key=secret'],
        ['https://feeds.example/telegram/channel/public_channel?code=signed&limit=5', '/rss/', 'https://feeds.example/rss/telegram/media/public_channel/100?code=signed'],
    ])('preserves public media URLs for forwarded posts from %s', async (url, forwardedPrefix, expectedMediaUrl) => {
        client.getMessages.mockResolvedValue([message(100, 'Forwarded photo', true, true)]);
        const requestContext = { req: { ...ctx.req, url, header: () => forwardedPrefix } } as unknown as Context;

        const feed = await handler(requestContext);

        expect(feed.item[0]).toMatchObject({ link: 'https://t.me/public_channel/100', guid: 'https://t.me/public_channel/100' });
        expect(feed.item[0].description).toContain(`<img src="${expectedMediaUrl}"`);
        expect(feed.item[0].description).not.toContain('limit=');
    });

    it('still reports failures while reading the subscribed channel history', async () => {
        const error = new Error('History unavailable');
        client.getMessages.mockRejectedValueOnce(error);

        await expect(handler(ctx)).rejects.toBe(error);
    });
});
