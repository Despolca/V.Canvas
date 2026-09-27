// nsfw.js - Phân định luồng: Khung hình lần này nên giao cho kênh chính, hay giao cho backend xuất ảnh thứ hai.
//
// Lý do tồn tại: Kênh chính (ví dụ đi qua V.Adapter tới model chat vẽ ảnh) bị giới hạn bởi policy nội dung của nền tảng,
// một số khung hình gửi lên chỉ nhận lại sự từ chối hoặc thất bại, lãng phí mất một lần quota và vài chục giây chờ đợi.
// Cách làm của người dùng là: Chuyển các khung hình loại này sang một service giao thức NovelAI mà mình có tài khoản.
//
// Do đó module này chỉ trả lời một câu hỏi Yes/No: **Prompt lần này có hit điều kiện phân luồng hay không**.
// Nếu hit, bên gọi sẽ chuyển sang dùng một bộ địa chỉ / key / hình thái prompt khác để xuất ảnh;
// Nếu không hit thì mọi thứ vẫn như cũ - Không gửi thêm bất kỳ request nào, cũng không sửa đổi bản thân prompt.
//
// Tiêu chí đánh giá và quyền sở hữu danh sách từ:
//   Đánh giá là match chuỗi (string matching) thuần túy, danh sách từ do người dùng tự duy trì trong cài đặt (ngăn cách bằng dấu phẩy).
//   Plugin chỉ tích hợp sẵn một bộ từ phân loại nội dung phổ biến nhất, dùng để đảm bảo cài xong là chạy được ngay;
//   Cụ thể muốn chặn những nội dung nào, hoàn toàn phụ thuộc vào việc người dùng điền gì - Plugin không phán xét giá trị,
//   cũng không thay người dùng quyết định cái gì nên vẽ, cái gì không nên vẽ.

// Từ đánh giá tích hợp sẵn: Thu thập các từ thông dụng ở cấp độ phân loại nội dung (rating của Danbooru / tên thẻ thể loại nội dung
// và cách gọi tương ứng), đồng thời bổ sung một bộ từ hành động/bộ phận cơ thể tần suất cao bằng tiếng Việt và thẻ từ cụ thể bằng tiếng Anh.
// Người dùng có thể tùy ý thêm sửa xóa theo nhu cầu của mình.
//
// Giải thích tiêu chí: Quá ít từ đánh giá (ban đầu chỉ có vài từ như nsfw/nude/naked) sẽ dẫn đến cốt truyện NSFW 
// khi dùng các từ thông dụng như "cởi đồ, vuốt ve, hôn, ngực" bị lọt lưới -> Gửi nhầm vào kênh chính (qwen không vẽ được NSFW) ->
// Bỏ đi cả lượt. Ở đây bổ sung thêm các từ tần suất cao trên cơ sở các từ phân loại để cố gắng hit đánh giá; Người dùng vẫn bị lọt lưới có thể bật
// "Chế độ chuyên dụng NSFW" (nsfw_force) để hoàn toàn không đánh giá từ khóa, bắt buộc toàn bộ đi qua kênh phân luồng.
const BUILTIN_WORDS = [
    // Từ phân loại / thể loại (Tiếng Anh)
    'nsfw', 'nude', 'nudity', 'naked', 'explicit', 'sexual', 'erotic',
    'porn', 'porno', 'hentai', 'lewd', '18+', 'r18',
    // Từ phân loại / thể loại (Tiếng Việt)
    'khoả thân', 'loã lồ', 'hở hang', 'người lớn', 'khiêu dâm', 'sắc tình', 'làm tình', 'giao cấu', 'giao phối',
    'giao hợp', 'quan hệ', 'thông dâm', 'mây mưa', 'xuân cung', 'dâm đãng', 'dâm loạn', 'nhục dục', 'hoan ái', 'triền miên',
    // Từ hành động / bộ phận cơ thể tần suất cao (Tiếng Việt, thường dùng trong cốt truyện NSFW)
    'cởi đồ', 'cởi sạch', 'vuốt ve', 'mơn trớn', 'hôn', 'hôn nhau', 'hôn lưỡi', 'ngực', 'vú',
    'núm vú', 'đùi', 'quần lót', 'áo lót', 'đút vào', 'cắm vào', 'nhấp', 'khẩu giao', 'bú', 'liếm', 'mút',
    // Thẻ cụ thể tiếng Anh (Thường thấy trong model phân tích / đánh dấu)
    'sex', 'intercourse', 'making love', 'kissing', 'groping', 'breasts',
    'nipples', 'handjob', 'fellatio', 'cunnilingus', 'penis', 'vagina',
    'spread legs', 'topless', 'bottomless', 'undressing', 'making out',
];

// Các từ tiếng Anh và tiếng Việt (chữ Latinh) match theo ranh giới từ (word boundary), tránh việc `sexual` hit `asexual` do quan hệ bao hàm;
// Các ngôn ngữ CJK (như tiếng Trung) không có ranh giới từ, trực tiếp match chuỗi con (substring).
const HAS_CJK = /[一-鿿぀-ヿ]/;

/**
 * parseWords Cắt danh sách từ người dùng điền thành mảng từ.
 * Ký tự phân cách chấp nhận cả dấu phẩy, dấu chấm phẩy (của cả Anh và Trung), khoảng trắng và dấu xuống dòng; Bỏ qua mục rỗng; Giới hạn độ dài 200 mục.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function parseWords(s) {
    return String(s ?? '')
        .split(/[,，;；\s]+/)
        .map(v => v.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
}

/**
 * buildWordList Gộp các từ tích hợp sẵn và danh sách từ của người dùng (khử trùng lặp, giữ các từ tích hợp sẵn ở trước).
 * @param {string} [extra] Nguyên văn danh sách từ do người dùng điền
 * @returns {string[]}
 */
export function buildWordList(extra) {
    const out = BUILTIN_WORDS.slice();
    const seen = new Set(out);
    for (const w of parseWords(extra)) {
        if (!seen.has(w)) { seen.add(w); out.push(w); }
    }
    return out;
}

/**
 * detectNsfw Đánh giá xem một đoạn prompt có hit điều kiện phân luồng hay không.
 *
 * Đầu vào nên chứa cả mô tả ngôn ngữ tự nhiên và chuỗi thẻ của khung hình: Cả hai đều có thể mang theo manh mối phân loại,
 * Chỉ đánh giá một nửa sẽ bị lọt lưới. Không phân biệt hoa thường.
 *
 * @param {string} text Prompt cần đánh giá
 * @param {string} [extraWords] Nguyên văn danh sách từ do người dùng điền (Để trống thì chỉ dùng từ tích hợp sẵn)
 * @returns {boolean}
 */
export function detectNsfw(text, extraWords) {
    const hay = String(text ?? '').toLowerCase();
    if (!hay.trim()) return false;
    for (const w of buildWordList(extraWords)) {
        if (!w) continue;
        if (HAS_CJK.test(w)) {
            if (hay.includes(w)) return true;
        } else {
            // Ranh giới từ: Hai bên không thể là chữ cái hoặc chữ số. Chuỗi thẻ thường có cách viết như `1girl, nude`,
            // Các thẻ phức hợp nối bằng dấu gạch dưới (như `nude_`) cũng phải được hit, do đó dấu gạch dưới không tính là ký tự ranh giới.
            // Dùng capture group thay vì lookbehind - Cái sau không được hỗ trợ trên một số WebView phiên bản cũ.
            const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}([^a-z0-9]|$)`, 'i');
            if (re.test(hay)) return true;
        }
    }
    return false;
}

// escapeRegExp Escape Regex: Trong danh sách từ có thể xuất hiện các ký tự như `.` `+` `(`.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}