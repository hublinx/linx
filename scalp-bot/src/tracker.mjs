// Theo dõi lệnh đã phát: khớp entry, chạm TP/SL, dời SL về hòa vốn, thống kê winrate thật.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const WEIGHTS = [1 / 3, 1 / 3, 1 / 3]; // chốt 1/3 vị thế tại mỗi TP

export class Tracker {
    constructor(file, cfg) {
        this.file = file;
        this.cfg = cfg;
        this.state = { signals: [] };
        try {
            this.state = JSON.parse(readFileSync(file, 'utf8'));
            if (!Array.isArray(this.state.signals)) this.state.signals = [];
        } catch {
            /* chưa có file */
        }
    }

    save() {
        mkdirSync(dirname(this.file), { recursive: true });
        // Giữ tối đa 500 lệnh gần nhất
        this.state.signals = this.state.signals.slice(-500);
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.state, null, 2));
        renameSync(tmp, this.file);
    }

    open(symbol) {
        return this.state.signals.find((x) => x.symbol === symbol && x.status !== 'CLOSED') || null;
    }

    openSignals() {
        return this.state.signals.filter((x) => x.status !== 'CLOSED');
    }

    add({ symbol, side, plan, createdAt, price }) {
        const sig = {
            id: `${symbol}-${createdAt}`,
            symbol,
            side,
            entryType: plan.entry_type,
            entry: plan.entry,
            sl: plan.stop_loss,
            tps: [plan.tp1, plan.tp2, plan.tp3],
            confidence: plan.confidence,
            setup: plan.setup,
            createdAt,
            priceAtSignal: price,
            validUntil: createdAt + plan.valid_minutes * 60000,
            status: plan.entry_type === 'MARKET' ? 'ACTIVE' : 'PENDING',
            activatedAt: plan.entry_type === 'MARKET' ? createdAt : null,
            currentSl: plan.stop_loss,
            tpHit: 0,
            realizedR: 0,
            outcome: null,
            closedAt: null,
            exitPrice: null,
            lastChecked: createdAt,
        };
        this.state.signals.push(sig);
        return sig;
    }

    /**
     * Cập nhật 1 lệnh bằng nến 1m đã đóng. Trả danh sách sự kiện để báo Telegram.
     * Thứ tự xử lý bảo thủ: trong cùng 1 nến, nếu chạm cả SL và TP thì tính SL.
     */
    update(sig, candles1m) {
        const events = [];
        const s = sig.side === 'LONG' ? 1 : -1;
        const risk = Math.abs(sig.entry - sig.sl);
        const rOf = (px) => ((px - sig.entry) * s) / risk;
        const hitDown = (c, px) => (s > 0 ? c.low <= px : c.high >= px); // chạm mức bất lợi
        const hitUp = (c, px) => (s > 0 ? c.high >= px : c.low <= px); // chạm mức có lợi

        const close = (c, outcome, exitPrice) => {
            const remaining = WEIGHTS.slice(sig.tpHit).reduce((a, b) => a + b, 0);
            sig.realizedR += remaining * rOf(exitPrice);
            sig.status = 'CLOSED';
            sig.outcome = outcome;
            sig.exitPrice = exitPrice;
            sig.closedAt = c.closeTime;
            events.push({ type: outcome, sig });
        };

        for (const c of candles1m) {
            if (c.openTime < sig.lastChecked || sig.status === 'CLOSED') continue;
            sig.lastChecked = c.closeTime + 1;

            if (sig.status === 'PENDING') {
                if (c.openTime > sig.validUntil) {
                    sig.status = 'CLOSED';
                    sig.outcome = 'UNFILLED';
                    sig.closedAt = c.openTime;
                    events.push({ type: 'UNFILLED', sig });
                    break;
                }
                if (hitUp(c, sig.tps[0]) && !hitDown(c, sig.entry)) {
                    sig.status = 'CLOSED';
                    sig.outcome = 'MISSED';
                    sig.closedAt = c.closeTime;
                    events.push({ type: 'MISSED', sig });
                    break;
                }
                if (!hitDown(c, sig.entry)) continue;
                sig.status = 'ACTIVE';
                sig.activatedAt = c.openTime;
                events.push({ type: 'FILLED', sig });
                // Cùng nến khớp lệnh mà chạm SL luôn
                if (hitDown(c, sig.currentSl)) {
                    close(c, 'SL', sig.currentSl);
                    break;
                }
                continue; // không tính TP trong nến khớp lệnh (không biết thứ tự)
            }

            // ACTIVE
            if (hitDown(c, sig.currentSl)) {
                close(c, sig.tpHit === 0 ? 'SL' : sig.tpHit === 1 ? 'BE' : 'TRAIL', sig.currentSl);
                break;
            }
            while (sig.tpHit < 3 && hitUp(c, sig.tps[sig.tpHit])) {
                const tp = sig.tps[sig.tpHit];
                sig.realizedR += WEIGHTS[sig.tpHit] * rOf(tp);
                sig.tpHit++;
                if (sig.tpHit === 3) {
                    sig.status = 'CLOSED';
                    sig.outcome = 'TP3';
                    sig.exitPrice = tp;
                    sig.closedAt = c.closeTime;
                    events.push({ type: 'TP3', sig });
                } else {
                    events.push({ type: `TP${sig.tpHit}`, sig });
                    if (sig.tpHit === 1 && this.cfg.moveSlToBe) sig.currentSl = sig.entry;
                    if (sig.tpHit === 2 && this.cfg.moveSlToBe) sig.currentSl = sig.tps[0];
                }
            }
            if (sig.status === 'CLOSED') break;
            if (c.closeTime - sig.activatedAt >= this.cfg.maxHoldMinutes * 60000) {
                close(c, 'TIMEOUT', c.close);
                break;
            }
        }
        return events;
    }

    stats(sinceMs = 0) {
        const done = this.state.signals.filter(
            (x) => x.status === 'CLOSED' && x.activatedAt != null && !['UNFILLED', 'MISSED'].includes(x.outcome) && x.closedAt >= sinceMs,
        );
        const wins = done.filter((x) => x.tpHit >= 1 || (x.outcome === 'TIMEOUT' && x.realizedR > 0)).length;
        const totalR = done.reduce((a, x) => a + x.realizedR, 0);
        return { trades: done.length, wins, losses: done.length - wins, winrate: done.length ? (wins / done.length) * 100 : null, totalR };
    }
}
