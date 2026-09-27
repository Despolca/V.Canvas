// index.js - V.Canvas · Cổng vào extension frontend SillyTavern.
//
// Trách nhiệm: Khi trong câu trả lời của AI xuất hiện đánh dấu [ILLUST: Mô tả hình ảnh | Danbooru,Tags] (dưới đây gọi là tag),
//       sẽ thay thế tag đó tại chỗ thành một dòng hình minh họa trọn vẹn, chèn ngay dưới đoạn văn chứa nó, tạo thành bố cục chữ - hình xếp dọc.
//
// Giao thức xuất ảnh: Chỉ implement giao thức NovelAI (POST /ai/generate-image), trỏ đến service giao thức NAI bên ngoài
// (V.Adapter, mặc định http://127.0.0.1:8888).
// Xử lý phản hồi: Luồng nhị phân hình ảnh được dùng trực tiếp; ZIP đi qua nhánh giải nén tương thích.
//
// WARN: Trình tải extension của SillyTavern chỉ mount <script type="module">, sẽ không gọi init() do extension export,
//       do đó cuối file này phải tự gọi khởi động.

import { eventSource, event_types, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { saveBase64AsFile } from '/scripts/utils.js';

import {
    initSettings, settingsGet, applyPatch, isTypeExcluded, defaultSettings, recordHistory, clearHistory,
    saveArtistPresets,
} from './lib/settings.js';
import { findMarkers, hasMarkers, stripMarkers, buildDisplayText, effectiveSource, resolvePromptMode, selectPrompt, isLocalUpstream, redistributeMarkers } from './lib/marker.js';
import { generateIllustration, testConnection } from './lib/nai-api.js';
import {
    applyMarkers, resolveCtxSource, applyProseMarker, applyProseMarkers, buildDirectProse, directAppliesTo,
    pickProseAnchor, splitProseChunks,
} from './lib/analysis.js';
import { artistAppliesTo, artistPromptFor, withArtistPrompt } from './lib/artist.js';
import { analyzeContext, testAnalyzeModel } from './lib/llm-api.js';
import { analyzeViaMainApi, describeMainApi } from './lib/st-llm.js';
import { detectNsfw } from './lib/nsfw.js';
import { showProgress, updateProgress, finishProgress, hideProgress, setCancelHandler } from './lib/progress.js';

export const MODULE_NAME = 'v_canvas';
const VERSION = '0.1.4';

// Key dùng để tiêm system prompt (Ghi đè cùng một key sẽ chép đè, không bị cộng dồn).
const PROMPT_KEY = 'v_canvas_rule';

// Template của quy tắc tag mặc định: Giới hạn xuất ảnh được thay thế theo "Giới hạn mỗi lượt".
//
// Văn bản quy tắc chính là toàn bộ căn cứ để model sinh ra đánh dấu, do đó phải viết rõ từng mục: Định dạng, các yếu tố đoạn mô tả cần bao phủ,
// hình thức và thứ tự sắp xếp của đoạn tag, tính tự túc của một đánh dấu đơn lẻ, yêu cầu phân bố của nhiều đánh dấu.
function ruleTemplate(n) {
    return `Nếu cốt truyện xuất hiện sự chuyển cảnh rõ rệt, ngoại hình nhân vật thay đổi hoặc các khung hình căng thẳng cao độ, vui lòng xuống dòng và xuất ra đánh dấu ngay dưới đoạn văn tương ứng:\n`
        + `[ILLUST: Mô tả bằng ngôn ngữ tự nhiên | Danbooru,Tags]\n`
        + `Đánh dấu phải tuân thủ các yêu cầu sau:\n`
        + `1. Cả hai đoạn đều phải điền, ngăn cách bằng dấu |, không được bỏ sót bất kỳ đoạn nào.\n`
        + `2. Đoạn mô tả dùng ngôn ngữ tự nhiên để viết, phải bao quát các đặc điểm ngoại hình nhân vật, trang phục và đạo cụ, tư thế hành động, môi trường cảnh vật, bố cục và góc máy, phong cách vẽ.\n`
        + `3. Đoạn tag sử dụng thẻ Danbooru tiếng Anh, ngăn cách bằng dấu phẩy tiếng Anh, sắp xếp theo thứ tự "Chủ thể, ngoại hình, trang phục, hành động, cảnh vật, phong cách".\n`
        + `4. Hành động và các bộ phận cơ thể phải viết cụ thể: Biến các hành động thực tế xảy ra trong khung hình, các bộ phận cơ thể liên quan và mối quan hệ tiếp xúc, lần lượt chuyển thành các thẻ Danbooru chính xác (như kissing, hugging, groping, handjob, fellatio, cunnilingus, spread legs, breasts, nipples v.v.), tương ứng 1-1 với nội dung thực tế xảy ra trong cốt truyện lúc đó; Không được dùng nsfw, nude, sex - những từ chung chung chỉ phân loại nội dung để thay thế cho khung hình cụ thể, từ chung chung tối đa chỉ được dùng làm giải thích bổ sung.\n`
        + `5. Một đánh dấu đơn lẻ phải tự cung tự cấp: Cần chứa đầy đủ đặc điểm của nhân vật chính và thông tin cảnh vật của khung hình đó, không phụ thuộc vào các đánh dấu khác để bổ sung.\n`
        + `6. Khi xuất ra nhiều đánh dấu trong một lượt, các đánh dấu phải hướng đến các khoảnh khắc hình ảnh khác nhau, và phân bố ở các vị trí khác nhau trong thân bài (ví dụ đoạn giữa và đoạn cuối), không được tập trung tại một chỗ, cũng không được lặp lại mô tả cùng một khung hình.\n`
        + `7. Việc lên ý tưởng hình ảnh và thân bài cốt truyện được hoàn thành cùng lúc trong một lần sinh, không cần chờ bước bổ sung nào khác.\n`
        + `8. Đánh dấu viết ngay dưới đoạn văn tự sự của thân bài, không viết bên trong các khối cấu trúc như thanh trạng thái, khối suy nghĩ, bảng biểu; Nếu thân bài được bọc trong một thẻ nào đó (như <story_scene>), đánh dấu phải được viết bên dưới đoạn văn tương ứng bên trong thẻ đó.\n`
        + `Một lần trả lời xuất tối đa ${n} đánh dấu, mỗi đánh dấu tương ứng với một hình minh họa, lần lượt chèn ngay dưới đoạn văn của nó.`;
}

// -- Trạng thái lúc chạy --

const inFlight = new Set();   // Các messageId đang được xử lý (Chống rung/debounce)
const lastPass = new Map();   // messageId -> Timestamp của lần xử lý trước (Chống bão click liên tục)
const PASS_COOLDOWN = 4000;

// -- Kiểm soát hủy của lượt hiện tại --
// Cả request phân tích và request xuất ảnh đều gắn vào signal này, nút "Dừng" chỉ cần abort nó là có thể ngắt toàn bộ lượt.
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

// buildUpstreamPrompt Ghép từ phá giới hạn xuất ảnh (nếu có điền) vào đầu prompt xuất ảnh.
// Trống thì trả về nguyên trạng. Dấu ghép là ", ", vô hại đối với cả chuỗi thẻ Danbooru và ngôn ngữ tự nhiên.
// Plugin này không tích hợp sẵn bất kỳ nội dung phá giới hạn nào, nội dung trong ô do người dùng tự điền và tự chịu trách nhiệm.
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

// -- Backend xuất ảnh đã sẵn sàng chưa --
//
// Khi địa chỉ trống sẽ nhờ V.Adapter trên cùng trang làm cầu nối xuất ảnh; Cầu chưa nối thì coi như không có backend.
// Khi không có backend thì bỏ qua toàn bộ lượt: Prompt phân tích ra không có chỗ để vẽ, vừa tốn một lần gọi model vừa báo lỗi ngập màn hình mỗi lượt.
// Chỉ nhắc nhở một lần, tránh việc mỗi lượt trả lời đều spam cùng một câu trên console.
let warnedNoBackend = false;

function hasImageBackend(cfg) {
    if (cfg.base_url || isLocalUpstream(cfg.base_url)) {
        warnedNoBackend = false;   // Backend đã nối thì reset nhắc nhở, lần sau đứt còn có thể nhắc tiếp
        return true;
    }
    if (!warnedNoBackend) {
        warnedNoBackend = true;
        warn('Chưa kết nối backend xuất ảnh: Địa chỉ trống và không phát hiện bridge V.Adapter trên cùng trang, từ lượt này sẽ bỏ qua xuất ảnh.'
            + ' Cài đặt V.Adapter, hoặc điền một địa chỉ service giao thức NovelAI trong trang "Cài đặt", hệ thống sẽ tự động khôi phục.');
    }
    return false;
}

// -- Nguồn của model phân tích --
//
// ctx_source = 'main' (Mặc định): Dùng trực tiếp model mà SillyTavern đang dùng hiện tại, người dùng không cần điền gì cả.
//                             Implement xem lib/st-llm.js.
// ctx_source = 'custom': Dùng service tương thích OpenAI do người dùng tự điền. Implement xem lib/llm-api.js.
//
// Quy tắc chọn được tập trung ở đây, tham số đầu vào của hai luồng giữ nguyên, đổi nguồn không ảnh hưởng đến bất kỳ khâu nào khác.

/** ctxAnalyzer Chọn nguồn sẽ dùng lần này; 'custom' nhưng cấu hình thiếu thì trả về null. Logic phán đoán ở analysis.js, có thể Unit Test offline. */
function ctxAnalyzer(cfg) {
    return resolveCtxSource(cfg.ctx_source, { url: cfg.ctx_url, model: cfg.ctx_model });
}

/** ctxModeLabel Tên "Lần này đi theo luồng bù ảnh nào" hiển thị trong log và thông báo. */
function ctxModeLabel(mode) {
    return mode === 'direct' ? 'Xuất trực tiếp' : 'Xuất ảnh theo context';
}

/** analyzerLabel Tên "Lần này dùng model nào" hiển thị trên bảng điều khiển và log. */
function analyzerLabel(cfg, kind) {
    if (kind === 'main') return describeMainApi().label;
    return cfg.ctx_model ? `Model tùy chỉnh · ${cfg.ctx_model}` : 'Model tùy chỉnh';
}

/** runCtxAnalyzer Khởi chạy phân tích theo nguồn đã chọn. */
async function runCtxAnalyzer(kind, cfg, opts) {
    const shared = {
        reply: opts.reply,
        context: opts.context,
        work: opts.work,
        style: cfg.ctx_style,
        quality: cfg.ctx_quality,
        negative: cfg.ctx_negative,
        jb: cfg.jb_llm,
        nsfw: opts.nsfw,
        max: opts.max,
        timeoutMs: cfg.ctx_timeout_sec * 1000,
        signal: opts.signal,
    };
    if (kind === 'main') return analyzeViaMainApi(shared);
    return analyzeContext({ ...shared, baseUrl: cfg.ctx_url, apiKey: cfg.ctx_key, model: cfg.ctx_model });
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

    // Chuyển chat / Render lại: Ghi lại các hình minh họa đã xuất ảnh vào DOM. display_text đã được lưu trữ cùng lịch sử trò chuyện,
    // Ở đây chỉ để đề phòng một vài tình huống ST xóa mất display_text.
    const rehydrate = () => { rehydrateAll().catch(err => warn('Tái tạo hiển thị hình minh họa thất bại:', err)); };
    eventSource.on(event_types.CHAT_CHANGED, rehydrate);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, rehydrate);
    eventSource.on(event_types.MESSAGE_EDITED, rehydrate);
    eventSource.on(event_types.MESSAGE_UPDATED, rehydrate);

    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
        // Xử lý có độ trễ: Nếu lần swipe này kích hoạt tạo lại tin nhắn, thì giao cho luồng streaming xử lý, ở đây bỏ qua.
        setTimeout(() => { onSwipeSettled(mesId).catch(err => warn('Xử lý swipe thất bại:', err)); }, 700);
    });

    // WARN: Khi SillyTavern render, độ ưu tiên của extra.display_text cao hơn mes.
    //       Trong quá trình viết tiếp / tạo lại, mes liên tục thay đổi trong khi display_text vẫn là giá trị cũ, nếu không gỡ bỏ sẽ khiến nội dung streaming không thể nhìn thấy.
    //       Do đó khi hai loại tạo văn bản này bắt đầu, trước tiên hãy gỡ display_text trên tin nhắn cuối cùng.
    //       Lưu ý bắt buộc phải loại trừ type === 'normal': Đó là "Gửi tin nhắn mới", display_text của tin nhắn trước đó
    //       vẫn còn hiệu lực, lúc này nếu xóa đi sẽ làm cho hình minh họa đã vẽ xong biến mất hoàn toàn (Hình vẫn còn, chỉ là không hiển thị).
    eventSource.on(event_types.GENERATION_STARTED, (type) => {
        if (type === 'normal') return;
        try {
            const ctx = getContext();
            const last = (ctx.chat?.length ?? 0) - 1;
            const msg = ctx.chat?.[last];
            if (last >= 0 && msg?.extra?.illust && msg.extra.display_text) {
                delete msg.extra.display_text;
                ctx.updateMessageBlock(last, { ...msg });
                log(`#${last} Quá trình tạo ${type} bắt đầu, gỡ bỏ display_text cũ trước`);
            }
        } catch (err) {
            warn('Dọn dẹp display_text cũ thất bại:', err);
        }
    });
}

// -- Đã nhận tin nhắn --

async function onMessageReceived(messageId, type) {
    if (!s().enabled) return;
    if (type === 'extension') return;                        // Tin nhắn do extension khác chèn vào, không quan tâm
    if (isTypeExcluded(type)) { log(`Bỏ qua loại bị loại trừ ${type}`); return; }
    if (type === 'swipe' && !s().swipe_regenerate) { log('Tính năng tạo ảnh lại khi swipe đã tắt, bỏ qua'); return; }

    const ctx = getContext();
    const msg = ctx.chat?.[messageId];
    if (!msg || msg.is_user || msg.is_system) return;

    if (!hasImageBackend(s())) return;

    // Hai luồng cùng tồn tại, không trùng lặp:
    //   1. Được thúc đẩy bởi Marker - Khi trong thân bài đã có sẵn [ILLUST: ...] thì do processMessage xử lý (Không tốn thời gian chờ thêm)
    //   2. Được thúc đẩy bởi Context - Khi thân bài không có marker, và tính năng xuất ảnh theo context được bật, thì giao cho model độc lập đọc thân bài rồi bù vào
    await processMessage(messageId, type, msg);
    await processContextIllustration(messageId, msg);
}

// -- Xuất ảnh theo context (Model độc lập đọc thân bài -> Sinh ra prompt -> Giao cho 8888 / NAI xuất ảnh) --
//
// Lý do tồn tại: Luồng marker yêu cầu model cốt truyện chủ động phối hợp, gặp thẻ nhân vật có template xuất quá mạnh (nhiều thẻ sandbox) sẽ mất tác dụng.
// Luồng này giao việc "Quyết định vẽ gì" cho một model tương thích OpenAI được cấu hình độc lập, do đó không phụ thuộc vào sự phối hợp của bất kỳ thẻ nhân vật nào.
//
// Prompt sinh ra bao gồm cả mô tả ngôn ngữ tự nhiên và thẻ Danbooru, cuối cùng prompt_format sẽ quyết định gửi nửa nào,
// do đó có thể dùng được cho cả luồng đi qua V.Adapter (Tuyến trên định dạng OpenAI) và luồng kết nối trực tiếp NovelAI / Gateway NAI.

const ctxInFlight = new Set();

// collectContext Lấy một số tin nhắn trước tin nhắn này làm phần trước, cung cấp cho model phân tích để hiểu nhân vật và bối cảnh.
// Mặc định lấy 8 tin nhắn, mỗi tin nhắn 800 chữ: Việc xác định tác phẩm và thế giới quan cần đủ lượng danh từ riêng và thông tin nhân vật,
// nếu mớm quá ít sẽ khiến model phân tích viết ra những prompt chung chung, đứt gãy với thế giới quan.
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

// workLabel Cung cấp thông tin thẻ nhân vật cho model phân tích để xác định tác phẩm và phong cách.
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
    if (msg.extra?.illust) return;                    // Đã được ghép ảnh bởi luồng marker
    if (ctxInFlight.has(messageId)) return;

    const mes = String(msg.mes ?? '');
    if (hasMarkers(mes)) return;                      // Thân bài có sẵn marker, đi theo luồng marker
    if (!mes.trim()) return;

    const tag = `#${messageId}(${ctxModeLabel(cfg.ctx_mode)})`;
    ctxInFlight.add(messageId);
    const ctx = getContext();
    const signal = beginRun();
    try {
        if (cfg.ctx_mode === 'direct') {
            await runDirectPass(ctx, messageId, msg, cfg, signal, tag);
        } else {
            await runAnalyzePass(ctx, messageId, msg, cfg, signal, tag);
        }
    } catch (err) {
        if (isAborted(signal)) { finishProgress('Đã dừng', false); return; }
        const m = truncateText(err?.message ?? String(err), 300);
        warn(`${tag} Thất bại: `, m);
        finishProgress(`${ctxModeLabel(cfg.ctx_mode)} thất bại: ${m}`, true);
        toastr.error(`${ctxModeLabel(cfg.ctx_mode)} thất bại: ${m}`, 'V.Canvas', { timeOut: 12000 });
    } finally {
        ctxInFlight.delete(messageId);
        endRun();
    }
}

// runAnalyzePass Luồng A: Model phân tích đọc thân bài -> Viết prompt xuất ảnh -> Gửi tuyến trên (Văn -> Văn -> Ảnh).
async function runAnalyzePass(ctx, messageId, msg, cfg, signal, tag) {
    const kind = ctxAnalyzer(cfg);
    if (!kind) {
        warn('Đã bật xuất ảnh theo context, nhưng chọn model phân tích tùy chỉnh mà địa chỉ hoặc tên model chưa điền, lần này bỏ qua');
        finishProgress('Đã chọn model phân tích tùy chỉnh, nhưng chưa điền địa chỉ hoặc tên model - Muốn rảnh tay thì cứ chuyển về "Đi theo API chính của SillyTavern"', true);
        return;
    }

    const mes = String(msg.mes ?? '');
    // Số lượng ảnh thống nhất theo "Giới hạn mỗi lượt" (Cùng một cài đặt với luồng marker),
    // Tránh việc hai bộ giới hạn đá nhau: Sửa trong trang cài đặt nhưng không có tác dụng với xuất ảnh theo context.
    const maxImages = Math.min(6, Math.max(1, cfg.max_per_round | 0));
    // Đánh giá NSFW: Khi thân bài hit điều kiện phân luồng, đợt khung hình này bắt buộc đi qua kênh phân luồng (NAI xịn).
    // Chế độ phân tích trước đây không có luật đánh giá này - Model phân tích viết ra toàn là thẻ cụ thể (kissing/handjob v.v.),
    // Không nằm trong danh sách từ phân loại tích hợp sẵn, drawMarkers dùng thẻ để đánh giá lại thì vĩnh viễn không hit -> Gửi vào kênh chính qwen -> Không tạo được.
    // Giờ đây đã đồng bộ với chế độ xuất trực tiếp: Từ khóa chỉ quyết định "Có phân luồng hay không", chọn khoảnh khắc nào do model phân tích phán đoán theo ngữ nghĩa.
    const nsfwEnabled = cfg.nsfw_enabled && !!cfg.nsfw_base_url;
    const bodyNsfw = nsfwEnabled && detectNsfw(mes, cfg.nsfw_words);
    const nsfwN = bodyNsfw ? Math.min(6, Math.max(1, cfg.nsfw_max | 0)) : maxImages;
    if (bodyNsfw) log(`${tag} Thân bài hit phân luồng NSFW, xuất ${nsfwN} ảnh theo kênh phân luồng`);
    showProgress(`Đang phân tích thân bài... (Khoảng 10~30 giây, tối đa ${nsfwN} ảnh)`);
    log(`${tag} Gửi model phân tích (${analyzerLabel(cfg, kind)}), thân bài ${[...mes].length} chữ`);
    const items = await runCtxAnalyzer(kind, cfg, {
        reply: mes,
        context: collectContext(ctx.chat, messageId),
        work: workLabel(ctx),
        max: nsfwN,
        nsfw: bodyNsfw,
        nsfwMix: cfg.nsfw_mix,
        nsfwDailyPlace: cfg.nsfw_daily_place,
        signal,
    });
    if (isAborted(signal)) { finishProgress('Đã dừng', false); return; }
    if (!items.length) {
        log(`${tag} Model phân tích cho rằng văn bản này không có khung hình nào đáng để vẽ`);
        finishProgress('Kết quả phân tích trống: Không tìm thấy khung hình nào đáng để vẽ trong câu trả lời này', false);
        return;
    }
    log(`${tag} Phân tích được ${items.length} khung hình`);
    await runIllustration(ctx, messageId, msg, items, signal, { forceDivert: bodyNsfw });
}

// runDirectPass Luồng B: Xuất trực tiếp thân bài - Không gọi model phân tích, giao nguyên xi thân bài AI cho model xuất ảnh.
//
// Đây là "Văn sinh ảnh thực thụ": Bớt đi một lần sửa văn bản bằng model chữ trên chuỗi, bản thân thân bài chính là prompt.
// Chỉ gửi đi câu trả lời AI vừa được tạo, không chứa bất kỳ bối cảnh lịch sử nào -
// Trong SillyTavern là cuộc đối thoại qua lại giữa người và AI, nhét toàn bộ đoạn đối thoại vào vừa tốn token, vừa làm model không phân biệt được nên vẽ cảnh nào.
// directBlockedReason Lời giải thích cho người dùng khi xuất trực tiếp bị chặn bởi rào cản hình thái.
//
// Bắt buộc phải giải thích rõ "Tại sao lại bị phán đoán thành chuỗi thẻ": Đa số người dùng đụng phải rào cản này **không phải** là kết nối trực tiếp NAI chính thức,
// mà là điền địa chỉ của service chuyển đổi deploy từ xa - Mức auto chỉ có thể đoán qua địa chỉ, địa chỉ từ xa nhất luật bị coi là thẻ,
// thế là bị chặn nhầm. Cách giải quyết trong trường hợp đó là đổi "Hình thái prompt", chứ không phải là câu "Chuyển về chế độ phân tích" như bản gốc trước đây.
function directBlockedReason(cfg) {
    if (cfg.prompt_format === 'tags') return '"Hình thái prompt" đã được chọn thủ công là tags';
    if (cfg.upstream_type === 'nai') return '"Loại tuyến trên" đã được chọn thủ công là nai';
    return 'Cả "Hình thái prompt" và "Loại tuyến trên" đều là auto, nhưng địa chỉ xuất ảnh không phải máy local'
        + ' (Mức auto chỉ có thể đoán theo địa chỉ: 127.0.0.1 / localhost / Có chứa :8888 sẽ được coi là service chuyển đổi, còn lại nhất luật coi là NAI)';
}

async function runDirectPass(ctx, messageId, msg, cfg, signal, tag) {
    const gate = resolvePromptMode(cfg.prompt_format, cfg.base_url, cfg.upstream_type);
    if (!directAppliesTo(gate)) {
        const why = 'Xuất trực tiếp thân bài cần gửi thân bài ngôn ngữ tự nhiên, nhưng hiện tại lại bị phán đoán là "Chuỗi thẻ" (' + directBlockedReason(cfg) + '). '
            + 'Nếu địa chỉ của bạn thực chất đang trỏ đến service chuyển đổi (Ăn ngôn ngữ tự nhiên), chỉ cần vào trang "Cài đặt" chọn "Loại tuyến trên" là adapter '
            + '(Hoặc đổi "Hình thái prompt" thành description) là được; '
            + 'Chỉ khi thực sự kết nối trực tiếp NAI chính thức thì mới cần chuyển về chế độ "Model phân tích"';
        warn(`${tag} ${why}`);
        finishProgress(why, true);
        return;
    }

    const body = stripMarkers(String(msg.mes ?? ''));
    const nsfwEnabled = cfg.nsfw_enabled && !!cfg.nsfw_base_url;
    // Đánh giá xuất trực tiếp sử dụng nguyên văn thân bài (Sau stripMarkers), hit thì chuyển phân luồng.
    const needDivert = nsfwEnabled && detectNsfw(body, cfg.nsfw_words);

    // -- Xuất trực tiếp hit điều kiện phân luồng: Chuyển tạm thời sang model phân tích, xuất ảnh theo số lượng và tổ hợp của kênh phân luồng --
    // Xuất trực tiếp sẽ gửi thân bài ngôn ngữ tự nhiên, trong khi kênh phân luồng (NAI xịn / Gateway) train theo thẻ Danbooru, chỉ ăn thẻ.
    // Việc đem văn xuôi nhét vào như thẻ tương đương với đút nhiễu, chắc chắn không vẽ ra được (Đây là nút thắt cũ của Xuất trực tiếp + Phân luồng).
    // Do đó khi hit sẽ đổi sang "Model phân tích chuyển thành prompt": Model phân tích sẽ dựa theo số lượng nsfw_max và tổ hợp nsfw_mix
    // (1 Đời thường + 1 NSFW / Toàn bộ NSFW) để sinh ra desc+tags, sau đó drawMarkers dùng forceDivert
    // bắt buộc đi qua kênh phân luồng gửi thẻ. Các khung hình bình thường không bị ảnh hưởng, vẫn xuất trực tiếp không qua phân tích.
    if (needDivert) {
        const kind = ctxAnalyzer(cfg);
        if (!kind) {
            const why = 'Thân bài hit điều kiện phân luồng, nhưng "Xuất ảnh theo context" lại chọn model phân tích tùy chỉnh mà chưa điền địa chỉ/tên model, '
                + 'không thể chuyển thân bài thành thẻ để mớm cho kênh phân luồng. Vui lòng điền đủ cấu hình model phân tích, hoặc chuyển "Dùng model nào để đọc" về lại "Đi theo API chính của SillyTavern".';
            warn(`${tag} ${why}`);
            finishProgress(why, true);
            return;
        }
        const nsfwN = Math.min(6, Math.max(1, cfg.nsfw_max | 0));
        showProgress(`Đang phân tích thân bài... (Hit điều kiện phân luồng, chuyển sang model phân tích sinh ${nsfwN} thẻ)`);
        log(`${tag} Thân bài hit điều kiện phân luồng, tạm thời chuyển model phân tích (${analyzerLabel(cfg, kind)}) sinh ${nsfwN} bộ thẻ rồi đi qua kênh phân luồng`);
        // Hit phân luồng NSFW: Giao cho model phân tích đánh giá ngữ nghĩa xem "Khoảnh khắc nào mới là khung hình người lớn thực sự" (Đoạn trước/giữa/sau đều có thể),
        // Chứ không dùng từ khóa để chọn đoạn một cách cứng nhắc - Từ khóa chỉ chịu trách nhiệm quyết định "Có phân luồng hay không", chọn khoảnh khắc nào do model phân tích đọc thân bài rồi phán đoán.
        const items = await runCtxAnalyzer(kind, cfg, {
            reply: body,
            context: collectContext(ctx.chat, messageId),
            work: workLabel(ctx),
            max: nsfwN,
            nsfw: true,
            nsfwMix: cfg.nsfw_mix,
            nsfwDailyPlace: cfg.nsfw_daily_place,
            signal,
        });
        if (isAborted(signal)) { finishProgress('Đã dừng', false); return; }
        if (!items.length) {
            log(`${tag} Hit điều kiện phân luồng, nhưng model phân tích không trả về khung hình nào có thể vẽ`);
            finishProgress('Hit điều kiện phân luồng, nhưng model phân tích không trả về khung hình nào có thể vẽ', true);
            return;
        }
        await runIllustration(ctx, messageId, msg, items.slice(0, nsfwN), signal, { forceDivert: true });
        return;
    }

    // -- Không hit phân luồng: Xuất trực tiếp thân bài (Văn -> Ảnh), hỗ trợ xuất nhiều ảnh theo "Giới hạn mỗi lượt" --
    // Việc xuất nhiều ảnh được implement theo kiểu "Mở nhiều cửa sổ": Cắt thân bài theo đoạn thành nhiều phần, mỗi ảnh gửi độc lập lên tuyến trên một lần,
    // Ảnh 1 vẽ đoạn đầu, Ảnh 2 vẽ đoạn giữa... Nội dung mỗi ảnh tự nhiên sẽ khác nhau, chứ không phải lấy cùng một đoạn vẽ đi vẽ lại N lần.
    const maxN = Math.min(6, Math.max(1, cfg.max_per_round | 0));
    const chunks = splitProseChunks(body, maxN);
    if (!chunks.length) { finishProgress('Thân bài rỗng, bỏ qua', false); return; }

    // Mỗi phần thân bài sẽ được ghép độc lập với chỉ thị vẽ tích hợp sẵn và phong cách, vị trí chèn lấy theo vị trí của phần thân bài đó trong nguyên văn.
    const items = [];
    let cursor = 0;
    for (const chunk of chunks) {
        const prose = buildDirectProse(chunk, {
            guide: cfg.ctx_direct_guide,
            work: workLabel(ctx),
            style: cfg.ctx_style,
            quality: cfg.ctx_quality,
            negative: cfg.ctx_negative,
        });
        if (!prose.trim()) continue;
        const at = body.indexOf(chunk, cursor);
        items.push({ desc: prose, at: at >= 0 ? at + chunk.length : -1 });
        cursor = at >= 0 ? at + chunk.length : cursor;
    }
    if (!items.length) { finishProgress('Thân bài rỗng, bỏ qua', false); return; }

    log(`${tag} Xuất trực tiếp ${items.length} ảnh (${[...body].length} chữ, cắt theo đoạn, mỗi ảnh gửi độc lập lên tuyến trên)`);
    showProgress(`Đang vẽ hình minh họa 1/${items.length} ... Khoảng 30~60 giây/ảnh, có thể chat chuyện khác trước`);

    // Xuất trực tiếp nhiều ảnh dùng applyProseMarkers: Mỗi ảnh chèn vào dưới đoạn văn tương ứng, thay vì tất cả đều treo ở cuối.
    // Khi chỉ có 1 ảnh thì đi qua applyProseMarker (Dùng vị trí chèn theo heuristic hoặc cuối cùng, hành vi giống hệt bản cũ).
    const src = items.length === 1
        ? applyProseMarker(body, items[0].desc, cfg.ctx_direct_place === 'end' ? -1 : pickProseAnchor(body))
        : applyProseMarkers(body, items);
    await runIllustration(ctx, messageId, msg, items, signal, { direct: true, src });
}

// runIllustration Chuyển danh sách khung hình thành marker, sau đó tận dụng lại luồng xuất ảnh và thay thế tại chỗ có sẵn.
//
// opt hỗ trợ:
//   direct      Xuất trực tiếp: Không qua model phân tích, marker do prose bọc lại (Không qua anchor định vị)
//   at          Index chèn vào khi xuất trực tiếp ảnh đơn (-1 = Cuối cùng)
//   forceDivert Hit phân luồng: Bắt buộc đi qua kênh phân luồng gửi thẻ tag
//   src         Thân bài kèm marker đã được ghép sẵn từ bên ngoài (Khi xuất trực tiếp nhiều ảnh do applyProseMarkers ghép sẵn), ưu tiên cao hơn việc tự lắp ráp bằng items
async function runIllustration(ctx, messageId, msg, items, signal, opt = {}) {
    const cfg = s();
    const reply = String(msg.mes ?? '');
    // Xuất trực tiếp không đi qua anchor (Không có ai quyết định sẽ chèn dưới đoạn nào), marker được nối thêm vào cuối toàn bộ câu trả lời;
    // Các luồng còn lại do applyMarkers chèn tại chỗ theo anchor.
    // Khi xuất trực tiếp nhiều ảnh opt.src do bên gọi (applyProseMarkers) ghép sẵn, ở đây sử dụng trực tiếp.
    const src = opt.src
        ? opt.src
        : (opt.direct
            ? applyProseMarker(reply, items[0]?.desc ?? '', opt.at ?? -1)
            : applyMarkers(reply, items));
    const markers = findMarkers(src);
    if (!markers.length) {
        log(`#${messageId} Lắp ráp marker xong thì bị rỗng, bỏ qua`);
        finishProgress('Không có marker nào có thể chèn', true);
        return;
    }

    msg.extra = msg.extra || {};
    const st = { src, urls: new Array(markers.length).fill(null) };
    msg.extra.illust = st;

    // Payload của xuất trực tiếp là ngôn ngữ tự nhiên của thân bài, không liên quan gì đến prompt_format: Cố định đi theo mức description,
    // Như vậy chuỗi họa sĩ (Tên họa sĩ tiếng Anh) sẽ tự động nhường chỗ theo luật có sẵn, không bị lọt vào trong văn xuôi.
    const promptMode = opt.direct
        ? 'description'
        : resolvePromptMode(cfg.prompt_format, cfg.base_url, cfg.upstream_type);
    const { ok, errors } = await drawMarkers(ctx, messageId, msg, st, markers, cfg, signal, promptMode, !!opt.forceDivert);

    if (isAborted(signal)) {
        finishProgress('Đã dừng', false);
    } else if (ok > 0) {
        finishProgress(`Hoàn tất hình minh họa${ok > 1 ? ` (${ok} ảnh)` : ''}`);
    } else {
        finishProgress(`Tạo hình minh họa thất bại: ${errors[0] ?? 'Lỗi không xác định'}`, true);
    }
    await finishMessage(ctx, messageId, msg, st, ok, errors);
}

// onSwipeSettled Khi chuyển sang một câu trả lời đã có sẵn (Chưa trigger tạo lại), bổ sung hoặc khôi phục hình minh họa cho nó.
async function onSwipeSettled(messageId) {
    if (!s().enabled) return;
    if (messageId === undefined || messageId === null) return;
    if (!s().swipe_regenerate) { await rehydrateAll(); return; }
    if (isGenerating()) { log('swipe đã kích hoạt tạo lại, giao cho MESSAGE_RECEIVED xử lý'); return; }

    const ctx = getContext();
    const msg = ctx.chat?.[Number(messageId)];
    if (!msg || msg.is_user || msg.is_system) return;

    const st = msg.extra?.illust;
    if (st && Array.isArray(st.urls) && st.urls.length > 0 && st.urls.every(Boolean)) {
        rehydrateOne(Number(messageId), msg); // Dòng này đã có ảnh, chỉ cần dán hiển thị trở lại
        return;
    }
    if (!hasMarkers(String(msg.mes ?? ''))) return;
    if (!hasImageBackend(s())) return;
    await processMessage(Number(messageId), 'swipe', msg);
}

// isGenerating SillyTavern có đang tạo / xuất streaming hay không (Trong khoảng thời gian này không được render lại DOM của tin nhắn).
function isGenerating() {
    const sp = getContext().streamingProcessor;
    return !!(sp && sp.isFinished === false);
}

// -- Luồng chính: Bắt marker -> Xuất ảnh tuần tự -> Thay thế tại chỗ --

async function processMessage(messageId, type, msg) {
    const mes = String(msg.mes ?? '');
    const tag = `#${messageId}(${type ?? '-'})`;

    if (msg.extra?.illust_done) { log(`${tag} Đã ghép ảnh rồi, bỏ qua`); return; }
    if (inFlight.has(messageId)) { log(`${tag} Đang được xử lý, bỏ qua`); return; }

    const now = Date.now();
    if (now - (lastPass.get(messageId) ?? 0) < PASS_COOLDOWN) { log(`${tag} Đang trong thời gian chờ (cooldown), bỏ qua`); return; }
    lastPass.set(messageId, now);

    // Trạng thái: src = Nguyên văn đầy đủ chứa marker (Căn cứ duy nhất để hiển thị và thử lại), urls tương ứng 1-1 với marker.
    // Khi continue / append thì mes = Văn bản cũ đã bóc marker + Văn bản mới, ở đây sẽ ghép nguyên văn lại rồi mới đếm marker.
    const st0 = msg.extra?.illust;
    let eff = effectiveSource(mes, st0);

    // Nắn lại vị trí chèn: Khi model vứt toàn bộ marker xuống cuối câu trả lời, sẽ dàn đều các marker ra theo từng đoạn.
    // Chỉ thực hiện ở "Lần xử lý đầu tiên / Thân bài bị thay thế toàn bộ" - Khi viết tiếp (continue) thì src là thứ đã được gia công từ lượt trước,
    // Nếu dàn lại lần nữa sẽ làm mối quan hệ index của các marker đã xuất ảnh và urls bị lệch nhau.
    if (s().marker_redistribute && (eff.mode === 'new' || eff.mode === 'reset')) {
        const moved = redistributeMarkers(eff.src);
        if (moved) {
            log(`${tag} Marker bị dồn cục ở cuối, đã phân bố lại theo đoạn văn`);
            eff = { ...eff, src: moved };
        }
    }

    const markers = findMarkers(eff.src);
    if (!markers.length) return; // Im lặng bỏ qua, không làm phiền người dùng
    log(`${tag} Hit ${markers.length} marker, source mode=${eff.mode}`);

    const cfg = s();
    if (!cfg.base_url && !isLocalUpstream(cfg.base_url)) {
        toastr.warning('Chưa cấu hình địa chỉ service NAI: Nếu đã cài V.Adapter sẽ tự động kết nối trực tiếp; Nếu chưa, vui lòng điền một địa chỉ service giao thức NovelAI', 'V.Canvas');
        return;
    }

    // Nội dung gửi đi được phân luồng theo đường dẫn: Service chuyển đổi gửi mô tả ngôn ngữ tự nhiên, NAI chính thức / Gateway gửi thẻ Danbooru.
    const promptMode = resolvePromptMode(cfg.prompt_format, cfg.base_url, cfg.upstream_type);
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
        // Tình huống viết tiếp (continue): Các marker đã có giữ nguyên (Các ảnh đã tạo tiếp tục tái sử dụng), chỉ chèn thêm placeholder cho marker mới
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
            // Toàn bộ hình ảnh đã được tạo trước đó, chỉ hiển thị chứ không ghi đè lại
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
        finishProgress('Đã dừng', false);
    } else if (ok > 0) {
        finishProgress(`Hoàn tất hình minh họa${ok > 1 ? ` (${ok} ảnh)` : ''}`);
    } else {
        finishProgress(`Tạo hình minh họa thất bại: ${errors[0] ?? 'Lỗi không xác định'}`, true);
    }
    finishMessage(ctx, messageId, msg, st, ok, errors);
}

// finishMessage Dọn dẹp: Thống kê kết quả -> Lưu ổ cứng -> Thông báo (Lịch sử trò chuyện không còn lưu lại text loading).
async function finishMessage(ctx, messageId, msg, st, ok, errors) {
    const allDone = st.urls.length > 0 && st.urls.every(Boolean);
    msg.extra.illust_done = allDone;

    // Hình minh họa không đi vào context: Thân bài chỉ giữ lại văn bản thuần túy, hình ảnh chỉ được ghi vào extra.display_text.
    if (ok > 0 && s().strip_marker) {
        const cleaned = stripMarkers(String(msg.mes ?? ''));
        if (cleaned && cleaned !== msg.mes) msg.mes = cleaned;
    }

    applyDisplay(ctx, messageId, msg, st);

    try {
        await ctx.saveChat();
    } catch (err) {
        warn('Lưu lịch sử trò chuyện thất bại:', err);
    }

    if (ok > 0 && errors.length === 0) {
        toastr.success(`Hoàn tất hình minh họa${ok > 1 ? ` (${ok} ảnh)` : ''}`, 'V.Canvas');
    } else if (ok > 0) {
        toastr.warning(`Hoàn tất ${ok} ảnh, có ${errors.length} ảnh thất bại: ${errors[0]}`, 'V.Canvas', { timeOut: 12000 });
    } else if (errors.length) {
        toastr.error(`Tạo hình minh họa thất bại: ${errors[0]}`, 'V.Canvas', { timeOut: 12000 });
    }
}

// applyDisplay Render "Nguyên văn + URL ảnh đã tạo" thành display_text và làm mới DOM của tin nhắn này.
//
// pending cố định là 'drop': Những marker chưa ra ảnh sẽ không nằm lại trong thân bài.
// Nếu không thì khi bức ảnh đầu tiên xuất hiện, hàng trăm chữ prompt của bức thứ hai sẽ phơi ra thành text thuần trộn vào trong thân bài -
// Cảm quan mang lại sẽ là "Hình chưa ra, chỉ thấy lòi ra một đống chữ", trong khi thực tế bức đầu tiên đã tạo xong rồi.
function applyDisplay(ctx, messageId, msg, st) {
    const dt = buildDisplayText(st.src ?? String(msg.mes ?? ''), st.urls, 'Illustration', 'drop');
    if (dt) {
        msg.extra.display_text = dt;
    } else {
        delete msg.extra.display_text;
    }
    try {
        ctx.updateMessageBlock(messageId, { ...msg }); // Chỉ render lại mỗi tin nhắn này, sẽ không kích hoạt event nào nữa
        scheduleHarden(messageId);
    } catch (err) {
        warn('Làm mới DOM tin nhắn thất bại:', err);
    }
    try {
        if (messageId === (ctx.chat?.length ?? 0) - 1) ctx.scrollOnMediaLoad?.();
    } catch { /* Phiên bản cũ không có method này */ }
}

/**
 * drawMarkers Thực thi một loạt task tạo ảnh, mỗi tấm thành công sẽ lập tức được chèn vào đúng vị trí.
 *
 * Tuần tự (parallel tắt, mặc định): Gửi request từng cái một. Dùng khi tuyến trên hạn chế kết nối đồng thời hoặc có quản lý rủi ro (phòng chống bot).
 * Song song (parallel bật): Gửi toàn bộ request cùng lúc, tự await riêng rẽ, cái nào trả về trước thì chèn vào trước -
 *   Không đợi các request khác, cũng không đợi cả lô hoàn tất. Dành cho các tuyến trên cho phép gửi đồng thời.
 *
 * Ở cả hai chế độ, mỗi tấm sau khi thành công sẽ lập tức render lại DOM của tin nhắn đó, do đó tấm đầu tiên vừa ra lò là có thể nhìn thấy ngay,
 * Không bị trì hoãn bởi tấm thứ hai chưa xong. Thất bại không ảnh hưởng lẫn nhau: Một tấm thất bại sẽ không ngắt các request còn lại.
 *
 * @returns {Promise<{ok:number, errors:string[]}>}
 */
async function drawMarkers(ctx, messageId, msg, st, batch, cfg, signal, promptMode, forceDivert = false) {
    const total = batch.length;
    let ok = 0;
    let done = 0;
    const errors = [];

    // Chuỗi họa sĩ lấy một lần, tái sử dụng cho cả lô. Có thực sự ghép vào hay không do promptMode quyết định:
    // Khi gửi mô tả ngôn ngữ tự nhiên (Qua V.Adapter), withArtistPrompt sẽ trả về nguyên trạng, không làm ô nhiễm mô tả.
    const artistStr = artistPromptFor(cfg.artist_presets, cfg.active_artist);
    if (artistStr && !artistAppliesTo(promptMode)) {
        log(`Đã chọn chuỗi họa sĩ (Tên "${cfg.active_artist}") nhưng hình thái hiện tại là ${promptMode}, lần này không ghép`);
    }

    updateProgress(cfg.parallel
        ? `Đang vẽ ${total} hình minh họa ... Khoảng 30~60 giây`
        : (total > 1
            ? `Đang vẽ hình minh họa 1/${total} ... Khoảng 30~60 giây/ảnh, có thể chat chuyện khác trước`
            : 'Đang vẽ hình minh họa ... Khoảng 30~60 giây'));

    // Placeholder chỉ sửa đổi DOM, không ghi xuống đĩa (Ghi vào rồi mà thất bại hoặc F5 là text "Đang vẽ" sẽ nằm chết ở đó luôn).
    for (const m of batch) showPlaceholder(messageId, m.raw, 'Đang vẽ hình minh họa ...');

    const runOne = async (m) => {
        try {
            // -- Chọn kênh --
            // Kênh chính (V.Adapter / Model chat vẽ ảnh) có chính sách nội dung của nền tảng, một số khung hình gửi lên chắc chắn sẽ thất bại.
            // Khi hit điều kiện phân luồng sẽ ném sang bộ backend thứ hai; Không hit thì hoàn toàn đi theo kênh chính, hành vi không đổi.
            //
            // forceDivert: Khi xuất trực tiếp/chế độ phân tích hit NSFW, runDirectPass/runAnalyzePass đã đánh giá từ trước
            // và chuyển sang phân tích, đã xác định chắc chắn phải đi qua kênh phân luồng, nên không thực hiện đánh giá chuỗi lần thứ hai.
            //
            // Khi chưa force, sẽ đánh giá ở hai nơi, hit một trong hai là chuyển luồng:
            //   a) Hai đoạn nguyên văn của marker (m.desc + m.tags) - Hình thái gửi đi sau khi chọn kênh mới được xác định, nếu chọn đoạn trước sẽ bỏ sót nửa kia;
            //   b) **Nguyên văn của toàn bộ tin nhắn** (msg.mes) - Thân bài mới là ngọn nguồn thực sự của NSFW.
            //      Marker là lời thuật lại do model cốt truyện viết, có thể rất ẩn ý (Thân bài ghi "làm tình", nhưng marker lại viết "hai người quấn quýt"),
            //      Chỉ đánh giá marker sẽ bị lọt lưới -> Gửi nhầm cho kênh chính qwen (Không vẽ được NSFW) -> Toàn bộ lượt bị vứt bỏ.
            const bodyForNsfw = stripMarkers(String(msg?.mes ?? ''));
            const diverted = forceDivert
                || (cfg.nsfw_enabled && !!cfg.nsfw_base_url
                    && (detectNsfw(`${m.desc ?? ''} ${m.tags ?? ''}`, cfg.nsfw_words)
                        || (bodyForNsfw && detectNsfw(bodyForNsfw, cfg.nsfw_words))));

            // Route của kênh phân luồng (NAI xịn / Gateway, ăn chuỗi thẻ).
            const divertRoute = {
                baseUrl: cfg.nsfw_base_url,
                apiKey: cfg.nsfw_api_key,
                model: cfg.nsfw_model,
                mode: resolvePromptMode(cfg.nsfw_prompt_format, cfg.nsfw_base_url, cfg.nsfw_upstream_type),
                negative: cfg.nsfw_negative || cfg.negative,
                bridge: false,
                // Bản thân tuyến trên phân luồng không giới hạn nội dung, "Từ phá giới hạn xuất ảnh" không có ý nghĩa với nó -
                // Thứ đó chuẩn bị cho các tuyến trên bị kiểm duyệt, ghép vào chỉ làm ô nhiễm khung hình. Ở đây đổi sang dùng tiền tố chuyên dụng cho phân luồng.
                prefix: cfg.nsfw_prefix,
                label: 'Phân luồng',
            };
            // Route của kênh chính (V.Adapter / Model chat vẽ ảnh, ăn ngôn ngữ tự nhiên hoặc gửi theo hình thái).
            const mainRoute = {
                baseUrl: cfg.base_url,
                apiKey: cfg.api_key,
                model: cfg.model,
                mode: promptMode,
                negative: cfg.negative,
                bridge: true,
                prefix: cfg.jb_image,
                label: 'Kênh chính',
            };

            // Một lần thử xuất ảnh: Chọn một route nào đó rồi lưu vào ổ cứng. Thất bại thì ném lỗi, do tầng trên quyết định có đổi đường thử lại hay không.
            const attempt = async (r, isDivert) => {
                const sendPrompt = selectPrompt(m, r.mode);
                if (isDivert) log(`#${messageId} Tấm thứ ${m.index + 1} hit điều kiện phân luồng, chuyển sang kênh phân luồng (${r.mode})`);
                const gen = await generateIllustration({
                    baseUrl: r.baseUrl,
                    apiKey: r.apiKey,
                    model: r.model,
                    prompt: buildUpstreamPrompt(withArtistPrompt(sendPrompt, artistStr, r.mode), r.prefix),
                    negative: r.negative,
                    width: cfg.width,
                    height: cfg.height,
                    steps: cfg.steps,
                    scale: cfg.scale,
                    timeoutMs: cfg.timeout_sec * 1000,
                    signal,
                    salt: cfg.exclusive_salt,
                    signMode: cfg.sign_mode,
                    allowBridge: r.bridge,
                });
                return { gen, sendPrompt };
            };
            // Đi qua kênh phân luồng bằng chuỗi thẻ chỉ định trước (Sản phẩm sau khi văn xuôi xuất trực tiếp được chuyển sang phân tích; Không phụ thuộc vào đoạn tags của marker).
            const attemptDivertWith = async (tags) => {
                log(`#${messageId} Tấm thứ ${m.index + 1} chuyển sang kênh phân luồng (Model phân tích sinh ra thẻ, ${divertRoute.mode})`);
                const gen = await generateIllustration({
                    baseUrl: divertRoute.baseUrl,
                    apiKey: divertRoute.apiKey,
                    model: divertRoute.model,
                    prompt: buildUpstreamPrompt(withArtistPrompt(tags, artistStr, divertRoute.mode), divertRoute.prefix),
                    negative: divertRoute.negative,
                    width: cfg.width,
                    height: cfg.height,
                    steps: cfg.steps,
                    scale: cfg.scale,
                    timeoutMs: cfg.timeout_sec * 1000,
                    signal,
                    salt: cfg.exclusive_salt,
                    signMode: cfg.sign_mode,
                    allowBridge: divertRoute.bridge,
                });
                return { gen, sendPrompt: tags };
            };

            // Đi đường nào: Đã xác định phân luồng -> Phân luồng thẳng; Nếu không thì đi kênh chính trước, thất bại và phân luồng khả dụng -> Tự động chuyển phân luồng thử lại một lần.
            // Đây là bước dự phòng "Đánh giá lọt lưới thì vẫn ra được ảnh": Thân bài bị lọt lưới đánh giá nên đi vào qwen, sau khi bị từ chối sẽ tự động đổi sang NAI xịn vẽ lại,
            // Sẽ không còn xuất hiện tình trạng "Plugin không dùng được".
            const firstRoute = diverted ? divertRoute : mainRoute;
            let result;
            try {
                result = await attempt(firstRoute, diverted);
            } catch (err) {
                if (isAborted(signal)) throw err;
                // Kênh chính thất bại -> Điều kiện kích hoạt chuyển phân luồng thử lại (nsfw_retry có 3 mức):
                //   off   = Không tự động chuyển phân luồng - Kênh chính thất bại thì thôi, tuyệt đối không đụng vào quota NAI (Tiết kiệm nhất);
                //   force = Bất kể lý do gì, chuyển phân luồng vô điều kiện - Ảnh chắc chắn sẽ ra (Người dùng chốt hạ);
                //   smart = Chỉ chuyển khi "Nghi ngờ NSFW" - Thân bài/marker hit từ đánh giá,
                //           Hoặc thông báo lỗi là bị chính sách nội dung từ chối (qwen từ chối trả lời vì NSFW, đây chính là trường hợp đánh giá bị lọt lưới).
                //           Ảnh đời thường bị lỗi mạng / timeout từ qwen sẽ không chuyển, tránh đốt quota NAI vô ích.
                const whyFull = String(err?.message ?? String(err));
                const why = truncateText(whyFull, 200);
                const nsfwHint = (bodyForNsfw && detectNsfw(bodyForNsfw, cfg.nsfw_words))
                    || detectNsfw(`${m.desc ?? ''} ${m.tags ?? ''}`, cfg.nsfw_words);
                const policyRejected = /content\s*policy|not\s*allowed|refus\w*|blocked?|violat\w+|prohibit\w+|từ chối|chính sách nội dung|nhạy cảm|không cấp phép|không thể tạo|không cho phép|tuân thủ|kiểm duyệt|rủi ro/i.test(whyFull);
                const shouldRetry = !diverted && cfg.nsfw_enabled && !!cfg.nsfw_base_url
                    && cfg.nsfw_retry !== 'off'
                    && (cfg.nsfw_retry === 'force' || nsfwHint || policyRejected);
                if (shouldRetry) {
                    // Marker văn xuôi xuất trực tiếp không có đoạn tags: Nếu cứ thế quăng nguyên văn xuôi làm thẻ cho kênh phân luồng thì chắc chắn không vẽ được,
                    // Bắt buộc phải nhờ model phân tích dịch thân bài thành desc+tags trước, sau đó mới gửi thẻ. Chỗ này xử lý nhất quán với
                    // nhánh hit phân luồng của runDirectPass - Nếu không thì sau khi qwen từ chối, chuyển sang NAI gửi văn xuôi cũng vứt đi.
                    let divertPrompt = null;
                    if (!m.tags && bodyForNsfw) {
                        const kind = ctxAnalyzer(cfg);
                        if (kind) {
                            warn(`#${messageId} Tấm thứ ${m.index + 1} kênh chính thất bại (${why}), chuyển sang model phân tích tạo thẻ rồi đi qua kênh phân luồng`);
                            const translated = await runCtxAnalyzer(kind, cfg, {
                                reply: bodyForNsfw,
                                context: collectContext(ctx.chat, messageId),
                                work: workLabel(ctx),
                                max: 1,
                                nsfw: true,
                                nsfwMix: cfg.nsfw_mix,
                                nsfwDailyPlace: cfg.nsfw_daily_place,
                                signal,
                            });
                            if (isAborted(signal)) throw err;
                            if (translated.length && translated[0].tags) {
                                divertPrompt = translated[0].tags;
                            }
                        }
                    }
                    if (divertPrompt) {
                        result = await attemptDivertWith(divertPrompt);
                    } else {
                        warn(`#${messageId} Tấm thứ ${m.index + 1} kênh chính thất bại (${why}), tự động chuyển kênh phân luồng thử lại`);
                        result = await attempt(divertRoute, true);
                    }
                } else {
                    throw err;
                }
            }

            const subFolder = ctx.name2 || '';
            const fileName = `illust_${Date.now()}_${m.index}`;
            // url tồn tại = kết quả giáng cấp link từ xa của tuyến trên (Không có byte ảnh cục bộ), tham chiếu trực tiếp, không ghi xuống đĩa
            const url = result.gen.url ?? await saveBase64AsFile(result.gen.base64, subFolder, fileName, result.gen.extension);
            st.urls[m.index] = url;
            ok++;
            done++;
            log(`#${messageId} Tấm thứ ${m.index + 1} hoàn thành -> ${url}`);

            // Ghi vào lịch sử tạo ảnh: Tách biệt với cuộc trò chuyện hiện tại, chuyển chat xong vẫn có thể tra cứu
            recordHistory({
                url,
                prompt: result.sendPrompt,
                name: subFolder,
                mid: messageId,
                idx: m.index,
            });

            applyDisplay(ctx, messageId, msg, st);
            updateProgress(total > 1 ? `Đã hoàn thành ${done}/${total} ảnh` : 'Hoàn tất hình minh họa');
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

// -- Xem prompt hình minh họa --
//
// Bản thân prompt đã được lưu cùng với lịch sử trò chuyện (extra.illust.src là nguyên văn đầy đủ chứa marker),
// Ở đây chỉ bổ sung thêm một cổng hiển thị: Click vào hình minh họa -> Cửa sổ nổi hiển thị mô tả và thẻ tag của marker tương ứng với ảnh đó.
//
// Ràng buộc hiệu năng:
//   - Ủy quyền sự kiện (Event Delegation): Listener chỉ được mount đúng một lần trong suốt vòng đời ứng dụng, mount trên phần tử tổ tiên của vùng chứa tin nhắn,
//     Không bind riêng cho từng hình minh họa (Số lượng ảnh tăng lên hoặc render lặp lại sẽ không làm tích tụ listener);
//   - Phân tích theo yêu cầu: Prompt chỉ được parse ra lúc click vào, trong giai đoạn render không làm bất kỳ tiền xử lý nào;
//   - Cửa sổ nổi hủy ngay tức khắc: Cửa sổ nổi và listener bàn phím đi kèm chỉ tồn tại trong thời gian nó bật lên, đóng lại là xóa bỏ.
//   - Không kích hoạt bất kỳ lệnh gọi model hay request mạng nào.

const PROMPT_OVERLAY_ID = 'v_canvas_prompt_overlay';
let promptViewerInstalled = false;
let promptKeyHandler = null;

function installPromptViewer() {
    if (promptViewerInstalled) return;
    promptViewerInstalled = true;
    // Kích hoạt ở giai đoạn capture: Tránh việc các xử lý click khác bên trong tin nhắn chặn mất bong bóng sự kiện (propagation) khiến cổng này bị vô hiệu.
    document.addEventListener('click', onChatImageClick, true);
}

function onChatImageClick(ev) {
    const img = ev.target?.closest?.('.mes_text img');
    if (!img) return;
    const info = resolveIllustration(img);
    if (info) showPromptOverlay(info);
}

// normalizeUrl Cắt bỏ query string và phần host giao thức, sau đó giải mã thêm một lần -
// URL được lưu lại ở dạng nguyên thủy (Có thể chứa dấu cách), trong khi trong display_text là dạng đã qua encodeMdUrl mã hóa,
// Cả hai bên đều giải mã xong thì mới khớp được với nhau.
function normalizeUrl(u) {
    let s = String(u ?? '').split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
    try {
        s = decodeURIComponent(s);
    } catch { /* Khi mã hóa không trọn vẹn thì so sánh nguyên trạng */ }
    return s;
}

/**
 * resolveIllustration Từ hình minh họa được click, tra ngược lại số thứ tự của nó trong extra.illust và marker gốc.
 * Hình ảnh không do extension này sinh ra (Avatar thẻ nhân vật, hình người dùng tự chèn v.v.) nhất luật trả về null.
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

// showPromptOverlay Bật cửa sổ nổi chứa prompt (DOM được tạo tức thời, đóng là hủy, không ghi vào lịch sử trò chuyện).
function showPromptOverlay({ messageId, index, marker }) {
    closePromptOverlay();

    const section = (label, value, mono) => {
        const body = value
            ? escapeHtml(value)
            : '<span class="v_canvas_prompt_none">(Không cung cấp trong đánh dấu)</span>';
        return `<div class="v_canvas_prompt_section">`
            + `<div class="v_canvas_prompt_lab">${label}</div>`
            + `<div class="v_canvas_prompt_text${mono ? ' mono' : ''}">${body}</div>`
            + `</div>`;
    };

    const el = document.createElement('div');
    el.id = PROMPT_OVERLAY_ID;
    el.innerHTML = `
        <div class="v_canvas_prompt_box" role="dialog" aria-label="Prompt hình minh họa">
            <div class="v_canvas_prompt_head">
                <span>Tin nhắn thứ ${messageId} · Tấm thứ ${index + 1}</span>
                <button type="button" class="menu_button v_canvas_prompt_close">Đóng</button>
            </div>
            <div class="v_canvas_prompt_body">
                ${section('Mô tả ngôn ngữ tự nhiên', marker.desc, false)}
                ${section('Thẻ Danbooru', marker.tags, true)}
            </div>
        </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.v_canvas_prompt_close')) closePromptOverlay();
    });
    promptKeyHandler = (e) => { if (e.key === 'Escape') closePromptOverlay(); };
    document.addEventListener('keydown', promptKeyHandler);
}

// -- Dán lại hiển thị (Đổi chat / Đổi swipe) --

// hardenChatIllustrationImages Bổ sung referrerpolicy="no-referrer" cho thẻ <img> hình minh họa trong thân bài.
//
// Tại sao lại cần: CDN của tuyến trên (cdn.qwenlm.ai) có cơ chế chống trộm link (anti-hotlink), các request mang theo Referer của SillyTavern nhất luật bị 403.
// <img> trong bảng điều khiển thì có thể viết thuộc tính trực tiếp; Nhưng thân bài lại render qua markdown, thuộc tính không thể mang theo
// (Pipeline render sẽ lọc mất), chỉ có thể bổ sung sau khi DOM đã render - đồng thời gán lại src một lần,
// Ép buộc gửi lại request với policy mới (Request đầu tiên có thể đã gửi theo policy mặc định và bị 403 rồi).
// Chỉ xử lý địa chỉ ảnh từ xa do plugin này ghi vào, không đụng chạm đến ảnh từ các nguồn khác trong tin nhắn.
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

        // Phải nhận diện được cả 3 cách viết:
        //   URL nguyên thủy (Chứa khoảng trắng, dấu ngoặc v.v.)
        //   Sau khi giải mã - Lấy được từ DOM là hình thức đã được trình duyệt chuẩn hóa
        //   Sau khi mã hóa - Lưu trong display_text là sản phẩm của encodeMdUrl() (Khoảng trắng -> %20, ngoặc -> %28)
        // Nếu chỉ so sánh một loại, khi tên nhân vật hoặc tên file có khoảng trắng / dấu ngoặc sẽ bị lọt lưới,
        // Biểu hiện là "Cùng một bức ảnh nhưng trong bảng quản lý thì bình thường, trong thân bài thì nứt".
        const norm = (u) => { try { return decodeURIComponent(String(u)); } catch { return String(u); } };
        const enc = (u) => { try { return encodeURI(String(u)); } catch { return String(u); } };
        const keys = new Set();
        for (const u of urls) { keys.add(u); keys.add(norm(u)); keys.add(enc(u)); }

        const roots = messageId === undefined
            ? document.querySelectorAll('.mes_text')
            : document.querySelectorAll(`.mes[mesid="${messageId}"] .mes_text`);
        roots.forEach((root) => {
            root.querySelectorAll('img').forEach((im) => {
                const src = im.getAttribute('src') || '';
                if (!/^https?:/i.test(src)) return;                          // Chỉ xử lý ảnh từ xa
                if (!keys.has(src) && !keys.has(norm(src)) && !keys.has(enc(src))) return;
                // Đã gửi bằng policy đúng và thực sự load thành công rồi thì không đụng nữa
                const already = im.getAttribute('referrerpolicy') === 'no-referrer';
                if (already && !(im.complete && im.naturalWidth === 0)) return;
                im.setAttribute('referrerpolicy', 'no-referrer');
                im.src = src;                                                // Phát lại request bằng policy mới
            });
        });
    } catch (err) {
        warn('Gia cố chống trộm link cho hình minh họa thân bài thất bại:', err);
    }
}

// Việc render lại chưa chắc đã hoàn thành đồng bộ: Quét ngay lập tức sau updateMessageBlock, những <img> đó có khi còn chưa vào DOM,
// Kết quả là chẳng bổ sung được gì cả - Hình vẫn mang theo Referer của SillyTavern đi request, bị CDN đập 403 vào mặt.
// Do đó sau frame đầu tiên, hãy quét thêm vài lần theo bậc thang; Số lần có hạn, sẽ không chạy thường trú.
const HARDEN_RETRY_DELAYS = [0, 80, 300, 800];

function scheduleHarden(messageId) {
    for (const d of HARDEN_RETRY_DELAYS) {
        if (d === 0) hardenChatIllustrationImages(messageId);
        else setTimeout(() => hardenChatIllustrationImages(messageId), d);
    }
}

function rehydrateOne(messageId, msg) {
    const st = msg?.extra?.illust;
    if (!st || !Array.isArray(st.urls) || !st.src) return false;
    // Nắn lại vị trí cũng áp dụng được cho tin nhắn cũ: Chỉ dời vị trí của marker trong nguyên văn, thứ tự trước sau của marker không đổi,
    // Do đó mối quan hệ tương ứng với index của urls vẫn còn nguyên, những hình ảnh đã vẽ xong sẽ không bị vẽ lại hay đặt sai chỗ.
    // Nếu không có câu này, khi bật công tắc lên, hình minh họa của các tin nhắn cũ vẫn kẹt ở cuối, trông như thể "bật lên mà chẳng có tác dụng".
    if (s().marker_redistribute) {
        const moved = redistributeMarkers(st.src);
        if (moved) st.src = moved;
    }
    // drop: Khi chuyển chat load lại, nếu có bức nào chưa xuất ảnh xong thì prompt của nó không được lưu lại trong thân bài dưới dạng văn bản thuần túy
    const dt = buildDisplayText(st.src, st.urls, 'Illustration', 'drop');
    const want = dt ?? undefined;
    if (msg.extra.display_text === want) return false;
    if (dt) msg.extra.display_text = dt; else delete msg.extra.display_text;
    try {
        getContext().updateMessageBlock(messageId, { ...msg });
        scheduleHarden(messageId);
    } catch (err) {
        warn('Tái tạo hiển thị thất bại:', err);
    }
    return true;
}

async function rehydrateAll() {
    if (!s().enabled) return;
    if (isGenerating()) return; // Đang tạo văn bản thì không đụng vào DOM

    const ctx = getContext();
    const chat = ctx.chat ?? [];
    let touched = false;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        const st = msg.extra?.illust;
        if (!st || !Array.isArray(st.urls) || !st.src) continue;
        if (st.urls.length !== findMarkers(st.src).length) {
            // Số lượng marker không khớp (Thân bài bị chỉnh sửa thủ công) -> Xóa trạng thái hết hạn, để thân bài hiển thị theo văn bản gốc
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
    // Khi đổi chat / load thêm thì rà lại toàn bộ một lượt: Các tin nhắn có display_text không thay đổi sẽ không chạy qua rehydrateOne,
    // Nhưng các hình minh họa từ xa bên trong vẫn cần bổ sung referrerpolicy (Lần request đầu tiên có thể đã bị 403 do policy mặc định).
    scheduleHarden();
}

// -- Placeholder tại chỗ (Chỉ sửa đổi DOM, tuyệt đối không ghi vào lịch sử trò chuyện) --

/**
 * showPlaceholder Thay thế tại chỗ marker [ILLUST: ...] trong tin nhắn thành thông báo "Đang vẽ hình minh họa".
 *
 * Lý do chỉ sửa đổi DOM: Một khi placeholder bị ghi vào `mes`, nếu sinh ảnh thất bại hoặc f5 trang,
 * trong lịch sử trò chuyện sẽ lưu lại vĩnh viễn dòng text "Đang vẽ hình minh họa..." mà không có cơ chế nào để xóa nó đi.
 * Sau khi xuất ảnh xong, thông qua updateMessageBlock để render lại toàn bộ, placeholder sẽ bị thay thế bằng ảnh thật;
 * Khi thất bại, finishMessage cũng sẽ render lại một lần tương tự, placeholder biến mất, marker vẫn giữ nguyên trạng thái ban đầu trong thân bài.
 *
 * @returns {boolean} Tìm được vị trí chèn thành công hay không (Ở luồng xuất ảnh theo context, marker không nằm trong thân bài, sẽ trả về false,
 *                    bên gọi nên chuyển sang phương thức phản hồi khác)
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

// findLeafContaining Tìm kiếm phần tử lớp trong cùng "chứa đoạn marker này" (Thường chính là thẻ <p> đó) bên trong thân bài đã được render.
function findLeafContaining(root, needle) {
    if (!needle) return null;
    let fallback = null;
    for (const el of root.querySelectorAll('*')) {
        if (!el.textContent || !el.textContent.includes(needle)) continue;
        fallback = el;
        if (!el.querySelector('*')) return el; // Không có node con nào là element = Chính là cái block chứa đoạn text này
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
    return t.length > n ? `${t.slice(0, n)}...` : t;
}

// -- Tiêm system prompt --

function currentRule() {
    return ruleTemplate(s().max_per_round);
}

// syncPromptInjection Ghi quy tắc ILLUST vào nội dung sẽ được gửi cho model trong lần sinh text này.
//
// Vị trí tiêm sẽ quyết định trực tiếp việc model có làm theo hay không:
//   in_chat (Mặc định) - Nằm dưới dạng tin nhắn hệ thống chèn vào trước câu trả lời bên trong cuộc hội thoại (Độ sâu mặc định là 0).
//     Nằm chung mâm với các entry depth 0 của Worldbook/Thẻ nhân vật, là vị trí thu hút sự chú ý mạnh nhất của model.
//     Những thẻ "sandbox" hạng nặng sẽ nhét nguyên cả bộ template xuất text vào depth 0, nếu viết quy tắc ở trên cùng system prompt thì sẽ bị phớt lờ,
//     do đó mặc định sử dụng vị trí này.
//   in_prompt - Gộp vào system prompt chính. Vị trí nằm ở trên cùng, chỉ phù hợp hơn khi preset đã tự xử lý các ràng buộc định dạng.
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
            log('Quy tắc ILLUST đã được gộp vào system prompt chính');
        } else {
            setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_CHAT, c.inject_depth, false, extension_prompt_roles.SYSTEM);
            log(`Quy tắc ILLUST đã được chèn vào cuộc hội thoại (depth ${c.inject_depth})`);
        }
    } catch (err) {
        warn('Tiêm system prompt thất bại:', err);
    }
}

// -- Ngăn kéo extension (Chỉ giữ lại: Tên + Phiên bản + Mở Bảng quản lý) --
//
// Toàn bộ cài đặt đã được dọn sang Bảng quản lý (panel.html). inline-drawer của SillyTavern được thiết kế cho số lượng ít công tắc,
// Nhét hơn hai chục cái field vào đó sẽ làm cho layout quá dài và cực kỳ khó đọc.

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
                        <i class="fa-solid fa-sliders"></i><span>Mở Bảng quản lý</span>
                    </button>
                </div>
            </div>
        </div>
    </div>`;

    $('#extensions_settings2').append(html);
    $('#v_canvas_open_panel').on('click', openPanel);
}

// -- Bảng quản lý: Cửa sổ nổi Full màn hình + iframe + Cầu nối (Bridge) --
//
// WARN: Bảng điều khiển là một trang web độc lập, không thể truy cập vào context của SillyTavern: Không lấy được getContext(), cũng không thể import '/script.js'.
//       iframe sở hữu một thế giới JS độc lập, nếu load script.js bên trong đó sẽ khiến SillyTavern bị khởi tạo lần thứ hai
//       (Hai bộ chat, hai bộ hệ thống event).
//
// Do đó áp dụng mô hình cầu nối "Bảng quản lý chỉ phát lệnh, Extension chịu trách nhiệm thực thi":
//   Click trên bảng quản lý -> window.parent.__V_CANVAS_API__(action, payload)
//   -> Thực thể extension bên trong trang SillyTavern thực thi: Sửa đổi dữ liệu -> Làm mới DOM -> Lưu vào ổ đĩa
//   -> Trả về { ok, data } hoặc { ok: false, error }, bảng quản lý dựa vào đó để hiển thị kết quả
//
// Các action không có phản hồi sẽ bị coi là chưa có hiệu lực, không được phép im lặng thất bại.

const PANEL_ID = 'v_canvas_panel_overlay';
let panelKeyHandler = null;
let panelFitHandler = null;

// Chiều cao cửa sổ nổi được gán giá trị chính xác theo khung nhìn thực tế (visual viewport): Thanh địa chỉ trên trình duyệt mobile thu gọn/mở ra, xoay màn hình ngang/dọc đều sẽ làm thay đổi chiều cao thực tế.
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
                <span class="v_canvas_panel_title">Bảng quản lý V.Canvas</span>
                <div class="v_canvas_panel_actions">
                    <button class="menu_button" id="v_canvas_panel_newtab">Tab mới</button>
                    <button class="menu_button" id="v_canvas_panel_close">Đóng</button>
                </div>
            </div>
            <iframe id="v_canvas_panel_iframe" title="Bảng quản lý V.Canvas"></iframe>
            <div id="v_canvas_panel_fallback">
                <div class="v_canvas_panel_fallback_card">
                    <b>Bảng quản lý không thể hiển thị dạng nhúng</b>
                    <p>Môi trường duyệt web hiện tại có thể đã cấm các trang nhúng (Một số trình duyệt trên điện thoại và WebView trong app sẽ hạn chế iframe).
                       Hãy dùng thẻ tab mới để mở bảng quản lý, chức năng hoàn toàn giống với kiểu nhúng.</p>
                    <button class="menu_button" id="v_canvas_panel_fallback_open">Mở bảng quản lý trong Tab mới</button>
                </div>
            </div>
        </div>`);
    $('body').append(overlay);
    bindPanelFit(overlay[0]);

    installBridge();                 // Nối cầu xong rồi mới kết nối bảng quản lý, tránh việc bảng quản lý tự kiểm tra trước rồi báo "Chưa kết nối"
    const frame = overlay.find('#v_canvas_panel_iframe')[0];

    // Cổng mở ở tab mới: Trang bảng quản lý sẽ chuyển sang lấy hàm cầu nối từ window.opener, do đó vẫn có thể sử dụng bình thường.
    const openInNewTab = () => {
        const w = window.open(panelUrl(), '_blank');
        if (!w) overlay.find('#v_canvas_panel_fallback').addClass('show');
    };

    let loaded = false;
    frame.addEventListener('load', () => {
        // Khi chưa thiết lập src cũng sẽ trigger load một lần (about:blank), dựa vào việc body có rỗng hay không để phân biệt.
        try {
            const doc = frame.contentDocument;
            if (doc && doc.body && doc.body.childElementCount > 0) loaded = true;
        } catch {
            loaded = true; // Khi gặp cross-domain không thể đọc nội dung thì coi như đã load
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

// upstreamKind Mô tả loại tuyến trên hiển thị ở trang tổng quan.
function upstreamKind(base, model) {
    const b = String(base ?? '');
    if (!b) return 'Chưa cấu hình';
    if (model) return String(model);
    if (/127\.0\.0\.1|localhost|:8888/.test(b)) return 'V.Adapter';
    return 'Service NAI';
}

// collectImages Thu thập các hình minh họa đã tạo từ các tin nhắn trong cuộc trò chuyện hiện tại (Dùng cho ảnh thumbnail ở trang tổng quan).
// Đọc trực tiếp từ chat (Không dùng cache), thứ hiển thị trên bảng quản lý luôn luôn là trạng thái thực tế hiện tại.
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
                    // Model thực tế sẽ được dùng để phân tích lần này: Nếu là null chứng tỏ đã chọn tùy chỉnh nhưng cấu hình thiếu, hãy viết rõ ra,
                    // Tránh việc người dùng thấy "Đã bật" mà không biết tại sao lại chẳng có chuyện gì xảy ra.
                    const kind = ctxAnalyzer(c);
                    // Xuất trực tiếp thân bài sẽ không hiển thị tên model phân tích: Cái thứ đó vốn dĩ không được gọi trong lượt này,
                    // Hiển thị ra sẽ làm người ta tưởng là vẫn phải cấu hình nó.
                    const ctxActiveLabel = c.ctx_mode === 'direct'
                        ? 'Xuất trực tiếp (Không qua model phân tích)'
                        : (kind ? analyzerLabel(c, kind) : 'Model tùy chỉnh (Chưa điền địa chỉ hoặc tên model, sẽ không gửi request)');
                    return {
                        ok: true,
                        data: {
                            enabled: !!c.enabled,
                            version: VERSION,
                            upstreamKind: upstreamKind(c.base_url, c.model),
                            apiKeyMasked: maskKey(c.api_key) || '(Chưa thiết lập)',
                            ctxActiveLabel,
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
                    syncPromptInjection();          // Công tắc tổng / Công tắc tiêm có thể đã bị thay đổi cùng lúc
                    return { ok: true, data: { changed, notes, settings: after } };
                }

                case 'settings.reset': {
                    applyPatch(defaultSettings());
                    syncPromptInjection();
                    return { ok: true, data: { settings: { ...s() } } };
                }

                case 'rule':
                    return { ok: true, data: { rule: currentRule() } };

                // Lịch sử tạo ảnh: Danh sách persistence tách biệt với cuộc trò chuyện hiện tại.
                // Không gộp vào state - Trang tổng quan sẽ tự động poll (truy vấn định kỳ) mỗi 8 giây, nếu mang theo nó sẽ làm cho toàn bộ lịch sử bị truyền đi truyền lại nhiều lần.
                case 'history.list':
                    return { ok: true, data: { history: [...(s().history ?? [])].reverse() } };

                case 'history.clear': {
                    clearHistory();
                    return { ok: true, data: { count: 0 } };
                }

                // Thư viện chuỗi họa sĩ: Dữ liệu do người dùng tạo, đi qua action độc lập chứ không qua settings.patch -
                // Như vậy nó vừa không bị xóa sạch khi "Khôi phục mặc định", vừa không bị đè mất bởi các tác vụ submit cài đặt không liên quan.
                // Khi truyền vào active_artist sẽ đồng thời lưu vào ổ đĩa (Xóa đi cái đang dùng thì bắt buộc phải xóa rỗng mục đang chọn).
                case 'artist.save': {
                    const r = saveArtistPresets(payload?.list, { activeArtist: payload?.active_artist });
                    return { ok: true, data: { list: r.list, active_artist: r.activeArtist } };
                }

                case 'test': {
                    const c = s();
                    const message = await testConnection({
                        baseUrl: c.base_url, apiKey: c.api_key,
                        salt: c.exclusive_salt, signMode: c.sign_mode,
                    });
                    return { ok: true, data: { message } };
                }

                // Khả năng kết nối của kênh phân luồng: Bảng quản lý có thể chưa kịp lưu đã test ngay, nên cho phép nó truyền giá trị đang nằm trong form vào đây.
                case 'nsfw.test': {
                    const c = s();
                    const baseUrl = String(payload?.base_url ?? c.nsfw_base_url ?? '').trim();
                    const apiKey = String(payload?.api_key ?? c.nsfw_api_key ?? '');
                    if (!baseUrl) return { ok: false, error: 'Vui lòng điền địa chỉ service của kênh phân luồng trước' };
                    const message = await testConnection({
                        baseUrl, apiKey,
                        salt: c.exclusive_salt, signMode: c.sign_mode,
                    });
                    return { ok: true, data: { message } };
                }

                // Dịch thuật xuất ảnh: Service chuyển đổi sẽ mở rộng đoạn mô tả ngắn thành prompt hình ảnh hoàn chỉnh trước, sau đó mới vẽ.
                // Không ảnh hưởng đến quy trình vẽ ảnh minh họa tự động - Không ghi vào lịch sử trò chuyện, chỉ ném URL kết quả về lại cho bảng quản lý hiển thị.
                case 'translate.generate': {
                    const text = String(payload?.text ?? '').trim();
                    if (!text) return { ok: false, error: 'Vui lòng nhập mô tả' };

                    const c = s();
                    if (!c.base_url && !isLocalUpstream(c.base_url)) {
                        return { ok: false, error: 'Chưa cấu hình địa chỉ service NAI: Nếu đã cài V.Adapter sẽ tự động kết nối trực tiếp; Nếu chưa, vui lòng điền một địa chỉ service giao thức NovelAI' };
                    }

                    // "Kích thước tự động" phụ thuộc vào khả năng mở rộng của tuyến trên (expand=1 của V.Adapter).
                    // Khi địa chỉ không phải service chuyển đổi local thì quá trình mở rộng sẽ không diễn ra, lúc này phải lùi về dùng thông số xuất ảnh ở trang cài đặt, tránh việc báo cáo kích thước bằng 0.
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
                        salt: c.exclusive_salt,
                        signMode: c.sign_mode,
                    });

                    const ctx = getContext();
                    // url tồn tại = kết quả giáng cấp link từ xa của tuyến trên (Không có byte ảnh cục bộ), tham chiếu trực tiếp, không ghi xuống đĩa
                    const url = gen.url ?? await saveBase64AsFile(gen.base64, ctx.name2 || '', `translate_${Date.now()}`, gen.extension);
                    log(`Dịch thuật xuất ảnh hoàn tất -> ${url} (${followRecommended ? 'Theo kích thước dịch thuật đề xuất' : 'Kích thước trang cài đặt'})`);
                    return { ok: true, data: { url, prompt: gen.prompt || text } };
                }

                // Xuất ảnh theo context: Thử kết nối model phân tích
                case 'ctx.test': {
                    const c = s();
                    // Xuất trực tiếp thân bài không đi qua model phân tích, không có đối tượng để kết nối, để test.
                    if (c.ctx_mode === 'direct') {
                        return { ok: true, data: { message: 'Chế độ xuất trực tiếp không sử dụng model phân tích - Thân bài sẽ được gửi nguyên trạng cho tuyến trên xuất ảnh, không cần phải test' } };
                    }
                    // Khi đi theo API chính của SillyTavern thì không có chuyện "không kết nối được" - API chính có thể chat bình thường đồng nghĩa với việc khả dụng,
                    // Không cần thiết phải tốn thêm một lượt gọi vì chuyện này. Chỉ cần trả về tên model đang có hiệu lực là xong.
                    if (c.ctx_source !== 'custom') {
                        return { ok: true, data: { message: `Không cần test: Hiện đang đi theo ${describeMainApi().label}` } };
                    }
                    const message = await testAnalyzeModel({
                        baseUrl: c.ctx_url, apiKey: c.ctx_key, model: c.ctx_model,
                    });
                    return { ok: true, data: { message } };
                }

                // Xuất ảnh theo context / Xuất trực tiếp: Lập tức chạy một lượt đối với câu trả lời cuối cùng của nhân vật (Dùng để xác minh đường truyền, không cần đợi đến lượt chat tiếp theo)
                case 'ctx.generate': {
                    const c = s();
                    if (!c.base_url && !isLocalUpstream(c.base_url)) {
                        return { ok: false, error: 'Chưa cấu hình địa chỉ service NAI: Nếu đã cài V.Adapter sẽ tự động kết nối trực tiếp; Nếu chưa, vui lòng điền một địa chỉ service giao thức NovelAI' };
                    }
                    const ctx = getContext();
                    const chat = ctx.chat ?? [];
                    let id = -1;
                    for (let i = chat.length - 1; i >= 0; i--) {
                        const m = chat[i];
                        if (m && !m.is_user && !m.is_system && String(m.mes ?? '').trim()) { id = i; break; }
                    }
                    if (id < 0) return { ok: false, error: 'Trong cuộc trò chuyện hiện tại không có câu trả lời nào của nhân vật để có thể vẽ minh họa' };

                    const msg = chat[id];
                    const signal = beginRun();
                    try {
                        let items;
                        let direct = false;
                        let directAt = -1;
                        if (c.ctx_mode === 'direct') {
                            const gate = resolvePromptMode(c.prompt_format, c.base_url, c.upstream_type);
                            if (!directAppliesTo(gate)) {
                                const why = 'Hình thái gửi đi hiện tại đang bị phán đoán là "Chuỗi thẻ" (' + directBlockedReason(c) + ')'
                                    + ' - Nếu địa chỉ thực chất đang trỏ đến service chuyển đổi, vào trang "Cài đặt" chọn "Loại tuyến trên" thành adapter'
                                    + ' (Hoặc đổi "Hình thái prompt" thành description) là được';
                                finishProgress('Đã bỏ qua xuất trực tiếp: ' + why, true);
                                return { ok: false, error: why };
                            }
                            direct = true;
                            const body = stripMarkers(String(msg.mes ?? ''));
                            directAt = c.ctx_direct_place === 'end' ? -1 : pickProseAnchor(body);
                            items = [{
                                desc: buildDirectProse(body, {
                                    guide: c.ctx_direct_guide,
                                    work: workLabel(ctx),
                                    style: c.ctx_style,
                                    quality: c.ctx_quality,
                                    negative: c.ctx_negative,
                                }),
                            }];
                            showProgress('Đang vẽ hình minh họa ... Khoảng 30~60 giây');
                        } else {
                            const kind = ctxAnalyzer(c);
                            if (!kind) {
                                return { ok: false, error: 'Đã chọn model phân tích tùy chỉnh, vui lòng điền địa chỉ API và tên model trước; Muốn rảnh tay thì cứ chuyển về "Đi theo API chính của SillyTavern"' };
                            }
                            const maxImages = Math.min(6, Math.max(1, c.max_per_round | 0));
                            showProgress(`Đang phân tích thân bài... (Khoảng 10~30 giây, tối đa ${maxImages} ảnh)`);
                            items = await runCtxAnalyzer(kind, c, {
                                reply: stripMarkers(String(msg.mes ?? '')),
                                context: collectContext(chat, id),
                                work: workLabel(ctx),
                                max: maxImages,
                                signal,
                            });
                            if (!items.length) {
                                finishProgress('Kết quả phân tích rỗng: Không tìm thấy khung hình nào đáng để vẽ trong câu trả lời này', false);
                                return { ok: false, error: 'Model phân tích cho rằng câu trả lời này không có khung hình nào đáng để vẽ' };
                            }
                        }

                        // Khi thực thi lại, trước tiên phải dọn sạch trạng thái hình minh họa của tin nhắn trước đó, tránh việc ảnh mới đè lên ảnh cũ
                        if (msg.extra?.illust) { delete msg.extra.illust; delete msg.extra.illust_done; }
                        await runIllustration(ctx, id, msg, items, signal, { direct, at: directAt });

                        const urls = (msg.extra?.illust?.urls ?? []).filter(Boolean);
                        if (!urls.length) {
                            return { ok: false, error: 'Hình ảnh tạo không thành công (Xem chi tiết ở Lịch sử tạo ảnh và Console trình duyệt)' };
                        }
                        return { ok: true, data: { messageId: id, count: urls.length, prompts: items.map(it => it.desc || it.tags) } };
                    } catch (err) {
                        const em = truncateText(err?.message ?? String(err), 300);
                        finishProgress(`Thất bại: ${em}`, true);
                        return { ok: false, error: em };
                    } finally {
                        endRun();
                    }
                }

                default:
                    return { ok: false, error: `Không nhận diện được lệnh: ${action}` };
            }
        } catch (err) {
            const msg = truncateText(err?.message ?? String(err), 300);
            warn(`Bridge action ${action} thất bại:`, msg);
            return { ok: false, error: msg };
        }
    };
}

// -- Tự khởi động --
// Trình tải extension của SillyTavern chỉ chịu trách nhiệm mount <script type="module">, sẽ không tự gọi init(),
// Do đó sau khi module được tải xong, tự bản thân nó phải khởi tạo (Hành vi này giống với extension hệ thống chính thức và extension V.Adapter).
init().catch(err => console.error('[V.Canvas] Khởi tạo thất bại:', err));