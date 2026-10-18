# Thêm phương pháp dịch

Ảnh chụp là đầu vào chung. Một adapter có thể gọi LLM đọc ảnh trực tiếp, hoặc tự thực hiện OCR rồi dịch chữ. Không cần sửa logic chọn vùng, kho bản dịch hay thẻ kết quả. `TranslationInput.mode` là `learn` hoặc `quick`; phần `learning` của mỗi đoạn là tùy chọn để giữ khả năng tương thích.

1. Thêm metadata vào `methodCatalog` trong `src/methods/catalog.ts`: `id` duy nhất, tên hiển thị, phiên bản prompt và các trường cấu hình. Đánh dấu credential bằng `secret: true`; các trường này không tham gia cache key. Trường `defaultValue` được dùng khi tạo cấu hình.
2. Tạo adapter trong `src/methods`, triển khai `TranslationMethod` ở `src/types.ts`.
3. Thêm adapter vào `createRegistry([...])` trong `src/methods/registry.ts`. Đảm bảo ID của descriptor trùng metadata. Chỉ offscreen import registry thực thi; popup/cài đặt chỉ dùng catalog.
4. Nếu dịch vụ có domain mới, khai báo chính xác domain đó trong `host_permissions` của `wxt.config.ts` rồi build/reload extension.
5. Thêm test cho request, parser, lỗi, tín hiệu hủy và model/cấu hình ảnh hưởng cache. Không đưa credential vào test.

```ts
import type { TranslationMethod } from '../types';
import { methodCatalog } from './catalog';

export const exampleMethod: TranslationMethod = {
  descriptor: methodCatalog.find(m => m.id === 'example')!,
  async translate(input, { config, signal }) {
    // input.image = { base64, mimeType }; sourceLang/targetLang là tên ngôn ngữ.
    // Truyền signal vào mọi request; kiểm tra response trước khi trả kết quả.
    // config chỉ tồn tại trong ngữ cảnh extension tin cậy.
    return {
      segments: [{ source: 'Original dialogue', translation: 'Lời thoại đã dịch' }],
      warnings: [],
    };
  },
  async testConnection({ config, signal }) {
    // Một phép kiểm tra nhẹ, chỉ thực hiện khi người dùng bấm nút.
  },
};
```

Các nguyên tắc adapter:

- Không truy cập DOM website, không thay đổi giao diện và không gửi key về background/content qua kết quả.
- Trả các đoạn theo thứ tự đọc; không trả HTML để giao diện thực thi.
- Dùng `AppError` cho lỗi đã phân loại; không đưa nguyên văn response hoặc credential vào lỗi/log.
- Timeout 5 phút, lưu bản dịch theo vùng, trạng thái và hủy do lớp điều phối quản lý. Adapter không tự retry hoặc chọn dịch vụ/model khác. Không tự ghi screenshot vào storage.
- Tăng `promptVersion` khi thay đổi prompt hoặc cách chuẩn hóa kết quả; mỗi bản lưu giữ model, ngôn ngữ, chế độ và phiên bản prompt đã dùng.
- Ở chế độ `learn`, trả `learning: { chunks: [{text, meaning}], structures: [{excerpt, pattern, explanation, example, exampleTranslation}], notes: [] }` cho mỗi đoạn. Tối đa bốn cụm, hai cấu trúc và bốn ghi chú. Giải thích bằng tiếng Việt; `text` và `excerpt` phải nằm trong `source`.
- Kiểm tra phần học riêng với `parseLearning`: lỗi phần học không được làm mất bản dịch hợp lệ. Ở chế độ `quick`, trả bản dịch thường và bỏ phần học.

Menu hiện chỉ có các adapter thực sự hoạt động; không thêm lựa chọn giả “sắp có”. Các trường cài đặt chuẩn là chuỗi: credential dùng ô nhập bí mật, còn `suggestions` tạo danh sách chọn cố định, không nhập tự do. Một provider tương lai cần cấu hình phức tạp có thể mở rộng `ConfigField` và renderer cài đặt, nhưng vẫn giữ nguyên hợp đồng ảnh và kết quả.

Adapter `local-ocr` là ví dụ xử lý hoàn toàn cục bộ: descriptor có `kind: 'ocr'`, `fields: []`, `sourceLanguages: ['English']`; kết quả có `kind: 'ocr'`, văn bản trong `segments[].source`, `translation: ''`. UI bỏ phần học/ngôn ngữ đích, hiển thị chữ qua light DOM slot để extension khác đọc được phần bôi chọn. Worker và dữ liệu nằm trong gói extension; worker được hủy sau mỗi lượt để giải phóng bộ nhớ ảnh. Không thêm domain vào manifest cho phương pháp này.

Adapter `windows-ocr` cũng trả `kind: 'ocr'`. Offscreen chỉ gửi yêu cầu đến background; background xác thực đúng URL offscreen, ID tác vụ đang chạy và phương pháp trước khi mở Native Messaging. Không gọi `connectNative` trực tiếp từ offscreen (API offscreen chỉ hỗ trợ runtime messaging). Không giữ hàng đợi điều phối trong khi chờ native, để hủy/xóa/điều hướng vẫn xử lý được. Hủy tác vụ đóng native port; không tự chuyển sang OCR khác. Xem [cầu nối Windows OCR](WINDOWS_OCR.md).
