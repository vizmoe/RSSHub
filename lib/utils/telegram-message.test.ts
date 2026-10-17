import type { Context } from 'hono';
import { Api } from 'teleproto';
import { returnBigInt } from 'teleproto/Helpers.js';
import { describe, expect, it, vi } from 'vitest';

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
