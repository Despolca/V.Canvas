// Kiểm tra tính nhất quán tĩnh: Các action được gọi bởi bảng điều khiển vs Các action được implement trong cầu nối (bridge).
// Tên action không khớp là nguyên nhân phổ biến nhất gây ra lỗi "click nút không phản hồi", do đó cần verify riêng.
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
out.push('Bảng điều khiển gọi: ' + [...called].sort().join(', '));
out.push('Bridge implement: ' + [...cases].sort().join(', '));

let bad = 0;
for (const a of called) {
    if (!cases.has(a)) { out.push(`❌ Bảng điều khiển gọi nhưng bridge không implement: ${a}`); bad++; }
}
for (const a of cases) {
    if (!called.has(a)) out.push(`⚠️  Bridge implement nhưng bảng điều khiển không dùng đến: ${a}`);
}

// Các trường bảng điều khiển đọc vs Dữ liệu bridge trả về
const stateBlock = bridge.slice(bridge.indexOf("case 'state'"), bridge.indexOf("case 'settings.get'"));
const panelStateFields = new Set();
for (const m of html.matchAll(/\bd\.([a-z_A-Z]+)/g)) panelStateFields.add(m[1]);
for (const m of html.matchAll(/\bs\.([a-z_]+)/g)) panelStateFields.add(m[1]);

// Danh sách trường cài đặt lấy defaultSettings của lib/settings.js làm Nguồn sự thật duy nhất (Single Source of Truth),
// tránh việc duy trì một bản sao hardcode ở đây dẫn đến việc kiểm tra bị lệch (mismatch) khi thêm trường mới.
const settings = fs.readFileSync(dir + 'lib/settings.js', 'utf8');
const defBlock = settings.slice(settings.indexOf('function defaultSettings'), settings.indexOf('const BOOL_KEYS'));
// Chỉ kiểm tra các trường vô hướng (scalar): history là danh sách dữ liệu có tính persistence, được render bởi trang "Lịch sử tạo ảnh", không tương ứng với control nhập liệu nào.
const defKeys = [...defBlock.matchAll(/^\s{8}([a-z_]+):\s*([^,\n]+)/gm)]
    .filter(m => !/^[[{]/.test(m[2].trim()))
    .map(m => m[1]);

const idFields = new Set();
for (const m of html.matchAll(/f-([a-z_]+)"/g)) idFields.add(m[1]);
for (const m of html.matchAll(/sw-([a-z_]+)"/g)) idFields.add(m[1]);
const missingIds = defKeys.filter(k => !idFields.has(k));
out.push(`Trong cài đặt có tổng cộng ${defKeys.length} trường; Bảng điều khiển chưa bao phủ (cover): ${missingIds.length ? missingIds.join(', ') : '(Không có)'}`);

out.push(bad ? `RESULT: ${bad} action không khớp` : 'RESULT: Khế ước action (Action contract) nhất quán');
fs.writeFileSync(dir + 'test/contract.txt', out.join('\n'), 'utf8');
process.exit(bad ? 1 : 0);