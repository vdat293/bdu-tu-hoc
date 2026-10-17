/**
 * PM2 process config cho VPS đơn chạy app trực tiếp (bare-metal, không Docker).
 * Nếu VPS đang dùng Docker Compose thì KHÔNG cần file này — compose đã chạy app
 * trong container (xem README mục "Triển Khai Production").
 *
 * Chạy:  npx pm2 start ecosystem.config.cjs        (lần đầu)
 *        npx pm2 reload bdu-tu-hoc                 (deploy lại, zero-downtime)
 *        npx pm2 logs bdu-tu-hoc
 *        npx pm2 save && npx pm2 startup           (tự chạy khi reboot)
 *
 * ⚠️ MẶC ĐỊNH ĐÚNG 1 WORKER. Gateway WebSocket community/game giữ membership
 * room và broadcast TRONG BỘ NHỚ của một tiến trình; README mục "Giới hạn
 * topology WebSocket" ghi rõ phải chạy đúng 1 replica cho tới khi có shared
 * pub/sub adapter. Chạy cluster nhiều worker sẽ khiến sự kiện realtime không tới
 * client ở worker khác (client có polling dự phòng nên vẫn hội tụ, chỉ trễ hơn).
 *
 * Muốn tăng lên 2 worker (chỉ khi chấp nhận realtime trễ tới nhịp polling, hoặc
 * sau khi bổ sung pub/sub liên tiến trình như Postgres LISTEN/NOTIFY): đặt
 * WEB_CONCURRENCY=2 khi start, hoặc sửa `instances` dưới đây. Khi đó job nền vẫn
 * chỉ chạy ở worker 0 (server.js đọc NODE_APP_INSTANCE do PM2 đặt).
 */
const instances = Number.parseInt(process.env.WEB_CONCURRENCY || '1', 10);

module.exports = {
  apps: [
    {
      name: 'bdu-tu-hoc',
      script: 'server.js',
      instances: Number.isSafeInteger(instances) && instances > 0 ? instances : 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      // Chừa nhiều dung lượng cho Postgres + OS trên VPS 4GB.
      max_memory_restart: '900M',
      // Giới hạn heap dưới ngưỡng restart để GC không để tiến trình phình sát trần.
      node_args: '--max-old-space-size=768',
      // Chờ request đang xử lý kết thúc khi reload/stop.
      kill_timeout: 8000,
      listen_timeout: 10000,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
