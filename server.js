
import express from 'express';
import cors from 'cors';
import multer from 'multer';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

app.post('/submit', upload.array('photos', 5), async (req, res) => {
  try {
    const { 업체명, 주소지, 전화번호, SUT_할인율, 네이버지도링크, 업체소개 } = req.body;
    if (!업체명 || !주소지 || !전화번호 || !SUT_할인율 || !네이버지도링크 || !업체소개) {
      return res.status(400).json({ ok: false, message: "필수 항목 누락" });
    }
    return res.json({ ok: true, message: "완료" });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "server error" });
  }
});

app.listen(process.env.PORT || 10000, () => console.log("Server Running"));
