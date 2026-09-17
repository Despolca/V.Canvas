// llm-api.js — Gọi interface chat tương thích OpenAI, dùng cho "Xuất ảnh từ ngữ cảnh".
//
// Phân công công việc với lib/nai-api.js:
//   nai-api.js  -> Xuất ảnh (Giao thức NovelAI)
//   llm-api.js  -> Đọc ngữ cảnh, sản xuất prompt xuất ảnh (Interface chat tương thích OpenAI)
//
// Ở đây có thể điền bất kỳ dịch vụ tương thích OpenAI nào (Chính thức / Proxy trung gian / Reverse proxy local), hoàn toàn độc lập với tuyến trên xuất ảnh:
// Xuất ảnh đi qua V.Adapter hoặc NAI Gateway, phân tích thì đi qua model này, không ảnh hưởng lẫn nhau.

import { buildAnalysisMessages, parseAnalysisJSON } from './analysis.js';

function truncate(s, n) {
    const t = String(s ?? '');
    return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * analyzeContext Cho model đã cấu hình đọc chính văn và phần trước đó, sản xuất ra prompt xuất ảnh.
 *
 * @param {object} p
 * @param {string} p.baseUrl Base url tương thích OpenAI (Thường kết thúc bằng /v1)
 * @param {string} p.apiKey
 * @param {string} p.model   Tên model
 * @param {string} p.reply   Chính văn cần vẽ ảnh
 * @param {string} p.context Phần trước đó (Có thể để trống)
 * @param {string} p.work    Thông tin tác phẩm (Tên thẻ nhân vật v.v., dùng để phán đoán tác phẩm và art style; Có thể để trống)
 * @param {string} p.style   Art style do người dùng điền (Có thể để trống = Để model tự phán đoán)
 * @param {string} p.quality Prompt chất lượng tích cực do người dùng điền (Có thể để trống)
 * @param {string} p.negative Prompt phủ định do người dùng điền (Có thể để trống)
 * @param {string} p.jb      Từ khóa phá giới hạn (Jailbreak) do người dùng tự điền (Có thể để trống, nối nguyên trạng vào request)
 * @param {number} p.max     Số lượng khung hình tối đa
 * @param {number} p.timeoutMs
 * @param {AbortSignal} [p.signal] Tín hiệu hủy (cancel) từ bên ngoài, xếp chồng lên timeout nội bộ
 * @returns {Promise<Array<{desc:string,tags:string,anchor:string}>>}
 */
export async function analyzeContext({
    baseUrl, apiKey, model, reply, context = '', work = '', style = '', quality = '', negative = '', jb = '', max = 1, timeoutMs = 90000, signal,
} = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Chưa cấu hình địa chỉ API của model phân tích');
    const name = String(model ?? '').trim();
    if (!name) throw new Error('Chưa cấu hình tên model phân tích');
    const text = String(reply ?? '').trim();
    if (!text) return [];

    // Một lần request là một cửa sổ hoàn chỉnh: system + một user, không mang theo lịch sử các lượt trước.
    //
    // max_tokens phóng to theo số lượng khung hình: Mỗi khung hình khoảng 500~600 chữ mô tả + 300~400 ký tự nhãn,
    // Tiếng Trung tính khoảng 1~1.5 token mỗi chữ, một khung hình tốn khoảng 1200 token. Nếu fix cứng 1500 sẽ làm đứt đoạn JSON ở khung hình thứ 2,
    // Biểu hiện là "Phân tích thành công nhưng không xuất một tấm ảnh nào, không báo lỗi".
    const budget = Math.min(8192, 1200 * Math.max(1, max) + 600);

    const body = {
        model: name,
        messages: buildAnalysisMessages(text, context, max, { work, style, quality, negative, jb }),
        temperature: 0.3,
        max_tokens: budget,
    };

    const ctrl = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Math.max(5000, timeoutMs));
    if (signal) {
        if (signal.aborted) {
            cancelled = true;
            ctrl.abort();
        } else {
            signal.addEventListener('abort', () => { cancelled = true; ctrl.abort(); }, { once: true });
        }
    }

    let resp;
    try {
        resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${String(apiKey ?? '')}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (cancelled) throw new Error('Đã chấm dứt');
        if (timedOut) throw new Error(`Request model phân tích bị timeout (${Math.round(timeoutMs / 1000)} giây)`);
        throw new Error(`Không thể kết nối đến model phân tích (${base}): ${err?.message ?? err}. Vui lòng xác nhận địa chỉ chính xác, dịch vụ đã khởi động và cho phép cross-domain (CORS)`);
    }

    let raw = '';
    try {
        raw = await resp.text();
    } catch (err) {
        clearTimeout(timer);
        throw new Error(`Đọc phản hồi từ model phân tích thất bại: ${err?.message ?? err}`);
    }
    clearTimeout(timer);

    if (!resp.ok) {
        let msg = '';
        try {
            const j = JSON.parse(raw);
            msg = j?.error?.message ?? j?.message ?? j?.error ?? '';
            if (typeof msg !== 'string') msg = JSON.stringify(msg);
        } catch { /* Không phải là JSON */ }
        throw new Error(msg || `${truncate(raw.replace(/\s+/g, ' '), 200)} (HTTP ${resp.status})`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Model phân tích không trả về JSON: ${truncate(raw.replace(/\s+/g, ' '), 200)}`);
    }

    const choice = parsed?.choices?.[0];
    if (!choice) throw new Error('Phản hồi từ model phân tích thiếu choices');
    // Model suy luận (Reasoning model) có thể để chính văn trong reasoning_content; Lấy cả 2 chỗ, ưu tiên content
    const content = String(choice.message?.content ?? '').trim() || String(choice.message?.reasoning_content ?? '').trim();
    if (!content) throw new Error('Model phân tích trả về nội dung rỗng');

    return parseAnalysisJSON(content);
}

/**
 * testAnalyzeModel Test kết nối: Gửi một request cực ngắn, xác nhận địa chỉ và key dùng được.
 * @returns {Promise<string>} Mô tả thành công dễ đọc
 */
export async function testAnalyzeModel({ baseUrl, apiKey, model, timeoutMs = 20000 } = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Vui lòng điền địa chỉ API của model phân tích trước');
    const name = String(model ?? '').trim();
    if (!name) throw new Error('Vui lòng điền tên model phân tích trước');

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Math.max(3000, timeoutMs));
    let resp;
    try {
        resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${String(apiKey ?? '')}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                model: name,
                messages: [{ role: 'user', content: 'Chỉ trả lời đúng hai chữ: Dùng được' }],
                max_tokens: 16,
            }),
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (timedOut) throw new Error('Kết nối timeout: Model phân tích không phản hồi');
        throw new Error(`Không thể kết nối đến ${base}: ${err?.message ?? err}`);
    }
    const raw = await resp.text();
    clearTimeout(timer);
    if (!resp.ok) {
        let msg = '';
        try {
            const j = JSON.parse(raw);
            msg = j?.error?.message ?? j?.message ?? '';
            if (typeof msg !== 'string') msg = JSON.stringify(msg);
        } catch { /* ignore */ }
        throw new Error(msg || `HTTP ${resp.status}`);
    }
    let reply = '';
    try {
        reply = String(JSON.parse(raw)?.choices?.[0]?.message?.content ?? '').trim();
    } catch { /* ignore */ }
    return `Kết nối bình thường${reply ? ` (Model trả lời: ${truncate(reply, 20)})` : ''}`;
}