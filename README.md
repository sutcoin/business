# 업체 접수: 안정적 이미지 업로드 + 이메일 전송

이 저장소는 **이미지(다수 포함) 포함 폼**을 안정적으로 처리하기 위한 풀스택 예제입니다.
- 프론트엔드: `frontend/index.html` (GitHub Pages에 올릴 수 있음)
- 백엔드: `server.js` (Express) — 이미지 최적화(sharp), S3 업로드, presigned URL 생성, Nodemailer 메일 전송

## 주요 동작
1. 사용자가 폼 제출(이미지 포함)  
2. 서버가 이미지를 `sharp`로 최적화(리사이즈/압축)  
3. 서버가 S3에 업로드 → presigned URL(기본 24시간 만료) 생성  
4. 서버가 수신자 이메일(예: `choieuisin@naver.com`)로 메일 발송 — 본문에 presigned URL 포함

---

## 파일 목록
- `server.js` — 서버 소스
- `package.json` — 설치/실행 스크립트
- `frontend/index.html` — 프론트엔드 (리포지토리 `frontend/` 폴더에 넣으세요)
- `.env.example` — 환경 변수 예시 (복사해서 `.env` 생성)
- `.gitignore`

---

## 빠른 시작 (로컬)
1. Node.js 설치 (18+ 권장)
2. 레포 클론 후:
   ```bash
   npm install
   cp .env.example .env
   # .env 파일에 값 채우기 (AWS, SMTP 등)
   npm start
   ```
3. 기본 포트: `3000` (환경변수 `PORT`로 변경 가능)

---

## 배포(권장: Render)
1. GitHub에 리포지토리 업로드
2. Render (https://render.com)에서 `New → Web Service` 선택
3. GitHub 리포 연결 → 브랜치 선택
4. Build Command: npm install
   Start Command: npm start
5. Render 대시보드에서 환경변수(.env) 추가(아래 `.env.example` 참고)
6. 배포 후 표시된 https://your-app.onrender.com 를 frontend/index.html의 action에 넣어 사용

---

## 환경변수 (.env)
- `.env.example` 파일을 참고하세요. 절대 깃허브에 실제 값을 올리지 마세요.

---

## 권장 서비스
- S3: AWS S3 (파일 저장)
- SMTP: SendGrid / Mailgun / Amazon SES (신뢰성 높은 발송)
  - Gmail/Naver SMTP도 가능하나 발송량·신뢰성에서 제약)