import * as forge from 'node-forge';

export interface GenerateDevKeystoreOptions {
  commonName: string;
  organizationName?: string;
  organizationalUnit?: string;
  country?: string;
  passphrase?: string;
  validityDays?: number;
  keySizeBits?: number;
}

export interface GeneratedDevKeystore {
  p12Buffer: Buffer;
  certificatePem: string;
  publicKeyPem: string;
  fingerprintSha256: string;
  serialNumber: string;
  subjectDn: string;
  issuerDn: string;
  validFrom: Date;
  validTo: Date;
}

/**
 * Tiện ích khởi tạo tệp PKCS#12 Keystore tự ký (Self-signed) phục vụ môi trường Development và Test.
 * 
 * LƯU Ý BẢO MẬT:
 * - Chứng thư tạo ra bởi tiện ích này được gán nhãn rõ ràng: "SELF-SIGNED / DEV-ONLY".
 * - TUYỆT ĐỐI KHÔNG dùng chứng thư tự ký này trong môi trường Production.
 * - Khóa riêng và mật khẩu chỉ được lưu giữ tạm thời để tạo container PKCS#12, không ghi ra log.
 */
export class DevKeystoreGenerator {
  public static generateSelfSignedKeystore(
    options: GenerateDevKeystoreOptions
  ): GeneratedDevKeystore {
    const pki = forge.pki;
    const keySize = options.keySizeBits || 2048;
    const passphrase = options.passphrase || 'AntigravityDevSigningPassphrase2026!';
    const validityDays = options.validityDays || 365;

    // 1. Sinh cặp khóa RSA
    const keypair = pki.rsa.generateKeyPair({ bits: keySize, workers: -1 });

    // 2. Tạo chứng thư số X.509
    const cert = pki.createCertificate();
    cert.publicKey = keypair.publicKey;
    cert.serialNumber = DevKeystoreGenerator.generateRandomHexSerial();

    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setDate(notBefore.getDate() + validityDays);

    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;

    // Đánh dấu rõ ràng DEV-ONLY trong Common Name
    const cn = `${options.commonName} (DEV TEST ONLY - NOT FOR PRODUCTION)`;
    const org = options.organizationName || 'TẬP ĐOÀN DOANH NGHIỆP DEV';
    const ou = options.organizationalUnit || 'Hệ thống Trình ký Online';
    const country = options.country || 'VN';

    const attrs = [
      { name: 'commonName', value: forge.util.encodeUtf8(cn), valueTag: forge.asn1.Type.UTF8 },
      { name: 'organizationName', value: forge.util.encodeUtf8(org), valueTag: forge.asn1.Type.UTF8 },
      { name: 'organizationalUnitName', value: forge.util.encodeUtf8(ou), valueTag: forge.asn1.Type.UTF8 },
      { name: 'countryName', value: country },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs); // Self-signed: Issuer == Subject

    // Thiết lập các Extensions chuẩn X.509 v3
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: false, // Leaf certificate
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
      },
      {
        name: 'extKeyUsage',
        serverAuth: false,
        clientAuth: true,
        codeSigning: false,
        emailProtection: true,
      },
      {
        name: 'subjectKeyIdentifier',
      },
    ]);

    // Ký tự ký với SHA-256
    cert.sign(keypair.privateKey, forge.md.sha256.create());

    // 3. Đóng gói vào chuẩn container PKCS#12 (.p12)
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
      keypair.privateKey,
      [cert],
      passphrase,
      {
        algorithm: '3des', // Tương thích cao với các thư viện Java/OpenSSL/Node
        friendlyName: cn,
      }
    );

    const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
    const p12Buffer = Buffer.from(p12Der, 'binary');

    const certificatePem = pki.certificateToPem(cert);
    const publicKeyPem = pki.publicKeyToPem(keypair.publicKey);

    // Tính toán SHA-256 fingerprint của DER certificate
    const certDer = forge.asn1.toDer(pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(certDer);
    const fingerprintSha256 = md.digest().toHex();

    return {
      p12Buffer,
      certificatePem,
      publicKeyPem,
      fingerprintSha256,
      serialNumber: cert.serialNumber,
      subjectDn: `CN=${cn}, O=${org}, OU=${ou}, C=${country}`,
      issuerDn: `CN=${cn}, O=${org}, OU=${ou}, C=${country}`,
      validFrom: notBefore,
      validTo: notAfter,
    };
  }

  private static generateRandomHexSerial(): string {
    const bytes = forge.random.getBytesSync(8);
    // RFC 5280 Section 4.1.2.2: Số serial phải là số nguyên dương (MSB < 0x80)
    const firstByte = (bytes.charCodeAt(0) & 0x7f) || 1;
    const positiveBytes = String.fromCharCode(firstByte) + bytes.slice(1);
    return forge.util.bytesToHex(positiveBytes).toLowerCase();
  }
}
