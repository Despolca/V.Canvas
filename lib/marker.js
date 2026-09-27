// marker.js - Bắt, định vị và thay thế tại chỗ đánh dấu [ILLUST: Mô tả | Danbooru,Tags].
//
// Điểm chính trong thiết kế:
//   - Regex viết rất khoan dung: Chấp nhận dấu hai chấm full-width, thiếu `|`, thừa khoảng trắng, xuống dòng bên trong đánh dấu;
//   - Hai nửa của đánh dấu tương ứng với hình thái đầu vào của hai loại tuyến trên (Xem resolvePromptMode):
//       Chuỗi Danbooru Tags sau `|`   -> Mô hình khuếch tán (NovelAI chính thức / Gateway NAI)
//       Mô tả ngôn ngữ tự nhiên trước `|` -> Tuyến trên định dạng OpenAI (Model chat v.v.)
//     Cụ thể gửi đi nửa nào do cài đặt prompt_format quyết định;
//   - Ghi lại index bắt đầu và kết thúc của mỗi đánh dấu trong nguyên văn, khi thay thế sẽ chèn tại chỗ theo index, không nối thêm vào cuối tin nhắn.

// Dựa trên cú pháp chuẩn, nới lỏng `[^|\]\n]` thành `[^|\]]` để chấp nhận dấu xuống dòng bên trong đánh dấu.
export const ILLUST_RE = /\[ILLUST[:：]\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]/gi;

// Giới hạn độ dài nguyên văn của một đánh dấu đơn lẻ: Vượt qua độ dài này cơ bản có thể khẳng định là Regex nuốt nhầm thân bài.
//
// WARN: Giá trị này bắt buộc phải lớn hơn độ dài tối đa của đánh dấu do analysis.js tạo ra (desc 700 + tags 400 + vỏ bọc ≈ 1114),
//       nếu không các đánh dấu được sinh ra từ luồng xuất ảnh theo context sẽ bị vứt bỏ toàn bộ tại đây (im lặng, không báo lỗi).
//       Biểu hiện khi hai bên không khớp nhau là "Phân tích thành công, xuất ảnh 0 lần" và không có bất kỳ báo lỗi nào.
//
// Export cho analysis.js sử dụng: Cái sau khi ghép đánh dấu sẽ để chừa lại phần dư dựa theo giá trị này, tránh việc hai nơi viết hai con số khác nhau rồi không khớp.
export const MAX_MARKER_LEN = 1800;

function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// hasMarkers Kiểm tra nhanh xem trong văn bản có đánh dấu hay không (Mỗi lần đều reset lastIndex, tránh việc state của Regex global làm ô nhiễm).
export function hasMarkers(text) {
    const re = new RegExp(ILLUST_RE.source, 'gi');
    return re.test(String(text ?? ''));
}

/**
 * findMarkers Tìm tất cả các đánh dấu trong văn bản, trả về theo thứ tự xuất hiện.
 *
 * Trường `prompt` là sự kết hợp dự phòng (fallback) của hai đoạn nội dung trong đánh dấu (Ưu tiên Tags), chỉ dùng để hiển thị và log;
 * input thực sự được gửi đi tuyến trên do selectPrompt() lắp ráp dựa theo prompt_format.
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
        const prompt = tags || desc; // Chỉ dùng để hiển thị/log, không tham gia vào việc chọn nội dung xuất ảnh
        if (!prompt) continue;       // Bỏ qua trực tiếp các đánh dấu rỗng
        out.push({
            index: out.length,
            start: m.index,
            end: m.index + m[0].length,
            raw: m[0],
            desc,
            tags,
            prompt,
        });
        if (re.lastIndex <= m.index) re.lastIndex = m.index + 1; // Chống lặp vô hạn ở match độ dài 0 (zero-width)
    }
    return out;
}

// -- Lựa chọn nội dung gửi đi (prompt_format) --
//
// Hai nửa của đánh dấu tương ứng với hình thái đầu vào của hai loại tuyến trên:
//   - NovelAI chính thức / Gateway NAI sử dụng dữ liệu hệ Danbooru để train, tag là hình thái đầu vào hiệu quả nhất;
//   - Hình thái prompt của tuyến trên định dạng OpenAI (Bao gồm model chat) là ngôn ngữ tự nhiên, xử lý chuỗi tag rất kém.
// Do đó phân luồng theo đường dẫn: Địa chỉ local (V.Adapter và các service chuyển đổi khác) gửi mô tả, còn lại gửi tag.

const LOCAL_UPSTREAM_RE = /127\.0\.0\.1|localhost|:8888/i;

// isLocalUpstream Địa chỉ có trỏ đến service chuyển đổi ở local hay không (Luồng ①: Đi qua V.Adapter).
export function isLocalUpstream(baseUrl) {
    // Khi V.Adapter trên cùng một trang mount cầu gọi nội bộ trang ra, đầu kia của cây cầu chính là service chuyển đổi local:
    // Về mặt ngữ nghĩa tương đương với "Tuyến trên local" - Gửi mô tả ngôn ngữ tự nhiên, hỗ trợ expand mở rộng prompt.
    if (typeof globalThis.__V_ADAPTER_NAI__ === 'function') return true;
    return LOCAL_UPSTREAM_RE.test(String(baseUrl ?? ''));
}

/**
 * resolvePromptMode Parse cài đặt prompt_format thành hình thái nội dung gửi đi cụ thể.
 *
 * upstreamType là loại tuyến trên do người dùng khai báo rõ ràng, có độ ưu tiên cao hơn việc đoán địa chỉ:
 * Địa chỉ có thể phân biệt "Service chuyển đổi local" và "Từ xa", nhưng **không thể phân biệt "Service chuyển đổi từ xa" và "Gateway NAI bên thứ ba"** -
 * Cả hai trông giống hệt nhau về mặt địa chỉ (Đều là tên miền từ xa). Service chuyển đổi deploy trên VPS sẽ bị đánh giá nhầm thành tuyến trên dạng tag,
 * người kết nối trực tiếp NAI chính thức thì ngược lại. Chuyện này chỉ có thể do người dùng khai báo, không thể đoán được.
 *
 * @param {string} format auto / description / tags / both
 * @param {string} baseUrl Địa chỉ tuyến trên hiện tại (Chỉ dùng khi ở mức auto + chưa khai báo loại tuyến trên)
 * @param {'auto'|'adapter'|'nai'} [upstreamType]
 * @returns {'description'|'tags'|'both'}
 */
export function resolvePromptMode(format, baseUrl, upstreamType = 'auto') {
    const f = String(format ?? 'auto');
    // Khi hình thái được chỉ định thủ công, loại tuyến trên không ảnh hưởng đến kết quả - Người dùng đã nói thẳng là muốn gửi nửa nào rồi
    if (f === 'description' || f === 'tags' || f === 'both') return f;
    const u = String(upstreamType ?? 'auto');
    if (u === 'adapter') return 'description';   // Service chuyển đổi / Model chat vẽ ảnh: Ăn ngôn ngữ tự nhiên
    if (u === 'nai') return 'tags';              // NAI chính thức / Gateway / Proxy bên thứ ba: Ăn chuỗi tag
    return isLocalUpstream(baseUrl) ? 'description' : 'tags';
}

/**
 * selectPrompt Lấy nội dung sẽ gửi đi tuyến trên từ đánh dấu theo hình thái.
 * Bất kỳ mức nào khi bị thiếu phần tương ứng sẽ lùi về (fallback) phần còn lại, tránh việc gửi đi chuỗi rỗng.
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
 * stripMarkers Loại bỏ đánh dấu khỏi thân bài, nhân tiện dọn dẹp sạch sẽ các dòng trống còn sót lại.
 * Dùng cho "Hình minh họa không đi vào context": mes chỉ giữ lại văn bản thuần túy.
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
 * effectiveSource Phục dựng lại "Nguyên văn đầy đủ chứa đánh dấu", đồng thời giải thích xem lần này thân bài đã thay đổi như thế nào.
 *
 * Khi trả lời lần đầu, mes chính là nguyên văn; Khi viết tiếp (continue / append), những gì SillyTavern làm là `mes += Văn bản mới`,
 * mà ở lượt trước chúng ta có thể đã loại bỏ đánh dấu khỏi mes rồi, nên lúc này mes = Văn bản cũ đã bị loại bỏ + Văn bản mới.
 * Nhận ra tình huống này thì ghép nguyên văn cũ trở lại, đảm bảo đánh dấu và index của URL tương ứng 1-1 (Ảnh đã xuất sẽ không bị vẽ lại).
 *
 * mode:
 *   'new'    - Tin nhắn này chưa từng có trạng thái hình minh họa
 *   'same'   - Thân bài không thay đổi (Chỉ là lớp hiển thị chưa được dán lên)
 *   'append' - Đã viết tiếp vào sau thân bài cũ, đánh dấu cũ được giữ nguyên tại chỗ
 *   'reset'  - Thân bài bị thay thế toàn bộ (swipe sang một câu trả lời khác / sửa đổi thủ công) -> Trạng thái cũ bị hủy bỏ, tạo lại ảnh
 *
 * @param {string} mes Thân bài hiện tại
 * @param {{src?:string}} [st] Trạng thái hình minh họa đã có
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

// encodeMdUrl Chuyển đổi địa chỉ ảnh thành dạng có thể nhúng vào Markdown.
//
// WARN: Địa chỉ trả về của `saveBase64AsFile` sẽ rơi vào thư mục được đặt tên theo tên nhân vật, mà tên nhân vật **có thể chứa dấu cách,
//       dấu ngoặc đơn và các ký tự khác**. Nếu nhét trực tiếp vào `![alt](url)` sẽ khiến Markdown phân tích thất bại,
//       ảnh sẽ xuất hiện trong thân bài dưới dạng **văn bản thuần túy** (Sẽ bị trigger ngay khi tên nhân vật chứa dấu cách hoặc dấu ngoặc).
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
 * buildDisplayText Thay thế tại chỗ đánh dấu thành ảnh Markdown cấp khối (block-level), tạo ra văn bản hiển thị "Chỉ cho người dùng xem".
 *
 * Đoạn văn bản A
 * ──────────
 * Đoạn văn bản B      <- Đánh dấu nằm ở đây
 * ──────────
 * [ Hình minh họa ]   <- Ảnh chiếm trọn một dòng, chèn ngay dưới đoạn văn đó
 * ──────────
 * Đoạn văn bản C      <- Bị ảnh đẩy xuống dưới để sắp xếp tiếp
 *
 * pending quyết định xử lý "Đánh dấu chưa xuất ảnh" như thế nào:
 *   'keep'   - Giữ nguyên trạng (Mặc định, dùng cho tự test offline và các trường hợp cần giữ nguyên văn)
 *   'drop'   - Gỡ bỏ khỏi lớp hiển thị
 *
 * WARN: Trong quá trình đang xuất ảnh và lúc dọn dẹp cuối cùng bắt buộc phải dùng 'drop'. Giữ lại nguyên văn sẽ khiến toàn bộ đoạn prompt (vài trăm chữ)
 *       bị phơi bày trực tiếp trong thân bài: Khi bức ảnh đầu tiên ra lò, prompt của bức ảnh thứ hai sẽ bị trộn lẫn vào thân bài dưới dạng văn bản thuần túy,
 *       cảm giác mang lại là "Ảnh chưa ra, chỉ thấy một đống chữ".
 *
 * @param {string} src Nguyên văn chứa đánh dấu
 * @param {Array<string|null>} urls URL ảnh tương ứng 1-1 với đánh dấu (null = Tấm này chưa tạo ra xong)
 * @param {string} [alt='Illustration'] Alt text của ảnh
 * @param {'keep'|'drop'} [pending='keep'] Cách xử lý đánh dấu chưa xuất ảnh
 * @returns {string|null} Trả về văn bản mới khi có ít nhất một ảnh được thay thế thành công, nếu không trả về null (Bên gọi nên giữ nguyên)
 */
export function buildDisplayText(src, urls, alt = 'Illustration', pending = 'keep') {
    const text = String(src ?? '');
    const markers = findMarkers(text);
    if (!markers.length) return null;
    // Dọn dẹp luôn cả khoảng trắng và dấu xuống dòng ngay sau đánh dấu, tránh việc xếp chồng 3 dấu xuống dòng liên tiếp
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
        if (!url && pending === 'keep') continue; // Xuất ảnh chưa thành công -> Giữ nguyên đánh dấu gốc

        out += text.slice(cursor, m.start);
        out = out.replace(/[ \t]+$/, '');   // Chỉ dọn khoảng trắng trong dòng, dấu xuống dòng để cho các nhánh bên dưới quyết định

        if (url) {
            out = out.replace(/\s+$/, '');  // Dọn dẹp dòng trống còn sót lại do dòng chứa đánh dấu để lại
            out += `\n\n![${alt}](${encodeMdUrl(url)})\n\n`; // Ảnh chiếm trọn một dòng (cấp khối), chèn ngay dưới đoạn văn đó
            cursor = skipTrailing(m.end);
        } else {
            // Loại bỏ bản thân đánh dấu, nhưng giữ lại dấu xuống dòng đi liền ngay sau nó - Nếu không hai đoạn văn kề nhau sẽ bị dính thành một cục
            cursor = m.end;
            while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor++;
            if (text[cursor] === '\n') cursor++;
        }
        changed = true;
    }
    if (!changed) return null;
    return (out + text.slice(cursor)).replace(/\s+$/, '');
}

// -- Nắn lại vị trí của đánh dấu (Redistribute) --
//
// Bối cảnh: Dưới luồng điều khiển bằng đánh dấu, vị trí của hình minh họa hoàn toàn do model cốt truyện quyết định - Plugin chỉ thay thế tại chỗ đánh dấu thành ảnh,
// chứ không di chuyển nó. Mà đa số các model khi viết nội dung có cấu trúc thường có thói quen vứt đống nó ở cuối câu trả lời, khiến cho hình minh họa biến thành "File đính kèm"
// thay vì là "Ảnh minh họa". Việc sửa prompt chỉ có thể làm thuyên giảm, không thể đảm bảo.
//
// Do đó bổ sung một bước nắn lại mang tính tất định ở phía plugin: Sau khi nhận diện được hình thái "Đánh dấu dồn cục ở cuối", sẽ trải đều các đánh dấu ra
// theo từng đoạn văn. Văn bản thuần túy không thay đổi một chữ nào (Kết quả của stripMarkers không đổi), chỉ thay đổi xem đánh dấu được chèn vào dưới đoạn văn nào.

// splitParagraphs Cắt đoạn, trả về [[start, end], ...] (Không bao gồm dấu xuống dòng dùng để ngăn cách).
//
// Phải nhận diện được cả hai cách viết phân đoạn:
//   Phân đoạn bằng dòng trống - `Đoạn 1\n\nĐoạn 2` (Cách viết mặc định của đa số model)
//   Phân đoạn bằng một dấu xuống dòng - `Đoạn 1\nĐoạn 2` (Cũng rất phổ biến, đặc biệt là model nội địa và các thẻ nhân vật mang template đầu ra)
// Nếu chỉ nhận diện dòng trống, thân bài dùng một dấu xuống dòng sẽ bị coi là "Một đoạn duy nhất", dẫn đến "Chỉ có một đoạn, không có chỗ để chèn",
// việc nắn lại vị trí sẽ mất tác dụng một cách im lặng - Bề ngoài công tắc đang bật nhưng không có gì xảy ra.
// Do đó trước tiên cắt theo dòng trống; Nếu không cắt ra được hai đoạn thì lùi về cắt theo một dấu xuống dòng.
function splitParagraphs(text) {
    const src = String(text ?? '');
    const cut = (re) => {
        const paras = [];
        let start = 0;
        let m;
        const r = new RegExp(re.source, 'g');
        while ((m = r.exec(src)) !== null) {
            paras.push([start, m.index]);
            start = m.index + m[0].length;
        }
        paras.push([start, src.length]);
        return paras.filter(([a, b]) => b > a);   // Bỏ đi các đoạn trống
    };
    const byBlank = cut(/\n[ \t]*\n/);
    if (byBlank.length >= 2) return byBlank;
    return cut(/\n/);
}

/**
 * isTailClustered Đánh giá xem tất cả đánh dấu có bị dồn cục ở cuối thân bài hay không.
 *
 * Tiêu chí: **Sau đánh dấu cuối cùng cơ bản là không còn thân bài nữa**, mà trước nó thì có một lượng nội dung đáng kể.
 * Đo lường dựa theo lượng "Thân bài còn lại bao nhiêu" chứ không đo lường theo "Index rơi vào phần trăm bao nhiêu của toàn bài" -
 * Cách sau sẽ tính luôn cả độ dài của bản thân đánh dấu vào mẫu số: Đánh dấu càng dài, ngưỡng (threshold) càng bị đẩy lùi về phía sau, ngược lại càng không đánh giá ra được.
 *
 * Chỉ có ý nghĩa khi có nhiều đoạn văn - Khi chỉ có một đoạn thì không có chỗ để chèn, không thể sửa và cũng không nên sửa.
 *
 * @param {string} text Nguyên văn chứa đánh dấu
 * @returns {boolean}
 */
export function isTailClustered(text) {
    const src = String(text ?? '');
    const markers = findMarkers(src);
    if (!markers.length) return false;
    if (splitParagraphs(stripMarkers(src)).length < 2) return false;

    const pure = (s) => String(s ?? '').replace(/\s+/g, '').length;
    const before = pure(src.slice(0, markers[0].start));
    const after = pure(src.slice(markers[markers.length - 1].end));
    if (before === 0) return false;                       // Thân bài nằm toàn bộ sau đánh dấu, không phải là "Dồn cục ở cuối"
    return after <= Math.min(30, before * 0.1);
}

/**
 * redistributeMarkers Trải đều các đánh dấu bị dồn cục ở cuối ra các đoạn văn.
 *
 * Công thức vị trí chèn: Đánh dấu thứ k (tổng cộng n cái) được chèn vào sau đoạn thứ `floor((k+1) * (p-1) / (n+1))`,
 * p là số lượng đoạn. Tử số dùng p-1 thay vì p, là để đảm bảo sau đánh dấu luôn còn thân bài -
 * Nếu không khi chỉ có 1 đánh dấu + 2 đoạn văn thì nó lại rơi về cuối bài, bằng hòa.
 *
 * Chỉ ra tay khi isTailClustered() là true; Các trường hợp còn lại trả về null, bên gọi giữ nguyên.
 * Phần văn bản thuần túy được giữ nguyên trạng, do đó sẽ không ảnh hưởng đến nội dung thân bài và context.
 *
 * @param {string} text Nguyên văn chứa đánh dấu
 * @returns {string|null} Nguyên văn sau khi sắp xếp lại; Không cần sửa đổi trả về null
 */
export function redistributeMarkers(text) {
    const src = String(text ?? '');
    const markers = findMarkers(src);
    if (!markers.length) return null;

    const body = stripMarkers(src);
    const paras = splitParagraphs(body);
    if (paras.length < 2) return null;          // Chỉ có một đoạn: Không có vị trí để chọn
    if (!isTailClustered(src)) return null;

    const n = markers.length;
    const p = paras.length;
    // Mỗi đánh dấu rơi vào sau đoạn văn nào (Index đoạn văn 0-based; chèn vào cuối đoạn văn đó)
    const slots = markers.map((_, k) => {
        const slot = Math.floor(((k + 1) * (p - 1)) / (n + 1));
        return Math.min(Math.max(slot, 0), p - 2);   // Kẹp lại, đảm bảo đằng sau vẫn còn thân bài
    });

    // Ký tự chèn tuân theo phong cách phân đoạn ban đầu của thân bài: Thân bài dùng dòng trống để phân đoạn thì chèn dòng trống, dùng một dấu xuống dòng thì chèn một dấu xuống dòng.
    // Nếu nhất loạt chèn dòng trống sẽ biến thân bài có một dấu xuống dòng thành có dòng trống - Layout của thân bài bị plugin âm thầm thay đổi.
    const sep = /\n[ \t]*\n/.test(body) ? '\n\n' : '\n';

    // Chèn từ sau ra trước, tránh việc nội dung chèn trước làm đẩy lệch index phía sau
    const order = slots
        .map((slot, k) => ({ slot, k }))
        .sort((a, b) => (b.slot - a.slot) || (b.k - a.k));

    let out = body;
    for (const { slot, k } of order) {
        const at = paras[slot][1];
        const head = out.slice(0, at).replace(/\s+$/, '');
        // Bản thân khoảng cách phân đoạn đã là dấu xuống dòng rồi, khoảng trắng ở đầu tail bắt buộc phải dọn đi,
        // nếu không sau đánh dấu sẽ xếp chồng một chuỗi dấu xuống dòng (Render ra sẽ là một đoạn trắng).
        const tail = out.slice(at).replace(/^\s+/, '');
        out = `${head}${sep}${markers[k].raw}${tail ? `${sep}${tail}` : ''}`;
    }
    return out;
}