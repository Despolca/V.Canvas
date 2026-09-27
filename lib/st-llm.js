// st-llm.js - Mượn model mà SillyTavern đang dùng hiện tại để thực hiện một request phân tích.
//
// Phân công công việc với llm-api.js: Cả hai đều tạo ra danh sách khung hình giống hệt nhau, chỉ là đi qua kênh khác nhau.
//   llm-api.js -> Kết nối trực tiếp service tương thích OpenAI do người dùng tự điền (Cần địa chỉ, cần key, bị giới hạn bởi cross-origin của trình duyệt)
//   st-llm.js  -> Mượn API chính của SillyTavern (Người dùng không cần cấu hình gì)
//
// Tại sao lại mượn SillyTavern thay vì tự gửi request:
//   SillyTavern đã cấu hình sẵn địa chỉ, key và nguồn (OpenAI / Claude / Gemini / Backend local...) của API hiện tại,
//   và cung cấp kênh chính thức để "Gửi request một lần, không ghi vào lịch sử trò chuyện"
//   (getContext().generateRaw). Mượn nó sẽ đạt được 3 điều cùng lúc:
//     1. Người dùng không cần điền lại cùng một cấu hình lần thứ hai;
//     2. Key chỉ tồn tại trong SillyTavern, không đi vào code của extension, không xuất hiện trong header request của trình duyệt;
//     3. Request được forward bởi server SillyTavern, không có vấn đề CORS, có thể kết nối trực tiếp với backend local.
//
// Cái giá phải trả: Việc phân tích sẽ dùng chính model mà người dùng hay dùng để chat - Đổi model chính sẽ ảnh hưởng liên đới đến chất lượng phân tích,
//       và khi model chính khá đắt / khá chậm thì mỗi lượt sẽ phải trả thêm một lần chi phí. Muốn tách bạch thì chuyển sang nguồn tùy chỉnh trong cài đặt.

import { getContext } from '/scripts/extensions.js';

import { buildAnalysisParts, parseAnalysisJSON, analysisTokenBudget } from './analysis.js';

// SillyTavern lưu "Tên model tương ứng với nguồn hiện tại" trong trường `${source}_model` của chatCompletionSettings.
// Tên trường của các nguồn không thống nhất, do đó trước tiên đoán thử theo tên nguồn, sau đó lùi về "Tìm bất kỳ một trường *_model nào khác rỗng".
// Giá trị này chỉ dùng để hiển thị trên bảng điều khiển, lấy không được cũng không ảnh hưởng đến bất kỳ chức năng nào.
function pickModel(settings, api) {
    if (!settings || typeof settings !== 'object') return '';
    const direct = settings[`${api}_model`];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    for (const [k, v] of Object.entries(settings)) {
        if (!k.endsWith('_model')) continue;
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

/**
 * describeMainApi Đọc nguồn và tên model của API chính hiện tại, dùng để hiển thị trên bảng điều khiển và báo cáo test kết nối.
 *
 * Không phát sinh bất kỳ request nào: API chính có thể chat bình thường tức là nó khả dụng, không cần thiết phải tốn thêm một lần gọi cho việc này.
 *
 * @returns {{api:string, model:string, label:string}}
 */
export function describeMainApi() {
    let api = '';
    let model = '';
    try {
        const ctx = getContext();
        api = String(ctx?.mainApi ?? '').trim();
        model = pickModel(ctx?.chatCompletionSettings, api);
    } catch { /* SillyTavern chưa sẵn sàng: Xử lý như chuỗi rỗng, bên gọi tự giáng cấp */ }

    const apiLabel = api || 'Chưa thiết lập';
    const label = model ? `API chính của SillyTavern · ${apiLabel} · ${model}` : `API chính của SillyTavern · ${apiLabel}`;
    return { api, model, label };
}

// normalizeError Ép các lỗi thất bại với đủ mọi hình dạng do SillyTavern ném ra thành một thông báo dễ đọc.
// Ở một số luồng, SillyTavern dùng `throw await response.json()`, thứ bị ném ra là Object chứ không phải Error,
// nếu nhét trực tiếp Object vào toastr sẽ hiển thị thành [object Object], do đó gom chung về đây để xử lý.
function normalizeError(e) {
    if (e instanceof Error) return e;
    if (e && typeof e === 'object') {
        const msg = e.message ?? e.error?.message ?? e.error ?? e.response;
        if (typeof msg === 'string' && msg.trim()) return new Error(msg.trim());
        try { return new Error(JSON.stringify(e)); } catch { /* Tiếp tục fallback */ }
    }
    return new Error(String(e ?? 'Lỗi không xác định'));
}

/**
 * settle Để việc "Chờ API chính trả về" có thể bị ngắt bởi timeout và nút dừng của plugin này.
 *
 * WARN: Request cấp thấp do SillyTavern gửi đi, plugin này không lấy được AbortController của nó -
 *       Timeout và dừng ở đây chỉ có thể làm được việc "Không chờ nữa, và vứt bỏ kết quả của lượt này";
 *       Bản thân request vẫn sẽ chạy cho đến khi xong (Chỉ có nút dừng của bản thân SillyTavern mới ngắt được nó).
 *       Điểm này khác với luồng kết nối trực tiếp, bảng điều khiển và tài liệu đều mô tả theo cách này, không phóng đại.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
function settle(promise, timeoutMs, signal) {
    const wait = Math.max(5000, timeoutMs);
    return new Promise((resolve, reject) => {
        let done = false;
        let timer = null;

        function cleanup() {
            if (timer) clearTimeout(timer);
            try { signal?.removeEventListener('abort', onAbort); } catch { /* Bỏ qua */ }
        }

        function finish(fn, v) {
            if (done) return;
            done = true;
            cleanup();
            fn(v);
        }

        function onAbort() {
            finish(reject, new Error('Đã dừng'));
        }

        timer = setTimeout(
            () => finish(reject, new Error(`Request model phân tích timeout (${Math.round(wait / 1000)} giây)`)),
            wait,
        );

        if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }

        Promise.resolve(promise).then(v => finish(resolve, v), e => finish(reject, normalizeError(e)));
    });
}

/**
 * analyzeViaMainApi Dùng API chính của SillyTavern để đọc thân bài và phần trước, tạo ra danh sách khung hình.
 *
 * Tham số và giá trị trả về nhất quán với analyzeContext của llm-api.js, có thể hoán đổi cách gọi.
 *
 * Lưu ý hai điểm khác biệt về hành vi so với luồng kết nối trực tiếp, đều là kết quả cố hữu của việc mượn API chính:
 *   1. Các tham số tạo (Temperature, Penalty v.v.) lấy từ cài đặt hiện tại của API chính, plugin này không ghi đè từng mục,
 *      chỉ nâng ngân sách đầu ra lên theo số lượng khung hình, tránh việc JSON bị cắt đứt;
 *   2. SillyTavern sẽ thực hiện macro replacement (Thay thế vĩ mô như {{user}}, {{char}} v.v.) cho văn bản được gửi đi,
 *      luồng kết nối trực tiếp thì không. Đây là hành vi có sẵn của SillyTavern, không chủ ý né tránh.
 *
 * @param {object} p
 * @param {string} p.reply   Thân bài cần vẽ minh họa
 * @param {string} [p.context] Phần trước (có thể rỗng)
 * @param {string} [p.work]    Thông tin tác phẩm (Tên thẻ nhân vật v.v.; có thể rỗng)
 * @param {string} [p.style]   Yêu cầu phong cách vẽ (có thể rỗng)
 * @param {string} [p.quality] Prompt chất lượng tích cực (có thể rỗng)
 * @param {string} [p.negative] Prompt tiêu cực (có thể rỗng)
 * @param {string} [p.jb]      Từ phá giới hạn do người dùng tự điền (có thể rỗng)
 * @param {number} [p.max]     Số khung hình tối đa
 * @param {number} [p.timeoutMs]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<Array<{desc:string,tags:string,anchor:string}>>}
 */
export async function analyzeViaMainApi({
    reply, context = '', work = '', style = '', quality = '', negative = '', jb = '', nsfw = false, max = 1,
    timeoutMs = 90000, signal,
} = {}) {
    const text = String(reply ?? '').trim();
    if (!text) return [];

    const ctx = getContext();
    const generateRaw = ctx?.generateRaw;
    if (typeof generateRaw !== 'function') {
        throw new Error('Phiên bản SillyTavern hiện tại chưa cung cấp kênh gọi trực tiếp API chính: Vui lòng chuyển sang dùng model phân tích tùy chỉnh ở trang "Xuất ảnh theo context", hoặc cập nhật SillyTavern');
    }

    const { system, user } = buildAnalysisParts(text, context, max, { work, style, quality, negative, jb, nsfw });

    const pending = generateRaw({
        systemPrompt: system,
        prompt: user,
        // Ngân sách đầu ra dùng chung tiêu chuẩn với luồng kết nối trực tiếp, tránh việc đổi nguồn xong nhiều ảnh quá thì bị cắt đứt.
        responseLength: analysisTokenBudget(max),
        // Tắt bước "Xóa tiền tố tên nhân vật ở đầu": Giá trị trả về là JSON, không nên bị coi là tên người để xử lý.
        trimNames: false,
    });

    const raw = await settle(pending, timeoutMs, signal);
    return parseAnalysisJSON(raw);
}