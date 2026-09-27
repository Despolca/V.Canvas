// vsig.js - Chữ ký "Key độc quyền" của V-site (Logic thuần túy, không phụ thuộc vào SillyTavern, có thể tách khỏi trình duyệt để Unit Test độc lập).
//
// Bối cảnh: V-site phát hành hai loại key
//   - Key thông dụng (Chuỗi ngẫu nhiên 40 ký tự, không có tiền tố): Site này không verify chữ ký, bất kỳ client NAI nào cũng dùng được, trừ vào quota thông dụng.
//   - Key độc quyền (Tiền tố vcs_): Bắt buộc phải mang theo chữ ký, nếu không V-site sẽ trả về 403 trực tiếp và không giáng cấp xuống quota thông dụng.
//     Chữ ký là md5(key + ngày UTC + salt chia sẻ), server dung sai ±1 ngày (do chênh lệch múi giờ/đồng hồ).
//
// Phạm vi áp dụng của extension này (Phần 6 của giải pháp "Xâm nhập tối thiểu"):
//   Chỉ khi key bắt đầu bằng vcs_, mới đính kèm header chữ ký X-V-Sig vào request NAI.
//   Các trường hợp còn lại (NovelAI chính thức, bất kỳ instance/trung chuyển bên thứ ba nào) **hành vi hoàn toàn không đổi**, không gửi thêm bất kỳ trường nào.
//
// Salt chia sẻ bắt buộc phải khớp với exclusiveSalt trong config.json của V-site mục tiêu.
// Giá trị mặc định đồng bộ với site chính thức online; Nếu instance tự host có đổi salt, chỉ cần điền vào "Salt chữ ký độc quyền" trong cài đặt extension để ghi đè
// (Việc luân chuyển salt cũng tương tự: Đổi ở server + Đổi ở đây, bản thân key của người dùng không bị ảnh hưởng).

/**
 * Salt chia sẻ dự phòng: Chỉ sử dụng khi **không lấy được salt hiện tại của site** (Offline, site là phiên bản cũ chưa trả về salt v.v.).
 *
 * ⚠️ Đừng coi salt là một hằng số cố định để dựa vào: Một khi site luân chuyển `exclusiveSalt`, giá trị cũ bị hardcode trong client
 * sẽ vĩnh viễn ký sai. Đường dẫn bình thường là kéo salt hiện tại từ site lúc runtime (Xem fetchSalt), ở đây chỉ dùng làm dự phòng.
 * Các instance tự host có thể chỉ định bắt buộc trong "Salt chữ ký độc quyền" của cài đặt extension, độ ưu tiên cao nhất.
 */
export const DEFAULT_EXCLUSIVE_SALT = '';

/* ---------------- Salt hiện tại của site (Kéo lúc runtime, hỗ trợ site đổi salt) ---------------- */

const saltCache = new Map(); // base -> salt hiện tại của site đó

/**
 * fetchSalt Truy vấn site xem salt chia sẻ hiện tại nó đang dùng là gì (v.salt của GET /ai/user/subscription).
 * Kết quả được cache theo địa chỉ site, trong một session chỉ hỏi một lần; Thất bại trả về '' (Bên gọi lùi về giá trị dự phòng).
 *
 * Chỉ key độc quyền vcs_ mới đi vào đây - NAI chính thức và trung chuyển bên thứ ba sẽ không phát sinh thêm bất kỳ request nào.
 *
 * @param {string} baseUrl Địa chỉ NAI của site
 * @param {string} apiKey  Bearer key (API này không verify chữ ký, key thông dụng/độc quyền đều có thể truy vấn)
 * @param {number} [timeoutMs]
 * @returns {Promise<string>} Salt hiện tại của site; Trả về chuỗi rỗng khi không lấy được
 */
export async function fetchSalt(baseUrl, apiKey, timeoutMs = 8000) {
    const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (saltCache.has(base)) return saltCache.get(base);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(2000, timeoutMs));
    try {
        const r = await fetch(`${base}/ai/user/subscription`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${String(apiKey ?? '')}`,
                'Accept': 'application/json',
            },
            signal: ctrl.signal,
        });
        if (r.ok) {
            const j = await r.json();
            const s = String(j?.v?.salt ?? j?.salt ?? '').trim();
            if (s) {
                saltCache.set(base, s);
                return s;
            }
        }
    } catch {
        /* Không lấy được thì lùi về giá trị dự phòng, không ảnh hưởng đến luồng xuất ảnh */
    } finally {
        clearTimeout(timer);
    }
    return '';
}

/** Xóa cache salt (Được gọi khi đổi địa chỉ site, hoặc site vừa đổi salt cần lấy lại ngay lập tức) */
export function clearSaltCache(baseUrl) {
    if (baseUrl === undefined) saltCache.clear();
    else saltCache.delete(String(baseUrl).trim().replace(/\/+$/, ''));
}

/** Tiền tố key độc quyền */
export const EXCLUSIVE_PREFIX = 'vcs_';

/** Có phải là key độc quyền của V-site hay không (Chỉ nó mới cần chữ ký) */
export function isExclusiveKey(key) {
    return String(key ?? '').trim().toLowerCase().startsWith(EXCLUSIVE_PREFIX);
}

/** Chuỗi ngày UTC YYYY-MM-DD (Tiêu chuẩn đồng nhất với utcDateStr của server) */
export function utcDateStr(offsetDays = 0) {
    const d = new Date(Date.now() + Number(offsetDays || 0) * 86400000);
    return d.toISOString().slice(0, 10);
}

/* ---------------- MD5 (Trình duyệt không có node:crypto, tích hợp sẵn một bản implement rút gọn) ---------------- */

const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i+1)) * 2^32), tính một lần lúc runtime là đủ, tránh hardcode bị chép sai.
const K = new Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

// Digest của MD5 xuất ra theo thứ tự byte **little-endian**: Viết byte thấp của status word 32-bit lên trước.
// (Dùng toString(16) trực tiếp sẽ xuất theo big-endian, chuỗi thu được mỗi nhóm 4 byte sẽ bị ngược.)
function hex32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    let s = '';
    for (let i = 0; i < 4; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
}

/** md5Hex Tính MD5 của chuỗi (Đầu vào encode theo UTF-8), trả về chuỗi hex viết thường 32 ký tự. */
export function md5Hex(text) {
    const msg = new TextEncoder().encode(String(text ?? ''));
    const len = msg.length;
    const bitLen = len * 8;
    // Padding: 0x80 + một số 0x00, sao cho độ dài ≡ 56 (mod 64), 8 byte cuối chứa độ dài bit gốc (little-endian)
    const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
    const total = len + 1 + padLen + 8;
    const buf = new Uint8Array(total);
    buf.set(msg, 0);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Int32Array(16);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            const t = (A + F + K[i] + (M[g] >>> 0)) >>> 0;
            A = D; D = C; C = B;
            B = (B + (((t << S[i]) | (t >>> (32 - S[i]))) >>> 0)) >>> 0;
        }
        a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    return hex32(a0) + hex32(b0) + hex32(c0) + hex32(d0);
}

/**
 * exclusiveSig Tính chữ ký trong ngày của key độc quyền: md5(key + ngày UTC + salt).
 * @param {string} key  Key độc quyền (tiền tố vcs_)
 * @param {string} [salt] Salt chia sẻ; để trống sẽ dùng giá trị mặc định tích hợp
 * @param {number} [offsetDays] Độ lệch ngày (Server dung sai ±1 ngày, gọi bình thường không cần truyền)
 */
export function exclusiveSig(key, salt, offsetDays = 0) {
    return md5Hex(String(key ?? '') + utcDateStr(offsetDays) + String(salt || DEFAULT_EXCLUSIVE_SALT));
}

/* ---------------- Khi nào thì gửi chữ ký ---------------- */

/**
 * sigHeaders Header chữ ký cần đính kèm vào request NAI.
 *
 * Chỉ có một điều kiện trigger duy nhất: Key là key độc quyền của V-site (Tiền tố vcs_, xem phần 6 của giải pháp).
 * Các trường hợp còn lại - NovelAI chính thức, bất kỳ trung chuyển bên thứ ba nào, key thông dụng của V-site - nhất luật trả về object rỗng,
 * Header request **hoàn toàn giống hệt** so với trước khi có thay đổi này, không thêm bất kỳ trường nào.
 * (Custom header sẽ trigger CORS pre-flight, tuyệt đối không được thêm vô tội vạ cho mọi tuyến trên.)
 *
 * @param {string} key  Bearer key
 * @param {string} [salt] Giá trị ghi đè salt chia sẻ (Dùng cho instance tự host / khi luân chuyển salt)
 * @param {{baseUrl?:string, mode?:'auto'|'off'}} [opt]
 *        mode='off' là công tắc tổng: Cho dù điền key vcs_ cũng không gửi chữ ký (Dùng để gỡ lỗi / rollback)
 * @returns {Record<string,string>} Mảnh header request (Có thể spread trực tiếp vào headers của fetch)
 */
let warnedNoSalt = false;

export function sigHeaders(key, salt, opt = {}) {
    if (opt.mode === 'off') return {};
    const k = String(key ?? '').trim();
    if (!isExclusiveKey(k)) return {};

    const s = String(salt ?? '').trim() || DEFAULT_EXCLUSIVE_SALT;
    if (!s) {
        // Không có salt thì không thể tính ra chữ ký đúng, thay vì gửi đi một giá trị sai chắc chắn bị từ chối, thà không gửi còn hơn,
        // và nhắc nhở một lần đi điền salt (V-site sẽ trả về 403 "Cần phối hợp với V.Canvas", giống như khi chưa bật).
        if (!warnedNoSalt) {
            warnedNoSalt = true;
            console.warn('[V.Canvas] Đã phát hiện key độc quyền của V-site, nhưng chưa cấu hình "Salt chữ ký độc quyền": ' +
                'Vui lòng điền salt của site đó trong cài đặt extension, nếu không key độc quyền sẽ bị V-site từ chối (Key thông dụng không bị ảnh hưởng).');
        }
        return {};
    }
    return { 'X-V-Sig': exclusiveSig(k, s) };
}