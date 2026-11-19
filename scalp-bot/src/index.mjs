#!/usr/bin/env node
// Điểm vào: chạy mỗi INTERVAL_MINUTES phút, căn theo giờ đóng nến (vd 10:05:05, 10:10:05...).
//   node --env-file=.env src/index.mjs            chạy liên tục
//   ... --once                                     chạy 1 lần rồi thoát
//   ... --dry-run                                  in ra màn hình thay vì gửi Telegram
//   ... --no-ai                                    không gọi OpenAI (chỉ chấm điểm kỹ thuật)

import { join, resolve } from 'node:path';
import { loadConfig, validateConfig } from './config.mjs';
import { createBinance } from './binance.mjs';
import { createTelegram } from './telegram.mjs';
import { getAiPlan } from './ai.mjs';
import { Tracker } from './tracker.mjs';
import { runCycle } from './bot.mjs';

const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const dryRun = args.has('--dry-run');
const noAi = args.has('--no-ai');

const ts = () => new Date().toISOString();
const log = {
    info: (m) => console.log(`${ts()} INFO  ${m}`),
    warn: (m) => console.warn(`${ts()} WARN  ${m}`),
    error: (m) => console.error(`${ts()} ERROR ${m}`),
};

const cfg = loadConfig();
try {
    validateConfig(cfg, { dryRun, noAi });
} catch (err) {
    log.error(err.message);
    process.exit(1);
}

const binance = createBinance(cfg);
const telegram = createTelegram(cfg);
const tracker = new Tracker(join(resolve(cfg.dataDir), 'signals.json'), cfg);
const aiPlan = (payload) => getAiPlan(payload, cfg);

let running = false;
async function tick() {
    if (running) return log.warn('Chu kỳ trước chưa xong, bỏ qua lượt này');
    running = true;
    const started = Date.now();
    try {
        const res = await runCycle({ cfg, binance, tracker, aiPlan, noAi, log });
        const shouldSend = cfg.sendNoTrade || res.hasSignal || res.hasEvents;
        if (dryRun) console.log(`\n${res.text.replace(/<[^>]+>/g, '')}\n`);
        else if (shouldSend) await telegram.send(res.text);
        log.info(`Xong chu kỳ trong ${((Date.now() - started) / 1000).toFixed(1)}s${res.hasSignal ? ' — CÓ TÍN HIỆU' : ''}`);
    } catch (err) {
        log.error(err.stack || err.message);
        if (!dryRun) await telegram.send(`⚠️ Bot lỗi: ${String(err.message).slice(0, 500)}`).catch(() => {});
    } finally {
        running = false;
    }
}

function msUntilNext() {
    const step = cfg.intervalMinutes * 60000;
    const now = Date.now();
    return Math.ceil((now + 1) / step) * step + cfg.runDelaySeconds * 1000 - now;
}

if (once) {
    await tick();
} else {
    log.info(`Bot khởi động: ${cfg.symbols.join(', ')} · ${cfg.market} · mỗi ${cfg.intervalMinutes} phút · model ${noAi ? '(tắt AI)' : cfg.openaiModel}`);
    await tick();
    let timer;
    const schedule = () => {
        const wait = msUntilNext();
        log.info(`Lượt kế tiếp sau ${Math.round(wait / 1000)}s`);
        timer = setTimeout(async () => {
            await tick();
            schedule();
        }, wait);
    };
    schedule();
    const stop = () => {
        log.info('Dừng bot');
        clearTimeout(timer);
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
