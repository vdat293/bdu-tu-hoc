# Hạ tầng AWS cho BDU Tự Học

Thư mục này dựng và dọn hạ tầng production trên AWS bằng AWS CLI v2.
Thiết kế đầy đủ: [`docs/superpowers/specs/2026-10-13-dung-server-aws-design.md`](../docs/superpowers/specs/2026-10-13-dung-server-aws-design.md).

```
aws/
├── infra.sh                 # check | deploy | status | ssh | cleanup
├── user-data.sh             # cloud-init cho lần boot đầu (Docker, swap, user deploy)
├── cleanup.sh               # xoá sạch tài nguyên (idempotent)
├── dlm-policy.json          # chính sách snapshot EBS hằng ngày, giữ 7 bản
├── infra.state              # SINH RA lúc deploy - chứa ID tài nguyên (KHÔNG commit)
├── bdu-tu-hoc-deploy.pem    # private key SSH (KHÔNG commit)
├── known_hosts              # known_hosts riêng (KHÔNG commit)
└── cleanup-log.txt          # log của cleanup.sh (KHÔNG commit)
```

## 1. Yêu cầu

| Cần | Ghi chú |
| --- | --- |
| Bash ≥ 4 | Git Bash / WSL |
| AWS CLI v2 | đã `aws configure` / `aws sso login` với quyền EC2, IAM, DLM, SSM |
| `ssh`, `ssh-keygen`, `scp` | để vào máy và copy file |
| `cygpath` (Windows) | có sẵn trong Git Bash |

Biến môi trường:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `AWS_REGION` | `ap-southeast-1` | Region triển khai |
| `AZ` | `ap-southeast-1a` | Availability Zone của subnet |
| `APP_DIR` | `/opt/bdu-tu-hoc` | Thư mục app trên EC2 |
| `KEY_PATH` | `aws/bdu-tu-hoc-deploy.pem` | Nơi lưu private key |
| `SKIP_SNAPSHOTS` | `0` | `1` để giữ snapshot khi cleanup |

## 2. Chạy

```bash
./aws/infra.sh check      # 1. kiểm credentials + tài nguyên hiện có
./aws/infra.sh deploy     # 2. dựng hạ tầng (~3-5 phút, chờ cloud-init)
./aws/infra.sh status     #    in EIP + ID + lệnh ssh
./deploy/bootstrap-server.sh   # 3. chạy TRÊN EC2 (xem docs/deployment-runbook.md)
./aws/infra.sh ssh        #    vào máy khi cần
./aws/cleanup.sh          # 4. XOÁ SẠCH khi không dùng nữa
```

## 3. Kiến trúc dựng ra

```
VPC 10.20.0.0/16 (tag Project=bdu-tu-hoc)
└─ public subnet 10.20.1.0/24 (ap-southeast-1a)
   ├─ Internet Gateway  (0.0.0.0/0 -> IGW)   ← KHÔNG có NAT Gateway
   ├─ EC2 t3a.small / Ubuntu 24.04 / gp3 30 GB mã hoá / IMDSv2 required / swap 2 GB
   │    └─ Docker Compose: caddy · bdu-hub · postgres · bdu-notifier-bot · bdu-db-backup
   └─ Security Group: ingress 22, 80, 443 (0.0.0.0/0); egress all
                       KHÔNG mở 3000/5432
Elastic IP tĩnh gắn cố định
DLM: snapshot hằng ngày, giữ 7 bản (volume mang tag Project=bdu-tu-hoc)
```

## 4. Chi phí (giá thật `ap-southeast-1`, on-demand)

| Hạng mục | USD/tháng |
| --- | --- |
| EC2 `t3a.small` | ~17,2 |
| EBS gp3 30 GB | ~2,9 |
| Public IPv4 (Elastic IP) | ~3,65 |
| Snapshot EBS (DLM) | ~0,25 |
| **Tổng** | **~24** |

Không có NAT Gateway (tiết kiệm ~32 USD/tháng). Image được build trên GitHub
Actions nên EC2 không tốn thời gian/CPU để build.

## 5. Ghi chú vận hành

- **Không build trên EC2.** Image lấy từ GHCR theo `IMAGE_TAG`; mọi lệnh
  `docker compose up` phải kèm `--no-build` (máy 2 GB sẽ OOM nếu build).
- **Cổng 22 mở toàn cầu** nhưng chỉ nhận SSH key (password auth tắt, root tắt),
  có `fail2ban`. Cân nhắc thu hẹp khi không dùng GitHub Actions.
- **DLM snapshot không tự mất** khi xoá EC2; `cleanup.sh` xoá snapshot mang tag
  `Project=bdu-tu-hoc` trừ khi `SKIP_SNAPSHOTS=1`.
- **Không còn tài nguyên nào thì `check` phải in 0 cho mọi loại.**
- Baseline migration đã dùng cho DB production: ghi ở
  `docs/deployment-runbook.md` (mục bootstrap) sau khi chạy.

## 6. Kết quả nghiệm thu (2026-10-13)

**Mốc baseline migration:** `43` (`BDU_MIGRATION_BASELINE_THROUGH_VERSION=43`).
Bằng chứng: `fp_after(sau migrate)` == `fp_fresh(001..056)` =
`600389ca601e07ba369a1f81c5c5475208a1fd290c35df667205460b0d97d228`.

| # | Tiêu chí | Kết quả |
| --- | --- | --- |
| 1 | 5 service running (`bdu-hub`, `postgres`, `caddy`, `bdu-notifier-bot`, `bdu-db-backup`) | ĐẠT |
| 2 | `https://sv.bdu.io.vn/api/health` = 200; `/api/version` khớp `IMAGE_TAG` | ĐẠT |
| 3 | `http://` → `https://` (308); TLS hợp lệ | ĐẠT |
| 4 | WebSocket `wss://` kết nối, nhận `{"type":"hello",...}` | ĐẠT |
| 5 | Đăng nhập BDU thật | **kiểm tay** |
| 6 | `students=4956`; fingerprint DB = DB sạch | ĐẠT |
| 7 | Ảnh cũ qua `/media/r2/*` (posts, avatars, comments) đều 200 | ĐẠT |
| 8 | `db:backup` tạo dump local (9,1 MB + manifest); service backup chạy | ĐẠT |
| 9 | Cổng 3000/5432 đóng từ Internet | ĐẠT |
| 10 | Rollback: đổi `IMAGE_TAG` về tag cũ → healthy → quay lại tag hiện tại → healthy | ĐẠT |
| 11 | Bot Discord online | ĐẠT |
| 12 | `git grep -In -E '\bvps\b'` sạch ngoài hồ sơ lịch sử | ĐẠT |

**Ghi chú vận hành tại thời điểm nghiệm thu:**

- `IMAGE_TAG` đang chạy là `ee0756377a2a`, trong khi HEAD repo mới hơn
  (`a499382`): **GitHub Actions bị khoá do vấn đề billing** nên không build được
  image cho commit mới nhất; các commit sau `ee0756377a2a` chỉ đổi
  script/tài liệu/compose, **không đổi code ứng dụng**. Sửa billing xong thì
  push tiếp sẽ có image mới và `deploy.sh` kéo đúng tag mới.
- Backup đang ở **chế độ local** (`data/backups/`, ~9,1 MB/dump) + **DLM snapshot
  EBS hằng ngày**; chưa có `BACKUP_R2_BUCKET` nên chưa có bản off-site trên R2.
- `BACKUP_CRON` dùng định dạng **`HH:MM`** (không phải cron 5 trường) — đặt sai
  làm `bdu-db-backup` thoát lặp. Hiện đặt `17:30` (giờ UTC).
- Dump local do container tạo thuộc `root`; dọn/rotate bằng tay có thể cần `sudo`.
