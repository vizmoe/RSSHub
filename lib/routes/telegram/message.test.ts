import { describe, expect, it } from 'vitest';

import { getTelegramMessageLink, parseTelegramMessageId } from './message';

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
});
