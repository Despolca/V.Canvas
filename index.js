// index.js -- V.Canvas · Cửa ngõ (entry point) extension frontend SillyTavern.
//
// Trách nhiệm: Khi trong câu trả lời của AI xuất hiện thẻ đánh dấu [ILLUST: Mô tả khung hình | Danbooru,Tags] (gọi tắt là thẻ/tag),
//       sẽ thay thế tại chỗ thẻ đó thành một bức ảnh minh họa chiếm trọn một dòng, chèn vào ngay bên dưới đoạn văn chứa nó, tạo thành bố cục hình-chữ xếp dọc.
//
// Giao thức xuất ảnh: Chỉ triển khai giao thức NovelAI (POST /ai/generate-image), trỏ tới dịch vụ giao thức NAI bên ngoài
// (V.Adapter, mặc định http://127.0.0.1:8888).
// Xử lý phản hồi: Luồng nhị phân của hình ảnh được lấy xài luôn; ZIP đi nhánh giải nén tương thích.
//
// WARN: Extension loader của SillyTavern chỉ mount <script type="module">, sẽ không gọi hàm init() mà extension export ra,
//       do đó ở cuối file này phải tự động kích hoạt.

import { eventSource, event_types, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { saveBase64AsFile } from '/scripts/utils.js';

import {
    initSettings, settingsGet, applyPatch, isTypeExcluded, defaultSettings, recordHistory, clearHistory,
} from './lib/settings.js';
import { findMarkers, hasMarkers, stripMarkers, buildDisplayText, effectiveSource, resolvePromptMode, selectPrompt, isLocalUpstream } from './lib/marker.js';
import { generateIllustration, testConnection } from './lib/nai-api.js';
import { applyMarkers } from './lib/analysis.js';
import { analyzeContext, testAnalyzeModel } from './lib/llm-api.js';
import { showProgress, updateProgress, finishProgress, hideProgress, setCancelHandler } from './lib/progress.js';

export const MODULE_NAME = 'v_canvas';
const VERSION = '0.1.2';

// Key dùng để inject system prompt (Ghi đè cùng một key sẽ replace chứ không bị tích lũy cộng dồn).
const PROMPT_KEY = 'v_canvas_rule';

// Template của quy tắc tag mặc định: Giới hạn xuất ảnh được thay thế theo "Giới hạn mỗi lượt".
//
// Văn bản quy tắc chính là toàn bộ cơ sở để model sản xuất ra thẻ đánh dấu, do đó phải viết rõ từng điều một: Định dạng, các yếu tố đoạn mô tả cần bao phủ,
// hình thức và trình tự sắp xếp của đoạn nhãn, tính tự túc (độc lập) của thẻ đơn lẻ, và yêu cầu phân bổ khi có nhiều thẻ.
function ruleTemplate(n) {
    return `Nếu cốt truyện xuất hiện sự thay đổi bối cảnh rõ rệt, thay đổi ngoại hình nhân vật hoặc cảnh tượng kịch tính cao, vui lòng xuất thẻ đánh dấu ở một dòng mới ngay dưới đoạn văn tương ứng:\n`
        + `[ILLUST: Mô tả bằng ngôn ngữ tự nhiên | Danbooru,Tags]\n`
        + `Thẻ đánh dấu bắt buộc phải tuân thủ các yêu cầu sau:\n`
        + `1. Bắt buộc phải điền cả hai đoạn, ngăn cách bằng dấu |, không được bỏ sót đoạn nào.\n`
        + `2. Đoạn mô tả viết bằng ngôn ngữ tự nhiên, bắt buộc phải bao phủ các đặc điểm ngoại hình của nhân vật, trang phục và đạo cụ, tư thế động tác, môi trường bối cảnh, bố cục và góc máy, phong cách mỹ thuật (art style).\n`
        + `3. Đoạn nhãn (tags) sử dụng Danbooru Tag tiếng Anh, ngăn cách bằng dấu phẩy tiếng Anh, xếp theo thứ tự "Chủ thể, ngoại hình, trang phục, động tác, bối cảnh, phong cách".\n`
        + `4. Thẻ đơn lẻ phải có tính tự túc (độc lập): Cần bao gồm đầy đủ đặc điểm của nhân vật chính và thông tin bối cảnh của khung hình đó, không phụ thuộc vào các thẻ khác để bù đắp.\n`
        + `5. Khi xuất ra nhiều thẻ trong một lượt, các thẻ phải nhắm vào các thời điểm khung hình khác nhau, và phân bổ ở các vị trí khác nhau trong chính văn (Ví dụ đoạn giữa và đoạn cuối), không được tập trung tại một chỗ, cũng không được lặp lại mô tả cho cùng một khung hình.\n`
        + `6. Việc lên ý tưởng khung hình và chính văn cốt truyện được hoàn thành cùng lúc trong một lần sinh (generate), không cần chờ đợi các bước bổ sung.\n`
        + `7. Thẻ đánh dấu được viết ngay bên dưới đoạn văn tự sự của chính văn, không được viết vào bên trong thanh trạng thái, khối suy nghĩ, bảng biểu hay các khối có cấu trúc khác; Nếu chính văn bị bọc bên trong một thẻ nào đó (Ví dụ <story_scene>), thẻ đánh dấu phải được viết vào bên dưới đoạn văn tương ứng ở bên trong cái thẻ đó.\n`
        + `Mỗi lần trả lời xuất tối đa ${n} thẻ đánh dấu, mỗi thẻ tương ứng với một bức ảnh minh họa, chèn vào ngay bên dưới đoạn văn của chính nó.`;
}

// -- Trạng thái runtime --

const inFlight = new Set();   // Các messageId đang được xử lý (debounce)
const lastPass = new Map();   // messageId -> Timestamp của lần xử lý trước (Chống bão click liên tục)
const PASS_COOLDOWN = 4000;

// -- Kiểm soát việc hủy (cancel) của lượt hiện tại --
// Request phân tích và request xuất ảnh đều treo trên signal này, nút "Chấm dứt" gọi abort nó là có thể ngắt toàn bộ lượt.
let runAbort = null;

function beginRun() {
    try { runAbort?.abort(); } catch { /* Lượt trước đã kết thúc */ }
    runAbort = new AbortController();
    setCancelHandler(() => { try { runAbort?.abort(); } catch { /* Bỏ qua */ } });
    return runAbort.signal;
}

function endRun() {
    runAbort = null;
    setCancelHandler(null);
}

function isAborted(signal) {
    return !!signal?.aborted;
}

function s() { return settingsGet(); }

// buildUpstreamPrompt Ghép từ khóa phá giới hạn sinh ảnh (nếu có điền) vào ngay đầu của prompt xuất ảnh.
// Nếu trống thì trả về nguyên trạng. Dấu ghép là ", ", vô hại đối với cả chuỗi nhãn Danbooru lẫn ngôn ngữ tự nhiên.
// Plugin này không tích hợp sẵn bất kỳ nội dung phá giới hạn nào, nội dung trong khung do người sử dụng tự điền và tự chịu trách nhiệm.
function buildUpstreamPrompt(prompt, jbImage) {
    const p = String(prompt ?? '');
    const j = String(jbImage ?? '').trim();
    return j ? `${j}, ${p}` : p;
}

function log(...args) {
    if (s().debug) console.log('[V.Canvas]', ...args);
}

function warn(...args) {
    console.warn('[V.Canvas]', ...args);
}

// -- Khởi tạo --

export async function init() {
    initSettings();
    addSettingsUI();
    syncPromptInjection();
    registerEvents();
    installPromptViewer();
    log(`Đã tải v${VERSION}`);
}

export async function exit() {
    closePanel();
    closePromptOverlay();
    hideProgress();
    $('#v_canvas_drawer').remove();
    try {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.NONE, 0);
    } catch { /* Bỏ qua */ }
}

function registerEvents() {
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    // Chuyển chat / Render lại: Viết lại các ảnh minh họa đã xuất thành công vào DOM. display_text đã được lưu trữ (persist) cùng lịch sử trò chuyện,
    // Ở đây chỉ dùng để đỡ (fallback) cho số ít trường hợp ST xóa mất display_text.
    const rehydrate = () => { rehydrateAll().catch(err => warn('Khôi phục hiển thị ảnh minh họa thất bại:', err)); };
    eventSource.on(event_types.CHAT_CHANGED, rehydrate);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, rehydrate);
    eventSource.on(event_types.MESSAGE_EDITED, rehydrate);
    eventSource.on(event_types.MESSAGE_UPDATED, rehydrate);

    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
        // Xử lý trì hoãn: Nếu cú swipe đó kích hoạt hành động gen lại, thì sẽ được giao cho luồng stream xử lý, ở đây bỏ qua.
        setTimeout(() => { onSwipeSettled(mesId).catch(err => warn('Xử lý swipe thất bại:', err)); }, 700);
    });

    // WARN: Khi SillyTavern render thì mức ưu tiên của extra.display_text cao hơn mes.
    //       Trong quá trình viết tiếp (continue) / generate lại, mes liên tục thay đổi mà display_text vẫn giữ nguyên giá trị cũ, nếu không gỡ bỏ sẽ khiến nội dung dạng stream không nhìn thấy được.
    //       Do đó khi 2 loại generate này bắt đầu, trước tiên phải gỡ bỏ display_text trên tin nhắn cuối cùng.
    //       Chú ý bắt buộc phải loại trừ type === 'normal': Đó là "Gửi tin nhắn mới", display_text của tin nhắn trước đó
    //       vẫn còn hiệu lực, nếu lúc này mà xóa thì sẽ làm bức ảnh minh họa đã vẽ xong biến mất tăm (Ảnh vẫn còn, chỉ là không hiển thị).
    eventSource.on(event_types.GENERATION_STARTED, (type) => {
        if (type === 'normal') return;
        try {
            const ctx = getContext();
            const last = (ctx.chat?.length ?? 0) - 1;
            const msg = ctx.chat?.[last];
            if (last >= 0 && msg?.extra?.illust && msg.extra.display_text) {
                delete msg.extra.display_text;
                ctx.updateMessageBlock(last, { ...msg });
                log(`#${last} ${type} Bắt đầu generate, tháo display_text cũ ra trước`);
            }
        } catch (err) {
            warn('Dọn dẹp display_text cũ thất bại:', err);
        }
    });
}

// -- Nhận tin nhắn --

async function onMessageReceived(messageId, type) {
    if (!s().enabled) return;
    if (type === 'extension') return;                        // Tin nhắn do extension khác nhét vào, không quan tâm
    if (isTypeExcluded(type)) { log(`Bỏ qua type bị loại trừ ${type}`); return; }
    if (type === 'swipe' && !s().swipe_regenerate) { log('Đã tắt tính năng cấp lại ảnh cho swipe, bỏ qua'); return; }

    const ctx = getContext();
    const msg = ctx.chat?.[messageId];
    if (!msg || msg.is_user || msg.is_system) return;

    // Hai luồng chạy song song, không giẫm chân lên nhau:
    //   ① Điều hướng bằng thẻ đánh dấu -- Khi chính văn đã chứa [ILLUST: ...] thì sẽ do processMessage xử lý (Không tốn thời gian chờ đợi)
    //   ② Điều hướng bằng ngữ cảnh -- Khi chính văn không có thẻ đánh dấu, và đã bật tính năng Xuất ảnh từ ngữ cảnh, sẽ giao cho model độc lập đọc chính văn để trám chỗ (fill in)
    await processMessage(messageId, type, msg);
    await processContextIllustration(messageId, msg);
}

// -- Xuất ảnh từ ngữ cảnh (Model độc lập đọc chính văn -> Sản xuất prompt -> Giao cho 8888 / NAI xuất ảnh) --
//
// Lý do tồn tại: Điều hướng bằng thẻ đánh dấu đòi hỏi model cốt truyện chủ động phối hợp, khi gặp thẻ nhân vật có template output cực mạnh (rất nhiều thẻ sandbox) sẽ làm nó vô hiệu.
// Luồng này giao quyền "quyết định vẽ cái gì" cho một model tương thích OpenAI được cấu hình độc lập, do đó không phụ thuộc vào sự hợp tác của bất kỳ thẻ nhân vật nào.
//
// Prompt được sản xuất ra bao gồm cả ngôn ngữ tự nhiên và nhãn Danbooru, cuối cùng sẽ do prompt_format quyết định gửi đi nửa nào,
// do đó đi qua V.Adapter (Tuyến trên định dạng OpenAI) hay kết nối trực tiếp với NAI / NAI Gateway đều xài được tuốt.

const ctxInFlight = new Set();

// collectContext Lấy một vài tin nhắn trước tin nhắn này làm phần trước (tiền văn), cung cấp cho model phân tích để hiểu nhân vật và bối cảnh.
// Mặc định lấy 8 tin nhắn, mỗi tin nhắn 800 chữ: Việc phán đoán tác phẩm và thế giới quan đòi hỏi đủ lượng danh từ riêng và thông tin nhân vật,
// mớm ít quá sẽ khiến model phân tích viết ra prompt chung chung đứt lìa với thế giới quan.
function collectContext(chat, messageId, maxMessages = 8, perMessage = 800) {
    const parts = [];
    for (let i = Math.max(0, messageId - maxMessages); i < messageId; i++) {
        const m = chat?.[i];
        if (!m) continue;
        const text = String(m.extra?.illust?.src ?? m.mes ?? '').trim();
        if (!text) continue;
        parts.push(`${m.is_user ? 'Người dùng' : 'Nhân vật'}: ${truncateText(text, perMessage)}`);
    }
    return parts.join('\n');
}

// workLabel Thông tin thẻ nhân vật cung cấp cho model phân tích để phán đoán tác phẩm và art style.
function workLabel(ctx) {
    const parts = [];
    const name = String(ctx?.name2 ?? '').trim();
    if (name) parts.push(`Thẻ nhân vật: ${name}`);
    if (ctx?.groupId) parts.push('(Chat nhóm)');
    return parts.join(' ');
}

async function processContextIllustration(messageId, msg) {
    const cfg = s();
    if (!cfg.ctx_enabled) return;
    if (msg.extra?.illust) return;                    // Luồng thẻ đánh dấu đã xuất ảnh xong
    if (ctxInFlight.has(messageId)) return;

    const mes = String(msg.mes ?? '');
    if (hasMarkers(mes)) return;                      // Chính văn tự mang theo thẻ đánh dấu, chạy luồng thẻ đánh dấu
    if (!mes.trim()) return;
    if (!cfg.ctx_url || !cfg.ctx_model) {
        warn('Đã bật Xuất ảnh từ ngữ cảnh, nhưng chưa cấu hình địa chỉ hoặc tên model phân tích, lần này bỏ qua');
        finishProgress('Đã bật Xuất ảnh từ ngữ cảnh, nhưng chưa cấu hình địa chỉ hoặc tên model phân tích', true);
        return;
    }

    const tag = `#${messageId}(Ngữ cảnh)`;
    ctxInFlight.add(messageId);
    const ctx = getContext();
    // Số lượng ảnh đồng nhất đi theo "Giới hạn mỗi lượt" (Cùng một cấu hình với luồng điều hướng bằng thẻ),
    // Tránh việc 2 loại giới hạn đá nhau: Sửa ở trang cấu hình nhưng xuất ảnh từ ngữ cảnh lại không ăn.
    const maxImages = Math.min(6, Math.max(1, cfg.max_per_round | 0));
    const signal = beginRun();
    showProgress(`Đang phân tích chính văn... (Khoảng 10~30 giây, tối đa ${maxImages} tấm)`);
    try {
        log(`${tag} Gửi model phân tích (${cfg.ctx_model}), chính văn ${[...mes].length} chữ`);
        const items = await analyzeContext({
            baseUrl: cfg.ctx_url,
            apiKey: cfg.ctx_key,
            model: cfg.ctx_model,
            reply: mes,
            context: collectContext(ctx.chat, messageId),
            work: workLabel(ctx),
            style: cfg.ctx_style,
            quality: cfg.ctx_quality,
            negative: cfg.ctx_negative,
            jb: cfg.jb_llm,
            max: maxImages,
            timeoutMs: cfg.ctx_timeout_sec * 1000,
            signal,
        });
        if (isAborted(signal)) { finishProgress('Đã chấm dứt', false); return; }
        if (!items.length) {
            log(`${tag} Model phân tích cho rằng đoạn văn này không có khung hình nào đáng vẽ`);
            finishProgress('Kết quả phân tích rỗng: Câu trả lời này không tìm thấy khung hình nào đáng vẽ', false);
            return;
        }
        log(`${tag} Phân tích được ${items.length} khung hình`);
        await runIllustration(ctx, messageId, msg, items, signal);
    } catch (err) {
        if (isAborted(signal)) { finishProgress('Đã chấm dứt', false); return; }
        const m = truncateText(err?.message ?? String(err), 300);
        warn(`${tag} Thất bại: `, m);
        finishProgress(`Xuất ảnh từ ngữ cảnh thất bại: ${m}`, true);
        toastr.error(`Xuất ảnh từ ngữ cảnh thất bại: ${m}`, 'V.Canvas', { timeOut: 12000 });
    } finally {
        ctxInFlight.delete(messageId);
        endRun();
    }
}

// runIllustration Sau khi convert danh sách khung hình thành thẻ đánh dấu, tái sử dụng luồng xuất ảnh và thay thế tại chỗ đã có sẵn.
async function runIllustration(ctx, messageId, msg, items, signal) {
    const cfg = s();
    const reply = String(msg.mes ?? '');
    const src = applyMarkers(reply, items);
    const markers = findMarkers(src);
    if (!markers.length) {
        log(`#${messageId} Sau khi lắp ráp thẻ đánh dấu bị rỗng, bỏ qua`);
        finishProgress('Không có thẻ đánh dấu nào có thể chèn', true);
        return;
    }

    msg.extra = msg.extra || {};
    const st = { src, urls: new Array(markers.length).fill(null) };
    msg.extra.illust = st;

    const promptMode = resolvePromptMode(cfg.prompt_format, cfg.base_url);
    const { ok, errors } = await drawMarkers(ctx, messageId, msg, st, markers, cfg, signal, promptMode);

    if (isAborted(signal)) {
        finishProgress('Đã chấm dứt', false);
    } else if (ok > 0) {
        finishProgress(`Đã hoàn thành ảnh minh họa${ok > 1 ? ` (${ok} tấm)` : ''}`);
    } else {
        finishProgress(`Sinh ảnh minh họa thất bại: ${errors[0] ?? 'Lý do không xác định'}`, true);
    }
    await finishMessage(ctx, messageId, msg, st, ok, errors);
}

// onSwipeSettled Khi chuyển sang một câu trả lời đã có sẵn khác (Không kích hoạt gen lại), tiến hành trám chỗ hoặc khôi phục ảnh minh họa cho nó.
async function onSwipeSettled(messageId) {
    if (!s().enabled) return;
    if (messageId === undefined || messageId === null) return;
    if (!s().swipe_regenerate) { await rehydrateAll(); return; }
    if (isGenerating()) { log('swipe đã kích hoạt gen lại, giao cho MESSAGE_RECEIVED xử lý'); return; }

    const ctx = getContext();
    const msg = ctx.chat?.[Number(messageId)];
    if (!msg || msg.is_user || msg.is_system) return;

    const st = msg.extra?.illust;
    if (st && Array.isArray(st.urls) && st.urls.length > 0 && st.urls.every(Boolean)) {
        rehydrateOne(Number(messageId), msg); // Cái này đã có ảnh rồi, chỉ việc dán hiển thị lại
        return;
    }
    if (!hasMarkers(String(msg.mes ?? ''))) return;
    await processMessage(Number(messageId), 'swipe', msg);
}

// isGenerating SillyTavern có đang sinh text/trả về stream hay không (Trong khoảng thời gian này không được render lại DOM của tin nhắn).
function isGenerating() {
    const sp = getContext().streamingProcessor;
    return !!(sp && sp.isFinished === false);
}

// -- Luồng chính: Bắt thẻ đánh dấu -> Xuất ảnh tuần tự -> Thay thế tại chỗ --

async function processMessage(messageId, type, msg) {
    const mes = String(msg.mes ?? '');
    const tag = `#${messageId}(${type ?? '-'})`;

    if (msg.extra?.illust_done) { log(`${tag} Đã từng xuất ảnh, bỏ qua`); return; }
    if (inFlight.has(messageId)) { log(`${tag} Đang được xử lý, bỏ qua`); return; }

    const now = Date.now();
    if (now - (lastPass.get(messageId) ?? 0) < PASS_COOLDOWN) { log(`${tag} Đang trong thời gian cooldown, bỏ qua`); return; }
    lastPass.set(messageId, now);

    // Trạng thái: src = nguyên văn hoàn chỉnh chứa cả thẻ (Là cơ sở duy nhất để hiển thị và retry), urls tương ứng 1:1 với thẻ.
    // Khi continue / append, mes = Text cũ đã xóa thẻ + Text mới, ở đây sẽ nối nguyên văn trở lại rồi đếm thẻ.
    const st0 = msg.extra?.illust;
    const eff = effectiveSource(mes, st0);
    const markers = findMarkers(eff.src);
    if (!markers.length) return; // Bỏ qua trong im lặng, không làm phiền người dùng
    log(`${tag} Trúng đích ${markers.length} thẻ, source mode=${eff.mode}`);

    const cfg = s();
    if (!cfg.base_url && !isLocalUpstream(cfg.base_url)) {
        toastr.warning('Chưa cấu hình địa chỉ dịch vụ NAI: Nếu có cài V.Adapter sẽ tự động kết nối; Nếu không vui lòng điền một địa chỉ dịch vụ giao thức NovelAI', 'V.Canvas');
        return;
    }

    // Nội dung gửi đi được phân luồng: Dịch vụ adapter local đi đường mô tả tự nhiên, còn lại đi đường nhãn Danbooru.
    const promptMode = resolvePromptMode(cfg.prompt_format, cfg.base_url);
    log(`${tag} prompt_format=${cfg.prompt_format} -> Gửi đi ${promptMode}`);

    const ctx = getContext();
    inFlight.add(messageId);
    const signal = beginRun();

    msg.extra = msg.extra || {};
    let st = st0;
    const oldCount = st?.src ? findMarkers(st.src).length : 0;
    const reuse = !!st && Array.isArray(st.urls) && !!st.src
        && st.urls.length === oldCount
        && (eff.mode === 'same' || eff.mode === 'append');
    if (!reuse) {
        st = { src: eff.src, urls: new Array(markers.length).fill(null) };
        msg.extra.illust = st;
    } else {
        // Hoàn cảnh viết tiếp (continue): Thẻ đã có giữ nguyên hiện trạng (Ảnh đã sinh thì tiếp tục dùng), chỉ bù chỗ trống cho thẻ mới thêm
        if (markers.length > st.urls.length) {
            st.urls = st.urls.concat(new Array(markers.length - st.urls.length).fill(null));
        }
        st.src = eff.src;
    }
    if (markers.length < st.urls.length) st.urls.length = markers.length;

    const todo = markers.filter(m => !st.urls[m.index]);
    const batch = todo.slice(0, Math.max(1, cfg.max_per_round));
    let ok = 0;
    const errors = [];

    try {
        if (batch.length === 0) {
            // Toàn bộ ảnh đã được sinh từ trước, chỉ là chưa dán hiển thị lên
            await finishMessage(ctx, messageId, msg, st, 0, []);
            return;
        }
        const r = await drawMarkers(ctx, messageId, msg, st, batch, cfg, signal, promptMode);
        ok = r.ok;
        errors.push(...r.errors);
    } finally {
        inFlight.delete(messageId);
        endRun();
    }

    if (isAborted(signal)) {
        finishProgress('Đã chấm dứt', false);
    } else if (ok > 0) {
        finishProgress(`Đã hoàn thành ảnh minh họa${ok > 1 ? ` (${ok} tấm)` : ''}`);
    } else {
        finishProgress(`Sinh ảnh minh họa thất bại: ${errors[0] ?? 'Lý do không xác định'}`, true);
    }
    finishMessage(ctx, messageId, msg, st, ok, errors);
}

// finishMessage Thu dọn: Thống kê kết quả -> Ghi đĩa (Persist) -> Thông báo (Trong lịch sử chat không để lọt lại chữ loading).
async function finishMessage(ctx, messageId, msg, st, ok, errors) {
    const allDone = st.urls.length > 0 && st.urls.every(Boolean);
    msg.extra.illust_done = allDone;

    // Ảnh minh họa không đi vào ngữ cảnh: Chính văn chỉ giữ lại văn bản thuần, hình ảnh chỉ được ghi vào extra.display_text.
    if (ok > 0 && s().strip_marker) {
        const cleaned = stripMarkers(String(msg.mes ?? ''));
        if (cleaned && cleaned !== msg.mes) msg.mes = cleaned;
    }

    applyDisplay(ctx, messageId, msg, st);

    try {
        await ctx.saveChat();
    } catch (err) {
        warn('Lưu lịch sử chat thất bại:', err);
    }

    if (ok > 0 && errors.length === 0) {
        toastr.success(`Đã hoàn thành ảnh minh họa${ok > 1 ? ` (${ok} tấm)` : ''}`, 'V.Canvas');
    } else if (ok > 0) {
        toastr.warning(`Đã hoàn thành ${ok} ảnh, có ${errors.length} ảnh thất bại: ${errors[0]}`, 'V.Canvas', { timeOut: 12000 });
    } else if (errors.length) {
        toastr.error(`Sinh ảnh minh họa thất bại: ${errors[0]}`, 'V.Canvas', { timeOut: 12000 });
    }
}

// applyDisplay Render "Nguyên văn + URL đã xuất ảnh" thành display_text và refresh lại DOM của tin nhắn này.
//
// pending cố định là 'drop': Thẻ nào chưa xuất ảnh thì không được lưu lại trong chính văn.
// Nếu không lúc bức hình đầu tiên hiện ra, mấy trăm chữ prompt của bức thứ 2 sẽ trà trộn vào chính văn dưới dạng plain text --
// Trông sẽ thành "Ảnh thì chả thấy, chỉ thấy phọt ra một nùi chữ", trong khi trên thực tế tấm đầu tiên đã được sinh xong rồi.
function applyDisplay(ctx, messageId, msg, st) {
    const dt = buildDisplayText(st.src ?? String(msg.mes ?? ''), st.urls, 'Illustration', 'drop');
    if (dt) {
        msg.extra.display_text = dt;
    } else {
        delete msg.extra.display_text;
    }
    try {
        ctx.updateMessageBlock(messageId, { ...msg }); // Chỉ render lại mỗi dòng này, sẽ không kích hoạt lại các event khác
        hardenChatIllustrationImages(messageId);
    } catch (err) {
        warn('Refresh tin nhắn DOM thất bại:', err);
    }
    try {
        if (messageId === (ctx.chat?.length ?? 0) - 1) ctx.scrollOnMediaLoad?.();
    } catch { /* Bản cũ không có method này */ }
}

/**
 * drawMarkers Thực thi một nhóm task xuất ảnh, mỗi tấm thành công là sẽ tự trám vào chỗ của nó ngay lập tức.
 *
 * Tuần tự (parallel tắt, mặc định): Request từng cái một. Thích hợp khi tuyến trên giới hạn đồng thời hoặc có kiểm soát rủi ro rate limit.
 * Song song (parallel bật): Phát tất cả request cùng một lúc, mỗi cái tự await, cái nào về trước trám vào trước --
 *   Không đợi các request khác, cũng không đợi cả lô hoàn tất. Thích hợp cho các tuyến trên cho phép đồng thời (concurrency).
 *
 * Ở cả 2 chế độ, mỗi khi một tấm hoàn thành đều sẽ lập tức render lại tin nhắn đó, nhờ thế tấm đầu tiên vừa ra lò là thấy ngay,
 * không bị tấm thứ hai chưa xong níu chân. Các lỗi không ảnh hưởng lẫn nhau: Một tấm thất bại sẽ không ngắt ngang các request còn lại.
 *
 * @returns {Promise<{ok:number, errors:string[]}>}
 */
async function drawMarkers(ctx, messageId, msg, st, batch, cfg, signal, promptMode) {
    const total = batch.length;
    let ok = 0;
    let done = 0;
    const errors = [];

    updateProgress(cfg.parallel
        ? `Đang vẽ ${total} ảnh minh họa ... Khoảng 30~60 giây`
        : (total > 1
            ? `Đang vẽ ảnh minh họa 1/${total} ... Khoảng 30~60s/tấm, có thể chat cái khác trước`
            : 'Đang vẽ ảnh minh họa ... Khoảng 30~60 giây'));

    // Placeholder chỉ sửa đổi DOM, không ghi đĩa (Một khi ghi vào rồi mà lỡ fail hoặc refresh trang thì chữ "Đang vẽ" sẽ nằm kẹt lại đó vĩnh viễn).
    for (const m of batch) showPlaceholder(messageId, m.raw, 'Đang vẽ ảnh minh họa ...');

    const runOne = async (m) => {
        try {
            const gen = await generateIllustration({
                baseUrl: cfg.base_url,
                apiKey: cfg.api_key,
                model: cfg.model,
                prompt: buildUpstreamPrompt(selectPrompt(m, promptMode), cfg.jb_image),
                negative: cfg.negative,
                width: cfg.width,
                height: cfg.height,
                steps: cfg.steps,
                scale: cfg.scale,
                timeoutMs: cfg.timeout_sec * 1000,
                signal,
            });

            const subFolder = ctx.name2 || '';
            const fileName = `illust_${Date.now()}_${m.index}`;
            // url tồn tại = Kết quả fallback link từ xa (remote) của tuyến trên (Không có byte local), dẫn link trực tiếp, không ghi đĩa
            const url = gen.url ?? await saveBase64AsFile(gen.base64, subFolder, fileName, gen.extension);
            st.urls[m.index] = url;
            ok++;
            done++;
            log(`#${messageId} Tấm thứ ${m.index + 1} hoàn tất -> ${url}`);

            // Ghi vào lịch sử sinh ảnh: Tách biệt với cuộc trò chuyện hiện tại, chuyển sang chat khác vẫn xem lại được
            recordHistory({
                url,
                prompt: selectPrompt(m, promptMode),
                name: subFolder,
                mid: messageId,
                idx: m.index,
            });

            applyDisplay(ctx, messageId, msg, st);
            updateProgress(total > 1 ? `Đã hoàn thành ${done}/${total} tấm` : 'Đã hoàn thành ảnh minh họa');
        } catch (err) {
            if (isAborted(signal)) return;
            const msgText = truncateText(err?.message ?? String(err), 300);
            errors.push(msgText);
            warn(`#${messageId} Tấm thứ ${m.index + 1} thất bại:`, msgText);
        }
    };

    if (cfg.parallel) {
        await Promise.all(batch.map(m => runOne(m)));
    } else {
        for (let i = 0; i < batch.length; i++) {
            await runOne(batch[i]);
            if (isAborted(signal)) break;
            if (i < batch.length - 1 && cfg.interval_ms > 0) {
                await sleep(cfg.interval_ms);
            }
        }
    }
    return { ok, errors };
}

// -- Xem prompt của ảnh minh họa --
//
// Bản thân prompt đã được lưu cùng lịch sử trò chuyện (extra.illust.src là nguyên văn đầy đủ chứa cả thẻ),
// Ở đây chỉ bù thêm một cổng hiển thị: Click vào ảnh -> Hiện overlay hiển thị mô tả và nhãn của thẻ tương ứng.
//
// Ràng buộc hiệu năng:
//   - Ủy quyền sự kiện (Event delegation): Listener chỉ treo 1 lần duy nhất trong toàn bộ vòng đời ứng dụng, treo thẳng vào tổ tiên của container tin nhắn,
//     không bind riêng lẻ cho từng tấm ảnh (Số lượng ảnh tăng lên hoặc lặp lại render cũng sẽ không làm phình lượng listener);
//   - Phân tích On-demand: Prompt chỉ được phân tích lúc có click, khâu render không làm bất kỳ xử lý nào trước;
//   - Tiêu hủy overlay tức thì: Overlay và bộ lắng nghe bàn phím đi kèm chỉ tồn tại lúc đang mở, đóng là gỡ bỏ liền.
//   - Không trigger bất kỳ lần gọi model hay network request nào.

const PROMPT_OVERLAY_ID = 'v_canvas_prompt_overlay';
let promptViewerInstalled = false;
let promptKeyHandler = null;

function installPromptViewer() {
    if (promptViewerInstalled) return;
    promptViewerInstalled = true;
    // Bắn ở pha capture: Tránh việc bị các xử lý click khác bên trong tin nhắn chặn bọt (stopPropagation) làm cổng này bị vô hiệu.
    document.addEventListener('click', onChatImageClick, true);
}

function onChatImageClick(ev) {
    const img = ev.target?.closest?.('.mes_text img');
    if (!img) return;
    const info = resolveIllustration(img);
    if (info) showPromptOverlay(info);
}

// normalizeUrl Lược bỏ query string và phần host giao thức, sau đó decode một lần nữa --
// URL lúc lưu xuống là dạng nguyên thủy (Có thể có khoảng trắng), mà nằm trong display_text lại là bản đã qua mã hóa của encodeMdUrl,
// Hai bên đều phải decode xong thì mới khớp với nhau được.
function normalizeUrl(u) {
    let s = String(u ?? '').split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
    try {
        s = decodeURIComponent(s);
    } catch { /* Code không đủ bộ thì cứ dùng nguyên dạng mà so */ }
    return s;
}

/**
 * resolveIllustration Tra ngược lại từ tấm ảnh được click xem thứ tự của nó trong extra.illust và thẻ gốc là gì.
 * Các hình ảnh không do extension này sinh ra (Avatar thẻ nhân vật, ảnh do người dùng chèn tay...) sẽ auto trả về null.
 * @param {HTMLImageElement} img
 * @returns {{messageId:number,index:number,marker:object}|null}
 */
function resolveIllustration(img) {
    const mesEl = img.closest('.mes');
    if (!mesEl) return null;
    const messageId = Number(mesEl.getAttribute('mesid'));
    if (!Number.isInteger(messageId)) return null;

    const st = getContext().chat?.[messageId]?.extra?.illust;
    if (!st || !Array.isArray(st.urls) || !st.src) return null;

    const needle = normalizeUrl(img.getAttribute('src') || img.src);
    if (!needle) return null;
    const index = st.urls.findIndex(u => u && normalizeUrl(u) === needle);
    if (index < 0) return null;

    const marker = findMarkers(String(st.src))[index];
    if (!marker) return null;
    return { messageId, index, marker };
}

function closePromptOverlay() {
    document.getElementById(PROMPT_OVERLAY_ID)?.remove();
    if (promptKeyHandler) {
        document.removeEventListener('keydown', promptKeyHandler);
        promptKeyHandler = null;
    }
}

// showPromptOverlay Mở overlay xem prompt (DOM tạo tại chỗ, đóng là tiêu hủy ngay, không lưu vào lịch sử trò chuyện).
function showPromptOverlay({ messageId, index, marker }) {
    closePromptOverlay();

    const section = (label, value, mono) => {
        const body = value
            ? escapeHtml(value)
            : '<span class="v_canvas_prompt_none">(Chưa cung cấp trong thẻ)</span>';
        return `<div class="v_canvas_prompt_section">`
            + `<div class="v_canvas_prompt_lab">${label}</div>`
            + `<div class="v_canvas_prompt_text${mono ? ' mono' : ''}">${body}</div>`
            + `</div>`;
    };

    const el = document.createElement('div');
    el.id = PROMPT_OVERLAY_ID;
    el.innerHTML = `
        <div class="v_canvas_prompt_box" role="dialog" aria-label="Prompt ảnh minh họa">
            <div class="v_canvas_prompt_head">
                <span>Dòng ${messageId} · Tấm thứ ${index + 1}</span>
                <button type="button" class="menu_button v_canvas_prompt_close">Đóng</button>
            </div>
            <div class="v_canvas_prompt_body">
                ${section('Mô tả bằng ngôn ngữ tự nhiên', marker.desc, false)}
                ${section('Danbooru Tags', marker.tags, true)}
            </div>
        </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.v_canvas_prompt_close')) closePromptOverlay();
    });
    promptKeyHandler = (e) => { if (e.key === 'Escape') closePromptOverlay(); };
    document.addEventListener('keydown', promptKeyHandler);
}

// -- Dán trở lại hiển thị (Chuyển chat / Chuyển swipe) --

// hardenChatIllustrationImages Nhét thêm thuộc tính referrerpolicy="no-referrer" cho <img> minh họa trong chính văn.
//
// Tại sao phải làm: Tuyến trên CDN (cdn.qwenlm.ai) có cài cơ chế chống hotlink (anti-hotlinking), request nào mang theo Referer của SillyTavern là bị trả về 403 hết.
// Thẻ <img> nằm trong bảng điều khiển thì có thể viết thuộc tính trực tiếp; Nhưng chính văn thì render qua markdown, không mang theo thuộc tính đó được
// (Đường ống render sẽ lọc sạch sành sanh), chỉ có thể đợi DOM render xong rồi vá víu lại -- và gán lại src một lần nữa,
// bắt buộc nó phải gửi request lại bằng chính sách (policy) mới (Vì lúc gửi lần đầu có thể nó đã chạy bằng chính sách mặc định và bị dính 403 rồi).
// Chỉ xử lý những link ảnh từ xa do plugin này ghi vào, không đụng đến những tấm ảnh có nguồn gốc khác trong tin nhắn.
function hardenChatIllustrationImages(messageId) {
    try {
        const chat = getContext().chat ?? [];
        const urls = new Set();
        const collect = (msg) => {
            const list = msg?.extra?.illust?.urls;
            if (Array.isArray(list)) for (const u of list) {
                if (u && /^https?:/i.test(String(u))) urls.add(String(u));
            }
        };
        if (messageId === undefined) chat.forEach(collect);
        else collect(chat[messageId]);
        if (!urls.size) return;

        const norm = (u) => { try { return decodeURIComponent(String(u)); } catch { return String(u); } };
        const roots = messageId === undefined
            ? document.querySelectorAll('.mes_text')
            : document.querySelectorAll(`.mes[mesid="${messageId}"] .mes_text`);
        roots.forEach((root) => {
            root.querySelectorAll('img').forEach((im) => {
                const src = im.getAttribute('src') || '';
                if (!/^https?:/i.test(src)) return;                          // Chỉ xử lý ảnh remote
                if (!urls.has(src) && !urls.has(norm(src))) return;          // Chỉ xử lý ảnh của plugin này
                if (im.getAttribute('referrerpolicy') === 'no-referrer') return;
                im.setAttribute('referrerpolicy', 'no-referrer');
                im.src = src;                                                // Phát request lại bằng chính sách mới
            });
        });
    } catch (err) {
        warn('Gia cố chống hotlink cho ảnh minh họa thất bại:', err);
    }
}

function rehydrateOne(messageId, msg) {
    const st = msg?.extra?.illust;
    if (!st || !Array.isArray(st.urls) || !st.src) return false;
    // drop: Lúc chuyển chat để load lại mà có tấm nào chưa ra lò thì prompt của tấm đó không được lưu lại bằng plain text trong chính văn
    const dt = buildDisplayText(st.src, st.urls, 'Illustration', 'drop');
    const want = dt ?? undefined;
    if (msg.extra.display_text === want) return false;
    if (dt) msg.extra.display_text = dt; else delete msg.extra.display_text;
    try {
        getContext().updateMessageBlock(messageId, { ...msg });
        hardenChatIllustrationImages(messageId);
    } catch (err) {
        warn('Khôi phục hiển thị thất bại:', err);
    }
    return true;
}

async function rehydrateAll() {
    if (!s().enabled) return;
    if (isGenerating()) return; // Đang generate thì không chạm tay vào DOM

    const ctx = getContext();
    const chat = ctx.chat ?? [];
    let touched = false;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        const st = msg.extra?.illust;
        if (!st || !Array.isArray(st.urls) || !st.src) continue;
        if (st.urls.length !== findMarkers(st.src).length) {
            // Số lượng thẻ đánh dấu không khớp (Do người dùng đã dùng tay chỉnh sửa chính văn) -> Xóa sổ trạng thái hết hạn, để chính văn hiển thị dưới dạng text nguyên gốc
            delete msg.extra.illust;
            delete msg.extra.illust_done;
            delete msg.extra.display_text;
            touched = true;
            continue;
        }
        if (rehydrateOne(i, msg)) touched = true;
    }
    if (touched) {
        try { await ctx.saveChat(); } catch { /* Bỏ qua */ }
    }
    // Lướt qua toàn bộ một lượt lúc chuyển chat / load thêm: Những tin nhắn có display_text không thay đổi sẽ không chui vào rehydrateOne,
    // Nhưng các ảnh từ xa bên trong đó vẫn cần phải bù lại cái referrerpolicy (Do request ban đầu có thể đã dính 403 do policy mặc định).
    hardenChatIllustrationImages();
}

// -- Placeholder tại chỗ (Chỉ sửa đổi DOM, tuyệt đối không ghi vào lịch sử chat) --

/**
 * showPlaceholder Sẽ biến đổi thẻ [ILLUST: ...] trong tin nhắn thành cái thông báo "Đang vẽ" ngay tại chỗ.
 *
 * Chỉ sửa DOM là bởi vì: Một khi placeholder bị ghi đè vào `mes`, lỡ như sinh ảnh fail hoặc F5 trang,
 * chữ "Đang vẽ..." sẽ nằm vĩnh viễn trong lịch sử chat mà không có cơ chế nào để móc nó ra cả.
 * Khi sinh ảnh xong thông qua updateMessageBlock nó sẽ render lại cả khối, chỗ placeholder đó cũng sẽ bị thế chỗ bởi bức ảnh thật;
 * Khi thất bại thì finishMessage cũng sẽ y như vậy gọi lệnh render lại, placeholder bốc hơi, nguyên văn cái thẻ sẽ được khôi phục về chỗ cũ.
 *
 * @returns {boolean} Có tìm thấy chỗ đáp hay không (Với nhánh xuất ảnh từ ngữ cảnh thì thẻ không nằm sẵn trong chính văn, sẽ trả về false,
 *                    Bên gọi nên chuyển qua phương thức phản hồi khác)
 */
function showPlaceholder(messageId, markerRaw, label) {
    try {
        const root = document.querySelector(`.mes[mesid="${messageId}"] .mes_text`);
        if (!root) return false;
        const target = findLeafContaining(root, markerRaw);
        if (!target) return false;
        target.innerHTML = `<span class="v_canvas_placeholder">${escapeHtml(label.replace(/^（|）$/g, ''))}</span>`;
        return true;
    } catch (err) {
        warn('Chèn placeholder thất bại:', err);
        return false;
    }
}

// findLeafContaining Trong đoạn chính văn đã được render, tìm ra "Phần tử lớp trong cùng đang chứa cái thẻ này" (thường thì chính là cái thẻ <p> đó).
function findLeafContaining(root, needle) {
    if (!needle) return null;
    let fallback = null;
    for (const el of root.querySelectorAll('*')) {
        if (!el.textContent || !el.textContent.includes(needle)) continue;
        fallback = el;
        if (!el.querySelector('*')) return el; // Không có element con (child) = Là chính bản thân cái khối bọc ngoài đoạn chữ này
    }
    return fallback;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function truncateText(str, n) {
    const t = String(str ?? '');
    return t.length > n ? `${t.slice(0, n)}…` : t;
}

// -- Bơm (Inject) system prompt --

function currentRule() {
    return ruleTemplate(s().max_per_round);
}

// syncPromptInjection Nhồi cái rule ILLUST vào trong nội dung sắp sửa bắn lên cho model.
//
// Vị trí nhồi sẽ quyết định trực tiếp việc model có làm theo hay không:
//   in_chat (Mặc định) -- Dùng làm system message nội trong phần hội thoại và cắm ngay trước câu trả lời (Độ sâu / depth mặc định bằng 0).
//     Nó sẽ nằm cùng một chỗ với cái mục depth 0 của worldbook, đây chính là vị trí mà model tập trung sự chú ý mạnh nhất.
//     Nhiều Thẻ nhân vật hạng nặng sẽ nhét trọn một bộ template output vào depth 0, lúc này mấy cái rule ở tít trên cùng của system prompt sẽ bị ngó lơ,
//     Vì thế vị trí này mới được ưu tiên làm mặc định.
//   in_prompt -- Sát nhập thẳng vào Main System Prompt. Nằm ở vị trí đầu tiên, chỉ thích hợp khi người dùng đã tự tay xử lý hết các ràng buộc về format.
function syncPromptInjection() {
    try {
        const c = s();
        if (!(c.enabled && c.inject_prompt)) {
            setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
            return;
        }
        const text = currentRule();
        if (c.inject_position === 'in_prompt') {
            setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
            log('Rule ILLUST đã được sát nhập vào Main System Prompt');
        } else {
            setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_CHAT, c.inject_depth, false, extension_prompt_roles.SYSTEM);
            log(`Rule ILLUST đã được cắm vào đoạn hội thoại (depth ${c.inject_depth})`);
        }
    } catch (err) {
        warn('Bơm system prompt thất bại:', err);
    }
}

// -- Ngăn kéo Extension (Chỉ chừa lại: Tên + Phiên bản + Mở bảng quản lý) --
//
// Toàn bộ các cài đặt đã được dọn sang bảng quản lý (panel.html). Cấu trúc inline-drawer của SillyTavern vốn dĩ chỉ dành cho một lượng nhỏ các nút bật tắt,
// Nhét cỡ hai chục cái config vô đó sẽ làm bố cục dài thòng lòng và cực kỳ rối mắt.

function addSettingsUI() {
    const html = `
    <div id="v_canvas_drawer" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>V.Canvas <span class="v_canvas_version">v${VERSION}</span></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content v_canvas_content">
                <div class="v_canvas_row">
                    <button id="v_canvas_open_panel" class="menu_button">
                        <i class="fa-solid fa-sliders"></i><span>Mở bảng quản lý</span>
                    </button>
                </div>
            </div>
        </div>
    </div>`;

    $('#extensions_settings2').append(html);
    $('#v_canvas_open_panel').on('click', openPanel);
}

// -- Bảng quản lý: Overlay toàn màn hình + iframe + Cầu nối (bridge) --
//
// WARN: Bảng quản lý là một trang web độc lập, không thể thọc vào context của SillyTavern: Nó vừa không gọi được getContext(), cũng không thể import '/script.js'.
//       Bản thân iframe có một vũ trụ JS riêng, nếu cố chấp load script.js vào đó sẽ khiến SillyTavern bị khởi tạo lần 2
//       (Hai bộ chat, hai hệ thống event chạy đè lên nhau).
//
// Vậy nên mới xài cái mô hình cầu nối (bridge model) kiểu "Bảng điều khiển chỉ vung tay phát lệnh, Extension làm culi phụ trách thi hành":
//   Bảng điều khiển click -> window.parent.__V_CANVAS_API__(action, payload)
//   -> Extension chính nằm trong trang SillyTavern thi hành: Chỉnh sửa dữ liệu -> Render lại DOM -> Lưu đĩa
//   -> Trả về { ok, data } hoặc { ok: false, error }, bảng điều khiển sẽ nương theo đó mà hiển thị kết quả
//
// Bất kỳ action nào vắng mặt biên lai (không trả về) đều bị coi như vô hiệu lực, cấm ngặt trò thất bại trong câm lặng (silent failure).

const PANEL_ID = 'v_canvas_panel_overlay';
let panelKeyHandler = null;
let panelFitHandler = null;

// Chiều cao overlay được lấy gán chính xác theo visualViewport: Trên mobile khi người dùng ẩn/hiện thanh địa chỉ, hay lật máy ngang/dọc đều sẽ làm thay đổi chiều cao thực.
function fitPanelHeight(el) {
    const h = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight || 0);
    if (h > 0) el.style.height = h + 'px';
}

function bindPanelFit(el) {
    panelFitHandler = () => fitPanelHeight(el);
    fitPanelHeight(el);
    window.addEventListener('resize', panelFitHandler);
    window.addEventListener('orientationchange', panelFitHandler);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', panelFitHandler);
}

function unbindPanelFit() {
    if (!panelFitHandler) return;
    window.removeEventListener('resize', panelFitHandler);
    window.removeEventListener('orientationchange', panelFitHandler);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', panelFitHandler);
    panelFitHandler = null;
}

function panelUrl() {
    return new URL('./panel.html', import.meta.url).href + '?v=' + encodeURIComponent(VERSION);
}

function openPanel() {
    closePanel();

    const overlay = $(`
        <div id="${PANEL_ID}">
            <div class="v_canvas_panel_chrome">
                <span class="v_canvas_panel_title">Bảng điều khiển quản lý V.Canvas</span>
                <div class="v_canvas_panel_actions">
                    <button class="menu_button" id="v_canvas_panel_newtab">Tab mới</button>
                    <button class="menu_button" id="v_canvas_panel_close">Đóng</button>
                </div>
            </div>
            <iframe id="v_canvas_panel_iframe" title="Bảng điều khiển quản lý V.Canvas"></iframe>
            <div id="v_canvas_panel_fallback">
                <div class="v_canvas_panel_fallback_card">
                    <b>Bảng điều khiển không thể hiển thị nhúng</b>
                    <p>Môi trường duyệt web hiện tại có thể cấm trang nhúng (Một số trình duyệt mobile và WebView trong app sẽ hạn chế iframe).
                       Chuyển sang dùng tab mới để mở bảng điều khiển, chức năng hoàn toàn giống với kiểu nhúng.</p>
                    <button class="menu_button" id="v_canvas_panel_fallback_open">Mở bảng điều khiển trong tab mới</button>
                </div>
            </div>
        </div>`);
    $('body').append(overlay);
    bindPanelFit(overlay[0]);

    installBridge();                 // Nối cầu cho tử tế rồi mới gắn bảng điều khiển vào, tránh việc nó giật slot tự check rống lên "Chưa kết nối"
    const frame = overlay.find('#v_canvas_panel_iframe')[0];

    // Nút tab mới: Cái page bảng điều khiển sẽ tự đổi hướng sang móc hàm cầu nối thông qua window.opener, cho nên vẫn chạy phà phà.
    const openInNewTab = () => {
        const w = window.open(panelUrl(), '_blank');
        if (!w) overlay.find('#v_canvas_panel_fallback').addClass('show');
    };

    let loaded = false;
    frame.addEventListener('load', () => {
        // Lúc chưa gán src nó cũng ráng trigger một lần load (about:blank), lấy body xem có rỗng không để nhận diện.
        try {
            const doc = frame.contentDocument;
            if (doc && doc.body && doc.body.childElementCount > 0) loaded = true;
        } catch {
            loaded = true; // Bị dính lỗi cross-domain không lấy được nội dung thì cũng coi như là đã load
        }
    });
    frame.src = panelUrl();

    overlay.find('#v_canvas_panel_close').on('click', closePanel);
    overlay.find('#v_canvas_panel_newtab').on('click', openInNewTab);
    overlay.find('#v_canvas_panel_fallback_open').on('click', openInNewTab);

    panelKeyHandler = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', panelKeyHandler);

    setTimeout(() => {
        if (!loaded && document.body.contains(frame)) {
            overlay.find('#v_canvas_panel_fallback').addClass('show');
        }
    }, 8000);
}

function closePanel() {
    $(`#${PANEL_ID}`).remove();
    unbindPanelFit();
    if (panelKeyHandler) {
        document.removeEventListener('keydown', panelKeyHandler);
        panelKeyHandler = null;
    }
    try { delete window.__V_CANVAS_API__; } catch { /* Bỏ qua */ }
}

// -- Cầu nối (Bridge) --

function maskKey(k) {
    const t = String(k ?? '');
    if (!t) return '';
    const r = [...t];
    return r.length <= 4 ? r[0] + '***' : r.slice(0, 3).join('') + '***' + r.slice(-2).join('');
}

// upstreamKind Mô tả loại tuyến trên hiển thị trong trang Tổng quan (Overview).
function upstreamKind(base, model) {
    const b = String(base ?? '');
    if (!b) return 'Chưa cấu hình';
    if (model) return String(model);
    if (/127\.0\.0\.1|localhost|:8888/.test(b)) return 'V.Adapter';
    return 'Dịch vụ NAI';
}

// collectImages Gom lượm các bức ảnh đã được sinh từ tin nhắn trong khung chat hiện tại (Cho các thumbnail bên trang Tổng quan).
// Lấy thẳng từ chat (Không qua cache), bảng điều khiển phải luôn luôn vạch ra trạng thái đời thực hiện tại.
function collectImages() {
    const ctx = getContext();
    const out = [];
    for (let i = 0; i < (ctx.chat?.length ?? 0); i++) {
        const st = ctx.chat[i]?.extra?.illust;
        if (!st || !Array.isArray(st.urls) || !st.urls.length) continue;
        const prompts = findMarkers(String(st.src ?? '')).map(m => m.prompt);
        st.urls.forEach((url, index) => {
            if (url) out.push({ messageId: i, index, url, prompt: prompts[index] ?? '' });
        });
    }
    return out;
}

function installBridge() {
    window.__V_CANVAS_API__ = async (action, payload) => {
        try {
            switch (action) {
                case 'state': {
                    const c = s();
                    return {
                        ok: true,
                        data: {
                            enabled: !!c.enabled,
                            version: VERSION,
                            upstreamKind: upstreamKind(c.base_url, c.model),
                            apiKeyMasked: maskKey(c.api_key) || '(Chưa thiết lập)',
                            settings: { ...c },
                            images: collectImages(),
                            chatMessages: getContext().chat?.length ?? 0,
                        },
                    };
                }

                case 'settings.get':
                    return { ok: true, data: { settings: { ...s() } } };

                case 'settings.patch': {
                    const before = { ...s() };
                    const notes = applyPatch(payload && typeof payload === 'object' ? payload : {});
                    const after = { ...s() };
                    const changed = Object.keys(after)
                        .filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
                    syncPromptInjection();          // Công tắc tổng / Công tắc inject có khả năng bị đổi chung với nhau
                    return { ok: true, data: { changed, notes, settings: after } };
                }

                case 'settings.reset': {
                    applyPatch(defaultSettings());
                    syncPromptInjection();
                    return { ok: true, data: { settings: { ...s() } } };
                }

                case 'rule':
                    return { ok: true, data: { rule: currentRule() } };

                // Lịch sử sinh ảnh: Cái list được lưu (persist) độc lập với cuộc trò chuyện hiện tại.
                // Không sát nhập chung với state -- Cứ 8s là trang Tổng quan nhảy polling 1 lần, vác theo cái cục nợ này là bắt nó nhả nguyên file lịch sử chà bá lửa.
                case 'history.list':
                    return { ok: true, data: { history: [...(s().history ?? [])].reverse() } };

                case 'history.clear': {
                    clearHistory();
                    return { ok: true, data: { count: 0 } };
                }

                case 'test': {
                    const c = s();
                    const message = await testConnection({ baseUrl: c.base_url, apiKey: c.api_key });
                    return { ok: true, data: { message } };
                }

                // Xuất ảnh từ bản dịch: Bắt dịch vụ adapter mở rộng đoạn mô tả ngắn thành prompt hoàn chỉnh trước rồi mới sinh hình.
                // Hoàn toàn tách biệt với dây chuyền tự động sinh ảnh -- Không đụng vào lịch sử chat, chỉ nhả lại link cho bảng điều khiển coi.
                case 'translate.generate': {
                    const text = String(payload?.text ?? '').trim();
                    if (!text) return { ok: false, error: 'Vui lòng nhập mô tả' };

                    const c = s();
                    if (!c.base_url && !isLocalUpstream(c.base_url)) {
                        return { ok: false, error: 'Chưa cấu hình địa chỉ dịch vụ NAI: Nếu có cài V.Adapter sẽ tự động kết nối; Nếu không vui lòng điền một địa chỉ dịch vụ giao thức NovelAI' };
                    }

                    // "Size tự động" đòi hỏi khả năng mở rộng của tuyến trên (Tham số expand=1 của V.Adapter).
                    // Khi địa chỉ không phải local thì tính năng mở rộng bị đóng băng, lúc này sẽ fallback xài luôn thông số size ở trang Cài đặt, để tránh báo size bằng 0.
                    const followRecommended = payload?.sizeMode !== 'fixed' && isLocalUpstream(c.base_url);

                    const gen = await generateIllustration({
                        baseUrl: c.base_url,
                        apiKey: c.api_key,
                        model: c.model,
                        prompt: buildUpstreamPrompt(text, c.jb_image),
                        negative: c.negative,
                        width: followRecommended ? 0 : c.width,
                        height: followRecommended ? 0 : c.height,
                        steps: c.steps,
                        scale: c.scale,
                        timeoutMs: c.timeout_sec * 1000,
                        expand: true,
                    });

                    const ctx = getContext();
                    // url tồn tại = Kết quả fallback link từ xa của tuyến trên (Không có byte local), dẫn link trực tiếp, không ghi đĩa
                    const url = gen.url ?? await saveBase64AsFile(gen.base64, ctx.name2 || '', `translate_${Date.now()}`, gen.extension);
                    log(`Xuất ảnh từ bản dịch hoàn tất -> ${url} (${followRecommended ? 'Chạy theo size tự động' : 'Size ở trang Cài đặt'})`);
                    return { ok: true, data: { url, prompt: gen.prompt || text } };
                }

                // Xuất ảnh từ ngữ cảnh: Test kết nối đến model phân tích
                case 'ctx.test': {
                    const c = s();
                    const message = await testAnalyzeModel({
                        baseUrl: c.ctx_url, apiKey: c.ctx_key, model: c.ctx_model,
                    });
                    return { ok: true, data: { message } };
                }

                // Xuất ảnh từ ngữ cảnh: Tức thì phân tích câu trả lời cuối cùng của nhân vật và vẽ luôn (Phục vụ cho việc test link hoạt động, không cần chờ đến lượt chat sau)
                case 'ctx.generate': {
                    const c = s();
                    if (!c.ctx_url || !c.ctx_model) {
                        return { ok: false, error: 'Vui lòng điền địa chỉ API và tên model phân tích trước' };
                    }
                    if (!c.base_url && !isLocalUpstream(c.base_url)) {
                        return { ok: false, error: 'Chưa cấu hình địa chỉ dịch vụ NAI: Nếu có cài V.Adapter sẽ tự động kết nối; Nếu không vui lòng điền một địa chỉ dịch vụ giao thức NovelAI' };
                    }
                    const ctx = getContext();
                    const chat = ctx.chat ?? [];
                    let id = -1;
                    for (let i = chat.length - 1; i >= 0; i--) {
                        const m = chat[i];
                        if (m && !m.is_user && !m.is_system && String(m.mes ?? '').trim()) { id = i; break; }
                    }
                    if (id < 0) return { ok: false, error: 'Trong chat hiện tại không có câu trả lời nào của nhân vật để vẽ minh họa' };

                    const msg = chat[id];
                    const maxImages = Math.min(6, Math.max(1, c.max_per_round | 0));
                    const signal = beginRun();
                    showProgress(`Đang phân tích chính văn... (Khoảng 10~30 giây, tối đa ${maxImages} tấm)`);
                    let items;
                    try {
                        items = await analyzeContext({
                            baseUrl: c.ctx_url,
                            apiKey: c.ctx_key,
                            model: c.ctx_model,
                            reply: stripMarkers(String(msg.mes ?? '')),
                            context: collectContext(chat, id),
                            work: workLabel(ctx),
                            style: c.ctx_style,
                            quality: c.ctx_quality,
                            negative: c.ctx_negative,
                            jb: c.jb_llm,
                            max: maxImages,
                            timeoutMs: c.ctx_timeout_sec * 1000,
                            signal,
                        });
                    } catch (err) {
                        endRun();
                        const em = truncateText(err?.message ?? String(err), 300);
                        finishProgress(`Phân tích thất bại: ${em}`, true);
                        return { ok: false, error: em };
                    }
                    if (!items.length) {
                        endRun();
                        finishProgress('Kết quả phân tích rỗng: Câu trả lời này không tìm thấy khung hình nào đáng vẽ', false);
                        return { ok: false, error: 'Model phân tích cho rằng câu trả lời này không có khung hình nào đáng vẽ' };
                    }

                    // Khi phân tích lại thì phải tẩy uế các trạng thái cũ đi trước, tránh bị đè đống lên hình cũ
                    if (msg.extra?.illust) { delete msg.extra.illust; delete msg.extra.illust_done; }
                    try {
                        await runIllustration(ctx, id, msg, items, signal);
                    } finally {
                        endRun();
                    }
                    const urls = (msg.extra?.illust?.urls ?? []).filter(Boolean);
                    if (!urls.length) return { ok: false, error: 'Phân tích xong rồi, nhưng lại sinh ảnh thất bại (Xem chi tiết ở tab Lịch sử hoặc Console của trình duyệt)' };
                    return { ok: true, data: { messageId: id, count: urls.length, prompts: items.map(it => it.desc || it.tags) } };
                }

                default:
                    return { ok: false, error: `Lệnh lạ lẫm: ${action}` };
            }
        } catch (err) {
            const msg = truncateText(err?.message ?? String(err), 300);
            warn(`Bridge action ${action} sụp đổ:`, msg);
            return { ok: false, error: msg };
        }
    };
}

// -- Tự khởi động --
// Extension loader của SillyTavern chỉ lo mỗi việc mount <script type="module">, không thèm ngó ngàng gọi init(),
// Do đó đợi load xong file là phải tự mình kick-start (Giống y xì đúc với thói quen của official extensions và V.Adapter).
init().catch(err => console.error('[V.Canvas] Khởi tạo thất bại:', err));