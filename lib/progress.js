// progress.js - Thẻ tiến trình xuất ảnh nổi.
//
// Chỉ thao tác DOM: Thẻ không ghi vào lịch sử trò chuyện, cũng không đi vào context.
// Thường trú một instance trong quá trình phân tích / vẽ, hiển thị giai đoạn hiện tại và kèm theo nút "Dừng";
// Tự động ẩn sau khi kết thúc hoặc thất bại (Thất bại sẽ lưu lại lâu hơn để dễ nhìn rõ nguyên nhân).
//
// Thẻ đi theo theme của SillyTavern (sử dụng biến SmartTheme), không đưa vào phối màu cố định.

const CARD_ID = 'v_canvas_progress';

// Thời gian tự động ẩn sau khi kết thúc (mili giây)
const HIDE_DELAY_OK = 3500;
const HIDE_DELAY_ERR = 12000;

let hideTimer = null;
let cancelHandler = null;

// setCancelHandler Đăng ký callback cho nút "Dừng"; truyền null để xóa.
export function setCancelHandler(fn) {
    cancelHandler = fn;
}

function clearTimer() {
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function card() {
    let el = document.getElementById(CARD_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = CARD_ID;
    el.innerHTML = `
        <div class="v_canvas_pg_mark">Vi</div>
        <div class="v_canvas_pg_body">
            <div class="v_canvas_pg_title">V.Canvas</div>
            <div class="v_canvas_pg_text"></div>
        </div>
        <button type="button" class="v_canvas_pg_btn menu_button">Dừng</button>`;

    el.querySelector('.v_canvas_pg_btn').addEventListener('click', () => {
        const stop = el.querySelector('.v_canvas_pg_btn');
        if (stop.dataset.mode === 'close') {
            hideProgress();
            return;
        }
        // Dừng: Đưa ra phản hồi trước, sau đó để bên gọi abort request hiện tại
        stop.dataset.mode = 'close';
        stop.textContent = 'Đóng';
        el.classList.add('v_canvas_pg_finishing');
        text('Đang dừng...');
        try {
            cancelHandler?.();
        } catch { /* Bỏ qua */ }
    });

    document.body.appendChild(el);
    return el;
}

function text(s) {
    const el = document.getElementById(CARD_ID);
    if (el) el.querySelector('.v_canvas_pg_text').textContent = String(s ?? '');
}

// showProgress Hiển thị / cập nhật trạng thái đang diễn ra.
export function showProgress(s) {
    clearTimer();
    const el = card();
    el.classList.remove('v_canvas_pg_done', 'v_canvas_pg_err', 'v_canvas_pg_finishing');
    const btn = el.querySelector('.v_canvas_pg_btn');
    btn.dataset.mode = 'stop';
    btn.textContent = 'Dừng';
    el.classList.add('show');
    text(s);
}

// updateProgress Chỉ đổi chữ (Dùng khi chuyển giai đoạn, không reset trạng thái nút).
export function updateProgress(s) {
    text(s);
}

// finishProgress Kết thúc: Phân biệt thành công và thất bại, nút chuyển thành "Đóng" và tự động ẩn.
export function finishProgress(s, isError = false) {
    clearTimer();
    const el = card();
    el.classList.remove('v_canvas_pg_finishing');
    el.classList.add('show', isError ? 'v_canvas_pg_err' : 'v_canvas_pg_done');
    const btn = el.querySelector('.v_canvas_pg_btn');
    btn.dataset.mode = 'close';
    btn.textContent = 'Đóng';
    text(s);
    hideTimer = setTimeout(() => hideProgress(), isError ? HIDE_DELAY_ERR : HIDE_DELAY_OK);
}

// hideProgress Ẩn ngay lập tức (Cũng gọi khi thoát extension).
export function hideProgress() {
    clearTimer();
    const el = document.getElementById(CARD_ID);
    if (el) el.remove();
}