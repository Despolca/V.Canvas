// Kiểm tra tính nhất quán tĩnh: Các action do bảng điều khiển gọi vs các action được triển khai trong bridge.
// Tên action không đồng nhất là nguyên nhân phổ biến nhất gây ra lỗi "bấm nút không phản hồi", do đó phải kiểm tra riêng.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url))) + path.sep;
const html = fs.readFileSync(dir + 'panel.html', 'utf8');
const js = fs.readFileSync(dir + 'index.js', 'utf8');

const called = new Set();
for (const m of html.matchAll(/call\(\s*'([^']+)'/g)) called.add(m[1]);

const bridge = js.slice(js.indexOf('function installBridge'));
const cases = new Set();
for (const m of bridge.matchAll(/case\s+'([^']+)'/g)) cases.add(m[1]);

const out = [];
out.push('Bảng điều khiển gọi (call): ' + [...called].sort().join(', '));
out.push('Bridge triển khai: ' + [...cases].sort().join(', '));

let bad = 0;
for (const a of called) {
    if (!cases.has(a)) { out.push(`❌ Bảng điều khiển gọi nhưng bridge chưa triển khai: ${a}`); bad++; }
}
for (const a of cases) {
    if (!called.has(a)) out.push(`⚠️  Bridge đã triển khai nhưng bảng điều khiển không dùng đến: ${a}`);
}

// Các trường bảng điều khiển đọc vs Dữ liệu bridge trả về
const stateBlock = bridge.slice(bridge.indexOf("case 'state'"), bridge.indexOf("case 'settings.get'"));
const panelStateFields = new Set();
for (const m of html.matchAll(/\bd\.([a-z_A-Z]+)/g)) panelStateFields.add(m[1]);
for (const m of html.matchAll(/\bs\.([a-z_]+)/g)) panelStateFields.add(m[1]);

// Danh sách các trường cài đặt lấy defaultSettings của lib/settings.js làm "nguồn sự thật duy nhất" (Single Source of Truth),
// tránh việc bảo trì một bản sao hardcode ở đây dẫn đến việc các mục kiểm tra bị lệch (mismatch) khi thêm trường mới.
const settings = fs.readFileSync(dir + 'lib/settings.js', 'utf8');
const defBlock = settings.slice(settings.indexOf('function defaultSettings'), settings.indexOf('const BOOL_KEYS'));
// Chỉ kiểm tra các trường vô hướng (scalar): history là danh sách dữ liệu được lưu trữ cố định (persist), do trang "Lịch sử sinh ảnh" render, không tương ứng với control đầu vào.
const defKeys = [...defBlock.matchAll(/^\s{8}([a-z_]+):\s*([^,\n]+)/gm)]
    .filter(m => !/^[[{]/.test(m[2].trim()))
    .map(m => m[1]);

const idFields = new Set();
for (const m of html.matchAll(/f-([a-z_]+)"/g)) idFields.add(m[1]);
for (const m of html.matchAll(/sw-([a-z_]+)"/g)) idFields.add(m[1]);
const missingIds = defKeys.filter(k => !idFields.has(k));
out.push(`Trong cài đặt có tổng cộng ${defKeys.length} trường; Bảng điều khiển chưa bao phủ (cover): ${missingIds.length ? missingIds.join(', ') : '(Không có)'}`);

out.push(bad ? `RESULT: ${bad} action không khớp nhau` : 'RESULT: Khế ước action đồng nhất');
fs.writeFileSync(dir + 'test/contract.txt', out.join('\n'), 'utf8');
process.exit(bad ? 1 : 0);