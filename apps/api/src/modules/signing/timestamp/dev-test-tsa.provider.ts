import * as crypto from 'crypto';
import * as forge from 'node-forge';
import {
  ITimestampAuthorityProvider,
  TimestampRequestOptions,
  TimestampTokenResult,
} from './timestamp.interface.js';
import {
  OID_ID_CT_TST_INFO,
  OID_ID_SIGNED_DATA,
  OID_ID_KP_TIME_STAMPING,
  OID_SHA256,
  TimestampTokenVerifier,
} from './timestamp-token.verifier.js';

export interface DevTsaConfig {
  commonName?: string;
  organizationName?: string;
  policyOid?: string;
  validityDays?: number;
  keySizeBits?: number;
  simulateFailure?: boolean;
  simulateMissingEku?: boolean;
}

/**
 * Nhà cung cấp RFC 3161 TSA nội bộ phục vụ môi trường Development và Test độc lập.
 * 
 * ĐẶC TÍNH MẬT MÃ:
 * - Tự động sinh cặp khóa RSA 2048-bit và chứng thư số X.509 có Extended Key Usage `id-kp-timeStamping` (1.3.6.1.5.5.7.3.8).
 * - Sinh cấu trúc TimeStampResp chuẩn RFC 3161 với TSTInfo và chữ ký CMS SignedData thật.
 * - Hoàn toàn không phụ thuộc Internet; có thể mô phỏng các ca lỗi (tampering, missing EKU, failure).
 */
export class DevTestTsaProvider implements ITimestampAuthorityProvider {
  private readonly keypair: forge.pki.rsa.KeyPair;
  private readonly cert: forge.pki.Certificate;
  private readonly certPem: string;
  private readonly policyOid: string;
  private simulateFailure = false;
  private simulateMissingEku = false;

  constructor(config: DevTsaConfig = {}) {
    this.policyOid = config.policyOid || '1.3.6.1.4.1.61498.1.1'; // Trinh Ky Online Test TSA Policy
    this.simulateFailure = !!config.simulateFailure;
    this.simulateMissingEku = !!config.simulateMissingEku;

    const pki = forge.pki;
    const bits = config.keySizeBits || 2048;
    this.keypair = pki.rsa.generateKeyPair({ bits, workers: -1 });

    const cert = pki.createCertificate();
    cert.publicKey = this.keypair.publicKey;
    cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
    cert.validity.notBefore = new Date(Date.now() - 3600 * 1000); // 1 giờ trước
    cert.validity.notAfter = new Date(Date.now() + (config.validityDays || 365) * 86400 * 1000);

    const attrs = [
      { name: 'commonName', value: config.commonName || 'Trinh Ky Online Dev Internal TSA Authority' },
      { name: 'organizationName', value: config.organizationName || 'Trinh Ky Online Test Lab' },
      { name: 'countryName', value: 'VN' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    const extensions: any[] = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    ];

    if (!this.simulateMissingEku) {
      extensions.push({
        name: 'extKeyUsage',
        id: '2.5.29.37',
        critical: true,
        timeStamping: true,
      });
    }

    cert.setExtensions(extensions);
    cert.sign(this.keypair.privateKey, forge.md.sha256.create());

    this.cert = cert;
    this.certPem = pki.certificateToPem(cert);
  }

  public setSimulateFailure(fail: boolean) {
    this.simulateFailure = fail;
  }

  public setSimulateMissingEku(missing: boolean) {
    this.simulateMissingEku = missing;
  }

  public getCertificatePem(): string {
    return this.certPem;
  }

  public async isAvailable(): Promise<boolean> {
    return !this.simulateFailure;
  }

  public async getTimestampToken(
    digest32Bytes: Buffer,
    options: TimestampRequestOptions = {}
  ): Promise<TimestampTokenResult> {
    if (this.simulateFailure) {
      throw new Error('Máy chủ TSA giả lập đang ở trạng thái ngừng phục vụ (Simulated TSA Service Unavailable).');
    }

    if (!Buffer.isBuffer(digest32Bytes) || digest32Bytes.length !== 32) {
      throw new Error('digest32Bytes phải là Buffer chính xác 32 byte SHA-256.');
    }

    const asn1 = forge.asn1;
    const pki = forge.pki;
    const now = new Date();

    const nonceHex = options.nonce || crypto.randomBytes(8).toString('hex');
    const nonceBuffer = Buffer.from(nonceHex, 'hex');
    const tokenSerialHex = '02' + crypto.randomBytes(8).toString('hex');

    // 1. Xây dựng TSTInfo SEQUENCE
    const tstInfoSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')), // version 1
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(this.policyOid).getBytes()),
      // messageImprint
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest32Bytes.toString('binary')),
      ]),
      // serialNumber
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(tokenSerialHex)),
      // genTime GeneralizedTime
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(now)),
      // ordering BOOLEAN (false)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0x00)),
      // nonce INTEGER
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, nonceBuffer.toString('binary')),
    ]);

    const tstInfoDer = Buffer.from(asn1.toDer(tstInfoSeq).getBytes(), 'binary');

    // 2. Ký TSTInfo bằng khóa riêng của TSA
    const certAsn1 = pki.certificateToAsn1(this.cert);
    const tbsCert = (certAsn1 as any).value[0];
    const serialNumberAsn1 = tbsCert.value[1];
    const issuerAsn1 = tbsCert.value[3];

    const issuerAndSerial = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      issuerAsn1,
      serialNumberAsn1,
    ]);

    // Thuộc tính ký của TSA (SignedAttributes) bao gồm ESS SigningCertificateV2 theo RFC 3161 / RFC 5035
    const tstDigest = crypto.createHash('sha256').update(tstInfoDer).digest();

    const tsaAttrContentType = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.3').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_ID_CT_TST_INFO).getBytes()),
      ]),
    ]);

    const tsaAttrSigningTime = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.5').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(now)),
      ]),
    ]);

    const tsaAttrMessageDigest = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.4').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, tstDigest.toString('binary')),
      ]),
    ]);

    // ESS signingCertificateV2 (RFC 5035) chống tấn công Certificate Substitution
    const tsaCertDer = Buffer.from(asn1.toDer(certAsn1).getBytes(), 'binary');
    const tsaCertHash = crypto.createHash('sha256').update(tsaCertDer).digest();
    const essCertIdV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, tsaCertHash.toString('binary')),
    ]);
    const tsaAttrSigningCertV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.16.2.47').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [essCertIdV2]),
        ]),
      ]),
    ]);

    const tsaSignedAttrsList = [tsaAttrContentType, tsaAttrSigningTime, tsaAttrMessageDigest, tsaAttrSigningCertV2];
    tsaSignedAttrsList.sort((a, b) => {
      const derA = Buffer.from(asn1.toDer(a).getBytes(), 'binary');
      const derB = Buffer.from(asn1.toDer(b).getBytes(), 'binary');
      return derA.compare(derB);
    });

    const tsaSignedAttrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, tsaSignedAttrsList);
    const derTsaSignedAttrs = Buffer.from(asn1.toDer(tsaSignedAttrsSet).getBytes(), 'binary');

    const privKey = crypto.createPrivateKey(pki.privateKeyToPem(this.keypair.privateKey));
    const signatureBuffer = crypto.sign('sha256', derTsaSignedAttrs, privKey);

    const tsaSignedAttrsContextSpecific = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, tsaSignedAttrsList);

    // SignerInfo của TSA
    const tsaSignerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
      issuerAndSerial,
      // digestAlgorithm: sha256
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      tsaSignedAttrsContextSpecific, // [0] IMPLICIT signedAttrs
      // signatureAlgorithm: rsaEncryption
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.1').getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      // signatureValue
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signatureBuffer.toString('binary')),
    ]);

    // 3. SignedData của TSA
    const signedDataSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('03')), // version 3
      // digestAlgorithms
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
        ]),
      ]),
      // encapContentInfo: id-ct-TSTInfo + OCTET STRING của TSTInfo
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_ID_CT_TST_INFO).getBytes()),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, tstInfoDer.toString('binary')),
        ]),
      ]),
      // certificates [0] IMPLICIT
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
      // signerInfos
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [tsaSignerInfo]),
    ]);

    // 4. ContentInfo (TimeStampToken)
    const timeStampToken = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_ID_SIGNED_DATA).getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedDataSeq]),
    ]);

    const tokenDer = Buffer.from(asn1.toDer(timeStampToken).getBytes(), 'binary');

    // Xác minh token trước khi trả về
    const verifyResult = TimestampTokenVerifier.verifyToken(tokenDer, digest32Bytes, nonceHex);
    if (!verifyResult.isValid) {
      throw new Error(`Lỗi sinh token nội bộ trong DevTestTsaProvider: ${verifyResult.errorMessage}`);
    }

    return {
      tokenDer,
      genTime: now,
      serialNumber: tokenSerialHex,
      policyOid: this.policyOid,
      tsaSubjectDn: verifyResult.tsaSubjectDn!,
      tsaIssuerDn: verifyResult.tsaIssuerDn!,
      tsaCertificatePem: this.certPem,
      hashAlgorithm: 'sha256',
      hashedMessageHex: digest32Bytes.toString('hex'),
    };
  }
}
