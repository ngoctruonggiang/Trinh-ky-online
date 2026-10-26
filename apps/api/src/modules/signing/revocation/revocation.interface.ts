export type CertificateStatusType = 'GOOD' | 'REVOKED' | 'UNKNOWN' | 'UNAVAILABLE';
export type RevocationSourceType = 'OCSP' | 'CRL';

export interface RevocationCheckOptions {
  /** Nguồn ưu tiên: OCSP, CRL hoặc tự động (thử OCSP trước, fallback sang CRL) */
  preferredSource?: 'OCSP' | 'CRL' | 'AUTO';
  /** Giới hạn thời gian kết nối và phản hồi (milliseconds, mặc định 5000ms) */
  timeoutMs?: number;
  /** Cho phép bỏ qua nếu không thể kết nối server thu hồi (chỉ dùng cho non-strict) */
  allowUnavailable?: boolean;
}

export interface RevocationInfoResult {
  /** Trạng thái thu hồi: GOOD, REVOKED, UNKNOWN, UNAVAILABLE */
  status: CertificateStatusType;
  /** Nguồn thông tin thu hồi: OCSP hoặc CRL */
  sourceType?: RevocationSourceType;
  /** Buffer nhị phân ASN.1 DER của OCSP Response (nếu có) */
  ocspResponseDer?: Buffer;
  /** Buffer nhị phân ASN.1 DER của CRL (nếu có) */
  crlDer?: Buffer;
  /** Thời điểm cấp thông tin trạng thái này (thisUpdate) */
  thisUpdate?: Date;
  /** Thời điểm hết hạn thông tin trạng thái (nextUpdate) */
  nextUpdate?: Date;
  /** Thời điểm bị thu hồi (nếu status = REVOKED) */
  revocationTime?: Date;
  /** Lý do thu hồi (nếu status = REVOKED) */
  revocationReason?: string;
  /** Tên định danh của OCSP Responder hoặc CRL Issuer */
  responderSubjectDn?: string;
  /** Tên định danh của CA phát hành chứng thư được kiểm tra */
  issuerSubjectDn?: string;
  /** Số serial của chứng thư được kiểm tra */
  serialNumber?: string;
  /** URL đã truy vấn để lấy dữ liệu (từ AIA hoặc CRL DP) */
  sourceUrl?: string;
  /** Chữ ký mật mã của OCSP Response hoặc CRL có hợp lệ hay không */
  isSignatureValid: boolean;
  /** Thông báo lỗi nếu có */
  errorMessage?: string;
}

export interface IRevocationInformationProvider {
  /**
   * Truy vấn và xác minh trạng thái thu hồi cho một chứng thư số X.509
   * @param certPem Chuỗi PEM chứng thư cần kiểm tra
   * @param issuerCertPem Chuỗi PEM chứng thư của CA phát hành (bắt buộc để xác minh chữ ký OCSP/CRL)
   * @param options Các tùy chọn kiểm tra
   */
  getRevocationInfo(
    certPem: string,
    issuerCertPem: string,
    options?: RevocationCheckOptions
  ): Promise<RevocationInfoResult>;

  /** Kiểm tra tính khả dụng của provider */
  isAvailable(): Promise<boolean>;
}

export const REVOCATION_PROVIDER = 'REVOCATION_PROVIDER';
