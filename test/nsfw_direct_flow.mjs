// nsfw_direct_flow.mjs - Test toàn bộ luồng hit điều kiện phân luồng ở chế độ xuất trực tiếp (Mô phỏng offline).
//
// Tái hiện lại việc đánh giá phân luồng và lựa chọn nội dung gửi đi trong runDirectPass / drawMarkers:
//   1. Thân bài xuất trực tiếp (Sau stripMarkers) -> detectNsfw đánh giá xem có hit điều kiện phân luồng không;
//   2. Nếu hit -> Bắt buộc đi qua kênh phân luồng (forceDivert), hình thái phân tích theo kênh phân luồng (nai -> tags);
//   3. Kênh phân luồng gửi đi selectPrompt(marker, 'tags') - Lấy thẻ tag trong sản phẩm của model phân tích, chứ không phải văn xuôi.
// Khẳng định (Assertion) cốt lõi: Thân bài NSFW tuyệt đối không đem văn xuôi làm thẻ tag để gửi cho NAI; Thân bài bình thường tuyệt đối không bị cắt nhầm.

import { detectNsfw, parseWords, buildWordList } from '../lib/nsfw.js';
import { resolvePromptMode, selectPrompt } from '../lib/marker.js';
import { buildAnalysisParts, splitProseChunks, applyProseMarkers } from '../lib/analysis.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`[OK]   ${name}`); }
    else { fail++; console.log(`[FAIL] ${name}${extra ? ' - ' + JSON.stringify(extra) : ''}`); }
}

// -- Đánh giá phân luồng của chế độ xuất trực tiếp (Tái hiện logic runDirectPass) --
// Khi xuất trực tiếp: Hình thái của kênh chính bắt buộc phải là description (qwen ăn ngôn ngữ tự nhiên), hit phân luồng mới chuyển sang phân tích.
function directDivertDecide(cfg, body) {
    const needDivert = cfg.nsfw_enabled && !!cfg.nsfw_base_url
        && detectNsfw(body, cfg.nsfw_words);
    return needDivert;
}

// Định tuyến kênh phân luồng (Tái hiện phân tích route của drawMarkers): Mặc định nai + tags
function divertRoute(cfg) {
    return {
        mode: resolvePromptMode(cfg.nsfw_prompt_format, cfg.nsfw_base_url, cfg.nsfw_upstream_type),
        baseUrl: cfg.nsfw_base_url,
    };
}

// Sản phẩm của model phân tích: desc (ngôn ngữ tự nhiên) + tags (Thẻ Danbooru)
const analyzedItem = {
    desc: 'Thiếu nữ tóc vàng nằm trên giường, hai tay chống ra sau, hai chân dang rộng, ánh mắt mơ màng',
    tags: '1girl, blonde hair, lying on bed, spread legs, handjob, breasts, nipple slip, blush',
    anchor: 'Cô từ từ dang rộng hai chân',
};

// Thân bài bình thường - Không nên hit
const SFW_BODY = 'Thiếu nữ đứng dưới ánh đèn neon trong đêm mưa, mái tóc dài bị gió thổi tung, nhìn về những tòa nhà cao tầng phía xa.';
// Thân bài NSFW (Chứa từ đánh giá tích hợp sẵn: khoả thân)
const NSFW_BODY = 'Cô cởi nút áo, để lộ nửa thân trên khoả thân, môi hai người dán vào nhau, hôn nhau say đắm.';
// Thân bài NSFW (Từ đánh giá tiếng Anh: explicit)
const NSFW_BODY_EN = 'The two of them engaged in explicit acts on the bed.';

const cfgOn = {
    nsfw_enabled: true,
    nsfw_base_url: 'https://example-nai-relay.example.com',
    nsfw_upstream_type: 'nai',
    nsfw_prompt_format: 'tags',
    nsfw_words: '',
};
const cfgOff = { ...cfgOn, nsfw_enabled: false };
const cfgNoUrl = { ...cfgOn, nsfw_base_url: '' };

// -- 1. Đánh giá --
ok('Thân bài bình thường không hit phân luồng (Công tắc bật)', directDivertDecide(cfgOn, SFW_BODY) === false);
ok('Thân bài NSFW hit phân luồng (Từ tiếng Việt: khoả thân)', directDivertDecide(cfgOn, NSFW_BODY) === true);
ok('Thân bài NSFW hit phân luồng (Từ tiếng Anh: explicit)', directDivertDecide(cfgOn, NSFW_BODY_EN) === true);
ok('Khi tắt công tắc phân luồng thì vĩnh viễn không hit', directDivertDecide(cfgOff, NSFW_BODY) === false);
ok('Khi địa chỉ phân luồng trống thì vĩnh viễn không hit', directDivertDecide(cfgNoUrl, NSFW_BODY) === false);
ok('Thân bài rỗng không hit', directDivertDecide(cfgOn, '') === false);

// -- 2. Phân tích hình thái kênh phân luồng --
const route = divertRoute(cfgOn);
ok('Hình thái kênh phân luồng là tags (Mặc định nai + tags)', route.mode === 'tags', route);
ok('Địa chỉ kênh phân luồng chính là nsfw_base_url', route.baseUrl === cfgOn.nsfw_base_url);

// -- 3. Nội dung gửi đi: Bắt buộc lấy thẻ tag của model phân tích, chứ không phải văn xuôi --
const sendToNai = selectPrompt(analyzedItem, route.mode);
ok('Phân luồng gửi đi là chuỗi thẻ Danbooru', sendToNai === analyzedItem.tags, sendToNai);
ok('Chuỗi thẻ không chứa thân bài văn xuôi', !sendToNai.includes('dang rộng hai chân') || sendToNai.length < 20, sendToNai);
ok('Chuỗi thẻ chứa thẻ bộ phận/hành động cụ thể (handjob)', sendToNai.includes('handjob'));
ok('Chuỗi thẻ chứa thẻ hành động cụ thể (spread legs)', sendToNai.includes('spread legs'));

// Hình thái kênh chính: Xuất trực tiếp bắt buộc vẫn là description (qwen ăn ngôn ngữ tự nhiên)
const mainMode = resolvePromptMode('auto', 'http://example-adapter.example.com', 'adapter');
ok('Hình thái kênh chính là description (Tuyến trên adapter)', mainMode === 'description', mainMode);

// -- 4. Biên: Khi sản phẩm phân tích thiếu tags (Về lý thuyết không xảy ra, phòng hờ) --
const noTags = { desc: 'Một đoạn mô tả', tags: '' };
const fallback = selectPrompt(noTags, 'tags');
ok('Khi sản phẩm phân tích thiếu tags thì lùi về desc (Phòng hờ, không gửi chuỗi rỗng)', fallback === 'Một đoạn mô tả');

// -- 5. Danh sách từ đánh giá --
ok('Danh sách từ tùy chỉnh có thể mở rộng (Thêm topless thì hit)', detectNsfw('Cô chỉ mặc áo topless ngắn', 'topless') === true);
ok('Từ tích hợp sẵn nsfw hit', detectNsfw('this image is nsfw', '') === true);
ok('Phân tích danh sách từ hỗ trợ dấu phẩy dấu chấm phẩy Anh Việt', parseWords('a，b;c,d').join(',') === 'a,b,c,d');
// Các tình huống người dùng thực tế test bị lọt lưới: Trong thân bài viết rõ làm tình/giao cấu nhưng không nhận diện được
ok('Thân bài "làm tình" hit (Sửa lỗi lọt lưới)', detectNsfw('Họ bắt đầu làm tình, trong phòng chỉ còn tiếng thở dốc.', '') === true);
ok('Thân bài "giao cấu" hit (Sửa lỗi lọt lưới)', detectNsfw('Giống như dã thú giao cấu vậy.', '') === true);
ok('Thân bài "quan hệ" hit', detectNsfw('Cảnh quan hệ.', '') === true);
ok('Thân bài "cởi đồ" hit', detectNsfw('Cô từ từ cởi đồ.', '') === true);
ok('Thân bài "hôn+ngực" hit', detectNsfw('Anh hôn lên ngực cô.', '') === true);
ok('Thân bài "Thẻ handjob" hit', detectNsfw('1girl, handjob, breasts', '') === true);
ok('Thân bài "Thẻ spread legs" hit', detectNsfw('spread legs, blush', '') === true);
// Cách viết ẩn ý (Không có từ khóa) vẫn không hit - Đây chính là tình huống cần dự phòng thử lại
ok('Cách viết ẩn ý không hit (Kích hoạt dự phòng thử lại)', detectNsfw('Hai người ôm nhau dưới ánh trăng, bầu không khí mập mờ.', '') === false);

// -- 6. Yêu cầu chọn ảnh sau khi hit phân luồng: Giao cho model phân tích tự phán đoán theo ngữ nghĩa, chứ không dùng từ khóa để chọn đoạn cứng nhắc --
// Tình huống người dùng: Đoạn đầu thân bài trò chuyện đời thường, đoạn giữa/cuối mới là cảnh người lớn thực sự - Nhưng vị trí không cố định,
// cũng có thể cả bài đều là nội dung người lớn. Do đó sau khi hit phân luồng chỉ báo cho model phân tích "Lần này là NSFW", để nó tự phán đoán
// khoảnh khắc nào mới là thời khắc người lớn thực sự và chọn ảnh dựa vào đó, cấm việc vì "Cảm giác hình ảnh" mà đi chọn đoạn dạo đầu đời thường.
const MIXED_BODY = [
    'Hai người trò chuyện về công việc gần đây trong quán cà phê, bầu không khí nhẹ nhàng, ánh nắng ngoài cửa sổ hắt lên mặt bàn.',
    '',
    'Cô cởi nút áo, để lộ nửa thân trên khoả thân, môi hai người dán vào nhau, hôn nhau say đắm.',
    '',
    'Đêm dần về khuya, họ ôm nhau nằm xuống, trong phòng chỉ còn lại ánh sáng của chiếc đèn ngủ.',
].join('\n');

ok('Đánh giá hit phân luồng: Bất kỳ vị trí nào của toàn bộ thân bài hit thì đều phân luồng', detectNsfw(MIXED_BODY, cfgOn.nsfw_words) === true);
ok('Thân bài bình thường không hit phân luồng', detectNsfw(SFW_BODY, cfgOn.nsfw_words) === false);

// -- 7. Chỉ thị nsfw được ghép vào request phân tích (Phán đoán ngữ nghĩa, không chọn đoạn trước) --
const nsfwParts = buildAnalysisParts(MIXED_BODY, '', 1, { nsfw: true });
ok('Chỉ thị nsfw ghép vào tin nhắn user: Đánh dấu lần này là hướng người lớn', nsfwParts.user.includes('hướng người lớn (NSFW)'));
ok('Chỉ thị nsfw ghép vào tin nhắn user: Yêu cầu tự phán đoán thời khắc người lớn', nsfwParts.user.includes('tự phán đoán'));
ok('Chỉ thị nsfw ghép vào tin nhắn user: Cấm chọn đoạn dạo đầu đời thường', nsfwParts.user.includes('dạo đầu đời thường'));
ok('Chỉ thị nsfw ghép vào tin nhắn user: Thân bài vẫn gửi xuống đầy đủ', nsfwParts.user.includes('quán cà phê'));
ok('Chỉ thị nsfw ghép vào tin nhắn user: Không chọn trước bất kỳ đoạn nào', !nsfwParts.user.includes('Đoạn bắt buộc phải chọn ảnh'));
const plainParts = buildAnalysisParts(MIXED_BODY, '', 1, {});
ok('Khi không có nsfw thì tin nhắn user không chứa chỉ thị NSFW', !plainParts.user.includes('hướng người lớn (NSFW)'));
ok('Khi không có nsfw thì tin nhắn user không chứa chỉ thị NSFW (Câu phán đoán ngữ nghĩa)', !plainParts.user.includes('tự phán đoán'));

// -- 8. Chế độ hỗn hợp (nsfw_mix = daily_nsfw / nsfw_only) --
const mixDaily = buildAnalysisParts(MIXED_BODY, '', 2, { nsfw: true, nsfwMix: 'daily_nsfw' });
ok('Chế độ hỗn hợp daily_nsfw: Yêu cầu 1 ảnh đời thường + 1 ảnh người lớn', mixDaily.user.includes('1 bức là cảnh đời thường') && mixDaily.user.includes('cảnh người lớn'), mixDaily.user.slice(0, 120));
ok('Chế độ hỗn hợp daily_nsfw: Vị trí đời thường mặc định auto (Tự chọn)', mixDaily.user.includes('do bạn tự chọn một thời điểm không phải người lớn'));
const mixDailyFront = buildAnalysisParts(MIXED_BODY, '', 2, { nsfw: true, nsfwMix: 'daily_nsfw', nsfwDailyPlace: 'front' });
ok('Chế độ hỗn hợp daily_nsfw + front: Đời thường lấy từ đoạn đầu thân bài', mixDailyFront.user.includes('lấy từ đoạn đầu thân bài'));
const mixDailyEnd = buildAnalysisParts(MIXED_BODY, '', 2, { nsfw: true, nsfwMix: 'daily_nsfw', nsfwDailyPlace: 'end' });
ok('Chế độ hỗn hợp daily_nsfw + end: Đời thường lấy từ đoạn cuối thân bài', mixDailyEnd.user.includes('lấy từ đoạn cuối thân bài'));
const mixNsfwOnly = buildAnalysisParts(MIXED_BODY, '', 2, { nsfw: true, nsfwMix: 'nsfw_only' });
ok('Chế độ hỗn hợp nsfw_only: Toàn bộ bắt buộc là cảnh người lớn', mixNsfwOnly.user.includes('Toàn bộ bắt buộc là cảnh người lớn'));
// daily_nsfw nhưng nsfw_max=1 -> Thoái hóa thành chỉ xuất NSFW (Đi vào nhánh ảnh đơn)
const mixDailyOne = buildAnalysisParts(MIXED_BODY, '', 1, { nsfw: true, nsfwMix: 'daily_nsfw' });
ok('daily_nsfw + 1 ảnh: Thoái hóa thành chỉ thị NSFW ảnh đơn', mixDailyOne.user.includes('cái khoảnh khắc thực sự xảy ra hành vi thân mật / người lớn đó'));

// -- 9. qwen xuất trực tiếp nhiều ảnh: Cắt theo đoạn (splitProseChunks) --
const CHUNK_BODY = 'Đoạn 1: Trò chuyện trong quán cà phê.\n\nĐoạn 2: Cô cởi nút áo.\n\nĐoạn 3: Nửa đêm ôm nhau nằm.\n\nĐoạn 4: Sáng sớm tỉnh dậy.';
const chunks2 = splitProseChunks(CHUNK_BODY, 2);
ok('Cắt 2 phần: Thu được 2 đoạn', chunks2.length === 2, chunks2);
ok('Cắt 2 phần: Phần 1 chứa nội dung đoạn đầu', chunks2[0].includes('quán cà phê'));
ok('Cắt 2 phần: Phần 2 chứa nội dung đoạn sau', chunks2[1].includes('Sáng sớm'));
const chunks4 = splitProseChunks(CHUNK_BODY, 4);
ok('Cắt 4 phần (Số đoạn=Số phần): Mỗi đoạn một phần', chunks4.length === 4);
const chunks6 = splitProseChunks(CHUNK_BODY, 6);
ok('Cắt 6 phần (Số đoạn<Số phần): Xuất theo số đoạn thực tế', chunks6.length === 4);
ok('Cắt thân bài rỗng: Trả về mảng rỗng', splitProseChunks('', 2).length === 0);
ok('Cắt thân bài một đoạn: Trả về một đoạn', splitProseChunks('Chỉ có một đoạn.', 3).length === 1);

// -- 10. Chèn vị trí đánh dấu khi xuất trực tiếp nhiều ảnh (applyProseMarkers): Mỗi ảnh cắm vào dưới đoạn văn tương ứng --
const markItems = [
    { prose: 'Cảnh A', at: CHUNK_BODY.indexOf('Đoạn 2') },
    { prose: 'Cảnh B', at: CHUNK_BODY.indexOf('Đoạn 3') },
];
const placed = applyProseMarkers(CHUNK_BODY, markItems);
ok('Chèn nhiều đánh dấu: Chèn Cảnh A sau đoạn 1', placed.includes('quán cà phê.\n\n[ILLUST: Cảnh A]'), placed);
ok('Chèn nhiều đánh dấu: Chèn Cảnh B sau đoạn 2', placed.includes('nút áo.\n\n[ILLUST: Cảnh B]'), placed);
ok('Chèn nhiều đánh dấu: Nội dung thân bài được giữ lại nguyên vẹn', placed.includes('Sáng sớm tỉnh dậy'));
const placedEmpty = applyProseMarkers(CHUNK_BODY, []);
ok('Chèn nhiều đánh dấu: Không có items trả về nguyên trạng', placedEmpty === CHUNK_BODY);
const placedAtEnd = applyProseMarkers('Chỉ có một đoạn.', [{ prose: 'Ảnh', at: -1 }]);
ok('Chèn nhiều đánh dấu: at vượt biên thì treo ở cuối', placedAtEnd.endsWith('[ILLUST: Ảnh]'), placedAtEnd);

console.log(`\nRESULT: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);