# Comic Lens v2 — Dịch truyện và hiểu cách dịch

Extension cá nhân cho Brave máy tính: khoanh vùng ảnh truyện, dịch bằng Gemini, tách cụm và giải thích cấu trúc. Mỗi vùng có một thẻ riêng bên cạnh ảnh. Bản dịch được lưu trên máy để cuộn lên đọc lại hoặc khôi phục sau khi mở lại Brave.

Phiên bản **0.3.0** bổ sung phương pháp **OCR cục bộ — chỉ trích xuất chữ** để dùng cùng extension dịch khi bôi chọn văn bản.

Phiên bản **0.4.0** thêm **Windows OCR — nhận chữ bằng Windows**. Cần cài chương trình cầu nối một lần; sau đó khoanh vùng và nhận chữ tự động, không mở Snipping Tool hoặc sao chép thủ công. Xem [hướng dẫn cài Windows OCR](docs/WINDOWS_OCR.md). Bộ cài cầu nối là ZIP riêng trong `.output`, không nằm trong ZIP extension.

Phiên bản **0.4.1** sửa chế độ Gemini **Dịch nhanh**: prompt riêng chỉ yêu cầu bản dịch, dùng mức suy luận thấp nhất đã biết được model hỗ trợ (`low` hoặc `minimal`). Không bật suy luận cho Gemini 2.5 Flash-Lite vốn mặc định tắt; model lạ giữ mặc định để tránh gửi tham số không hỗ trợ. Giữ cấu hình suy luận hiện có cho **Dịch và hiểu**. Bộ đọc kết quả chấp nhận JSON hoàn chỉnh được bọc trong Markdown và mặc định cảnh báo rỗng nếu model bỏ trường này; vẫn từ chối JSON hỏng/cắt dở. Không tự gọi lại, không đổi model và không đặt giới hạn token đầu ra thấp dễ làm cụt JSON. Tốc độ thực tế còn phụ thuộc model và dịch vụ; kiểm thử tự động dùng phản hồi giả lập, không đo thời gian bằng key thật. Cấu hình mức suy luận theo [tài liệu Interactions API của Gemini](https://ai.google.dev/gemini-api/docs/thinking).

## Chỉ lấy chữ bằng OCR cục bộ

Phiên bản **0.4.2** cho chọn **Model Gemini** ngay trong popup khi chọn phương pháp Gemini. Đổi model tự lưu, không gọi API; áp dụng cho lượt dịch tiếp theo và được giữ khi mở lại popup. Các phương pháp OCR ẩn mục này. Danh sách model dùng chung với trang cài đặt; quota thực tế xem trong AI Studio.

1. Reload Comic Lens tại `brave://extensions`, rồi tải lại trang truyện nếu vừa cập nhật.
2. Trong popup, chọn **OCR cục bộ — chỉ trích xuất chữ** → **Khoanh vùng lấy chữ** (hoặc **Lấy chữ khung nhìn**).
3. Kéo chọn câu/bong bóng tiếng Anh. Chữ nhận được hiện trong thẻ cạnh ảnh bằng font thường, nối các ngắt dòng và khoảng trắng thừa thành văn bản liền mạch; không có bản dịch hay phần học. OCR giới hạn bảng chữ cái tiếng Anh, chữ số và dấu câu cơ bản (`. , ! ? ' " - ( )`); loại ký tự lạ như `= | _ : ; @`. Văn bản chuyển sang chữ thường, viết hoa và in đậm chữ cái đầu câu (đầu đoạn hoặc sau `. ! ?`); đại từ `I` và dạng rút gọn như `I've` giữ viết hoa. Các tên riêng có thể thành chữ thường theo chế độ này. Cả bôi chọn và nút sao chép đều dùng văn bản đã chuẩn hóa, kể cả với bản OCR cũ. Bộ lọc ký tự không tự sửa từ đọc nhầm hoặc đoán thêm dấu chấm bị thiếu.
4. **Bôi chọn từ hoặc cụm trong thẻ** để dùng extension dịch hiện tại của bạn. Có nút **Sao chép văn bản**, **Nhận chữ lại**, ẩn và xóa.

OCR hiện hỗ trợ **tiếng Anh**. Bộ nhận chữ Tesseract.js, WebAssembly và dữ liệu tiếng Anh được đóng gói sẵn; không cần API key, không gửi ảnh ra ngoài và chạy được khi mất mạng. Bản build lớn hơn khoảng 15 MB vì có bộ OCR. Lần nhận đầu có thể chậm hơn do khởi tạo; font cách điệu, nền phức tạp và chữ mờ vẫn có thể nhận sai. Ưu tiên khoanh sát câu cần đọc.

Văn bản OCR nằm trong DOM thường, hiển thị qua slot trong thẻ, để `document.getSelection()` đọc được. Chưa thể bảo đảm mọi extension dịch đều tương thích; nếu extension kia không bật popup, hãy dùng nút sao chép. Văn bản được lưu lâu dài cùng vùng ảnh, không giới hạn số thẻ hay tự dọn theo dung lượng. **Nhận chữ lại** luôn giữ phương pháp OCR cục bộ, kể cả khi cài đặt hiện tại đã chuyển sang Gemini.

Có thể chọn OCR và **Lưu cài đặt** để phím tắt dùng OCR mặc định. Mục **Kiểm tra OCR cục bộ** chỉ nạp bộ nhận chữ trên máy, không sử dụng API. Các cài đặt và API key Gemini vẫn được giữ khi đổi phương pháp.

## Cài bản build

1. Mở `brave://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**.
2. Chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục **`.output/chrome-mv3`** chứa `manifest.json`.
3. Ghim Comic Lens lên thanh công cụ, mở **Cài đặt**.
4. Tạo key tại [Google AI Studio](https://aistudio.google.com/apikey), nhập key và chọn model có quyền/quota trong project của bạn.
5. Bấm **Lưu cài đặt**. Nút **Kiểm tra kết nối** dùng một lượt API thật, chỉ chạy khi bạn bấm.

Nếu đã cài bản cũ: bấm **Reload** Comic Lens trong `brave://extensions`, đóng trang cài đặt cũ và tải lại trang truyện. Key, model và ngôn ngữ đã lưu được giữ; cache ảnh cũ được bỏ vì không có vị trí để gắn vào trang. Chế độ mới mặc định **Dịch và hiểu**.

Xem quota của đúng project/model tại [AI Studio Rate limits](https://aistudio.google.com/rate-limit). Quota Antigravity không áp dụng cho Gemini trực tiếp. Project Paid/Prepay có số dư 0 có thể trả HTTP 402; đổi model không khắc phục số dư thanh toán. Extension không tự bật billing hoặc chuyển model. Nếu muốn dùng miễn phí, xác nhận project thực sự là Free.

## Đọc truyện và học

- Mở trang truyện http/https, bấm biểu tượng Comic Lens hoặc **Ctrl+Shift+Y**. Đổi phím tắt tại `brave://extensions/shortcuts` nếu bị trùng.
- **Khoanh vùng để dịch**: chọn vài bong bóng hoặc một phần khung truyện. **Dịch khung nhìn**: gửi phần trang đang thấy, không tự cuộn cả chương.
- Dropdown **Chế độ dịch** có **Dịch và hiểu** và **Dịch nhanh**. Dịch và hiểu tạo cả bản dịch, tách cụm, tối đa hai cấu trúc chính cùng ví dụ trong một lượt API. Phần giải thích bằng tiếng Việt.
- Bấm cụm từ trong **Tách cụm** để làm nổi cụm tương ứng ở câu gốc. Mở **Cấu trúc và ví dụ** không gọi API thêm.
- Mỗi vùng có thẻ và dấu số riêng. Dịch vùng mới không xóa thẻ cũ. Thẻ mặc định nằm cao hơn đầu vùng chụp 180 px, giới hạn trong trang và tránh chồng lên thẻ khác; dấu số vẫn ở vùng ảnh. Thẻ cuộn cùng ảnh và cập nhật vị trí khi ảnh đổi kích thước hoặc tải thêm nội dung phía trên.
- Khi có đủ khoảng trống, thẻ nằm bên phải ảnh. Khi thiếu chỗ, thẻ nằm đè trong trang và có thể kéo, dùng phím mũi tên trên thanh tiêu đề, đổi cỡ, thu gọn hoặc **Ẩn**.
- **Ẩn** giữ dữ liệu; bấm dấu số tại vùng ảnh để mở lại. **Xóa bản dịch** xóa hẳn mục đó.
- Chọn lại một vùng gần vùng đã lưu sẽ hiện **Xem bản đã lưu** hoặc **Dịch mới**. Extension không tự suy đoán hai ảnh chụp là giống nhau rồi bỏ qua yêu cầu.
- **Dịch lại** chụp lại vùng đã lưu với cài đặt hiện tại. Nếu vùng không còn tìm được hoặc không vừa khung nhìn, extension yêu cầu khoanh lại. Bản cũ chỉ được thay khi có kết quả dịch mới hợp lệ.
- `Esc`, cuộn hoặc đổi kích thước trong lúc chọn/chụp sẽ hủy thao tác. Đổi tab khi đang xử lý cũng hủy lượt hiện tại. Hủy không bảo đảm nhà cung cấp chưa tính lượt đã gửi.

Chữ mờ, chữ cách điệu và ngữ cảnh thiếu vẫn có thể khiến AI đọc/dịch/phân tích sai. Cụm được đối chiếu với câu gốc; khi phần học không hợp lệ, bản dịch vẫn được giữ và có thông báo phần giải thích chưa sẵn sàng.

## Khôi phục khi mở lại

Bấm biểu tượng extension trên trang truyện để khôi phục, hoặc bấm **Hiện bản dịch đã lưu** trong popup. Khôi phục không gọi Gemini và không cần key để đọc dữ liệu cũ.

Extension nhận diện ảnh theo nguồn ảnh, kích thước gốc, thứ tự xuất hiện của ảnh cùng nguồn và vùng chọn theo tỷ lệ. URL trang và query được giữ nguyên để tránh gắn nhầm chương. Các thẻ khớp sẽ về vị trí cũ, kể cả khi ảnh tải chậm rồi mới xuất hiện.

Với canvas, vùng chứa nhiều ảnh, ảnh xoay/nghiêng hoặc trang đã đổi nguồn ảnh, việc gắn vị trí có thể không chắc chắn. Kết quả vẫn nằm trong **Bản dịch chưa gắn ảnh** ở bảng Comic Lens góc dưới:

- **Xem bản đã lưu**: mở hộp nổi để đọc ngay.
- **Gắn lại**: khoanh vùng cần liên kết; cập nhật vị trí, không gọi API.
- **Xóa**: bỏ mục đã lưu.

Popup và cài đặt chỉ chạy khi bạn thao tác; extension không tự chạy trên mọi website. Vì vậy, sau khi mở trang mới, cần kích hoạt extension để hiện dữ liệu. Không hỗ trợ trang `brave://`, Chrome Web Store hoặc trang cấm chèn extension. Bản này không thay chữ gốc trong bong bóng, không tự dịch toàn chương và không có flashcard.

## Tìm trong lịch sử

Bản **0.5.0** thêm nút **Tìm trong lịch sử** trong popup và liên kết ở cài đặt. Nhập từ/cụm như `got a shot` để tìm trong câu gốc, bản dịch, tách cụm, cấu trúc, ví dụ và ghi chú của mọi trang đã lưu. Không phân biệt hoa/thường, chuẩn hóa khoảng trắng và dấu nháy cong; cụm khớp đầy đủ được ưu tiên, nếu không sẽ tìm các từ trong cùng câu/phần học. Kết quả được đánh dấu và phân trang.

Bấm **Xem giải thích đã lưu** để đọc lại phân tích, hoặc **Mở trang gốc** để xem truyện. Tất cả tìm kiếm và mở phần học xử lý trên máy, không gọi Gemini, không dùng quota. Bản OCR hoặc Dịch nhanh vẫn tìm được chữ nhưng không tự tạo phần học còn thiếu. Danh sách tự cập nhật khi bạn thêm/xóa dữ liệu; tìm kiếm bị hủy khi gõ từ mới để tránh hiện kết quả cũ.

## Lưu lâu dài và dọn dữ liệu

- Lưu văn bản gốc, bản dịch, phần học, URL/nguồn ảnh, vị trí tương đối, model/ngôn ngữ/chế độ và thời điểm trong `chrome.storage.local`.
- **Không lưu screenshot hoặc bản sao ảnh truyện.** Ảnh chỉ ở bộ nhớ trong lúc xử lý và được giải phóng sau lượt dịch/hủy.
- Dùng quyền **unlimitedStorage**, bỏ giới hạn 500 thẻ / 5 MB và không tự xóa bản cũ. Dung lượng còn phụ thuộc ổ đĩa. Lịch sử cũ và API key được giữ khi cập nhật; các mục đã bị dọn trước đây không thể khôi phục.
- Khi đọc truyện, chỉ tải dữ liệu trang đang mở và dựng thẻ gần khung nhìn. Tìm kiếm toàn bộ lịch sử đọc lần lượt theo lô và hiển thị 20 câu mỗi trang.
- Cài đặt hiển thị số thẻ và dung lượng. Có **Xóa dữ liệu trang đã chọn** và **Xóa toàn bộ dữ liệu đã lưu**. Bảng góc trang cũng có nút **Xóa dữ liệu trang**.
- Xóa dữ liệu liên quan sẽ hủy tác vụ đang chạy, ngăn kết quả đến muộn ghi trở lại. **Key và cài đặt được giữ nguyên.**
- Lưu lâu dài vẫn là lưu trên profile Brave hiện tại: không đồng bộ/không phải bản sao lưu; gỡ extension hoặc xóa profile sẽ mất dữ liệu. Xem [tài liệu lưu trữ Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage). Khi cập nhật, reload bản đang cài, không gỡ extension để cài lại.

## Key, quyền và dịch vụ

Quyền: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `offscreen`, `nativeMessaging` (để giao tiếp với cầu nối Windows OCR đã cài). Chỉ xin quyền mạng đến `https://generativelanguage.googleapis.com/*`. Content script chỉ được chèn khi bạn kích hoạt.

API key chỉ lưu trong phần storage dành cho ngữ cảnh extension tin cậy; không đồng bộ, không đưa vào content script hoặc log. Đây không phải kho mật khẩu mã hóa; người có quyền profile/DevTools vẫn có thể truy cập. Dữ liệu bản dịch được đưa vào trang để hiển thị nhưng key không được đưa vào.

Với Gemini, chỉ gửi ảnh vùng đã chọn; không gửi URL trang hay lịch sử đã lưu. Gemini dùng `store: false`, không nối lịch sử. Chính sách nhà cung cấp vẫn áp dụng; [gói Free có thể dùng nội dung để cải thiện sản phẩm](https://ai.google.dev/gemini-api/docs/pricing). Hai phương pháp OCR xử lý trên máy; Windows OCR chỉ chuyển ảnh đã cắt đến chương trình cầu nối qua Native Messaging.

Không tự retry, đổi model hoặc dịch vụ. Lỗi Gemini có mã HTTP và chi tiết đã che key. Không gửi key vào chat, mã nguồn hoặc ảnh chụp màn hình.

## Phát triển và kiểm thử

Yêu cầu Node.js 22.12+ và npm; người chỉ cài bản build không cần Node.js.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run zip
```

Build nằm ở `.output/chrome-mv3`, ZIP phiên bản 0.5.0 nằm trong `.output`. Build sẽ ghi đè thư mục này; sửa mã nguồn rồi build lại, reload extension và trang truyện. `npm run dev` dùng WXT. Không cần backend hoặc Python.

`npm ci` và các lệnh dev/build/zip tự chạy `scripts/ocr-assets.mjs` để chép worker, core LSTM và dữ liệu tiếng Anh từ dependency vào `public/ocr` (thư mục sinh tự động, không đưa vào Git). Không dùng worker/code CDN. CSP cho phép WebAssembly cục bộ, không thêm quyền website hoặc quyền mạng cho OCR. Xem giấy phép trong thư mục `ocr` của bản build.

Các phần chính: background xác thực và điều phối một tác vụ; offscreen cắt ảnh/gọi adapter với timeout 5 phút (áp dụng cả kiểm tra kết nối); content script dựng thẻ trong Shadow DOM; kho bản dịch có chỉ mục theo trang, không tự dọn và có cơ chế vô hiệu hóa kết quả đến muộn. Xem [hướng dẫn thêm adapter](docs/ADDING_METHOD.md).

Unit tests kiểm tra parser, HTTP errors, abort, vùng ảnh, phần học, vị trí cụm, lưu/xóa/tìm kiếm dữ liệu và registry. Playwright mở Brave headless với profile riêng dưới `.browser-test`; dùng ảnh truyện SVG/canvas tự tạo và Gemini giả lập để kiểm tra nhiều vùng, học, khôi phục, zoom, tải ảnh, hủy và xóa khi đang dịch, cùng khởi động lại Brave.

Bản copy E2E có thêm `<all_urls>` để mô phỏng quyền do bấm toolbar và mock fetch trong offscreen. **Build để bạn cài không có quyền/mã giả lập đó**; test kiểm tra manifest gốc riêng. Có thể đặt `BRAVE_PATH` nếu Brave cài ở vị trí khác. Chất lượng dịch/phân tích thực tế cần thử bằng key thật của bạn; kiểm thử tự động không dùng key thật.
