// marker.js — Bắt, định vị và thay thế tại chỗ thẻ đánh dấu [ILLUST: Mô tả | Danbooru,Tags].
//
// Điểm chính trong thiết kế:
//   - Viết Regex mang tính khoan dung: Khoan dung cho dấu hai chấm full-width, thiếu `|`, thừa dấu cách, xuống dòng bên trong thẻ;
//   - Hai nửa của thẻ tương ứng với 2 loại hình thái input của tuyến trên (xem resolvePromptMode):
//       Danbooru Tags nằm sau `|`   -> Model Diffusion (NovelAI chính thức / NAI Gateway)
//       Mô tả tự nhiên nằm trước `|` -> Tuyến trên định dạng OpenAI (Model chat v.v.)
//     Cụ thể gửi phần nào đi do thiết lập prompt_format quyết định;
//   - Ghi lại index bắt đầu và kết thúc của mỗi thẻ trong nguyên văn, khi thay thế sẽ chèn tại chỗ theo index, không append vào cuối tin nhắn.

// Trên cơ sở cách viết tiêu chuẩn, nới lỏng `[^|\]\n]` thành `[^|\]]`, nhằm khoan dung cho việc xuống dòng bên trong thẻ.
export const ILLUST_RE = /\[ILLUST[:：]\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]/gi;

// Giới hạn chiều dài nguyên văn của một thẻ đơn: Vượt quá độ dài này cơ bản có thể khẳng định là Regex đã nuốt nhầm chính văn.
//
// WARN: Giá trị này bắt buộc phải lớn hơn độ dài tối đa của thẻ do analysis.js tạo ra (desc 700 + tags 400 + vỏ bọc ≈ 1114),
//       nếu không thì thẻ đánh dấu do luồng "Xuất ảnh từ ngữ cảnh" sinh ra sẽ bị ném bỏ nguyên dòng tại đây (im lặng, không báo lỗi).
//       Khi hai bên chênh nhau thì biểu hiện sẽ là "Phân tích thành công, không xuất tấm nào" và không hề báo lỗi.
//
// Export cho analysis.js sử dụng: Khi analysis.js ghép thẻ sẽ chừa lại một khoảng dựa trên giá trị này, tránh việc hai nơi viết hai con số khác nhau rồi không khớp nhau.
export const MAX_MARKER_LEN = 1800;

function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// hasMarkers Phán đoán nhanh xem trong text có thẻ đánh dấu hay không (Mỗi lần đều reset lastIndex, tránh việc Regex global làm ô nhiễm trạng thái).
export function hasMarkers(text) {
    const re = new RegExp(ILLUST_RE.source, 'gi');
    return re.test(String(text ?? ''));
}

/**
 * findMarkers Tìm tất cả các thẻ đánh dấu trong text, trả về theo thứ tự xuất hiện.
 *
 * Thuộc tính `prompt` là sự tổng hợp dự phòng (fallback) của nội dung hai đoạn trong thẻ (Ưu tiên Tags), chỉ dùng để hiển thị và ghi log;
 * input thực sự được gửi lên tuyến trên do selectPrompt() lắp ráp dựa theo prompt_format.
 *
 * @param {string} text
 * @returns {Array<{index:number,start:number,end:number,raw:string,desc:string,tags:string,prompt:string}>}
 */
export function findMarkers(text) {
    const src = String(text ?? '');
    const re = new RegExp(ILLUST_RE.source, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m[0].length > MAX_MARKER_LEN) continue;
        const desc = norm(m[1]);
        const tags = norm(m[2]);
        const prompt = tags || desc; // Chỉ dùng để hiển thị/ghi log, không tham gia vào việc chọn nội dung xuất ảnh
        if (!prompt) continue;       // Thẻ rỗng bỏ qua trực tiếp
        out.push({
            index: out.length,
            start: m.index,
            end: m.index + m[0].length,
            raw: m[0],
            desc,
            tags,
            prompt,
        });
        if (re.lastIndex <= m.index) re.lastIndex = m.index + 1; // Chống vòng lặp vô hạn độ rộng 0 (Zero-width infinite loop)
    }
    return out;
}

// -- Lựa chọn nội dung gửi đi (prompt_format) --
//
// Hai nửa của thẻ tương ứng với 2 loại hình thái input của tuyến trên:
//   - NovelAI chính thức / NAI Gateway sử dụng dữ liệu hệ Danbooru để train, nhãn là hình thái input hiệu quả nhất;
//   - Hình thái prompt của tuyến trên định dạng OpenAI (bao gồm model chat) là ngôn ngữ tự nhiên, xử lý chuỗi nhãn rất kém.
// Do đó phân luồng theo kênh: Địa chỉ local (V.Adapter và các dịch vụ adapter khác) đi đường mô tả, phần còn lại đi đường nhãn.

const LOCAL_UPSTREAM_RE = /127\.0\.0\.1|localhost|:8888/i;

// isLocalUpstream Địa chỉ có trỏ đến dịch vụ adapter ở máy cục bộ hay không (Luồng ①: Qua V.Adapter).
export function isLocalUpstream(baseUrl) {
    // Khi V.Adapter trên cùng một trang cung cấp bridge gọi API nội trang, đầu kia của bridge chính là dịch vụ adapter local:
    // Về mặt ngữ nghĩa thì nó tương đương với "Tuyến trên local" -- Gửi mô tả tự nhiên, hỗ trợ expand mở rộng prompt.
    if (typeof globalThis.__V_ADAPTER_NAI__ === 'function') return true;
    return LOCAL_UPSTREAM_RE.test(String(baseUrl ?? ''));
}

/**
 * resolvePromptMode Parse thiết lập prompt_format thành hình thái nội dung gửi đi cụ thể.
 * @param {string} format auto / description / tags / both
 * @param {string} baseUrl Địa chỉ tuyến trên hiện tại (Chỉ dùng cho mức auto)
 * @returns {'description'|'tags'|'both'}
 */
export function resolvePromptMode(format, baseUrl) {
    const f = String(format ?? 'auto');
    if (f === 'description' || f === 'tags' || f === 'both') return f;
    return isLocalUpstream(baseUrl) ? 'description' : 'tags';
}

/**
 * selectPrompt Chọn nội dung xuất phát lên tuyến trên từ thẻ đánh dấu dựa theo hình thái.
 * Ở bất kỳ mức nào, khi phần tương ứng bị thiếu sẽ fallback lại phần kia, tránh gửi đi chuỗi rỗng.
 *
 * @param {{desc?:string, tags?:string}} marker
 * @param {'description'|'tags'|'both'} mode
 * @returns {string}
 */
export function selectPrompt(marker, mode) {
    const desc = norm(marker?.desc);
    const tags = norm(marker?.tags);
    switch (mode) {
        case 'description': return desc || tags;
        case 'both': return [desc, tags].filter(Boolean).join(', ');
        case 'tags':
        default: return tags || desc;
    }
}

/**
 * stripMarkers Loại bỏ thẻ đánh dấu khỏi chính văn, tiện tay dọn dẹp luôn mấy dòng trắng để lại.
 * Dùng cho tính năng "Ảnh minh họa không đi vào ngữ cảnh": mes chỉ giữ lại văn bản thuần.
 * @param {string} text
 * @returns {string}
 */
export function stripMarkers(text) {
    const src = String(text ?? '');
    const markers = findMarkers(src);
    if (!markers.length) return src;
    let out = '';
    let cursor = 0;
    for (const m of markers) {
        out += src.slice(cursor, m.start);
        cursor = m.end;
    }
    out += src.slice(cursor);
    return out
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * effectiveSource Khôi phục "Nguyên văn hoàn chỉnh kèm thẻ đánh dấu", và làm rõ xem lần này chính văn bị thay đổi như thế nào.
 *
 * Ở lần trả lời đầu tiên, mes chính là nguyên văn; Khi viết tiếp (continue / append) SillyTavern sẽ làm thao tác `mes += Bài mới`,
 * mà ở lượt trước có thể chúng ta đã loại bỏ thẻ đánh dấu khỏi mes mất rồi, cho nên lúc này mes = Bài cũ đã bị loại bỏ + Bài mới.
 * Nhận diện ra trường hợp này thì nối ngược lại bản nguyên văn cũ, đảm bảo index của thẻ đánh dấu và URL khớp nhau 1:1 (Ảnh đã xuất rồi sẽ không bị vẽ lại).
 *
 * mode:
 *   'new'    -- Tin nhắn này chưa từng có trạng thái ảnh minh họa
 *   'same'   -- Chính văn không đổi (Chỉ là hiển thị chưa dán lên)
 *   'append' -- Đã viết tiếp vào phía sau chính văn cũ, thẻ đánh dấu cũ giữ nguyên tại chỗ
 *   'reset'  -- Chính văn bị đổi mới toàn bộ (Do swipe sang câu trả lời khác / Do người dùng sửa bằng tay) -> Trạng thái cũ bị hủy bỏ, bắt đầu ghép ảnh lại từ đầu
 *
 * @param {string} mes Chính văn hiện tại
 * @param {{src?:string}} [st] Trạng thái ảnh minh họa đã có
 * @returns {{src: string, mode: 'new'|'same'|'append'|'reset'}}
 */
export function effectiveSource(mes, st) {
    const text = String(mes ?? '');
    if (!st?.src) return { src: text, mode: 'new' };
    if (text === st.src) return { src: st.src, mode: 'same' };
    const strippedPrev = stripMarkers(st.src);
    if (text === strippedPrev) return { src: st.src, mode: 'same' };
    if (text.startsWith(strippedPrev)) {
        const tail = text.slice(strippedPrev.length);
        return tail ? { src: st.src + tail, mode: 'append' } : { src: st.src, mode: 'same' };
    }
    return { src: text, mode: 'reset' };
}

// encodeMdUrl Chuyển địa chỉ hình ảnh sang định dạng có thể nhúng vào Markdown.
//
// WARN: Địa chỉ do `saveBase64AsFile` trả về sẽ rơi vào thư mục lấy theo tên nhân vật, mà tên nhân vật **có thể chứa dấu cách,
//       dấu ngoặc v.v.**. Nếu nhét thẳng vào `![alt](url)` sẽ làm phân tích Markdown thất bại,
//       bức ảnh sẽ hiển thị dưới dạng **văn bản thuần (plain text)** trong chính văn (Tên nhân vật có chứa khoảng trắng hoặc ngoặc đơn là dính chưởng).
function encodeMdUrl(u) {
    try {
        return encodeURI(String(u ?? ''))
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29')
            .replace(/#/g, '%23');
    } catch {
        return String(u ?? '');
    }
}

/**
 * buildDisplayText Thay thế tại chỗ thẻ đánh dấu bằng ảnh markdown chiếm trọn dòng (block-level), sinh ra dòng text hiển thị "Chỉ cho người dùng xem".
 *
 * Đoạn văn bản A
 * ──────────
 * Đoạn văn bản B      <- Thẻ đánh dấu nằm ở đây
 * ──────────
 * [ Ảnh minh họa ]    <- Ảnh đứng một mình một dòng, chèn thẳng vào ngay dưới đoạn văn
 * ──────────
 * Đoạn văn bản C      <- Bị ảnh đùn xuống bên dưới tiếp tục xếp hàng
 *
 * pending quyết định xử lý "Những thẻ chưa xuất được ảnh" ra sao:
 *   'keep'   -- Giữ nguyên (Mặc định, dùng cho tự test offline và các scenario cần giữ nguyên văn)
 *   'drop'   -- Xóa khỏi tầng hiển thị
 *
 * WARN: Trong quá trình đang xuất ảnh và lúc dọn dẹp cuối cùng bắt buộc phải dùng 'drop'. Nếu giữ lại nguyên văn sẽ phơi bày cả đoạn prompt (cỡ vài trăm chữ)
 *       thẳng ra giữa chính văn: Khi tấm ảnh đầu tiên vừa ra lò, prompt của tấm thứ hai sẽ bị trộn chung với chính văn dưới dạng văn bản thuần,
 *       nhìn vào sẽ thấy "Ảnh thì không thấy, chỉ thấy phọt ra một nùi chữ".
 *
 * @param {string} src Chính văn gốc chứa thẻ
 * @param {Array<string|null>} urls URL của hình ảnh tương ứng 1:1 với thẻ đánh dấu (null = Tấm này vẫn chưa sinh ra)
 * @param {string} [alt='Illustration'] Đoạn text alt của hình ảnh
 * @param {'keep'|'drop'} [pending='keep'] Cách xử lý đối với những thẻ chưa xuất ảnh
 * @returns {string|null} Trả về đoạn text mới nếu có ít nhất một ảnh được thay thế thành công, nếu không trả về null (Bên gọi nên giữ nguyên dạng)
 */
export function buildDisplayText(src, urls, alt = 'Illustration', pending = 'keep') {
    const text = String(src ?? '');
    const markers = findMarkers(text);
    if (!markers.length) return null;
    // Dọn sạch khoảng trắng và dòng mới dính sát phía sau thẻ đánh dấu, tránh việc nhồi ra liên tiếp 3 dòng mới
    const skipTrailing = (i) => {
        let c = i;
        while (c < text.length && (text[c] === ' ' || text[c] === '\t')) c++;
        if (text[c] === '\n') c++;
        return c;
    };
    let out = '';
    let cursor = 0;
    let changed = false;
    for (const m of markers) {
        const url = urls?.[m.index];
        if (!url && pending === 'keep') continue; // Chưa xuất ảnh thành công -> Giữ nguyên thẻ đánh dấu không đụng vào

        out += text.slice(cursor, m.start);
        out = out.replace(/[ \t]+$/, '');   // Chỉ thu lại khoảng trắng trong dòng, xuống dòng thì để cho các nhánh bên dưới tự tính

        if (url) {
            out = out.replace(/\s+$/, '');  // Thu lại dòng trống do dòng chứa thẻ để lại
            out += `\n\n![${alt}](${encodeMdUrl(url)})\n\n`; // Ảnh chiếm nguyên dòng (Block-level), chèn ngay dưới đoạn văn đó
            cursor = skipTrailing(m.end);
        } else {
            // Xóa sổ bản thân cái thẻ, nhưng giữ lại cái dấu xuống dòng sát phía sau nó -- Nếu không 2 đoạn văn kề nhau sẽ bị dính lại thành một cục
            cursor = m.end;
            while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor++;
            if (text[cursor] === '\n') cursor++;
        }
        changed = true;
    }
    if (!changed) return null;
    return (out + text.slice(cursor)).replace(/\s+$/, '');
}