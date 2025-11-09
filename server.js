/**
 * server.js
 * - Express API: POST /submit
 * - Multer (memory storage) -> sharp 최적화 -> S3 업로드 -> presigned URL 생성 -> Nodemailer 발송
 *
 * 사용법:
 *   npm install
 *   환경변수 셋업 (.env)
 *   node server.js
 *
 * 주의: .env 파일에 민감정보(키)를 저장하지 않도록 주의하세요.
 */

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

// 보안/리미트 권장
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors({ origin: true })); // 필요시 특정 origin으로 제한

// Multer (메모리 저장)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 파일당 최대 15MB (환경에 맞게 조정)
    files: 5,
  }
});

// AWS S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// 유틸: 안전한 파일명 생성
function randomName(orig){
  const ext = path.extname(orig) || '.jpg';
  const id = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}_${id}${ext}`;
}

// 이미지 최적화: sharp 사용
async function optimizeBuffer(buffer, maxDim = 800, quality = 60){
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
}

// S3 업로드
async function uploadToS3(buffer, bucket, key, contentType='image/jpeg'){
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

// presigned URL 생성 (GetObjectCommand)
async function createPresignedUrl(bucket, key, expiresSeconds = 60*60*24){
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3, cmd, { expiresIn: expiresSeconds });
  return url;
}

// 이메일 전송자 설정 (Nodemailer)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// health check
app.get('/', (req, res) => res.send('업체 접수 서버 실행 중'));

// POST /submit
app.post('/submit', upload.array('photos', 5), async (req, res) => {
  try {
    // 필수 항목 검사 (폼 필드 명은 프론트와 일치해야 함)
    const { 업체명, 주소지, 전화번호, SUT_할인율, 네이버지도링크, 업체소개, 홍보태그 } = req.body;
    if(!업체명 || !주소지 || !전화번호 || !SUT_할인율 || !네이버지도링크 || !업체소개){
      return res.status(400).json({ ok:false, message:'필수 항목 누락' });
    }

    const files = req.files || [];
    const bucket = process.env.S3_BUCKET;
    const uploaded = [];

    // 파일 처리 루프
    for(const f of files){
      try {
        // 공격적 최적화 시도: 800px, quality 60
        let buf = await optimizeBuffer(f.buffer, 800, 60);

        // 추가 안전장치: 여전히 크면 재압축 (quality 45)
        if(buf.length > (2 * 1024 * 1024)){
          buf = await optimizeBuffer(f.buffer, 800, 45);
        }

        const key = `uploads/${randomName(f.originalname)}`;
        await uploadToS3(buf, bucket, key);
        const url = await createPresignedUrl(bucket, key, 60*60*24); // 24시간
        uploaded.push({ key, url, size: buf.length });
      } catch(errFile){
        console.warn('파일 처리 실패(무시):', f.originalname, errFile.message);
        // 실패한 파일은 무시(운영정책에 따라 다르게 처리할 수 있음)
      }
    }

    // 이메일 본문 작성 (HTML)
    let html = `<h2>새 업체 접수</h2>
      <ul>
        <li><strong>업체명:</strong> ${업체명}</li>
        <li><strong>주소지:</strong> ${주소지}</li>
        <li><strong>전화번호:</strong> ${전화번호}</li>
        <li><strong>SUT 할인율:</strong> ${SUT_할인율}</li>
        <li><strong>네이버지도 링크:</strong> <a href="${네이버지도링크}">${네이버지도링크}</a></li>
        <li><strong>홍보태그:</strong> ${홍보태그 || '-'}</li>
      </ul>
      <h3>업체 소개</h3>
      <p>${업체소개.replace(/\n/g,'<br/>')}</p>
      <hr/>
    `;

    if(uploaded.length){
      html += `<h3>첨부 이미지 (${uploaded.length})</h3><ul>`;
      for(const u of uploaded){
        html += `<li><a href="${u.url}">${u.key} (${Math.round(u.size/1024)} KB)</a></li>`;
      }
      html += `</ul>`;
    } else {
      html += `<p>첨부 이미지 없음 또는 업로드 실패</p>`;
    }

    // 메일 발송
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.RECEIVER_EMAIL,
      subject: `[업체 접수] ${업체명}`,
      html
    });

    return res.json({ ok:true, message:'접수 완료. 이메일 발송됨.' });
  } catch(err){
    console.error('submit error:', err);
    return res.status(500).json({ ok:false, message: err.message || '서버 오류' });
  }
});

// 포트
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
