import { describe, it, expect } from 'vitest';
import {
  validateTemplateSchema,
  validateFormData,
  FormFieldDefinition,
  FormTemplate,
  normalizeFieldOptions,
  canonicalizeJson,
} from './template-schema.js';

describe('Template Schema & Form Validation (Phase 10 Shared Engine)', () => {
  describe('1. validateTemplateSchema (Xác thực cấu hình biểu mẫu)', () => {
    const validSampleTemplate: FormTemplate = {
      code: 'DON_XIN_NGHI_PHEP',
      title: 'Đơn xin nghỉ phép năm',
      description: 'Dành cho cán bộ nhân viên xin nghỉ phép',
      category: 'Hành chính - Nhân sự',
      status: 'DRAFT',
      currentVersion: 1,
      fields: [
        {
          id: 'f1',
          key: 'so_ngay_nghi',
          label: 'Số ngày nghỉ',
          type: 'number',
          required: true,
          order: 1,
          validation: { min: 1, max: 30 },
        },
        {
          id: 'f2',
          key: 'ly_do',
          label: 'Lý do nghỉ',
          type: 'textarea',
          required: true,
          order: 2,
        },
        {
          id: 'f3',
          key: 'loai_nghi',
          label: 'Loại nghỉ phép',
          type: 'select',
          required: true,
          order: 3,
          options: [
            { label: 'Phép năm', value: 'ANNUAL' },
            { label: 'Nghỉ không lương', value: 'UNPAID' },
          ],
        },
      ],
      layoutBlocks: [],
      defaultWorkflowSteps: [
        {
          stepOrder: 1,
          stepName: 'Trưởng phòng duyệt',
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
        },
      ],
    };

    it('Xác thực thành công với template hợp lệ', () => {
      const result = validateTemplateSchema(validSampleTemplate);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('Từ chối nếu thiếu tiêu đề hoặc mã biểu mẫu', () => {
      const invalid = { ...validSampleTemplate, title: '', code: '?' };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Tiêu đề'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Mã biểu mẫu'))).toBe(true);
    });

    it('Từ chối nếu danh sách fields rỗng', () => {
      const invalid = { ...validSampleTemplate, fields: [] };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ít nhất 1 trường'))).toBe(true);
    });

    it('Chặn key trùng lặp trong biểu mẫu (Duplicate Key Prevention)', () => {
      const invalid = {
        ...validSampleTemplate,
        fields: [
          { id: '1', key: 'so_tien', label: 'Số tiền 1', type: 'number' as const, required: true, order: 1 },
          { id: '2', key: 'SO_TIEN', label: 'Số tiền 2', type: 'number' as const, required: false, order: 2 },
        ],
      };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('key trùng lặp'))).toBe(true);
    });

    it('Chặn key chứa ký tự độc hại hoặc injection', () => {
      const invalid = {
        ...validSampleTemplate,
        fields: [
          { id: '1', key: 'user<script>', label: 'Tên', type: 'text' as const, required: true, order: 1 },
        ],
      };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('không hợp lệ'))).toBe(true);
    });

    it('Chặn trường select hoặc radio không có options', () => {
      const invalid = {
        ...validSampleTemplate,
        fields: [
          { id: '1', key: 'phong_ban', label: 'Phòng ban', type: 'select' as const, required: true, order: 1, options: [] },
        ],
      };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('phải có ít nhất một tùy chọn'))).toBe(true);
    });

    it('Chặn kiểu trường (type) không hợp lệ', () => {
      const invalid = {
        ...validSampleTemplate,
        fields: [
          { id: '1', key: 'abc', label: 'Abc', type: 'unknown_type' as any, required: false, order: 1 },
        ],
      };
      const result = validateTemplateSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('không được hỗ trợ'))).toBe(true);
    });
  });

  describe('2. validateFormData (Xác thực dữ liệu người dùng nhập)', () => {
    const testFields: FormFieldDefinition[] = [
      {
        id: '1',
        key: 'ho_ten',
        label: 'Họ và tên',
        type: 'text',
        required: true,
        order: 1,
        validation: { minLength: 3, maxLength: 50 },
      },
      {
        id: '2',
        key: 'email',
        label: 'Email công ty',
        type: 'email',
        required: true,
        order: 2,
      },
      {
        id: '3',
        key: 'so_tien',
        label: 'Số tiền tạm ứng',
        type: 'number',
        required: true,
        order: 3,
        validation: { min: 100000, max: 50000000 },
      },
      {
        id: '4',
        key: 'ngay_di',
        label: 'Ngày bắt đầu',
        type: 'date',
        required: true,
        order: 4,
      },
      {
        id: '5',
        key: 'muc_dich',
        label: 'Mục đích chi',
        type: 'select',
        required: true,
        order: 5,
        options: [
          { label: 'Công tác phí', value: 'CONG_TAC' },
          { label: 'Mua sắm thiết bị', value: 'THIET_BI' },
        ],
      },
      {
        id: '6',
        key: 'ghi_chu',
        label: 'Ghi chú thêm',
        type: 'textarea',
        required: false,
        order: 6,
      },
    ];

    it('Dữ liệu chuẩn xác pass toàn bộ validation', () => {
      const formData = {
        ho_ten: 'Nguyễn Văn An',
        email: 'an.nguyen@vinagroup.vn',
        so_tien: 5000000,
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
        ghi_chu: 'Chuyến công tác Hải Phòng',
      };
      const res = validateFormData(testFields, formData);
      expect(res.valid).toBe(true);
      expect(Object.keys(res.errors)).toHaveLength(0);
    });

    it('Bắt lỗi thiếu các trường bắt buộc (Required Fields)', () => {
      const emptyData = {};
      const res = validateFormData(testFields, emptyData);
      expect(res.valid).toBe(false);
      expect(res.errors['ho_ten']).toBeDefined();
      expect(res.errors['email']).toBeDefined();
      expect(res.errors['so_tien']).toBeDefined();
      expect(res.errors['ngay_di']).toBeDefined();
      expect(res.errors['muc_dich']).toBeDefined();
      // ghi_chu không bắt buộc nên không có lỗi
      expect(res.errors['ghi_chu']).toBeUndefined();
    });

    it('Bắt lỗi số tiền nhỏ hơn min hoặc lớn hơn max', () => {
      const lowData = {
        ho_ten: 'Trần Bình',
        email: 'binh@vinagroup.vn',
        so_tien: 50000, // nhỏ hơn min 100k
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
      };
      const res = validateFormData(testFields, lowData);
      expect(res.valid).toBe(false);
      expect(res.errors['so_tien']).toContain('không được nhỏ hơn');

      const highData = { ...lowData, so_tien: 100000000 }; // lớn hơn max 50tr
      const res2 = validateFormData(testFields, highData);
      expect(res2.valid).toBe(false);
      expect(res2.errors['so_tien']).toContain('không được lớn hơn');
    });

    it('Bắt lỗi định dạng email sai', () => {
      const badEmailData = {
        ho_ten: 'Lê Cường',
        email: 'lecuong-khong-phai-email',
        so_tien: 1000000,
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
      };
      const res = validateFormData(testFields, badEmailData);
      expect(res.valid).toBe(false);
      expect(res.errors['email']).toContain('không đúng định dạng email');
    });

    it('Bắt lỗi giá trị select không nằm trong whitelist options', () => {
      const badSelectData = {
        ho_ten: 'Phạm Dũng',
        email: 'dung@vinagroup.vn',
        so_tien: 1000000,
        ngay_di: '2026-11-01',
        muc_dich: 'HACKED_VALUE',
      };
      const res = validateFormData(testFields, badSelectData);
      expect(res.valid).toBe(false);
      expect(res.errors['muc_dich']).toContain('không nằm trong danh sách lựa chọn hợp lệ');
    });

    it('Bắt lỗi độ dài text vi phạm minLength', () => {
      const shortNameData = {
        ho_ten: 'AB', // < 3 ký tự
        email: 'ab@vinagroup.vn',
        so_tien: 1000000,
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
      };
      const res = validateFormData(testFields, shortNameData);
      expect(res.valid).toBe(false);
      expect(res.errors['ho_ten']).toContain('độ dài tối thiểu 3 ký tự');
    });

    it('Chặn key không được khai báo trong schema (Undeclared Key Policy)', () => {
      const payloadWithInjectedKey = {
        ho_ten: 'Nguyễn Văn An',
        email: 'an.nguyen@vinagroup.vn',
        so_tien: 5000000,
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
        injected_malicious_key: 'malicious_value',
      };
      const res = validateFormData(testFields, payloadWithInjectedKey);
      expect(res.valid).toBe(false);
      expect(res.errors['injected_malicious_key']).toContain('không được định nghĩa');
    });

    it('Bắt lỗi number không hữu hạn (Infinity, -Infinity)', () => {
      const infiniteData = {
        ho_ten: 'Nguyễn Văn An',
        email: 'an.nguyen@vinagroup.vn',
        so_tien: Infinity,
        ngay_di: '2026-11-01',
        muc_dich: 'CONG_TAC',
      };
      const res = validateFormData(testFields, infiniteData);
      expect(res.valid).toBe(false);
      expect(res.errors['so_tien']).toContain('chữ số hữu hạn');
    });

    it('Bắt lỗi ngày không tồn tại trong lịch thực tế (2026-02-31)', () => {
      const invalidCalendarDate = {
        ho_ten: 'Nguyễn Văn An',
        email: 'an.nguyen@vinagroup.vn',
        so_tien: 5000000,
        ngay_di: '2026-02-31',
        muc_dich: 'CONG_TAC',
      };
      const res = validateFormData(testFields, invalidCalendarDate);
      expect(res.valid).toBe(false);
      expect(res.errors['ngay_di']).toContain('không tồn tại trong lịch');
    });

    it('Bắt lỗi currency_vnd nếu chứa số thập phân hoặc âm không hợp lệ', () => {
      const vndFields: FormFieldDefinition[] = [
        { id: '1', key: 'chi_phi', label: 'Chi phí', type: 'currency_vnd', required: true, order: 1 },
      ];
      // Số thập phân
      const floatRes = validateFormData(vndFields, { chi_phi: 150000.5 });
      expect(floatRes.valid).toBe(false);
      expect(floatRes.errors['chi_phi']).toContain('không chứa số thập phân');

      // Số âm
      const negRes = validateFormData(vndFields, { chi_phi: -50000 });
      expect(negRes.valid).toBe(false);
      expect(negRes.errors['chi_phi']).toContain('không được là số tiền âm');
    });
  });

  describe('3. normalizeFieldOptions (Chuẩn hóa Options)', () => {
    it('Chuyển đổi chuỗi mảng đơn giản thành mảng { label, value }', () => {
      const raw = ['Hà Nội', 'Đà Nẵng', 'TP.HCM'];
      const normalized = normalizeFieldOptions(raw);
      expect(normalized).toEqual([
        { label: 'Hà Nội', value: 'Hà Nội' },
        { label: 'Đà Nẵng', value: 'Đà Nẵng' },
        { label: 'TP.HCM', value: 'TP.HCM' },
      ]);
    });

    it('Giữ nguyên các object đã có { label, value }', () => {
      const raw = [{ label: 'Phòng IT', value: 'IT' }];
      const normalized = normalizeFieldOptions(raw);
      expect(normalized).toEqual([{ label: 'Phòng IT', value: 'IT' }]);
    });
  });

  describe('4. canonicalizeJson (Chuẩn hóa JSON cho băm toàn vẹn SHA-256)', () => {
    it('Sắp xếp key đệ quy đồng nhất dù thứ tự khởi tạo khác nhau', () => {
      const objA = { b: 2, a: 1, nested: { z: 10, y: 20 } };
      const objB = { a: 1, nested: { y: 20, z: 10 }, b: 2 };

      expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
      expect(canonicalizeJson(objA)).toBe('{"a":1,"b":2,"nested":{"y":20,"z":10}}');
    });
  });

  describe('5. ReDoS Protection trong validateTemplateSchema', () => {
    it('Chặn biểu thức chính quy có nguy cơ ReDoS (nested quantifiers)', () => {
      const redosTemplate: FormTemplate = {
        code: 'TPL_REDOS',
        title: 'Mẫu kiểm tra ReDoS',
        status: 'DRAFT',
        fields: [
          {
            id: '1',
            key: 'risky_field',
            label: 'Trường rủi ro',
            type: 'text',
            required: false,
            order: 1,
            validation: { pattern: '([a-zA-Z]+)*' },
          },
        ],
        layoutBlocks: [],
      };
      const res = validateTemplateSchema(redosTemplate);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('ReDoS'))).toBe(true);
    });

    it('Chặn biểu thức chính quy quá 200 ký tự', () => {
      const longPattern = 'a'.repeat(250);
      const longPatternTemplate: FormTemplate = {
        code: 'TPL_LONG_REGEX',
        title: 'Mẫu regex dài',
        status: 'DRAFT',
        fields: [
          {
            id: '1',
            key: 'long_field',
            label: 'Trường regex dài',
            type: 'text',
            required: false,
            order: 1,
            validation: { pattern: longPattern },
          },
        ],
        layoutBlocks: [],
      };
      const res = validateTemplateSchema(longPatternTemplate);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('quá dài'))).toBe(true);
    });
  });
});
