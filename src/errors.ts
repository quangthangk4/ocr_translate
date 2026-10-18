import type { ErrorCode, Failure } from './types';

export const messages: Record<ErrorCode, string> = {
  AUTH: 'API key không hợp lệ hoặc không có quyền. Kiểm tra key và project trong cài đặt.',
  MODEL: 'Không tìm thấy model. Hãy chọn model khác trong cài đặt.',
  QUOTA: 'Đã chạm hạn mức. Bạn có thể chờ hoặc tự đổi model trong cài đặt.',
  NETWORK: 'Không kết nối được dịch vụ. Kiểm tra mạng rồi bấm dịch lại.',
  TIMEOUT: 'Quá thời gian chờ 5 phút. Bạn có thể chọn vùng nhỏ hơn rồi thử lại.',
  BLOCKED: 'Dịch vụ từ chối xử lý nội dung ảnh này.',
  INVALID_RESPONSE: 'Phản hồi dịch không đầy đủ hoặc sai định dạng. Bạn có thể thử lại.',
  NO_TEXT: 'Không tìm thấy chữ đọc được trong vùng ảnh đã chọn.',
  CANCELLED: 'Đã hủy lượt dịch.',
  UNSUPPORTED: 'Không thể dịch trên trang này. Hãy mở trang web thông thường bằng http hoặc https.',
  BUSY: 'Đang có một lượt xử lý khác. Hãy hủy lượt đó trước khi bắt đầu.',
  INVALID_CAPTURE: 'Trang hoặc khung nhìn đã thay đổi. Hãy chọn vùng lại.',
  CONFIG: 'Chưa cấu hình đầy đủ phương pháp dịch. Hãy mở cài đặt.',
  API_REQUEST: 'Gemini từ chối yêu cầu API. Xem chi tiết bên dưới để xác định nguyên nhân.',
  STORAGE: 'Bản dịch chưa được lưu vì bộ nhớ gặp lỗi. Hãy dọn dữ liệu trong cài đặt.',
  OCR: 'Không chạy được bộ nhận chữ trên máy. Hãy tải lại extension và trang truyện rồi thử lại.',
  WINDOWS_SETUP: 'Chưa kết nối được cầu nối Windows OCR. Hãy mở cài đặt và làm theo hướng dẫn cài cầu nối cho đúng ID extension.',
  WINDOWS_LANGUAGE: 'Windows chưa có bộ nhận chữ tiếng Anh. Hãy thêm English trong Settings → Time & language → Language & region rồi kiểm tra lại.',
  UNKNOWN: 'Có lỗi khi xử lý. Hãy thử lại hoặc tải lại extension.',
};
export class AppError extends Error {
  constructor(public code: ErrorCode, message = messages[code]) { super(message); }
}
export function failure(error: unknown): Failure {
  const code = error instanceof AppError ? error.code : error instanceof DOMException && error.name === 'AbortError' ? 'CANCELLED' : 'UNKNOWN';
  return { code, message: error instanceof AppError ? error.message : messages[code] };
}
export function httpError(status: number): AppError {
  return new AppError(status === 401 || status === 403 ? 'AUTH' : status === 404 ? 'MODEL' : status === 429 ? 'QUOTA' : status >= 500 ? 'NETWORK' : 'API_REQUEST');
}
