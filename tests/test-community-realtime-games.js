import assert from 'node:assert/strict';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';
import { EntertainmentGameService } from '../src/services/entertainment-game.service.js';

const originalQuery = CommunityRealtime.query;

function makeClient(mssv) {
  const client = {
    ws: { readyState: 1, bufferedAmount: 0, send: () => {} },
    mssv,
    authenticated: true,
    authenticating: false,
    detached: false,
    generation: 0,
    rooms: new Set(),
    requestedRooms: new Set(),
    isAlive: true,
    sent: []
  };
  client.ws.send = (payload) => { client.sent.push(JSON.parse(payload)); };
  return client;
}

function attach(client) {
  CommunityRealtime.clients.add(client);
  return client;
}

function detach(client) {
  CommunityRealtime.clients.delete(client);
  client.detached = true;
  client.generation += 1;
}

async function main() {
  // 1. Alias `game-room:` phải được chuẩn hóa về đúng room key `game:` và chỉ
  //    xác thực quyền một lần cho mỗi lần subscribe.
  const player = attach(makeClient('24050111'));
  let roomQueryCount = 0;
  let lastRoomQuery = null;
  CommunityRealtime.query = async (sql, params) => {
    roomQueryCount += 1;
    lastRoomQuery = { sql, params };
    return { rowCount: 1, rows: [{ mssv: player.mssv, visibility: 'public', allow_spectators: true }] };
  };
  await CommunityRealtime.handleMessage(player, Buffer.from(JSON.stringify({
    type: 'subscribe', room: 'game-room:CARO7X7'
  })));

  assert.equal(roomQueryCount, 1, 'subscribe must authorize the game room exactly once');
  assert.deepEqual(lastRoomQuery.params, ['CARO7X7', '24050111'], 'room ref must be normalized before querying');
  assert.ok(player.rooms.has('game:CARO7X7'), 'subscribe must join the canonical game room key');
  assert.ok(!player.rooms.has('game-room:CARO7X7'), 'subscribe must not join an alias room key');
  assert.ok(
    player.sent.some((m) => m.type === 'subscribed' && m.room === 'game-room:CARO7X7'),
    'ack echoes the requested room'
  );
  detach(player);

  // 2. Người chơi reconnect sau khi ván kết thúc vẫn phải nhận snapshot:
  //    canJoin không được chặn trạng thái 'finished', nếu không rematch sẽ
  //    không bao giờ tới được client.
  const reconnectingPlayer = attach(makeClient('24050122'));
  CommunityRealtime.query = async (sql) => {
    assert.match(sql, /r\.status IN \('waiting', 'active', 'finished'\)/, 'finished rooms must stay subscribable');
    return { rowCount: 1, rows: [{ mssv: reconnectingPlayer.mssv, visibility: 'public', allow_spectators: true }] };
  };
  EntertainmentGameService.getRoom = async (roomRef) => {
    assert.equal(roomRef, 'CARO7X7', 'snapshot must be requested with the raw room ref');
    return { room_code: 'CARO7X7', status: 'finished', state_version: 9, state: { board: [] }, players: [] };
  };
  const snapshotErrors = [];
  reconnectingPlayer.ws.send = (payload) => {
    const message = JSON.parse(payload);
    if (message.type === 'error') snapshotErrors.push(message);
    reconnectingPlayer.sent.push(message);
  };
  await CommunityRealtime.handleMessage(reconnectingPlayer, Buffer.from(JSON.stringify({
    type: 'subscribe', room: 'game:CARO7X7'
  })));
  assert.ok(
    !snapshotErrors.some((m) => m.code === 'ROOM_FORBIDDEN'),
    'finished rooms must not be forbidden for reconnecting players'
  );
  assert.ok(
    reconnectingPlayer.sent.some((m) => m.type === 'game.snapshot'),
    'reconnecting player must receive a game snapshot'
  );
  detach(reconnectingPlayer);

  // 3. game.join qua socket phải tự subscribe client vào phòng, còn game.leave
  //    phải gỡ subscription đó ra.
  EntertainmentGameService.joinRoom = async () => ({ room_code: 'CARO9Z9Z', status: 'active', players: [] });
  EntertainmentGameService.leaveRoom = async () => ({ room_code: 'CARO9Z9Z', deleted: false, is_player: true });
  const joiner = attach(makeClient('24050133'));
  await CommunityRealtime.handleMessage(joiner, Buffer.from(JSON.stringify({ type: 'game.join', roomCode: 'game:CARO9Z9Z' })));
  assert.ok(joiner.rooms.has('game:CARO9Z9Z'), 'game.join must auto-subscribe the socket');
  await CommunityRealtime.handleMessage(joiner, Buffer.from(JSON.stringify({ type: 'game.leave', roomCode: 'game:CARO9Z9Z' })));
  assert.ok(!joiner.rooms.has('game:CARO9Z9Z'), 'game.leave must detach the socket');
  detach(joiner);

  CommunityRealtime.query = originalQuery;
  console.log('✓ Caro realtime subscriptions resolve room aliases, allow finished-room reconnects and keep socket join/leave in sync.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
