// nai-api.js - Gọi giao thức NovelAI + Giải nén ZIP.
//
// Ràng buộc cứng: Extension này chỉ implement giao thức NovelAI,
// không implement, và cũng không cho phép thêm bất kỳ luồng code "Kết nối trực tiếp tương thích OpenAI" nào.
//
// Request: POST ${baseUrl}/ai/generate-image, Header "Authorization: Bearer <key>",
//       Body là JSON định dạng NovelAI; Phản hồi là ZIP nhị phân (chứa một bức ảnh).
// Lỗi: Không phải 2xx + {"message": "..."}, phải truyền nguyên trạng message cho người dùng.

import { sigHeaders, fetchSalt, isExclusiveKey, clearSaltCache } from './vsig.js';

const JSZIP_URL = '/lib/jszip.min.js'; // Đi kèm với SillyTavern (public/lib/jszip.min.js), đừng tự nhét file thư viện vào

let jsZipPromise = null;

// ensureJSZip Load động JSZip tích hợp của SillyTavern (UMD, sau khi load sẽ mount vào window.JSZip).
async function ensureJSZip() {
    if (window.JSZip) return window.JSZip;
    if (!jsZipPromise) {
        jsZipPromise = import(/* @vite-ignore */ JSZIP_URL)
            .then(() => window.JSZip)
            .catch(err => {
                jsZipPromise = null;
                throw new Error(`Không thể load JSZip tích hợp của SillyTavern (${JSZIP_URL}): ${err?.message ?? err}`);
            });
    }
    const JSZip = await jsZipPromise;
    if (!JSZip) throw new Error(`JSZip tích hợp của SillyTavern chưa được mount vào window.JSZip (${JSZIP_URL})`);
    return JSZip;
}

function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

function truncate(s, n) {
    const str = String(s ?? '');
    return str.length > n ? `${str.slice(0, n)}…` : str;
}

// extFromName Suy luận đuôi file từ tên mục ZIP (Bắt buộc phải là giá trị được MEDIA_EXTENSIONS của SillyTavern công nhận).
function extFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
    const ext = (m?.[1] ?? 'png').toLowerCase();
    if (ext === 'jpeg' || ext === 'jfif') return 'jpg';
    return ['png', 'jpg', 'webp', 'gif', 'bmp'].includes(ext) ? ext : 'png';
}

// extFromContentType Suy luận đuôi file từ Content-Type (image/png -> png).
function extFromContentType(ct) {
    const m = /^image\/([a-z0-9.+-]+)/.exec(String(ct ?? '').toLowerCase());
    if (!m) return null;
    const t = m[1];
    if (t === 'jpeg' || t === 'jfif') return 'jpg';
    return ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif'].includes(t) ? t : null;
}

// sniff Nhận diện luồng byte ảnh trần (Một số service tương thích NAI trả về trực tiếp ảnh thay vì ZIP).
function sniffImage(bytes) {
    const u8 = new Uint8Array(bytes.slice(0, 12));
    if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'png';
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpg';
    if (u8.length >= 12 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'RIFF'
        && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === 'WEBP') return 'webp';
    if (u8.length >= 6 && String.fromCharCode(u8[0], u8[1], u8[2]) === 'GIF') return 'gif';
    if (u8.length >= 2 && u8[0] === 0x42 && u8[1] === 0x4d) return 'bmp';
    return null;
}

// isZip Đánh giá xem có phải là ZIP hay không (PK\x03\x04 / PK\x05\x06 gói rỗng / PK\x07\x08 chia volume).
function isZip(bytes) {
    const u8 = new Uint8Array(bytes.slice(0, 4));
    return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b
        && (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) && (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08);
}

// readErrorMessage Trích xuất thông báo lỗi dễ đọc từ phản hồi không phải 2xx (Giao thức NAI là {"message": "..."}).
async function readErrorMessage(resp) {
    let text = '';
    try {
        text = await resp.text();
    } catch {
        return `Service NAI trả về HTTP ${resp.status}`;
    }
    if (!text) return `Service NAI trả về HTTP ${resp.status} (Không có body phản hồi)`;
    try {
        const j = JSON.parse(text);
        const msg = j?.message ?? j?.error?.message ?? j?.error ?? j?.detail ?? j?.msg;
        if (msg) return String(msg);
    } catch {
        /* Không phải JSON, đi vào luồng dự phòng (fallback) bên dưới */
    }
    return `${truncate(text.replace(/\s+/g, ' '), 240)} (HTTP ${resp.status})`;
}

// decodeHeader Đọc header phản hồi được URL Encode (Giá trị header bắt buộc phải là ASCII, do đó prompt được trả về theo dạng URL Encode).
function decodeHeader(v) {
    if (!v) return '';
    try {
        return decodeURIComponent(v);
    } catch {
        return String(v);
    }
}

/**
 * generateIllustration Gọi NAI xuất ảnh một lần, trả về base64 và đuôi file.
 * Bất kỳ thất bại nào đều ném ra Error, và message chắc chắn là văn bản dễ đọc (Dùng để hiển thị toastr).
 *
 * @param {object} p
 * @param {string} p.baseUrl   Địa chỉ service giao thức NAI
 * @param {string} p.apiKey    Bearer key
 * @param {string} p.model     Chuỗi model do người dùng điền thủ công (có thể rỗng)
 * @param {string} p.prompt    Prompt tích cực -> input
 * @param {string} p.negative  Prompt tiêu cực -> parameters.negative_prompt + v4_negative_prompt
 * @param {number} p.width
 * @param {number} p.height
 * @param {number} p.steps
 * @param {number} p.scale
 * @param {number} p.timeoutMs
 * @param {boolean} p.expand   Khi là true, yêu cầu tuyến trên trước tiên mở rộng input thành prompt hình ảnh hoàn chỉnh (Tham số mở rộng không chuẩn `?expand=1`
 *                             của V.Adapter; Các service chưa implement tham số này sẽ phớt lờ nó, hành vi tương đương với false)
 * @param {AbortSignal} [p.signal] Tín hiệu hủy từ bên ngoài (Nút "Dừng" trên bảng điều khiển), cộng dồn với timeout bên trong
 * @param {string} [p.salt] Giá trị ghi đè salt dùng chung của V-site (Để trống sẽ dùng mặc định tích hợp sẵn)
 * @param {'off'|'auto'|'on'} [p.signMode] Công tắc chữ ký: off=Không bao giờ gửi (mặc định) / auto=Chỉ gửi với key độc quyền vcs_ / on=Key nào cũng gửi
 * @param {boolean} [p.allowBridge=true] Khi không thể kết nối đến địa chỉ đã điền, có lùi về cầu gọi nội bộ V.Adapter trên cùng trang hay không.
 *   Kênh phân luồng bắt buộc phải truyền false: Đầu kia của cầu chính là tuyến trên của kênh chính, đó chính là đối tượng cần phải tránh trong lần này -
 *   Nếu giao prompt của khung hình phân luồng cho nó, thì việc phân luồng coi như vô ích, lại còn gửi nội dung đến nơi không nên gửi.
 * @returns {Promise<{base64?:string, url?:string, extension?:string, via?:string, expand?:string, prompt?:string}>}
 *   base64/extension là kết quả byte local; khi url tồn tại thì biểu thị kết quả giáng cấp link từ xa (Không có byte local, tham chiếu trực tiếp link đó)
 */
export async function generateIllustration({
    baseUrl, apiKey, model, prompt, negative,
    width = 832, height = 1216, steps = 28, scale = 6.0, timeoutMs = 300000, expand = false, signal, salt,
    signMode = 'auto', allowBridge = true,
} = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    // Extension V.Adapter trên cùng trang sẽ mount cầu gọi nội bộ trang ra.
    // Chỉ sử dụng nó khi "Chưa điền địa chỉ service": Đã điền địa chỉ thì nhất luật đi qua HTTP theo địa chỉ đã điền,
    // bởi vì server và extension giữ cấu hình độc lập, không thể thay thế lẫn nhau.
    const pageBridge = allowBridge && typeof globalThis.__V_ADAPTER_NAI__ === 'function' ? globalThis.__V_ADAPTER_NAI__ : null;
    const usePageBridge = Boolean(pageBridge) && base === '';
    if (!base && !pageBridge) {
        throw new Error('Chưa cấu hình địa chỉ service NAI: Vui lòng điền địa chỉ service giao thức NovelAI (như V.Adapter) trong cài đặt extension, hoặc cài đặt extension V.Adapter để bật kết nối trực tiếp trong trang');
    }
    const input = String(prompt ?? '').trim();
    if (!input) throw new Error('Prompt trống, bỏ qua xuất ảnh');

    // Lưu ý: Ở đây gửi đi bộ tham số NovelAI 4.x hoàn chỉnh, chứ không phải bộ tối thiểu.
    // Nếu chỉ gửi input/model/action/parameters{width,height,scale,steps,negative_prompt}
    // sẽ bị Gateway NAI bên thứ ba từ chối bằng lỗi `400 Yêu cầu không hợp lệ` (Gateway sẽ kiểm tra tính toàn vẹn của tham số rất khắt khe).
    // V.Adapter chỉ đọc input / width / height / negative_prompt, phớt lờ các trường còn lại,
    // do đó cùng một payload có thể dùng đồng thời cho ba loại tuyến trên: "NAI chính thức / Gateway NAI / V.Adapter".
    // Sampler và noise schedule sử dụng giá trị mặc định của NAI (Euler Ancestral + Karras).
    const neg = String(negative ?? '').trim();
    const parameters = {
        params_version: 3,
        width,
        height,
        scale,
        sampler: 'k_euler_ancestral',
        steps,
        n_samples: 1,
        ucPreset: 0,
        qualityToggle: true,
        autoSmea: false,
        dynamic_thresholding: false,
        controlnet_strength: 1.0,
        legacy: false,
        add_original_image: false,
        cfg_rescale: 0,
        noise_schedule: 'karras',
        legacy_v3_extend: false,
        seed: 0,
        negative_prompt: neg,
        // Đầu vào chính của 4.x thực chất là cấu trúc v4_prompt (Client chính thức đều sẽ mang theo), base_caption đồng nhất với input
        v4_prompt: {
            caption: { base_caption: input, char_captions: [] },
            use_coords: false,
            use_order: true,
        },
        v4_negative_prompt: {
            caption: { base_caption: neg, char_captions: [] },
            legacy_uc: false,
        },
    };
    const body = {
        input,
        model: String(model ?? ''),
        action: 'generate',
        parameters,
    };

    const ctrl = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
    }, Math.max(5000, timeoutMs));
    // Hủy từ bên ngoài (Nút "Dừng" trên bảng điều khiển): Cộng dồn với timeout bên trong vào cùng một AbortController.
    if (signal) {
        if (signal.aborted) {
            cancelled = true;
            ctrl.abort();
        } else {
            signal.addEventListener('abort', () => { cancelled = true; ctrl.abort(); }, { once: true });
        }
    }

    let resp;
    if (usePageBridge) {
        // -- Gọi nội bộ trang --
        // Chỉ kích hoạt khi chưa điền địa chỉ service. Khi V.Adapter và extension này cùng nằm trong một trang SillyTavern,
        // cả hai có thể hoàn thành vòng lặp giao thức trực tiếp bằng cách gọi hàm: Không đi qua mạng, không chiếm port,
        // cũng không cần deploy component server trong <SillyTavern>/plugins/.
        // Nhờ vậy, hai extension này sau khi cài đặt trên bất kỳ SillyTavern nào (Local / Server / Mobile) đều có thể sử dụng được ngay.
        let r;
        try {
            r = await pageBridge(body, { expand });
        } catch (err) {
            clearTimeout(timer);
            throw new Error(`Gọi nội bộ trang V.Adapter thất bại: ${err?.message ?? err}`);
        }
        if (!r || typeof r !== 'object') {
            clearTimeout(timer);
            throw new Error('Gọi nội bộ trang V.Adapter trả về kết quả không hợp lệ');
        }
        // 200 + url và không có byte: Kết quả giáng cấp CORS của V.Adapter - Tuyến trên chỉ đưa ra link ảnh từ xa,
        // phía trình duyệt không thể download byte do cross-origin. Giao lại nguyên xi link cho bên gọi, để bên gọi trực tiếp trích dẫn ảnh từ xa.
        if (r.status === 200 && !r.bytes && r.url) {
            clearTimeout(timer);
            return { url: String(r.url), via: String(r.via ?? ''), expand: '', prompt: '' };
        }
        // 200 nhưng không có byte cũng không có link: Kết quả rỗng, xử lý như thất bại.
        // (Không thể cho qua, nếu không kết quả rỗng sẽ bị coi là phản hồi 200 và tiếp tục đi vào phân tích ảnh, tạo ra file ảnh bị hỏng.)
        if (r.status === 200 && !r.bytes) {
            clearTimeout(timer);
            throw new Error('Gọi nội bộ trang V.Adapter trả về kết quả rỗng');
        }
        // Lắp ráp thành object đồng cấu (isomorphic) với phản hồi HTTP, logic phân tích phía sau được tái sử dụng hoàn toàn.
        const payload = (r.status === 200 && r.bytes)
            ? r.bytes
            : new TextEncoder().encode(JSON.stringify({ message: r.error || 'Gọi nội bộ trang thất bại' }));
        resp = new Response(payload, {
            status: r.status || 502,
            headers: { 'Content-Type': r.contentType || 'application/octet-stream' },
        });
    } else {
        try {
            /* Salt hiện tại của site: Chỉ key độc quyền của V-site mới cần, và chỉ hỏi khi không chỉ định salt thủ công.
             * Sau khi site luân chuyển exclusiveSalt, plugin xuất ảnh lần sau sẽ tự động bám theo, không cần cập nhật phiên bản plugin.
             * NAI chính thức / Proxy trung chuyển bên thứ ba (Key không bắt đầu bằng vcs_) sẽ không đi vào đây, không tốn thêm request. */
            let siteSalt = String(salt ?? '').trim();
            if (!siteSalt && signMode !== 'off' && isExclusiveKey(apiKey)) {
                // Không lấy được thì dùng giá trị dự phòng trong vsig (Xem sigHeaders)
                siteSalt = await fetchSalt(base, apiKey);
            }
            // expand là tham số mở rộng không chuẩn: V.Adapter nhận được sẽ mở rộng input trước; Các service NAI khác sẽ phớt lờ query string này.
            const qs = expand ? '?expand=1' : '';
            const baseHeaders = {
                'Authorization': `Bearer ${String(apiKey ?? '')}`,
                'Content-Type': 'application/json',
                'Accept': 'image/avif,image/webp,image/png,image/*;q=0.9,application/json;q=0.5',
            };
            resp = await fetch(`${base}/ai/generate-image${qs}`, {
                method: 'POST',
                headers: {
                    ...baseHeaders,
                    // Chỉ key độc quyền của V-site mới mang theo header chữ ký; Các tuyến trên khác giải nén thành object rỗng, hành vi hoàn toàn không đổi.
                    ...sigHeaders(apiKey, siteSalt, { mode: signMode }),
                },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });

            /* Tự phục hồi khi site đổi salt: Salt được cache trong session, nếu site vừa luân chuyển salt, salt cũ đang giữ sẽ bị 403.
             * Lúc này xóa cache và hỏi lại một lần, sau khi lấy được salt mới thì thử lại một lần là được - Người dùng không cần refresh trang,
             * cũng không cần cập nhật plugin. (Chỉ tự phục hồi khi không chỉ định salt thủ công, nếu chỉ định thủ công thì lấy theo giá trị người dùng điền.) */
            if (!resp.ok && resp.status === 403 && signMode !== 'off'
                && isExclusiveKey(apiKey) && !String(salt ?? '').trim()) {
                clearSaltCache(base);
                const freshSalt = await fetchSalt(base, apiKey);
                if (freshSalt && freshSalt !== siteSalt) {
                    resp = await fetch(`${base}/ai/generate-image${qs}`, {
                        method: 'POST',
                        headers: {
                            ...baseHeaders,
                            ...sigHeaders(apiKey, freshSalt, { mode: signMode }),
                        },
                        body: JSON.stringify(body),
                        signal: ctrl.signal,
                    });
                }
            }
        } catch (err) {
            clearTimeout(timer);
            if (cancelled) throw new Error('Đã dừng');
            if (timedOut) {
                throw new Error(`Request timeout (${Math.round(timeoutMs / 1000)} giây): Tuyến trên không trả về trong thời hạn, có thể tăng "Thời gian timeout" trong cài đặt extension`);
            }
            // Khi địa chỉ đã điền không thể kết nối, nếu trên cùng trang có V.Adapter, thì lùi về gọi nội bộ trang:
            // Như vậy các SillyTavern chưa deploy component server (Server / Mobile / Instance mới cài) cũng có thể trực tiếp xuất ảnh.
            let bridgeErr = null;
            if (pageBridge) {
                try {
                    const r2 = await pageBridge(body, { expand });
                    if (r2 && typeof r2 === 'object' && r2.status === 200 && r2.bytes) {
                        resp = new Response(r2.bytes, {
                            status: 200,
                            headers: { 'Content-Type': r2.contentType || 'application/octet-stream' },
                        });
                    } else if (r2 && typeof r2 === 'object' && r2.status === 200 && r2.url) {
                        // Kết quả giáng cấp link từ xa: Trực tiếp tham chiếu link ảnh tuyến trên
                        clearTimeout(timer);
                        return { url: String(r2.url), via: String(r2.via ?? ''), expand: '', prompt: '' };
                    } else {
                        bridgeErr = (r2 && r2.error) || `Gọi nội bộ trang trả về ${r2?.status ?? 'kết quả rỗng'}`;
                    }
                } catch (e2) {
                    bridgeErr = e2?.message ?? String(e2);
                }
            }
            if (!resp) {
                // Khi cầu tồn tại và đưa ra nguyên nhân thất bại rõ ràng, ưu tiên truyền qua nguyên nhân thật
                // (Phổ biến nhất: Tuyến trên của chính V.Adapter vẫn chưa được cấu hình).
                if (bridgeErr) {
                    throw new Error(`V.Adapter (Kết nối trực tiếp trong trang) xuất ảnh thất bại: ${bridgeErr}`);
                }
                throw new Error(`Không thể kết nối đến service NAI (${base}): ${err?.message ?? err}. Vui lòng xác nhận service chuyển đổi đã khởi động, địa chỉ chính xác, và cho phép Cross-Origin (CORS); hoặc cài đặt extension V.Adapter để bật kết nối trực tiếp trong trang`);
            }
        }
    }

    if (!resp.ok) {
        clearTimeout(timer);
        throw new Error(await readErrorMessage(resp));
    }

    // V.Adapter sẽ đặt "Prompt thực tế gửi vào tuyến trên" và trạng thái mở rộng vào header phản hồi để trả về;
    // Service NAI tiêu chuẩn không cung cấp các header này, khi không lấy được thì là chuỗi rỗng.
    const meta = {
        via: resp.headers.get('x-illust-via') ?? '',
        expand: resp.headers.get('x-illust-expand') ?? '',
        prompt: decodeHeader(resp.headers.get('x-illust-prompt')),
    };

    let bytes;
    try {
        bytes = await resp.arrayBuffer();
    } catch (err) {
        clearTimeout(timer);
        throw new Error(`Đọc body phản hồi thất bại: ${err?.message ?? err}`);
    }
    clearTimeout(timer);

    if (!bytes || bytes.byteLength === 0) {
        throw new Error('Service NAI trả về phản hồi rỗng');
    }

    // -- 1. Luồng byte ảnh nhị phân (Content-Type: image/*) -> Trực tiếp sử dụng byte, không giải nén --
    //    V.Adapter khi client khai báo Accept: image/* sẽ xuất trực tiếp byte PNG/JPEG (không bọc ZIP).
    const ctype = String(resp.headers.get('content-type') ?? '').toLowerCase();
    if (ctype.startsWith('image/')) {
        const ext = extFromContentType(ctype) ?? sniffImage(bytes) ?? 'png';
        return { base64: bytesToBase64(bytes), extension: ext, ...meta };
    }

    // -- 2. Luồng byte ảnh trần (Một số service Content-Type không chính xác, nhận diện theo file magic number) --
    const rawExt = sniffImage(bytes);
    if (rawExt) {
        return { base64: bytesToBase64(bytes), extension: rawExt, ...meta };
    }

    // -- 3. ZIP (Định dạng phản hồi tiêu chuẩn của giao thức NovelAI; NAI chính thức và các service NAI khác đi nhánh này) --
    if (isZip(bytes)) {
        let JSZip;
        try {
            JSZip = await ensureJSZip();
        } catch (err) {
            throw new Error(err?.message ?? String(err));
        }

        let zip;
        try {
            zip = await JSZip.loadAsync(bytes);
        } catch (err) {
            throw new Error(`Giải nén ZIP thất bại (Phản hồi có thể bị cắt đứt): ${err?.message ?? err}`);
        }

        const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
        if (!names.length) throw new Error('Trong ZIP không có bất kỳ file nào');
        const pick = names.find(n => /\.(png|jpe?g|jfif|webp|gif|bmp)$/i.test(n)) ?? names[0];

        let b64;
        try {
            b64 = await zip.files[pick].async('base64');
        } catch (err) {
            throw new Error(`Đọc ảnh trong ZIP thất bại: ${err?.message ?? err}`);
        }
        if (!b64) throw new Error('Ảnh trong ZIP bị rỗng');
        return { base64: b64, extension: extFromName(pick), ...meta };
    }

    // -- 4. Dự phòng: Có thể là lỗi JSON trả về với status code 200 --
    let text = '';
    try {
        text = new TextDecoder('utf-8').decode(bytes);
    } catch {
        /* bỏ qua */
    }
    try {
        const j = JSON.parse(text);
        const msg = j?.message ?? j?.error?.message ?? j?.error ?? j?.detail;
        if (msg) throw new Error(String(msg));
        // Tương thích với trường hợp một số ít service đặt base64 trong JSON, nhận diện luôn:
        //   API tạo ảnh OpenAI -> { data: [{ b64_json }] }
        //   Neko Image Tower và các proxy trung chuyển khác -> { images: [{ image }] } (base64 PNG)
        const b64 = j?.data?.[0]?.b64_json
            ?? j?.images?.[0]?.b64_json
            ?? j?.images?.[0]?.image
            ?? j?.image
            ?? j?.b64_json;
        if (typeof b64 === 'string' && b64.length > 64) {
            return { base64: b64.replace(/^data:image\/\w+;base64,/, ''), extension: 'png', ...meta };
        }
    } catch (err) {
        if (err instanceof Error && err.message && !/JSON/i.test(err.message)) throw err;
    }

    throw new Error(`Phản hồi không phải là ZIP, cũng không phải ảnh hoặc JSON có thể nhận diện: ${truncate(text.replace(/\s+/g, ' '), 160)}`);
}

/**
 * testConnection Test kết nối (Tương ứng giao thức NAI GET /ai/user/subscription).
 * Key độc quyền cũng mang theo chữ ký: V-site hiện tại không verify endpoint này, nhưng sau này nếu thắt chặt thì ở đây không cần sửa nữa.
 * @returns {Promise<string>} Trả về văn bản dễ đọc khi thành công (Chứa tier đăng ký)
 */
export async function testConnection({ baseUrl, apiKey, timeoutMs = 15000, salt, signMode = 'auto' } = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Vui lòng điền địa chỉ service NAI trước');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Math.max(3000, timeoutMs));
    let resp;
    try {
        resp = await fetch(`${base}/ai/user/subscription`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${String(apiKey ?? '')}`,
                'Accept': 'application/json',
                ...sigHeaders(apiKey, salt, { mode: signMode }),
            },
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (timedOut) throw new Error('Kết nối timeout: Service không phản hồi');
        throw new Error(`Không thể kết nối ${base}: ${err?.message ?? err}`);
    }
    clearTimeout(timer);
    if (!resp.ok) throw new Error(await readErrorMessage(resp));
    let tier = '';
    try {
        const j = await resp.json();
        tier = j?.tier ?? j?.subscription?.tier ?? '';
    } catch {
        /* Không phân tích cũng không ảnh hưởng đến kết luận "Đã thông" */
    }
    return `Kết nối bình thường${tier !== '' ? ` (tier ${tier})` : ''}`;
}