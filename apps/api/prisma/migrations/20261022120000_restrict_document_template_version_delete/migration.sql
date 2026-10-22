-- Migration: Restrict deletion of FormTemplateVersion referenced by Documents
-- Bảo vệ dữ liệu lịch sử hồ sơ: Ngăn chặn xóa FormTemplateVersion nếu đang có hồ sơ tham chiếu.

-- Drop ForeignKey
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_templateVersionId_fkey";

-- AddForeignKey with ON DELETE RESTRICT
ALTER TABLE "documents" ADD CONSTRAINT "documents_templateVersionId_fkey" 
  FOREIGN KEY ("templateVersionId") REFERENCES "form_template_versions"("id") 
  ON DELETE RESTRICT ON UPDATE CASCADE;
