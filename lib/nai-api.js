// nai-api.js — Gọi giao thức NovelAI + Giải nén ZIP.
//
// Ràng buộc cứng: Extension này chỉ triển khai giao thức NovelAI,
// không triển khai và cũng không cho phép thêm bất kỳ luồng code "kết nối trực tiếp tương thích OpenAI" nào.
//
// Request: POST ${baseUrl}/ai/generate-image, Header `Authorization: Bearer <key>`,
//       Body là JSON định dạng NovelAI; Phản hồi là file ZIP nhị phân (chứa một bức ảnh).
// Lỗi: Khác 2xx + {"message": "..."}, phải truyền thẳng message nguyên trạng cho người dùng.

const JSZIP_URL = '/lib/jszip.min.js'; // Đi kèm sẵn trong SillyTavern (public/lib/jszip.min.js), đừng tự nhét thêm file thư viện ngoài

let jsZipPromise = null;

// ensureJSZip Tải động JSZip đi kèm sẵn trong SillyTavern (UMD, sau khi tải sẽ gắn vào window.JSZip).
async function ensureJSZip() {
    if (window.JSZip) return window.JSZip;
    if (!jsZipPromise) {
        jsZipPromise = import(/* @vite-ignore */ JSZIP_URL)
            .then(() => window.JSZip)
            .catch(err => {
                jsZipPromise = null;
                throw new Error(`Không thể tải JSZip đi kèm SillyTavern (${JSZIP_URL}): ${err?.message ?? err}`);
            });
    }
    const JSZip = await jsZipPromise;
    if (!JSZip) throw new Error(`JSZip đi kèm SillyTavern chưa được gắn vào window.JSZip (${JSZIP_URL})`);
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

// extFromName Suy đoán đuôi mở rộng từ tên file trong ZIP (Bắt buộc phải là giá trị được MEDIA_EXTENSIONS của SillyTavern công nhận).
function extFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
    const ext = (m?.[1] ?? 'png').toLowerCase();
    if (ext === 'jpeg' || ext === 'jfif') return 'jpg';
    return ['png', 'jpg', 'webp', 'gif', 'bmp'].includes(ext) ? ext : 'png';
}

// extFromContentType Suy đoán đuôi mở rộng từ Content-Type (image/png -> png).
function extFromContentType(ct) {
    const m = /^image\/([a-z0-9.+-]+)/.exec(String(ct ?? '').toLowerCase());
    if (!m) return null;
    const t = m[1];
    if (t === 'jpeg' || t === 'jfif') return 'jpg';
    return ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif'].includes(t) ? t : null;
}

// sniffImage Nhận diện luồng byte ảnh nguyên chất (Một số dịch vụ tương thích NAI trả thẳng về ảnh thay vì ZIP).
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

// isZip Phán đoán xem có phải ZIP không (PK\x03\x04 / PK\x05\x06 gói rỗng / PK\x07\x08 chia part).
function isZip(bytes) {
    const u8 = new Uint8Array(bytes.slice(0, 4));
    return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b
        && (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) && (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08);
}

// readErrorMessage Trích xuất thông tin lỗi có thể đọc được từ phản hồi khác 2xx (Giao thức NAI là {"message": "..."}).
async function readErrorMessage(resp) {
    let text = '';
    try {
        text = await resp.text();
    } catch {
        return `Dịch vụ NAI trả về HTTP ${resp.status}`;
    }
    if (!text) return `Dịch vụ NAI trả về HTTP ${resp.status} (Không có body)`;
    try {
        const j = JSON.parse(text);
        const msg = j?.message ?? j?.error?.message ?? j?.error ?? j?.detail ?? j?.msg;
        if (msg) return String(msg);
    } catch {
        /* Không phải JSON, đi vào phần dự phòng bên dưới */
    }
    return `${truncate(text.replace(/\s+/g, ' '), 240)} (HTTP ${resp.status})`;
}

// decodeHeader Đọc header phản hồi được URL encode (Giá trị của header bắt buộc là ASCII, nên prompt được trả về sau khi đã URL encode).
function decodeHeader(v) {
    if (!v) return '';
    try {
        return decodeURIComponent(v);
    } catch {
        return String(v);
    }
}

/**
 * generateIllustration Gọi API sinh ảnh NAI 1 lần, trả về base64 và đuôi mở rộng.
 * Bất kỳ sự cố nào cũng sẽ ném ra Error, và message chắc chắn là văn bản có thể đọc được (Dùng để hiển thị toastr).
 *
 * @param {object} p
 * @param {string} p.baseUrl   Địa chỉ dịch vụ giao thức NAI
 * @param {string} p.apiKey    Bearer key
 * @param {string} p.model     Chuỗi model do người dùng tự điền (Có thể để trống)
 * @param {string} p.prompt    Prompt tích cực -> input
 * @param {string} p.negative  Prompt phủ định -> parameters.negative_prompt + v4_negative_prompt
 * @param {number} p.width
 * @param {number} p.height
 * @param {number} p.steps
 * @param {number} p.scale
 * @param {number} p.timeoutMs
 * @param {boolean} p.expand   Khi bằng true, yêu cầu tuyến trên mở rộng input thành prompt trọn vẹn rồi mới xuất ảnh (Tham số mở rộng phi tiêu chuẩn `?expand=1` của V.Adapter;
 *                             Các dịch vụ không hỗ trợ tham số này sẽ bỏ qua nó, hành vi tương đương với false)
 * @param {AbortSignal} [p.signal] Tín hiệu hủy từ bên ngoài (Nút "Chấm dứt" trên bảng điều khiển), cộng dồn với timeout nội bộ
 * @returns {Promise<{base64?:string, url?:string, extension?:string, via?:string, expand?:string, prompt?:string}>}
 *   base64/extension là kết quả byte cục bộ (local); Khi có url nghĩa là kết quả fallback xuống liên kết từ xa (Không có byte cục bộ, trực tiếp trỏ vào link đó)
 */
export async function generateIllustration({
    baseUrl, apiKey, model, prompt, negative,
    width = 832, height = 1216, steps = 28, scale = 6.0, timeoutMs = 300000, expand = false, signal,
} = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    // Extension V.Adapter trên cùng một trang sẽ treo ra một cầu nối gọi API nội trang (In-page bridge).
    // Nó chỉ được sử dụng khi "Chưa điền địa chỉ dịch vụ": Nếu đã điền địa chỉ thì bắt buộc gọi qua HTTP tới địa chỉ đó,
    // bởi vì module server và extension đều nắm giữ cấu hình độc lập, không thể tự ý thay thế nhau được.
    const pageBridge = typeof globalThis.__V_ADAPTER_NAI__ === 'function' ? globalThis.__V_ADAPTER_NAI__ : null;
    const usePageBridge = Boolean(pageBridge) && base === '';
    if (!base && !pageBridge) {
        throw new Error('Chưa cấu hình địa chỉ dịch vụ NAI: Vui lòng điền địa chỉ dịch vụ giao thức NovelAI trong phần cài đặt extension (Ví dụ V.Adapter), hoặc cài đặt extension V.Adapter để bật kết nối trực tiếp trong trang');
    }
    const input = String(prompt ?? '').trim();
    if (!input) throw new Error('Prompt trống, bỏ qua việc xuất ảnh');

    // Chú ý: Ở đây gửi đi bộ tham số NovelAI 4.x hoàn chỉnh, chứ không phải tập hợp nhỏ nhất.
    // Nếu chỉ gửi input/model/action/parameters{width,height,scale,steps,negative_prompt}
    // sẽ bị NAI Gateway của bên thứ 3 từ chối với lỗi `400 Yêu cầu không hợp lệ` (Gateway sẽ kiểm tra nghiêm ngặt tính toàn vẹn của tham số).
    // V.Adapter chỉ đọc input / width / height / negative_prompt, các trường còn lại bỏ qua,
    // Do đó cùng một payload có thể dùng chung cho 3 loại tuyến trên "NAI chính thức / NAI Gateway / V.Adapter".
    // Sampler và Bảng nhiễu (Noise schedule) sử dụng giá trị mặc định của NAI (Euler Ancestral + Karras).
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
        // Input chính của 4.x thực chất là cấu trúc v4_prompt (Client chính thức nào cũng gửi kèm), base_caption giữ đồng nhất với input
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
    // Hủy từ bên ngoài (Nút "Chấm dứt" trên bảng điều khiển): Xếp chồng lên cùng một AbortController với timeout nội bộ.
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
        // -- Gọi trong trang (In-page call) --
        // Chỉ kích hoạt khi chưa điền địa chỉ dịch vụ. Khi V.Adapter và extension này nằm chung trên một trang SillyTavern,
        // hai bên có thể hoàn thành việc trao đổi giao thức trực tiếp bằng cách gọi hàm: Không đi qua network, không chiếm dụng port,
        // nhờ vậy cũng không cần phải cài đặt module server dưới thư mục <SillyTavern>/plugins/.
        // Từ đó, hai extension này sau khi cài đặt trên bất kỳ SillyTavern nào (Máy cá nhân / Server / Mobile) là có thể sử dụng ngay.
        let r;
        try {
            r = await pageBridge(body, { expand });
        } catch (err) {
            clearTimeout(timer);
            throw new Error(`Gọi V.Adapter trong trang thất bại: ${err?.message ?? err}`);
        }
        if (!r || typeof r !== 'object') {
            clearTimeout(timer);
            throw new Error('Gọi V.Adapter trong trang trả về kết quả không hợp lệ');
        }
        // 200 + url nhưng không có byte: Kết quả fallback CORS của V.Adapter -- Tuyến trên chỉ đưa mỗi cái link ảnh từ xa,
        // Phía trình duyệt bị lỗi cross-domain nên không thể download byte về được. Trả link này lại nguyên trạng cho bên gọi, để bên gọi trực tiếp dẫn link từ xa đó.
        if (r.status === 200 && !r.bytes && r.url) {
            clearTimeout(timer);
            return { url: String(r.url), via: String(r.via ?? ''), expand: '', prompt: '' };
        }
        // 200 nhưng vừa không có byte vừa không có link: Kết quả rỗng, coi như thất bại.
        // (Không thể cho qua, nếu không kết quả rỗng sẽ bị coi như phản hồi 200 đi tiếp vào khâu phân tích ảnh, sinh ra file ảnh hỏng.)
        if (r.status === 200 && !r.bytes) {
            clearTimeout(timer);
            throw new Error('Gọi V.Adapter trong trang trả về kết quả rỗng');
        }
        // Lắp ráp lại thành một object đồng cấu (isomorphic) với phản hồi HTTP, để logic phân tích bên dưới tái sử dụng hoàn toàn.
        const payload = (r.status === 200 && r.bytes)
            ? r.bytes
            : new TextEncoder().encode(JSON.stringify({ message: r.error || 'Gọi API trong trang thất bại' }));
        resp = new Response(payload, {
            status: r.status || 502,
            headers: { 'Content-Type': r.contentType || 'application/octet-stream' },
        });
    } else {
        try {
            // expand là tham số mở rộng phi tiêu chuẩn: V.Adapter nhận được sẽ mở rộng input trước; Các dịch vụ NAI khác sẽ lơ cái query string này đi.
            const qs = expand ? '?expand=1' : '';
            resp = await fetch(`${base}/ai/generate-image${qs}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${String(apiKey ?? '')}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/avif,image/webp,image/png,image/*;q=0.9,application/json;q=0.5',
                },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
        } catch (err) {
            clearTimeout(timer);
            if (cancelled) throw new Error('Đã chấm dứt');
            if (timedOut) {
                throw new Error(`Yêu cầu timeout (${Math.round(timeoutMs / 1000)} giây): Tuyến trên không phản hồi trong thời gian quy định, bạn có thể tăng "Thời gian timeout" trong cài đặt extension`);
            }
            // Khi địa chỉ điền vào không gọi được, nếu trên cùng trang đang có V.Adapter thì sẽ fallback về gọi hàm trong trang:
            // Nhờ đó những SillyTavern chưa cài module server (Server / Mobile / Bản build mới tinh) cũng có thể xuất ảnh thẳng được.
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
                        // Kết quả fallback link từ xa: Dẫn link trực tiếp hình ảnh của tuyến trên
                        clearTimeout(timer);
                        return { url: String(r2.url), via: String(r2.via ?? ''), expand: '', prompt: '' };
                    } else {
                        bridgeErr = (r2 && r2.error) || `Gọi API trong trang trả về ${r2?.status ?? 'kết quả rỗng'}`;
                    }
                } catch (e2) {
                    bridgeErr = e2?.message ?? String(e2);
                }
            }
            if (!resp) {
                // Khi bridge tồn tại và đưa ra nguyên nhân thất bại rõ ràng thì ưu tiên truyền nguyên nhân thật ra ngoài
                // (Gặp nhiều nhất là: Bản thân V.Adapter chưa cấu hình tuyến trên của nó).
                if (bridgeErr) {
                    throw new Error(`V.Adapter (Kết nối trực tiếp trong trang) xuất ảnh thất bại: ${bridgeErr}`);
                }
                throw new Error(`Không thể kết nối đến dịch vụ NAI (${base}): ${err?.message ?? err}. Vui lòng đảm bảo dịch vụ adapter đã chạy, địa chỉ chính xác và cho phép cross-domain (CORS); Hoặc cài đặt extension V.Adapter để bật kết nối trực tiếp trong trang`);
            }
        }
    }

    if (!resp.ok) {
        clearTimeout(timer);
        throw new Error(await readErrorMessage(resp));
    }

    // V.Adapter sẽ truyền "Prompt thực sự gửi lên tuyến trên" và trạng thái expand vào trong Response Header;
    // Các dịch vụ NAI tiêu chuẩn không cung cấp các header này, lúc lấy không được sẽ ra chuỗi rỗng.
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
        throw new Error(`Đọc response body thất bại: ${err?.message ?? err}`);
    }
    clearTimeout(timer);

    if (!bytes || bytes.byteLength === 0) {
        throw new Error('Dịch vụ NAI trả về phản hồi rỗng');
    }

    // -- ① Luồng byte ảnh nhị phân (Content-Type: image/*) -> Lấy byte xài luôn, không cần giải nén --
    //    V.Adapter khi client báo `Accept: image/*` thì nó sẽ đẩy thẳng byte PNG/JPEG ra (Không bọc ZIP).
    const ctype = String(resp.headers.get('content-type') ?? '').toLowerCase();
    if (ctype.startsWith('image/')) {
        const ext = extFromContentType(ctype) ?? sniffImage(bytes) ?? 'png';
        return { base64: bytesToBase64(bytes), extension: ext, ...meta };
    }

    // -- ② Luồng byte ảnh nguyên chất (Một số dịch vụ Content-Type bị sai, nhận diện theo file magic number) --
    const rawExt = sniffImage(bytes);
    if (rawExt) {
        return { base64: bytesToBase64(bytes), extension: rawExt, ...meta };
    }

    // -- ③ ZIP (Định dạng phản hồi tiêu chuẩn của giao thức NovelAI; NAI chính thức và các dịch vụ NAI khác đi nhánh này) --
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
            throw new Error(`Giải nén ZIP thất bại (Phản hồi có thể đã bị cắt đứt): ${err?.message ?? err}`);
        }

        const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
        if (!names.length) throw new Error('Không có bất kỳ file nào trong ZIP');
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

    // -- ④ Fallback dự phòng: Rất có thể là 1 cái lỗi JSON trả về bằng mã trạng thái 200 --
    let text = '';
    try {
        text = new TextDecoder('utf-8').decode(bytes);
    } catch {
        /* ignore */
    }
    try {
        const j = JSON.parse(text);
        const msg = j?.message ?? j?.error?.message ?? j?.error ?? j?.detail;
        if (msg) throw new Error(String(msg));
        // Tương thích với số ít dịch vụ vứt base64 thẳng vào JSON, nhận diện luôn:
        //   OpenAI sinh ảnh khẩu độ -> { data: [{ b64_json }] }
        //   Neko Image Tower proxy trung gian -> { images: [{ image }] } (base64 PNG)
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

    throw new Error(`Phản hồi không phải ZIP, không phải ảnh và cũng không phải JSON có thể nhận diện: ${truncate(text.replace(/\s+/g, ' '), 160)}`);
}

/**
 * testConnection Test kết nối (Tương ứng với NAI protocol GET /ai/user/subscription).
 * @returns {Promise<string>} Khi thành công trả về văn bản có thể đọc được (Gồm cả cấp bậc đăng ký - tier)
 */
export async function testConnection({ baseUrl, apiKey, timeoutMs = 15000 } = {}) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Vui lòng điền địa chỉ dịch vụ NAI trước');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Math.max(3000, timeoutMs));
    let resp;
    try {
        resp = await fetch(`${base}/ai/user/subscription`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${String(apiKey ?? '')}`, 'Accept': 'application/json' },
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (timedOut) throw new Error('Kết nối timeout: Dịch vụ không phản hồi');
        throw new Error(`Không thể kết nối tới ${base}: ${err?.message ?? err}`);
    }
    clearTimeout(timer);
    if (!resp.ok) throw new Error(await readErrorMessage(resp));
    let tier = '';
    try {
        const j = await resp.json();
        tier = j?.tier ?? j?.subscription?.tier ?? '';
    } catch {
        /* Không phân tích được thì cũng không ảnh hưởng đến kết luận "Đã kết nối thông suốt" */
    }
    return `Kết nối bình thường${tier !== '' ? ` (tier ${tier})` : ''}`;
}