export const getTelegramMessageLink = (username: string, messageId: string | number): string => {
    const name = username.replace(/^@/, '');
    return `https://t.me/${name}/${messageId}`;
};

export const parseTelegramMessageId = (input?: string): string | undefined => {
    if (!input) {
        return;
    }
    const cleaned = input.trim().split(/[?#]/, 1)[0];
    return cleaned.split('/').findLast((part) => /^\d+$/.test(part));
};
