// V.Canvas offline self-test.
//
// Khởi động một service giao thức NovelAI giả lập trên 127.0.0.1:18999 và chạy toàn bộ luồng
// "Giao thức NAI -> ZIP -> base64" cộng thêm tất cả các nhánh phân tích marker / thay thế tại chỗ.
// Không cần bật SillyTavern.
//
//   1) python make_fixtures.py
//   2) node test.mjs
//
// JSZip lấy từ bản cài đặt của SillyTavern (extension không bao giờ tự đóng gói bản copy riêng).
// Đặt biến ST_JSZIP trỏ đến nó; nếu không sẽ dò tìm các vị trí cài đặt thông thường.
// Các label báo cáo cố tình dùng ASCII: console codepage của Windows làm vỡ output CJK.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.window = globalThis; // Giả lập trình duyệt: Trong trang SillyTavern, window.JSZip đã được mount sẵn bởi <script>

const here = path.dirname(fileURLToPath(import.meta.url));
const zipBytes = fs.readFileSync(path.join(here, 'image_0.zip'));
const pngBytes = fs.readFileSync(path.join(here, 'image_0.png'));

const jszipPath = [
    process.env.ST_JSZIP,
    // Bản cài đặt -> <ST>/data/default-user/extensions/<ext>/test/
    path.resolve(here, '../../../../../public/lib/jszip.min.js'),
    path.resolve(here, '../../../public/lib/jszip.min.js'),
].filter(Boolean).find((p) => fs.existsSync(p));
if (!jszipPath) {
    console.error('[Lỗi nghiêm trọng] Không tìm thấy JSZip. Chạy lệnh kèm theo ST_JSZIP=<path/to/jszip.min.js>.');
    process.exit(2);
}
await import(pathToFileURL(jszipPath).href);

const mode = { value: 'zip' };
let lastPayload = null;
let lastQuery = '';
let lastAuth = '';

const server = http.createServer((req, res) => {
    if (req.url === '/ai/user/subscription') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tier: 0, active: true, subscription: { tier: 0, active: true, expiresAt: 0 } }));
        return;
    }
    if (req.url.startsWith('/ai/generate-image')) {
        lastQuery = req.url;
        lastAuth = String(req.headers.authorization ?? '');
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            lastPayload = JSON.parse(body);
            // V.Adapter khi expand=1 sẽ trả về prompt thực tế được gửi cho tuyến trên và trạng thái trong header phản hồi
            const extra = /[?&]expand=1(?:&|$)/.test(req.url)
                ? {
                    'X-Illust-Via': 'images',
                    'X-Illust-Expand': 'ok',
                    'X-Illust-Prompt': encodeURIComponent('Prompt tiếng Việt sau khi mở rộng long form'),
                }
                : {};
            switch (mode.value) {
                case 'zip': res.writeHead(200, { 'Content-Type': 'application/zip', ...extra }); res.end(zipBytes); break;
                case 'raw': res.writeHead(200, { 'Content-Type': 'image/png', ...extra }); res.end(pngBytes); break;
                case 'err': res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'CONTENT_POLICY_REJECTED', statusCode: 502 })); break;
                case 'json200': res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'CIRCUIT_OPEN' })); break;
                case 'empty': res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end(Buffer.alloc(0)); break;
                case 'b64': res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ b64_json: pngBytes.toString('base64') }] })); break;
                case 'neko': res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ images: [{ image: pngBytes.toString('base64'), index: 0, seed: 0 }] })); break;
                default: res.writeHead(500); res.end('nope');
            }
        });
        return;
    }
    res.writeHead(404);
    res.end('nope');
});

await new Promise(r => server.listen(18999, '127.0.0.1', r));

const { generateIllustration, testConnection } = await import('../lib/nai-api.js');
const { findMarkers, buildDisplayText, stripMarkers, hasMarkers, effectiveSource, resolvePromptMode, selectPrompt, isLocalUpstream, MAX_MARKER_LEN, redistributeMarkers, isTailClustered } = await import('../lib/marker.js');
const { detectNsfw, parseWords, buildWordList } = await import('../lib/nsfw.js');
const { parseAnalysisJSON, applyMarkers, findAnchor, buildAnalysisMessages, buildAnalysisParts, analysisTokenBudget, resolveCtxSource, directAppliesTo, buildDirectProse, proseToMarker, applyProseMarker, DIRECT_PROSE_MAX, DIRECT_GUIDE, pickProseAnchor } = await import('../lib/analysis.js');
const { artistAppliesTo, artistPromptFor, withArtistPrompt, sanitizeArtistPrompt, sanitizeArtistName, ARTIST_PROMPT_MAX } = await import('../lib/artist.js');

let pass = 0, fail = 0;
const report = [];
function ok(name, cond, extra = '') {
    if (cond) { pass++; report.push(`[OK]   ${name}`); }
    else { fail++; report.push(`[FAIL] ${name} :: ${extra}`); }
}

report.push(`JSZip loaded: ${typeof globalThis.JSZip}`);
report.push('', '== marker.js ==');

const SRC = 'A\n[ILLUST: one | 1girl]\nB\n[ILLUST: two | 2girls]\nC';
{
    const a = findMarkers('X\n\n[ILLUST: a girl on a neon street | 1girl, silver hair, neon] \n\nY');
    ok('single standard marker', a.length === 1);
    ok('tags win over description', a[0]?.prompt === '1girl, silver hair, neon', JSON.stringify(a[0]));
    ok('exact start/end offsets', a[0] && 'X\n\n[ILLUST: a girl on a neon street | 1girl, silver hair, neon] \n\nY'.slice(a[0].start, a[0].end) === a[0].raw, JSON.stringify(a[0]));

    const b = findMarkers('[ILLUST\uFF1Aa rainy roof]\nx');
    ok('full-width colon + no pipe -> desc fallback', b.length === 1 && b[0].prompt === 'a rainy roof', JSON.stringify(b));

    const c = findMarkers('[ILLUST:   spaced   out   |   a,  b ,c  ]');
    ok('extra spaces normalised', c.length === 1 && c[0].desc === 'spaced out' && c[0].tags === 'a, b ,c', JSON.stringify(c));

    const d = findMarkers('[ILLUST:\nCN desc | 1girl\n]');
    ok('newline inside marker tolerated', d.length === 1 && d[0].prompt === '1girl', JSON.stringify(d));

    ok('no marker -> empty', findMarkers('plain text, nothing here.').length === 0);
    ok('hasMarkers quick check', hasMarkers('x [ILLUST: y] z') && !hasMarkers('x y z'));

    const multi = findMarkers(SRC);
    ok('two markers numbered in order', multi.length === 2 && multi[0].index === 0 && multi[1].index === 1, JSON.stringify(multi.map(m => m.index)));

    const dt = buildDisplayText(SRC, ['/api/images/a.png', null]);
    ok('inline replace below its own paragraph', dt === 'A\n\n![Illustration](/api/images/a.png)\n\nB\n[ILLUST: two | 2girls]\nC', JSON.stringify(dt));

    // -- Bắt buộc phải encode khi URL chứa dấu cách/dấu ngoặc đơn, nếu không Markdown sẽ parse lỗi, ảnh sẽ hiển thị thành văn bản thuần túy --
    {
        const spaced = buildDisplayText(SRC, ['/user/images/Sample Character/a b(1).png', null]);
        const m = (spaced || '').match(/!\[[^\]]*\]\(([^)]*)\)/);
        ok('markdown url with spaces/parens gets encoded', !!m && m[1].length > 0 && !/\s|\(/.test(m[1]) && m[1].includes('%20'), m && m[1]);
        ok('encoded url still points at the same file', !!m && decodeURIComponent(m[1]) === '/user/images/Sample Character/a b(1).png', m && m[1]);
    }
    ok('no triple newline leftover', !!dt && !/\n{3,}/.test(dt), JSON.stringify(dt));
    ok('failed marker left untouched', !!dt && dt.includes('[ILLUST: two | 2girls]'));
    ok('all failed -> null', buildDisplayText(SRC, [null, null]) === null);

    // -- pending='drop': Marker chưa xuất ảnh phải được xóa khỏi lớp hiển thị, không được để lọt prompt vào thân bài --
    // Nếu giữ nguyên văn marker của tấm thứ hai sau khi tấm thứ nhất xuất xong, vài trăm chữ prompt sẽ trực tiếp phơi ra trong khung chat,
    // mang lại cảm giác "Ảnh chưa ra, chỉ thấy một đống chữ", trong khi thực tế tấm đầu tiên đã tạo xong.
    {
        const one = buildDisplayText(SRC, ['/api/images/a.png', null], 'Illustration', 'drop');
        ok('drop: finished image is kept', !!one && one.includes('![Illustration](/api/images/a.png)'));
        ok('drop: pending marker removed, prompt text does not leak', !!one && !one.includes('ILLUST'), JSON.stringify(one));
        ok('drop: prose before and after the pending marker survives', !!one && one.includes('A') && one.includes('B') && one.includes('C'), JSON.stringify(one));
        ok('drop: paragraphs are not glued together', !!one && /B\nC/.test(one), JSON.stringify(one));

        const none = buildDisplayText(SRC, [null, null], 'Illustration', 'drop');
        ok('drop: nothing ready yet -> clean prose without markers', !!none && !none.includes('ILLUST') && none.includes('A') && none.includes('C'), JSON.stringify(none));
    }

    const stripped = stripMarkers(SRC);
    ok('stripMarkers removes markers, no leftover blank lines', !stripped.includes('ILLUST') && !/\n{3,}/.test(stripped), JSON.stringify(stripped));
    ok('stripMarkers idempotent', stripMarkers(stripped) === stripped);
    ok('stripMarkers keeps surrounding prose', stripped.startsWith('A') && stripped.endsWith('C'), JSON.stringify(stripped));
}

report.push('', '== prompt format (prompt_format) ==');
{
    // Phân luồng đường dẫn: Service chuyển đổi local (Qua V.Adapter) gửi mô tả, còn lại gửi thẻ tag
    ok('auto + local adapter -> description', resolvePromptMode('auto', 'http://127.0.0.1:8888') === 'description');
    ok('auto + localhost -> description', resolvePromptMode('auto', 'http://localhost:8888') === 'description');
    ok('auto + official NAI -> tags', resolvePromptMode('auto', 'https://image.novelai.net') === 'tags');
    ok('auto + NAI gateway -> tags', resolvePromptMode('auto', 'https://example-nai-gateway.example.com') === 'tags');
    ok('auto + empty base -> tags', resolvePromptMode('auto', '') === 'tags');
    ok('explicit modes win over auto', resolvePromptMode('description', 'https://image.novelai.net') === 'description'
        && resolvePromptMode('tags', 'http://127.0.0.1:8888') === 'tags'
        && resolvePromptMode('both', '') === 'both');
    ok('unknown value falls back to auto behaviour', resolvePromptMode('nope', 'http://127.0.0.1:8888') === 'description');
    ok('isLocalUpstream detects adapter port', isLocalUpstream('http://127.0.0.1:8888') && !isLocalUpstream('https://image.novelai.net'));

    // -- Khai báo rõ loại tuyến trên (upstream_type) --
    // Địa chỉ không thể phân biệt "Service chuyển đổi deploy từ xa" và "Gateway NAI bên thứ ba" - Cả hai đều là tên miền từ xa.
    // Service chuyển đổi deploy trên VPS sẽ bị đoán nhầm thành tuyến trên dạng tag, việc này chỉ có thể do người dùng khai báo.
    const REMOTE_ADAPTER = 'https://novelai-ln.example.cfd';
    ok('auto + remote adapter -> tags (the misjudgement this fixes)',
        resolvePromptMode('auto', REMOTE_ADAPTER) === 'tags');
    ok('declared adapter wins over a remote address',
        resolvePromptMode('auto', REMOTE_ADAPTER, 'adapter') === 'description');
    ok('declared nai wins over a local address',
        resolvePromptMode('auto', 'http://127.0.0.1:8888', 'nai') === 'tags');
    ok('declared adapter does not override an explicit format',
        resolvePromptMode('tags', REMOTE_ADAPTER, 'adapter') === 'tags');
    ok('declared nai does not override an explicit format',
        resolvePromptMode('description', 'https://image.novelai.net', 'nai') === 'description');
    ok('unknown upstream type falls back to address guessing',
        resolvePromptMode('auto', 'http://127.0.0.1:8888', 'whatever') === 'description'
        && resolvePromptMode('auto', REMOTE_ADAPTER, 'whatever') === 'tags');

    const full = { desc: 'a knight in old chainmail', tags: '1boy, chainmail, sword' };
    ok('selectPrompt description', selectPrompt(full, 'description') === 'a knight in old chainmail');
    ok('selectPrompt tags', selectPrompt(full, 'tags') === '1boy, chainmail, sword');
    ok('selectPrompt both keeps desc first', selectPrompt(full, 'both') === 'a knight in old chainmail, 1boy, chainmail, sword');

    const onlyDesc = { desc: 'a rainy roof', tags: '' };
    const onlyTags = { desc: '', tags: '1girl, neon' };
    ok('missing tags -> description falls back to desc', selectPrompt(onlyTags, 'description') === '1girl, neon');
    ok('missing desc -> tags falls back to tags', selectPrompt(onlyDesc, 'tags') === 'a rainy roof');
    ok('missing desc -> both keeps the present half', selectPrompt(onlyDesc, 'both') === 'a rainy roof');
    ok('empty marker -> empty string', selectPrompt({ desc: '', tags: '' }, 'both') === '');

    // Hai nửa của marker tương ứng với hai loại tuyến trên: Kết quả phân tích phải khớp với các trường của findMarkers
    const mk = findMarkers('[ILLUST: a knight in old chainmail | 1boy, chainmail, sword]')[0];
    ok('marker exposes both halves', mk.desc === 'a knight in old chainmail' && mk.tags === '1boy, chainmail, sword');
    ok('local pipeline gets the description', selectPrompt(mk, resolvePromptMode('auto', 'http://127.0.0.1:8888')) === mk.desc);
    ok('direct pipeline gets the tags', selectPrompt(mk, resolvePromptMode('auto', 'https://image.novelai.net')) === mk.tags);
}

report.push('', '== analysis.js (Xuất ảnh theo context) ==');
{
    // -- Phân tích: Chấp nhận đủ mọi dạng bọc (wrapper) --
    const one = parseAnalysisJSON('{"images":[{"desc":"a girl","tags":"1girl","anchor":"Cô đứng trước cửa sổ"}]}');
    ok('plain JSON parsed', one.length === 1 && one[0].desc === 'a girl' && one[0].tags === '1girl', JSON.stringify(one));

    const fenced = parseAnalysisJSON('```json\n{"images":[{"desc":"d","tags":"t","anchor":"a"}]}\n```');
    ok('markdown fence tolerated', fenced.length === 1, JSON.stringify(fenced));

    const chatty = parseAnalysisJSON('Được thôi, kết quả dưới đây:\n{"images":[{"desc":"d","tags":"t","anchor":"a"}]}\nHi vọng có ích.');
    ok('surrounding prose tolerated', chatty.length === 1, JSON.stringify(chatty));

    const topArr = parseAnalysisJSON('[{"desc":"d1","tags":"t1"},{"desc":"d2","tags":"t2"}]');
    ok('top-level array tolerated', topArr.length === 2, JSON.stringify(topArr));

    ok('empty list -> []', parseAnalysisJSON('{"images":[]}').length === 0);
    ok('garbage -> []', parseAnalysisJSON('not json at all').length === 0);
    ok('entry without desc/tags dropped', parseAnalysisJSON('{"images":[{"anchor":"x"}]}').length === 0);
    ok('capped at 6', parseAnalysisJSON(JSON.stringify({ images: new Array(9).fill({ desc: 'd', tags: 't' }) })).length === 6);

    // -- Định vị --
    const SRC2 = 'Đoạn một không có hình ảnh.\nCô đứng trước cửa sổ đêm mưa, ngắm nhìn ánh đèn neon.\nĐoạn ba cũng vậy.';
    ok('anchor found verbatim', findAnchor(SRC2, 'Cô đứng trước cửa sổ đêm mưa, ngắm nhìn ánh đèn neon.') >= 0);
    ok('anchor found with collapsed whitespace', findAnchor(SRC2, 'Cô đứng trước cửa sổ đêm mưa,\nngắm nhìn ánh đèn neon.') >= 0);
    ok('missing anchor -> -1', findAnchor(SRC2, 'Câu này căn bản không tồn tại') === -1);

    // -- Chèn --
    const items = [
        { desc: 'a girl by the window', tags: '1girl, night, neon', anchor: 'Cô đứng trước cửa sổ đêm mưa, ngắm nhìn ánh đèn neon.' },
        { desc: 'a cat on the roof', tags: 'cat, roof', anchor: 'Câu này không tồn tại' },
    ];
    const withMarkers = applyMarkers(SRC2, items);
    const mk = findMarkers(withMarkers);
    ok('two markers produced', mk.length === 2, JSON.stringify(withMarkers));
    ok('anchored marker sits right under its paragraph',
        withMarkers.indexOf('Cô đứng trước cửa sổ đêm mưa, ngắm nhìn ánh đèn neon.\n[ILLUST:') > 0, JSON.stringify(withMarkers));
    ok('unmatched anchor appended at the tail',
        withMarkers.trimEnd().endsWith('[ILLUST: a cat on the roof | cat, roof]'), JSON.stringify(withMarkers));
    ok('marker carries both halves', mk[0].desc === 'a girl by the window' && mk[0].tags === '1girl, night, neon', JSON.stringify(mk[0]));

    // Các ký tự phá vỡ cú pháp marker phải được làm sạch
    const dirty = applyMarkers(SRC2, [{ desc: 'a | b ] c', tags: 'x]|y', anchor: '' }]);
    const dMarker = dirty.match(/\[ILLUST:[^\]]*\]/)?.[0] ?? '';
    ok('pipe/bracket sanitised out of marker body', findMarkers(dirty).length === 1, JSON.stringify(dirty));
    ok('marker keeps exactly one pipe as the separator', dMarker.split('|').length === 2, dMarker);
    ok('marker body free of stray brackets', !dMarker.slice(1, -1).includes(']'), dMarker);

    ok('no items -> text unchanged', applyMarkers(SRC2, []) === SRC2);
    ok('empty text -> unchanged', applyMarkers('', items) === '');
    ok('same anchor used twice inserted once', findMarkers(applyMarkers(SRC2, [items[0], items[0]])).length === 1);

    // -- Quy tắc độ dài: Khi model phân tích viết desc quá dài, marker không được phép bị MAX_MARKER_LEN(1200) của marker.js bỏ rơi --
    {
        const longDesc = 'Một đoạn mô tả rất dài'.repeat(200);      // ~4400 ký tự
        const longTags = 'tag,'.repeat(200);           // 800 ký tự
        const parsed = parseAnalysisJSON(JSON.stringify({ images: [{ desc: longDesc, tags: longTags, anchor: 'Đoạn ba cũng vậy.' }] }));
        ok('long desc truncated by parse', parsed.length === 1 && parsed[0].desc.length <= 700, String(parsed[0]?.desc?.length));
        // Cắt bớt phải lùi về dấu phẩy gần nhất: Không cắt ngang từ, và ngay sau điểm cắt là dấu phẩy của nguyên văn
        const tg = parsed[0].tags;
        const ti = longTags.indexOf(tg);
        ok('long tags truncated at a comma boundary', tg.length <= 400 && ti === 0 && longTags[tg.length] === ',', tg.slice(-20) + ` len=${tg.length}`);

        const out = applyMarkers(SRC2, [{ desc: longDesc, tags: longTags, anchor: 'Đoạn ba cũng vậy.' }]);
        const found = findMarkers(out);
        ok('long item still yields a usable marker (not silently dropped)', found.length === 1, JSON.stringify(out).slice(0, 200));

        // Khẳng định mối quan hệ ràng buộc: Marker vượt quá MAX_MARKER_LEN thực sự sẽ bị loại bỏ, vì vậy phía tuyến trên (analysis) phải tự động siết lại độ dài.
        // Độ dài được nội suy từ hằng số, khi thay đổi giới hạn thì assertion này sẽ tự động chạy theo.
        const tooLong = `[ILLUST: ${'x'.repeat(MAX_MARKER_LEN)} | y]`;
        ok('oversized marker IS dropped by findMarkers (why analysis.js clamps)', findMarkers(tooLong).length === 0);

        // Mô tả 1000 chữ + tag 400 chữ sau khi bị siết lại vẫn phải được parse ra đầy đủ
        const big = applyMarkers(SRC2, [{ desc: longDesc, tags: longTags, anchor: '' }]);
        const bigMk = findMarkers(big);
        ok('clamped long marker survives findMarkers', bigMk.length === 1 && bigMk[0].desc.length >= 500, String(bigMk[0]?.desc?.length));
    }

    // -- Thông tin tác phẩm / Yêu cầu phong cách phải đi vào request phân tích --
    {
        const msgs = buildAnalysisMessages('Thân bài', 'Phần trước', 3, { work: 'Thẻ nhân vật: Nhân vật mẫu', style: 'Phong cách mẫu' });
        const user = msgs[1].content;
        ok('work label included in the request', user.includes('【Thông tin tác phẩm】') && user.includes('Nhân vật mẫu'), user.slice(0, 80));
        ok('style hint included in the request', user.includes('【Yêu cầu phong cách】') && user.includes('Phong cách mẫu'));
        ok('max propagated into the request', user.includes('Lần này xuất tối đa 3 khung hình'));
        const bare = buildAnalysisMessages('Thân bài', '', 1);
        ok('empty meta adds no empty sections', !bare[1].content.includes('【Thông tin tác phẩm】') && !bare[1].content.includes('【Yêu cầu phong cách】'));
        const jbm = buildAnalysisMessages('Thân bài', '', 1, { jb: 'TEST_JB_WORDS' });
        ok('jb prompt prepended to the request', jbm[1].content.startsWith('【Hướng dẫn bổ sung】\nTEST_JB_WORDS'), JSON.stringify(jbm[1].content.slice(0, 40)));
        const jbEmpty = buildAnalysisMessages('Thân bài', '', 1, { jb: '' });
        ok('empty jb adds no section', !jbEmpty[1].content.includes('【Hướng dẫn bổ sung】'));    }

    // -- Tương thích với luồng xử lý hiện tại: Marker -> Thay thế tại chỗ bằng ảnh --
    const dt2 = buildDisplayText(withMarkers, ['/api/images/a.png', null]);
    ok('analysis result renders as an inline image under the anchor paragraph',
        !!dt2 && dt2.includes('Cô đứng trước cửa sổ đêm mưa, ngắm nhìn ánh đèn neon.\n\n![Illustration](/api/images/a.png)'), JSON.stringify(dt2));
    ok('the failed one stays as a marker', !!dt2 && dt2.includes('[ILLUST: a cat on the roof'));
    ok('stripping leaves clean prose', !stripMarkers(withMarkers).includes('ILLUST'), JSON.stringify(stripMarkers(withMarkers)));
}

report.push('', '== Nguồn phân tích và Ngân sách đầu ra ==');
{
    // Hai nhánh phân tích (Mượn API chính / Service tùy chỉnh) dùng chung một cấu trúc prompt và một ngân sách token,
    // Ở đây chốt chặt việc "dùng chung", tránh trường hợp sau này sửa một bên quên một bên làm hành vi bị lệch.
    const meta = { work: 'Thẻ nhân vật: Nhân vật mẫu', style: 'Phong cách mẫu', quality: 'Q', negative: 'N', jb: 'JB' };
    const parts = buildAnalysisParts('Thân bài', 'Phần trước', 3, meta);
    const msgs = buildAnalysisMessages('Thân bài', 'Phần trước', 3, meta);
    ok('buildAnalysisParts system matches buildAnalysisMessages', parts.system === msgs[0].content);
    ok('buildAnalysisParts user matches buildAnalysisMessages', parts.user === msgs[1].content);
    ok('buildAnalysisParts role shape is system+user only', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');

    // Ngân sách đầu ra: Phóng to theo số lượng ảnh và bị giới hạn trần - Vượt quá giới hạn sẽ khiến JSON bị cắt đứt,
    // biểu hiện là "Phân tích thành công nhưng không ra một bức ảnh nào", do đó cả giới hạn trần và hệ số phóng to đều phải chốt chặt.
    ok('budget grows with image count', analysisTokenBudget(2) > analysisTokenBudget(1));
    ok('budget for 1 image stays usable', analysisTokenBudget(1) === 1800, String(analysisTokenBudget(1)));
    ok('budget for max 6 images = 7800', analysisTokenBudget(6) === 7800, String(analysisTokenBudget(6)));
    // Giới hạn trần chỉ là mức bảo hiểm: Số lượng 1~6 ảnh cho phép đều không chạm tới, đầu vào vượt biên mới bị kẹp lại.
    ok('budget capped at 8192 for out-of-range input', analysisTokenBudget(99) === 8192, String(analysisTokenBudget(99)));
    ok('budget tolerates junk input', analysisTokenBudget(undefined) === analysisTokenBudget(1) && analysisTokenBudget('x') === analysisTokenBudget(1));

    // Parse nguồn: Quyết định xem vòng này có thực sự gửi request hay không, ba kết quả đều phải chốt chặt.
    ok('source main wins by default', resolveCtxSource('main', {}) === 'main');
    ok('source unknown value falls back to main', resolveCtxSource('whatever', {}) === 'main');
    ok('source undefined falls back to main', resolveCtxSource(undefined, {}) === 'main');
    ok('source custom with url+model -> custom',
        resolveCtxSource('custom', { url: 'http://127.0.0.1:4000/v1', model: 'qwen3.8-max' }) === 'custom');
    ok('source custom missing model -> null',
        resolveCtxSource('custom', { url: 'http://127.0.0.1:4000/v1', model: '' }) === null);
    ok('source custom missing url -> null',
        resolveCtxSource('custom', { url: '', model: 'm' }) === null);
    ok('source custom with blank-only fields -> null',
        resolveCtxSource('custom', { url: '   ', model: '  ' }) === null);
}

report.push('', '== Xuất trực tiếp (Văn sinh ảnh) ==');
{
    // -- Rào cản hình thái: Chế độ này có thể thiết lập hay không phụ thuộc hoàn toàn vào phán đoán này --
    // Khi kết nối trực tiếp NAI chính thức thì dữ liệu gửi đi là thẻ tag, nhồi cả đoạn văn xuôi tiếng Việt vào đó không khác gì đút nhiễu, bắt buộc phải chặn lại.
    ok('direct applies to description mode', directAppliesTo('description') === true);
    ok('direct applies to both mode', directAppliesTo('both') === true);
    ok('direct never applies to tags mode (official NAI)', directAppliesTo('tags') === false);
    ok('direct unknown mode does not apply', directAppliesTo('nope') === false && directAppliesTo(undefined) === false);

    // -- Lắp ráp payload --
    // Chỉ thị vẽ tích hợp sẵn luôn được đặt ở đầu: Nó thay thế những gì model phân tích vốn dĩ sẽ làm như "Chọn một khoảnh khắc /
    // Phục dựng nhân vật theo văn bản / Không vẽ đối thoại", nếu thiếu nó, nguyên một đoạn văn có hội thoại rất dễ sinh ra quái vật chắp vá.
    ok('built-in guide always leads', buildDirectProse('Cô mở cửa.').startsWith(DIRECT_GUIDE));
    ok('body always comes last', buildDirectProse('Cô mở cửa.').endsWith('Cô mở cửa.'));
    ok('empty body yields nothing to send', buildDirectProse('') === '' && buildDirectProse('   ') === '');
    ok('empty body with style still yields nothing', buildDirectProse('', { style: 'Vẽ dày' }) === '');
    ok('style sits between guide and body', buildDirectProse('Thân bài', { style: 'Vẽ dày' }).includes('【Phong cách】Vẽ dày\n\nThân bài'));
    ok('quality follows style', buildDirectProse('Thân bài', { style: 'Vẽ dày', quality: 'masterpiece' })
        .indexOf('【Phong cách】Vẽ dày') < buildDirectProse('Thân bài', { style: 'Vẽ dày', quality: 'masterpiece' }).indexOf('【Chất lượng】masterpiece'));
    ok('user guide is appended after the built-in one',
        buildDirectProse('Thân bài', { guide: 'Dùng ống kính góc rộng' }).indexOf(DIRECT_GUIDE) === 0
        && buildDirectProse('Thân bài', { guide: 'Dùng ống kính góc rộng' }).includes('Dùng ống kính góc rộng'));
    ok('work info is included', buildDirectProse('Thân bài', { work: 'Thẻ nhân vật: Mẫu' }).includes('【Thông tin tác phẩm】\nThẻ nhân vật: Mẫu'));
    // Prompt tiêu cực cứ ghép vào bình thường: Nó mặc định rỗng, điền vào mới tính là người dùng chủ động lựa chọn,
    // tự chịu tác dụng phụ (Nếu thật sự bị thì cứ xóa trống trường đó đi là xong), plugin không nên thay người dùng quyết định không đưa vào.
    ok('negative is passed through when filled',
        buildDirectProse('Thân bài', { negative: 'lowres, bad anatomy' }).includes('【Prompt tiêu cực】lowres, bad anatomy'));
    ok('empty negative adds nothing', buildDirectProse('Thân bài', { negative: '   ' }) === buildDirectProse('Thân bài'));
    ok('negative sits after quality', buildDirectProse('Thân bài', { quality: 'Q', negative: 'N' })
        .indexOf('【Chất lượng】Q') < buildDirectProse('Thân bài', { quality: 'Q', negative: 'N' }).indexOf('【Prompt tiêu cực】N'));

    // Bảo vệ độ dài tổng: Tổng thể chỉ thị + Thân bài không được vượt quá DIRECT_PROSE_MAX, nếu không marker được bọc sẽ bị vứt bỏ nguyên vẹn
    // (Biểu hiện là request đã gửi, ảnh đã nhận, nhưng thân bài chẳng hiển thị gì, và không có lỗi nào báo ra).
    const bigBody = buildDirectProse('Dài'.repeat(9000));
    ok('guide + body stays within the prose limit', bigBody.length <= DIRECT_PROSE_MAX, String(bigBody.length));
    ok('very long body still yields a parseable marker', findMarkers(proseToMarker(bigBody)).length === 1);

    // -- Bọc thành marker --
    // Cố tình không có đoạn `|`: Regex của findMarkers yêu cầu sau `|` phải có ít nhất một ký tự không phải `]`,
    // `[ILLUST: x | ]` sẽ không thể match toàn bộ - Im lặng nuốt chửng, không báo lỗi.
    ok('prose to marker has no pipe segment', proseToMarker('Thân bài') === '[ILLUST: Thân bài]');
    ok('empty prose yields no marker', proseToMarker('') === '' && proseToMarker('   ') === '');
    ok('pipe and brackets are neutralised', proseToMarker('a|b [c]') === '[ILLUST: a/b c]');
    ok('newlines collapse to spaces', proseToMarker('Giáp\n\nẤt') === '[ILLUST: Giáp Ất]');

    // -- Bảo vệ độ dài --
    // Marker vượt quá MAX_MARKER_LEN sẽ bị findMarkers ném bỏ nguyên vẹn, biểu hiện là "Request đã gửi đi,
    // ảnh cũng đã lấy được, nhưng trong thân bài chẳng hiện gì cả", và không hề có một dòng báo lỗi. Luật này phải chốt cứng.
    const longMarker = proseToMarker('Dài'.repeat(5000));
    ok('overlong prose is truncated to fit the marker guard', longMarker.length <= MAX_MARKER_LEN, String(longMarker.length));
    ok('overlong marker still parses', findMarkers(longMarker).length === 1);
    ok('exactly-at-limit marker survives', findMarkers(proseToMarker('x'.repeat(DIRECT_PROSE_MAX))).length === 1);

    // -- Nối vào cuối thân bài, và có thể được tiêu thụ bởi luồng hiển thị sẵn có --
    const body = 'Đoạn một.\n\nĐoạn hai.';
    const src = applyProseMarker(body, 'Nội dung đoạn hai');
    ok('prose marker appended at the end', src.endsWith('[ILLUST: Nội dung đoạn hai]'));
    ok('original body is untouched', src.startsWith(body));
    const ms = findMarkers(src);
    ok('exactly one marker in direct source', ms.length === 1);
    ok('marker desc is the prose', ms[0].desc === 'Nội dung đoạn hai');
    // Xuất trực tiếp được cố định ở mức description, nhưng mức tag cũng phải lấy được thân bài (nếu không sẽ gửi chuỗi rỗng).
    ok('selectPrompt(description) returns the prose', selectPrompt(ms[0], 'description') === 'Nội dung đoạn hai');
    ok('selectPrompt(tags) falls back to the prose', selectPrompt(ms[0], 'tags') === 'Nội dung đoạn hai');
    ok('selectPrompt(both) returns the prose', selectPrompt(ms[0], 'both') === 'Nội dung đoạn hai');
    ok('display text renders one image', /!\[Illustration\]\(img\)/.test(buildDisplayText(src, ['img'], 'Illustration', 'drop')));
    ok('empty prose leaves the body alone', applyProseMarker(body, '') === body);
    ok('empty body leaves it alone', applyProseMarker('', 'Thân bài') === '');

    // -- Điểm thả neo (Anchor): Khi không qua model phân tích, ảnh không nên luôn bị treo ở tít dưới cùng --
    const rep = [
        '“Cuối cùng cậu cũng đến rồi.” Cô nói.',
        'Hoàng hôn nhuộm cả con phố thành màu cam, chiếc áo sơ mi trắng trên dây phơi bị gió thổi tung, từ xa vọng lại tiếng rao dọn hàng.',
        '“Xin lỗi, trên đường bị chậm trễ chút.”',
        'Anh thả chiếc túi vải bạt cũ kỹ trên vai xuống, đưa tay chỉ về phía tiệm mì vẫn còn sáng đèn ở góc phố.',
    ].join('\n\n');

    ok('picks a paragraph, not the end', pickProseAnchor(rep) > 0 && pickProseAnchor(rep) < rep.length);
    // Tiêu chí là "Độ dài đoạn tự sự còn lại sau khi bỏ đi hội thoại" - Những đoạn dày đặc hội thoại không được phép chọn
    const chosen = rep.slice(0, pickProseAnchor(rep));
    ok('never lands on a pure-dialogue paragraph', !chosen.trimEnd().endsWith('”'));
    ok('lands after the longest narrative paragraph',
        chosen.includes('chiếc áo sơ mi trắng trên dây phơi bị gió thổi tung'));

    ok('single paragraph -> no anchor (falls back to the end)', pickProseAnchor('Chỉ có một đoạn, không có dòng trống.') === -1);
    ok('all-dialogue text -> no anchor', pickProseAnchor('“A”\n\n“B”\n\n“C”') === -1);
    ok('empty text -> no anchor', pickProseAnchor('') === -1 && pickProseAnchor(null) === -1);

    const placed = applyProseMarker(rep, 'Tải trọng thân bài', pickProseAnchor(rep));
    const pm = findMarkers(placed);
    ok('placed marker still parses to exactly one', pm.length === 1);
    ok('placed marker sits between paragraphs, not at the end',
        placed.indexOf('[ILLUST:') < placed.length - 20 && placed.trimEnd().endsWith('góc phố.'));
    ok('text before and after survives intact',
        placed.includes('Cô nói.') && placed.includes('góc phố.'));
    ok('explicit end placement still appends',
        applyProseMarker(rep, 'Tải trọng', -1).trimEnd().endsWith('[ILLUST: Tải trọng]'));
    ok('out-of-range index falls back to the end',
        applyProseMarker(rep, 'Tải trọng', 9999).trimEnd().endsWith('[ILLUST: Tải trọng]'));

    // Loop toàn bộ luồng: Thân bài -> Lắp ráp tải trọng -> Bọc thành marker -> Nối thêm -> Có thể tiêu thụ bởi luồng hiển thị sẵn có
    const e2e = applyProseMarker('Nội dung thân bài', buildDirectProse('Nội dung thân bài', {
        guide: 'G', work: 'W', style: 'Vẽ dày', quality: 'Q',
    }));
    ok('e2e: pick + place + parse works with a real shape',
        findMarkers(applyProseMarker(rep, buildDirectProse(rep, { style: 'Vẽ dày' }), pickProseAnchor(rep))).length === 1);
    ok('end-to-end direct source parses to exactly one marker', findMarkers(e2e).length === 1);
    ok('end-to-end marker survives the rehydrate count check',
        findMarkers(e2e).length === 1 && findMarkers(e2e)[0].desc.length > 0);
}

report.push('', '== Chuỗi họa sĩ ==');
{
    const ART = '0.8::artist:yalmyu::, artist:sh_(shinh)';
    const presets = [
        { id: 'art_1', name: 'Vẽ dày', prompt: ART },
        { id: 'art_2', name: 'Celluloid', prompt: 'artist:foo' },
        { id: 'art_3', name: 'Nội dung trống', prompt: '   ' },
    ];

    // -- Rào cản hình thái: Toàn bộ lý do tồn tại của module này, bắt buộc phải chốt chặt --
    // Khi gửi mô tả ngôn ngữ tự nhiên (Tuyến trên định dạng OpenAI qua V.Adapter), ghép tên họa sĩ sẽ làm ô nhiễm mô tả, do đó không ghép.
    ok('description mode never applies the artist string', artistAppliesTo('description') === false);
    ok('tags mode applies it', artistAppliesTo('tags') === true);
    ok('both mode applies it', artistAppliesTo('both') === true);
    ok('unknown mode does not apply it', artistAppliesTo('nope') === false && artistAppliesTo(undefined) === false);

    ok('description: prompt passes through byte-for-byte',
        withArtistPrompt('a knight in old chainmail', ART, 'description') === 'a knight in old chainmail');
    ok('description: no leftover comma added',
        withArtistPrompt('x', ART, 'description') === 'x');
    ok('tags: artist string goes first',
        withArtistPrompt('1boy, sword', ART, 'tags') === ART + ', 1boy, sword');
    ok('both: same assembly as tags',
        withArtistPrompt('1boy, sword', ART, 'both') === withArtistPrompt('1boy, sword', ART, 'tags'));
    ok('tags + no artist selected -> unchanged',
        withArtistPrompt('1boy, sword', '', 'tags') === '1boy, sword');
    ok('tags + empty prompt -> artist only',
        withArtistPrompt('', ART, 'tags') === ART);
    ok('tags + whitespace prompt -> artist only',
        withArtistPrompt('   ', ART, 'tags') === ART);
    ok('null prompt treated as empty', withArtistPrompt(null, ART, 'tags') === ART);

    // -- Phân tích mục được chọn: Ba loại "Không có hiệu lực" đều phải quy về chuỗi rỗng --
    ok('selected id resolves to its content', artistPromptFor(presets, 'art_1') === ART);
    ok('no selection -> empty', artistPromptFor(presets, '') === '');
    ok('undefined selection -> empty', artistPromptFor(presets, undefined) === '');
    // Id lơ lửng (Mục đã bị xóa): Không có hiệu lực, nhưng phía extension cố tình không sửa id trong bộ nhớ
    ok('dangling id -> empty', artistPromptFor(presets, 'art_gone') === '');
    ok('blank-only content -> empty', artistPromptFor(presets, 'art_3') === '');
    ok('non-array presets tolerated -> empty', artistPromptFor(null, 'art_1') === '');
    ok('junk entries skipped', artistPromptFor([null, { id: 'art_x' }], 'art_x') === '');

    // -- Làm sạch --
    ok('newlines and runs of spaces collapse to single spaces',
        sanitizeArtistPrompt('a,\n  b\t\tc') === 'a, b c');
    ok('artist prompt capped', sanitizeArtistPrompt('x'.repeat(ARTIST_PROMPT_MAX + 50)).length === ARTIST_PROMPT_MAX);
    ok('artist name trimmed', sanitizeArtistName('  Tả thực vẽ dày  ') === 'Tả thực vẽ dày');
    ok('artist name capped at 60', sanitizeArtistName('n'.repeat(100)).length === 60);
    ok('multi-line artist string survives as one line',
        !withArtistPrompt('body', 'a,\nb', 'tags').includes('\n'));
}

report.push('', '== effectiveSource ==');
{
    const ORIG = 'A\n[ILLUST: one | 1girl]\nB';
    const st = { src: ORIG, urls: ['/api/images/a.png'] };

    const n = effectiveSource(ORIG, undefined);
    ok('no state -> mode new', n.mode === 'new' && n.src === ORIG);

    const sm = effectiveSource(ORIG, st);
    ok('unchanged text -> mode same', sm.mode === 'same' && sm.src === ORIG);

    const sm2 = effectiveSource(stripMarkers(ORIG), st);
    ok('marker already stripped -> mode same', sm2.mode === 'same' && sm2.src === ORIG);

    // continue: SillyTavern làm trò mes += newText, và luồng trước đó của chúng ta đã bóc marker ra rồi
    const appended = stripMarkers(ORIG) + '\nC\n[ILLUST: two | 2girls]';
    const ap = effectiveSource(appended, st);
    ok('continue/append -> source re-joined, old marker kept', ap.mode === 'append' && ap.src === ORIG + '\nC\n[ILLUST: two | 2girls]', JSON.stringify(ap));
    ok('append keeps old marker indices aligned', findMarkers(ap.src).length === 2 && findMarkers(ap.src)[0].prompt === '1girl' && findMarkers(ap.src)[1].prompt === '2girls');

    // swipe sang câu trả lời khác -> toàn bộ text bị thay thế
    const other = 'X\n[ILLUST: three | 3girls]\nY';
    const rs = effectiveSource(other, st);
    ok('swipe to another reply -> mode reset', rs.mode === 'reset' && rs.src === other);
}

report.push('', '== nai-api.js ==');
const BASE = { baseUrl: 'http://127.0.0.1:18999', apiKey: 'test-key-0000', model: '', width: 832, height: 1216, steps: 28, scale: 6, timeoutMs: 15000, negative: 'bad hands' };
{
    mode.value = 'zip';
    const r = await generateIllustration({ ...BASE, prompt: 'test' });
    ok('zip response -> base64 decodes to fixture png', Buffer.from(r.base64, 'base64').equals(pngBytes));
    ok('zip entry extension detected as png', r.extension === 'png', r.extension);
    ok('payload.input carries the prompt', lastPayload?.input === 'test');
    ok('payload sends negative_prompt', lastPayload?.parameters?.negative_prompt === 'bad hands');
    ok('payload sends the full NAI 4.x parameter set', lastPayload?.parameters?.params_version === 3
        && lastPayload?.parameters?.sampler === 'k_euler_ancestral'
        && lastPayload?.parameters?.noise_schedule === 'karras'
        && lastPayload?.parameters?.n_samples === 1);
    ok('payload mirrors input into v4_prompt.base_caption', lastPayload?.parameters?.v4_prompt?.caption?.base_caption === 'test');
    ok('payload no longer sends the legacy uc field', lastPayload?.parameters?.uc === undefined);
    ok('payload is NAI shape (action/parameters)', lastPayload?.action === 'generate' && lastPayload?.parameters?.width === 832 && lastPayload?.parameters?.steps === 28);
    ok('model field is passed through as user string', lastPayload?.model === '');
    ok('no expand -> plain endpoint path', lastQuery === '/ai/generate-image', lastQuery);
    ok('bearer key forwarded', lastAuth === 'Bearer test-key-0000', lastAuth);
    ok('response headers absent -> meta fields stay empty', r.prompt === '' && r.expand === '' && r.via === '');

    // expand: Yêu cầu tuyến trên mở rộng input thành prompt ảnh đầy đủ trước (Tham số mở rộng không chuẩn của V.Adapter)
    const rx = await generateIllustration({ ...BASE, prompt: 'Một chú mèo cam nằm trên bệ cửa sổ' , expand: true });
    ok('expand=1 appended to the query string', lastQuery === '/ai/generate-image?expand=1', lastQuery);
    ok('expand still returns the image bytes', Buffer.from(rx.base64, 'base64').equals(pngBytes));
    ok('expanded prompt read back from response header (url-decoded)', rx.prompt === 'Prompt tiếng Việt sau khi mở rộng long form', rx.prompt);
    ok('expansion status + upstream kind read back', rx.expand === 'ok' && rx.via === 'images', JSON.stringify({ expand: rx.expand, via: rx.via }));
    ok('client text travels as input (expansion happens upstream)', lastPayload?.input === 'Một chú mèo cam nằm trên bệ cửa sổ');

    mode.value = 'raw';
    const rxRaw = await generateIllustration({ ...BASE, prompt: 'x', expand: true });
    ok('expand also works on the bare-image path', Buffer.from(rxRaw.base64, 'base64').equals(pngBytes) && rxRaw.expand === 'ok');

    mode.value = 'raw';
    const r2 = await generateIllustration({ ...BASE, prompt: 't' });
    ok('bare image bytes recognised', Buffer.from(r2.base64, 'base64').equals(pngBytes) && r2.extension === 'png');

    mode.value = 'b64';
    const r3 = await generateIllustration({ ...BASE, prompt: 't' });
    ok('b64_json inside JSON recognised', Buffer.from(r3.base64, 'base64').equals(pngBytes));

    mode.value = 'neko';
    const rNeko = await generateIllustration({ ...BASE, prompt: 't' });
    ok('neko-style {images:[{image}]} recognised', Buffer.from(rNeko.base64, 'base64').equals(pngBytes));

    mode.value = 'err';
    let e1 = '';
    try { await generateIllustration({ ...BASE, prompt: 't' }); } catch (e) { e1 = e.message; }
    ok('non-2xx relays upstream message verbatim', e1 === 'CONTENT_POLICY_REJECTED', e1);

    mode.value = 'json200';
    let e2 = '';
    try { await generateIllustration({ ...BASE, prompt: 't' }); } catch (e) { e2 = e.message; }
    ok('HTTP 200 with JSON error still fails', e2 === 'CIRCUIT_OPEN', e2);

    mode.value = 'empty';
    let e3 = '';
    try { await generateIllustration({ ...BASE, prompt: 't' }); } catch (e) { e3 = e.message; }
    ok('empty body -> human error', e3.length > 0, e3);

    let e4 = '';
    try { await generateIllustration({ ...BASE, baseUrl: 'http://127.0.0.1:18998', prompt: 't' }); } catch (e) { e4 = e.message; }
    ok('unreachable -> tells user to start adapter / check CORS', e4.includes('CORS'), e4);

    let e5 = '';
    try { await generateIllustration({ ...BASE, baseUrl: '   ', prompt: 't' }); } catch (e) { e5 = e.message; }
    ok('blank baseUrl -> explicit error', e5.length > 0, e5);

    const tc = await testConnection({ baseUrl: BASE.baseUrl, apiKey: 'x' });
    ok('testConnection returns human text', tc.includes('0'), tc);
}

/* -- Nắn lại vị trí đánh dấu (Dự phòng cho trường hợp model vứt hết đánh dấu ở cuối bài) -- */
{
    const body = 'Lời tự sự đoạn một, cô đẩy cánh cửa gỗ bước vào.\n\nLời tự sự đoạn hai, tiếng mưa rơi liên miên trên mái hiên.\n\nLời tự sự đoạn ba, ánh nến kéo dài bóng của hai người.\n\nLời tự sự đoạn bốn, trước lúc bình minh không ai lên tiếng nữa.';
    const src = `${body}\n\n[ILLUST: Cảnh 1 | 1girl, silver hair]\n\n[ILLUST: Cảnh 2 | 2girls, candle]`;

    ok('tail cluster is detected', isTailClustered(src));

    const moved = redistributeMarkers(src);
    ok('redistribute returns a new text', typeof moved === 'string' && moved !== src);

    const ms = findMarkers(moved ?? '');
    ok('both markers survive redistribution', ms.length === 2, JSON.stringify(ms.map(m => m.index)));
    ok('markers keep their original order', ms.length === 2 && ms[0].start < ms[1].start);
    ok('first marker is no longer in the tail', ms.length === 2 && ms[0].start < (moved?.length ?? 0) * 0.75,
        JSON.stringify({ at: ms[0]?.start, len: moved?.length }));
    ok('prose is byte-for-byte unchanged', stripMarkers(moved ?? '') === stripMarkers(src));
    ok('marker count matches the original', findMarkers(moved ?? '').length === findMarkers(src).length);

    // Vị trí chèn phải nằm giữa các đoạn văn: Đằng sau hình ảnh vẫn phải còn thân bài, nếu không thì coi như không chuyển
    const tail = moved?.slice(ms[1]?.end ?? 0) ?? '';
    ok('text still follows the last marker', tail.replace(/\s+/g, '').length > 0, JSON.stringify(tail));

    // Bức ảnh đầu tiên sau khi render không được dính ở cuối toàn bộ tin nhắn
    const dt = buildDisplayText(moved ?? '', ['/img/a.png', '/img/b.png'], 'Illustration', 'drop');
    ok('first image is not the last thing in the message',
        !!dt && dt.indexOf('![Illustration](/img/a.png)') < dt.length - 60, JSON.stringify(dt?.slice(-80)));

    // Những marker vốn đã phân tán thì nhất luật không động vào
    const spread = `${body.slice(0, 20)}\n\n[ILLUST: Sáng | 1girl]\n\n${body.slice(20, 60)}\n\n${body.slice(60)}`;
    ok('already-spread markers are left alone', redistributeMarkers(spread) === null);

    // Khi chỉ có một đoạn thì không có chỗ để chèn, cũng không nên sửa
    const single = 'Một đoạn thân bài nguyên vẹn không có dòng trống, phía sau kèm theo một marker.[ILLUST: x | y]';
    ok('single paragraph -> no redistribution', redistributeMarkers(single) === null);
    ok('single paragraph is not even flagged', isTailClustered(single) === false);

    // Không có marker
    ok('no markers -> null', redistributeMarkers(body) === null);
    ok('no markers -> not flagged', isTailClustered(body) === false);

    // Phân đoạn bằng dấu xuống dòng đơn: Chỉ nhận dòng trống sẽ khiến toàn bộ bài được tính là "Một đoạn", việc nắn lại sẽ im lặng vô hiệu
    const nlBody = 'Lời tự sự đoạn một, cô đẩy cánh cửa gỗ.\nLời tự sự đoạn hai, tiếng mưa rơi liên miên.\nLời tự sự đoạn ba, ánh nến lay động.\nLời tự sự đoạn bốn, trước lúc bình minh không ai lên tiếng.';
    const nlSrc = `${nlBody}\n[ILLUST: Cảnh | 1girl]`;
    ok('single-newline body is flagged', isTailClustered(nlSrc) === true, JSON.stringify(nlSrc.slice(-40)));
    const nlMoved = redistributeMarkers(nlSrc);
    ok('single-newline body gets redistributed', typeof nlMoved === 'string');
    const nlMs = findMarkers(nlMoved ?? '');
    ok('single-newline: marker survives', nlMs.length === 1);
    ok('single-newline: marker is not at the end',
        nlMs.length === 1 && (nlMoved ?? '').slice(nlMs[0].end).replace(/\s+/g, '').length > 0,
        JSON.stringify((nlMoved ?? '').slice(-60)));
    // Chèn marker chiếm một dòng vào thân bài dùng dấu xuống dòng đơn, sau khi xóa marker sẽ thừa ra một lần xuống dòng (khoảng trắng trên dưới hình ảnh),
    // Việc này về mặt bố cục là không thể tránh khỏi; Cái cần kiểm chứng là bản thân đoạn văn không bị động vào - Nội dung và thứ tự vẫn còn đó.
    const paras = (s) => stripMarkers(s).split(/\n+/).map(x => x.trim()).filter(Boolean);
    ok('single-newline: every paragraph kept in order',
        JSON.stringify(paras(nlMoved ?? '')) === JSON.stringify(paras(nlSrc)),
        JSON.stringify(paras(nlMoved ?? '')) + ' vs ' + JSON.stringify(paras(nlSrc)));
}

/* -- Đánh giá phân luồng -- */
{
    ok('plain safe prompt does not divert', detectNsfw('1girl, silver hair, neon street, raining', '') === false);
    ok('empty text does not divert', detectNsfw('', '') === false);
    ok('blank text does not divert', detectNsfw('   \n  ', '') === false);

    ok('builtin grading word hits', detectNsfw('1girl, nude, outdoors', '') === true);
    ok('upper case hits too', detectNsfw('NSFW scene', '') === true);
    ok('vietnamese grading word hits', detectNsfw('Hai người khoả thân ôm nhau', '') === true);

    // Ranh giới từ: Quan hệ bao hàm không được tính là hit, nếu không asexual / nonnude v.v. sẽ bị đánh giá nhầm
    ok('substring inside a longer word does not hit', detectNsfw('asexual, nonnude', '') === false);

    ok('custom word list hits', detectNsfw('Cô mặc áo tắm đi trên bãi biển', 'áo tắm') === true);
    ok('custom word list is additive', detectNsfw('1girl, bikini', 'bikini') === true);
    ok('unrelated custom word does not hit', detectNsfw('1girl, dress', 'bikini') === false);

    ok('word list parsing splits on comma', parseWords('a, b，c; d').length === 4, JSON.stringify(parseWords('a, b，c; d')));
    ok('word list drops blanks', parseWords('a,, ,b').length === 2);
    ok('builtin words are always present', buildWordList('').includes('nsfw'));
    ok('custom words are appended', buildWordList('zzz').includes('zzz'));
}

server.close();
report.push('', `RESULT: ${pass} passed / ${fail} failed`);
fs.writeFileSync(path.join(here, 'report.txt'), report.join('\n'), 'utf8');
console.log(report.join('\n'));
process.exit(fail ? 1 : 0);