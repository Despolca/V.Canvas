// llm-api.js - Gọi API chat tương thích OpenAI, dùng cho "Xuất ảnh theo context".
//
// Phân công công việc với lib/nai-api.js:
//   nai-api.js  -> Xuất ảnh (Giao thức NovelAI)
//   llm-api.js  -> Đọc context, tạo ra prompt xuất ảnh (API chat tương thích OpenAI)
//
// Ở đây có thể điền bất kỳ service tương thích OpenAI nào (Chính thức / Proxy / Reverse proxy nội bộ), hoàn toàn độc lập với tuyến trên xuất ảnh:
// Xuất ảnh đi qua V.Adapter hoặc Gateway NAI, phân tích đi qua model này, không ảnh hưởng lẫn nhau.

import { buildAnalysisMessages, parseAnalysisJSON, analysisTokenBudget } from './analysis.js';

function truncate(s, n) {
    const t = String(s ?? '');
    return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * analyzeContext Để model đã cấu hình đọc thân bài và phần trước, tạo ra prompt xuất ảnh.
 *
 * @param {object} p
 * @param {string} p.baseUrl Base url tương thích OpenAI (thường kết thúc bằng /v1)
 * @param {string} p.apiKey
 * @param {string} p.model   Tên model
 * @param {string} p.reply   Thân bài cần vẽ minh họa
 * @param {string} p.context Phần trước (có thể rỗng)
 * @param {string} p.work    Thông tin tác phẩm (Tên thẻ nhân vật v.v., để đánh giá tác phẩm và phong cách vẽ; có thể rỗng)
 * @param {string} p.style   Phong cách vẽ do người dùng điền (có thể rỗng = do model đánh giá)
 * @param {string} p.quality Prompt chất lượng tích cực do người dùng điền (có thể rỗng)
 * @param {string} p.negative Prompt tiêu cực do người dùng điền (có thể rỗng)
 * @param {string} p.jb      Từ phá giới hạn do người dùng tự điền (có thể rỗng, ghép nguyên trạng vào request)
 * @param {number} p.max     Số khung hình tối đa
 * @param {number} p.timeoutMs
 * @param {AbortSignal} [p.signal] Tín hiệu hủy bên ngoài, cộng dồn với timeout bên trong
 * @returns {Promise<Array<{desc:string,tags:string,anchor:string}>>}
 */
export async function analyzeContext({
    baseUrl, apiKey, model, reply, context = '', work = '', style = '', quality = '', negative = '', jb = '', nsfw = false, max = 1, timeoutMs = 90000, signal,
} = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Chưa cấu hình địa chỉ API của model phân tích');
    const name = String(model ?? '').trim();
    if (!name) throw new Error('Chưa cấu hình tên model phân tích');
    const text = String(reply ?? '').trim();
    if (!text) return [];

    // Mỗi lần request là một cửa sổ hoàn chỉnh: system + một tin user, không mang theo các lượt lịch sử.
    // Ngân sách đầu ra được phóng to theo số lượng khung hình, tiêu chuẩn dùng chung analysisTokenBudget với luồng API chính.
    const budget = analysisTokenBudget(max);

    const body = {
        model: name,
        messages: buildAnalysisMessages(text, context, max, { work, style, quality, negative, jb, nsfw }),
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
        if (cancelled) throw new Error('Đã hủy');
        if (timedOut) throw new Error(`Request model phân tích timeout (${Math.round(timeoutMs / 1000)} giây)`);
        throw new Error(`Không thể kết nối đến model phân tích (${base}): ${err?.message ?? err}. Vui lòng xác nhận địa chỉ chính xác, service đã khởi động và cho phép Cross-Origin (CORS)`);
    }

    let raw = '';
    try {
        raw = await resp.text();
    } catch (err) {
        clearTimeout(timer);
        throw new Error(`Đọc phản hồi của model phân tích thất bại: ${err?.message ?? err}`);
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
        throw new Error(`Model phân tích trả về không phải là JSON: ${truncate(raw.replace(/\s+/g, ' '), 200)}`);
    }

    const choice = parsed?.choices?.[0];
    if (!choice) throw new Error('Phản hồi của model phân tích thiếu choices');
    // Model suy luận có thể đặt thân bài trong reasoning_content; lấy ở cả hai nơi, ưu tiên content
    const content = String(choice.message?.content ?? '').trim() || String(choice.message?.reasoning_content ?? '').trim();
    if (!content) throw new Error('Model phân tích trả về nội dung trống');

    return parseAnalysisJSON(content);
}

/**
 * testAnalyzeModel Test kết nối: Gửi một request cực ngắn, xác nhận địa chỉ và key có thể sử dụng.
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
                messages: [{ role: 'user', content: 'Chỉ trả lời hai chữ: Khả dụng' }],
                max_tokens: 16,
            }),
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (timedOut) throw new Error('Kết nối timeout: Model phân tích không phản hồi');
        throw new Error(`Không thể kết nối ${base}: ${err?.message ?? err}`);
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