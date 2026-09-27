// analysis.js - Xuất ảnh theo context: Do model văn bản đọc thân bài để lấy prompt xuất ảnh, sau đó chuyển kết quả thành đánh dấu (marker).
//
// Module này chỉ xử lý thuần logic (ghép prompt, parse JSON, chèn kết quả trở lại thân bài), không phát sinh bất kỳ request mạng nào,
// cũng không phụ thuộc vào SillyTavern, do đó có thể tự test offline. Phần mạng xem ở llm-api.js.
//
// Ý đồ thiết kế: Luồng điều khiển bằng đánh dấu yêu cầu model cốt truyện chủ động phối hợp, gặp phải thẻ nhân vật có template đầu ra cực mạnh sẽ mất tác dụng.
// Luồng này đổi thành việc để một model độc lập đọc thân bài sau đó, rồi do plugin chuyển kết quả thành đánh dấu [ILLUST: ...] tương tự,
// từ đó tái sử dụng lại toàn bộ luồng xuất ảnh, thay thế tại chỗ, ghi trạng thái và xem prompt đã có sẵn.

import { MAX_MARKER_LEN } from './marker.js';

// Giới hạn ký tự của riêng hai đoạn.
//
// WARN: Tổng của hai đoạn cộng với vỏ đánh dấu bắt buộc phải nhỏ hơn MAX_MARKER_LEN của marker.js -
//       Cái sau là ranh giới bảo vệ "Chống Regex nuốt nhầm thân bài", đánh dấu nào vượt qua nó sẽ bị vứt bỏ toàn bộ.
//       Một khi tổng của hai đoạn vượt qua ranh giới bảo vệ, biểu hiện sẽ là "Phân tích thành công, xuất ảnh không lần nào, không có báo lỗi".
//       Giới hạn được suy ra trực tiếp từ MAX_MARKER_LEN, hai nơi không viết riêng thành hai con số nữa.
const MAX_DESC_LEN = 700;
const MAX_TAGS_LEN = 400;

// Phần dư chừa lại cho vỏ đánh dấu ([ILLUST:  | ]) khi ghép đánh dấu.
const MARKER_SHELL_RESERVE = 50;

// Giới hạn số lượng khung hình tối đa chấp nhận mỗi lượt (Đồng nhất với giới hạn giá trị của mục cài đặt).
const MAX_ITEMS = 6;

/**
 * resolveCtxSource Parse "Nguồn model phân tích" trong cài đặt thành implementation thực tế sẽ dùng trong lượt này.
 *
 * Hai luồng phân tích (Theo API chính của SillyTavern / Service tùy chỉnh) đều rẽ nhánh từ kết quả này,
 * và nó quyết định "Lượt này rốt cuộc có gửi request hay không" - Do đó đặt ở module này (không phụ thuộc SillyTavern, có thể Unit Test offline),
 * do Unit Test khóa cứng ba loại kết quả, tránh việc sau này sửa đổi lại âm thầm biến thành "Cấu hình thiếu vẫn cứ gửi".
 *
 * @param {string} source 'main' | 'custom' (settings.js đã đảm bảo chỉ có thể là hai giá trị này)
 * @param {{url?:string, model?:string}} cfg
 * @returns {'main'|'custom'|null} null = Chọn tùy chỉnh nhưng không điền địa chỉ hoặc tên model, lượt này không gửi request
 */
export function resolveCtxSource(source, cfg = {}) {
    if (source !== 'custom') return 'main';
    const url = String(cfg.url ?? '').trim();
    const model = String(cfg.model ?? '').trim();
    return (url && model) ? 'custom' : null;
}

export const ANALYSIS_SYSTEM_PROMPT = `Bạn là một chỉ đạo nghệ thuật và storyboard minh họa. Người dùng sẽ cung cấp một đoạn thân bài tiểu thuyết, phần trước của nó, thông tin tác phẩm, cùng một bộ yêu cầu prompt xuất ảnh.
Nhiệm vụ: Trước tiên xác định tác phẩm và thế giới quan mà thân bài thuộc về, sau đó chọn ra khung hình đáng vẽ minh họa nhất từ trong đó,
và viết ra prompt có thể dùng trực tiếp để xuất ảnh theo định dạng cố định.

【Bước một: Xác định tác phẩm và phong cách vẽ】
- Dựa vào thông tin tác phẩm, phần trước và các danh từ riêng trong thân bài, xác định tác phẩm và thế giới quan mà thân bài thuộc về
  (ví dụ "Naruto", "Liên Minh Huyền Thoại", hoặc một thế giới quan nguyên bản rõ ràng).
- Phong cách mỹ thuật của khung hình bắt buộc phải nhất quán với tác phẩm đó, và viết rõ ra ở đầu của desc.
- Khi người dùng cung cấp yêu cầu phong cách vẽ, lấy yêu cầu của người dùng làm chuẩn, không được thay thế bằng phong cách tự xác định.
- Nhân vật bắt buộc phải phục dựng thiết lập gốc: Kiểu tóc màu tóc, màu mắt, khuôn mặt, thể hình, trang phục và phụ kiện đặc trưng,
  không được tự tưởng tượng thành thời trang hiện đại hoặc khuôn mặt hotgirl mạng (internet celebrity face) chung chung.
- Danh tính, trang phục và đạo cụ của nhân vật tự đánh giá dựa theo thân bài và phần trước, không cần người dùng chỉ định từng cái một,
  cũng không nên áp dụng nhân vật ví dụ trong prompt của người dùng lên các nhân vật không liên quan.
- Cảnh vật, kiến trúc và đạo cụ phải phù hợp với bối cảnh và thời đại của thế giới đó.

【Bước hai: Chọn khung hình】
1. Mỗi khung hình xuất ra ba đoạn nội dung: desc, tags, anchor.
2. desc là một đoạn ngôn ngữ tự nhiên mạch lạc, độ dài 500~600 chữ, không được tóm tắt sơ sài,
   viết theo thứ tự cố định: "Tác phẩm và phong cách vẽ -> Môi trường cảnh vật -> Nhân vật (Ngoại hình, trang phục, hành động, biểu cảm) -> Bố cục và góc máy -> Ánh sáng và bầu không khí".
   **Hành động của nhân vật và tương tác cơ thể bắt buộc phải trung thành với thân bài và viết đầy đủ**: Các hành động thực tế xảy ra rõ ràng trong thân bài (làm tình, khẩu giao,
   chèn vào, vuốt ve, hôn các bộ phận cơ thể v.v.) bắt buộc phải viết cụ thể trong desc, cấm bỏ sót, giảm nhẹ hoặc giáng cấp thành
   khung hình thông thường (ôm, nhìn nhau, kề vai, hôn bình thường); Thân bài viết chi tiết đến đâu thì viết chi tiết đến đó, thà phóng đại chứ không thu hẹp.
3. tags là chuỗi thẻ Danbooru tiếng Anh, độ dài 300~400 ký tự, ngăn cách bằng dấu phẩy tiếng Anh,
   sắp xếp theo thứ tự "Chủ thể -> Ngoại hình -> Trang phục -> Hành động -> Cảnh vật -> Phong cách vẽ".
   Hành động và các bộ phận cơ thể bắt buộc phải viết cụ thể: Các hành động thực tế xảy ra trong khung hình, các bộ phận cơ thể liên quan và mối quan hệ tiếp xúc
   lần lượt chuyển thành các thẻ Danbooru chính xác (như kissing, hugging, groping, handjob, fellatio,
   cunnilingus, spread legs, breasts, nipples v.v.), tương ứng 1-1 với nội dung thực tế xảy ra trong thân bài tại thời điểm đó;
   Không được dùng các từ khóa phân loại độ tuổi chung chung như nsfw, nude, sex để thay thế cho khung hình cụ thể, từ khóa chung chung tối đa chỉ được dùng làm giải thích bổ sung.
   **Số lượng tag: Càng nhiều càng tốt, ít nhất 50 tag, lý tưởng 50~60 tag** (Chủ thể 1~2, Ngoại hình 8~12,
   Trang phục 8~12, Hành động và bộ phận cơ thể 15~25, Cảnh vật 4~6, Phong cách vẽ 4~6), cố gắng để độ dài chuỗi thẻ sát với
   300~400 ký tự; Cấm dùng chuỗi ngắn lèo tèo dưới mười mấy tag để làm qua loa, trang phục nhân vật, động tác tay chân, biểu cảm,
   chi tiết cảnh vật, ánh sáng bầu không khí cố gắng chia nhỏ ra, thà nhiều chứ không ít, có thể viết chi tiết đến đâu thì viết đến đó.
   **Bắt buộc phải trung thành với thân bài, cấm giáng cấp:** Các hành động, bộ phận cơ thể, quan hệ tiếp xúc và tương tác được viết rõ ràng trong thân bài,
   desc và tags bắt buộc phải phản ánh nguyên vẹn và đầy đủ - Thân bài viết làm tình/chèn vào/khẩu giao, thì viết hành động và bộ phận tương ứng,
   tuyệt đối không được vì "Kín đáo, tính thẩm mỹ, tính hình ảnh" mà bỏ sót, giảm nhẹ hoặc đổi thành khung hình thông thường (ôm, nhìn nhau, kề vai, hôn bình thường).
   Bỏ sót hoặc giáng cấp nội dung đã xảy ra rõ ràng trong thân bài = Lỗi nghiêm trọng. Thà phóng đại, không được thu hẹp; Thân bài viết chi tiết đến đâu, prompt viết chi tiết đến đó.
4. Prompt chất lượng tích cực, yêu cầu phong cách vẽ (Nếu người dùng cung cấp) là ràng buộc bắt buộc:
   desc và tags bắt buộc phải thể hiện chất lượng hình ảnh, yếu tố và phong cách được yêu cầu trong đó.
5. Prompt tiêu cực (Nếu người dùng cung cấp) là mục loại trừ: Các nội dung được liệt kê trong đó không được xuất hiện trong desc và tags.
6. Các từ ngữ và thẻ được cung cấp trong các prompt trên có thể trực tiếp sử dụng lại; Tự bổ sung khi cần thêm chi tiết,
   nội dung bổ sung không được xung đột với các yêu cầu đã có.
7. anchor bắt buộc phải là trích dẫn nguyên văn từ thân bài, không được viết lại hoặc viết tắt; Hình ảnh sẽ được chèn vào ngay dưới đoạn văn chứa câu đó.
8. Mỗi khung hình bắt buộc phải tương ứng với các thời điểm khác nhau trong thân bài, anchor không được lặp lại, cũng không được lấy từ các đoạn văn liền kề.
9. anchor bắt buộc phải phân bố đều đặn dọc theo thân bài: Chia thân bài thành nhiều đoạn bằng nhau theo số lượng khung hình, khung hình thứ k lấy từ đoạn thứ k,
   không được lấy tất cả từ phần mở đầu. Khi chỉ có một khung hình, lấy từ đoạn có tính hình ảnh mạnh nhất, không được mặc định lấy đoạn đầu tiên.
10. Các đoạn văn đối thoại dày đặc hoặc không có tính hình ảnh thì không vẽ. Nếu toàn bộ thân bài đều không có khung hình nào có thể vẽ được, xuất ra mảng rỗng.

【Định dạng đầu ra】
Xuất ra chuẩn xác JSON sau, không được đính kèm bất kỳ chữ giải thích nào, cũng không được bọc bằng Markdown Code Block:
{"images":[{"desc":"...","tags":"...","anchor":"..."}]}`;

// sanitize Xóa bỏ các ký tự sẽ phá vỡ cú pháp đánh dấu (Đánh dấu phân đoạn bằng `|`, kết thúc bằng `]`), và giới hạn độ dài.
// preferCommaBreak là true (Dùng cho chuỗi tag), khi vượt quá độ dài sẽ cắt lùi về dấu phẩy trước đó, tránh cắt đôi một từ.
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

// analysisTokenBudget Ngân sách đầu ra cho một lần request phân tích (Số lượng token).
// Mỗi khung hình khoảng 500~600 chữ mô tả + 300~400 ký tự thẻ, tiếng Trung tính mỗi chữ 1~1.5 token,
// Một khung hình khoảng 1200 token. Giới hạn cứng sẽ làm đứt đoạn JSON ở khung hình thứ hai,
// Biểu hiện là "Phân tích thành công nhưng không xuất ra một bức ảnh nào, không báo lỗi". Do đó nhân lên theo số lượng khung hình, rồi mới đóng trần (cap).
// Hai luồng phân tích (Service tùy chỉnh / API chính của SillyTavern) dùng chung giá trị này, tránh việc hai nơi viết hai con số khác nhau rồi không khớp.
export function analysisTokenBudget(max) {
    const n = Math.max(1, parseInt(max, 10) || 1);
    return Math.min(8192, 1200 * n + 600);
}

/**
 * buildAnalysisParts Ghép nối hai đoạn nội dung của request phân tích.
 *
 * Cùng nguồn gốc với buildAnalysisMessages: Hàm kia chỉ chịu trách nhiệm bọc nó thành mảng messages của OpenAI,
 * trong khi luồng đi qua API chính của SillyTavern cần hai chuỗi "System prompt + Một tin nhắn User", do đó export riêng.
 *
 * reply là thân bài cần vẽ minh họa; context là chuỗi tóm tắt phần trước (Có thể rỗng);
 * meta.work là thông tin tác phẩm (Tên thẻ nhân vật v.v.);
 * meta.style / meta.quality / meta.negative là phong cách vẽ,
 * prompt chất lượng tích cực và prompt tiêu cực do người dùng điền ở trang "Prompt" (Đều có thể rỗng).
 * meta.jb là từ phá giới hạn do người dùng tự điền (Có thể rỗng), ghép vào trước tin nhắn user,
 * dùng làm giải thích bổ sung do người dùng tự chèn vào khi model phân tích từ chối trả lời đối với thân bài máu me / người lớn.
 * Plugin này không tích hợp sẵn bất kỳ nội dung nào thuộc loại này.
 * meta.nsfw là boolean: Thân bài lần này đã hit điều kiện phân luồng NSFW, sẽ đi qua kênh xuất ảnh người lớn chuyên biệt.
 * Lúc này khung hình bắt buộc phải rơi vào **đúng thời điểm người lớn trong thân bài** - Vị trí do model phân tích tự đánh giá theo ngữ nghĩa
 * (Đoạn đầu / Đoạn giữa / Đoạn cuối đều có thể, thân bài viết sao thì vẽ vậy), không được chọn
 * đoạn lót đường (buildup) đời thường hoặc đối thoại theo tiêu chí "Tính hình ảnh mạnh nhất". Đã phân luồng vào kênh người lớn thì bức ảnh này phải vẽ nội dung người lớn.
 * meta.nsfwMix là sự kết hợp nội dung của kênh phân luồng ('daily_nsfw' | 'nsfw_only'):
 *   daily_nsfw = Khi xuất hai ảnh: Một ảnh đời thường + Một ảnh NSFW (Khi nsfw_max=1 thì thoái hóa thành chỉ xuất NSFW);
 *   nsfw_only  = Toàn bộ khung hình đều là NSFW.
 * meta.nsfwDailyPlace là vị trí khung hình của "Bức ảnh đời thường đó" ('auto'|'front'|'middle'|'end'),
 * model phân tích sẽ dựa vào đó để chọn một thời điểm không phải người lớn từ phân đoạn tương ứng của thân bài; Bức ảnh NSFW thì luôn được quyết định bằng đánh giá ngữ nghĩa.
 *
 * @returns {{system:string, user:string}}
 */
export function buildAnalysisParts(reply, context, max, meta = {}) {
    const n = Math.min(MAX_ITEMS, Math.max(1, parseInt(max, 10) || 1));
    const parts = [];
    const jb = String(meta.jb ?? '').trim();
    if (jb) parts.push(`【Giải thích bổ sung】\n${jb}\n`);
    const work = String(meta.work ?? '').trim();
    if (work) parts.push(`【Thông tin tác phẩm】\n${work}\n`);
    const style = String(meta.style ?? '').trim();
    if (style) parts.push(`【Yêu cầu phong cách vẽ】\n${style}\n`);
    const quality = String(meta.quality ?? '').trim();
    if (quality) parts.push(`【Prompt chất lượng tích cực】\n${quality}\n`);
    const negative = String(meta.negative ?? '').trim();
    if (negative) parts.push(`【Prompt tiêu cực】\n${negative}\n`);
    const ctx = String(context ?? '').trim();
    if (ctx) parts.push(`【Phần trước】\n${ctx}\n`);
    // nsfw: Thân bài lần này đã hit điều kiện phân luồng NSFW, sẽ đi qua kênh xuất ảnh người lớn chuyên biệt.
    // Khung hình bắt buộc phải rơi vào đúng thời điểm người lớn - Vị trí do model phân tích đánh giá theo ngữ nghĩa, không dùng từ khóa để chọn đoạn cứng nhắc
    // (Bố cục thân bài thế nào cũng có thể: Đoạn đầu lót đường, đoạn giữa cao trào, đoạn cuối dư âm; cũng có thể từ đầu đến cuối toàn là nội dung người lớn).
    if (meta.nsfw) {
        const mix = meta.nsfwMix === 'nsfw_only' ? 'nsfw_only' : 'daily_nsfw';
        const wantDaily = mix === 'daily_nsfw' && n >= 2;
        const dailyPlace = ['front', 'middle', 'end'].includes(meta.nsfwDailyPlace)
            ? meta.nsfwDailyPlace : 'auto';
        const placeHint = dailyPlace === 'auto'
            ? 'Vị trí không giới hạn, do bạn tự chọn một thời điểm không phải người lớn'
            : ({ front: 'Lấy từ đoạn đầu thân bài', middle: 'Lấy từ đoạn giữa thân bài', end: 'Lấy từ đoạn cuối thân bài' })[dailyPlace];
        if (wantDaily) {
            parts.push(`【Yêu cầu khung hình lần này】\nThân bài lần này đã được xác định là nội dung người lớn (NSFW), sẽ đi qua kênh xuất ảnh người lớn chuyên biệt.`
                + `Lần này xuất ra tổng cộng ${n} tấm: Trong đó **1 tấm là khung hình đời thường** (Nội dung không phải người lớn, ${placeHint}, `
                + `không được chứa hành vi người lớn), **${n - 1} tấm còn lại là khung hình người lớn** (Chính là thời điểm thực sự xảy ra `
                + `hành vi thân mật / người lớn, vị trí do bạn tự đánh giá theo ngữ nghĩa, đoạn đầu, đoạn giữa hay đoạn cuối đều có thể).`
                + `Khung hình người lớn không được vì "Tính hình ảnh mạnh" mà chọn đoạn lót đường đời thường hoặc đối thoại bình thường;`
                + `Khung hình đời thường không được vì lười biếng mà trộn lẫn nội dung người lớn.\n`);
        } else if (mix === 'nsfw_only') {
            parts.push(`【Yêu cầu khung hình lần này】\nThân bài lần này đã được xác định là nội dung người lớn (NSFW), sẽ đi qua kênh xuất ảnh người lớn chuyên biệt.`
                + `Lần này xuất ra tổng cộng ${n} tấm, **Tất cả bắt buộc phải là khung hình người lớn** - Tương ứng với các thời điểm khác nhau trong thân bài `
                + `thực sự xảy ra hành vi thân mật / người lớn (Vị trí do bạn tự đánh giá theo ngữ nghĩa, đoạn đầu, đoạn giữa hay đoạn cuối đều có thể),`
                + `không được vì "Tính hình ảnh mạnh" mà chọn đoạn lót đường đời thường, đối thoại bình thường hoặc nội dung không phải người lớn làm chủ thể khung hình.\n`);
        } else {
            parts.push(`【Yêu cầu khung hình lần này】\nThân bài lần này đã được xác định là nội dung người lớn (NSFW), sẽ đi qua kênh xuất ảnh người lớn chuyên biệt.`
                + `Vui lòng đọc toàn bộ thân bài, tự xác định **thời điểm thực sự xảy ra hành vi thân mật / người lớn trong đó** (Vị trí không giới hạn, `
                + `đoạn đầu, đoạn giữa hay đoạn cuối đều có thể), khung hình bắt buộc phải lấy từ thời điểm đó;`
                + `không được vì "Tính hình ảnh mạnh" mà chọn đoạn lót đường đời thường, đối thoại bình thường hoặc nội dung không phải người lớn làm chủ thể khung hình.`
                + `Nếu thân bài thực sự có thời điểm người lớn, thì vẽ trực tiếp nó; Nếu không có hành vi người lớn, chọn khung hình thân mật nhất.\n`);
        }
    }
    parts.push(`【Thân bài cần vẽ minh họa】\n${String(reply ?? '').trim()}\n`);
    parts.push(`Lần này xuất ra tối đa ${n} khung hình; Nếu thân bài không đủ để vẽ ${n} khung hình, hãy xuất ra theo số lượng thực tế có thể vẽ được.`);
    return { system: ANALYSIS_SYSTEM_PROMPT, user: parts.join('\n') };
}

// buildAnalysisMessages Ghép nối messages của request phân tích kết nối trực tiếp.
//
// Mỗi lần gọi là một bộ messages hai lượt hoàn toàn mới (system + một tin user), không mang theo các lượt lịch sử:
// Request phân tích là "Cửa sổ dùng một lần", số chữ của thân bài chỉ do quy mô phần trước được đóng gói lần này quyết định, không cộng dồn theo số lượt hội thoại.
export function buildAnalysisMessages(reply, context, max, meta = {}) {
    const { system, user } = buildAnalysisParts(reply, context, max, meta);
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

/**
 * parseAnalysisJSON Phân tích cú pháp linh hoạt danh sách khung hình do model trả về.
 * Khoan dung với Markdown Code Block bọc ngoài, chữ giải thích xen lẫn trước sau, hoặc trả về trực tiếp mảng (array) ở cấp cao nhất.
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

// -- Xuất trực tiếp thân bài (Bỏ qua model phân tích, gửi nguyên xi thân bài AI cho model xuất ảnh) --
//
// Phân công công việc với luồng bên trên:
//   Luồng model phân tích - Đầu tiên do model văn bản viết lại thân bài thành prompt xuất ảnh, rồi gửi cho tuyến trên (Văn -> Văn -> Ảnh)
//   Luồng xuất trực tiếp thân bài - Bản thân thân bài chính là prompt, gửi trực tiếp cho tuyến trên (Văn -> Ảnh)
//
// Luồng sau chỉ thành lập khi "Bản thân tuyến trên đọc hiểu được ngôn ngữ tự nhiên" - Nghĩa là Model chat vẽ ảnh /
// API tạo ảnh tương thích OpenAI. Khi kết nối trực tiếp NAI chính thức, thân bài là văn xuôi tiếng Trung,
// đút vào đó chẳng khác nào đút nhiễu (noise), luồng đó bắt buộc phải đi qua model phân tích để dịch thân bài thành thẻ Danbooru. Việc có dùng được hay không do directAppliesTo quyết định.
//
// Vẫn đi theo hướng "Bọc thành đánh dấu", vì toàn bộ luồng hiển thị (thay thế tại chỗ, đổi hội thoại build lại, xem prompt,
// lịch sử tạo) đều lấy đánh dấu làm mỏ neo (anchor); Tạo ra một bộ trạng thái riêng sẽ bị coi là dữ liệu bẩn và xóa đi tại chỗ kiểm tra số lượng đánh dấu của rehydrate.

// Giới hạn ký tự của một đoạn thân bài khi xuất trực tiếp.
//
// WARN: Giới hạn này được suy ra từ MAX_MARKER_LEN, không được viết thành một con số khác - Xuất trực tiếp cũng được implement bằng cách bọc thành đánh dấu,
//       Đánh dấu vượt qua ranh giới bảo vệ sẽ bị findMarkers vứt bỏ toàn bộ, biểu hiện là "Request đã gửi đi, ảnh cũng đã lấy được,
//       nhưng trong thân bài không hiển thị gì cả, đổi hội thoại một lần là ảnh biến mất theo", và không có bất kỳ báo lỗi nào.
export const DIRECT_PROSE_MAX = MAX_MARKER_LEN - 32;

/**
 * directAppliesTo Trong hình thái gửi đi hiện tại, xuất trực tiếp thân bài có khả dụng hay không.
 *
 * Chỉ các mức xử lý ngôn ngữ tự nhiên mới thành lập. 'tags' (Kết nối trực tiếp NAI chính thức / Gateway NAI) bắt buộc phải đi qua model phân tích:
 * Loại tuyến trên đó train theo thẻ Danbooru, đút cả đoạn văn xuôi tiếng Trung vào đó chẳng khác nào đút nhiễu.
 *
 * @param {'description'|'tags'|'both'} mode
 * @returns {boolean}
 */
export function directAppliesTo(mode) {
    return mode === 'description' || mode === 'both';
}

/**
 * DIRECT_GUIDE Chỉ thị vẽ được ghép cố định ở đầu khi xuất trực tiếp.
 *
 * Nó thay thế cho 3 việc mà model phân tích vốn dĩ tiện tay làm - Thiếu nó, nếu vứt thẳng một đoạn thân bài dài chứa hội thoại qua,
 * model xuất ảnh rất dễ nhồi nhét nhiều thời điểm vào cùng một bức tranh (Tạo ra một đống hổ lốn), tự ý đổi nhân vật thành thời trang hiện đại,
 * hoặc coi hội thoại trong thân bài là nội dung bức tranh. **3 điều này chính là nguồn gốc của tính nhất quán về phong cách vẽ giữa chế độ phân tích và chế độ xuất trực tiếp**,
 * do đó xuất trực tiếp không thể chỉ "Gửi thân bài đi" là xong.
 *
 * Khác biệt với ANALYSIS_SYSTEM_PROMPT: Bên kia yêu cầu xuất ra cấu trúc JSON (desc/tags/anchor),
 * bên này chỉ yêu cầu vẽ một bức tranh, không yêu cầu bất kỳ output có cấu trúc nào.
 */
export const DIRECT_GUIDE = `Bạn là một họa sĩ minh họa. Dưới đây là một đoạn thân bài tiểu thuyết, vui lòng vẽ một bức tranh minh họa cho nó.

【Yêu cầu cứng】
1. Chỉ vẽ khoảnh khắc mang đậm tính hình ảnh nhất trong thân bài; Không được nhồi nhét nhiều bối cảnh, nhiều thời điểm vào cùng một bức tranh.
2. Kiểu tóc, màu tóc, màu mắt, thể hình, trang phục và biểu cảm của nhân vật, nhất loạt phục dựng theo miêu tả trong thân bài, không được tự ý đổi thành thời trang hiện đại hoặc khuôn mặt chung chung.
3. Cảnh vật, kiến trúc và đạo cụ phải phù hợp với thiết lập và thời đại của thân bài.
4. Đối thoại, độc thoại và lời tự sự trong thân bài không phải là nội dung của bức tranh; Trong hình không được xuất hiện bất kỳ chữ viết nào.
5. Bố cục hoàn chỉnh, chủ thể nổi bật, nhìn một cái là thấy rõ "Ai, ở đâu, đang làm gì".`;

/**
 * buildDirectProse Ghép đoạn văn bản sẽ gửi đi khi xuất trực tiếp.
 *
 * Thứ tự: Chỉ thị vẽ tích hợp sẵn -> Chỉ thị bổ sung của người dùng -> Thông tin tác phẩm -> Phong cách vẽ -> Chất lượng ảnh -> Prompt tiêu cực -> Thân bài.
 * Càng ở trước trọng số càng cao, do đó thân bài luôn ở cuối cùng.
 *
 * Prompt tiêu cực vẫn ghép vào bình thường (Chỉ cần người dùng điền là có tác dụng): Nó mặc định rỗng, thuộc về lựa chọn chủ động của người dùng;
 * Việc bảo model chat vẽ ảnh "Đừng xuất hiện X" đôi khi sẽ có tác dụng phụ của prompt ngược, nhưng **đó là việc người dùng tự cân nhắc** -
 * Người nào gặp phải thì tự xóa trống cột này là được, plugin không nên quyết định thay họ là không cho.
 *
 * Thân bài được cắt bớt theo hạn mức còn lại, đảm bảo tổng thể "Chỉ thị + Thân bài" không vượt quá DIRECT_PROSE_MAX -
 * Nếu không sẽ bị vứt bỏ toàn bộ khi bọc thành đánh dấu (Xem giải thích của proseToMarker).
 *
 * @param {string} reply Thân bài của AI
 * @param {{guide?:string, work?:string, style?:string, quality?:string, negative?:string}} [meta]
 * @returns {string} Trả về chuỗi rỗng khi thân bài trống (Bên gọi dựa vào đó để bỏ qua, không tạo ra đánh dấu rỗng)
 */
export function buildDirectProse(reply, meta = {}) {
    const head = [DIRECT_GUIDE];
    const guide = String(meta.guide ?? '').trim();
    if (guide) head.push(guide);
    const work = String(meta.work ?? '').trim();
    if (work) head.push(`【Thông tin tác phẩm】\n${work}`);
    const style = String(meta.style ?? '').trim();
    if (style) head.push(`【Phong cách vẽ】${style}`);
    const quality = String(meta.quality ?? '').trim();
    if (quality) head.push(`【Chất lượng ảnh】${quality}`);
    const negative = String(meta.negative ?? '').trim();
    if (negative) head.push(`【Prompt tiêu cực】${negative}`);

    const prefix = head.join('\n');
    const sep = '\n\n';
    // Phải tính luôn cả dòng trống ngăn cách vào, nếu không "Chỉ thị + Thân bài" sẽ dài hơn giới hạn một khoảng bằng độ dài của sep.
    const body = sanitize(reply, Math.max(0, DIRECT_PROSE_MAX - prefix.length - sep.length));
    if (!body) return '';
    return prefix + sep + body;
}

/**
 * proseToMarker Bọc một đoạn thân bài thành đánh dấu.
 *
 * Cố tình không mang đoạn `|`: Xuất trực tiếp chỉ có mô tả, không có tag, mà Regex của findMarkers yêu cầu sau `|`
 * phải có ít nhất một ký tự khác `]`, `[ILLUST: x | ]` sẽ không match được cả câu - Tương tự là bị nuốt im lặng, không báo lỗi.
 *
 * @returns {string} Thân bài trống trả về chuỗi rỗng (Bên gọi dựa vào đó để bỏ qua, không tạo đánh dấu rỗng)
 */
export function proseToMarker(text) {
    const t = sanitize(text, DIRECT_PROSE_MAX);
    return t ? `[ILLUST: ${t}]` : '';
}

// -- Vị trí chèn của xuất trực tiếp --
//
// Model phân tích sẽ đưa ra anchor (Câu trích dẫn nguyên văn) để quyết định chèn ảnh vào dưới đoạn nào; Xuất trực tiếp không qua phân tích nên không có thông tin này.
// Nếu cứ treo ở cuối cùng thì tuy không sai, nhưng ảnh của một câu trả lời dài sẽ luôn nằm tít dưới cùng, đọc không giống "Ảnh minh họa" mà giống "File đính kèm" hơn.
//
// Ở đây dùng một thuật toán heuristic (kinh nghiệm) không chi phí: **Tính hình ảnh đến từ lời tự sự, không đến từ lời thoại**.
// Sau khi bỏ đi phần nội dung trong ngoặc kép và dấu ngoặc đơn, đoạn còn lại dài nhất chính là nơi có khả năng đang tả cảnh / tả người cao nhất.
// Đương nhiên nó không chuẩn bằng anchor do model đưa ra (Model quyết định "Vẽ cái gì" và "Chèn ở đâu" cùng lúc),
// Nhưng tốt hơn nhiều so với việc luôn treo ở cuối, và không cần tốn thêm một lần gọi model.

// narrativeLength Độ dài tự sự hợp lệ của một đoạn văn bản sau khi bỏ đi đối thoại và nội dung trong ngoặc.
function narrativeLength(s) {
    return String(s ?? '')
        .replace(/[「『"“][^」』"”]*[」』"”]/g, '')   // Trong ngoặc kép là lời thoại, không tính
        .replace(/[（(][^）)]*[）)]/g, '')             // Trong ngoặc đơn là giải thích tâm lý / hành động, không tính
        .replace(/\s+/g, '')
        .length;
}

/**
 * pickProseAnchor Chọn một vị trí chèn: Trả về việc ảnh nên chèn trước index (chỉ số) nào.
 *
 * @param {string} text Nguyên văn thân bài
 * @returns {number} Index vị trí chèn; -1 = Không chọn được (Chỉ có một đoạn, hoặc toàn bộ là lời thoại), bên gọi lùi về cuối bài
 */
export function pickProseAnchor(text) {
    const src = String(text ?? '');
    const paras = [];
    let start = 0;
    const re = /\n[ \t]*\n/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        paras.push([start, m.index]);
        start = m.index + m[0].length;
    }
    paras.push([start, src.length]);

    // Khi chỉ có một đoạn thì không có chỗ nào để chọn - Cắm cứng vào giữa câu sẽ chẻ đoạn văn làm đôi, trông càng tệ.
    if (paras.length < 2) return -1;

    let best = -1;
    let bestScore = 0;
    for (const [s, e] of paras) {
        const score = narrativeLength(src.slice(s, e));
        if (score > bestScore) { bestScore = score; best = e; }
    }
    return bestScore > 0 ? best : -1;   // Toàn là lời thoại thuần túy -> Cũng lùi về cuối bài
}

/**
 * applyProseMarker Chèn đánh dấu xuất trực tiếp vào trong thân bài.
 *
 * @param {string} text Nguyên văn thân bài
 * @param {string} prose Đoạn văn sẽ gửi đi khi xuất trực tiếp
 * @param {number} [at] Index vị trí chèn (Lấy từ pickProseAnchor); Nếu là -1 hoặc vượt quá giới hạn thì treo ở cuối
 * @returns {string}
 */
export function applyProseMarker(text, prose, at = -1) {
    const src = String(text ?? '');
    const line = proseToMarker(prose);
    if (!line || !src.trim()) return src;
    if (at >= 0 && at < src.length) {
        const head = src.slice(0, at).replace(/\s+$/, '');
        const tail = src.slice(at).replace(/^\s+/, '');
        return head + '\n\n' + line + (tail ? '\n\n' + tail : '');
    }
    return src.replace(/\s+$/, '') + '\n\n' + line;
}

/**
 * splitProseChunks Cắt thân bài theo đoạn và gom thành n phần (Khi xuất trực tiếp nhiều ảnh, mỗi phần gửi cho tuyến trên một lần).
 *
 * Khi chế độ xuất trực tiếp cần xuất nhiều ảnh, không thể lấy toàn bộ thân bài gửi đi N lần (Sẽ nhận được N bức ảnh gần như giống hệt nhau).
 * Cách làm của người dùng là "Mở nhiều cửa sổ": Ảnh 1 gửi đoạn đầu, ảnh 2 gửi đoạn giữa... Mỗi ảnh request độc lập, nội dung tự nhiên sẽ khác nhau.
 *
 * Tiêu chí cắt: Trước tiên phân đoạn theo dòng trống; Nếu toàn bộ bài chỉ có một "Đoạn lớn" (Thân bài AI thường dùng một dấu xuống dòng để ngắt đoạn),
 * Thoái hóa thành cắt theo một dấu xuống dòng; Nếu ngay cả dấu xuống dòng cũng gần như không có, thì chia đều theo số lượng ký tự - Đảm bảo luôn cắt ra được nhiều phần,
 * chứ không coi toàn bộ thân bài là một đoạn (Đó chính là nguyên nhân gốc rễ của việc "Cài đặt N ảnh nhưng luôn chỉ xuất một ảnh").
 *
 * @param {string} text Nguyên văn thân bài (Sau khi stripMarkers)
 * @param {number} n Số lượng phần mong muốn (>=1)
 * @returns {string[]} Tối đa n lát cắt thân bài; Thân bài rỗng trả về []
 */
export function splitProseChunks(text, n) {
    const src = String(text ?? '').trim();
    if (!src) return [];
    const want = Math.max(1, parseInt(n, 10) || 1);
    if (want === 1) return [src];

    // 1) Phân đoạn theo dòng trống (Bố cục tiểu thuyết bình thường).
    let paras = src.split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean);
    // 2) Phân đoạn bằng dòng trống thất bại -> Phân đoạn bằng một dấu xuống dòng (AI thường dùng dấu xuống dòng liên tục để ngắt đoạn).
    if (paras.length === 1 && /[\r\n]/.test(src)) {
        paras = src.split(/\r?\n+/).map(p => p.trim()).filter(Boolean);
    }
    // 3) Vẫn chỉ có một đoạn (Đoạn văn dài không có dấu xuống dòng) -> Chia đều theo số lượng ký tự, cắt ở gần ranh giới câu.
    if (paras.length === 1 && src.length > 40) {
        const total = src.length;
        const size = Math.ceil(total / want);
        const out = [];
        let i = 0;
        while (i < total && out.length < want) {
            let end = Math.min(total, i + size);
            // Cố gắng ngắt ở dấu chấm / dấu xuống dòng, tránh việc chẻ đôi một câu.
            if (end < total) {
                const cut = Math.max(src.lastIndexOf('。', end), src.lastIndexOf('！', end), src.lastIndexOf('？', end), src.lastIndexOf('.', end), src.lastIndexOf('!', end), src.lastIndexOf('?', end), src.lastIndexOf('\n', end));
                if (cut > i + size * 0.5) end = cut + 1;
            }
            const piece = src.slice(i, end).trim();
            if (piece) out.push(piece);
            i = end;
        }
        return out.length ? out : [src];
    }
    if (paras.length <= want) return paras.slice(0, want);
    // Số đoạn nhiều hơn số phần: Chia đều theo số lượng đoạn, mỗi phần nhận được ceil hoặc floor đoạn, cố gắng cân bằng.
    const chunks = [];
    const per = Math.ceil(paras.length / want);
    for (let i = 0; i < want; i++) {
        const slice = paras.slice(i * per, (i + 1) * per);
        if (slice.length) chunks.push(slice.join('\n\n'));
    }
    return chunks;
}

/**
 * applyProseMarkers Chèn lần lượt nhiều đánh dấu xuất trực tiếp vào dưới các đoạn văn của thân bài.
 *
 * Tương ứng với phiên bản một đánh dấu applyProseMarker: Mỗi mục của items là { prose, at },
 * at là index vị trí mà đánh dấu này nên được chèn vào trước (Được tính toán sau khi phân đoạn bằng splitProseChunks).
 * Chèn từ sau ra trước, tránh việc đánh dấu được chèn trước làm thay đổi index của các đánh dấu phía sau. at vượt quá giới hạn hoặc âm thì treo ở cuối.
 *
 * @param {string} text Nguyên văn thân bài
 * @param {Array<{prose:string, at?:number}>} items
 * @returns {string}
 */
export function applyProseMarkers(text, items) {
    let src = String(text ?? '');
    const list = Array.isArray(items) ? items.filter(x => x && x.prose) : [];
    if (!list.length) return src;
    // Từ sau ra trước: at của lần chèn sau không bị ảnh hưởng bởi lần chèn trước.
    const sorted = [...list]
        .map(x => ({ ...x, at: Number.isFinite(x.at) ? x.at : -1 }))
        .sort((a, b) => b.at - a.at);
    for (const it of sorted) {
        src = applyProseMarker(src, it.prose, it.at);
    }
    return src;
}

// escapeRegExp Escape Regex.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * findAnchor Định vị anchor trong thân bài.
 * Đầu tiên tìm theo nguyên mẫu; Nếu không thấy thì tìm theo cách "Gộp khoảng trắng (Whitespace folding)" - Câu trích dẫn của model và thân bài thường có
 * sự khác biệt về dấu xuống dòng / dấu cách, phải dung sai cho cả hai chiều, do đó gộp các khoảng trắng trong anchor thành `\s*`.
 * @returns {number} Index được hit, không hit trả về -1
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
 * applyMarkers Chuyển danh sách khung hình thành đánh dấu, chèn vào ngay dưới đoạn văn chứa anchor.
 *
 * Đầu ra vẫn là thân bài bình thường, chỉ là có thêm các dòng `[ILLUST: desc | tags]`; Phần sau sẽ do luồng đánh dấu có sẵn tiêu thụ
 * (Xuất ảnh -> Thay thế tại chỗ thành ảnh -> Thân bài không lưu lại text của prompt).
 *
 * Các khung hình không hit anchor sẽ được nối thêm đồng loạt vào cuối thân bài, không bị vứt bỏ.
 *
 * @param {string} text Thân bài
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

        // Dự phòng (Fallback): Rút ngắn hai đoạn lại sao cho độ dài không bị marker.js vứt bỏ (Thà cắt ngắn còn hơn vứt cả câu)
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
                // Cùng một vị trí chỉ giữ lại một bức ảnh: Khi model trích dẫn lặp lại cùng một đoạn văn, phần thừa sẽ bị vứt bỏ trực tiếp,
                // không được quăng xuống cuối bài (Nếu không sẽ tạo ra một đống hình minh họa không có vị trí rõ ràng ở cuối tin nhắn).
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