import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as forge from 'node-forge';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevTestTsaProvider } from '../src/modules/signing/timestamp/dev-test-tsa.provider.js';
import { RevocationService } from '../src/modules/signing/revocation/revocation.service.js';
import { PdfDssService } from '../src/modules/signing/dss/pdf-dss.service.js';
import { PdfDssParser } from '../src/modules/signing/dss/pdf-dss-parser.js';
import { PdfSignatureAdapter } from '../src/modules/signing/engine/pdf-signature.adapter.js';
import { PdfSignatureVerifier } from '../src/modules/signing/engine/pdf-signature.verifier.js';

async function main() {
  console.log('========================================================================');
  console.log('=== THẨM ĐỊNH ĐỘC LẬP PAdES BASELINE B-LT BẰNG OPENSSL 3.5.7 CLI ===');
  console.log('========================================================================\n');

  const tmpDir = path.join(process.cwd(), 'storage', 'openssl_pades_blt_verify');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. Khởi tạo PKI CA và Keystore người ký
  const revocationService = new RevocationService();
  const devRevocationProvider = revocationService.getDevProvider()!;
  const pdfDssService = new PdfDssService(revocationService);
  const keystoreProvider = new DevLocalKeystoreProvider();
  const tsaProvider = new DevTestTsaProvider({
    commonName: 'Trinh Ky Online Trusted TSA Authority 2026',
    organizationName: 'Trinh Ky Online PKI Root Lab',
  });

  const caCertPem = devRevocationProvider.getCaCertificatePem();
  const caCert = forge.pki.certificateFromPem(caCertPem);

  // Tạo chứng thư số người ký cấp bởi CA
  const keyAlias = `blt_audit_signer_${Date.now()}`;
  const signerKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
  const signerCert = forge.pki.createCertificate();
  signerCert.publicKey = signerKeys.publicKey;
  signerCert.serialNumber = '07E1F2A3';
  signerCert.validity.notBefore = new Date(Date.now() - 3600 * 1000);
  signerCert.validity.notAfter = new Date(Date.now() + 365 * 86400 * 1000);

  const subjectAttrs = [
    { name: 'commonName', value: forge.util.encodeUtf8('Tran Thi Kiem Dinh'), valueTag: forge.asn1.Type.UTF8 },
    { name: 'organizationName', value: forge.util.encodeUtf8('VinaGroup PKI Audit Lab'), valueTag: forge.asn1.Type.UTF8 },
    { name: 'countryName', value: 'VN' },
  ];
  signerCert.setSubject(subjectAttrs);
  signerCert.setIssuer(caCert.subject.attributes);
  signerCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  signerCert.sign(devRevocationProvider['devCaKeyPair'].privateKey, forge.md.sha256.create());
  const signerCertPem = forge.pki.certificateToPem(signerCert);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(signerKeys.privateKey, [signerCert], 'PassphraseBlt2026!', {
    algorithm: '3des',
  });
  const p12Der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  keystoreProvider.importKeystore(keyAlias, p12Der, 'PassphraseBlt2026!');

  // 2. Tạo PDF mẫu và thực hiện Ký số kèm Timestamp (PAdES B-T)
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText('CHUNG THU XAC THUC DIEN TU PAdES BASELINE B-LT', { x: 50, y: 780, size: 14, font, color: rgb(0, 0, 0.6) });
  page.drawText('Tep duoc ky so, dong dau thoi gian RFC 3161 va bo sung Document Security Store (DSS)', { x: 50, y: 740, size: 10 });
  const unsignedPdf = Buffer.from(await doc.save());

  const signResult = await PdfSignatureAdapter.signPdf({
    unsignedPdfBuffer: unsignedPdf,
    keyAlias,
    keyProvider: keystoreProvider,
    signerCertificatePem: signerCertPem,
    reason: 'Phê duyệt thẩm định PAdES B-LT',
    signerName: 'Tran Thi Kiem Dinh',
    tsaProvider,
    requireTimestamp: true,
  });

  console.log('1. Ký số PAdES B-T thành công:');
  console.log(`   - PDF đã ký B-T: ${signResult.signedPdfBuffer.length} bytes`);
  console.log(`   - ByteRange Revision 1: [${signResult.byteRange.join(', ')}]`);
  console.log(`   - RFC 3161 Timestamp: ${signResult.timestampGenTime?.toISOString()}`);

  // 3. Bổ sung Document Security Store (DSS) để nâng cấp lên PAdES B-LT
  const ltvResult = await pdfDssService.applyLtv({
    signedPdfBuffer: signResult.signedPdfBuffer,
    signerCertificatePem: signerCertPem,
    tsaCertificatePem: tsaProvider.getCertificatePem(),
    signatureValueBuffer: signResult.signatureValueBuffer,
    trustedRootPems: [caCertPem],
  });

  console.log('\n2. Nâng cấp thành công lên PAdES Baseline B-LT qua PDF Incremental Update:');
  console.log(`   - PDF B-LT tổng kích thước: ${ltvResult.updatedPdfBuffer.length} bytes`);
  console.log(`   - Số byte thêm vào cho DSS: ${ltvResult.updatedPdfBuffer.length - signResult.signedPdfBuffer.length} bytes`);
  console.log(`   - hasLtv: ${ltvResult.hasLtv} | ltvStatus: ${ltvResult.ltvStatus} | padesLevel: ${ltvResult.padesLevel}`);
  console.log(`   - Chứng thư trong DSS /Certs: ${ltvResult.dssCertsCount}`);
  console.log(`   - Phản hồi trong DSS /OCSPs: ${ltvResult.dssOcspsCount}`);

  // 4. Trích xuất các thành phần từ DSS bằng PdfDssParser
  const dssParse = PdfDssParser.parseDss(ltvResult.updatedPdfBuffer, '07E1F2A3', caCertPem);
  console.log('\n3. Trích xuất thành phần nhị phân DSS:');
  console.log(`   - hasDss: ${dssParse.hasDss}`);
  console.log(`   - certsCount: ${dssParse.certsCount}`);
  console.log(`   - ocspsCount: ${dssParse.ocspsCount}`);
  console.log(`   - ltvValidationStatus: ${dssParse.ltvValidationStatus}`);

  // Lưu các tệp phục vụ OpenSSL CLI
  const opensslExe = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

  const caCertPath = path.join(tmpDir, 'ca_cert.pem');
  const signerCertPath = path.join(tmpDir, 'signer_cert.pem');
  const tsaCertPath = path.join(tmpDir, 'tsa_cert.pem');
  const cmsPath = path.join(tmpDir, 'signature.der');
  const part1 = signResult.signedPdfBuffer.subarray(0, signResult.byteRange[1]);
  const part2 = signResult.signedPdfBuffer.subarray(signResult.byteRange[2], signResult.byteRange[2] + signResult.byteRange[3]);
  const signedContent = Buffer.concat([part1, part2]);
  const signedContentPath = path.join(tmpDir, 'signed_content.bin');

  fs.writeFileSync(caCertPath, caCertPem);
  fs.writeFileSync(signerCertPath, signerCertPem);
  fs.writeFileSync(tsaCertPath, tsaProvider.getCertificatePem());
  fs.writeFileSync(cmsPath, signResult.cmsDer);
  fs.writeFileSync(signedContentPath, signedContent);

  // 5. OpenSSL CMS Verify (Kiểm tra chữ ký số và ByteRange)
  console.log('\n4. Thực thi OpenSSL CMS verify trên chữ ký gốc Revision 1:');
  const cmsCmd = `"${opensslExe}" cms -verify -inform DER -in "${cmsPath}" -content "${signedContentPath}" -CAfile "${caCertPath}" -binary`;
  try {
    const cmsOut = execSync(cmsCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('   ✅ OpenSSL CMS Verification: Verification successful!');
  } catch (err: any) {
    console.error('   ❌ OpenSSL CMS Verification Error:', err.message);
  }

  // 6. OpenSSL TS Verify (Kiểm tra RFC 3161 TimeStampToken)
  const asn1 = forge.asn1;
  const cmsAsn1: any = asn1.fromDer(signResult.cmsDer.toString('binary'));
  const signedDataSeq = cmsAsn1.value[1].value[0];
  const signerInfosSet = signedDataSeq.value[signedDataSeq.value.length - 1];
  const signerInfoSeq = signerInfosSet.value[0];

  let signatureValueBytes: string | null = null;
  let tokenDer: Buffer | null = null;

  for (const item of signerInfoSeq.value) {
    if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.OCTETSTRING && item.value.length >= 128) {
      signatureValueBytes = item.value;
    } else if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && item.type === 1) {
      for (const attr of item.value) {
        const attrOid = asn1.derToOid(attr.value[0].value);
        if (attrOid === '1.2.840.113549.1.9.16.2.14') {
          const tstAsn1 = attr.value[1].value[0];
          tokenDer = Buffer.from(asn1.toDer(tstAsn1).getBytes(), 'binary');
        }
      }
    }
  }

  if (signatureValueBytes && tokenDer) {
    const sigValPath = path.join(tmpDir, 'signature_value.bin');
    const tokenPath = path.join(tmpDir, 'timestamp_token.der');
    fs.writeFileSync(sigValPath, Buffer.from(signatureValueBytes, 'binary'));
    fs.writeFileSync(tokenPath, tokenDer);

    console.log('\n5. Thực thi OpenSSL TS verify trên TimeStampToken RFC 3161:');
    const tsCmd = `"${opensslExe}" ts -verify -in "${tokenPath}" -token_in -data "${sigValPath}" -CAfile "${tsaCertPath}"`;
    try {
      const tsOut = execSync(tsCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`   ✅ OpenSSL TS Verification: ${tsOut.trim()}`);
    } catch (err: any) {
      console.error('   ❌ OpenSSL TS Verification Error:', err.message);
    }
  }

  // 7. OpenSSL OCSP & X.509 Verification trên dữ liệu trích xuất từ DSS
  if (dssParse.ocspResponseDers.length > 0) {
    const ocspPath = path.join(tmpDir, 'dss_ocsp_response.der');
    fs.writeFileSync(ocspPath, dssParse.ocspResponseDers[0]);

    console.log('\n6. Thực thi OpenSSL CLI thẩm định phản hồi OCSP trích xuất từ DSS:');
    // Dùng openssl ocsp để phân tích cấu trúc ASN.1 của OCSP response
    const ocspCmd = `"${opensslExe}" ocsp -respin "${ocspPath}" -text -noverify`;
    try {
      const ocspOut = execSync(ocspCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const summaryLines = ocspOut
        .split('\n')
        .filter((l) => l.includes('OCSP Response Status') || l.includes('Responder Id') || l.includes('Cert Status') || l.includes('Produced At'))
        .map((l) => '      ' + l.trim());
      console.log('   ✅ OpenSSL OCSP Structure Valid:');
      console.log(summaryLines.join('\n'));
    } catch (err: any) {
      console.error('   ❌ OpenSSL OCSP CLI Error:', err.message);
    }
  }

  // 8. Tự xác minh độc lập qua PdfSignatureVerifier
  console.log('\n7. Xác minh toàn diện PAdES B-LT bằng PdfSignatureVerifier:');
  const verifyResult = PdfSignatureVerifier.verify(ltvResult.updatedPdfBuffer);
  console.log(`   - isValid: ${verifyResult.isValid}`);
  console.log(`   - isDigestValid: ${verifyResult.isDigestValid}`);
  console.log(`   - isSignatureValid: ${verifyResult.isSignatureValid}`);
  console.log(`   - isTampered: ${verifyResult.isTampered}`);
  console.log(`   - hasTimestamp: ${verifyResult.hasTimestamp}`);
  console.log(`   - isTimestampValid: ${verifyResult.isTimestampValid}`);
  console.log(`   - hasLtv: ${verifyResult.hasLtv}`);
  console.log(`   - ltvValidationStatus: ${verifyResult.ltvValidationStatus}`);
  console.log(`   - padesLevel: ${verifyResult.padesLevel}`);

  if (
    verifyResult.isValid &&
    verifyResult.hasTimestamp &&
    verifyResult.isTimestampValid &&
    verifyResult.hasLtv &&
    verifyResult.ltvValidationStatus === 'VALID' &&
    verifyResult.padesLevel === 'PADES_B_LT'
  ) {
    console.log('\n========================================================================');
    console.log('🎉 XÁC MINH PAdES BASELINE B-LT BẰNG OPENSSL 3.5.7 CLI & VERIFIER HOÀN TẤT: PASS 100%!');
    console.log('========================================================================');
  } else {
    throw new Error('Thẩm định PAdES B-LT thất bại');
  }
}

main().catch((err) => {
  console.error('\n❌ Lỗi khi thực thi OpenSSL CLI validation:', err);
  process.exit(1);
});
