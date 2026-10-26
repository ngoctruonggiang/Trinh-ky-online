import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';
import { DevTestTsaProvider } from '../src/modules/signing/timestamp/dev-test-tsa.provider.js';
import { PdfSignatureAdapter } from '../src/modules/signing/engine/pdf-signature.adapter.js';
import { PdfSignatureVerifier } from '../src/modules/signing/engine/pdf-signature.verifier.js';
import * as forge from 'node-forge';

async function main() {
  console.log('=== TIẾN HÀNH THẨM ĐỊNH MẬT MÃ ĐỘC LẬP BẰNG OPENSSL 3.5.7 ===');

  const tmpDir = path.join(process.cwd(), 'storage', 'openssl_pades_verify');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. Tạo Keystore và TSA
  const keystoreProvider = new DevLocalKeystoreProvider();
  const generatedKey = DevKeystoreGenerator.generateSelfSignedKeystore({
    commonName: 'Nguyễn Văn Kiểm Toán',
    organizationName: 'Tập đoàn Kiểm định An toàn Thông tin',
  });
  const keyAlias = `audit_key_${Date.now()}`;
  keystoreProvider.importKeystore(keyAlias, generatedKey.p12Buffer);

  const tsaProvider = new DevTestTsaProvider({
    commonName: 'Trinh Ky Online Trusted TSA 2026',
    organizationName: 'Trinh Ky Online PKI Root Lab',
  });

  // 2. Tạo PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([595, 842]);
  page.drawText('CHUNG THU GIAO DICH DIEN TU SO 2026', { x: 50, y: 800, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('Van ban duoc ky so va dong dau thoi gian tin cay RFC 3161', { x: 50, y: 760, size: 12, font });
  const unsignedPdf = Buffer.from(await pdfDoc.save());

  // 3. Ký số PDF kèm RFC 3161 TSA
  const signResult = await PdfSignatureAdapter.signPdf({
    unsignedPdfBuffer: unsignedPdf,
    keyAlias,
    keyProvider: keystoreProvider,
    signerCertificatePem: generatedKey.certificatePem,
    reason: 'Thẩm định chữ ký số PAdES B-T',
    signerName: 'Nguyễn Văn Kiểm Toán',
    tsaProvider,
    requireTimestamp: true,
  });

  console.log('1. Ký PDF kèm TSA thành công:');
  console.log(`   - Kích thước PDF đã ký: ${signResult.signedPdfBuffer.length} bytes`);
  console.log(`   - ByteRange: [${signResult.byteRange.join(', ')}]`);
  console.log(`   - Mã băm signedPdfHash: ${signResult.signedPdfHash}`);
  console.log(`   - hasTimestamp: ${signResult.hasTimestamp}`);
  console.log(`   - genTime: ${signResult.timestampGenTime?.toISOString()}`);
  console.log(`   - tsaSubject: ${signResult.tsaSubjectDn}`);

  // 4. Tự xác minh nội bộ qua PdfSignatureVerifier
  const internalVerify = PdfSignatureVerifier.verify(signResult.signedPdfBuffer);
  console.log('\n2. Kết quả tự xác minh nội bộ qua PdfSignatureVerifier:');
  console.log(`   - isValid: ${internalVerify.isValid}`);
  console.log(`   - isTampered: ${internalVerify.isTampered}`);
  console.log(`   - isDigestValid: ${internalVerify.isDigestValid}`);
  console.log(`   - isSignatureValid: ${internalVerify.isSignatureValid}`);
  console.log(`   - hasTimestamp: ${internalVerify.hasTimestamp}`);
  console.log(`   - isTimestampValid: ${internalVerify.isTimestampValid}`);

  // 5. Trích xuất nhị phân phục vụ kiểm tra OpenSSL
  const part1 = signResult.signedPdfBuffer.subarray(0, signResult.byteRange[1]);
  const part2 = signResult.signedPdfBuffer.subarray(signResult.byteRange[2], signResult.byteRange[2] + signResult.byteRange[3]);
  const signedContent = Buffer.concat([part1, part2]);

  const signedContentPath = path.join(tmpDir, 'signed_content.bin');
  const cmsPath = path.join(tmpDir, 'signature.der');
  const signerCertPath = path.join(tmpDir, 'signer_cert.pem');
  const tsaCertPath = path.join(tmpDir, 'tsa_cert.pem');

  fs.writeFileSync(signedContentPath, signedContent);
  fs.writeFileSync(cmsPath, signResult.cmsDer);
  fs.writeFileSync(signerCertPath, generatedKey.certificatePem);
  fs.writeFileSync(tsaCertPath, tsaProvider.getCertificatePem());

  const opensslExe = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

  // 6. Chạy OpenSSL CMS verify
  console.log('\n3. Thực thi OpenSSL CMS verify trên CMS Detached:');
  const cmsCmd = `"${opensslExe}" cms -verify -inform DER -in "${cmsPath}" -content "${signedContentPath}" -CAfile "${signerCertPath}" -binary`;
  try {
    const cmsOut = execSync(cmsCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('   ✅ OpenSSL CMS Verification: Verification successful!');
  } catch (err: any) {
    console.error('   ❌ OpenSSL CMS Verification Error:', err.message);
  }

  // 7. Trích xuất TimeStampToken và Signer Signature Value từ CMS DER
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
      // unsignedAttrs
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
    const sigValBuffer = Buffer.from(signatureValueBytes, 'binary');
    const sigValPath = path.join(tmpDir, 'signature_value.bin');
    const tokenPath = path.join(tmpDir, 'timestamp_token.der');

    fs.writeFileSync(sigValPath, sigValBuffer);
    fs.writeFileSync(tokenPath, tokenDer);

    console.log('\n4. Thực thi OpenSSL TS verify trên RFC 3161 TimeStampToken:');
    const tsCmd = `"${opensslExe}" ts -verify -in "${tokenPath}" -token_in -data "${sigValPath}" -CAfile "${tsaCertPath}"`;
    try {
      const tsOut = execSync(tsCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`   ✅ OpenSSL TS Verification: ${tsOut.trim()}`);
    } catch (err: any) {
      console.error('   ❌ OpenSSL TS Verification Error:', err.message);
    }

    // In thông tin chi tiết TimeStampToken qua OpenSSL ts -reply
    console.log('\n5. Phân tích chi tiết cấu trúc TimeStampToken qua OpenSSL:');
    const tsReplyCmd = `"${opensslExe}" ts -reply -in "${tokenPath}" -token_in -text`;
    try {
      const tsReplyOut = execSync(tsReplyCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = tsReplyOut.split('\n').filter((l) => l.trim().length > 0).slice(0, 15);
      console.log(lines.map((l) => '      ' + l).join('\n'));
    } catch (err: any) {
      console.error('   ❌ OpenSSL TS Reply Error:', err.message);
    }
  }

  console.log('\n=== HOÀN TẤT THẨM ĐỊNH MẬT MÃ ĐỘC LẬP BẰNG OPENSSL 3.5.7 ===');
}

main().catch(console.error);
