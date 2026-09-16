# Báo Cáo Kỹ Thuật: Phân Tích & Giải Mã API Từ Vựng Luyentu.com

> **Tóm tắt:** Tài liệu này tổng hợp toàn bộ phân tích kỹ thuật chính xác 100% về cơ chế hoạt động của API từ vựng trên `luyentu.com`, bao gồm: phân tích Request Headers, cơ chế xác thực JWT, cơ chế Anti-Scraping (`x-app-token`), và thuật toán mã hóa/giải mã dữ liệu AES-CBC 256-bit được trích xuất từ source JavaScript thực tế.

---

## 1. Tổng Quan Endpoint

* **URL Mục Tiêu:**  
  `GET https://luyentu.com/word-sets/{wordSetId}/vocabularies`
* **Ví dụ cURL:**  
  `https://luyentu.com/word-sets/33e39a24-3d6d-4574-bb97-8e043739da22/vocabularies`
* **Mục đích:**  
  Lấy danh sách các từ vựng thuộc về một bộ từ cụ thể (dạng UUID) trong lộ trình (ví dụ: TOEIC 0 - 500).
* **Dữ liệu hiển thị trên giao diện:**  
  Từ vựng (`term`), Phiên âm (`pronunciation`), Nghĩa tiếng Việt (`meaning`), Loại từ (`partOfSpeech`), Câu ví dụ (`example`), File phát âm (`audio`).

---

## 2. Phân Tích Headers & Cơ Chế Bảo Vệ Request

### 2.1. Authentication Header (JWT Token)
* **Header:** `Authorization: Bearer <JWT>`
* **Cấu trúc Payload JWT giải mã:**
  ```json
  {
    "userId": 324335,
    "email": "vudat0292003@gmail.com",
    "iat": 1789442162,
    "exp": 1789443062
  }
  ```
* **Thời gian sống (TTL):**  
  `exp - iat = 900 giây` = **15 phút**.
* **Đặc điểm:** Token hết hạn rất nhanh. Sau 15 phút, server sẽ từ chối request với mã lỗi `401 Unauthorized`. Frontend sử dụng endpoint `POST /auth/refresh` kèm `refreshToken` để cấp lại token mới.

---

### 2.2. ETag Cache Header (`if-none-match`) — Bẫy Body Rỗng
* **Header:** `if-none-match: W/"24da-y62S4HTqvCvnCESsR01lpMEQyzk"`
* **Cơ chế:** Khi client gửi header này, nếu dữ liệu trên server chưa thay đổi, server sẽ trả về `HTTP 304 Not Modified` với **Body rỗng**.
* **Xử lý:** Khi crawl hoặc test curl thủ công, **bắt buộc phải bỏ header này** để server luôn trả về `HTTP 200 OK` kèm full dữ liệu.

---

### 2.3. Anti-Scraping Header (`x-app-token`)
* **Header:** `x-app-token: 1789442304180.2bdef9ed131b8751`
* **Thuật toán sinh token (Trích xuất từ `index.5qZpqjYC.js`):**
  * Secret tĩnh: `"luyentu-anti-scrape-2026"`
  * Timestamp: `ts = Date.now().toString()`
  * Tạo chữ ký HMAC: `sign = HMAC-SHA256(data=ts, key="luyentu-anti-scrape-2026")`
  * Lấy **16 ký tự Hex đầu tiên** của `sign`.
  * Chuỗi token hoàn chỉnh: `<timestamp>.<16_hex_chars>`.

---

### 2.4. Headers Thừa / Không Cần Thiết
* **Cookie `_ga`, `_ga_E8X6S8BDQ4`:** Cookie của Google Analytics, hoàn toàn không cần thiết cho API backend.
* **Client Hints (`sec-ch-ua-*`, `sec-fetch-*`, `priority`):** Header mặc định của trình duyệt Chrome, có thể lược bỏ.

---

## 3. Cơ Chế Mã Hóa Dữ Liệu (Payload Encryption)

Backend của Luyện Từ **không trả về văn bản thô (plaintext)** cho các trường từ vựng nhằm ngăn chặn việc crawl nội dung. Thay vào đó, dữ liệu được mã hoá bằng **AES-CBC (256-bit)** với cơ chế đổi Key động theo từng block 10 phút.

### 3.1. Cấu Trúc Object Bị Mã Hóa Nhận Từ Server
Khi gọi API, mỗi từ vựng trả về có dạng:
```json
{
  "id": "33e39a24-sample",
  "_enc": true,
  "_ts": 1789443395369,
  "term": "2e3366c75ba593f66ef2d9e194a26b6e:pIlQrBfJ7eyxWXTWgq5cEg==",
  "meaning": "1ad7941a33af8ef8e2929ad8d8ee8f83:HQiPPVqqU1p05Htp/5+z/6wDma8Vn2ZXXUkMsV78Pb79Ki0pmgG2f/Nl3W1eqmIn",
  "pronunciation": "c1a4e30bf033998db1a3f33e14a54739:YF0qfdtcAld6WWlwXpSAmw==",
  "example": "e41d0c402d31d91c8e1653a4ef6813a7:WwuGq6ocmR1NY4sE2aO9evrtxZctntQc4VqLSl1++NzPVNtbFC7hffhjHkJYbjxUjn1zdWV5FGoWyaLYvJAPGw=="
}
```

* `_enc: true`: Cờ đánh dấu dữ liệu đang bị mã hóa.
* `_ts`: Timestamp tính bằng milliseconds tại thời điểm backend sinh dữ liệu.
* Các trường bị mã hóa: `term`, `meaning`, `pronunciation`, `example`, `notes`.
* Định dạng chuỗi mã hóa: `<HEX_IV>:<BASE64_CIPHERTEXT>`.

---

### 3.2. Thuật Toán Sinh Khóa & Giải Mã (Trích Xuất Từ Source Code)

Source code gốc trong bundle:
```javascript
VX = "luyentu-vocab-enc-key-2026-secure";

async function eA(e) {
  const t = Math.floor(e / 6e5), // 600.000 ms = 10 phút
        n = `${VX}:${t}`,
        o = new TextEncoder().encode(n);
  return await crypto.subtle.digest("SHA-256", o);
}

async function pr(e, t) {
  try {
    const [n, r] = e.split(":");
    if (!n || !r) return e;
    const o = new Uint8Array(n.match(/.{1,2}/g).map(l => parseInt(l, 16))), // Hex IV (16 bytes)
          i = Uint8Array.from(atob(r), l => l.charCodeAt(0)), // Base64 Ciphertext
          s = await crypto.subtle.importKey("raw", t, {name: "AES-CBC"}, false, ["decrypt"]),
          a = await crypto.subtle.decrypt({name: "AES-CBC", iv: o}, s, i);
    return new TextDecoder().decode(a);
  } catch {
    return e;
  }
}
```

**Quy trình giải mã từng bước:**
1. **Lấy Khóa AES (256-bit):**
   * Lấy `timeBlock = Math.floor(_ts / 600000)`.
   * Tạo chuỗi: `"luyentu-vocab-enc-key-2026-secure:" + timeBlock`.
   * Băm chuỗi trên bằng `SHA-256` để ra khóa 32 bytes (256 bits).
2. **Giải mã từng trường:**
   * Tách trường theo dấu hai chấm `:` thành `[iv_hex, data_base64]`.
   * Chuyển `iv_hex` thành mảng bytes 16 phần tử.
   * Decode Base64 `data_base64` thành bytes.
   * Dùng thuật toán `AES-256-CBC` kết hợp IV và Khóa để giải mã.
   * Bỏ padding PKCS7 và decode UTF-8 ra chuỗi gốc.

---

## 4. Kết Quả Kiểm Chứng Thực Nghiệm

Đã chạy test mô phỏng thực tế quá trình mã hóa & giải mã:

| Trường | Sau Khi Giải Mã Hoàn Chỉnh |
| :--- | :--- |
| **term** | `provision` |
| **pronunciation** | `/prə'vɪʒn/` |
| **meaning** | `điều khoản, sự cung cấp` |
| **example** | `The father made provision for his children through his will.` |

Khớp 100% với giao diện người dùng hiển thị trên web.

---

## 5. Source Code Hoàn Chỉnh

### 5.1. Triển khai bằng Node.js (Khuyên dùng - Có sẵn thư viện `crypto`)

```javascript
const crypto = require('crypto');

const SECRET_KEY = 'luyentu-vocab-enc-key-2026-secure';

/**
 * Tạo AES-256 key từ timestamp
 */
function getAesKey(ts) {
  const timeBlock = Math.floor(ts / 600000);
  return crypto.createHash('sha256').update(`${SECRET_KEY}:${timeBlock}`).digest();
}

/**
 * Giải mã một trường văn bản
 */
function decryptField(text, key) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;
  try {
    const [ivHex, b64Data] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(b64Data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    return text;
  }
}

/**
 * Giải mã toàn bộ mảng từ vựng nhận từ API
 */
function decryptVocabularies(data) {
  if (!Array.isArray(data) || data.length === 0 || !data[0]?._enc) return data;
  const key = getAesKey(data[0]._ts);

  return data.map(item => {
    if (!item._enc) return item;
    const res = { ...item };
    ['term', 'meaning', 'pronunciation', 'example', 'notes'].forEach(field => {
      if (res[field]) res[field] = decryptField(res[field], key);
    });
    delete res._enc;
    delete res._ts;
    return res;
  });
}

module.exports = { decryptVocabularies, decryptField, getAesKey };
```

---

### 5.2. Triển khai bằng Python (Cần `pip install pycryptodome`)

```python
import hashlib
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

SECRET_KEY = "luyentu-vocab-enc-key-2026-secure"

def get_aes_key(ts: int) -> bytes:
    time_block = ts // 600000
    key_str = f"{SECRET_KEY}:{time_block}"
    return hashlib.sha256(key_str.encode('utf-8')).digest()

def decrypt_field(cipher_text: str, key: bytes) -> str:
    if not cipher_text or ":" not in cipher_text:
        return cipher_text
    try:
        iv_hex, b64_data = cipher_text.split(":", 1)
        iv = bytes.fromhex(iv_hex)
        encrypted_bytes = base64.b64decode(b64_data)
        
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = unpad(cipher.decrypt(encrypted_bytes), AES.block_size)
        return decrypted.decode('utf-8')
    except Exception:
        return cipher_text

def decrypt_vocabularies(data_list: list) -> list:
    if not isinstance(data_list, list) or len(data_list) == 0 or not data_list[0].get("_enc"):
        return data_list
    
    key = get_aes_key(data_list[0].get("_ts", 0))
    fields = ["term", "meaning", "pronunciation", "example", "notes"]
    
    result = []
    for item in data_list:
        if not item.get("_enc"):
            result.append(item)
            continue
        decrypted_item = item.copy()
        for field in fields:
            if field in decrypted_item and isinstance(decrypted_item[field], str):
                decrypted_item[field] = decrypt_field(decrypted_item[field], key)
        decrypted_item.pop("_enc", None)
        decrypted_item.pop("_ts", None)
        result.append(decrypted_item)
        
    return result
```
