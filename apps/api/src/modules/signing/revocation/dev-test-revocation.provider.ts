import * as crypto from 'crypto';
import * as forge from 'node-forge';
import {
  CertificateStatusType,
  IRevocationInformationProvider,
  RevocationCheckOptions,
  RevocationInfoResult,
} from './revocation.interface.js';
import { OID_BASIC_OCSP_RESPONSE } from './ocsp-crl-parser.util.js';

/**
 * Nhà cung cấp thông tin thu hồi chứng thư (OCSP & CRL) nội bộ chuẩn RFC 6960 & RFC 5280
 * phục vụ môi trường kiểm thử (Dev/Test/CI) ngoại tuyến.
 * 
 * Tạo ra các cấu trúc ASN.1 DER thực thụ với chữ ký số RSA 2048-bit hợp lệ,
 * cho phép kiểm tra mọi kịch bản GOOD, REVOKED, UNKNOWN mà không phụ thuộc Internet.
 */
export class DevTestRevocationProvider implements IRevocationInformationProvider {
  private devCaKeyPair: forge.pki.rsa.KeyPair;
  private devCaCert: forge.pki.Certificate;
  private devCaCertPem: string;
  private devCaPrivateKeyPem: string;

  // Danh sách các serial number bị đánh dấu là REVOKED trong môi trường test
  private revokedSerialNumbers = new Set<string>();
  // Trạng thái mô phỏng network failure nếu cần
  private simulateNetworkFailure = false;

  constructor() {
    // Khởi tạo cặp khóa RSA 2048-bit cho Dev Root CA
    this.devCaKeyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
    this.devCaPrivateKeyPem = forge.pki.privateKeyToPem(this.devCaKeyPair.privateKey);

    // Tạo chứng thư Dev CA
    const cert = forge.pki.createCertificate();
    cert.publicKey = this.devCaKeyPair.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 3600 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);

    const attrs = [
      { name: 'commonName', value: 'Trinh Ky Online Test CA Revocation Root' },
      { name: 'organizationName', value: 'Trinh Ky Online Dev Test PKI' },
      { name: 'countryName', value: 'VN' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    ]);

    cert.sign(this.devCaKeyPair.privateKey, forge.md.sha256.create());
    this.devCaCert = cert;
    this.devCaCertPem = forge.pki.certificateToPem(cert);
  }

  public getCaCertificatePem(): string {
    return this.devCaCertPem;
  }

  public markAsRevoked(serialNumberHex: string): void {
    const normalized = serialNumberHex.replace(/^0x/i, '').toLowerCase();
    this.revokedSerialNumbers.add(normalized);
  }

  public setSimulateNetworkFailure(fail: boolean): void {
    this.simulateNetworkFailure = fail;
  }

  public async isAvailable(): Promise<boolean> {
    return !this.simulateNetworkFailure;
  }

  /**
   * Tạo phản hồi OCSP (RFC 6960) nhị phân ASN.1 DER chuẩn
   */
  public generateOcspResponseDer(
    serialNumberHex: string,
    status: CertificateStatusType = 'GOOD',
    issuerCertPem: string = this.devCaCertPem,
    signingPrivateKeyPem: string = this.devCaPrivateKeyPem
  ): Buffer {
    const asn1 = forge.asn1;
    const pki = forge.pki;

    const normalizedSerial = serialNumberHex.replace(/^0x/i, '').toLowerCase();
    const serialBytes = forge.util.hexToBytes(normalizedSerial);

    const now = new Date();
    const nextUpdate = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    // CertID: hashAlgorithm (SHA-256), issuerNameHash, issuerKeyHash, serialNumber
    const issuerCert = pki.certificateFromPem(issuerCertPem);
    const issuerNameDer = asn1.toDer((pki.certificateToAsn1(issuerCert) as any).value[0].value[3]).getBytes();
    const issuerNameHash = crypto.createHash('sha256').update(Buffer.from(issuerNameDer, 'binary')).digest();

    const pubKeyDer = Buffer.from(
      asn1.toDer(pki.publicKeyToAsn1(issuerCert.publicKey)).getBytes(),
      'binary'
    );
    const issuerKeyHash = crypto.createHash('sha256').update(pubKeyDer).digest();

    const certIdSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      // AlgorithmIdentifier SHA-256 (2.16.840.1.101.3.4.2.1)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, issuerNameHash.toString('binary')),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, issuerKeyHash.toString('binary')),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, serialBytes),
    ]);

    // CertStatus: good [0] IMPLICIT NULL, revoked [1] IMPLICIT RevokedInfo, unknown [2] IMPLICIT UnknownInfo
    let certStatusItem: any;
    if (status === 'GOOD') {
      certStatusItem = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, false, '');
    } else if (status === 'REVOKED') {
      const revTimeStr = asn1.dateToGeneralizedTime(new Date(Date.now() - 3600 * 1000));
      certStatusItem = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, revTimeStr),
      ]);
    } else {
      certStatusItem = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, '');
    }

    // SingleResponse
    const singleResponseSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      certIdSeq,
      certStatusItem,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(now)),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(nextUpdate)),
      ]),
    ]);

    // ResponderID: [1] byName (Name)
    const responderNameSeq = (pki.certificateToAsn1(issuerCert) as any).value[0].value[5];
    const responderIdItem = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [responderNameSeq]);

    // ResponseData
    const responseDataSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      responderIdItem,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(now)),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [singleResponseSeq]),
    ]);

    // Ký RSA trên ResponseData
    const responseDataDer = Buffer.from(asn1.toDer(responseDataSeq).getBytes(), 'binary');
    const privateKey = crypto.createPrivateKey(signingPrivateKeyPem);
    const signature = crypto.sign('sha256', responseDataDer, privateKey);

    // BasicOCSPResponse
    const basicOcspSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      responseDataSeq,
      // AlgorithmIdentifier sha256WithRSAEncryption (1.2.840.113549.1.1.11)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      // Signature BIT STRING (prefix 0x00)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, String.fromCharCode(0) + signature.toString('binary')),
    ]);

    const basicOcspDer = asn1.toDer(basicOcspSeq).getBytes();

    // OCSPResponse: responseStatus successful (0), responseBytes
    const ocspResponseSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.ENUMERATED, false, String.fromCharCode(0)),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_BASIC_OCSP_RESPONSE).getBytes()),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, basicOcspDer),
        ]),
      ]),
    ]);

    return Buffer.from(asn1.toDer(ocspResponseSeq).getBytes(), 'binary');
  }

  /**
   * Tạo CRL (RFC 5280) nhị phân ASN.1 DER chuẩn
   */
  public generateCrlDer(
    revokedSerials: string[] = [],
    issuerCertPem: string = this.devCaCertPem,
    signingPrivateKeyPem: string = this.devCaPrivateKeyPem
  ): Buffer {
    const asn1 = forge.asn1;
    const pki = forge.pki;

    const now = new Date();
    const nextUpdate = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const issuerCert = pki.certificateFromPem(issuerCertPem);
    const issuerSeq = (pki.certificateToAsn1(issuerCert) as any).value[0].value[5];

    // Danh sách revokedCertificates SEQUENCE
    const revokedItems: any[] = [];
    for (const serial of revokedSerials) {
      const normalizedSerial = serial.replace(/^0x/i, '').toLowerCase();
      const serialBytes = forge.util.hexToBytes(normalizedSerial);

      revokedItems.push(
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, serialBytes),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(now)),
        ])
      );
    }

    const tbsItems = [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(1)), // version 1 (v2 CRL)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
      ]),
      issuerSeq,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(now)),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(nextUpdate)),
    ];

    if (revokedItems.length > 0) {
      tbsItems.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, revokedItems));
    }

    const tbsCertList = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, tbsItems);
    const tbsDer = Buffer.from(asn1.toDer(tbsCertList).getBytes(), 'binary');

    const privateKey = crypto.createPrivateKey(signingPrivateKeyPem);
    const signature = crypto.sign('sha256', tbsDer, privateKey);

    const crlSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      tbsCertList,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.11').getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, String.fromCharCode(0) + signature.toString('binary')),
    ]);

    return Buffer.from(asn1.toDer(crlSeq).getBytes(), 'binary');
  }

  public async getRevocationInfo(
    certPem: string,
    issuerCertPem: string,
    options?: RevocationCheckOptions
  ): Promise<RevocationInfoResult> {
    if (this.simulateNetworkFailure) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: 'Mô phỏng lỗi kết nối mạng tới dịch vụ OCSP/CRL (Simulated Network Failure).',
      };
    }

    const pki = forge.pki;
    const cert = pki.certificateFromPem(certPem);
    const serialHex = cert.serialNumber.replace(/^0x/i, '').toLowerCase();

    const isRevoked = this.revokedSerialNumbers.has(serialHex);
    const certStatus: CertificateStatusType = isRevoked ? 'REVOKED' : 'GOOD';

    const preferred = options?.preferredSource || 'AUTO';

    if (preferred === 'CRL') {
      const crlDer = this.generateCrlDer(
        isRevoked ? [serialHex] : [],
        issuerCertPem,
        this.devCaPrivateKeyPem
      );
      return {
        status: certStatus,
        sourceType: 'CRL',
        crlDer,
        thisUpdate: new Date(),
        nextUpdate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        serialNumber: cert.serialNumber,
        isSignatureValid: true,
      };
    }

    // Mặc định hoặc AUTO: Tạo OCSP Response
    const ocspDer = this.generateOcspResponseDer(
      serialHex,
      certStatus,
      issuerCertPem,
      this.devCaPrivateKeyPem
    );

    return {
      status: certStatus,
      sourceType: 'OCSP',
      ocspResponseDer: ocspDer,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      serialNumber: cert.serialNumber,
      isSignatureValid: true,
    };
  }
}
