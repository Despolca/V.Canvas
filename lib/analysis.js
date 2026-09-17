// analysis.js — Xuất ảnh từ ngữ cảnh: Do model text đọc chính văn để lấy prompt xuất ảnh, sau đó chuyển kết quả thành thẻ đánh dấu (marker).
//
// Module này chỉ làm logic thuần túy (Ghép prompt, parse JSON, chèn kết quả ngược lại vào chính văn), không phát sinh bất kỳ network request nào,
// cũng không phụ thuộc vào SillyTavern, do đó có thể tự test offline. Phần network xem llm-api.js.
//
// Ý đồ thiết kế: Luồng điều hướng bằng thẻ đánh dấu yêu cầu model cốt truyện phải chủ động phối hợp, gặp thẻ nhân vật có template output quá mạnh sẽ bị vô hiệu.
// Luồng này đổi thành: Xong việc rồi mới dùng model độc lập đọc chính văn, sau đó để plugin convert kết quả thành cùng một loại thẻ [ILLUST: ...],
// từ đó tái sử dụng được toàn bộ luồng xuất ảnh, thay thế tại chỗ, ghi nhận trạng thái và xem prompt đã có sẵn.

import { MAX_MARKER_LEN } from './marker.js';

// Giới hạn ký tự của riêng từng đoạn.
//
// WARN: Tổng của cả hai cộng với lớp vỏ của thẻ đánh dấu bắt buộc phải nhỏ hơn MAX_MARKER_LEN của marker.js --
//       cái sau là ranh giới bảo vệ "chống Regex nuốt nhầm chính văn", thẻ đánh dấu nào vượt qua nó sẽ bị vứt bỏ nguyên cả dòng.
//       Một khi tổng của cả hai vượt qua ranh giới bảo vệ, biểu hiện sẽ là "Phân tích thành công, xuất ảnh không lần nào, không báo lỗi".
//       Giới hạn trên được suy ra trực tiếp từ MAX_MARKER_LEN, không cần phải viết thêm một con số ở hai chỗ.
const MAX_DESC_LEN = 700;
const MAX_TAGS_LEN = 400;

// Khoảng dự phòng (reserve) chừa lại cho lớp vỏ ([ILLUST:  | ]) khi ghép thẻ đánh dấu.
const MARKER_SHELL_RESERVE = 50;

// Số lượng khung hình tối đa chấp nhận mỗi lượt (Đồng nhất với giới hạn trên của cài đặt).
const MAX_ITEMS = 6;

export const ANALYSIS_SYSTEM_PROMPT = `Bạn là một chỉ đạo mỹ thuật và storyboard minh họa. Người dùng sẽ cung cấp một đoạn chính văn tiểu thuyết, phần trước đó của nó, thông tin tác phẩm, và một bộ yêu cầu prompt xuất ảnh.
Trách nhiệm: Trước tiên xác định tác phẩm và thế giới quan của chính văn, sau đó chọn ra những khung hình đáng vẽ minh họa nhất từ trong đó,
và viết ra prompt có thể trực tiếp dùng để xuất ảnh theo định dạng cố định.

[Bước 1: Xác định tác phẩm và Art style]
- Dựa vào thông tin tác phẩm, phần tiền văn và các danh từ riêng trong chính văn, hãy xác định tác phẩm và thế giới quan của chính văn
  (Ví dụ "Naruto", "Liên Minh Huyền Thoại", hoặc một thế giới quan nguyên tác rõ ràng nào đó).
- Phong cách mỹ thuật của khung hình bắt buộc phải đồng nhất với tác phẩm đó, và phải được viết rõ ràng ở phần đầu của desc.
- Khi người dùng cung cấp yêu cầu về art style, lấy yêu cầu của người dùng làm chuẩn, không được thay thế bằng phong cách tự phán đoán.
- Nhân vật bắt buộc phải bám sát thiết lập của nguyên tác: Kiểu tóc, màu tóc, màu mắt, khuôn mặt, thể hình, trang phục và phụ kiện đặc trưng,
  không được tự suy diễn (ảo giác) thành thời trang hiện đại hay khuôn mặt mạng che (influencer) chung chung.
- Danh tính, trang phục và đạo cụ của nhân vật tự phán đoán dựa vào chính văn và phần tiền văn, không cần người dùng chỉ định từng cái một,
  cũng không được áp dụng các nhân vật ví dụ trong prompt của người dùng lên các nhân vật không liên quan.
- Bối cảnh, kiến trúc và đạo cụ phải phù hợp với thiết lập và bối cảnh thời đại của thế giới đó.

[Bước 2: Lựa chọn khung hình]
1. Mỗi khung hình xuất ra ba đoạn nội dung: desc, tags, anchor.
2. desc là một đoạn ngôn ngữ tự nhiên liền mạch, độ dài 500~600 chữ, không được viết sơ sài,
   Viết theo thứ tự cố định: "Tác phẩm và Art style -> Môi trường bối cảnh -> Nhân vật (Ngoại hình, trang phục, động tác, biểu cảm) -> Bố cục và góc máy -> Ánh sáng và bầu không khí".
3. tags là chuỗi nhãn Danbooru tiếng Anh, độ dài 300~400 ký tự, ngăn cách bằng dấu phẩy tiếng Anh,
   Xếp theo thứ tự "Chủ thể -> Ngoại hình -> Trang phục -> Động tác -> Bối cảnh -> Art style".
4. Prompt chất lượng tích cực, yêu cầu art style (nếu người dùng cung cấp) là ràng buộc cưỡng chế:
   desc và tags bắt buộc phải thể hiện được chất lượng hình ảnh, yếu tố và phong cách được yêu cầu trong đó.
5. Prompt phủ định (nếu người dùng cung cấp) là các mục loại trừ: Những nội dung được liệt kê trong đó không được xuất hiện trong desc và tags.
6. Lời lẽ và nhãn được đưa ra trong các prompt trên có thể được dùng lại trực tiếp; Khi cần bổ sung chi tiết thì tự bù đắp,
   nội dung bổ sung không được mâu thuẫn với các yêu cầu đã có.
7. anchor bắt buộc phải là đoạn trích xuất y hệt từ chính văn, không được viết lại hoặc viết tắt; Hình ảnh sẽ được chèn vào bên dưới đoạn văn chứa câu nói này.
8. Các khung hình bắt buộc phải tương ứng với các thời điểm khác nhau trong chính văn, anchor không được trùng lặp, cũng không được lấy từ các đoạn văn bản liền kề nhau.
9. anchor bắt buộc phải phân bổ đều dọc theo chính văn: Chia chính văn thành nhiều đoạn tương đương với số lượng khung hình, khung hình thứ k sẽ lấy từ đoạn thứ k,
   không được lấy toàn bộ từ phần đầu. Nếu chỉ có một khung hình, lấy từ đoạn có tính hình ảnh mạnh nhất, không được mặc định lấy đoạn đầu tiên.
10. Các đoạn hội thoại dày đặc hoặc không có tính hình ảnh thì không vẽ minh họa. Nếu toàn bộ chính văn đều không có khung hình nào vẽ được, hãy xuất ra array rỗng.

[Định dạng đầu ra]
Tuân thủ nghiêm ngặt output theo định dạng JSON dưới đây, không đính kèm bất kỳ văn bản giải thích nào, cũng không được bọc bằng khối code Markdown:
{"images":[{"desc":"...","tags":"...","anchor":"..."}]}`;

// sanitize Xóa sạch các ký tự làm hỏng cú pháp của thẻ đánh dấu (Thẻ phân đoạn bằng `|`, kết thúc bằng `]`), và giới hạn độ dài.
// Khi preferCommaBreak là true (Dùng cho chuỗi nhãn), nếu cắt ngắn vì quá dài sẽ lùi lại dấu phẩy gần nhất, tránh việc cắt đôi một từ.
function sanitize(s, maxLen, preferCommaBreak = false) {
    let t = String(s ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[|｜]/g, '/')
        .replace(/[[\]]/g, '')
        .trim();
    if (t.length > maxLen) {
        t = t.slice(0, maxLen);
        if (preferCommaBreak) {
            const c = t.lastIndexOf(',');
            if (c > 0) t = t.slice(0, c);
        }
    }
    return t;
}

// buildAnalysisMessages Lắp ráp (Assemble) các message cho request phân tích.
// reply là chính văn cần vẽ minh họa; context là chuỗi tóm tắt phần trước đó (Có thể để trống);
// meta.work là thông tin tác phẩm (Tên thẻ nhân vật v.v.);
// meta.style / meta.quality / meta.negative là art style, prompt chất lượng tích cực và prompt phủ định mà người dùng điền ở trang "Prompt"
// (Đều có thể để trống).
//
// Mỗi lần gọi đều là một bộ messages hai vòng hoàn toàn mới (system + một user), không mang theo lịch sử các lượt trước:
// Request phân tích là một "Cửa sổ dùng 1 lần", số chữ của chính văn chỉ phụ thuộc vào quy mô phần trước (context) được đóng gói lần này, không tích lũy theo số lượt đối thoại.
// meta.jb là từ khóa phá giới hạn do người dùng tự điền (có thể để trống): Ghép vào ngay đầu tin nhắn của user,
// Dành cho trường hợp model phân tích từ chối trả lời do chính văn có nội dung máu me / 18+, người dùng có thể tự inject thêm hướng dẫn bổ sung.
// Plugin này không tích hợp sẵn bất kỳ nội dung nào thuộc loại này.
export function buildAnalysisMessages(reply, context, max, meta = {}) {
    const n = Math.min(MAX_ITEMS, Math.max(1, parseInt(max, 10) || 1));
    const parts = [];
    const jb = String(meta.jb ?? '').trim();
    if (jb) parts.push(`[Hướng dẫn bổ sung]\n${jb}\n`);
    const work = String(meta.work ?? '').trim();
    if (work) parts.push(`[Thông tin tác phẩm]\n${work}\n`);
    const style = String(meta.style ?? '').trim();
    if (style) parts.push(`[Yêu cầu Art style]\n${style}\n`);
    const quality = String(meta.quality ?? '').trim();
    if (quality) parts.push(`[Prompt chất lượng tích cực]\n${quality}\n`);
    const negative = String(meta.negative ?? '').trim();
    if (negative) parts.push(`[Prompt phủ định]\n${negative}\n`);
    const ctx = String(context ?? '').trim();
    if (ctx) parts.push(`[Phần trước đó]\n${ctx}\n`);
    parts.push(`[Chính văn cần vẽ minh họa]\n${String(reply ?? '').trim()}\n`);
    parts.push(`Lần này xuất tối đa ${n} khung hình; Nếu chính văn không đủ để chống đỡ ${n} khung hình, hãy xuất theo số lượng có thể vẽ thực tế.`);
    return [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: parts.join('\n') },
    ];
}

/**
 * parseAnalysisJSON Phân tích (Parse) danh sách khung hình model trả về một cách khoan dung.
 * Khoan dung với việc bị bọc trong khối code Markdown, kẹp chữ giải thích ở đầu và cuối, hoặc cho luôn array ở tầng trên cùng.
 * @param {string} content
 * @returns {Array<{desc:string,tags:string,anchor:string}>}
 */
export function parseAnalysisJSON(content) {
    const text = String(content ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    let data = null;
    if (start >= 0 && end > start) {
        try { data = JSON.parse(text.slice(start, end + 1)); } catch { data = null; }
    }
    if (!data) {
        const s2 = text.indexOf('[');
        const e2 = text.lastIndexOf(']');
        if (s2 >= 0 && e2 > s2) {
            try { data = JSON.parse(text.slice(s2, e2 + 1)); } catch { data = null; }
        }
    }
    if (!data) return [];
    const raw = Array.isArray(data) ? data : (Array.isArray(data.images) ? data.images : []);
    const out = [];
    for (const it of raw) {
        if (!it || typeof it !== 'object') continue;
        const desc = sanitize(it.desc ?? it.description ?? '', MAX_DESC_LEN);
        const tags = sanitize(it.tags ?? '', MAX_TAGS_LEN, true);
        const anchor = String(it.anchor ?? it.quote ?? '').replace(/[\r\n]+/g, ' ').trim();
        if (!desc && !tags) continue;
        out.push({ desc, tags, anchor });
        if (out.length >= MAX_ITEMS) break;
    }
    return out;
}

// escapeRegExp Escape Regex.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * findAnchor Định vị anchor bên trong chính văn.
 * Tìm nguyên dạng trước; tìm không thấy thì tìm theo cách "gập khoảng trắng" (collapse whitespace) -- Trích dẫn của model và chính văn thường có
 * sự khác biệt về khoảng trắng/xuống dòng, phải khoan dung cho cả 2 hướng, do đó gập khoảng trắng trong anchor thành `\s*`.
 * @returns {number} Index trúng đích, không trúng trả về -1
 */
export function findAnchor(text, anchor) {
    const a = String(anchor ?? '').trim();
    if (!a) return -1;
    const direct = text.indexOf(a);
    if (direct >= 0) return direct;
    const pattern = a.split(/\s+/).map(escapeRegExp).join('\\s*');
    if (!pattern) return -1;
    const m = new RegExp(pattern).exec(text);
    return m ? m.index : -1;
}

// paragraphEnd Lấy index kết thúc của "Dòng chứa from" (Không bao gồm ký tự xuống dòng).
function paragraphEnd(text, from) {
    const nl = text.indexOf('\n', from);
    return nl < 0 ? text.length : nl;
}

/**
 * applyMarkers Chuyển danh sách khung hình thành thẻ đánh dấu, chèn vào ngay dưới đoạn văn chứa anchor.
 *
 * Output vẫn là chính văn bình thường, chỉ là có thêm dòng `[ILLUST: desc | tags]`; Khúc sau sẽ do luồng thẻ đánh dấu hiện có tiêu thụ
 * (Xuất ảnh -> Thay thế tại chỗ thành ảnh -> Chính văn không lưu lại chữ của prompt).
 *
 * Những khung hình không trúng anchor sẽ được đồng loạt chèn thêm vào cuối chính văn, không bị vứt bỏ.
 *
 * @param {string} text Chính văn
 * @param {Array<{desc:string,tags:string,anchor:string}>} items
 * @returns {string}
 */
export function applyMarkers(text, items) {
    const src = String(text ?? '');
    const list = Array.isArray(items) ? items : [];
    if (!list.length || !src.trim()) return src;

    const used = new Set();
    const placed = [];   // { at, line }
    const tail = [];     // Những cái không tìm thấy anchor

    for (const it of list) {
        const desc = sanitize(it?.desc, MAX_DESC_LEN);
        const tags = sanitize(it?.tags, MAX_TAGS_LEN, true);
        if (!desc && !tags) continue;

        // Dự phòng (Fallback): Rút ngắn cả 2 đoạn xuống độ dài không bị marker.js vứt bỏ (Thà cắt ngắn còn hơn vứt nguyên dòng)
        const limit = MAX_MARKER_LEN - MARKER_SHELL_RESERVE;
        let first = desc || tags;
        let second = tags || desc;
        while (`[ILLUST: ${first} | ${second}]`.length > limit) {
            if (second.length >= first.length && second.length > 0) second = second.slice(0, -1);
            else if (first.length > 0) first = first.slice(0, -1);
            else break;
        }
        const line = `[ILLUST: ${first} | ${second}]`;

        const anchor = String(it?.anchor ?? '').trim();
        let at = -1;
        if (anchor) {
            at = findAnchor(src, anchor);
            if (at >= 0) {
                // Một vị trí chỉ giữ 1 ảnh: Khi model trích dẫn lặp lại cùng một đoạn văn bản, mấy cái dư thừa vứt thẳng tay,
                // không được ném xuống cuối bài (nếu không sẽ dồn một đống ảnh minh họa vô chủ ở cuối tin nhắn).
                if (used.has(at)) continue;
                used.add(at);
            }
        }
        if (at < 0) { tail.push(line); continue; }
        placed.push({ at: paragraphEnd(src, at), line });
    }

    if (!placed.length && !tail.length) return src;

    placed.sort((a, b) => a.at - b.at);
    let out = '';
    let cursor = 0;
    for (const p of placed) {
        out += src.slice(cursor, p.at) + `\n${p.line}`;
        cursor = p.at;
    }
    out += src.slice(cursor);

    if (tail.length) out = out.replace(/\s+$/, '') + '\n\n' + tail.join('\n');
    return out;
}