import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as forge from 'node-forge';
import {
  CertificateMetadata,
  ISigningKeyProvider,
  SignDataOptions,
  SignDigestOptions,
  SigningAlgorithm,
  SigningResult,
} from './signing-key-provider.interface';

// ASN.1 DER prefix cho SHA-256 DigestInfo theo chuẩn PKCS#1 v1.5 (RFC 8017 / ISO 32000)
// Sequence { AlgorithmIdentifier: 2.16.840.1.101.3.4.2.1 (id-sha256), NULL, OCTET STRING (32 bytes) }
const SHA256_DIGEST_INFO_PREFIX = Buffer.from(
  '3031300d060960864801650304020105000420',
  'hex'
);

interface CachedKeyEntry {
  keyAlias: string;
  privateKey: crypto.KeyObject;
  x509: crypto.X509Certificate;
  certificatePem: string;
  chain: string[];
  metadata: CertificateMetadata;
}

@Injectable()
export class DevLocalKeystoreProvider implements ISigningKeyProvider {
  private readonly logger = new Logger(DevLocalKeystoreProvider.name);
  private readonly keystoreDir: string;
  private readonly defaultPassphrase: string;
  private readonly keyCache = new Map<string, CachedKeyEntry>();
  private readonly passphraseCache = new Map<string, string>();

  constructor() {
    // Thư mục lưu trữ keystore cục bộ nằm ngoài public web root
    this.keystoreDir = path.resolve(process.cwd(), 'storage', 'keystores', 'dev');
    if (!fs.existsSync(this.keystoreDir)) {
      fs.mkdirSync(this.keystoreDir, { recursive: true });
    }

    // Passphrase cấu hình qua biến môi trường (fallback chỉ áp dụng cho local dev)
    this.defaultPassphrase =
      process.env.DEV_SIGNING_PASSPHRASE || 'AntigravityDevSigningPassphrase2026!';
  }

  /**
   * Chuẩn hóa và bảo vệ chống Path Traversal khi đọc tệp keystore
   */
  public resolveKeystorePath(keyAlias: string): string {
    // Chỉ cho phép ký tự an toàn: chữ cái, số, gạch ngang, gạch dưới
    if (!/^[a-zA-Z0-9_-]+$/.test(keyAlias)) {
      throw new BadRequestException(
        'Định danh khóa (keyAlias) không hợp lệ. Chỉ chấp nhận chữ cái, số, gạch dưới và gạch ngang.'
      );
    }

    const resolved = path.resolve(this.keystoreDir, `${keyAlias}.p12`);
    if (!resolved.startsWith(this.keystoreDir)) {
      throw new BadRequestException('Phát hiện hành vi Path Traversal trái phép.');
    }

    if (!fs.existsSync(resolved)) {
      // Hỗ trợ kiểm thử liên tiến trình khi server và test runner chạy từ các cwd khác nhau (apps/api vs monorepo root)
      const altDirs = [
        path.resolve(process.cwd(), 'apps', 'api', 'storage', 'keystores', 'dev'),
        path.resolve(process.cwd(), 'storage', 'keystores', 'dev'),
        path.resolve(process.cwd(), '..', 'storage', 'keystores', 'dev'),
        path.resolve(process.cwd(), '..', 'apps', 'api', 'storage', 'keystores', 'dev'),
      ];
      for (const altDir of altDirs) {
        const altPath = path.resolve(altDir, `${keyAlias}.p12`);
        if (fs.existsSync(altPath)) {
          return altPath;
        }
      }
    }

    return resolved;
  }

  /**
   * Nạp và giải mã tệp PKCS#12 từ đĩa vào RAM (có cache trong bộ nhớ tiến trình)
   * TUYỆT ĐỐI KHÔNG ghi private key ra log, database hay tệp tạm.
   */
  public loadKeystore(keyAlias: string, passphrase?: string): CachedKeyEntry {
    if (this.keyCache.has(keyAlias)) {
      return this.keyCache.get(keyAlias)!;
    }

    const filePath = this.resolveKeystorePath(keyAlias);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(
        `Không tìm thấy tệp keystore cho khóa [${keyAlias}] tại vị trí lưu trữ an toàn.`
      );
    }

    let p12Bytes: Buffer;
    try {
      p12Bytes = fs.readFileSync(filePath);
    } catch (err: any) {
      this.logger.error(`Không thể đọc tệp keystore [${keyAlias}] từ hệ thống tệp.`);
      throw new InternalServerErrorException('Lỗi truy cập hệ thống lưu trữ khóa.');
    }

    const effectivePass = passphrase || this.passphraseCache.get(keyAlias) || this.defaultPassphrase;
    const entry = this.parsePkcs12Buffer(keyAlias, p12Bytes, effectivePass);
    this.keyCache.set(keyAlias, entry);
    return entry;
  }

  /**
   * Giải mã mảng byte PKCS#12, kiểm tra tính toàn vẹn và khớp cặp khóa
   */
  public parsePkcs12Buffer(
    keyAlias: string,
    p12Buffer: Buffer,
    passphrase: string
  ): CachedKeyEntry {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
    } catch (err: any) {
      // Bảo mật: Không ghi passphrase hoặc thông tin chi tiết vào log/lỗi
      throw new UnauthorizedException(
        'Mật khẩu giải mã PKCS#12 keystore không đúng hoặc tệp dữ liệu đã bị hỏng.'
      );
    }

    // 1. Trích xuất Certificate Bag
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certList = certBags[forge.pki.oids.certBag];
    if (!certList || certList.length === 0 || !certList[0].cert) {
      throw new BadRequestException(
        'Tệp PKCS#12 không chứa bất kỳ chứng thư số X.509 (CertBag) hợp lệ nào.'
      );
    }

    // 2. Trích xuất Private Key Bag
    const keyBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ||
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];

    if (!keyBags || keyBags.length === 0 || !keyBags[0].key) {
      throw new BadRequestException(
        'Tệp PKCS#12 không chứa bất kỳ khóa riêng tư (PrivateKeyBag) hợp lệ nào.'
      );
    }

    // 3. Chuyển đổi sang chuẩn PEM
    const primaryCertForge = certList[0].cert;
    const certPem = forge.pki.certificateToPem(primaryCertForge);
    const keyPem = forge.pki.privateKeyToPem(keyBags[0].key);

    // Chuỗi chứng thư (chain)
    const chain: string[] = certList.map((c) => forge.pki.certificateToPem(c.cert!));

    // 4. Nạp vào Native Node.js Crypto Engine
    let x509: crypto.X509Certificate;
    let privateKey: crypto.KeyObject;
    try {
      x509 = new crypto.X509Certificate(certPem);
      privateKey = crypto.createPrivateKey(keyPem);
    } catch (err: any) {
      throw new InternalServerErrorException(
        'Không thể khởi tạo đối tượng mật mã X.509 / PrivateKey từ dữ liệu đã giải mã.'
      );
    }

    // 5. KIỂM TRA BẢO MẬT BẮT BUỘC: Khóa công khai của Certificate có khớp với Khóa riêng tư không?
    const testPayload = Buffer.from('ANTIGRAVITY_KEY_PAIR_VALIDATION_TOKEN');
    try {
      const testSig = crypto.sign('sha256', testPayload, privateKey);
      const isMatch = crypto.verify('sha256', testPayload, x509.publicKey, testSig);
      if (!isMatch) {
        throw new BadRequestException(
          'Phát hiện xung đột mật mã nghiêm trọng: Chứng thư số và khóa riêng trong keystore không thuộc cùng một cặp khóa!'
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(
        'Lỗi kiểm chứng tính tương thích giữa chứng thư và khóa riêng.'
      );
    }

    const metadata: CertificateMetadata = {
      subjectDn: x509.subject,
      issuerDn: x509.issuer,
      serialNumber: x509.serialNumber.toLowerCase(),
      fingerprintSha256: x509.fingerprint256.replace(/:/g, '').toLowerCase(),
      certificatePem: certPem,
      publicKeyPem: x509.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      validFrom: new Date(x509.validFrom),
      validTo: new Date(x509.validTo),
    };

    return {
      keyAlias,
      privateKey,
      x509,
      certificatePem: certPem,
      chain,
      metadata,
    };
  }

  /**
   * Nhập (import) một keystore mới từ Buffer và lưu trữ vào thư mục an toàn
   */
  public importKeystore(keyAlias: string, p12Buffer: Buffer, passphrase?: string): CertificateMetadata {
    const effectivePass = passphrase || this.defaultPassphrase;
    // Kiểm tra giải mã và xác thực tính hợp lệ trước khi lưu đĩa
    const entry = this.parsePkcs12Buffer(keyAlias, p12Buffer, effectivePass);
    const targetPath = this.resolveKeystorePath(keyAlias);

    // Ghi file atomic bằng file tạm trong cùng thư mục
    const tempPath = `${targetPath}.tmp_${Date.now()}`;
    fs.writeFileSync(tempPath, p12Buffer, { mode: 0o600 });
    fs.renameSync(tempPath, targetPath);

    // Đồng bộ sang thư mục tương đương nếu chạy trong môi trường monorepo
    const altTargetPaths = [
      path.resolve(process.cwd(), 'apps', 'api', 'storage', 'keystores', 'dev', `${keyAlias}.p12`),
      path.resolve(process.cwd(), '..', 'storage', 'keystores', 'dev', `${keyAlias}.p12`),
      path.resolve(process.cwd(), 'storage', 'keystores', 'dev', `${keyAlias}.p12`),
    ];
    for (const altPath of altTargetPaths) {
      try {
        const altDir = path.dirname(altPath);
        if (fs.existsSync(altDir) && altPath !== targetPath) {
          fs.writeFileSync(altPath, p12Buffer, { mode: 0o600 });
        }
      } catch {
        // Ignore fallback sync errors
      }
    }

    if (passphrase) {
      this.passphraseCache.set(keyAlias, passphrase);
    }
    this.keyCache.set(keyAlias, entry);
    return entry.metadata;
  }

  /**
   * Ký số mật mã trên luồng byte dữ liệu thô (Raw Data Buffer)
   */
  async signData(
    keyAlias: string,
    data: Buffer,
    options?: SignDataOptions
  ): Promise<SigningResult> {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new BadRequestException('Dữ liệu yêu cầu ký số phải là Buffer hợp lệ và không được rỗng.');
    }

    const entry = this.loadKeystore(keyAlias);
    const algorithm: SigningAlgorithm = options?.algorithm || 'RSA-SHA256';

    try {
      // Node.js crypto.sign tự động tính băm SHA-256 và ký theo chuẩn RSASSA-PKCS1-v1_5
      const signatureBytes = crypto.sign('sha256', data, entry.privateKey);
      return {
        signatureBytes,
        algorithm,
        keyAlias,
        certificatePem: entry.certificatePem,
        signedAt: new Date(),
      };
    } catch (err: any) {
      this.logger.error(`Lỗi trong tiến trình ký dữ liệu với khóa [${keyAlias}]: ${err.message}`);
      throw new InternalServerErrorException('Lỗi mật mã trong tiến trình ký số dữ liệu.');
    }
  }

  /**
   * Ký số mật mã trên mã băm đã tính toán trước (Pre-computed SHA-256 Digest)
   * Đầu vào BẮT BUỘC là chính xác 32 bytes của SHA-256.
   */
  async signDigest(
    keyAlias: string,
    digest: Buffer,
    options?: SignDigestOptions
  ): Promise<SigningResult> {
    if (!Buffer.isBuffer(digest)) {
      throw new BadRequestException('Bản băm (digest) phải là một Buffer nhị phân.');
    }
    if (digest.length !== 32) {
      throw new BadRequestException(
        `Độ dài bản băm không hợp lệ: Nhận được ${digest.length} bytes, yêu cầu chính xác 32 bytes (chuẩn SHA-256).`
      );
    }

    const entry = this.loadKeystore(keyAlias);
    const algorithm: SigningAlgorithm = options?.algorithm || 'RSA-SHA256';

    try {
      // Đóng gói DigestInfo ASN.1 và mã hóa RSA với PKCS1 Padding (Chuẩn RSASSA-PKCS1-v1_5)
      const digestInfo = Buffer.concat([SHA256_DIGEST_INFO_PREFIX, digest]);
      const signatureBytes = crypto.privateEncrypt(
        {
          key: entry.privateKey,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        digestInfo
      );

      return {
        signatureBytes,
        algorithm,
        keyAlias,
        certificatePem: entry.certificatePem,
        signedAt: new Date(),
      };
    } catch (err: any) {
      this.logger.error(`Lỗi trong tiến trình ký digest với khóa [${keyAlias}]: ${err.message}`);
      throw new InternalServerErrorException('Lỗi mật mã trong tiến trình ký số digest.');
    }
  }

  async getCertificate(keyAlias: string): Promise<CertificateMetadata> {
    const entry = this.loadKeystore(keyAlias);
    return entry.metadata;
  }

  async getCertificateChain(keyAlias: string): Promise<string[]> {
    const entry = this.loadKeystore(keyAlias);
    return entry.chain;
  }

  async isAvailable(keyAlias: string): Promise<boolean> {
    try {
      const filePath = this.resolveKeystorePath(keyAlias);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Xóa bộ nhớ cache trong RAM (phục vụ testing / refresh)
   */
  public clearCache(): void {
    this.keyCache.clear();
    this.passphraseCache.clear();
  }
}
