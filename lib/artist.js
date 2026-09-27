// artist.js - Phân tích và lắp ráp chuỗi họa sĩ (công thức phong cách vẽ).
//
// Chuỗi họa sĩ là một chuỗi các thẻ tên họa sĩ (có thể kèm trọng số, ví dụ 0.8::artist:yalmyu::),
// dùng để khóa tông màu phong cách vẽ của toàn bộ bức tranh - Nó được đặt ở vị trí đầu tiên của prompt tích cực,
// bởi vì NAI đánh trọng số cao hơn cho các tag ở phía trước, mà chuỗi họa sĩ lại quyết định nền tảng phong cách vẽ của toàn bộ bức tranh.
//
// Nó chỉ có ý nghĩa đối với mô hình khuếch tán (diffusion model): NovelAI chính thức / Gateway NAI được train bằng dữ liệu Danbooru,
// mà mỗi bức ảnh trên Danbooru đều được đánh dấu họa sĩ; Các mô hình chat định dạng OpenAI không nhận diện được chuỗi này.
//
// Do đó, cốt lõi của module này không phải là "ghép như thế nào", mà là KHI NÀO THÌ KHÔNG GHÉP:
// Khi xuất ảnh qua V.Adapter (tuyến trên định dạng OpenAI), thứ được gửi đi là mô tả bằng ngôn ngữ tự nhiên,
// nhét tên họa sĩ vào đó chỉ làm ô nhiễm mô tả - Bắt buộc phải bỏ qua. Cơ sở phán đoán tái sử dụng trực tiếp
// hình thái prompt (description / tags / both) do marker.js thiết lập, tức là "Chỉ ghép khi ở hình thái sẽ gửi đi chuỗi tag".
//
// Logic thuần túy, không phụ thuộc vào SillyTavern, có thể Unit Test offline (Xem phần "Chuỗi họa sĩ" trong test/test.mjs).

// Giới hạn độ dài của một chuỗi họa sĩ đơn lẻ. Chuỗi họa sĩ bình thường nằm trong khoảng vài trăm ký tự, vượt quá mức này cơ bản có thể khẳng định là dán nhầm thân bài,
// thay vì để cả một đoạn tiểu thuyết bị gửi đi theo mỗi lần xuất ảnh, thà cắt cụt (truncate) nó đi.
export const ARTIST_PROMPT_MAX = 2000;

// Giới hạn tên (Chỉ dùng để hiển thị trên danh sách của bảng điều khiển).
export const ARTIST_NAME_MAX = 60;

// Giới hạn số lượng mục trong thư viện. Cũng là một van an toàn: Vượt quá thì nên tách thành nhiều bộ cấu hình, chứ không phải nhồi nhét không giới hạn.
export const ARTIST_LIST_MAX = 30;

/**
 * artistAppliesTo Trong hình thái prompt này, chuỗi họa sĩ có hiệu lực hay không.
 *
 * - tags   : Gửi chuỗi thẻ (Kết nối trực tiếp NAI chính thức / Gateway NAI) -> Có hiệu lực
 * - both   : Gộp mô tả và thẻ lại để gửi đi -> Có hiệu lực
 * - description: Gửi mô tả bằng ngôn ngữ tự nhiên (Tuyến trên định dạng OpenAI qua V.Adapter) -> **Không có hiệu lực**
 *   Nhét artist:wlop vào một đoạn mô tả tiếng Trung sẽ khiến mô hình chat coi nó như nội dung mô tả để hiểu,
 *   kết quả là mô tả bị ô nhiễm, ảnh xuất ra xấu đi. Đây chính là lý do module này tồn tại.
 */
export function artistAppliesTo(mode) {
    return mode === 'tags' || mode === 'both';
}

/** sanitizeArtistPrompt Gộp chuỗi họa sĩ thành một dòng và giới hạn độ dài. */
export function sanitizeArtistPrompt(s, max = ARTIST_PROMPT_MAX) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** sanitizeArtistName Tên chỉ loại bỏ khoảng trắng ở hai đầu (Ở giữa cho phép có dấu cách, ví dụ "Hậu đồ Tả thực"). */
export function sanitizeArtistName(s, max = ARTIST_NAME_MAX) {
    return String(s ?? '').trim().slice(0, max);
}

/**
 * artistPromptFor Lấy nội dung chuỗi họa sĩ của mục đang được chọn hiện tại.
 *
 * Ba trường hợp sau đều trả về chuỗi rỗng (= Không sử dụng), bên gọi không cần phán đoán thêm:
 *   - Chưa chọn (id rỗng);
 *   - id lơ lửng (Dangling id, trỏ đến mục đã bị xóa);
 *   - Nội dung mục hoàn toàn trống.
 *
 * Lưu ý: **Cố tình không ghi đè id trong storage**. Id lơ lửng chỉ là "tạm thời không có hiệu lực",
 * nếu sau này người dùng tạo lại mục có cùng id (ví dụ: hoàn tác việc xóa nhầm), thì nó vẫn sẽ tự động khôi phục.
 *
 * @param {Array<{id:string,name:string,prompt:string}>} presets
 * @param {string} activeId
 * @returns {string}
 */
export function artistPromptFor(presets, activeId) {
    const id = String(activeId ?? '').trim();
    if (!id) return '';
    const list = Array.isArray(presets) ? presets : [];
    const hit = list.find(a => a && String(a.id) === id);
    return hit ? sanitizeArtistPrompt(hit.prompt) : '';
}

/**
 * withArtistPrompt Quyết định xem có nên ghép chuỗi họa sĩ lên đầu hay không dựa theo hình thái prompt.
 *
 * Khi không có hiệu lực (Hình thái không khớp / Chưa chọn / Nội dung rỗng) thì **trả về nguyên trạng tham số đầu vào**,
 * do đó các điểm gọi (call sites) có thể bọc thêm một lớp vô điều kiện, hành vi sẽ giống y hệt từng byte so với khi chưa thêm tính năng này.
 *
 * @param {string} prompt Prompt đã qua xử lý của selectPrompt, chuẩn bị được gửi lên tuyến trên
 * @param {string} artistStr Nội dung chuỗi họa sĩ (Thường lấy từ artistPromptFor)
 * @param {'description'|'tags'|'both'} mode
 * @returns {string}
 */
export function withArtistPrompt(prompt, artistStr, mode) {
    const p = String(prompt ?? '');
    const a = sanitizeArtistPrompt(artistStr);
    // Khi không có hiệu lực thì trả về nguyên trạng, không thay đổi một byte nào - Do đó điểm gọi có thể bọc thêm một lớp vô điều kiện.
    if (!artistAppliesTo(mode) || !a) return p;
    const body = p.trim();
    return body ? `${a}, ${body}` : a;
}