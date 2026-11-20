// Chỉ báo kỹ thuật thuần JS. Mọi hàm trả mảng cùng độ dài input, giá trị chưa đủ dữ liệu = null.

export function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= n) sum -= values[i - n];
        if (i >= n - 1) out[i] = sum / n;
    }
    return out;
}

export function ema(values, n) {
    const out = new Array(values.length).fill(null);
    if (values.length < n) return out;
    const k = 2 / (n + 1);
    let prev = 0;
    for (let i = 0; i < n; i++) prev += values[i];
    prev /= n;
    out[n - 1] = prev;
    for (let i = n; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

/** Áp một hàm chuỗi (ema/sma) lên mảng có null ở đầu. */
function sparse(fn, values, n) {
    const start = values.findIndex((v) => v !== null && v !== undefined);
    const out = new Array(values.length).fill(null);
    if (start < 0) return out;
    const res = fn(values.slice(start), n);
    for (let i = 0; i < res.length; i++) out[start + i] = res[i];
    return out;
}

export function rsi(closes, n = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= n) return out;
    let g = 0;
    let l = 0;
    for (let i = 1; i <= n; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) g += d;
        else l -= d;
    }
    let avgG = g / n;
    let avgL = l / n;
    const val = () => (avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL));
    out[n] = val();
    for (let i = n + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
        avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
        out[i] = val();
    }
    return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
    const f = ema(closes, fast);
    const s = ema(closes, slow);
    const line = closes.map((_, i) => (f[i] === null || s[i] === null ? null : f[i] - s[i]));
    const sig = sparse(ema, line, signal);
    const hist = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]));
    return { line, signal: sig, hist };
}

export function bollinger(closes, n = 20, k = 2) {
    const mid = sma(closes, n);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    const width = new Array(closes.length).fill(null);
    for (let i = n - 1; i < closes.length; i++) {
        let v = 0;
        for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
        const sd = Math.sqrt(v / n);
        upper[i] = mid[i] + k * sd;
        lower[i] = mid[i] - k * sd;
        width[i] = mid[i] ? ((upper[i] - lower[i]) / mid[i]) * 100 : null;
    }
    return { mid, upper, lower, width };
}

export function trueRange(c) {
    return c.map((x, i) =>
        i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
    );
}

/** ATR kiểu Wilder. */
export function atr(c, n = 14) {
    const tr = trueRange(c);
    const out = new Array(c.length).fill(null);
    if (c.length < n) return out;
    let prev = 0;
    for (let i = 0; i < n; i++) prev += tr[i];
    prev /= n;
    out[n - 1] = prev;
    for (let i = n; i < c.length; i++) {
        prev = (prev * (n - 1) + tr[i]) / n;
        out[i] = prev;
    }
    return out;
}

export function adx(c, n = 14) {
    const len = c.length;
    const adxOut = new Array(len).fill(null);
    const pdiOut = new Array(len).fill(null);
    const mdiOut = new Array(len).fill(null);
    if (len < 2 * n + 1) return { adx: adxOut, pdi: pdiOut, mdi: mdiOut };
    const tr = trueRange(c);
    const pdm = new Array(len).fill(0);
    const mdm = new Array(len).fill(0);
    for (let i = 1; i < len; i++) {
        const up = c[i].high - c[i - 1].high;
        const down = c[i - 1].low - c[i].low;
        pdm[i] = up > down && up > 0 ? up : 0;
        mdm[i] = down > up && down > 0 ? down : 0;
    }
    let sTr = 0;
    let sP = 0;
    let sM = 0;
    for (let i = 1; i <= n; i++) {
        sTr += tr[i];
        sP += pdm[i];
        sM += mdm[i];
    }
    const dx = new Array(len).fill(null);
    for (let i = n; i < len; i++) {
        if (i > n) {
            sTr = sTr - sTr / n + tr[i];
            sP = sP - sP / n + pdm[i];
            sM = sM - sM / n + mdm[i];
        }
        const p = sTr ? (100 * sP) / sTr : 0;
        const m = sTr ? (100 * sM) / sTr : 0;
        pdiOut[i] = p;
        mdiOut[i] = m;
        dx[i] = p + m ? (100 * Math.abs(p - m)) / (p + m) : 0;
    }
    let a = 0;
    for (let i = n; i < 2 * n; i++) a += dx[i];
    a /= n;
    adxOut[2 * n - 1] = a;
    for (let i = 2 * n; i < len; i++) {
        a = (a * (n - 1) + dx[i]) / n;
        adxOut[i] = a;
    }
    return { adx: adxOut, pdi: pdiOut, mdi: mdiOut };
}

export function stochRsi(closes, rsiN = 14, stochN = 14, kN = 3, dN = 3) {
    const r = rsi(closes, rsiN);
    const st = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (i - stochN + 1 < 0 || r[i - stochN + 1] === null) continue;
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = i - stochN + 1; j <= i; j++) {
            lo = Math.min(lo, r[j]);
            hi = Math.max(hi, r[j]);
        }
        st[i] = hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
    }
    const k = sparse(sma, st, kN);
    const d = sparse(sma, k, dN);
    return { k, d };
}

/** VWAP phiên (UTC 00:00) tính trên các nến của ngày hiện tại, kèm dải ±1 độ lệch chuẩn. */
export function sessionVwap(c) {
    if (!c.length) return null;
    const lastT = c[c.length - 1].openTime;
    const dayStart = lastT - (lastT % 86400000);
    let pv = 0;
    let v = 0;
    let pv2 = 0;
    for (const x of c) {
        if (x.openTime < dayStart) continue;
        const tp = (x.high + x.low + x.close) / 3;
        pv += tp * x.volume;
        pv2 += tp * tp * x.volume;
        v += x.volume;
    }
    if (!v) return null;
    const vwap = pv / v;
    const sd = Math.sqrt(Math.max(pv2 / v - vwap * vwap, 0));
    return { vwap, upper: vwap + sd, lower: vwap - sd };
}

export function obv(c) {
    const out = new Array(c.length).fill(0);
    for (let i = 1; i < c.length; i++) {
        const d = c[i].close - c[i - 1].close;
        out[i] = out[i - 1] + (d > 0 ? c[i].volume : d < 0 ? -c[i].volume : 0);
    }
    return out;
}

/** Lần cắt gần nhất giữa 2 đường trong `lookback` nến. */
export function lastCross(a, b, lookback = 10) {
    const n = a.length;
    for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
        if ([a[i], b[i], a[i - 1], b[i - 1]].some((x) => x === null)) break;
        if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return { type: 'UP', barsAgo: n - 1 - i };
        if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return { type: 'DOWN', barsAgo: n - 1 - i };
    }
    return null;
}

/** Phần trăm thứ hạng của giá trị cuối cùng trong `lookback` giá trị gần nhất (0-100). */
export function percentileRank(values, lookback = 100) {
    const arr = values.slice(-lookback).filter((v) => v !== null);
    if (arr.length < 2) return null;
    const lastV = arr[arr.length - 1];
    return (arr.filter((v) => v <= lastV).length / arr.length) * 100;
}
