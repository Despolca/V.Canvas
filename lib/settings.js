// settings.js — Đọc, ghi, kiểm tra tính hợp lệ và lưu trữ (persist) các mục cài đặt.
//
// Vị trí lưu trữ: extension_settings[MODULE_KEY] của SillyTavern, được lưu cùng với file cài đặt của SillyTavern.
// Việc đọc thống nhất đi qua settingsGet(): Trả về bản snapshot lúc runtime, sửa trên giao diện xong là có hiệu lực ngay.

import { saveSettingsDebounced } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';

export const MODULE_KEY = 'v_canvas';

// -- Giá trị mặc định xuất xưởng --
// model mặc định để chuỗi rỗng: Ràng buộc cứng yêu cầu không được hardcode bất kỳ tên model nào, ô input chỉ để placeholder.
export function defaultSettings() {
    return {
        enabled: false,                     // Công tắc tổng (Mặc định tắt, tránh việc chưa cấu hình đã tự động phát request)
        base_url: '',                       // Địa chỉ dịch vụ giao thức NAI. Để trống sẽ dùng extension V.Adapter trên cùng trang để kết nối trực tiếp (Không cần port)
        api_key: 'v-adapter-8888',          // Giá trị mặc định cho nai_key của dịch vụ adapter; Để trống thì key nào gọi cũng được
        model: '',                          // Chuỗi tự điền, không có giá trị mặc định
        width: 832,
        height: 1216,
        negative: '',                       // Tương ứng với prompt phủ định của NAI
        prompt_format: 'auto',              // Hình thái nội dung gửi đi: auto / description / tags / both
        steps: 28,
        scale: 6.0,
        max_per_round: 2,                   // Số lượng ảnh tối đa xuất mỗi lượt
        timeout_sec: 300,                   // Timeout cho mỗi tấm (Tuyến trên thường mất 30~60s/tấm)
        interval_ms: 0,                     // Khoảng cách giữa 2 tấm liên tiếp, dùng để lách rate limit (hạn chế lưu lượng)
        parallel: false,                    // Xuất ảnh song song (Mặc định tuần tự; Bật lên nếu tuyến trên cho phép đồng thời - concurrency)
        exclude_types: 'impersonate',       // Các loại tin nhắn bị bỏ qua (Phân cách bằng dấu phẩy)
        swipe_regenerate: true,             // Cấp lại ảnh khi swipe đổi câu trả lời
        strip_marker: true,                 // Xóa tag trong chính văn (Ảnh minh họa không đi vào ngữ cảnh)
        inject_prompt: true,                // Tự động nối thêm quy tắc ILLUST vào system prompt
        inject_position: 'in_chat',         // Vị trí inject quy tắc: in_chat (Sát câu trả lời, mức độ tuân thủ cao hơn) / in_prompt
        inject_depth: 0,                    // Độ sâu chèn khi dùng in_chat (0 = Sát ngay trước câu trả lời)
        // -- Xuất ảnh từ ngữ cảnh: Do model độc lập đọc chính văn để sản xuất ra prompt (Không phụ thuộc vào sự hợp tác của model cốt truyện) --
        ctx_enabled: false,                 // Công tắc tổng (Mặc định tắt, tránh việc chưa cấu hình đã tự động phát request)
        ctx_url: '',                        // Địa chỉ API tương thích OpenAI
        ctx_key: '',                        // Key của dịch vụ đó
        ctx_model: '',                      // Tên model (Tự điền, không có giá trị mặc định)
        ctx_style: '',                      // Art style (Có thể để trống = Do model phân tích tự phán đoán dựa theo tác phẩm)
        ctx_quality: '',                    // Prompt chất lượng tích cực (Có thể để trống)
        ctx_negative: '',                   // Prompt phủ định (Có thể để trống)
        jb_llm: '',                         // Từ khóa phá giới hạn · Model phân tích (Tùy chọn; Nối vào request phân tích của tính năng Xuất ảnh từ ngữ cảnh)
        jb_image: '',                       // Từ khóa phá giới hạn · Tuyến trên sinh ảnh (Tùy chọn; Nối vào ngay đầu của prompt xuất ảnh)
        ctx_timeout_sec: 90,                // Timeout phân tích 1 lần
        history: [],                        // Lịch sử sinh ảnh (URL ảnh + prompt, lưu trữ cố định; Tách biệt với cuộc trò chuyện hiện tại)
        debug: false,                       // Log chi tiết trên console
    };
}

// Giới hạn số mục của Lịch sử sinh ảnh (dòng). Lịch sử chỉ lưu metadata (URL + prompt đã cắt ngắn), không lưu bản thân bức ảnh,
// Một dòng tốn khoảng 400 byte; Giới hạn này tương đương khoảng 800 KB, sẽ không làm file setting của SillyTavern phình to rõ rệt.
// Khi vượt quá sẽ vứt bỏ mục cũ nhất.
const HISTORY_MAX = 2000;

// Độ dài tối đa để lưu prompt trong một dòng lịch sử. Prompt hoàn chỉnh vẫn có thể đọc từ extra.illust.src của tin nhắn chat.
const HISTORY_PROMPT_MAX = 500;

const BOOL_KEYS = ['enabled', 'swipe_regenerate', 'strip_marker', 'inject_prompt', 'debug', 'ctx_enabled', 'parallel'];
const STR_KEYS = ['base_url', 'api_key', 'model', 'negative', 'prompt_format', 'exclude_types', 'inject_position', 'ctx_url', 'ctx_key', 'ctx_model', 'ctx_style', 'ctx_quality', 'ctx_negative', 'jb_llm', 'jb_image'];

// Giá trị hợp lệ của prompt_format (Xem resolvePromptMode của marker.js).
const PROMPT_FORMATS = ['auto', 'description', 'tags', 'both'];

// Giá trị hợp lệ của inject_position (Xem syncPromptInjection của index.js).
const INJECT_POSITIONS = ['in_chat', 'in_prompt'];

function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
}

function clampFloat(v, lo, hi, fallback) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
}

// normalize Ép một object từ bất kỳ nguồn nào thành một bộ cài đặt hợp lệ (Thiếu trường nào bù bằng giá trị mặc định).
export function normalize(raw) {
    const d = defaultSettings();
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};

    for (const k of BOOL_KEYS) out[k] = src[k] === undefined ? d[k] : !!src[k];
    for (const k of STR_KEYS) out[k] = src[k] === undefined ? d[k] : String(src[k]);

    out.base_url = out.base_url.trim().replace(/\/+$/, '');
    out.api_key = out.api_key.trim();
    out.model = out.model.trim();
    out.negative = out.negative.trim();
    out.exclude_types = out.exclude_types.trim();
    out.ctx_url = out.ctx_url.trim().replace(/\/+$/, '');
    out.ctx_key = out.ctx_key.trim();
    out.ctx_model = out.ctx_model.trim();
    out.ctx_style = out.ctx_style.trim();
    out.ctx_quality = out.ctx_quality.trim();
    out.ctx_negative = out.ctx_negative.trim();
    out.jb_llm = out.jb_llm.trim();
    out.jb_image = out.jb_image.trim();

    // Giá trị Enum: Giá trị không hợp lệ sẽ đồng loạt rớt về mục mặc định, tránh việc resolvePromptMode ở downstream vớ phải nhánh không xác định.
    out.prompt_format = PROMPT_FORMATS.includes(out.prompt_format) ? out.prompt_format : d.prompt_format;
    out.inject_position = INJECT_POSITIONS.includes(out.inject_position) ? out.inject_position : d.inject_position;

    out.width = clampInt(src.width, 64, 2048, d.width);
    out.height = clampInt(src.height, 64, 2048, d.height);
    out.steps = clampInt(src.steps, 1, 50, d.steps);
    out.scale = clampFloat(src.scale, 0, 30, d.scale);
    out.max_per_round = clampInt(src.max_per_round, 1, 6, d.max_per_round);
    out.timeout_sec = clampInt(src.timeout_sec, 30, 1800, d.timeout_sec);
    out.interval_ms = clampInt(src.interval_ms, 0, 60000, d.interval_ms);
    out.inject_depth = clampInt(src.inject_depth, 0, 20, d.inject_depth);
    out.ctx_timeout_sec = clampInt(src.ctx_timeout_sec, 10, 600, d.ctx_timeout_sec);

    // Lịch sử sinh ảnh: Chỉ giữ lại các mục có cấu trúc hoàn chỉnh, tất cả các trường bị ép về biến vô hướng (scalar), tránh việc ném một object bất kỳ vào file cài đặt.
    const rawHist = Array.isArray(src.history) ? src.history : [];
    out.history = rawHist
        .filter(x => x && typeof x === 'object' && x.url)
        .slice(-HISTORY_MAX)
        .map(x => ({
            t: Number(x.t) || 0,
            url: String(x.url ?? ''),
            prompt: String(x.prompt ?? '').slice(0, HISTORY_PROMPT_MAX),
            name: String(x.name ?? '').slice(0, 120),
            mid: Number(x.mid) || 0,
            idx: Number(x.idx) || 0,
        }));

    return out;
}

let rt = defaultSettings();

// Khóa lưu trữ cũ (v_illust): Chỉ dùng để migrate cài đặt khi nâng cấp từ phiên bản cũ ở lần chạy đầu tiên, không ghi vào nữa.
const LEGACY_MODULE_KEY = 'v_illust';

// initSettings Khởi tạo lúc khởi động: Giá trị mặc định -> SillyTavern persist đè lên.
export function initSettings() {
    // Lần đầu tiên khởi động bằng key mới, nếu có dữ liệu của key cũ thì migrate sang, tránh làm mất cài đặt đã lưu.
    if (extension_settings[MODULE_KEY] === undefined && extension_settings[LEGACY_MODULE_KEY] !== undefined) {
        extension_settings[MODULE_KEY] = extension_settings[LEGACY_MODULE_KEY];
        delete extension_settings[LEGACY_MODULE_KEY];
    }
    rt = normalize(extension_settings[MODULE_KEY]);
    persist();
    return rt;
}

function persist() {
    extension_settings[MODULE_KEY] = JSON.parse(JSON.stringify(rt));
    saveSettingsDebounced();
}

// settingsGet Điểm đọc có hiệu lực nóng (hot-reload) thống nhất lấy từ đây.
export function settingsGet() {
    return rt;
}

function parseTypes(s) {
    return String(s ?? '')
        .split(/[,，\s]+/)
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

// isTypeExcluded Loại tin nhắn này có bị người dùng bỏ qua hay không.
export function isTypeExcluded(type) {
    if (!type) return false;
    return parseTypes(rt.exclude_types).includes(String(type).toLowerCase());
}

/**
 * applyPatch Áp dụng các key/value được bảng điều khiển submit: Validate xong cho có hiệu lực nóng và ghi vào đĩa.
 * @param {object} patch
 * @returns {string[]} notes Các vấn đề cần nhắc nhở người dùng (Ví dụ model bị để trống, địa chỉ không hợp lệ)
 */
export function applyPatch(patch) {
    const notes = [];
    const merged = { ...rt };
    for (const k of Object.keys(defaultSettings())) {
        // Lịch sử sinh ảnh là dữ liệu chứ không phải cài đặt, không tham gia vào việc ghi cài đặt và khôi phục mặc định, chỉ có thể xóa bằng clearHistory
        if (k === 'history') continue;
        if (patch[k] !== undefined) merged[k] = patch[k];
    }
    const next = normalize(merged);

    if (next.base_url !== '' && !/^https?:\/\//i.test(next.base_url)) {
        notes.push('Địa chỉ dịch vụ NAI phải bắt đầu bằng http:// hoặc https://, vui lòng kiểm tra lại');
    }
    if (next.base_url === '') {
        notes.push('Địa chỉ dịch vụ NAI bị bỏ trống: Sẽ kết nối trực tiếp bằng extension V.Adapter trên cùng trang; Nếu chưa cài đặt extension đó, vui lòng điền địa chỉ dịch vụ vào đây');
    }

    rt = next;
    persist();
    return notes;
}

/**
 * recordHistory Thêm một mục lịch sử sinh ảnh và ghi đĩa.
 *
 * Lịch sử tách biệt (decouple) với cuộc trò chuyện hiện tại: Chuyển chat, đổi nhân vật, khởi động lại SillyTavern vẫn có thể xem lại.
 * Khi vượt quá giới hạn sẽ vứt bỏ mục cũ nhất.
 *
 * @param {{url:string, prompt?:string, name?:string, mid?:number, idx?:number}} entry
 * @returns {number} Số mục lịch sử hiện tại
 */
export function recordHistory(entry) {
    const url = String(entry?.url ?? '').trim();
    if (!url) return rt.history?.length ?? 0;
    const list = Array.isArray(rt.history) ? rt.history.slice() : [];
    list.push({
        t: Date.now(),
        url,
        prompt: String(entry?.prompt ?? '').slice(0, HISTORY_PROMPT_MAX),
        name: String(entry?.name ?? '').slice(0, 120),
        mid: Number(entry?.mid) || 0,
        idx: Number(entry?.idx) || 0,
    });
    if (list.length > HISTORY_MAX) list.splice(0, list.length - HISTORY_MAX);
    rt.history = list;
    persist();
    return list.length;
}

/** clearHistory Xóa sạch lịch sử sinh ảnh (Không ảnh hưởng đến file ảnh đã lưu trên ổ đĩa). */
export function clearHistory() {
    rt.history = [];
    persist();
    return 0;
}

// resolveApiBase Chuỗi địa chỉ cung cấp cho module xuất ảnh (Đã cắt bỏ dấu gạch chéo ở cuối).
export function apiBase() {
    return rt.base_url;
}