# V.Canvas · Trợ lý Minh họa Cốt truyện SillyTavern

> Chữ viết đảm nhận việc kể chuyện, hình ảnh đảm nhận việc đóng băng khoảnh khắc. V.Canvas lặng lẽ canh gác trong cuộc trò chuyện của SillyTavern -- khi trong cốt truyện xuất hiện khoảnh khắc đáng vẽ, nó sẽ vẽ ngay khung hình đó ra và nhúng ngay dưới đoạn văn tương ứng; không có khoảnh khắc nào đáng vẽ, nó sẽ im lặng bỏ qua. Câu chuyện cứ diễn tiến bình thường, hình ảnh âm thầm được bổ sung.

Một câu chuyện chỉ có chữ viết luôn có cảm giác thiêu thiếu thứ gì đó: nhân vật trông như thế nào, cảnh chiến đấu bùng nổ ra sao, ánh sáng ngay khoảnh khắc tỏ tình, tất cả đều chỉ có thể dựa vào trí tưởng tượng (não bổ). V.Canvas sinh ra chính là để biến "trí tưởng tượng" thành "tận mắt nhìn thấy" -- nó không làm gián đoạn nhịp điệu cuộc trò chuyện của bạn, chỉ đưa ra một bức ảnh vào đúng thời điểm thích hợp.

```
(AI kể một đoạn cốt truyện...)

\[ILLUST: a silver-haired girl standing on a rainy neon street | 1girl, silver hair, cyberpunk, neon lights, rain]

↓ Plugin bắt được thẻ đánh dấu -> Xuất ảnh -> Thay thế tại chỗ thành

(AI kể một đoạn cốt truyện...)

!\[Illustration](/user/images/xxx.png)

(Chữ viết tiếp theo của AI bị ảnh đẩy xuống dưới tiếp tục xếp hàng...)
```

---

## Nó có thể làm gì

### 🖼️ Tự động chèn ảnh: Bắt trọn khoảnh khắc đáng vẽ, không sót một tấm

* **Được điều hướng bằng thẻ đánh dấu (marker), thành hình tại chỗ**: Model cốt truyện xuất ra thẻ `[ILLUST: Mô tả | Tags]` trong phần chính văn (body text), plugin sau khi bắt được sẽ lập tức xuất ảnh ngay dưới đoạn văn đó. Ảnh đi theo đoạn văn, chữ viết phía sau tự động dời xuống, đan xen chữ và hình như Light Novel.
* **Không chiếm ngữ cảnh (context)**: Sau khi xuất ảnh từ thẻ đánh dấu, thẻ sẽ tự động bị loại bỏ khỏi tin nhắn, ảnh minh họa chỉ đi qua tầng hiển thị, không đi vào ngữ cảnh của AI, không chiếm Token.
* **Nhiều tấm một lúc, tự chủ nhịp độ**: Một lượt (turn) có thể lên kế hoạch tối đa nhiều ảnh, mặc định là sinh tuần tự từng tấm (để không kích hoạt kiểm soát rủi ro của tuyến trên), cũng có thể bật chế độ chạy song song (parallel), cái nào về trước chèn trước.
* **Thất bại không để lại tàn tích**: Khi một tấm nào đó thất bại, thẻ đánh dấu nguyên bản sẽ được giữ lại, ảnh đã xuất không vẽ lại, nguyên nhân lỗi sẽ được truyền thẳng ra để hiển thị, tuyệt đối không im lặng (silent fail).

### 🧭 Chèn ảnh bằng luồng kép: Template (khuôn mẫu) có ngoan cố đến mấy cũng có ảnh

* **Điều hướng bằng thẻ đánh dấu (Luồng chính)**: Không tốn thời gian chờ đợi thêm khi model cốt truyện hợp tác, nhận diện được thẻ là xuất ảnh ngay.
* **Xuất ảnh từ ngữ cảnh (Luồng dự phòng)**: Khi chính văn không có thẻ đánh dấu, một model phân tích được cấu hình riêng sẽ đọc toàn bộ chính văn và phần trước đó, tự động sản sinh ra prompt và vị trí chèn, sau đó đi chung một luồng xuất ảnh -- **Không phụ thuộc vào định dạng đầu ra của model cốt truyện**, áp dụng được cho bất kỳ thẻ nhân vật (Character Card) nào.
* **Tồn tại song song và không trùng lặp**: Có thẻ thì đi luồng thẻ, không có thẻ mới phân tích, hai luồng dùng chung một bộ cài đặt xuất ảnh, kết nối tự động.

### 🎛️ Prompt: Hoàn toàn tự động, cũng có thể kiểm soát hoàn toàn

* **Thẻ đánh dấu 2 phần**: Mô tả bằng ngôn ngữ tự nhiên và nhãn Danbooru được sản sinh cùng lúc, tương thích tự nhiên với cả 2 loại tuyến trên.
* **Phân luồng theo tuyến**: 4 mốc `auto / description / tags / both`, quyết định xem sẽ gửi nửa nào cho tuyến trên -- Đi qua dịch vụ adapter thì gửi mô tả, kết nối trực tiếp NAI chính thức thì gửi nhãn, thiếu một nửa sẽ tự động fallback.
* **Từ khóa chất lượng và từ khóa phủ định**: Được tích hợp sẵn mặc định, có thể sửa bất cứ lúc nào.
* **Click để xem ảnh**: Bấm vào bất kỳ ảnh minh họa nào, một overlay (lớp phủ) sẽ hiển thị mô tả và nhãn dùng cho bức ảnh đó; Prompt được lưu theo lịch sử trò chuyện, refresh hay chuyển chat đều không bị mất.

### 🔌 Kênh xuất ảnh: Tập trung vào giao thức NovelAI

* **Dịch vụ adapter V.Adapter (Khuyên dùng)**: Đóng gói tuyến trên OpenAI thành giao thức NAI, plugin chỉ cần điền địa chỉ dịch vụ là xong, mặc định là `http://127.0.0.1:8888`.
* **NovelAI chính thức / NAI Gateway**: Kết nối trực tiếp, tên model điền thủ công (ví dụ `nai-diffusion-4-5-full`).
* **Các dịch vụ tương thích NAI khác**: Chỉ cần triển khai `POST {base}/ai/generate-image` và trả về file ZIP là có thể kết nối.
* **Art style do tuyến trên quyết định**: Khi đi qua dịch vụ adapter sẽ lấy cấu hình art style của server; Khi kết nối trực tiếp sẽ được gửi đi cùng với thẻ prompt. Plugin không có tùy chọn art style, chỉ tập trung vào việc biến thẻ đánh dấu thành ảnh.

### 📁 Quản lý hình ảnh: Vừa chat vừa lưu, sổ sách rõ ràng

* **Thẻ tầng nhúng (Inline floor card)**: Hình ảnh được chèn ngay dưới đoạn văn tương ứng, tương ứng 1:1 với cốt truyện.
* **Lịch sử sinh ảnh đầy đủ**: Tất cả các ảnh đã xuất được ghi lại theo thứ tự thời gian đảo ngược, đổi chat không bị mất, có thể xóa sạch bất cứ lúc nào; Trang "Tổng quan" còn hiển thị thumbnail của các ảnh đã xuất trong cuộc trò chuyện hiện tại.
* **Tiến trình vẽ có thể nhìn thấy**: Thẻ tiến độ lơ lửng trên cùng hiển thị realtime "Đang phân tích -> Đang vẽ n/N -> Hoàn thành / Thất bại", có thể "Chấm dứt" bất cứ lúc nào, nguyên nhân thất bại có thể nhìn thấy ngay lập tức, không bị im lặng.
* **Tương thích định dạng**: png / jpg / webp đều hỗ trợ, tương thích với định dạng đầu ra của các gateway khác nhau.

### ⚙️ Cài đặt: Chi tiết đến từng bước đều có thể tinh chỉnh

* **Bảng quản lý 6 trang**: Tổng quan, Lịch sử sinh ảnh, Prompt, Biên dịch xuất ảnh, Xuất ảnh từ ngữ cảnh, Cài đặt, tất cả tập trung tại một nơi, thay đổi lưu ngay tức thì.
* **Quy tắc kích hoạt có thể điều chỉnh**: Giới hạn mỗi lượt, Song song / Tuần tự, Chèn lại ảnh khi swipe (đổi câu trả lời), Xóa tag, Bỏ qua các loại tin nhắn.
* **Inject quy tắc có thể kiểm soát**: Vị trí inject (`in_chat` / `in_prompt`) và độ sâu (depth) có thể điều chỉnh, tương thích với các loại template thẻ nhân vật khác nhau.
* **Thân thiện với gỡ lỗi (Troubleshooting)**: Công tắc log chi tiết trên console, Khôi phục mặc định bằng một click.

### 🧪 Thân thiện với Developer

* **Tự test offline**: Có thể chạy thông suốt toàn bộ luồng "Giao thức NAI -> ZIP -> base64" và phân tích thẻ / thay thế tại chỗ mà không cần phụ thuộc vào SillyTavern.
* **Kiểm tra khế ước (Contract check)**: Trường cài đặt và control trên bảng điều khiển tương ứng 1:1, thêm mục cài đặt mới mà quên thêm control sẽ báo lỗi ngay.

## Mẹo nhỏ

* **Mở hộp là dùng ngay**: Cấu hình xong địa chỉ tuyến trên và model là có thể tự động chèn ảnh; Nếu chỉ muốn viết tag mà không xuất ảnh, tắt "Bật tự động chèn ảnh" là được.
* **Dùng Gateway dùng chung cần chú ý nhịp độ**: Khuyên bạn nên đặt giới hạn mỗi lượt là 1, tránh kích hoạt giới hạn tần suất (rate limit).
* **Gặp "Thẻ Sandbox" (Sandbox card) hạng nặng**: Giữ nguyên mặc định `in_chat` + độ sâu `0` để inject; Nếu vẫn không có tác dụng thì đưa quy tắc vào Worldbook của riêng thẻ đó.
* **Xuất ảnh từ ngữ cảnh**: Mặc định bị tắt; Trước khi bật hãy điền xong địa chỉ và tên model của model phân tích vào bảng điều khiển.
* **Dữ liệu hình ảnh đi theo cuộc trò chuyện**: Xóa chat là xóa luôn dữ liệu hình ảnh tương ứng.

---

## 1. Yêu cầu Tiền quyết (Dependencies)

Extension này **chỉ sử dụng giao thức NovelAI**, bản thân nó không kết nối trực tiếp với bất kỳ tuyến trên OpenAI nào. Do đó, trước khi xuất ảnh, bạn phải chạy một
**Dịch vụ giao thức NovelAI**, plugin chỉ cần điền địa chỉ của dịch vụ đó:

| Loại tuyến trên | Mô tả |
| --- | --- |
| **Dịch vụ adapter V.Adapter** (Khuyên dùng) | Dịch vụ adapter của riêng người dùng, mặc định `http://127.0.0.1:8888`, đóng gói tuyến trên OpenAI thành giao thức NAI |
| **NAI chính thức / NAI Gateway** | Địa chỉ điền thẳng gateway hoặc `https://image.novelai.net`, tên model phải điền thủ công (ví dụ `nai-diffusion-4-5-full`). **NAI không phải định dạng OpenAI, không thể qua V.Adapter, phải kết nối trực tiếp** |
| Các dịch vụ tương thích giao thức NAI khác | Chỉ cần triển khai `POST {base}/ai/generate-image` và trả về ZIP là được |

> **Art style do tuyến trên quyết định, plugin này không có tùy chọn art style.**
> Khi xuất ảnh qua V.Adapter, art style sẽ lấy từ bản cấu hình của
> **Server Plugin**
> (
> `<SillyTavern>\plugins\V.Adapter\data\`
> , bảo trì tại bảng điều khiển
> `http://127.0.0.1:8888`
> ) --
> Còn art style trong
> **Bảng quản lý extension SillyTavern**
> của V.Adapter chỉ tác dụng cho lệnh
> `/vgen`
> của riêng nó, không liên quan đến plugin này.
> Khi kết nối trực tiếp NAI chính thức / NAI Gateway, art style sẽ được gửi đi cùng với prompt (đoạn nhãn trong thẻ đánh dấu).

### ⚠️ Lưu ý khi sử dụng NAI Gateway của bên thứ ba

1. **Nút "Test kết nối" có thể thất bại, nhưng không có nghĩa là dịch vụ không dùng được.** Phần lớn gateway chỉ cho phép gọi interface xuất ảnh
   (`generate-image`), endpoint subscription bị chặn. **Hãy lấy việc "Lịch sử sinh ảnh" có lưu mục thành công hay không làm chuẩn.**
2. **Bắt buộc phải gửi toàn bộ tập tham số (parameter set).** Nếu chỉ gửi tập nhỏ nhất như `input/model/action/parameters{rộng_cao,số_bước,từ_khóa_phủ_định}`,
   gateway sẽ trả về `400 Invalid Request`. Plugin này gửi một bộ thông số chuẩn NAI 4.x (bao gồm `params_version`,
   `sampler`, `noise_schedule`, `v4_prompt` v.v.), tương thích với cả NAI chính thức / Gateway / V.Adapter.
3. **Quota và Tần suất**: Gateway dùng chung thường giới hạn "N lần/ngày + N lần/phút", trong khi tự động chèn ảnh là một thao tác tải nặng (heavy load).
   Khuyên bạn nên đặt **giới hạn mỗi lượt là 1**, tránh việc trở thành nguồn request kiểu stress-test.
4. **Không khuyến khích bật ảnh tham khảo (reference image) / ảnh vibe, mỗi lần request chỉ nên sinh 1 tấm.** Bản thân plugin này đã sinh tuần tự từng tấm, `n_samples: 1`.
5. Dung lượng ảnh xuất ra có thể từ vài trăm KB đến 2 MB, định dạng có thể là **webp** (Plugin đã hỗ trợ png/jpg/webp).

> Vì sao không hỗ trợ kết nối trực tiếp OpenAI: Nếu hỗ trợ kết nối trực tiếp, người dùng chỉ cần một cái Key là có thể xuất ảnh, dịch vụ chuyển đổi giao thức ở giữa sẽ mất đi ý nghĩa tồn tại.
> Plugin này và V.Adapter là một bộ đôi (companion), phân công công việc rất rõ ràng.

---

## 2. Cài đặt

### Cách 1: Cài đặt từ Repository (Khuyên dùng)

1. Mở SillyTavern -> Panel "Extensions" (Biểu tượng 3 khối vuông) ở thanh trên cùng
2. Click "Install Extension" (Cài đặt tiện ích)
3. Paste địa chỉ kho lưu trữ `https://github.com/Despolca/V.Canvas.git` -> Install
4. Sau khi hoàn tất, trong danh sách extension sẽ xuất hiện "V.Canvas", refresh trang là có thể sử dụng

### Cách 2: Copy thủ công

Copy toàn bộ thư mục này vào thư mục extension của SillyTavern, và đổi tên thành `V.Canvas`:

```
<SillyTavern>/data/<user-handle>/extensions/V.Canvas/

├── manifest.json
├── index.js
├── style.css
├── panel.html          Bảng quản lý (Frontend độc lập, điều khiển ruột extension qua bridge)
├── README.md
└── lib/
    ├── marker.js      Bắt và thay thế tại chỗ thẻ [ILLUST:...]
    ├── nai-api.js     Gọi giao thức NovelAI + Giải nén ZIP
    └── settings.js    Kiểm tra tính hợp lệ và lưu trữ cài đặt
```

Sau đó **Khởi động lại SillyTavern** (hoặc refresh trang), trong panel "Extensions" sẽ xuất hiện **V.Canvas**.

* Đường dẫn truy cập: `/scripts/extensions/third-party/V.Canvas/`
* Dependencies (Phụ thuộc): Không có (Giải nén ZIP sử dụng sẵn `/lib/jszip.min.js` đi kèm SillyTavern, không cần cài thêm thư viện nào khác)

---

## 3. Bảng Quản lý (Tất cả cài đặt đều nằm ở đây)

Sau khi cài đặt xong, trong panel extensions của SillyTavern sẽ xuất hiện mục sau:

```
V.Canvas      v0.1.0

        [ Mở bảng quản lý ]
```

Bấm vào "Mở bảng quản lý" sẽ mở ra Bảng quản lý -- một console nền tối toàn màn hình (Thanh điều hướng bên trái, bố cục dạng thẻ card).
Do không gian trong ngăn kéo (drawer) của SillyTavern có hạn, không thể chứa hết tất cả các trường (field), nên đã tập trung tất cả vào bảng điều khiển.
Bảng điều khiển gồm 6 trang:

| Trang | Nội dung |
| --- | --- |
| **Tổng quan** | Tự động chèn ảnh có bật không, tuyến trên hiện tại, số lượng ảnh đã xuất trong chat này (thumbnail), tóm tắt quy tắc kích hoạt |
| **Lịch sử sinh ảnh** | Toàn bộ hình ảnh minh họa plugin này đã xuất, xếp theo thứ tự thời gian đảo ngược. Lịch sử được lưu (persist) trong cài đặt của SillyTavern, đổi chat không bị mất, có thể xóa sạch |
| **Prompt** | Prompt chất lượng tích cực, prompt phủ định, art style, từ khóa phá giới hạn (tùy chọn) -- Giao cho model phân tích tuân thủ, độ dài không giới hạn, xem 5.3 |
| **Biên dịch xuất ảnh** | Nhập một câu mô tả ngắn -> Do dịch vụ adapter mở rộng thành prompt toàn cảnh -> Xuất ảnh; Kết quả chỉ hiển thị trong bảng điều khiển, không ghi vào lịch sử trò chuyện |
| **Xuất ảnh từ ngữ cảnh** | Cấu hình thêm một model text để đọc chính văn và phần trước đó, sản sinh ra prompt rồi để tuyến trên xuất ảnh vẽ ra. **Không phụ thuộc vào sự hợp tác của model cốt truyện** |
| **Cài đặt** | Công tắc tổng, Địa chỉ tuyến trên / Key / Model, Hình thái prompt, Thông số xuất ảnh (Công tắc song song / Rộng cao / Số bước / CFG / Từ khóa phủ định / Giới hạn / Timeout / Khoảng cách), Quy tắc kích hoạt (Chèn lại ảnh khi swipe, Xóa tag, Bỏ qua loại tin nhắn), Inject prompt (Công tắc / Vị trí / Độ sâu + Text quy tắc + Copy nhanh), Nâng cao (Log debug, Khôi phục mặc định) |

> Ảnh thumbnail trong "Tổng quan" chỉ phản ánh
> **cuộc trò chuyện hiện tại**
> ; "Lịch sử sinh ảnh" là cuốn sổ cái hoàn chỉnh xuyên suốt các chat, công dụng của hai cái này khác nhau.

### ⚠️ Ranh giới trách nhiệm giữa Bảng điều khiển và Backend

* Bảng điều khiển là **một trang độc lập**, không thể đọc hay sửa trạng thái nội bộ của SillyTavern;
* Mỗi hành động (action) phát ra từ bảng điều khiển đều gửi lệnh cho **bản thân extension nằm trong trang SillyTavern** thực thi,
  extension mới thực sự thực hiện sửa đổi dữ liệu -> refresh tin nhắn -> ghi đĩa, sau đó trả kết quả về bảng điều khiển để hiển thị.

Do đó không có chuyện "Bảng điều khiển đã sửa mà SillyTavern chưa đổi" -- bản thân bảng điều khiển không có khả năng sửa chữa,
nó chỉ có thể yêu cầu extension thực thi. Ngược lại, nếu bridge không thể thiết lập (extension load thất bại),
bảng điều khiển sẽ **trực tiếp cảnh báo bằng chữ đỏ**, chứ không dừng lại ở trạng thái không thể sử dụng.

Mọi thay đổi **lưu ngay lập tức** (Trường mất focus (blur) là ghi ngay), lưu thành công sẽ hiển thị thông báo "Đã lưu và có hiệu lực".

### Xử lý lỗi sửa rồi mà chưa thấy tác dụng

SillyTavern có cơ chế cache JS/CSS cho extension. Nếu sửa code xong mà bảng điều khiển không thay đổi, có thể dùng **Ctrl+F5 để force refresh trang SillyTavern**.

---

## 4. Tra cứu nhanh các Trường Cài đặt

| Trường | Giải thích |
| --- | --- |
| Bật tự động chèn ảnh | Công tắc tổng. Khi tắt đi, dù trong chính văn có tag cũng không xuất ảnh |
| Địa chỉ dịch vụ NAI | Mặc định `http://127.0.0.1:8888`; NAI chính thức điền `https://image.novelai.net`; Gateway bên thứ ba điền địa chỉ gateway |
| API Key | `nai_key` của dịch vụ adapter (Mặc định `v-adapter-8888`); Nếu dùng gateway thì điền key do gateway cung cấp |
| Tên model | **Điền thủ công, không có giá trị mặc định**. Bắt buộc điền với NAI chính thức / Gateway; Khi xuất ảnh qua V.Adapter, trường này sẽ bị dịch vụ adapter bỏ qua |
| Rộng / Cao | Mặc định 832 x 1216 (Bố cục dọc, hợp cho ảnh minh họa) |
| Số bước lấy mẫu (Sampling steps) / CFG | Mặc định 28 / 6.0 |
| Prompt phủ định | Tương ứng với `negative_prompt` của NAI |
| Nội dung gửi cho tuyến trên | **Mới**. Quyết định xem phần nào trong thẻ đánh dấu sẽ được gửi cho tuyến trên, xem phần 5 |
| Giới hạn mỗi lượt | Mặc định 2 tấm. **Khi dùng gateway dùng chung, khuyên bạn nên chỉnh thành 1** |
| Timeout / Khoảng cách (Interval) mỗi tấm | Mặc định 300 giây / 0 ms |
| Xuất ảnh song song | Mặc định **tắt** (Tuần tự: Một tấm xong mới request tấm tiếp theo). Khi bật sẽ tung ra đồng loạt bằng giới hạn mỗi lượt, tấm nào trả về trước chèn vào chính văn trước |
| Các loại tin nhắn bỏ qua | Mặc định `impersonate` (Cướp lời) |
| Cấp lại ảnh khi swipe đổi câu trả lời | Mặc định Bật |
| Xóa tag trong chính văn | Mặc định Bật -- Ảnh minh họa chỉ đi qua tầng hiển thị, không vào ngữ cảnh, không tốn Token |
| Tự động giao quy tắc ILLUST cho model | Mặc định Bật (Cũng có thể click "Copy quy tắc" để paste thủ công vào thẻ nhân vật hoặc worldbook) |
| Vị trí inject quy tắc | Mặc định `in_chat` (Chèn trước câu trả lời); Có thể đổi thành `in_prompt` (Gộp vào hệ thống prompt chính) |
| Độ sâu chèn (Depth) | Độ sâu khi dùng `in_chat`, mặc định `0` (Sát ngay trước câu trả lời) |
| Bật xuất ảnh từ ngữ cảnh | Mặc định Tắt. Khi bật, nếu chính văn không có thẻ đánh dấu sẽ chuyển cho model độc lập đọc chính văn để vẽ |
| Model phân tích (Địa chỉ / Key / Tên model) | Cấu hình tương thích OpenAI dành riêng cho model này, không ảnh hưởng gì đến tuyến trên xuất ảnh phía trên |
| Prompt chất lượng tích cực / Prompt phủ định / Art style | Điền ở trang "Prompt", độ dài không giới hạn. Giao cho model phân tích tuân thủ, xem 5.3 |
| Từ khóa phá giới hạn (Tùy chọn, 2 cột) | Điền ở trang "Prompt". **Plugin này không tích hợp sẵn nội dung nào**, để trống thì hoàn toàn không có tác dụng. Từ khóa phá giới hạn của model phân tích sẽ được nối nguyên trạng vào context của mỗi lần request phân tích (Dùng khi model từ chối trả lời do chính văn có nội dung máu me, 18+); Từ khóa phá giới hạn sinh ảnh sẽ được nối vào đầu prompt xuất ảnh. Hình thái nội dung của hai cái này khác nhau nên chia làm 2 cột, do người sử dụng tự điền và tự chịu trách nhiệm |
| Timeout phân tích | Thời gian timeout cho một lần phân tích của chức năng "Xuất ảnh từ ngữ cảnh" |
| Log chi tiết console | Dùng để gỡ lỗi (Troubleshoot) |

---

## 5. Thẻ đánh dấu (Marker) và Nội dung Gửi đi (prompt_format)

### 5.1 Làm sao để AI xuất ra thẻ đánh dấu

Có 2 cách, chọn 1 trong 2:

1. Bật công tắc "Tự động giao quy tắc ILLUST cho model" trong cài đặt (Mặc định đã bật); Hoặc
2. Click "Copy quy tắc", rồi dán đoạn text quy tắc đó vào mục mô tả (Description) / Hệ thống prompt của thẻ nhân vật, hoặc vào **Worldbook** của thẻ nhân vật.

**Lựa chọn Vị trí Inject (Hãy đọc kỹ phần này, sẽ đỡ được rất nhiều thời gian dò lỗi)**

| Giá trị | Hiệu ứng | Khi nào dùng |
| --- | --- | --- |
| `in_chat` + Độ sâu `0` (**Mặc định**) | Quy tắc đóng vai trò như một tin nhắn hệ thống (system prompt) bên trong đoạn hội thoại, chèn vào ngay trước câu trả lời của model | Đa số các trường hợp |
| `in_prompt` | Quy tắc được gộp vào Hệ thống prompt chính (Nằm trên cùng của toàn bộ đoạn prompt) | Khi preset đã tự xử lý ràng buộc định dạng |

⚠️ **Các "Thẻ Sandbox" hạng nặng (Loại thẻ nhét cả bộ template output vào worldbook) nên giữ nguyên mặc định `in_chat` + độ sâu `0`.**
Loại thẻ này thường inject một đống ràng buộc định dạng cứng (hard format constraints) như thanh trạng thái, chuỗi tư duy (Chain of Thought), quy tắc xuất văn bản... vào `depth 0` của worldbook,
nằm sát ngay trước câu trả lời của model. Những quy tắc viết trong hệ thống prompt chính sẽ bị các template này đè lấp đi --
Biểu hiện là **model vẫn ra cốt truyện bình thường, nhưng không chịu viết một cái thẻ đánh dấu nào** (Do đó plugin nằm im ru).
Phải đặt chúng ở cùng một độ sâu (depth) thì model mới coi trọng nó.

Nếu dùng `in_chat` + độ sâu `0` mà vẫn không có hiệu lực, chứng tỏ ràng buộc template của thẻ đó quá mạnh,
vui lòng dùng tính năng "Copy quy tắc" để **thêm quy tắc vào worldbook của chính thẻ đó** (Ví dụ như thêm vào cái mục định nghĩa format output của nó ấy),
như vậy thẻ đánh dấu sẽ trở thành một phần template của nó, chứ không còn là một "yêu cầu bổ sung" từ bên ngoài nữa.

Ví dụ quy tắc (Giới hạn mỗi lượt 2 tấm):

```
Nếu cốt truyện xuất hiện sự chuyển cảnh rõ rệt, thay đổi ngoại hình nhân vật hoặc các khung hình có độ kịch tính cao, vui lòng xuống dòng ngay dưới đoạn văn tương ứng và xuất ra thẻ đánh dấu:

\[ILLUST: Mô tả bằng ngôn ngữ tự nhiên | Danbooru,Tags]

Thẻ đánh dấu bắt buộc phải tuân thủ các yêu cầu sau:

1. Cả hai phần đều phải được điền, ngăn cách bằng dấu |, không được bỏ sót phần nào.
2. Phần mô tả viết bằng ngôn ngữ tự nhiên, bắt buộc phải bao quát đặc điểm ngoại hình nhân vật, trang phục và đạo cụ, tư thế động tác, môi trường bối cảnh, bố cục và góc máy, phong cách nghệ thuật.
3. Phần nhãn sử dụng Danbooru Tag tiếng Anh, ngăn cách bằng dấu phẩy tiếng Anh, xếp theo thứ tự "Chủ thể, Ngoại hình, Trang phục, Động tác, Bối cảnh, Phong cách".
4. Mỗi thẻ đánh dấu phải có tính tự túc (Self-contained): Cần chứa đầy đủ đặc điểm của nhân vật chính và thông tin bối cảnh cho khung hình đó, không phụ thuộc vào các thẻ khác để bổ sung.
5. Khi xuất ra nhiều thẻ trong một lượt, mỗi thẻ phải nhắm đến các khoảnh khắc hình ảnh khác nhau, và phân bổ ở các vị trí khác nhau trong chính văn (Ví dụ: đoạn giữa và đoạn cuối), không được tập trung tại một chỗ, cũng không được mô tả trùng lặp cùng một khung hình.
6. Ý tưởng hình ảnh và cốt truyện chính văn phải được hoàn thành trong cùng một lần sinh văn bản, không cần chờ đợi thêm các bước bổ sung.
7. Thẻ đánh dấu phải được viết ngay bên dưới đoạn văn tự sự của chính văn, đừng viết vào bên trong các khối cấu trúc như thanh trạng thái, khối tư duy, bảng biểu; Nếu chính văn được bọc trong một thẻ nào đó (Ví dụ: \<story_scene>), thẻ đánh dấu phải được viết bên dưới đoạn văn tương ứng bên trong thẻ đó.

Mỗi câu trả lời xuất tối đa 2 thẻ đánh dấu, mỗi thẻ tương ứng với một bức ảnh minh họa, chèn ngay bên dưới đoạn văn tương ứng của chúng.
```

Phạm vi chịu lỗi của thẻ đánh dấu: Dấu hai chấm full-width, thiếu dấu `|`, thừa dấu cách, có dấu xuống dòng bên trong thẻ đều có thể nhận diện được.

### 5.2 Gửi hai nửa cho 2 loại tuyến trên

Hai nửa của thẻ đánh dấu tương ứng với hình thái đầu vào (input) mà 2 loại tuyến trên yêu cầu, **do đó bắt buộc phải viết cả 2 đoạn**:

| Loại tuyến trên | Hình thái đầu vào hợp lệ | Lấy phần nào của thẻ đánh dấu |
| --- | --- | --- |
| NovelAI chính thức / NAI Gateway (Model Diffusion) | Danbooru Tag | Phần nhãn nằm sau dấu `|` |
| V.Adapter và các dịch vụ adapter khác (Tuyến trên định dạng OpenAI, bao gồm cả model chat) | Ngôn ngữ tự nhiên | Phần mô tả nằm trước dấu `|` |

Cài đặt "Nội dung gửi cho tuyến trên" sẽ quyết định thực tế gửi phần nào đi:

| Giá trị | Nội dung gửi | Áp dụng cho |
| --- | --- | --- |
| `auto` (**Mặc định**) | Nếu địa chỉ là `127.0.0.1` / `localhost` / `:8888` (Tức là chuyển qua V.Adapter) -> Gửi mô tả; Các địa chỉ khác -> Gửi nhãn | Cách dùng thông thường bao quát cả 2 luồng |
| `description` | Luôn gửi đoạn mô tả | Đi qua V.Adapter tới tuyến trên định dạng OpenAI |
| `tags` | Luôn gửi đoạn nhãn | Kết nối trực tiếp NovelAI chính thức / NAI Gateway |
| `both` | Gửi gộp đoạn mô tả và đoạn nhãn theo thứ tự "Mô tả, Nhãn" | Tùy chọn an toàn khi không chắc loại tuyến trên |

Nếu một phần tương ứng bị thiếu ở bất kỳ mốc (tier) nào, nó sẽ tự động fallback sang phần còn lại, sẽ không gửi chuỗi rỗng đi.

> Lời giải thích: Đoạn mô tả và đoạn nhãn được AI sản sinh cùng lúc trong quá trình viết chính văn,
> **không phát sinh thêm lời gọi model (model call) hay thời gian chờ đợi nào**
> .
> Việc phân luồng theo kênh thực chất chỉ là chọn lấy phần khác nhau từ thẻ đánh dấu, chi phí khi runtime chỉ là một lần lựa chọn chuỗi (string selection).

### 5.3 Luồng dự phòng: Xuất ảnh từ ngữ cảnh (Không phụ thuộc vào việc model cốt truyện có phối hợp hay không)

Tiền đề của việc điều hướng bằng thẻ đánh dấu là **model cốt truyện phải chịu viết thẻ**. Một số thẻ nhân vật (đặc biệt là các "thẻ Sandbox" có nhồi cả bộ template output vào worldbook) sẽ chiếm dụng output bằng hàng đống ràng buộc định dạng cứng, model chỉ nhận diện cái template của nó, mọi quy tắc inject từ bên ngoài nó không làm theo --
Biểu hiện là **cốt truyện vẫn tiếp diễn bình thường, nhưng không có một thẻ đánh dấu nào được viết ra**, plugin nằm im lìm.

"Xuất ảnh từ ngữ cảnh" chính là luồng dự phòng được chuẩn bị riêng cho chuyện này:

```
Nhân vật trả lời xong
  └─ Trong chính văn không có thẻ đánh dấu?
       └─ Có -> Chuyển cho "Model phân tích" (Model tương thích OpenAI được cấu hình riêng trong bảng điều khiển)
            └─ Nó sẽ đọc chính văn + đoạn chat phía trước, sản xuất ra một vài khung hình: desc (Ngôn ngữ tự nhiên) + tags (Danbooru) + anchor (Trích dẫn văn bản gốc)
                 └─ Plugin sẽ convert kết quả thành thẻ [ILLUST: desc | tags], chèn thẳng vào phía dưới đoạn văn chứa anchor
                      └─ Sau đó dùng lại toàn bộ luồng có sẵn: Xuất ảnh -> Thay thế tại chỗ -> Chính văn không để lại vết tích gì
```

Các điểm chính:

| Hạng mục | Mô tả |
| --- | --- |
| Mối quan hệ với luồng đánh dấu | **Tồn tại song song và không trùng lặp**. Nếu chính văn đã có thẻ đánh dấu thì đi theo luồng đánh dấu (Không phải chờ đợi thêm); Khi không có thẻ mới gọi model phân tích |
| Dependencies (Phụ thuộc) | Chỉ cần một model tương thích OpenAI xài được là đủ. **Không liên quan gì đến định dạng output của thẻ nhân vật**, cho nên thẻ nào cũng xài được |
| Hình thái đầu ra | Mỗi khung hình sẽ sinh ra đồng thời desc và tags, rồi để cài đặt "Nội dung gửi cho tuyến trên" quyết định gửi phần nào -- Dù là qua V.Adapter hay kết nối thẳng NAI/Gateway đều xài được tuốt |
| Yêu cầu về prompt | Prompt chất lượng tích cực, prompt phủ định và art style điền ở trang "Prompt" sẽ được gửi đi trong mỗi request. Tích cực và Art style là ràng buộc cưỡng chế (mandatory), Phủ định là loại trừ; Lời lẽ và tag trong đó model phân tích sẽ tái sử dụng luôn, còn thiếu chi tiết nào nó tự bù đắp |
| Cái giá phải trả | Tốn thêm 1 lần gọi model + 1 lần xuất ảnh, mỗi lượt chat sẽ tốn thêm khoảng 10~30 giây (Phân tích) + 30~60 giây mỗi ảnh (Xuất ảnh) |
| Số lượng ảnh | Bị kiểm soát chung bởi **Giới hạn mỗi lượt** trong trang "Cài đặt", dùng chung setting với luồng đánh dấu; Set 2 thì sinh 2, set 3 thì sinh 3 tấm |
| Vị trí chèn | Do `anchor` (Trích dẫn văn bản gốc) của model phân tích quyết định, chèn ngay dưới đoạn văn chứa câu trích dẫn đó. Khi có nhiều ảnh thì yêu cầu trích xuất ở phần đầu, phần giữa, phần cuối của chính văn, không được tụm hết vào đầu; Trích dẫn có tính khoan dung với sự khác biệt dấu cách, nếu không tìm được vị trí thì ảnh đó sẽ bị lùi về cuối chính văn |
| Kiểm chứng tại chỗ (In-place validation) | Trong bảng điều khiển có nút "Phân tích và Xuất ảnh", có thể test thử ngay lập tức vào câu trả lời cuối cùng của nhân vật, khỏi cần đợi đến vòng chat tiếp theo |

**Thứ tự hạ cánh khi có nhiều ảnh minh họa**: Mặc định là tuần tự (Sinh xong tấm này mới gọi tấm tiếp); Nếu bật **Xuất ảnh song song** ở trang "Cài đặt"
thì sẽ gọi đồng loạt. Trong cả hai chế độ, hễ xuất ảnh thành công là sẽ **chèn ngay lập tức vào chính văn**, không đợi các tấm khác --
Tấm đầu tiên xuất xong là chui luôn vào text, không bị ảnh hưởng bởi số lượng ảnh. Những thẻ chưa xuất được ảnh sẽ không lộ diện thành dạng text trong chính văn.

**Request phân tích là loại cửa sổ dùng 1 lần (One-shot window)**: Mỗi lần request là một set messages hai lượt hoàn toàn mới (`system` + một `user`),
không mang theo lịch sử chat. Nội dung request bao gồm "3 cột cài đặt ở trang Prompt + Tóm tắt phần trước + Chính văn lần này",
tóm tắt phần trước lấy cố định một vài dòng gần nhất, mỗi dòng cắt ngắn (truncate) theo số lượng chữ cố định -- Cho nên lượt thứ 10 hay lượt thứ 100 gửi đi khối lượng vẫn y như nhau,
không có chuyện chat càng dài thì load càng chậm.

**Quy mô sản lượng**: Thuộc tính `desc` của mỗi khung hình là khoảng 500~600 chữ tự nhiên liền mạch, `tags` là chuỗi 300~400 ký tự Danbooru tiếng Anh.
Ngân sách output (output budget) của request sẽ tự động scale lên dựa theo số khung hình, không có chuyện bị cắt ngang (truncate) ở khung thứ hai.

⚠️ Tính năng này mặc định bị tắt. Trước khi bật, vui lòng đảm bảo đã điền xong Địa chỉ và Tên model của "Model phân tích",
và dùng "Test kết nối" để xác minh; Nếu chưa thiết lập, plugin chỉ báo trên console chứ không gửi request.

## 6. Xử lý Phản hồi (Ưu tiên xuất thẳng ảnh, không giải nén ZIP)

Dịch vụ adapter trả về cái gì, plugin sẽ xử lý theo cái đó, **ưu tiên đi đường nào không cần giải nén**:

| Phản hồi | Xử lý |
| --- | --- |
| **Luồng Byte Hình Ảnh** (`Content-Type: image/*`) | **Lấy byte xài luôn**, không giải nén. Plugin gửi request có mang `Accept: image/*`, đi qua V.Adapter sẽ nhảy vào đường này |
| Byte ảnh nguyên chất (Content-Type không chuẩn) | Nhận diện qua Magic Number của file, cũng không cần giải nén |
| ZIP | Nhánh tương thích (Fallback branch): Dùng `/lib/jszip.min.js` có sẵn của SillyTavern giải nén ra lấy ảnh đầu tiên. **NovelAI chính thức và các dịch vụ NAI khác chỉ trả về cái này**, phải giữ nhánh này mới tương thích (universal) được |
| JSON | Lấy `message` ném ra thành lỗi; Thêm tính phòng thủ thì nhận diện luôn `b64_json` |

> Tại sao giữ lại nhánh ZIP: ZIP là
> **Định dạng phản hồi của giao thức NovelAI**
> , chứ không phải lớp vỏ ngoài do plugin này thêm vào.
> Nếu gỡ bỏ nhánh này, plugin sẽ chỉ chơi được với mỗi dịch vụ adapter "cây nhà lá vườn".
> Các luồng thông thường (qua V.Adapter) sẽ không dính vào khâu giải nén.
> Tại sao URL cuối cùng không xài
> `URL.createObjectURL(blob)`
> : object URL là địa chỉ
> **tạm thời**
> ,
> F5 cái là tèo, mà ảnh minh họa thì phải ghi vào chat log, F5 xong vẫn phải còn (Check phần nghiệm thu số 10).
> Thế nên lấy được byte xong phải gọi
> `saveBase64AsFile()`
> lưu thẳng xuống thư mục ảnh của SillyTavern (Ví dụ
> `/user/images/<Nhân vật>/xxx.png`
> ),
> URL trong tin nhắn lưu cái URL ổn định đó -- Đấy là điều kiện tiên quyết để việc "Chèn tại chỗ" có thể tồn tại lâu dài.

### 6.1 Tham số mở rộng phi tiêu chuẩn

Quy trình tự động chèn ảnh chỉ dùng giao thức NovelAI tiêu chuẩn, không đính kèm bất kỳ tham số phi tiêu chuẩn nào. Có 2 ngoại lệ sau đây, đều được truyền qua query string,
**Chỉ những dịch vụ nào hiểu được mới phản hồi, các dịch vụ NAI khác sẽ lơ luôn**:

| Tham số | Người dùng | Ý nghĩa |
| --- | --- | --- |
| `expand=1` | Trang "Biên dịch xuất ảnh" của plugin này | Yêu cầu tuyến trên mở rộng `input` thành prompt hình ảnh trọn vẹn rồi mới xuất ảnh. Chỉ có V.Adapter thực hiện; Việc mở rộng do model chat của tuyến trên làm, plugin này không nắm giữ credential của model chat |

Response Header đi kèm (Do V.Adapter trả về, các dịch vụ khác không có):

| Response Header | Ý nghĩa |
| --- | --- |
| `X-Illust-Via` | Luồng xuất ảnh nào thực sự chạy (Interface tiêu chuẩn / Fallback bằng chat) |
| `X-Illust-Prompt` | Prompt thực sự bắn lên tuyến trên (Đã URL encode), dùng để check kết quả mở rộng ở bảng điều khiển |
| `X-Illust-Expand` | Trạng thái mở rộng: `ok` / `fallback` (Thất bại và fallback về việc gửi nguyên dạng (raw)) |

Mở rộng thất bại sẽ không làm đứt đoạn việc xuất ảnh -- Tuyến trên sẽ fallback về việc gửi y xì cái `input` đi, và để lại một mục `expand` trong Lịch sử sinh ảnh.

---

## 7. Placeholder (Văn bản giữ chỗ) khi đang vẽ

Sau khi nhận diện được tag, plugin sẽ hiển thị dòng chữ "Đang vẽ ảnh minh họa... khoảng 30~60 giây" ở **ngay tại vị trí tag cũ trong chính văn**,
sau khi xuất ảnh xong toàn bộ tin nhắn sẽ render lại, placeholder tự động bị thay thế bằng ảnh thật.

⚠️ Placeholder này **chỉ sửa DOM, tuyệt đối không ghi vào lịch sử trò chuyện**. Nếu ghi vào `mes`, lỡ như xuất ảnh tạch hoặc User bấm F5,
thì cái dòng "Đang vẽ..." nó sẽ ghim vĩnh viễn trong log, và không có cái cơ chế nào xóa được nó.

### 7.1 Thẻ tiến độ lơ lửng

Ngoài cái placeholder trong dòng, plugin còn hiện thêm một **Thẻ tiến độ lơ lửng** (Floating progress card) ở tuốt trên cùng màn hình, xuất hiện trong suốt quá trình phân tích / vẽ,
hiển thị giai đoạn hiện tại và kèm theo một **Nút "Chấm dứt" (Terminate)**:

```
┌──────────────────────────────────────────────┐
│ \[Vi]  V.Canvas                              │
│       Đang phân tích chính văn... (khoảng 10~30s)     \[Chấm dứt] │
└──────────────────────────────────────────────┘
```

* Các mốc tiến độ lần lượt là: `Đang phân tích chính văn...` -> `Đang vẽ ảnh minh họa n/N...` -> `Hoàn thành` / `Lỗi`
* Click "Chấm dứt" sẽ hủy ngang lượt này (Cả request phân tích lẫn request xuất ảnh đều bị cancel), thẻ ngay lập tức đổi thành "Đã chấm dứt"
* **Bị lỗi hay "Kết quả phân tích rỗng" cũng hiện lên thẻ này luôn**, không có chuyện fail ngầm (silent fail) -- Đây là điểm tựa chính để bắt mạch sự cố "Ủa sao không thấy hiện tượng gì?"
* Dòng báo xong xuôi sẽ trụ lại vài giây rồi tự lặn, dòng báo lỗi sẽ nằm lâu hơn tí; Hoặc bạn có thể bấm "Đóng" thủ công
* Cái thẻ này chỉ có mặt ở tầng DOM, không dính líu gì tới lịch sử chat, không xía vào ngữ cảnh

---

## 8. Xem Prompt của Ảnh minh họa

Prompt xài cho ảnh minh họa **sẽ không ló mặt trên chính văn, cũng không chui vào ngữ cảnh của AI** (Tùy chọn `strip_marker` bật mặc định,
hễ xuất ảnh xong là tag bị đá đít khỏi `mes` ngay tắp lự). Nếu muốn soi, **Cứ click thẳng vào bức ảnh đó**, một popup overlay sẽ bung ra
hiển thị hai đoạn văn bản: Mô tả tự nhiên (Natural language) và Nhãn Danbooru của bức ảnh đó.

* Prompt được cất kèm theo lịch sử chat (Trường `extra.illust.src` là văn bản gốc bọc tag), nên dù bạn có F5, hay lượn sang chat khác thì nó vẫn còn y nguyên đó;
* Thẻ đánh dấu (marker) ăn khớp với ảnh minh họa 1:1 theo thứ tự xuất hiện, overlay tự định vị nhờ cái này, khỏi tốn dung lượng lưu trữ gì thêm;
* Overlay là một cái DOM tạm do plugin tự đẻ ra, tắt là biến mất, không đụng vào lịch sử chat;
* Thiết kế xài Click (Bấm) thay vì Hover (Mobile đâu có vụ đưa chuột), và cũng cạch mặt thuộc tính `title` (Xấu hoắc).

Hiệu năng: Sự kiện Click được gán vào theo dạng **Ủy quyền sự kiện (Event Delegation)** ngay từ lúc load trang, không hề gắn bám vào từng bức ảnh riêng lẻ;
Prompt chỉ bị parse (phân tích) vào đúng lúc có Click, khâu render chả tốn xíu tài nguyên nào, cũng chả phát sinh gọi model hay bắn network request.

---

## 9. Cốt lõi Hành vi (Behavior Details)

* **Chiếm nguyên hàng (Block-level)**: Ảnh là block-level element, tự động đá chữ xích xuống dòng dưới, không lơ lửng (float), không bọc quanh chữ (wrap).
* **Chèn tại chỗ**: Ảnh chèn vào ngay phía dưới đoạn văn chứa tag, chứ không phải chui tuốt xuống đít tin nhắn.
* **Chạy ngầm xếp hàng**: Việc xuất ảnh chạy ngầm dưới nền từng tấm một, khung chat không bị khóa, User vẫn buôn chuyện phà phà.
  Cố tình thiết kế cho nó chạy xếp hàng đấy -- Bơm song song (Concurrency) dễ bị tuyến trên dòm ngó khóa mỏ (Rate limit).
* **Chống đúp**: Tin nhắn nào xử lý xong sẽ đóng mộc `extra.illust_done`, dù có F5 / sang chat khác / render lại cỡ nào cũng không kích hoạt xuất ảnh thêm lần nữa.
* **Fail trong tầm tay**: Tấm nào xui xẻo tạch thì thẻ marker của nó giữ nguyên, mấy tấm xong rồi không vẽ lại; Cục lỗi được pass thẳng ra từ message của dịch vụ adapter
  (Message này là text dễ đọc: Mắc rào (Risk control) / Content Policy / Timeout đồ).
* **Không làm rác log chat**: Gợi ý placeholder chỉ đổi DOM thôi; Có tạch thì lịch sử chat cũng không đọng lại cái dòng "Đang vẽ ảnh..." dở dở ương ương.

---

## 10. Giới hạn đã biết

* CSS `.mes_text img { display: block }` là xài global,
  Nó sẽ "hốt xác" luôn mấy tấm ảnh markdown khác trong tin nhắn (Đè hết thành canh giữa theo block), chuyện này là cố ý (Expected behavior).
* Nếu tự tay sửa lại tin nhắn làm số lượng thẻ tag thay đổi, plugin sẽ clean luôn trạng thái xuất ảnh của tin nhắn đó (Không vẽ lại, chống chuyện xuất ảnh bậy bạ hao tiền).
* Phiên bản đầu tiên chưa có nút "Tự vẽ lại" (Manual Redraw).

---

## 11. Dành cho Developer: Tự test Offline

Trong mục `test/` có chứa một bài test không cần vịn vào SillyTavern: Chạy một server giả lập NAI ở local, phóng thông một lèo
"Giao thức NAI -> ZIP -> base64" cùng với bộ test phân tích thẻ / Thay thế tại chỗ full nhánh.

```bash
python test/make_fixtures.py     # Tạo ảnh PNG / file ZIP dùng để test
node test/test.mjs               # 57 cái Assert (Parse thẻ / Chia luồng prompt / Thay thế tại chỗ / Full chu trình giao thức NAI)
node test/contract.mjs           # Test tính nhất quán giữa Action của bảng điều khiển và Bridge + Test bao phủ (Coverage) các trường Setting
```

`test/contract.mjs` lấy danh sách trường từ `defaultSettings` của `lib/settings.js` làm chuẩn,
check coi mỗi cái setting có cái Control tương ứng ở `panel.html` chưa -- **Thêm mục setting mới xong là phải update cái bảng điều khiển liền**, không là check lỗi ngay.

---

## 12. Giấy phép (License)

Được cấp phép dưới **MIT License + Điều khoản bổ sung phi thương mại (Non-commercial)** (Xem `LICENSE`), Tác giả VILK.

* Cấm thương mại: Nếu chưa có sự ủy quyền bằng văn bản của tác giả, không được phép bán, cho thuê, tích hợp vào các sản phẩm hoặc dịch vụ thương mại, cũng không được phép trục lợi trực tiếp hoặc gián tiếp dưới bất kỳ hình thức nào như quảng cáo, nhận donate, triển khai có thu phí, dựng hộ (hosting)...;
* Cho phép sử dụng cá nhân, học tập nghiên cứu, sao chép, sửa đổi (Sáng tác phái sinh) và lan truyền thứ cấp với mục đích phi thương mại;
* Khi sáng tác phái sinh và tái phân phối **BẮT BUỘC phải giữ lại tên tác giả gốc (VILK)** và tuyên bố license này;
* **Chỉ dành cho mục đích học tập và nghiên cứu**, vui lòng tuân thủ điều khoản dịch vụ (TOS) của tuyến trên, người dùng tự chịu rủi ro khi sử dụng;
* Bản phần mềm này được cung cấp theo "Nguyên trạng" (As is), không kèm theo bất kỳ bảo đảm rõ ràng hay ngầm định nào, tác giả không chịu trách nhiệm cho bất kỳ hậu quả nào phát sinh từ việc sử dụng chương trình này.