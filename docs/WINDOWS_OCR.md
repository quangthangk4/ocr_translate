# Windows OCR cho Comic Lens

Phương pháp thứ ba dùng `Windows.Media.Ocr` qua chương trình cầu nối Native Messaging. Toàn bộ ảnh được cắt trên máy, gửi qua pipe đến cầu nối và trả chữ về Comic Lens. Không mở Snipping Tool, không dùng clipboard, không gọi Gemini hoặc máy chủ OCR. Chỉ hỗ trợ nhận chữ tiếng Anh trong bản này.

## Cài một lần

1. Cập nhật extension bằng thư mục `.output/chrome-mv3`, bấm Reload ở `brave://extensions`, rồi tải lại trang truyện.
2. Mở cài đặt Comic Lens, chọn **Windows OCR — nhận chữ bằng Windows**. Bấm **Sao chép ID** ở phần hướng dẫn cầu nối.
3. Giải nén **comic-lens-windows-ocr-1.0.0.zip** vào một thư mục riêng. Giữ đủ các file EXE, MSIX, CER và script cài/gỡ.
4. Mở **Install.cmd**, dán ID extension và Enter. Windows sẽ hỏi quyền quản trị một lần để tin cậy chứng chỉ ký gói cầu nối. Chỉ cần nhập ID trong lần thiết lập hoặc khi ID extension thay đổi; không phải sao chép văn bản lúc đọc truyện.
5. Trở về cài đặt, bấm **Kiểm tra Windows OCR**. Khi báo sẵn sàng, bấm **Lưu cài đặt**.
6. Trên trang truyện, dùng **Khoanh vùng lấy chữ**, **Lấy chữ khung nhìn** hoặc Ctrl+Shift+Y như với OCR cục bộ.

Cần Windows 10 build 19041 trở lên / Windows 11, .NET Framework 4.8 và bộ ngôn ngữ OCR English. Windows OCR này không yêu cầu NPU hay Copilot+ PC. Nếu chưa có tiếng Anh, thêm English trong **Windows Settings → Time & language → Language & region**, tải thành phần ngôn ngữ rồi kiểm tra lại. Quản trị viên máy có thể đặt chính sách chặn cài ứng dụng ký bằng chứng chỉ cá nhân.

Bản dịch và key Gemini được giữ khi chọn Windows OCR. Chữ nhận được dùng cùng bộ lọc ký tự, kiểu chữ thường/đầu câu viết hoa, in đậm chữ cái đầu câu, bôi chọn và lưu theo ảnh. **Nhận chữ lại** trên thẻ Windows OCR luôn dùng Windows OCR, kể cả khi phương pháp mặc định đã đổi.

## Bộ cài thay đổi gì?

- Chép cầu nối vào `%LOCALAPPDATA%\ComicLens\WindowsOcr`.
- Đăng ký gói danh tính `ComicLens.WindowsOcr` với thư mục ngoài để ứng dụng có package identity theo yêu cầu Windows OCR.
- Tin cậy **chứng chỉ phát triển công khai đi kèm** trong `LocalMachine\TrustedPeople` để Windows cho cài MSIX; bước này cần xác nhận quản trị. Không thêm chứng chỉ gốc và không chia sẻ khóa ký riêng. Windows sẽ tin các gói được ký bằng chứng chỉ này; bộ cài dùng chứng chỉ riêng cho cầu nối.
- Tạo khóa đăng ký Native Messaging cho Comic Lens trong HKCU của Brave và Chrome. Chỉ các ID extension được cài mới nằm trong `allowed_origins`.
- Không thêm startup task, dịch vụ nền, cổng localhost hoặc tải ảnh lên mạng. Cầu nối chỉ xử lý một yêu cầu của trình duyệt, xong thì thoát.

Không tự tin cậy chứng chỉ hoặc cài gói chỉ vì mở trang cài đặt extension. Những thay đổi trên chỉ xảy ra khi chạy bộ cài. Kiểm tra kết nối không gửi ảnh và không đọc clipboard.

## Gỡ cầu nối

Chạy bằng Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ComicLens\WindowsOcr\Uninstall.ps1"
```

Script gỡ khóa cầu nối và gói danh tính. Để lại thư mục cho bạn kiểm tra/xóa bằng tay. Không xóa key/cài đặt/lịch sử Comic Lens. Nếu đã cài bản cầu nối mới ở thư mục khác, script cũ không gỡ đăng ký của bản mới. Muốn gỡ cả chứng chỉ phát triển, mở Windows PowerShell **Run as administrator** và chạy `Trust-Certificate.ps1 -CertificatePath <đường dẫn tới ComicLens.WindowsOcr.cer> -Remove` trong thư mục cầu nối.

## Lỗi thường gặp

- **Chưa kết nối được cầu nối:** cài lại với đúng ID đang hiện trong cài đặt Comic Lens; kiểm tra đã giải nén đủ bộ cài, rồi Reload extension.
- **Chưa có bộ nhận chữ tiếng Anh:** thêm English và thành phần ngôn ngữ trong Windows Settings.
- **Không đọc được ảnh:** khoanh vùng nhỏ hơn. Cầu nối tự thu nhỏ ảnh nếu vượt giới hạn kích thước của bộ OCR; ảnh quá lớn hoặc không hợp lệ sẽ bị từ chối.
- **Nhận chữ chưa đúng:** thử khoanh sát bong bóng, tránh nền và chữ của khung khác. Không bảo đảm kết quả giống hệt chức năng Text Actions của Snipping Tool.

## Phát triển

Mã nguồn: `native/windows-ocr/Host.cs`, các manifest và script cài/gỡ. Host C# biên dịch bằng `csc.exe` của .NET Framework và WinMetadata có trên Windows. Công cụ MakeAppx/SignTool chỉ cần lúc build, không cần trên máy sử dụng.

`Build.ps1` mặc định đọc SDK tools trong `.native-tools/sdk/bin/10.0.26100.0/x64`; có thể truyền `-SdkTools` trỏ đến Windows SDK đã cài. Bộ công cụ dùng trong lần build này là Microsoft.Windows.SDK.BuildTools 10.0.26100.3916 từ NuGet chính thức.

```powershell
npm run windows:build
npm run windows:zip
npm run test:windows
```

Kiểm thử Windows thật cần chứng chỉ đã được quản trị viên tin cậy trước. Nó tạm cài cầu nối cho ID của extension trong profile thử nghiệm rồi gỡ đăng ký sau khi xong; không tự bật hộp thoại UAC. Script từ chối thay thế cầu nối cá nhân đang được cài. Kiểm thử E2E thông thường kiểm tra menu và báo lỗi thiếu cầu nối; kiểm thử native thật được bật riêng bằng `RUN_WINDOWS_OCR=1`.

Không đưa `native/windows-ocr/build/signer.pfx` vào ZIP, Git hoặc chia sẻ: đây là khóa ký riêng. ZIP bàn giao chỉ có chứng chỉ **công khai** `.cer`, EXE, MSIX, hướng dẫn và script cài/gỡ. Không đóng gói các công cụ SDK của Microsoft.

Kiểm chứng bản 0.4.0: TypeScript và 55 unit tests đạt; bộ kiểm thử Brave thường kiểm tra cả lỗi thiếu cầu nối. Bộ nhận chữ Windows đã đọc được ảnh thử nghiệm bằng chương trình chẩn đoán riêng. Kiểm thử tích hợp qua gói MSIX đã cài chưa hoàn tất trong phiên phát triển vì cần xác nhận quản trị để tin cậy chứng chỉ ở cấp máy; chạy `npm run test:windows` sau bước này để kiểm chứng toàn bộ luồng.

Tham khảo: [Windows OCR](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr), [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [package identity với thư mục ngoài](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps).
