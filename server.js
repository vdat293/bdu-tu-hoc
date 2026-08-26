import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BDU_BASE_URL = 'https://sv.bdu.edu.vn/public/api';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. API Proxy: Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        result: false,
        message: 'Vui lòng nhập đầy đủ mã số sinh viên và mật khẩu.'
      });
    }

    const params = new URLSearchParams({
      grant_type: 'password',
      username: username.trim(),
      password: password
    });

    const bduRes = await fetch(`${BDU_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await bduRes.json();

    if (!data.access_token) {
      return res.status(bduRes.status === 200 ? 401 : bduRes.status).json({
        result: false,
        message: data.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản hoặc mật khẩu.'
      });
    }

    return res.json({
      result: true,
      token: data.access_token,
      name: data.name,
      mssv: data.userName,
      email: data.principal,
      roles: data.roles,
      expires_in: data.expires_in
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      result: false,
      message: 'Không thể kết nối đến máy chủ trường BDU. Vui lòng thử lại sau.'
    });
  }
});

// 2. API Proxy: Get Grades
app.post('/api/grades', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        result: false,
        message: 'Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.'
      });
    }

    const bduRes = await fetch(`${BDU_BASE_URL}/srm/w-locdsdiemsinhvien?hien_thi_mon_theo_hkdk=false`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const data = await bduRes.json();

    if (!data.result && data.code !== 200) {
      if (data.code === 400 || data.code === 401 || data.code === 402) {
        return res.status(401).json({
          result: false,
          code: data.code,
          message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        });
      }
      return res.status(400).json({
        result: false,
        message: data.message || 'Không thể lấy dữ liệu bảng điểm.'
      });
    }

    return res.json(data);
  } catch (error) {
    console.error('Get grades error:', error);
    return res.status(500).json({
      result: false,
      message: 'Không thể tải bảng điểm từ BDU. Vui lòng thử lại.'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🌐 BDU Grade Viewer Server đang chạy tại: http://localhost:${PORT}`);
});
