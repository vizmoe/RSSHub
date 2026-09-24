import type { Context } from 'hono';
import { Api } from 'teleproto';
import { ChannelPrivateError } from 'teleproto/errors/index.js';
import { returnBigInt } from 'teleproto/Helpers.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../lib/routes/telegram/tglib/channel';
import { getClient } from '../lib/routes/telegram/tglib/client';

vi.mock(import('../lib/routes/telegram/tglib/client'), async (importOriginal) => ({
    ...(await importOriginal()),
    getClient: vi.fn(),
}));
vi.mock('../lib/utils/cache', () => ({ default: { get: vi.fn(), set: vi.fn() } }));

const peer = new Api.InputPeerChannel({ channelId: returnBigInt(1), accessHash: returnBigInt(2) });
const source = new Api.PeerChannel({ channelId: returnBigInt(3) });
const entity = new Api.Channel({ id: returnBigInt(1), title: 'Public channel', photo: new Api.ChatPhotoEmpty(), date: 1_700_000_000 });
const privateError = () => new ChannelPrivateError({ request: new Api.channels.GetChannels({ id: [] }) });
const client = {
    getInputEntity: vi.fn(),
    getEntity: vi.fn(),
    getMessages: vi.fn(),
};
const ctx = {
    req: {
        param: (name: string) => (name === 'username' ? 'public_channel' : undefined),
        url: 'https://feeds.example/telegram/channel/public_channel',
    },
} as Context;

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

describe('Telegram API channel forwards', () => {
    it('keeps the public feed when a forwarded source is inaccessible', async () => {
        const feed = await handler(ctx);

        expect(feed.item).toHaveLength(2);
        expect(feed.item[0]).toMatchObject({ title: 'Public forwarded message', link: 'https://t.me/public_channel/100', author: 'Public channel' });
        expect(feed.item[0].description).toContain('Public forwarded message');
        expect(feed.item[1].description).toContain('Other public message');
        expect(client.getEntity).toHaveBeenCalledTimes(1);
    });

    it('keeps textless forwarded media as its own item', async () => {
        client.getMessages.mockResolvedValue([message(100, '', true, true), message(99, 'Other public message')]);

        const feed = await handler(ctx);

        expect(feed.item).toHaveLength(2);
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

    it('still reports failures while reading the subscribed channel history', async () => {
        const error = new Error('History unavailable');
        client.getMessages.mockRejectedValueOnce(error);

        await expect(handler(ctx)).rejects.toBe(error);
    });
});
