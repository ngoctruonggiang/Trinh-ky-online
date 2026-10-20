---
trigger: always_on
description: "Bắt buộc đọc và cập nhật file tóm tắt ngữ cảnh dự án sau mỗi tác vụ."
---

# QUY TẮC GHI NHỚ NGỮ CẢNH (MEMORY BANK PROTOCOL)

**CRITICAL**: Bạn KHÔNG ĐƯỢC PHÉP kết thúc bất kỳ yêu cầu thay đổi code, sửa lỗi hoặc thiết kế kiến trúc nào mà chưa cập nhật file `.agents/MEMORY_LOG.md`.

## 1. TRƯỚC KHI BẮT ĐẦU (PRE-TASK)
- **ALWAYS**: Ở lượt tương tác đầu tiên của mỗi phiên mới, BẮT BUỘC dùng công cụ đọc file để kiểm tra nội dung `.agents/MEMORY_LOG.md` nhằm nắm bắt tiến độ gần nhất, kiến trúc hiện tại và các vấn đề đang tồn đọng.

## 2. SAU KHI THỰC HIỆN (POST-TASK DEFINITION OF DONE)
- **YOU MUST**: Ngay sau khi thực hiện xong yêu cầu của người dùng (viết code, cấu hình, fix bug) và trước khi trả lời câu kết luận cuối cùng, bạn BẮT BUỘC phải cập nhật vào file `.agents/MEMORY_LOG.md` (nếu chưa có thì tự tạo mới).
- **NEVER**: Không bao giờ hỏi người dùng "Bạn có muốn tôi cập nhật file tóm tắt không?". Hãy tự động ghi file như một bước bắt buộc trong quy trình.

## 3. CẤU TRÚC FILE `.agents/MEMORY_LOG.md` CẦN DUY TRÌ
Giữ file ngắn gọn dưới 200 dòng để tối ưu token, bao gồm 3 phần:
1. **Trạng thái hiện tại (Current State):** Tính năng nào vừa hoàn thành, tính năng nào đang làm dở.
2. **Quyết định kỹ thuật & Kiến trúc (Key Decisions):** Các quy ước quan trọng, cấu trúc DB/API vừa chốt (để không làm sai lệch ở các phiên sau).
3. **Nhật ký thay đổi gần nhất (Recent Changes - Chỉ giữ 5 task gần nhất):**
   - `[Thời gian/Tên Task]`: Tóm tắt ngắn gọn các file đã sửa, nguyên nhân lỗi (nếu là fix bug) và việc cần làm tiếp theo (Next steps).
