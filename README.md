# V.Canvas · Trợ lý minh họa cốt truyện SillyTavern

> Chữ viết đảm nhận việc kể chuyện, hình ảnh đảm nhận việc đóng băng khoảnh khắc. V.Canvas lặng lẽ canh gác trong các cuộc trò chuyện của SillyTavern - Khi cốt truyện xuất hiện khoảnh khắc đáng vẽ, nó sẽ vẽ lại khung hình đó và nhúng ngay xuống dưới đoạn văn tương ứng; nếu không có khoảnh khắc nào đáng vẽ, nó sẽ lặng lẽ bỏ qua. Câu chuyện vẫn tiếp tục, hình ảnh âm thầm được bổ sung.

Một câu chuyện chỉ có chữ luôn có cảm giác thiếu thiếu điều gì đó: Nhân vật trông ra sao, cảnh chiến đấu bùng nổ thế nào, ánh sáng lúc tỏ tình ra sao, tất cả chỉ có thể dựa vào trí tưởng tượng. V.Canvas sinh ra chính là để biến "tưởng tượng" thành "tận mắt nhìn thấy" - Nó không làm gián đoạn nhịp điệu trò chuyện của bạn, chỉ đưa ra một bức ảnh vào đúng thời điểm thích hợp nhất.



```
(AI kể một đoạn cốt truyện...)

\\\\\\\\\\\\\\\[ILLUST: a silver-haired girl standing on a rainy neon street | 1girl, silver hair, cyberpunk, neon lights, rain]

↓ Plugin bắt được đánh dấu -> Xuất ảnh -> Thay thế tại chỗ thành

(AI kể một đoạn cốt truyện...)

!\\\\\\\\\\\\\\\[Illustration]\\\\\\\\(/user/images/xxx.png)

(Chữ viết tiếp theo của AI bị ảnh đẩy xuống dưới tiếp tục sắp xếp...)
```



***

## Nó có thể làm gì

### 🖼️ Tự động minh họa: Khoảnh khắc đáng vẽ, không sót một tấm nào



* **Điều khiển bằng đánh dấu (Marker-driven), tạo ảnh tại chỗ**: Model cốt truyện xuất ra đánh dấu `[ILLUST: Mô tả | Tags]` trong phần thân bài, plugin sau khi bắt được sẽ xuất ảnh ngay bên dưới đoạn văn đó. Hình ảnh đi theo đoạn văn, chữ viết phía sau tự động trượt xuống, tạo thành kiểu xen kẽ hình - chữ như Light Novel.

* **Không chiếm context**: Sau khi xuất ảnh từ đánh dấu, nó sẽ tự động bị loại bỏ khỏi tin nhắn, hình minh họa chỉ đi qua lớp hiển thị, không đi vào context của AI, không tốn Token.

* **Một lần nhiều ảnh, tự kiểm soát nhịp độ**: Mỗi lượt có thể lên kế hoạch tối đa nhiều ảnh, mặc định tạo lần lượt từng ảnh một (không kích hoạt kiểm soát rủi ro của tuyến trên), cũng có thể bật chạy song song, ảnh nào về trước thì chèn trước.

* **Thất bại không để lại rác**: Khi một ảnh nào đó thất bại, đánh dấu sẽ được giữ nguyên trạng, ảnh đã xuất không bị vẽ lại, nguyên nhân lỗi được hiển thị truyền qua trực tiếp, tuyệt đối không im lặng (silent fail).

### 🧭 Ba luồng minh họa: Template cứng đầu đến mấy cũng có ảnh



* **Điều khiển bằng đánh dấu**: Thời gian chờ thêm bằng 0 khi model cốt truyện phối hợp, nhận diện được đánh dấu là xuất ảnh ngay.

* **Xuất trực tiếp thân bài nguyên trạng (Bật mặc định)**: Khi thân bài không có đánh dấu, nó sẽ lấy **toàn bộ phần thân bài của nhân vật vừa mới tạo ra này** gửi nguyên xi cho tuyến trên xuất ảnh. Chuỗi xử lý là "Văn -> Ảnh", nghĩa là Text-to-Image theo đúng nghĩa đen - Không tốn thêm một lần gọi model nào, cũng không cần cấu hình bất kỳ model phân tích nào.

* **Model phân tích chuyển thành prompt**: Khi thân bài không có đánh dấu, model phân tích sẽ đọc toàn bộ thân bài và phần trước đó, tự động tạo ra prompt và vị trí chèn, sau đó đi qua cùng một luồng xuất ảnh - **Không phụ thuộc vào định dạng đầu ra của model cốt truyện**, áp dụng được cho bất kỳ thẻ nhân vật nào, và cũng là **lựa chọn duy nhất khả dụng khi kết nối trực tiếp với NAI chính thức**.

* **Cấu hình số 0 (Zero-config)**: Mặc định đi theo luồng xuất trực tiếp, cài xong là dùng được ngay; Model phân tích mặc định sử dụng **API chính của SillyTavern** (model mà bạn đang dùng để chat), không cần điền địa chỉ và key.

* **Cùng tồn tại và không lặp lại**: Có đánh dấu thì đi theo đánh dấu, không có đánh dấu mới bổ sung ảnh; Cả hai luồng bổ sung ảnh dùng chung một bộ cài đặt xuất ảnh, có thể chuyển đổi bất cứ lúc nào trên bảng điều khiển.

### 🎛️ Prompt: Hoàn toàn tự động, cũng có thể kiểm soát hoàn toàn



* **Đánh dấu hai đoạn**: Mô tả ngôn ngữ tự nhiên và thẻ Danbooru được tạo ra đồng thời, tương thích tự nhiên với hai loại tuyến trên.

* **Phân luồng theo chuỗi**: Bốn tùy chọn `auto / description / tags / both`, quyết định gửi nửa nào cho tuyến trên - Gửi mô tả khi qua service chuyển đổi, gửi thẻ khi kết nối trực tiếp NAI chính thức, nếu thiếu một nửa sẽ tự động lùi về nửa kia.

* **Từ chất lượng và từ tiêu cực**: Mặc định tích hợp sẵn, có thể sửa bất cứ lúc nào.

* **Chuỗi họa sĩ (Công thức phong cách vẽ)**: Có thể lưu nhiều bộ kết hợp thẻ họa sĩ thường dùng, đặt tên riêng, kéo xuống một chút là đổi được ngay, cũng có thể chọn "Không sử dụng". Chuỗi được chọn sẽ được ghép vào trước thẻ hình ảnh, dùng để khóa tông màu phong cách vẽ của toàn bộ bức tranh. **Chỉ có tác dụng khi kết nối trực tiếp với NovelAI chính thức / Gateway NAI**, nguyên nhân xem phần 5.4.

* **Click để xem ảnh**: Click vào bất kỳ hình minh họa nào, một popup sẽ hiển thị mô tả và thẻ được sử dụng cho bức ảnh đó; Prompt được lưu cùng lịch sử trò chuyện, làm mới trang, chuyển đổi trò chuyện đều không bị mất.

### 🔌 Kênh xuất ảnh: Tập trung vào giao thức NovelAI



* **Service chuyển đổi V.Adapter (Khuyên dùng)**: Đóng gói tuyến trên OpenAI thành giao thức NAI, plugin chỉ cần điền địa chỉ service, mặc định là `http://127.0.0.1:8888`.

* **NovelAI chính thức / Gateway NAI**: Kết nối trực tiếp, tên model điền thủ công (ví dụ `nai-diffusion-4-5-full`).

* **Các service tương thích NAI khác**: Chỉ cần implement `POST {base}/ai/generate-image` và trả về ZIP là có thể kết nối.

* **Phong cách vẽ do tuyến trên quyết định**: Khi đi qua service chuyển đổi sẽ lấy cấu hình phong cách vẽ của server; Khi kết nối trực tiếp sẽ gửi đi cùng với thẻ prompt. Plugin không có tùy chọn phong cách vẽ, chỉ tập trung vào việc biến đánh dấu thành ảnh.

### 📁 Quản lý hình ảnh: Lưu ngay khi chat, sổ sách rõ ràng



* **Thẻ tầng nhúng**: Hình ảnh được chèn ngay dưới đoạn văn tương ứng, tương ứng 1-1 với cốt truyện.

* **Lịch sử tạo ảnh hoàn chỉnh**: Tất cả ảnh xuất ra được ghi lại theo thứ tự thời gian đảo ngược, không bị mất khi chuyển đổi trò chuyện, có thể xóa sạch bất cứ lúc nào; Trang "Tổng quan" hiển thị thêm thumbnail ảnh xuất ra của cuộc trò chuyện hiện tại.

* **Quá trình vẽ có thể nhìn thấy**: Thẻ tiến trình nổi ở trên cùng hiển thị thời gian thực "Đang phân tích -> Đang vẽ n/N -> Hoàn tất / Thất bại", có thể "Dừng" bất cứ lúc nào, nguyên nhân thất bại hiển thị trực tiếp, không im lặng.

* **Tương thích định dạng**: png / jpg / webp đều được hỗ trợ, tương thích với định dạng đầu ra của các gateway khác nhau.

### ⚙️ Cài đặt: Chi tiết đến từng bước đều có thể tinh chỉnh



* **Bảng quản lý sáu trang**: Tổng quan, Lịch sử tạo, Prompt, Dịch nhân vật xuất ảnh, Xuất ảnh theo context, Cài đặt, tất cả tập trung tại một nơi, thay đổi lưu ngay lập tức.

* **Quy tắc trigger có thể tinh chỉnh**: Giới hạn mỗi lượt, Song song / Tuần tự, Cấp lại ảnh khi swipe, Loại bỏ tag, Các loại tin nhắn bị bỏ qua.

* **Kiểm soát tiêm quy tắc (Rule injection)**: Vị trí tiêm (`in_chat` / `in_prompt`) và độ sâu có thể điều chỉnh, tương thích với các template thẻ nhân vật khác nhau.

* **Thân thiện với gỡ lỗi (Troubleshooting)**: Công tắc log chi tiết trên console, khôi phục mặc định bằng một click.

### 🧪 Thân thiện với lập trình viên



* **Tự test offline (Offline self-test)**: Không phụ thuộc vào SillyTavern vẫn có thể chạy thông toàn bộ quy trình "Giao thức NAI -> ZIP -> base64" và phân tích đánh dấu / thay thế tại chỗ.

* **Kiểm tra khế ước (Contract check)**: Trường cài đặt và UI control trên bảng điều khiển tương ứng 1-1, thêm mục cài đặt mới mà quên thêm control sẽ báo lỗi ngay lập tức.

## Mẹo nhỏ



* **Dùng được ngay sau khi cài (Out-of-the-box)**: Công tắc tổng mặc định được bật, cấu hình xong kênh xuất ảnh là sẽ tự động minh họa; Nếu không muốn điền một chữ nào, cài V.Adapter vào là nó sẽ tự động kết nối trực tiếp. Nếu chỉ muốn viết tag mà không xuất ảnh, hãy tắt "Bật tự động minh họa".

* **Lưu ý nhịp độ khi dùng gateway chia sẻ**: Khuyên bạn nên đặt giới hạn mỗi lượt là 1, tránh kích hoạt giới hạn tần suất (rate limit).

* **Thẻ "Sandbox" hạng nặng**: Giữ nguyên vị trí tiêm mặc định là `in_chat` + độ sâu `0`; Nếu vẫn không có tác dụng thì hãy thêm quy tắc vào Worldbook của chính thẻ đó.

* **Xuất ảnh theo context**: Mặc định bật, và mặc định dùng API chính của SillyTavern, không cần cấu hình. Lưu ý nó **sẽ gọi model thêm một lần mỗi lượt** (chính là model mà bạn đang dùng để chat), nếu model chính khá đắt hoặc chậm, bạn có thể chọn một model nhẹ tùy chỉnh trên bảng điều khiển.

* **Dữ liệu hình ảnh đi theo cuộc trò chuyện**: Xóa cuộc trò chuyện sẽ xóa luôn dữ liệu hình ảnh tương ứng.



***

## I. Phụ thuộc tiền đề (Prerequisites)

Extension này **chỉ sử dụng giao thức NovelAI**, bản thân nó không kết nối trực tiếp với bất kỳ tuyến trên OpenAI nào. Do đó trước khi xuất ảnh, cần phải chạy một

**Service giao thức NovelAI**, plugin chỉ cần điền địa chỉ của service này:



| Loại tuyến trên | Mô tả |
| --- | --- |
| **Service chuyển đổi V.Adapter** (Khuyên dùng) | Service chuyển đổi của riêng người dùng, mặc định `http://127.0.0.1:8888`, đóng gói tuyến trên OpenAI thành giao thức NAI |
| **NAI chính thức / Gateway NAI** | Địa chỉ điền trực tiếp gateway hoặc `https://image.novelai.net`, tên model phải điền thủ công (ví dụ `nai-diffusion-4-5-full`). **NAI không phải định dạng OpenAI, không thể đi qua V.Adapter, bắt buộc phải kết nối trực tiếp** |
| Các service tương thích giao thức NAI khác | Chỉ cần implement `POST {base}/ai/generate-image` và trả về ZIP là được |

> **Phong cách vẽ do tuyến trên quyết định, plugin này không có tùy chọn phong cách vẽ.**
> Khi xuất ảnh qua V.Adapter, phong cách vẽ được lấy từ
> cấu hình của **Plugin server**
> (
> `<SillyTavern>\plugins\V.Adapter\data\`
> , quản lý tại bảng điều khiển
> `http://127.0.0.1:8888`
> ) -
> Phong cách vẽ trong **bảng điều khiển extension SillyTavern** của V.Adapter
> chỉ có tác dụng đối với lệnh `/vgen` của chính nó, không liên quan đến plugin này.
> Khi kết nối trực tiếp NAI chính thức / Gateway NAI, phong cách vẽ được gửi đi cùng với prompt (đoạn thẻ trong đánh dấu).

### ⚠️ Lưu ý khi sử dụng gateway NAI của bên thứ ba



1. **Nút "Test kết nối" có thể báo thất bại, nhưng không có nghĩa là service không dùng được.** Đa số gateway chỉ cho phép gọi API xuất ảnh

   (`generate-image`), endpoint subscription bị chặn. **Hãy lấy việc có mục thành công trong "Lịch sử tạo" làm chuẩn.**

2. **Bắt buộc phải gửi bộ tham số đầy đủ.** Nếu chỉ gửi bộ tối thiểu như `input/model/action/parameters{rộng cao,số bước,từ tiêu cực}`,

   gateway sẽ trả về `400 Yêu cầu không hợp lệ`. Plugin này gửi toàn bộ bộ tham số NAI 4.x (Bao gồm `params_version`,

   `sampler`, `noise_schedule`, `v4_prompt` v.v...), áp dụng được cho cả NAI chính thức / Gateway / V.Adapter.

3. **Quota và Tần suất (Rate limit)**: Các gateway chia sẻ thường giới hạn "N lần mỗi ngày + N lần mỗi phút", trong khi tự động minh họa là một tác vụ nặng (heavy load).

   Khuyên bạn nên đặt **giới hạn mỗi lượt là 1**, tránh biến thành nguồn request stress test.

4. **Không khuyến khích bật ảnh tham chiếu / ảnh vibe, mỗi request chỉ tạo một ảnh.** Bản thân plugin này là chạy tuần tự từng tấm một, `n_samples: 1`.

5. Dung lượng ảnh xuất ra có thể từ vài trăm KB đến 2 MB, định dạng có thể là **webp** (Plugin đã hỗ trợ png/jpg/webp).

> Tại sao không hỗ trợ kết nối trực tiếp OpenAI: Nếu hỗ trợ kết nối trực tiếp, người dùng chỉ cần một Key là có thể xuất ảnh, service chuyển đổi giao thức ở giữa sẽ mất đi ý nghĩa tồn tại.
> Plugin này và V.Adapter là một bộ đôi (companion), phân công rõ ràng.



***

## II. Cài đặt

Copy toàn bộ thư mục này vào thư mục extension của SillyTavern, và đổi tên thành `V.Canvas`:



```
\\\\\\\\\\\\\\\<SillyTavern>/data/\\\\\\\\\\\\\\\<user-handle>/extensions/V.Canvas/

├── manifest.json

├── index.js

├── style.css

├── panel.html          Bảng quản lý (Frontend độc lập, điều khiển extension qua bridge)

├── README.md

└── lib/

\\\\\\\&#x20;   ├── marker.js      Bắt và thay thế tại chỗ đánh dấu \\\\\\\\\\\\\\\[ILLUST:...]

\\\\\\\&#x20;   ├── nai-api.js     Gọi giao thức NovelAI + Giải nén ZIP

\\\\\\\&#x20;   └── settings.js    Xác minh và lưu trữ cài đặt
```

Sau đó **khởi động lại SillyTavern** (hoặc refresh trang), trong bảng điều khiển "Extension" sẽ xuất hiện **V.Canvas**.



* Đường dẫn truy cập: `/scripts/extensions/third-party/V.Canvas/`

* Dependency: Không có (Giải nén ZIP sử dụng `/lib/jszip.min.js` đi kèm của SillyTavern, không cần cài thêm thư viện)



***

## III. Bảng quản lý (Mọi cài đặt đều nằm ở đây)

Sau khi cài đặt xong, trong bảng điều khiển extension của SillyTavern sẽ xuất hiện mục sau:



```
V.Canvas      v0.1.3

\\\\\\\&#x20;       \\\\\\\\\\\\\\\[ Mở bảng quản lý ]
```

Click "Mở bảng quản lý" là sẽ mở ra bảng quản lý - Một console màu tối full màn hình (Điều hướng bên trái, layout dạng thẻ).

Do không gian ngăn kéo của SillyTavern có hạn, không thể chứa hết tất cả các trường, nên được tập trung đặt vào bảng điều khiển.

Bảng điều khiển gồm sáu trang:



| Trang | Nội dung |
| --- | --- |
| **Tổng quan** | Bật/tắt tự động minh họa, tuyến trên hiện tại, **model phân tích đang có hiệu lực**, số lượng ảnh đã xuất trong cuộc trò chuyện này (thumbnail), tóm tắt quy tắc trigger |
| **Lịch sử tạo** | Toàn bộ hình minh họa do plugin này xuất ra, sắp xếp theo thời gian đảo ngược. Lịch sử được lưu trong cài đặt của SillyTavern, chuyển đổi trò chuyện không bị mất, có thể xóa sạch |
| **Prompt** | Prompt chất lượng tích cực, prompt tiêu cực, phong cách vẽ, từ phá giới hạn (không bắt buộc) - Giao cho model phân tích tuân thủ, độ dài không giới hạn, xem 5.3 |
| **Dịch nhân vật** | Nhập một câu mô tả ngắn gọn -> Service chuyển đổi sẽ mở rộng thành prompt hình ảnh hoàn chỉnh -> Xuất ảnh; Kết quả chỉ hiển thị trong bảng điều khiển, không ghi vào lịch sử trò chuyện |
| **Context xuất ảnh** | Nguồn model phân tích (Mặc định đi theo API chính của SillyTavern, có thể chọn tùy chỉnh) + Thời gian chờ phân tích (timeout) + Nút "Phân tích và xuất ảnh" 1-click để xác minh luồng. **Không phụ thuộc vào sự phối hợp của model cốt truyện** |
| **Cài đặt** | Công tắc tổng, loại tuyến trên, địa chỉ / Key / model tuyến trên, hình thái prompt, tham số xuất ảnh (công tắc song song / rộng cao / số bước / CFG / từ tiêu cực / giới hạn / timeout / khoảng cách), quy tắc trigger (swipe cấp lại, loại bỏ tag, loại tin nhắn bị bỏ qua), tiêm prompt (công tắc / vị trí / độ sâu + văn bản quy tắc + copy 1-click), nâng cao (log debug, khôi phục mặc định) |

> Thumbnail ở "Tổng quan" chỉ phản ánh **cuộc trò chuyện hiện tại**; "Lịch sử tạo" là cuốn sổ cái hoàn chỉnh xuyên suốt các cuộc trò chuyện, mục đích sử dụng của cả hai là khác nhau.

### ⚠️ Ranh giới trách nhiệm giữa bảng điều khiển và backend



* Bảng điều khiển là **một trang độc lập**, không thể đọc hoặc sửa đổi trạng thái bên trong của SillyTavern;

* Mỗi hành động do bảng điều khiển phát động, đều gửi lệnh cho **bản thân extension nằm trong trang SillyTavern** thực thi,

  extension thực thi việc sửa đổi dữ liệu -> refresh tin nhắn -> ghi vào đĩa, sau đó truyền kết quả về bảng điều khiển để hiển thị.

Do đó không tồn tại tình trạng "Bảng điều khiển đã sửa mà SillyTavern chưa thay đổi" - Bản thân bảng điều khiển không có khả năng sửa đổi,

chỉ có thể yêu cầu extension thực thi. Ngược lại, nếu bridge không thể thiết lập (extension load thất bại),

bảng điều khiển sẽ **trực tiếp báo động bằng chữ đỏ**, chứ không dừng lại ở trạng thái không khả dụng.

Thay đổi **được lưu ngay lập tức** (Trường mất focus là ghi ngay), lưu thành công sẽ hiển thị thông báo "Đã lưu và áp dụng".

### Xử lý khi sửa đổi không có tác dụng

SillyTavern có cache JS/CSS đối với extension. Sau khi sửa đổi code, nếu bảng điều khiển không có sự thay đổi, bạn có thể dùng **Ctrl+F5 để force refresh trang SillyTavern**.



***

## IV. Tra cứu nhanh các trường



| Trường | Mô tả |
| --- | --- |
| Bật tự động minh họa | Công tắc tổng, **mặc định bật**. Tắt đi thì cả hai luồng bổ sung ảnh đều dừng (tag trong thân bài và xuất ảnh theo context đều không xuất ảnh) |
| Địa chỉ service NAI | **Mặc định để trống** = Kết nối trực tiếp với extension V.Adapter trên cùng trang (Không cần port, cài V.Adapter là không cần điền). Cũng có thể điền địa chỉ chính thức `https://image.novelai.net` hoặc gateway bên thứ ba |
| API Key | `nai_key` của service chuyển đổi (mặc định `v-adapter-8888`); Đối với gateway thì điền key do gateway cung cấp |
| Tên model | **Điền thủ công, không có giá trị mặc định**. NAI chính thức / Gateway bắt buộc phải điền; Khi đi qua V.Adapter thì service chuyển đổi sẽ phớt lờ trường này |
| Rộng / Cao | Mặc định 832 x 1216 (Khung dọc, thích hợp cho minh họa) |
| Số bước lấy mẫu (Steps) / CFG | Mặc định 28 / 6.0 |
| Prompt tiêu cực | Tương ứng với `negative_prompt` của NAI |
| Nội dung gửi cho tuyến trên | **Mới thêm**. Quyết định phần nào trong đánh dấu sẽ được gửi cho tuyến trên, xem mục 5 |
| Chuỗi họa sĩ | Cấu hình ở trang "Prompt", mặc định "Không sử dụng". **Chỉ khi kết nối trực tiếp NAI chính thức / Gateway NAI thì mới được ghép vào đầu prompt**; Khi đi qua V.Adapter sẽ tự động bỏ qua, xem 5.4 |
| Giới hạn mỗi lượt | Mặc định 2 ảnh. **Khi sử dụng gateway chia sẻ, khuyên bạn nên đặt là 1** |
| Timeout / Khoảng cách (Interval) 1 ảnh | Mặc định 300 giây / 0 mili giây |
| Xuất ảnh song song | Mặc định **tắt** (Tuần tự: Xong một ảnh mới request ảnh tiếp theo). Sau khi bật sẽ gửi đi cùng lúc theo giới hạn mỗi lượt, ảnh nào về trước chèn vào thân bài trước |
| Loại tin nhắn bị bỏ qua | Mặc định `impersonate` |
| Swipe đổi câu trả lời thì cấp lại ảnh | Mặc định bật |
| Loại bỏ tag trong thân bài | Mặc định bật - Hình minh họa chỉ đi qua lớp hiển thị, không đi vào context, không chiếm Token |
| Tự động giao quy tắc ILLUST cho model | Mặc định bật (Cũng có thể click "Copy quy tắc" để dán thủ công vào thẻ nhân vật hoặc Worldbook) |
| Vị trí tiêm quy tắc | Mặc định `in_chat` (Chèn trước câu trả lời); Có thể đổi thành `in_prompt` (Gộp vào system prompt chính) |
| Độ sâu chèn (Depth) | Độ sâu khi `in_chat`, mặc định `0` (Sát ngay trước câu trả lời) |
| Bật xuất ảnh theo context | **Mặc định bật**. Sau khi bật, khi thân bài không có đánh dấu sẽ chuyển sang dùng model phân tích đọc thân bài để cấp ảnh |
| Dùng model nào để đọc | **Mặc định "Theo API chính của SillyTavern"** - Dùng chính model mà bạn đang chat, không cần điền bất kỳ địa chỉ và key nào, request do SillyTavern forward. Khi đổi sang "Tùy chỉnh một model" mới dùng đến 3 mục bên dưới |
| Model phân tích (Địa chỉ / Key / Tên model) | Chỉ có tác dụng khi "Tùy chỉnh": Cấu hình tương thích OpenAI dành riêng cho model này, không ảnh hưởng đến tuyến trên xuất ảnh ở trên |
| Prompt chất lượng tích cực / Prompt tiêu cực / Phong cách vẽ | Điền ở trang "Prompt", độ dài không giới hạn. Do model phân tích tuân thủ, xem 5.3 |
| Từ phá giới hạn (Tùy chọn, 2 cột) | Điền ở trang "Prompt". **Plugin này không tích hợp sẵn bất kỳ nội dung nào**, để trống là hoàn toàn không có tác dụng. Từ phá giới hạn của model phân tích được ghép nguyên xi vào mỗi request phân tích của xuất ảnh theo context (Dùng khi bị từ chối trả lời do thân bài máu me, người lớn); Từ phá giới hạn của tuyến trên xuất ảnh được ghép vào đầu prompt xuất ảnh. Do nội dung của cả hai có hình thái khác nhau nên chia làm 2 cột, người dùng tự điền, tự chịu trách nhiệm |
| Timeout phân tích | Thời gian timeout cho một lần phân tích của xuất ảnh theo context. Khi theo API chính, giá trị này chỉ quyết định "Chờ bao lâu thì không đợi nữa" (Request tầng dưới do SillyTavern gửi đi, plugin này không thể ngắt được) |
| Log chi tiết console | Dùng để troubleshooting |



***

## V. Đánh dấu và Nội dung gửi đi (prompt\_format)

### 5.1 Làm sao để AI xuất ra đánh dấu

Có 2 cách, tùy chọn 1 trong 2:



1. Bật công tắc "Tự động giao quy tắc ILLUST cho model" trong phần cài đặt (Mặc định đã bật); hoặc

2. Click "Copy quy tắc", dán văn bản quy tắc vào mô tả / system prompt của thẻ nhân vật, hoặc vào **Worldbook** của thẻ nhân vật.

**Lựa chọn vị trí tiêm (Đọc kỹ phần này trước sẽ tiết kiệm được rất nhiều thời gian troubleshoot)**



| Giá trị | Hiệu ứng | Khi nào dùng |
| --- | --- | --- |
| `in_chat` + độ sâu `0` (**Mặc định**) | Quy tắc đóng vai trò là system message bên trong cuộc hội thoại, chèn vào trước câu trả lời của model | Đại đa số trường hợp |
| `in_prompt` | Quy tắc được gộp vào system prompt chính (Nằm ở đầu của toàn bộ đoạn prompt) | Khi preset đã tự xử lý các ràng buộc định dạng |

⚠️ **Các "Thẻ Sandbox" hạng nặng (Thẻ mang cả bộ template đầu ra trong Worldbook) nên giữ nguyên mặc định là `in_chat` + độ sâu `0`.**

Những loại thẻ này sẽ tiêm thanh trạng thái, chuỗi tư duy (COT), quy tắc đầu ra và hàng loạt các ràng buộc định dạng cứng khác ở `depth 0` của Worldbook,

vị trí bám sát ngay trước câu trả lời của model. Quy tắc viết trong system prompt chính sẽ bị những template này đè bẹp -

Biểu hiện là **model vẫn ra cốt truyện bình thường, nhưng không viết một cái đánh dấu nào** (Plugin vì thế hoàn toàn nằm im).

Phải đặt chúng ở cùng một độ sâu thì model mới đối xử nghiêm túc.

Nếu `in_chat` + độ sâu `0` vẫn không có tác dụng, chứng tỏ ràng buộc template của thẻ đó quá mạnh,

hãy dùng "Copy quy tắc" để **thêm quy tắc vào Worldbook của chính thẻ đó** (Ví dụ như vào cái entry định nghĩa định dạng đầu ra của nó),

như vậy đánh dấu sẽ trở thành một phần template của nó, chứ không còn là một "yêu cầu bổ sung" từ bên ngoài nữa.

Quy tắc ví dụ (Giới hạn mỗi lượt 2 ảnh):



```
Nếu cốt truyện xuất hiện sự chuyển cảnh rõ rệt, ngoại hình nhân vật thay đổi hoặc các khung hình căng thẳng cao độ, vui lòng xuống dòng và xuất ra đánh dấu ngay dưới đoạn văn tương ứng:

\\\\\\\\\\\\\\\[ILLUST: Mô tả bằng ngôn ngữ tự nhiên | Danbooru,Tags]

Đánh dấu phải tuân thủ các yêu cầu sau:

1\\\\\\\\. Cả hai đoạn đều phải điền, ngăn cách bằng dấu |, không được bỏ sót bất kỳ đoạn nào.

2\\\\\\\\. Đoạn mô tả viết bằng ngôn ngữ tự nhiên, phải bao quát các đặc điểm ngoại hình nhân vật, trang phục và đạo cụ, tư thế hành động, môi trường cảnh vật, bố cục và góc máy, phong cách vẽ.

3\\\\\\\\. Đoạn tag sử dụng thẻ Danbooru tiếng Anh, ngăn cách bằng dấu phẩy tiếng Anh, sắp xếp theo thứ tự "Chủ thể, ngoại hình, trang phục, hành động, cảnh vật, phong cách".

4\\\\\\\\. Hành động và các bộ phận cơ thể phải viết cụ thể: Biến các hành động thực tế xảy ra trong khung hình, các bộ phận cơ thể liên quan và mối quan hệ tiếp xúc, lần lượt chuyển thành các thẻ Danbooru chính xác (như kissing, hugging, groping, handjob, fellatio, cunnilingus, spread legs, breasts, nipples v.v.), tương ứng 1-1 với nội dung thực tế xảy ra trong cốt truyện lúc đó; Không được dùng các từ khóa phân loại độ tuổi chung chung như nsfw, nude, sex để thay thế cho khung hình cụ thể, từ khóa chung chung tối đa chỉ được dùng làm giải thích bổ sung.

5\\\\\\\\. Một đánh dấu đơn lẻ phải tự cung tự cấp: Cần chứa đầy đủ đặc điểm của nhân vật chính và thông tin cảnh vật của khung hình đó, không phụ thuộc vào các đánh dấu khác để bổ sung.

6\\\\\\\\. Khi xuất ra nhiều đánh dấu trong một lượt, mỗi đánh dấu phải hướng đến các khoảnh khắc hình ảnh khác nhau, và phân bố ở các vị trí khác nhau trong thân bài (ví dụ đoạn giữa và đoạn cuối), không được tập trung tại một chỗ, cũng không được miêu tả lặp lại cùng một khung hình.

7\\\\\\\\. Việc lên ý tưởng hình ảnh và thân bài cốt truyện được hoàn thành cùng lúc trong một lần tạo, không cần chờ thêm bước nào khác.

8\\\\\\\\. Đánh dấu viết ngay dưới đoạn văn tường thuật của thân bài, không viết bên trong thanh trạng thái, khối suy nghĩ, bảng biểu hoặc các khối có cấu trúc khác; Nếu thân bài được bọc trong một thẻ nào đó (như \\\\\\\\\\\\\\\<story\\\\\\\\\\\\\\\_scene>), thì đánh dấu viết dưới đoạn văn tương ứng bên trong thẻ.

Mỗi câu trả lời xuất ra tối đa 2 đánh dấu, mỗi đánh dấu tương ứng với một hình minh họa, lần lượt chèn ngay dưới đoạn văn tương ứng.
```

Phạm vi dung sai của đánh dấu: Dấu hai chấm full-width, thiếu `|`, thừa dấu cách, có dấu xuống dòng bên trong đánh dấu đều có thể nhận diện được.

### 5.2 Hai nửa lần lượt gửi cho hai loại tuyến trên

Hai nửa của đánh dấu tương ứng với hình thái đầu vào cần thiết cho hai loại tuyến trên, **do đó bắt buộc phải viết cả hai đoạn**:



| Loại tuyến trên | Hình thái đầu vào hợp lệ | Lấy nửa nào của đánh dấu |
| --- | --- | --- |
| NAI chính thức / Gateway NAI (Model khuếch tán - Diffusion) | Thẻ Danbooru | Đoạn thẻ phía sau `\|` |
| V.Adapter và các service chuyển đổi khác (Tuyến trên định dạng OpenAI, bao gồm model chat) | Ngôn ngữ tự nhiên | Đoạn mô tả phía trước `\|` |

Cài đặt "Nội dung gửi cho tuyến trên" sẽ quyết định thực tế gửi đi phần nào:



| Giá trị | Nội dung gửi đi | Ngữ cảnh áp dụng |
| --- | --- | --- |
| `auto` (**Mặc định**) | Địa chỉ là `127.0.0.1` / `localhost` / có chứa `:8888` (Tức là forward qua V.Adapter) -> Gửi mô tả; Các địa chỉ còn lại -> Gửi thẻ | Cách dùng thông thường bao phủ cả hai luồng |
| `description` | Luôn luôn gửi đoạn mô tả | Đi qua V.Adapter tới tuyến trên định dạng OpenAI |
| `tags` | Luôn luôn gửi đoạn thẻ | Kết nối trực tiếp NAI chính thức / Gateway NAI |
| `both` | Đoạn mô tả và đoạn thẻ được gộp lại theo thứ tự "Mô tả, Thẻ" rồi gửi đi | Lựa chọn an toàn khi không chắc chắn loại tuyến trên |

Khi bất kỳ tùy chọn nào bị thiếu phần tương ứng, nó sẽ tự động lùi về phần còn lại, sẽ không gửi chuỗi rỗng.

> Giải thích: Đoạn mô tả và đoạn thẻ do AI sinh ra cùng một lúc trong quá trình viết thân bài,
> **không phát sinh thêm lần gọi model hay thời gian chờ nào**
> .
> Việc phân luồng theo chuỗi chỉ là lấy các phần khác nhau từ đánh dấu, chi phí lúc chạy (runtime overhead) chỉ là một lần lựa chọn chuỗi (string selection).

### 5.3 Khi thân bài không có đánh dấu thì bổ sung ảnh thế nào (Không phụ thuộc model cốt truyện phối hợp, **mặc định bật**)

Tiền đề của việc điều khiển bằng đánh dấu là **model cốt truyện chịu viết đánh dấu**. Một số thẻ nhân vật (đặc biệt là các "Thẻ Sandbox" nhồi nhét cả bộ template đầu ra vào Worldbook)

sẽ dùng một lượng lớn ràng buộc định dạng cứng để chiếm trọn đầu ra, model chỉ tuân theo bộ template của riêng nó, các quy tắc tiêm từ bên ngoài đều không làm theo -

Biểu hiện là **cốt truyện vẫn tiến triển bình thường, nhưng không viết một cái đánh dấu nào**, plugin hoàn toàn nằm im.

Tính năng bổ sung ảnh sinh ra chính là để đối phó với con đường này: Không trông cậy vào sự phối hợp của model cốt truyện, plugin tự mình đem thân bài gửi đi vẽ.

**Nó được bật mặc định - Cài xong là dùng được, không cần bất kỳ cấu hình nào.**

Có hai cách bổ sung ảnh, có thể chuyển đổi trong "Xuất ảnh theo context -> Cách bổ sung ảnh" trên bảng điều khiển. **Cả hai cách luôn tồn tại, có thể chuyển đổi bất cứ lúc nào.**

| Cách | Chuỗi xử lý | Cái gửi đi là gì | Khi nào dùng |
| --- | --- | --- | --- |
| **Xuất trực tiếp thân bài nguyên trạng** (Mặc định) | Văn -> Ảnh | Đúng nguyên văn thân bài của nhân vật vừa mới sinh ra này | Khi tuyến trên hiểu được ngôn ngữ tự nhiên (V.Adapter -> Model chat vẽ ảnh / API tạo ảnh tương thích OpenAI). Zero config, nhanh nhất |
| **Model phân tích chuyển thành prompt** | Văn -> Văn -> Ảnh | Prompt do model phân tích viết ra sau khi đọc thân bài | **Bắt buộc phải chọn khi kết nối trực tiếp NAI chính thức / Gateway NAI**; Cần dùng khi muốn phân cảnh, chèn ảnh cố định hoặc một câu trả lời xuất nhiều ảnh. Mặc định dùng API chính của SillyTavern, zero config |

**Xuất trực tiếp thân bài nguyên trạng (Mặc định)** chính là Text-to-Image theo đúng nghĩa đen: Lấy phần thân bài mới nhất của nhân vật -> Ghép với phong cách vẽ và prompt chất lượng tích cực đã điền ở trang "Prompt" (Có thể để trống) ->

Gửi cho tuyến trên xuất ảnh, ở giữa không đi qua bất kỳ bước viết lại nào của model văn bản.

| Mục | Mô tả |
| --- | --- |
| Cái gửi đi là gì | **Chỉ có thân bài của câu trả lời nhân vật mới nhất đó**. Những cuộc hội thoại trước đó, những tin nhắn bạn gửi hoàn toàn không mang theo - Nhồi nhét cả một đoạn văn dài kèm hội thoại vừa tốn token, vừa khiến model không biết phải vẽ cảnh nào. (Tên thẻ nhân vật sẽ được mang theo như "Thông tin tác phẩm", nó là siêu dữ liệu (metadata) nằm ngoài cuộc hội thoại, là cơ sở chính để giữ phong cách vẽ nhất quán) |
| Chỉ thị vẽ | Trước thân bài luôn được ghép cứng một đoạn **chỉ thị tích hợp sẵn**: Chỉ vẽ khoảnh khắc mang đậm tính hình ảnh nhất, nhân vật phục dựng theo thân bài, không nhồi nhét nhiều thời điểm vào một bức tranh, không vẽ hội thoại thành chữ trên hình. **Nó thay thế cho những việc mà model phân tích vốn dĩ làm tiện thể** - Một đoạn thân bài dài chứa hội thoại mà không có chỉ thị này rất dễ vẽ ra một đống chắp vá quái dị, do đó không cung cấp tùy chọn tắt. Muốn cố định thêm bố cục / góc máy / tông màu, hãy điền vào "Chỉ thị vẽ · Bổ sung" |
| Cần cấu hình gì | **Mặc định không cần cấu hình gì cả**: Khung hình thông thường không gọi model phân tích, nên nguồn, địa chỉ, key, tên model của model phân tích hoàn toàn không tham gia vào chế độ xuất trực tiếp (Bảng điều khiển sẽ thu gọn thẻ đó lại, chuyển sang chế độ phân tích sẽ khôi phục lại). **Ngoại lệ duy nhất là khi hit "Kênh phân luồng"** - Xem bên dưới |
| Số lượng ảnh | Có thể xuất nhiều ảnh dựa theo "Giới hạn mỗi lượt". Cách implement xuất nhiều ảnh là **mở nhiều cửa sổ**: Cắt thân bài thành nhiều phần theo đoạn, ảnh thứ 1 vẽ đoạn đầu, ảnh thứ 2 vẽ đoạn giữa... Mỗi ảnh gửi độc lập lên tuyến trên một lần, nội dung tự nhiên sẽ khác nhau, chứ không phải lấy một đoạn thân bài vẽ N lần (Nếu chỉ có một đoạn thân bài thì đương nhiên chỉ xuất một ảnh) |
| Vị trí chèn | Khi xuất ảnh đơn lẻ sẽ dùng thuật toán heuristic không chi phí (zero-cost) để chọn vị trí chèn (Đoạn tường thuật hợp lệ dài nhất sau khi bỏ đi đối thoại, nếu không chọn được thì treo ở cuối bài); Khi xuất nhiều ảnh thì mỗi ảnh sẽ được chèn vào dưới đoạn văn tương ứng của nó. Cách này chọn vị trí không chuẩn bằng chế độ phân tích - Ở bên kia, "Vẽ cái gì" và "Chèn ở đâu" được cùng một model quyết định ngay trong một lần |
| Chuỗi họa sĩ | Tự động nhường chỗ (Cái gửi đi là ngôn ngữ tự nhiên, tên họa sĩ tiếng Anh bị trộn vào văn xuôi chỉ làm ô nhiễm mô tả) |
| Từ phá giới hạn | "Từ phá giới hạn · Tuyến trên xuất ảnh" vẫn được ghép vào đầu như bình thường; "Từ phá giới hạn · Model phân tích" không được dùng trong chế độ xuất trực tiếp (Không có model phân tích để mà phá giới hạn) - **Ngoại trừ bức ảnh hit "Kênh phân luồng" tạm thời chuyển sang phân tích**, bức ảnh đó sẽ dùng đến model phân tích, do đó cũng sẽ mang theo "Từ phá giới hạn · Model phân tích" |
| Prompt tiêu cực | Được ghép thành <span class="mono">【Prompt tiêu cực】</span> đặt trước thân bài. Việc bảo model chat vẽ ảnh "Đừng xuất hiện X" **đôi khi sẽ có tác dụng phụ của prompt ngược**, nếu gặp phải thì cứ xóa trắng cột này đi là xong - Cột này mặc định để trống, điền hay không do bạn tự quyết định, plugin không làm thay bạn |
| Khi nào không xuất ảnh | Khi hình thái gửi đi bị đánh giá là "Chuỗi tag" sẽ tự động bỏ qua và hiển thị thông báo. **Lưu ý**: Việc đánh giá dựa vào địa chỉ xuất ảnh - `127.0.0.1` / `localhost` / có chứa `:8888` / Cài extension service chuyển đổi trên cùng trang, thì mới tính là "Ăn ngôn ngữ tự nhiên"; **Service chuyển đổi deploy từ xa (Tên miền hoặc IP từ xa) sẽ bị đánh giá nhầm thành tuyến trên dạng tag**. Gặp trường hợp đó không cần chuyển về chế độ phân tích, vào trang "Cài đặt" chọn "Loại tuyến trên" thành `adapter` là được (Xem chi tiết ở phần 5.4) |
| Khi hit kênh phân luồng | Xuất trực tiếp gửi đi ngôn ngữ tự nhiên, mà kênh phân luồng (NAI thật / Gateway) chỉ ăn tag - Đem văn xuôi làm tag đút cho nó chắc chắn không vẽ ra được gì. Do đó **khi thân bài hit điều kiện phân luồng, sẽ tạm thời gọi model phân tích** (Mặc định chính là API chính của SillyTavern) để dịch thân bài thành `desc + tags`, rồi mới đi qua kênh phân luồng để gửi tag. **Số lượng ảnh và kết hợp nội dung do chính cài đặt của kênh phân luồng quyết định** ("Mỗi lần phân luồng xuất mấy ảnh / Kết hợp nội dung / Vị trí của ảnh đời thường"), tách biệt với "Giới hạn mỗi lượt" của kênh chính: Nếu set 2 ảnh và chọn "Đời thường + NSFW" thì xuất một ảnh đời thường, một ảnh người lớn, nếu chọn "Tất cả đều là NSFW" thì mỗi ảnh đều vẽ người lớn. Model phân tích sẽ đọc toàn bộ thân bài, đánh giá ngữ nghĩa xem đâu mới thực sự là khoảnh khắc người lớn (Bất kể vị trí), chứ không phải chọn đoạn cứng nhắc theo từ khóa. Nếu muốn luồng này dùng một model giỏi viết tag hơn, hãy chọn "Tùy chỉnh một model" ở phần "Xuất ảnh theo context -> Model phân tích". **Xuất ảnh song song cũng có hiệu lực đối với kênh phân luồng** |

Dưới đây là chi tiết của cách thứ 2 (Model phân tích chuyển thành prompt) - Dùng khi kết nối trực tiếp NAI chính thức, hoặc khi cần phân cảnh và chèn ảnh cố định.



```
Câu trả lời của nhân vật đã tạo xong

\\\\\\\&#x20;  └─ Trong thân bài không có đánh dấu?

\\\\\\\&#x20;       └─ Có -> Giao cho "Model phân tích"

\\\\\\\&#x20;            └─ Mặc định chính là model bạn đang dùng trong SillyTavern; Cũng có thể cấu hình riêng một model tương thích OpenAI trong bảng điều khiển

\\\\\\\&#x20;                 └─ Nó đọc thân bài + phần trước đó, tạo ra một vài khung hình: desc (ngôn ngữ tự nhiên) + tags (Danbooru) + anchor (câu trích dẫn nguyên văn)

\\\\\\\&#x20;                 └─ Plugin chuyển kết quả thành đánh dấu \\\\\\\\\\\\\\\[ILLUST: desc | tags], chèn vào ngay dưới đoạn văn chứa anchor

\\\\\\\&#x20;                      └─ Sau đó tái sử dụng hoàn toàn luồng xử lý có sẵn: Xuất ảnh -> Thay thế tại chỗ -> Thân bài không lưu lại chữ
```

Điểm cốt lõi:



| Mục | Mô tả |
| --- | --- |
| Mối quan hệ với luồng đánh dấu | **Cùng tồn tại và không lặp lại**. Khi thân bài đã có đánh dấu thì đi theo luồng đánh dấu (Thời gian chờ thêm bằng 0); Không có đánh dấu mới gọi model phân tích |
| Model phân tích | **Mặc định theo API chính của SillyTavern**: Dùng trực tiếp model bạn đang dùng để chat - Không cần điền địa chỉ và key, request do SillyTavern forward, không có vấn đề cross-origin. Nếu muốn tách biệt khỏi model chính, có thể đổi sang chọn "Tùy chỉnh một model" trong bảng điều khiển |
| Dependency | **Không liên quan đến định dạng đầu ra của thẻ nhân vật**, do đó áp dụng được cho mọi loại thẻ; Mặc định không cần thêm bất kỳ service bên ngoài nào |
| Hình thái sản phẩm | Mỗi khung hình tạo ra đồng thời desc và tags, sau đó "Hình thái prompt" sẽ quyết định gửi nửa nào - Cả hai luồng qua V.Adapter và kết nối trực tiếp NAI chính thức / Gateway đều có thể sử dụng |
| Yêu cầu prompt | Prompt chất lượng tích cực, prompt tiêu cực và phong cách vẽ điền trong trang "Prompt" sẽ được gửi đi kèm theo mỗi request. Tích cực và phong cách vẽ là ràng buộc bắt buộc, tiêu cực là mục loại trừ; Từ ngữ và tag bên trong sẽ được model phân tích sử dụng trực tiếp, những chi tiết cần bổ sung sẽ do nó tự hoàn thiện |
| Đánh đổi (Trade-off) | Tốn thêm một lần gọi model + một lần xuất ảnh, mỗi câu trả lời tăng khoảng 10~30 giây (Phân tích) + mỗi ảnh 30~60 giây (Xuất ảnh) |
| Số lượng ảnh | Bị kiểm soát chung bởi **Giới hạn mỗi lượt** ở trang "Cài đặt", dùng chung mục cài đặt với luồng điều khiển bằng đánh dấu; Set là 2 thì tạo 2 ảnh, set 3 thì tạo 3 ảnh |
| Vị trí chèn | Được quyết định bởi `anchor` (câu trích dẫn nguyên văn) do model phân tích đưa ra, chèn ngay dưới đoạn văn chứa câu đó. Khi có nhiều ảnh, yêu cầu trích xuất lần lượt từ đoạn đầu, đoạn giữa và đoạn cuối của thân bài, không được tập trung tất cả ở phần mở đầu; Định vị câu trích dẫn có tính dung sai với sự khác biệt khoảng trắng, khung hình định vị thất bại sẽ bị lùi về cuối thân bài |
| Xác minh tại chỗ | Bảng điều khiển cung cấp nút "Phân tích và xuất ảnh", có thể chạy ngay lập tức cho câu trả lời cuối cùng của nhân vật hiện tại, không cần chờ đến lượt hội thoại tiếp theo |

**Thứ tự sắp xếp của nhiều ảnh minh họa**: Mặc định tạo tuần tự (Xong ảnh này mới request ảnh tiếp theo); Khi bật **Xuất ảnh song song** ở trang "Cài đặt"

sẽ đổi thành gửi đi cùng lúc. Ở cả hai chế độ, sau khi mỗi bức ảnh xuất thành công đều sẽ **ngay lập tức được chèn độc lập vào thân bài**, không cần đợi những bức khác -

Bức ảnh đầu tiên hoàn tất xuất ảnh sẽ xuất hiện ngay trong thân bài, không bị ảnh hưởng bởi số lượng ảnh còn lại. Những đánh dấu chưa xuất ảnh xong sẽ không lưu lại dưới dạng text trong thân bài.

**Request phân tích là một cửa sổ (window) dùng một lần**: Mỗi lần request là một bộ messages hai lượt (`system` + một tin `user`) hoàn toàn mới,

không mang theo các lượt lịch sử. Nội dung request bao gồm "3 cột điền ở trang Prompt + Tóm tắt phần trước + Thân bài lần này",

tóm tắt phần trước được lấy cố định từ một vài tin nhắn gần nhất, mỗi tin bị cắt ngắn đến một số chữ cố định - Lượng gửi đi ở lượt thứ 10 và lượt thứ 100 là như nhau,

sẽ không chậm đi khi cuộc hội thoại dài ra.

**Quy mô sản phẩm**: `desc` của mỗi khung hình là khoảng 500~600 chữ ngôn ngữ tự nhiên mạch lạc, `tags` là chuỗi thẻ Danbooru tiếng Anh dài khoảng 300~400 ký tự. Ngân sách đầu ra (output budget) của request sẽ tự động được phóng to theo số lượng khung hình, sẽ không bị cắt đứt ở khung hình thứ hai.

**Cấu hình mặc định**: Tính năng này mặc định được bật, model phân tích mặc định lấy API chính của SillyTavern, do đó **cài xong là dùng được**, không có trường nào cần phải điền.

Chỉ khi muốn đổi sang một model rẻ hơn / nhanh hơn để đọc thân bài, mới cần vào trang "Xuất ảnh theo context" đổi nguồn thành

"Tùy chỉnh một model", và điền địa chỉ API, Key và Tên model; Khi điền thiếu, plugin sẽ chỉ thông báo ở console chứ không gửi request.

**Hai điểm khác biệt về hành vi (Vui lòng lưu ý khi chọn model tùy chỉnh)**:

- Khi theo API chính, tham số tạo (nhiệt độ, penalty v.v.) kế thừa cài đặt hiện tại của API chính, plugin này chỉ nâng **ngân sách đầu ra** lên theo số lượng khung hình,
  tránh việc JSON của nhiều khung hình bị cắt đứt; Model tùy chỉnh thì cố định `temperature: 0.3`, không can thiệp các tham số khác.
- Khi theo API chính, request do SillyTavern phát ra, **chức năng "Dừng" của plugin này chỉ có thể dừng việc chờ đợi và hủy bỏ kết quả của lượt này**,
  request ở tầng dưới vẫn sẽ chạy xong (Nút dừng của chính SillyTavern mới ngắt được nó); Model tùy chỉnh chạy kết nối trực tiếp, có thể ngắt request thực sự.

### 5.4 Kết nối trực tiếp NAI và Qua service chuyển đổi: Hai luồng này rốt cuộc khác nhau chỗ nào

Phần này rất đáng để đọc hiểu trước - Nó quyết định rất nhiều cài đặt "**tại sao điền rồi mà không có tác dụng**".

| | Kết nối trực tiếp NAI chính thức / Gateway NAI | Qua V.Adapter (Tuyến trên định dạng OpenAI) |
| --- | --- | --- |
| Nội dung gửi đi | **Chuỗi thẻ (Tags)** (`prompt_format` đi qua `tags`) | **Mô tả ngôn ngữ tự nhiên** (Đi qua `description`) |
| Ảnh lấy từ đâu ra | Do **Model khuếch tán (Diffusion) thực sự vẽ ngay lúc đó**, lấy mẫu từng khung hình theo prompt của bạn | **Model tuyến trên tự mình vẽ xong, trả lại thành phẩm cho bạn** |
| Phong cách vẽ do ai quyết định | Prompt của bạn + Chuỗi họa sĩ | **Tuyến trên** - Plugin này không tham gia vào quá trình vẽ |
| Chuỗi họa sĩ / Thẻ họa sĩ | Có tác dụng | **Không áp dụng**, plugin sẽ tự động bỏ qua |

Mấu chốt nằm ở câu "**không phải vẽ ngay lúc đó**": Khi đi qua service chuyển đổi, quá trình vẽ diễn ra ở **phía model tuyến trên**, plugin này chỉ chịu trách nhiệm chuyển prompt qua, và đỡ lấy thành phẩm trả về. Do đó

- Những thứ mà chỉ model khuếch tán mới nhận diện được (Chuỗi họa sĩ, thẻ họa sĩ) ở trên luồng này **không có đối tượng tác dụng**;
- Khung hình và phong cách vẽ do **tuyến trên** quyết định, plugin này vừa không tham gia vừa không can thiệp.

Đây chính là ý đồ của việc `prompt_format` mặc định là `auto`: Dựa vào địa chỉ để tự động phán đoán nên gửi nửa nào, để cả hai luồng đều nhận được hình thái đầu vào phù hợp.

#### ⚠️ Nhưng "Phán đoán theo địa chỉ" không thể phân biệt được hai loại tuyến trên từ xa này

Địa chỉ có thể phân biệt "Máy cục bộ (Local)" và "Từ xa", nhưng không thể phân biệt được hai loại dưới đây - **Cả hai đều là tên miền từ xa, trông giống hệt nhau**:

| Tuyến trên của bạn | Địa chỉ trông như thế này | Nên gửi | `auto` sẽ phán đoán thành |
| --- | --- | --- | --- |
| **Service chuyển đổi deploy trên server** | `https://tên_miền_của_bạn` / `https://1.2.3.4:8888` | Mô tả ngôn ngữ tự nhiên | ❌ Chuỗi thẻ (Đánh giá nhầm) |
| **Gateway NAI bên thứ ba / Proxy** | `https://tên_miền_gateway_nào_đó` | Chuỗi thẻ | ✅ Chuỗi thẻ |

Hậu quả của việc đánh giá nhầm: **Xuất trực tiếp thân bài không ra ảnh**, chỉ hiện thông báo "Hình thái gửi đi là chuỗi thẻ"; Luồng đánh dấu cũng sẽ đút chuỗi thẻ cho tuyến trên đáng lẽ phải ăn mô tả.

Lúc này cần phải vào trang "Cài đặt", chọn thủ công **"Loại tuyến trên"** thành một mức:

| Giá trị | Ý nghĩa |
| --- | --- |
| `auto` (Mặc định) | Đoán theo địa chỉ: `127.0.0.1` / `localhost` / có chứa `:8888` / Cài extension service chuyển đổi trên cùng trang -> Coi là service chuyển đổi; Còn lại tính là NAI |
| `adapter` | **Service chuyển đổi** - V.Adapter, Model chat vẽ ảnh, API tạo ảnh tương thích OpenAI. **Service chuyển đổi deploy trên server bắt buộc phải chọn mức này** |
| `nai` | NAI chính thức / Gateway NAI / Proxy bên thứ ba - Đã train theo thẻ Danbooru |

Nó chỉ có tác dụng khi "Hình thái prompt" là `auto`; Khi hình thái được chỉ định thủ công, sẽ ưu tiên hình thái đó.

### 5.5 "Từ phá giới hạn" có thể phát huy tác dụng lớn đến đâu, phụ thuộc vào việc từ chối xảy ra ở tầng nào

Bản chất của cột này là một **Tiền tố prompt (Prompt prefix)**, không phải là chìa khóa vạn năng. Đừng hy vọng nó chắc chắn có thể giải quyết được kiểm duyệt - Việc nó có điểm tác dụng hay không, phụ thuộc vào việc **tuyến trên đặt "Từ chối" ở tầng nào**:

| Từ chối xảy ra ở tầng nào | Tiền tố prompt có tác dụng không | Điển hình |
| --- | --- | --- |
| **Bản thân model từ chối trả lời** (Dựa vào căn chỉnh chỉ thị - Instruction alignment) | **Có cơ hội**, nhưng không đảm bảo - Đây là trường hợp duy nhất mà cột này thực sự có điểm tác dụng | Model chat vẽ ảnh, model đa phương thức |
| **Bộ lọc của model khuếch tán** | Bản thân model sẽ không từ chối trả lời, cái có tác dụng là bộ lọc ở server / cạnh sampler. Dùng lời lẽ vòng vo đôi khi có tác dụng; Nhưng nếu nó filter theo danh sách thẻ, thì nó đang nhìn vào thẻ của bạn chứ không phải tiền tố, lúc này có dùng lời lẽ thế nào cũng vô dụng | Kết nối trực tiếp NAI chính thức, SD / ComfyUI local |
| **Lọc cứng cấp nền tảng (Hard filter)** | **Cơ bản là vô dụng** - Request bị chặn lại ngay từ server, chưa đến lượt model, prompt viết thế nào cũng không được thông qua | Policy nội dung đi kèm API hình ảnh, phân loại an toàn lần thứ hai trên kết quả ảnh |

Bổ sung hai điểm:

- ComfyUI / SD local thường **vốn dĩ không có kiểm duyệt**, điền vào sẽ không có hại, nhưng cũng không có ý nghĩa gì;
- Thử đi thử lại nhiều lần có thể kích hoạt hệ thống kiểm soát rủi ro của tuyến trên, **việc tuân thủ quy định và rủi ro tài khoản do người dùng tự chịu**.

**Vậy tại sao kết nối trực tiếp NAI chính thức lại "không cần" cột này?** Vì **model khuếch tán không có khâu "Từ chối trả lời"** - Nó không hiểu ngôn ngữ, chỉ lấy mẫu ra ảnh theo prompt của bạn, hoàn toàn không tồn tại phán đoán "Tôi không vẽ cái này" để mà bị lay động; Bản thân subscription trả phí chính thức cũng cho phép nội dung người lớn. Vì vậy khi kết nối trực tiếp NAI, cột này cơ bản là dư thừa: Nếu rủi ro thật sự bị chặn, thì đó là do **bộ lọc hoặc trạm trung chuyển (proxy)** làm, giải pháp là sửa từ ngữ hoặc đổi đường truyền, chứ không phải là "Phá giới hạn".

## VI. Xử lý phản hồi (Ưu tiên ảnh xuất trực tiếp, không giải nén)

Service chuyển đổi trả về cái gì, plugin sẽ xử lý theo cái đó, **ưu tiên đi luồng không cần giải nén**:



| Phản hồi | Xử lý |
| --- | --- |
| **Luồng byte ảnh nhị phân** (`Content-Type: image/*`) | **Trực tiếp lấy byte để sử dụng**, không giải nén. Request của plugin mang theo `Accept: image/*`, đi qua V.Adapter sẽ đi luồng này |
| Byte ảnh trần (Content-Type không chính xác) | Nhận dạng theo file magic number, cũng không giải nén |
| ZIP | Nhánh tương thích: Sử dụng `/lib/jszip.min.js` đi kèm của SillyTavern để giải nén ảnh đầu tiên. **NAI chính thức và các service NAI khác chỉ trả về định dạng này**, giữ lại nhánh này mới có thể dùng chung |
| JSON | Lấy `message` ném ra làm lỗi; Cũng nhận diện phòng thủ `b64_json` |

> Tại sao giữ lại nhánh ZIP: ZIP là
> **định dạng phản hồi của giao thức NovelAI**
> , không phải là lớp bọc do plugin này thêm vào.
> Nếu xóa nhánh này, plugin sẽ chỉ có thể dùng chung với service chuyển đổi của riêng nó.
> Luồng thông thường (Qua V.Adapter) sẽ không vào bước giải nén.
> Tại sao URL cuối cùng không dùng
> `URL.createObjectURL(blob)`
> : object URL là
> địa chỉ **tạm thời**
> ,
> refresh trang là hết hạn, mà hình minh họa thì phải ghi vào lịch sử trò chuyện, refresh xong vẫn phải còn (Nghiệm thu điều 10).
> Do đó sau khi lấy được byte, sẽ được thống nhất lưu qua
> `saveBase64AsFile()`
> vào thư mục ảnh của SillyTavern (ví dụ
> `/user/images/<Tên_nhân_vật>/xxx.png`
> ),
> tin nhắn sẽ lưu URL ổn định này - Đây là tiền đề để việc "Chèn tại chỗ" có thể tồn tại lâu dài.

### 6.1 Tham số extension không chuẩn (Non-standard)

Quy trình tự động minh họa chỉ sử dụng giao thức NovelAI chuẩn, không đính kèm bất kỳ tham số không chuẩn nào. Có hai ngoại lệ sau, đều được truyền qua chuỗi truy vấn (query string),

**chỉ những service nhận được chúng mới phản hồi, các service NAI khác sẽ trực tiếp phớt lờ**:



| Tham số | Người dùng | Ý nghĩa |
| --- | --- | --- |
| `expand=1` | Trang "Dịch nhân vật" của plugin này | Yêu cầu tuyến trên trước tiên mở rộng `input` thành prompt hình ảnh hoàn chỉnh rồi mới xuất ảnh. Chỉ V.Adapter implement; Việc mở rộng do model chat của tuyến trên hoàn thành, plugin này không nắm giữ thông tin xác thực của model chat |

Các HTTP header phản hồi đi kèm (Do V.Adapter trả về, các service khác không cung cấp):



| Header phản hồi | Ý nghĩa |
| --- | --- |
| `X-Illust-Via` | Luồng xuất ảnh thực tế có hiệu lực (API tiêu chuẩn / Dự phòng chat) |
| `X-Illust-Prompt` | Prompt thực tế được gửi lên tuyến trên (URL Encode), dùng để đối chiếu kết quả mở rộng trong bảng điều khiển |
| `X-Illust-Expand` | Trạng thái mở rộng: `ok` / `fallback` (Thất bại và lùi về việc gửi nguyên trạng) |

Mở rộng thất bại sẽ không làm gián đoạn việc xuất ảnh - Tuyến trên sẽ lùi về gửi nguyên trạng input, và để lại một mục `expand` trong lịch sử tạo.



***

## VII. Placeholder trong quá trình vẽ

Sau khi phát hiện tag, plugin sẽ hiển thị "Đang vẽ hình minh họa ... khoảng 30~60 giây" ở **vị trí tag gốc trong thân bài**,

sau khi xuất ảnh xong, toàn bộ tin nhắn sẽ được render lại, placeholder tự động được thay thế bằng hình ảnh thật.

⚠️ Placeholder này **chỉ sửa đổi DOM, tuyệt đối không ghi vào lịch sử trò chuyện**. Nếu ghi vào `mes`, một khi tạo ảnh thất bại hoặc người dùng refresh,

text "Đang vẽ..." sẽ lưu lại vĩnh viễn trong lịch sử, và không có cơ chế nào để thay thế nó.

### 7.1 Thẻ tiến trình nổi (Floating Progress Card)

Ngoài placeholder nội tuyến, plugin còn hiển thị một **Thẻ tiến trình nổi** ở đầu trang, thường trú trong quá trình phân tích / vẽ,

hiển thị giai đoạn hiện tại và kèm theo nút \*\* "Dừng" \*\*:



```
┌──────────────────────────────────────────────┐

│ \\\\\\\\\\\\\\\[Vi]  V.Canvas                               │

│       Đang phân tích thân bài... (Khoảng 10\\\\\\\\\\\\\\\~30 giây)      \\\\\\\\\\\\\\\[Dừng] │

└──────────────────────────────────────────────┘
```



* Các giai đoạn lần lượt là: `Đang phân tích thân bài...` -> `Đang vẽ hình minh họa n/N ...` -> `Hình minh họa hoàn tất` / `Nguyên nhân thất bại`

* Bấm "Dừng" sẽ ngắt đứt lượt hiện tại (Cả request phân tích và xuất ảnh đều bị hủy), thẻ lập tức hiển thị "Đã dừng"

* **Thất bại và "Kết quả phân tích trống" cũng sẽ hiển thị trên thẻ**, sẽ không im lặng - Đây là lối vào chính để troubleshoot việc "Chả có gì xảy ra cả"

* Thông báo kết thúc lưu lại vài giây rồi tự động biến mất, thông báo thất bại lưu lại lâu hơn; cũng có thể bấm "Đóng" thủ công

* Thẻ chỉ tồn tại trong DOM, không ghi vào lịch sử trò chuyện, cũng không đi vào context



***

## VIII. Xem prompt của hình minh họa

Prompt dùng cho hình minh họa **không xuất hiện trong thân bài, cũng không đi vào context AI** (`strip_marker` mặc định bật,

đánh dấu sau khi xuất ảnh sẽ bị loại bỏ khỏi `mes`). Khi cần xem, **hãy click vào hình minh họa đó**, trong popup sẽ hiển thị

hai đoạn nội dung là mô tả ngôn ngữ tự nhiên và thẻ Danbooru tương ứng với hình minh họa này.



* Prompt được lưu cùng với lịch sử trò chuyện (`extra.illust.src` là văn bản gốc đầy đủ có chứa đánh dấu), do đó refresh, chuyển đổi trò chuyện vẫn có thể xem được;

* Đánh dấu tương ứng 1-1 với hình minh họa theo thứ tự xuất hiện, popup định vị dựa vào đó, không cần lưu trữ thêm;

* Popup là DOM tạm thời của riêng plugin, đóng là bị hủy, không ghi vào lịch sử trò chuyện;

* Dùng thao tác click để trigger thay vì hover (Mobile không có hover), cũng không sử dụng thuộc tính `title`.

Hiệu suất: Lắng nghe sự kiện click được mount một lần duy nhất lúc load trang bằng cách **Event Delegation**, không bind riêng cho từng hình minh họa;

Prompt chỉ được parse khi click, giai đoạn render không có chi phí bổ sung, cũng không phát sinh bất kỳ lời gọi model hay request mạng nào.



***

## IX. Chi tiết hành vi



* **Chiếm trọn một dòng (Block-level)**: Hình ảnh là phần tử cấp khối (block-level element), đẩy chữ viết tiếp theo xuống dòng dưới, không trôi nổi (float), không bọc quanh (wrap).

* **Chèn tại chỗ**: Hình ảnh được chèn ngay dưới đoạn văn chứa đánh dấu, chứ không phải ở cuối toàn bộ tin nhắn.

* **Tuần tự chạy ngầm**: Việc xuất ảnh diễn ra lần lượt dưới nền, không khóa ô nhập liệu, người dùng có thể tiếp tục trò chuyện.

  Nhiều ảnh chạy tuần tự là do thiết kế có chủ ý - Chạy đồng thời (Concurrency) rất dễ kích hoạt hệ thống kiểm soát rủi ro của tuyến trên.

* **Chống trùng lặp**: Tin nhắn đã xử lý được đánh dấu `extra.illust_done`, chuyển đổi trò chuyện / refresh / re-render đều không trigger xuất ảnh trùng lặp.

* **Thất bại có thể kiểm soát**: Khi một ảnh nào đó thất bại, đánh dấu của nó được giữ nguyên trạng, ảnh đã xuất không bị vẽ lại; Thông báo lỗi truyền qua trực tiếp message do service chuyển đổi trả về (message này đã là text dễ đọc: kiểm soát rủi ro / policy nội dung / timeout v.v...).

* **Không làm bẩn lịch sử trò chuyện**: Thông báo placeholder chỉ sửa đổi DOM; Thất bại cũng không để lại tàn dư "Đang vẽ..." trong lịch sử trò chuyện.



***

## X. Hạn chế đã biết



* `.mes_text img { display: block }` là style global,

  nó sẽ ảnh hưởng luôn đến layout của các ảnh markdown khác trong tin nhắn (Tất cả đều biến thành căn giữa cấp khối), đây là hành vi như dự kiến.

* Nếu chỉnh sửa thân bài tin nhắn thủ công làm thay đổi số lượng đánh dấu, plugin sẽ xóa trạng thái hình minh họa của tin nhắn đó (Không vẽ lại, để tránh vô tình trigger xuất ảnh làm tốn quota).

* Phiên bản đầu tiên chưa cung cấp nút "Vẽ lại thủ công".



***

## XI. Lập trình viên: Tự test offline

Trong `test/` có chứa một mục tự test offline không phụ thuộc vào SillyTavern: Khởi động một service NAI giả lập ở local, chạy thông

toàn bộ luồng "Giao thức NAI -> ZIP -> base64" cũng như tất cả các nhánh phân tích đánh dấu / thay thế tại chỗ.



```
python test/make\\\\\\\\\\\\\\\_fixtures.py     # Tạo PNG / ZIP dùng để test

node test/test.mjs               # 57 assertion (Phân tích đánh dấu / Phân luồng hình thái prompt / Thay thế tại chỗ / Toàn bộ luồng giao thức NAI)

node test/contract.mjs           # Tính nhất quán giữa action trên bảng điều khiển và action qua bridge + Kiểm tra bao phủ các trường cài đặt
```

`test/contract.mjs` lấy `defaultSettings` của `lib/settings.js` làm nguồn danh sách trường,

để verify xem mỗi mục cài đặt có control tương ứng trong `panel.html` hay không - **Sau khi thêm mục cài đặt mới, bắt buộc phải update bảng điều khiển đồng bộ**, nếu không bài check này sẽ báo thiếu mục.



***

## XII. Giấy phép

Phát hành dưới **Giấy phép MIT + Điều khoản bổ sung phi thương mại** (Xem `LICENSE`), tác giả VILK.



* Cấm thương mại hóa: Khi chưa có sự cho phép bằng văn bản của tác giả, không được phép bán, cho thuê, tích hợp vào các sản phẩm hoặc dịch vụ thương mại, cũng không được trục lợi trực tiếp hoặc gián tiếp dưới bất kỳ hình thức nào như quảng cáo, nhận donate, thu phí triển khai, dựng thuê;

* Cho phép sử dụng cá nhân, học tập nghiên cứu, sao chép, chỉnh sửa (sáng tác phái sinh) và phân phối lại với mục đích phi thương mại;

* Khi sáng tác phái sinh và phân phối lại \*\* Bắt buộc phải giữ lại chữ ký của tác giả gốc (VILK)\*\* và tuyên bố cấp phép này;

* **Chỉ dành cho mục đích học tập và nghiên cứu**, vui lòng tuân thủ điều khoản dịch vụ của tuyến trên, người dùng tự chịu rủi ro;

* Phần mềm này được cung cấp theo nguyên trạng "như hiện có", không đi kèm bất kỳ bảo đảm rõ ràng hay ngụ ý nào, tác giả không chịu trách nhiệm cho bất kỳ hậu quả nào phát sinh từ việc sử dụng chương trình này.