// settings.js - Đọc ghi, xác thực và lưu trữ (persistence) các mục cài đặt.
//
// Vị trí lưu trữ: extension_settings[MODULE_KEY] của SillyTavern, được lưu cùng với file cài đặt của SillyTavern.
// Việc đọc được thống nhất qua settingsGet(): Trả về snapshot lúc runtime, giao diện sửa đổi xong sẽ có hiệu lực ngay lập tức.

import { saveSettingsDebounced } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';

import { sanitizeArtistName, sanitizeArtistPrompt, ARTIST_LIST_MAX } from './artist.js';

export const MODULE_KEY = 'v_canvas';

// -- Giá trị mặc định xuất xưởng --
// model mặc định để chuỗi rỗng: Ràng buộc cứng yêu cầu không được hardcode bất kỳ tên model nào, ô nhập liệu chỉ cung cấp placeholder.
export function defaultSettings() {
    return {
        // Công tắc tổng (Mặc định bật): Cài xong là dùng được, không bắt người dùng phải đi tìm trang nào đó để bật công tắc lên nữa.
        // Khi chưa kết nối bất kỳ backend xuất ảnh nào sẽ không báo lỗi lặp đi lặp lại - index.js sẽ âm thầm bỏ qua trước khi gửi request và chỉ nhắc nhở một lần.
        enabled: true,
        base_url: '',                       // Địa chỉ service giao thức NAI. Để trống sẽ dùng extension V.Adapter trên cùng trang để kết nối trực tiếp (Không cần port)
        api_key: 'v-adapter-8888',          // Giá trị nai_key mặc định của service chuyển đổi; Để trống thì key nào cũng gọi được
        // Salt chia sẻ của V-site. Để trống = Dùng mặc định tích hợp (Đồng bộ với site chính thức online);
        // Nếu instance V-site tự host có sửa exclusiveSalt trong config.json, hoặc site online từng luân chuyển salt, thì điền giá trị tương ứng vào đây.
        exclusive_salt: '',
        // Công tắc chữ ký độc quyền của V-site:
        //   auto (Mặc định) = Chỉ khi key là key độc quyền V-site bắt đầu bằng vcs_ mới đính kèm X-V-Sig, còn lại nhất luật không thêm.
        //                 Đối với NAI chính thức / Trung chuyển bên thứ ba / Key thông dụng V-site, hoàn toàn tương đương với "Tắt".
        //   off         = Bất kỳ key nào cũng không đính kèm header chữ ký (Tắt hoàn toàn; Lúc này ngay cả key độc quyền V-site cũng sẽ bị 403).
        //   on          = Bất kỳ key nào cũng đính kèm (Dùng khi V-site tự host muốn khóa luôn cả quota thông dụng).
        // Dưới ba giá trị này: Body request, luồng request, các header request khác hoàn toàn không đổi, chỉ nhiều/ít hơn một header X-V-Sig.
        sign_mode: 'auto',
        // Tuyến trên là loại service gì - Quyết định "Gửi mô tả ngôn ngữ tự nhiên" hay "Gửi chuỗi thẻ Danbooru".
        //   auto (Mặc định) = Đoán theo địa chỉ: 127.0.0.1 / localhost / Có chứa :8888 / Cài extension service chuyển đổi trên cùng trang
        //                 -> Tính là service chuyển đổi; Các trường hợp còn lại nhất luật tính là NAI.
        //   adapter      = Service chuyển đổi (V.Adapter v.v.) hoặc model chat vẽ ảnh / API tạo ảnh tương thích OpenAI - Ăn ngôn ngữ tự nhiên.
        //                 **Service chuyển đổi deploy trên server bắt buộc phải chọn mức này**: Nó là tên miền từ xa,
        //                 không thể phân biệt với Gateway NAI bên thứ ba qua địa chỉ, đoán chắc chắn sẽ sai.
        //   nai          = NovelAI chính thức / Gateway NAI / Trung chuyển bên thứ ba - Train theo thẻ Danbooru, ăn chuỗi thẻ.
        // Chỉ có tác dụng khi "Hình thái prompt" là auto; Khi hình thái được chỉ định thủ công thì lấy theo hình thái đó.
        upstream_type: 'auto',
        model: '',                          // Chuỗi do người dùng tự điền, không thiết lập mặc định
        width: 832,
        height: 1216,
        negative: '',                       // Tương ứng với prompt tiêu cực của NAI
        prompt_format: 'auto',              // Hình thái nội dung gửi đi: auto / description / tags / both
        steps: 28,
        scale: 6.0,
        max_per_round: 2,                   // Số ảnh tạo tối đa mỗi lượt
        timeout_sec: 300,                   // Timeout cho một ảnh (Tuyến trên 30~60s/ảnh)
        interval_ms: 0,                     // Khoảng cách giữa hai ảnh liên tiếp, dùng để né rate limit (hạn chế lưu lượng)
        parallel: false,                    // Xuất ảnh song song (Mặc định tuần tự; Có thể bật khi tuyến trên cho phép đồng thời)
        exclude_types: 'impersonate',       // Các loại tin nhắn bỏ qua (Ngăn cách bằng dấu phẩy)
        swipe_regenerate: true,             // Tạo lại ảnh khi swipe đổi câu trả lời
        strip_marker: true,                 // Loại bỏ tag khỏi thân bài (Hình minh họa không đi vào context)
        inject_prompt: true,                // Tự động thêm quy tắc ILLUST vào system prompt một cách linh hoạt
        inject_position: 'in_chat',         // Vị trí chèn quy tắc: in_chat (Sát với câu trả lời, độ tuân thủ cao hơn) / in_prompt
        inject_depth: 0,                    // Độ sâu chèn khi dùng in_chat (0 = Sát ngay trước câu trả lời)
        // -- Xuất ảnh theo context: Do model độc lập đọc thân bài để tạo prompt xuất ảnh (Không phụ thuộc vào sự phối hợp của model cốt truyện) --
        ctx_enabled: true,                  // Công tắc tổng (Mặc định bật)
        // Cách bù ảnh khi không có đánh dấu:
        //   direct (Mặc định) = Bỏ qua model phân tích, gửi nguyên xi thân bài AI cho tuyến trên tạo ảnh (Văn -> Ảnh, text-to-image thực sự).
        //                    Tiết kiệm được một lần gọi model và mười mấy giây chờ đợi, cũng không cần cấu hình bất kỳ model phân tích nào - Cài là dùng.
        //                    Cái giá phải trả là không có phân cảnh, không có vị trí chèn: Một câu trả lời cố định một ảnh, treo ở cuối.
        //                    Chỉ thành lập đối với tuyến trên "Đọc hiểu được ngôn ngữ tự nhiên" (Model chat vẽ ảnh / API tạo ảnh tương thích OpenAI);
        //                    Tự động bỏ qua khi hình thái gửi đi là chuỗi thẻ, xem directAppliesTo của lib/analysis.js.
        //   analyze         = Đầu tiên do model phân tích đọc thân bài, viết thành prompt xuất ảnh, sau đó mới gửi cho tuyến trên (Văn -> Văn -> Ảnh).
        //                    Kết nối trực tiếp NAI chính thức / Gateway NAI bắt buộc phải chọn mức này - Loại tuyến trên đó chỉ nhận chuỗi thẻ,
        //                    đút cả đoạn văn xuôi tiếng Trung vào đó chẳng khác nào đút nhiễu. Ưu điểm là có phân cảnh, có thể chèn ảnh đúng chỗ, có thể xuất nhiều ảnh.
        // Mặc định lấy direct: Đa số các luồng (V.Adapter -> Model chat vẽ ảnh) vốn dĩ đã phải gửi ngôn ngữ tự nhiên rồi,
        // chèn thêm một model văn bản ở giữa để viết lại vừa chậm vừa tốn tiền; analyze dành riêng cho việc kết nối trực tiếp NAI chính thức và các tình huống cần nhiều ảnh.
        ctx_mode: 'direct',
        // Ở chế độ xuất trực tiếp, ngoài chỉ thị vẽ tích hợp sẵn thì ghép thêm những lời này cho model xuất ảnh (Có thể rỗng).
        // Chỉ thị tích hợp sẵn chỉ chịu trách nhiệm cho các ràng buộc chung như "Chọn một khoảnh khắc, phục dựng nhân vật theo thân bài, không vẽ đối thoại vào ảnh",
        // Bố cục, góc máy, tông màu v.v. mà mỗi người thích cố định lại thì tự viết vào đây.
        // Chỉ có hiệu lực khi ctx_mode = 'direct'; Ở chế độ phân tích, việc này do ANALYSIS_SYSTEM_PROMPT đảm nhận.
        ctx_direct_guide: '',
        // Vị trí chèn ảnh khi xuất trực tiếp:
        //   scene (Mặc định) = Chọn đoạn có lời tự sự hợp lệ dài nhất, chèn vào dưới nó (Tính hình ảnh đến từ tự sự, không đến từ đối thoại).
        //                   Không tốn chi phí, nhưng không chuẩn bằng anchor do model phân tích đưa ra - Cái sau là quyết định "Vẽ gì" và "Chèn ở đâu" cùng lúc.
        //   end          = Nhất luật treo ở cuối toàn bộ câu trả lời (Khi không chọn được vị trí chèn cũng sẽ rơi vào đây).
        ctx_direct_place: 'scene',
        // Nguồn của model phân tích. Mặc định 'main' = Dùng trực tiếp model mà SillyTavern đang dùng hiện tại,
        // Người dùng không cần điền bất kỳ địa chỉ và key nào; Khi muốn cấu hình riêng một model rẻ hơn / nhanh hơn thì mới chuyển sang 'custom'.
        ctx_source: 'main',                 // main = Đi theo API chính của SillyTavern (Không cần cấu hình) / custom = Tự điền 3 mục bên dưới
        ctx_url: '',                        // Chỉ dùng khi ctx_source = 'custom': Địa chỉ API tương thích OpenAI
        ctx_key: '',                        // Chỉ dùng khi ctx_source = 'custom'
        ctx_model: '',                      // Chỉ dùng khi ctx_source = 'custom' (Tự điền, không có mặc định)
        ctx_style: '',                      // Phong cách vẽ (Có thể rỗng = Do model phân tích tự đánh giá theo tác phẩm)
        ctx_quality: '',                    // Prompt chất lượng tích cực (Có thể rỗng)
        ctx_negative: '',                   // Prompt tiêu cực (Có thể rỗng)
        jb_llm: '',                         // Từ phá giới hạn·Model phân tích (Tùy chọn; Ghép vào request phân tích của xuất ảnh theo context)
        jb_image: '',                       // Từ phá giới hạn·Tuyến trên xuất ảnh (Tùy chọn; Ghép vào đầu prompt xuất ảnh)
        // -- Nắn lại vị trí đánh dấu --
        // Khi model viết toàn bộ [ILLUST: ...] ở cuối câu trả lời, sẽ trải đều các đánh dấu ra theo từng đoạn văn rồi mới chèn ảnh.
        // Văn bản thuần túy không đổi, chỉ đổi xem ảnh được chèn vào dưới đoạn văn nào (Xem redistributeMarkers của lib/marker.js).
        marker_redistribute: true,
        // -- Kênh phân luồng (Backend xuất ảnh thứ hai) --
        // Những khung hình mà kênh chính không vẽ được sẽ giao cho kênh này. Khi hit đánh giá, lần xuất ảnh đó sẽ chuyển sang dùng địa chỉ và key dưới đây,
        // Khi không hit thì hoàn toàn đi qua kênh chính, không gửi dư một byte nào (Xem lib/nsfw.js).
        nsfw_enabled: false,                // Công tắc tổng (Mặc định tắt: Không điền địa chỉ thì không thay đổi bất kỳ hành vi nào)
        nsfw_base_url: '',                  // Địa chỉ service giao thức NovelAI (NAI chính thức / Gateway hỗ trợ giao thức này)
        nsfw_api_key: '',
        nsfw_model: '',                     // Tự điền, không thiết lập mặc định
        nsfw_upstream_type: 'nai',          // Mặc định tính là NAI: Kênh phân luồng thường là NAI chính thức hoặc proxy của nó
        nsfw_prompt_format: 'tags',         // Mặc định gửi chuỗi thẻ: Tuyến trên hệ NAI train theo thẻ Danbooru
        nsfw_negative: '',                  // Có thể rỗng = Kế thừa prompt tiêu cực của kênh chính
        nsfw_words: '',                     // Danh sách từ đánh giá (Ngăn cách bằng dấu phẩy); Để trống = Chỉ dùng từ đánh giá tích hợp sẵn
        // Kênh phân luồng xuất mấy ảnh mỗi lần (Tách biệt với max_per_round của kênh chính, hai kênh tự quản lý riêng).
        nsfw_max: 2,                        // Mặc định 2: Đi đôi với chế độ hỗn hợp "1 Đời thường + 1 NSFW"
        // Tổ hợp nội dung của kênh phân luồng:
        //   daily_nsfw = Đời thường + NSFW mỗi loại một ảnh (Mặc định; Khi nsfw_max là 1 sẽ thoái hóa thành chỉ xuất NSFW)
        //   nsfw_only  = Toàn bộ đều là NSFW
        nsfw_mix: 'daily_nsfw',
        // Vị trí khung hình của "Bức ảnh đời thường đó" trong chế độ hỗn hợp (Do model phân tích dựa vào đây để chọn đoạn; Bức NSFW thì luôn do model phân tích đánh giá theo ngữ nghĩa):
        //   auto   = Model phân tích tự chọn một thời điểm không phải người lớn (Mặc định)
        //   front  = Đoạn đầu thân bài
        //   middle = Đoạn giữa thân bài
        //   end    = Đoạn cuối thân bài
        nsfw_daily_place: 'auto',
        // Tiền tố prompt của khung hình phân luồng (Có thể rỗng).
        // Lý do tách biệt với "Từ phá giới hạn xuất ảnh" của kênh chính xem ở index.js: Từ phá giới hạn được chuẩn bị cho các tuyến trên bị giới hạn,
        // Bản thân tuyến trên phân luồng không bị giới hạn, ghép nó vào chỉ làm ô nhiễm khung hình; Ở đây đặt những thứ mà tuyến trên đó thực sự cần.
        nsfw_prefix: '',
        // Chiến lược thử lại sau khi kênh chính (qwen) xuất ảnh thất bại:
        //   off   = Không tự động chuyển phân luồng - Kênh chính thất bại thì thôi, tuyệt đối không đụng vào quota NAI (Tiết kiệm nhất; Khi lọt lưới đánh giá thì ảnh không ra được)
        //   smart = Chỉ khi "Nghi ngờ NSFW" (Thân bài/đánh dấu hit từ đánh giá, hoặc lỗi là do policy nội dung từ chối) mới chuyển phân luồng thử lại -
        //           Ảnh đời thường bị lỗi mạng qwen sẽ không đốt quota NAI vô ích (Mặc định)
        //   force = Kênh chính thất bại bất kể lý do gì đều bắt buộc chuyển phân luồng thử lại - Ảnh chắc chắn sẽ ra,
        //           nhưng ảnh đời thường thất bại cũng sẽ tiêu tốn quota NAI
        nsfw_retry: 'smart',
        // -- Chuỗi họa sĩ (Công thức phong cách vẽ) --
        // Một chuỗi thẻ tên họa sĩ (có thể kèm trọng số), ghép trước tag khung hình, dùng để khóa tông màu phong cách vẽ.
        // Chỉ có hiệu lực ở các hình thái gửi đi chuỗi thẻ (Kết nối trực tiếp NovelAI chính thức / Gateway NAI); Khi gửi mô tả ngôn ngữ tự nhiên sẽ tự động bỏ qua,
        // vì model chat không nhận diện tên họa sĩ, ghép vào chỉ làm ô nhiễm mô tả - Lý do xem ở phần đầu file lib/artist.js.
        // Cùng loại với history: Đây là dữ liệu người dùng sáng tác chứ không phải cài đặt vô hướng (scalar setting), do đó không tham gia vào applyPatch,
        // cũng không bị xóa trống khi "Khôi phục mặc định", chỉ có thể sửa đổi qua saveArtistPresets.
        artist_presets: [],
        active_artist: '',                  // Id của mục đang chọn hiện tại; Chuỗi rỗng = Không sử dụng (Là một giá trị lưu trữ có ý nghĩa)
        ctx_timeout_sec: 90,                // Timeout cho một lần phân tích
        history: [],                        // Lịch sử tạo ảnh (URL ảnh + Prompt, có tính persistence; Tách biệt với cuộc trò chuyện hiện tại)
        debug: false,                       // Log chi tiết trên console
    };
}

// Giới hạn tối đa của lịch sử tạo ảnh (số mục). Lịch sử chỉ lưu metadata (URL + Prompt sau khi cắt ngắn), không lưu bản thân bức ảnh,
// Mỗi mục khoảng 400 byte; Giới hạn này tương đương khoảng 800 KB, sẽ không làm file cài đặt của SillyTavern phình to rõ rệt.
// Vượt quá sẽ vứt bỏ các mục cũ nhất.
const HISTORY_MAX = 2000;

// Độ dài lưu trữ của prompt trong một mục lịch sử. Prompt đầy đủ vẫn có thể đọc từ extra.illust.src của tin nhắn trò chuyện.
const HISTORY_PROMPT_MAX = 500;

const BOOL_KEYS = ['enabled', 'swipe_regenerate', 'strip_marker', 'inject_prompt', 'debug', 'ctx_enabled', 'parallel', 'marker_redistribute', 'nsfw_enabled'];
const STR_KEYS = ['base_url', 'api_key', 'upstream_type', 'model', 'negative', 'prompt_format', 'exclude_types', 'inject_position', 'ctx_mode', 'ctx_direct_guide', 'ctx_direct_place', 'ctx_source', 'ctx_url', 'ctx_key', 'ctx_model', 'ctx_style', 'ctx_quality', 'ctx_negative', 'jb_llm', 'jb_image', 'active_artist', 'exclusive_salt', 'sign_mode', 'nsfw_base_url', 'nsfw_api_key', 'nsfw_model', 'nsfw_upstream_type', 'nsfw_prompt_format', 'nsfw_negative', 'nsfw_words', 'nsfw_prefix', 'nsfw_mix', 'nsfw_daily_place', 'nsfw_retry'];

// Các giá trị hợp lệ của prompt_format (Xem resolvePromptMode của marker.js).
const PROMPT_FORMATS = ['auto', 'description', 'tags', 'both'];

// Các giá trị hợp lệ của upstream_type (Xem resolvePromptMode của marker.js):
//   auto    = Đoán theo địa chỉ (Không thể phân biệt "Service chuyển đổi từ xa" và "Gateway NAI bên thứ ba")
//   adapter = Service chuyển đổi / Model chat vẽ ảnh, ăn ngôn ngữ tự nhiên
//   nai     = NAI chính thức / Gateway / Trung chuyển bên thứ ba, ăn chuỗi thẻ
const UPSTREAM_TYPES = ['auto', 'adapter', 'nai'];

// Các giá trị hợp lệ của ctx_direct_place (Xem pickProseAnchor của lib/analysis.js):
//   scene = Chọn đoạn có lời tự sự hợp lệ dài nhất, chèn vào dưới nó
//   end   = Nhất luật treo ở cuối câu trả lời
const DIRECT_PLACES = ['scene', 'end'];

// Các giá trị hợp lệ của nsfw_mix (Xem nhánh hit phân luồng khi xuất trực tiếp của index.js):
//   daily_nsfw = Đời thường + NSFW mỗi loại một ảnh (nsfw_max=1 thì thoái hóa thành chỉ xuất NSFW)
//   nsfw_only  = Toàn bộ đều là NSFW
const NSFW_MIXES = ['daily_nsfw', 'nsfw_only'];

// Các giá trị hợp lệ của nsfw_daily_place (Xem buildAnalysisParts của lib/analysis.js):
//   auto   = Model phân tích tự chọn thời điểm không phải người lớn
//   front  = Đoạn đầu thân bài
//   middle = Đoạn giữa thân bài
//   end    = Đoạn cuối thân bài
const NSFW_DAILY_PLACES = ['auto', 'front', 'middle', 'end'];

// Các giá trị hợp lệ của nsfw_retry (Xem dự phòng thử lại drawMarkers của index.js):
//   off   = Không tự động chuyển phân luồng (Kênh chính thất bại thì thôi, không đụng quota NAI)
//   smart = Chỉ khi nghi ngờ NSFW (Hit từ đánh giá / Policy nội dung từ chối) mới chuyển phân luồng thử lại (Tiết kiệm quota)
//   force = Kênh chính thất bại bất kể lý do gì đều bắt buộc chuyển phân luồng thử lại (Ảnh chắc chắn ra, nhưng có thể tốn thêm quota)
const NSFW_RETRIES = ['off', 'smart', 'force'];

// Các giá trị hợp lệ của ctx_mode (Xem directAppliesTo của lib/analysis.js và runDirectPass của index.js):
//   analyze = Model phân tích viết lại thân bài thành prompt xuất ảnh (Kết nối trực tiếp NAI chính thức bắt buộc đi mức này)
//   direct  = Gửi nguyên xi thân bài cho tuyến trên xuất ảnh, bỏ qua model phân tích
const CTX_MODES = ['analyze', 'direct'];

// Các giá trị hợp lệ của ctx_source (Xem pickAnalyzer của index.js):
//   main   = Đi theo API chính của SillyTavern (Mặc định, người dùng cấu hình bằng 0)
//   custom = Dùng service độc lập được chỉ định bởi ctx_url / ctx_key / ctx_model
const CTX_SOURCES = ['main', 'custom'];

// Các giá trị hợp lệ của inject_position (Xem syncPromptInjection của index.js).
const INJECT_POSITIONS = ['in_chat', 'in_prompt'];

// Các giá trị hợp lệ của sign_mode (Xem sigHeaders của lib/vsig.js):
//   auto (Mặc định) = Chỉ key độc quyền V-site bắt đầu bằng vcs_ mới đính kèm X-V-Sig, còn lại nhất luật không thêm
//   off          = Bất kỳ key nào cũng không đính kèm (Tắt hoàn toàn)
//   on           = Bất kỳ key nào cũng đính kèm (Dùng khi V-site tự host muốn khóa luôn cả quota thông dụng)
const SIGN_MODES = ['off', 'auto', 'on'];

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

// normalizeArtistPresets Ép một thư viện chuỗi họa sĩ từ bất kỳ nguồn nào thành một danh sách hợp lệ.
//
// Tiêu chí: Các trường nhất luật ép thành vô hướng (scalar), xóa khoảng trắng, giới hạn độ dài; Các mục không có id hoặc id trùng lặp sẽ bị vứt bỏ (id là khóa liên kết duy nhất,
// trùng lặp sẽ khiến "Đang chọn hiện tại" trỏ đến hai mục); Các mục có tên và nội dung đều trống cũng vứt bỏ (Lưu lại không có ý nghĩa gì).
// Cùng nguồn gốc với cách xử lý của history, đều là "Tránh việc ghi một object bất kỳ vào file cài đặt".
function normalizeArtistPresets(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    return arr
        .filter(x => x && typeof x === 'object')
        .slice(-ARTIST_LIST_MAX)
        .map(x => ({
            id: String(x.id ?? '').trim().slice(0, 64),
            name: sanitizeArtistName(x.name),
            prompt: sanitizeArtistPrompt(x.prompt),
        }))
        .filter(x => {
            if (!x.id || seen.has(x.id)) return false;
            if (!x.name && !x.prompt) return false;
            seen.add(x.id);
            return true;
        });
}

// normalize Ép một object từ bất kỳ nguồn nào thành một bộ cài đặt hợp lệ (Thiếu trường thì bù bằng giá trị mặc định).
export function normalize(raw) {
    const d = defaultSettings();
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};

    for (const k of BOOL_KEYS) out[k] = src[k] === undefined ? d[k] : !!src[k];
    for (const k of STR_KEYS) out[k] = src[k] === undefined ? d[k] : String(src[k]);

    out.base_url = out.base_url.trim().replace(/\/+$/, '');
    out.api_key = out.api_key.trim();
    out.upstream_type = out.upstream_type.trim();
    out.model = out.model.trim();
    out.negative = out.negative.trim();
    out.exclude_types = out.exclude_types.trim();
    out.ctx_mode = out.ctx_mode.trim();
    out.ctx_direct_guide = out.ctx_direct_guide.trim();
    out.ctx_direct_place = out.ctx_direct_place.trim();
    out.ctx_url = out.ctx_url.trim().replace(/\/+$/, '');
    out.ctx_key = out.ctx_key.trim();
    out.ctx_model = out.ctx_model.trim();
    out.ctx_style = out.ctx_style.trim();
    out.ctx_quality = out.ctx_quality.trim();
    out.ctx_negative = out.ctx_negative.trim();
    out.jb_llm = out.jb_llm.trim();
    out.jb_image = out.jb_image.trim();
    out.active_artist = out.active_artist.trim();
    out.exclusive_salt = out.exclusive_salt.trim();
    out.nsfw_base_url = out.nsfw_base_url.trim().replace(/\/+$/, '');
    out.nsfw_api_key = out.nsfw_api_key.trim();
    out.nsfw_model = out.nsfw_model.trim();
    out.nsfw_upstream_type = out.nsfw_upstream_type.trim();
    out.nsfw_prompt_format = out.nsfw_prompt_format.trim();
    out.nsfw_negative = out.nsfw_negative.trim();
    out.nsfw_words = out.nsfw_words.trim();
    out.nsfw_prefix = out.nsfw_prefix.trim();
    out.nsfw_mix = out.nsfw_mix.trim();
    out.nsfw_daily_place = out.nsfw_daily_place.trim();
    out.nsfw_retry = out.nsfw_retry.trim();

    // Giá trị Enum: Các giá trị không hợp lệ nhất luật lùi về mục mặc định, tránh việc downstream resolvePromptMode nhận được nhánh undefined.
    out.prompt_format = PROMPT_FORMATS.includes(out.prompt_format) ? out.prompt_format : d.prompt_format;
    out.upstream_type = UPSTREAM_TYPES.includes(out.upstream_type) ? out.upstream_type : d.upstream_type;
    out.ctx_direct_place = DIRECT_PLACES.includes(out.ctx_direct_place) ? out.ctx_direct_place : d.ctx_direct_place;
    out.sign_mode = SIGN_MODES.includes(out.sign_mode) ? out.sign_mode : d.sign_mode;
    out.inject_position = INJECT_POSITIONS.includes(out.inject_position) ? out.inject_position : d.inject_position;
    out.nsfw_prompt_format = PROMPT_FORMATS.includes(out.nsfw_prompt_format) ? out.nsfw_prompt_format : d.nsfw_prompt_format;
    out.nsfw_upstream_type = UPSTREAM_TYPES.includes(out.nsfw_upstream_type) ? out.nsfw_upstream_type : d.nsfw_upstream_type;
    out.nsfw_mix = NSFW_MIXES.includes(out.nsfw_mix) ? out.nsfw_mix : d.nsfw_mix;
    out.nsfw_daily_place = NSFW_DAILY_PLACES.includes(out.nsfw_daily_place) ? out.nsfw_daily_place : d.nsfw_daily_place;
    out.nsfw_retry = NSFW_RETRIES.includes(out.nsfw_retry) ? out.nsfw_retry : d.nsfw_retry;
    out.ctx_mode = CTX_MODES.includes(out.ctx_mode) ? out.ctx_mode : d.ctx_mode;
    out.ctx_source = CTX_SOURCES.includes(out.ctx_source) ? out.ctx_source : d.ctx_source;

    out.width = clampInt(src.width, 64, 2048, d.width);
    out.height = clampInt(src.height, 64, 2048, d.height);
    out.steps = clampInt(src.steps, 1, 50, d.steps);
    out.scale = clampFloat(src.scale, 0, 30, d.scale);
    out.max_per_round = clampInt(src.max_per_round, 1, 6, d.max_per_round);
    out.nsfw_max = clampInt(src.nsfw_max, 1, 6, d.nsfw_max);
    out.timeout_sec = clampInt(src.timeout_sec, 30, 1800, d.timeout_sec);
    out.interval_ms = clampInt(src.interval_ms, 0, 60000, d.interval_ms);
    out.inject_depth = clampInt(src.inject_depth, 0, 20, d.inject_depth);
    out.ctx_timeout_sec = clampInt(src.ctx_timeout_sec, 10, 600, d.ctx_timeout_sec);

    // Lịch sử tạo ảnh: Chỉ giữ lại các mục có cấu trúc hoàn chỉnh, các trường nhất luật ép thành vô hướng, tránh việc ghi một object bất kỳ vào file cài đặt.
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

    // Thư viện chuỗi họa sĩ: Cùng thuộc dữ liệu persistence, tiêu chí xác thực xem tại normalizeArtistPresets.
    out.artist_presets = normalizeArtistPresets(src.artist_presets);

    return out;
}

let rt = defaultSettings();

// Khóa lưu trữ cũ (v_illust): Chỉ dùng để di chuyển cài đặt trong lần đầu nâng cấp từ phiên bản cũ, không ghi lại nữa.
const LEGACY_MODULE_KEY = 'v_illust';

// initSettings Khởi tạo lúc khởi động: Giá trị mặc định -> SillyTavern persistence ghi đè.
export function initSettings() {
    // Lần đầu khởi động bằng khóa mới, nếu tồn tại dữ liệu khóa cũ thì di chuyển sang, tránh việc làm mất cài đặt đã lưu.
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

// settingsGet Các điểm đọc có hiệu lực nóng (hot-reload) thống nhất đi qua đây.
export function settingsGet() {
    return rt;
}

function parseTypes(s) {
    return String(s ?? '')
        .split(/[,，\s]+/)
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

// isTypeExcluded Loại tin nhắn này có bị người dùng loại trừ hay không.
export function isTypeExcluded(type) {
    if (!type) return false;
    return parseTypes(rt.exclude_types).includes(String(type).toLowerCase());
}

/**
 * applyPatch Áp dụng các cặp key-value do bảng điều khiển submit: Sau khi xác thực sẽ có hiệu lực nóng và ghi vào ổ đĩa.
 * @param {object} patch
 * @returns {string[]} notes Các vấn đề cần nhắc nhở người dùng (Ví dụ: model rỗng, địa chỉ không hợp lệ)
 */
export function applyPatch(patch) {
    const notes = [];
    const merged = { ...rt };
    for (const k of Object.keys(defaultSettings())) {
        // Hai mục này là dữ liệu người dùng chứ không phải cài đặt, không tham gia vào việc ghi cài đặt, cũng không tham gia vào "Khôi phục mặc định" -
        // Lịch sử tạo ảnh do clearHistory xóa trống, thư viện chuỗi họa sĩ do saveArtistPresets ghi đè.
        // Nếu không thì chỉ một lần click nhầm "Khôi phục mặc định" sẽ hủy hoại toàn bộ công thức phong cách vẽ mà người dùng đã lưu.
        if (k === 'history' || k === 'artist_presets') continue;
        if (patch[k] !== undefined) merged[k] = patch[k];
    }
    const next = normalize(merged);

    // Lời nhắc nhở chỉ được đưa ra khi "Lần này thực sự đã sửa đến các trường liên quan", tránh việc cứ sửa một cài đặt không liên quan nào cũng lặp lại cùng một lời nhắc.
    const touched = (...keys) => keys.some(k => patch[k] !== undefined);

    if (touched('base_url')) {
        if (next.base_url !== '' && !/^https?:\/\//i.test(next.base_url)) {
            notes.push('Địa chỉ service NAI nên bắt đầu bằng http:// hoặc https://, vui lòng kiểm tra lại');
        }
        if (next.base_url === '') {
            notes.push('Địa chỉ service NAI đang trống: Sẽ kết nối trực tiếp với extension V.Adapter trên cùng trang; Nếu chưa cài extension đó, vui lòng điền địa chỉ service vào đây');
        }
    }

    // Đã bật phân luồng nhưng không điền địa chỉ: Các khung hình hit đánh giá sẽ đi đến một địa chỉ rỗng, chắc chắn thất bại.
    if (touched('nsfw_enabled', 'nsfw_base_url', 'nsfw_api_key')
        && next.nsfw_enabled && !next.nsfw_base_url) {
        notes.push('Kênh phân luồng đã bật nhưng chưa điền địa chỉ service: Các khung hình hit điều kiện phân luồng sẽ xuất ảnh thất bại, vui lòng bổ sung địa chỉ hoặc tắt công tắc này');
    }

    // Chuyển sang model phân tích tùy chỉnh nhưng chưa điền đủ thì nhắc nhở ngay tại chỗ, không cần đợi đến lượt tạo tiếp theo mới phát hiện ra.
    // Chỉ nhắc nhở ở mức analyze: Xuất trực tiếp thân bài không dùng model phân tích, điền hay không cũng không ảnh hưởng.
    if (touched('ctx_source', 'ctx_url', 'ctx_model', 'ctx_mode')
        && next.ctx_mode === 'analyze'
        && next.ctx_source === 'custom' && (!next.ctx_url || !next.ctx_model)) {
        notes.push('Đã chọn model phân tích tùy chỉnh, vui lòng điền địa chỉ API và tên model, nếu không luồng này sẽ không gửi request');
    }

    rt = next;
    persist();
    return notes;
}

/**
 * recordHistory Bổ sung một mục lịch sử tạo ảnh và ghi vào ổ đĩa.
 *
 * Lịch sử tách biệt với cuộc trò chuyện hiện tại: Chuyển cuộc trò chuyện, đổi nhân vật, khởi động lại SillyTavern vẫn có thể tra cứu.
 * Khi vượt quá giới hạn sẽ vứt bỏ mục cũ nhất.
 *
 * @param {{url:string, prompt?:string, name?:string, mid?:number, idx?:number}} entry
 * @returns {number} Số lượng mục lịch sử hiện tại
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

/** clearHistory Xóa trống lịch sử tạo ảnh (Các file ảnh đã lưu trên ổ đĩa không bị ảnh hưởng). */
export function clearHistory() {
    rt.history = [];
    persist();
    return 0;
}

/**
 * saveArtistPresets Thay thế toàn bộ thư viện chuỗi họa sĩ (Bảng điều khiển submit lên là một danh sách hoàn chỉnh).
 *
 * Lý do đi qua cổng này thay vì applyPatch xem tại chú thích trong defaultSettings: Nó là dữ liệu người dùng,
 * bắt buộc phải cách ly với "Khôi phục mặc định". Có thể tùy chọn ghi kèm active_artist xuống ổ đĩa,
 * bởi vì "Xóa đi mục đang được dùng" bắt buộc phải đồng thời làm trống nó, nếu không sẽ để lại một id lơ lửng.
 *
 * @param {Array<{id:string,name:string,prompt:string}>} list
 * @param {{activeArtist?:string}} [opt]
 * @returns {{list:Array, activeArtist:string}}
 */
export function saveArtistPresets(list, opt = {}) {
    rt.artist_presets = normalizeArtistPresets(list);
    if (opt.activeArtist !== undefined) {
        rt.active_artist = String(opt.activeArtist ?? '').trim();
    }
    persist();
    return { list: rt.artist_presets, activeArtist: rt.active_artist };
}

// resolveApiBase Chuỗi địa chỉ cung cấp cho module xuất ảnh (Đã bỏ dấu gạch chéo ở cuối).
export function apiBase() {
    return rt.base_url;
}