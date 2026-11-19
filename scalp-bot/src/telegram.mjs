// Gửi tin nhắn Telegram (parse_mode HTML), tự chia nhỏ khi > 4096 ký tự.

const LIMIT = 3900;

export function splitMessage(text, limit = LIMIT) {
    if (text.length <= limit) return [text];
    const parts = [];
    let cur = '';
    for (const block of text.split('\n\n')) {
        const piece = cur ? `${cur}\n\n${block}` : block;
        if (piece.length <= limit) {
            cur = piece;
            continue;
        }
        if (cur) parts.push(cur);
        if (block.length <= limit) cur = block;
        else {
            // block quá dài: cắt theo dòng
            cur = '';
            for (const line of block.split('\n')) {
                const p2 = cur ? `${cur}\n${line}` : line;
                if (p2.length <= limit) cur = p2;
                else {
                    if (cur) parts.push(cur);
                    cur = line.slice(0, limit);
                }
            }
        }
    }
    if (cur) parts.push(cur);
    return parts;
}

export function createTelegram(cfg) {
    async function sendOne(chatId, text) {
        const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (cfg.telegramThreadId) body.message_thread_id = cfg.telegramThreadId;
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) return;
            const data = await res.json().catch(() => ({}));
            if (res.status === 429) {
                await new Promise((r) => setTimeout(r, ((data.parameters?.retry_after ?? 3) + 1) * 1000));
                continue;
            }
            throw new Error(`Telegram HTTP ${res.status}: ${data.description ?? ''}`);
        }
        throw new Error('Telegram: hết lượt thử lại (429)');
    }

    return {
        async send(text) {
            for (const chatId of cfg.telegramChatIds) for (const part of splitMessage(text)) await sendOne(chatId, part);
        },
    };
}
