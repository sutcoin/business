// server.js (수정본)
// - CORS 허용(app.use(cors()))
// - 요청 바디/파일 디버그 로그
// - 이미지 최적화(sharp), S3 업로드, presigned URL 생성
// - Nodemailer로 메일 전송
// - 자세한 에러 로깅과 안전한 실패 처리
// 필요 패키지: express, multer, sharp, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, nodemailer, dotenv, cors

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();

// --------------- MIDDLEWARE ---------------
// 보편적 CORS 허용 (개발/테스트용). 운영 시 특정 origin만 허용하세요.
app.use(cors());
app.options('*', cors());

// 기본 바디 파서 (form-data는 multer가 처리)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Multer (메모리 저장)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 파일당 15MB
    files: 5,
  }
});

// --------------- AWS S3 클라이언트 ---------------
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

// --------------- 유틸 ---------------
function randomName(orig) {
  const ext = path.extname(orig) || '.jpg';
  const id = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}_${id}${ext}`;
}

// 이미지 최적화: 최대 한 변 800px, JPEG 압축
async function optimizeBuffer(buffer, maxDim = 800, quality = 65) {
  try {
    const img = sharp(buffer).rotate();
    const meta = await img.metadata().catch(()=>({ width: maxDim, height: maxDim }));
    const maxSide = Math.max(meta.width || maxDim, meta.height || maxDim);
    const ratio = maxSide > maxDim ? (maxDim / maxSide) : 1;
    const width = Math.round((meta.width || maxDim) * ratio);
    const height = Math.round((meta.height || maxDim) * ratio);

    return await img
      .resize(width, height, { fit: 'inside' })
      .jpeg({ quality: quality, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    // 최적화 실패 시 원본 반환(그래도 업로드 시도)
    console.warn('optimizeBuffer failed, returning original buffer:', e && e.message);
    return buffer;
  }
}

async function uploadToS3(buffer, bucket, key, contentType='image/jpeg') {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: 'private'
  });
  await s3.send(cmd);
  return { bucket, key };
}

async function createPresignedUrl(bucket, key, expiresSeconds = 60*60*24) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3, cmd, { expiresIn: expiresSeconds });
  return url;
}

// --------------- Nodemailer 설정 ---------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined,
  // TLS options can be added if needed
});

// --------------- 헬스 체크 ---------------
app.get('/', (req, res) => res.send('업체 접수 서버 실행 중'));

// --------------- POST /submit ---------------
app.post('/submit', upload.array('photos', 5), async (req, res) => {
  try {
    // 디버그 로그: 누락 진단에 도움
    console.log('--- NEW SUBMIT ---');
    console.log('Headers:', {
      origin: req.headers.origin,
      referer: req.headers.referer,
      host: req.headers.host
    });
    console.log('DEBUG req.body:', req.body);
    console.log('DEBUG req.files:', (req.files || []).map(f => ({ originalname: f.originalname, size: f.size })));

    // 필드 추출 (서버와 프론트의 name 값이 정확히 일치해야 함)
    const 업체명 = req.body['업체명'];
    const 주소지 = req.body['주소지'];
    const 전화번호 = req.body['전화번호'];
    const SUT_할인율 = req.body['SUT_할인율'];
    const 네이버지도링크 = req.body['네이버지도링크'];
    const 업체소개 = req.body['업체소개'];
    const 홍보태그 = req.body['홍보태그'] || '';

    // 필수 항목 검사
    if (!업체명 || !주소지 || !전화번호 || !SUT_할인율 || !네이버지도링크 || !업체소개) {
      console.warn('Missing required fields:', {
        업체명, 주소지, 전화번호, SUT_할인율, 네이버지도링크, 업체소개
      });
      return res.status(400).json({ ok: false, message: '필수 항목 누락' });
    }

    // 파일 처리
    const files = req.files || [];
    const bucket = process.env.S3_BUCKET;
    const uploaded = [];

    if (files.length && !bucket) {
      console.warn('S3_BUCKET not configured but files were uploaded. Skipping file upload.');
    }

    for (const f of files) {
      try {
        let buf = await optimizeBuffer(f.buffer, 800, 60);
        // 안전장치: 최적화 후에도 크면 재압축
        if (buf.length > (2 * 1024 * 1024)) {
          buf = await optimizeBuffer(f.buffer, 800, 45);
        }
        const key = `uploads/${randomName(f.originalname)}`;
        if (bucket) {
          await uploadToS3(buf, bucket, key);
          const url = await createPresignedUrl(bucket, key, 60*60*24);
          uploaded.push({ key, url, size: buf.length });
        } else {
          // S3 미설정 시 업로드를 건너뛰고 로컬적으로만 수집(디버그용)
          uploaded.push({ key, url: null, size: buf.length, note: 'S3_BUCKET not configured' });
        }
      } catch (errFile) {
        console.warn('파일 처리 실패(무시):', f.originalname, errFile && errFile.message);
      }
    }

    // 이메일 본문 작성
    let html = `<h2>새 업체 접수</h2>
      <ul>
        <li><strong>업체명:</strong> ${escapeHtml(업체명)}</li>
        <li><strong>주소지:</strong> ${escapeHtml(주소지)}</li>
        <li><strong>전화번호:</strong> ${escapeHtml(전화번호)}</li>
        <li><strong>SUT 할인율:</strong> ${escapeHtml(SUT_할인율)}</li>
        <li><strong>네이버지도 링크:</strong> <a href="${escapeAttribute(네이버지도링크)}">${escapeHtml(네이버지도링크)}</a></li>
        <li><strong>홍보태그:</strong> ${escapeHtml(홍보태그)}</li>
      </ul>
      <h3>업체 소개</h3>
      <p>${escapeHtml(업체소개).replace(/\\n/g,'<br/>')}</p>
      <hr/>`;

    if (uploaded.length) {
      html += `<h3>첨부 이미지 (${uploaded.length})</h3><ul>`;
      for (const u of uploaded) {
        if (u.url) {
          html += `<li><a href="${u.url}">${escapeHtml(u.key)} (${Math.round(u.size/1024)} KB)</a></li>`;
        } else {
          html += `<li>${escapeHtml(u.key)} (${Math.round(u.size/1024)} KB) — (no S3)</li>`;
        }
      }
      html += `</ul>`;
    } else {
      html += `<p>첨부 이미지 없음 또는 업로드 실패</p>`;
    }

    // 메일 발송
    if (!transporter) {
      console.warn('transporter not configured');
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || `no-reply@${req.headers.host || 'example.com'}`,
      to: process.env.RECEIVER_EMAIL,
      subject: `[업체 접수] ${업체명}`,
      html
    };

    // 메일 전송 (에러가 나도 클라이언트에게는 접수 성공으로 안내할 수 있음 — 정책에 따라 변경)
    try {
      await transporter.sendMail(mailOptions);
      console.log('Mail sent to', process.env.RECEIVER_EMAIL);
    } catch (mailErr) {
      console.error('Mail send failed:', mailErr && mailErr.message);
      // 이메일 실패는 운영상 문제이므로 200 대신 500으로 반환할 수도 있음.
      // 여기서는 이메일 실패를 알려주되, 접수 자체는 성공한 것으로 처리합니다.
      return res.status(500).json({ ok: false, message: '이메일 전송에 실패했습니다. 관리자에게 문의하세요.' });
    }

    return res.json({ ok: true, message: '접수 완료. 이메일 발송됨.' });

  } catch (err) {
    console.error('submit error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: err && err.message ? err.message : '서버 오류' });
  }
});

// --------------- 헬퍼: 간단한 HTML 이스케이프 ---------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttribute(s){
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// --------------- 서버 시작 ---------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
