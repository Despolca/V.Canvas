// Tự test offline V.Canvas.
//
// Khởi động một dịch vụ giao thức NovelAI giả lập ở 127.0.0.1:18999 và chạy thử toàn bộ
// chu trình "Giao thức NAI -> ZIP -> base64" cộng thêm tất cả các nhánh phân tích thẻ đánh dấu / thay thế tại chỗ.
// Không cần dùng đến SillyTavern.
//
//   1) python make_fixtures.py
//   2) node test.mjs
//
// JSZip lấy từ thư mục cài đặt của SillyTavern (extension này không bao giờ tự đính kèm bản copy riêng).
// Set biến môi trường ST_JSZIP trỏ tới file đó; nếu không thì sẽ tự dò tìm các vị trí cài đặt thông thường.
// Các nhãn báo cáo (Report labels) được cố tình để dưới dạng ASCII: Codepage của Windows console sẽ làm hỏng (mangle) output CJK.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.window = globalThis; // Giả lập trình duyệt: Trong trang SillyTavern window.JSZip đã được gắn sẵn bằng <script>

const here = path.dirname(fileURLToPath(import.meta.url));
const zipBytes = fs.readFileSync(path.join(here, 'image_0.zip'));
const pngBytes = fs.readFileSync(path.join(here, 'image_0.png'));

const jszipPath = [
    process.env.ST_JSZIP,
    // Bản cài đặt copy -> <ST>/data/default-user/extensions/<ext>/test/
    path.resolve(here, '../../../../../public/lib/jszip.min.js'),
    path.resolve(here, '../../../public/lib/jszip.min.js'),
].filter(Boolean).find((p) => fs.existsSync(p));
if (!jszipPath) {
    console.error('[fatal] Không tìm thấy JSZip. Vui lòng chạy với ST_JSZIP=<path/to/jszip.min.js>.');
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
            // V.Adapter khi expand=1 sẽ trả về prompt thực sự được gửi lên tuyến trên và trạng thái của nó ở trong Response Header
            const extra = /[?&]expand=1(?:&|$)/.test(req.url)
                ? {
                    'X-Illust-Via': 'images',
                    'X-Illust-Expand': 'ok',
                    'X-Illust-Prompt': encodeURIComponent('Prompt tiếng Trung sau khi mở rộng long form'),
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
const { findMarkers, buildDisplayText, stripMarkers, hasMarkers, effectiveSource, resolvePromptMode, selectPrompt, isLocalUpstream, MAX_MARKER_LEN } = await import('../lib/marker.js');
const { parseAnalysisJSON, applyMarkers, findAnchor, buildAnalysisMessages } = await import('../lib/analysis.js');

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

    const d = findMarkers('[ILLUST:\nVN desc | 1girl\n]');
    ok('newline inside marker tolerated', d.length === 1 && d[0].prompt === '1girl', JSON.stringify(d));

    ok('no marker -> empty', findMarkers('plain text, nothing here.').length === 0);
    ok('hasMarkers quick check', hasMarkers('x [ILLUST: y] z') && !hasMarkers('x y z'));

    const multi = findMarkers(SRC);
    ok('two markers numbered in order', multi.length === 2 && multi[0].index === 0 && multi[1].index === 1, JSON.stringify(multi.map(m => m.index)));

    const dt = buildDisplayText(SRC, ['/api/images/a.png', null]);
    ok('inline replace below its own paragraph', dt === 'A\n\n![Illustration](/api/images/a.png)\n\nB\n[ILLUST: two | 2girls]\nC', JSON.stringify(dt));

    // -- URL khi chứa khoảng trắng/dấu ngoặc đơn phải được encode, nếu không Markdown sẽ parse thất bại, hình ảnh hiển thị dưới dạng text thuần (plain text) --
    {
        const spaced = buildDisplayText(SRC, ['/user/images/Sample Character/a b(1).png', null]);
        const m = (spaced || '').match(/!\[[^\]]*\]\(([^)]*)\)/);
        ok('markdown url with spaces/parens gets encoded', !!m && m[1].length > 0 && !/\s|\(/.test(m[1]) && m[1].includes('%20'), m && m[1]);
        ok('encoded url still points at the same file', !!m && decodeURIComponent(m[1]) === '/user/images/Sample Character/a b(1).png', m && m[1]);
    }
    ok('no triple newline leftover', !!dt && !/\n{3,}/.test(dt), JSON.stringify(dt));
    ok('failed marker left untouched', !!dt && dt.includes('[ILLUST: two | 2girls]'));
    ok('all failed -> null', buildDisplayText(SRC, [null, null]) === null);

    // -- pending='drop': Các thẻ chưa xuất ảnh phải bị xóa khỏi tầng hiển thị, không được để lọt prompt vào trong chính văn --
    // Khi tấm đầu tiên xuất xong, nếu vẫn giữ nguyên thẻ của tấm thứ hai, mấy trăm chữ prompt sẽ bị phơi bày thẳng ra giữa đoạn chat,
    // cảm giác nhìn vào sẽ là "Ảnh chưa ra mà chỉ thấy lòi ra một nùi chữ", trong khi trên thực tế tấm đầu tiên đã sinh xong rồi.
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
    // Phân luồng kênh kết nối: Dịch vụ adapter local (Qua V.Adapter) thì chạy đường mô tả (description), còn lại chạy đường nhãn (tags)
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

    // Hai nửa của thẻ tương ứng với hai loại tuyến trên: Kết quả phân tích phải khớp với các field của findMarkers
    const mk = findMarkers('[ILLUST: a knight in old chainmail | 1boy, chainmail, sword]')[0];
    ok('marker exposes both halves', mk.desc === 'a knight in old chainmail' && mk.tags === '1boy, chainmail, sword');
    ok('local pipeline gets the description', selectPrompt(mk, resolvePromptMode('auto', 'http://127.0.0.1:8888')) === mk.desc);
    ok('direct pipeline gets the tags', selectPrompt(mk, resolvePromptMode('auto', 'https://image.novelai.net')) === mk.tags);
}

report.push('', '== analysis.js (Xuất ảnh từ ngữ cảnh) ==');
{
    // -- Phân tích (Parse): Khoan dung với các kiểu bọc (wrapper) khác nhau --
    const one = parseAnalysisJSON('{"images":[{"desc":"a girl","tags":"1girl","anchor":"Cô ấy đứng trước cửa sổ"}]}');
    ok('plain JSON parsed', one.length === 1 && one[0].desc === 'a girl' && one[0].tags === '1girl', JSON.stringify(one));

    const fenced = parseAnalysisJSON('```json\n{"images":[{"desc":"d","tags":"t","anchor":"a"}]}\n```');
    ok('markdown fence tolerated', fenced.length === 1, JSON.stringify(fenced));

    const chatty = parseAnalysisJSON('OK, dưới đây là kết quả:\n{"images":[{"desc":"d","tags":"t","anchor":"a"}]}\nHy vọng có thể giúp ích.');
    ok('surrounding prose tolerated', chatty.length === 1, JSON.stringify(chatty));

    const topArr = parseAnalysisJSON('[{"desc":"d1","tags":"t1"},{"desc":"d2","tags":"t2"}]');
    ok('top-level array tolerated', topArr.length === 2, JSON.stringify(topArr));

    ok('empty list -> []', parseAnalysisJSON('{"images":[]}').length === 0);
    ok('garbage -> []', parseAnalysisJSON('not json at all').length === 0);
    ok('entry without desc/tags dropped', parseAnalysisJSON('{"images":[{"anchor":"x"}]}').length === 0);
    ok('capped at 6', parseAnalysisJSON(JSON.stringify({ images: new Array(9).fill({ desc: 'd', tags: 't' }) })).length === 6);

    // -- Định vị (Location) --
    const SRC2 = 'Đoạn một không có khung hình.\nCô ấy đứng trước cửa sổ trong đêm mưa, nhìn ngắm ánh đèn neon.\nĐoạn ba cũng vậy.';
    ok('anchor found verbatim', findAnchor(SRC2, 'Cô ấy đứng trước cửa sổ trong đêm mưa, nhìn ngắm ánh đèn neon.') >= 0);
    ok('anchor found with collapsed whitespace', findAnchor(SRC2, 'Cô ấy đứng trước cửa sổ trong đêm mưa,\nnhìn ngắm ánh đèn neon.') >= 0);
    ok('missing anchor -> -1', findAnchor(SRC2, 'Câu nói này vốn dĩ không tồn tại') === -1);

    // -- Chèn vào (Insert) --
    const items = [
        { desc: 'a girl by the window', tags: '1girl, night, neon', anchor: 'Cô ấy đứng trước cửa sổ trong đêm mưa, nhìn ngắm ánh đèn neon.' },
        { desc: 'a cat on the roof', tags: 'cat, roof', anchor: 'Câu này vốn dĩ không tồn tại' },
    ];
    const withMarkers = applyMarkers(SRC2, items);
    const mk = findMarkers(withMarkers);
    ok('two markers produced', mk.length === 2, JSON.stringify(withMarkers));
    ok('anchored marker sits right under its paragraph',
        withMarkers.indexOf('Cô ấy đứng trước cửa sổ trong đêm mưa, nhìn ngắm ánh đèn neon.\n[ILLUST:') > 0, JSON.stringify(withMarkers));
    ok('unmatched anchor appended at the tail',
        withMarkers.trimEnd().endsWith('[ILLUST: a cat on the roof | cat, roof]'), JSON.stringify(withMarkers));
    ok('marker carries both halves', mk[0].desc === 'a girl by the window' && mk[0].tags === '1girl, night, neon', JSON.stringify(mk[0]));

    // Các ký tự làm hỏng cú pháp của thẻ đánh dấu phải được dọn sạch
    const dirty = applyMarkers(SRC2, [{ desc: 'a | b ] c', tags: 'x]|y', anchor: '' }]);
    const dMarker = dirty.match(/\[ILLUST:[^\]]*\]/)?.[0] ?? '';
    ok('pipe/bracket sanitised out of marker body', findMarkers(dirty).length === 1, JSON.stringify(dirty));
    ok('marker keeps exactly one pipe as the separator', dMarker.split('|').length === 2, dMarker);
    ok('marker body free of stray brackets', !dMarker.slice(1, -1).includes(']'), dMarker);

    ok('no items -> text unchanged', applyMarkers(SRC2, []) === SRC2);
    ok('empty text -> unchanged', applyMarkers('', items) === '');
    ok('same anchor used twice inserted once', findMarkers(applyMarkers(SRC2, [items[0], items[0]])).length === 1);

    // -- Lùi độ dài (Length fallback): Khi model phân tích viết mô tả quá dài, thẻ đánh dấu không được phép bị MAX_MARKER_LEN (1200) của marker.js vứt bỏ --
    {
        const longDesc = 'Mô tả rất dài'.repeat(200);      // ~2600 chữ
        const longTags = 'tag,'.repeat(200);             // ~800 chữ
        const parsed = parseAnalysisJSON(JSON.stringify({ images: [{ desc: longDesc, tags: longTags, anchor: 'Đoạn ba cũng vậy.' }] }));
        ok('long desc truncated by parse', parsed.length === 1 && parsed[0].desc.length <= 700, String(parsed[0]?.desc?.length));
        // Việc cắt đứt phải lùi lại đúng dấu phẩy trước đó: Không được cắt làm đôi một từ, và điểm bị cắt phải nằm sát ngay sau dấu phẩy của nguyên văn
        const tg = parsed[0].tags;
        const ti = longTags.indexOf(tg);
        ok('long tags truncated at a comma boundary', tg.length <= 400 && ti === 0 && longTags[tg.length] === ',', tg.slice(-20) + ` len=${tg.length}`);

        const out = applyMarkers(SRC2, [{ desc: longDesc, tags: longTags, anchor: 'Đoạn ba cũng vậy.' }]);
        const found = findMarkers(out);
        ok('long item still yields a usable marker (not silently dropped)', found.length === 1, JSON.stringify(out).slice(0, 200));

        // Ghi lại mối quan hệ ràng buộc (Coupling): Thẻ vượt quá MAX_MARKER_LEN quả thật sẽ bị loại bỏ, cho nên ở tầng trên (upstream) phải tự thắt chặt lại độ dài.
        // Độ dài được tính toán bằng các hằng số, nếu thay đổi giới hạn trần thì kiểm chứng (assertion) này cũng tự động cập nhật theo.
        const tooLong = `[ILLUST: ${'x'.repeat(MAX_MARKER_LEN)} | y]`;
        ok('oversized marker IS dropped by findMarkers (why analysis.js clamps)', findMarkers(tooLong).length === 0);

        // Mô tả 1000 chữ + Nhãn 400 chữ sau khi thắt chặt lại vẫn bắt buộc phải parse ra được
        const big = applyMarkers(SRC2, [{ desc: longDesc, tags: longTags, anchor: '' }]);
        const bigMk = findMarkers(big);
        ok('clamped long marker survives findMarkers', bigMk.length === 1 && bigMk[0].desc.length >= 500, String(bigMk[0]?.desc?.length));
    }

    // -- Thông tin tác phẩm / Yêu cầu Art style phải đi vào request phân tích --
    {
        const msgs = buildAnalysisMessages('Chính văn', 'Phần trước đó', 3, { work: 'Thẻ nhân vật: Nhân vật ví dụ', style: 'Art style ví dụ' });
        const user = msgs[1].content;
        ok('work label included in the request', user.includes('[Thông tin tác phẩm]') && user.includes('Nhân vật ví dụ'), user.slice(0, 80));
        ok('style hint included in the request', user.includes('[Yêu cầu Art style]') && user.includes('Art style ví dụ'));
        ok('max propagated into the request', user.includes('Lần này xuất tối đa 3 khung hình'));
        const bare = buildAnalysisMessages('Chính văn', '', 1);
        ok('empty meta adds no empty sections', !bare[1].content.includes('[Thông tin tác phẩm]') && !bare[1].content.includes('[Yêu cầu Art style]'));
        const jbm = buildAnalysisMessages('Chính văn', '', 1, { jb: 'TEST_JB_WORDS' });
        ok('jb prompt prepended to the request', jbm[1].content.startsWith('[Hướng dẫn bổ sung]\nTEST_JB_WORDS'), JSON.stringify(jbm[1].content.slice(0, 40)));
        const jbEmpty = buildAnalysisMessages('Chính văn', '', 1, { jb: '' });
        ok('empty jb adds no section', !jbEmpty[1].content.includes('[Hướng dẫn bổ sung]'));    }

    // -- Nối với các luồng hiện có: Thẻ đánh dấu -> Thay thế tại chỗ thành ảnh minh họa --
    const dt2 = buildDisplayText(withMarkers, ['/api/images/a.png', null]);
    ok('analysis result renders as an inline image under the anchor paragraph',
        !!dt2 && dt2.includes('Cô ấy đứng trước cửa sổ trong đêm mưa, nhìn ngắm ánh đèn neon.\n\n![Illustration](/api/images/a.png)'), JSON.stringify(dt2));
    ok('the failed one stays as a marker', !!dt2 && dt2.includes('[ILLUST: a cat on the roof'));
    ok('stripping leaves clean prose', !stripMarkers(withMarkers).includes('ILLUST'), JSON.stringify(stripMarkers(withMarkers)));
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

    // continue: ST sẽ thực hiện mes += newText, mà trong lần xử lý trước thẻ marker đã bị tụi mình gỡ ra mất rồi
    const appended = stripMarkers(ORIG) + '\nC\n[ILLUST: two | 2girls]';
    const ap = effectiveSource(appended, st);
    ok('continue/append -> source re-joined, old marker kept', ap.mode === 'append' && ap.src === ORIG + '\nC\n[ILLUST: two | 2girls]', JSON.stringify(ap));
    ok('append keeps old marker indices aligned', findMarkers(ap.src).length === 2 && findMarkers(ap.src)[0].prompt === '1girl' && findMarkers(ap.src)[1].prompt === '2girls');

    // swipe qua một câu trả lời khác -> toàn bộ text đã bị đè
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

    // expand: Yêu cầu tuyến trên mở rộng input thành prompt hình ảnh trọn vẹn (Tham số mở rộng phi tiêu chuẩn của V.Adapter)
    const rx = await generateIllustration({ ...BASE, prompt: 'Một chú mèo mập màu cam nằm ườn trên bệ cửa sổ' , expand: true });
    ok('expand=1 appended to the query string', lastQuery === '/ai/generate-image?expand=1', lastQuery);
    ok('expand still returns the image bytes', Buffer.from(rx.base64, 'base64').equals(pngBytes));
    ok('expanded prompt read back from response header (url-decoded)', rx.prompt === 'Prompt tiếng Trung sau khi mở rộng long form', rx.prompt);
    ok('expansion status + upstream kind read back', rx.expand === 'ok' && rx.via === 'images', JSON.stringify({ expand: rx.expand, via: rx.via }));
    ok('client text travels as input (expansion happens upstream)', lastPayload?.input === 'Một chú mèo mập màu cam nằm ườn trên bệ cửa sổ');

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

server.close();
report.push('', `RESULT: ${pass} passed / ${fail} failed`);
fs.writeFileSync(path.join(here, 'report.txt'), report.join('\n'), 'utf8');
console.log(report.join('\n'));
process.exit(fail ? 1 : 0);