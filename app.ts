import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';

import { getRoundNumber, getCard, shuffleCard } from './utils/cartd';
import { cardIdList } from './init';

type RoomStatus = 'prepare' | 'selectLandlord' | 'reopen' | 'play' | 'end' | 'useCard';

type PlayerPosition = 0 | 1 | 2;

type ClientEventType = 'onJoin' | 'onStart' | 'onNoCall' | 'onCall' | 'useCard' | 'onNotUseCard';

interface RoomPlayer {
  playerId: number;
  position: PlayerPosition;
  isOnline: boolean;
  score: number;
  card: number[];
}

interface RoomRound {
  useCard: number[];
  useId: number;
}

interface RoomInfo {
  roomId: number;
  status: RoomStatus;
  model: number; // 0:随机地主, 1:轮庄
  allCount: number;
  initPost: number;
  initUser: number;
  lastUser: number;
  notUseCardCount: number;
  callCount: number;
  player: RoomPlayer[];
  round: RoomRound[];
  aHand: number[];
  current: number; // 当前操作者索引
  winRole: number; // -1未开始,0地主胜利,1/2农民胜利
}

interface UserSocketInfo {
  socket: WsWebSocket;
  userName?: number;
  roomId: number;
  state: number;
}

const app = express();

app.use(cors({
  origin: (origin, callback) => callback(null, origin || '*'),
  credentials: true,
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const httpServer = createServer(app);

// ws 服务挂载到同一个 HTTP server
const server = new WebSocketServer({ server: httpServer });

let user_sockets: UserSocketInfo[] = [];

const initRoomData: RoomInfo = {
  roomId: 1677140369460, // new Date().getTime(),
  status: 'prepare',//准备阶段
  model: 0,
  allCount: 0,
  initPost: -1,
  initUser: 0,
  lastUser: 0,
  notUseCardCount: 0,
  callCount: 1,
  player: [],
  round: [],
  aHand: [],
  current: -1,
  winRole: -1,
};

const roomList: RoomInfo[] = [initRoomData];

/**
 * 加入房间
 */
const onJoin = (data: any, socket: WsWebSocket) => {
  const roomInfo = roomList.find((item) => item.roomId == data.roomId);
  if (!roomInfo) {
    return { backData: null, isPass: false };
  }

  const newPlayer: RoomPlayer = {
    playerId: data.playerId,
    position: data.position as PlayerPosition,
    isOnline: true,
    score: 0,
    card: [],
  };

  // 判断是否已经加入
  let isJoin = false;
  for (let i = 0; i < roomInfo.player.length; i++) {
    if (roomInfo.player[i].playerId == data.playerId) {
      isJoin = true;
    }
  }

  if (isJoin) {
    console.log('已经加入了', roomInfo);
    return { backData: roomInfo, isPass: true };
  } else if (roomInfo.player.length >= 3) {
    console.log('人数满了');
    return { backData: roomInfo, isPass: false };
  } else {
    roomInfo.status = 'prepare';
    user_sockets.forEach((user) => {
      if (user.socket == socket) {
        user.userName = data.playerId;
        user.roomId = data.roomId;
      }
    });

    roomInfo.player.push(newPlayer);
    return { backData: roomInfo, isPass: true };
  }
};

const onStart = (data: any) => {
  const roomInfo = roomList.find((item) => item.roomId == data.roomId);
  if (!roomInfo) return { code: 0, isError: true, message: '房间不存在' };

  if (roomInfo.player.length < 3) {
    return {
      code: 0,
      isError: true,
      message: '人数不齐',
    };
  }

  const radNum = getRoundNumber(0, 2) as PlayerPosition;
  roomInfo.status = 'selectLandlord';
  roomInfo.current = radNum;
  roomInfo.initPost = radNum;
  roomInfo.initUser = radNum;
  roomInfo.lastUser = radNum;
  roomInfo.callCount = 1;
  roomInfo.round = [];

  // 洗牌
  const cardList = shuffleCard(JSON.parse(JSON.stringify(cardIdList)));
  roomInfo.player.map((item) => {
    item.card = getCard(17, cardList);
    return item;
  });
  roomInfo.aHand = cardList;
  return roomInfo;
};

// 不叫地主
const onNoCall = (data: any) => {
  const roomInfo = roomList.find((item) => item.roomId == data.roomId);
  if (!roomInfo) return null;

  if (roomInfo.callCount < 3) {
    // 下一位叫地主
    roomInfo.current = roomInfo.current == 2 ? 0 : (roomInfo.current + 1);
    roomInfo.callCount++;
  } else {
    // 都不叫地主，重开
    roomInfo.status = 'reopen';
  }
  return roomInfo;
};

// 抢地主
const onCall = (data: any) => {
  const roomInfo = roomList.find((item) => item.roomId == data.roomId);
  if (!roomInfo) return null;

  roomInfo.status = 'play';
  roomInfo.player.forEach((player, index) => {
    player.position = roomInfo.current == index ? (0 as PlayerPosition) : (1 as PlayerPosition);
  });
  roomInfo.notUseCardCount = 0;
  roomInfo.round = [];
  roomInfo.player[roomInfo.current as number].card.push(...roomInfo.aHand);
  return roomInfo;
};

/**
 * 出牌
 */
const onUseCard = (data: any) => {
  const { useCard, position, roomId, playerId } = data;
  const roomInfo = roomList.find((item) => item.roomId == roomId);
  if (!roomInfo) return null;

  roomInfo.status = 'useCard';
  roomInfo.notUseCardCount = 0;

  roomInfo.round.push({ useCard, useId: playerId });
  roomInfo.lastUser = roomInfo.current;
  roomInfo.current = roomInfo.current == 2 ? 0 : roomInfo.current + 1;

  // 设置玩家用掉的牌
  roomInfo.player[position].card = roomInfo.player[position].card.filter(
    (item) => useCard.indexOf(item) < 0,
  );

  // 胜利：牌出完了
  if (roomInfo.player[position].card.length == 0) {
    roomInfo.winRole = roomInfo.player[position].position;
    roomInfo.status = 'end';
  }

  return roomInfo;
};

/**
 * 放弃出牌
 */
const onNotUseCard = (data: any) => {
  const { roomId } = data;
  const roomInfo = roomList.find((item) => item.roomId == roomId);
  if (!roomInfo) return null;

  roomInfo.notUseCardCount = roomInfo.notUseCardCount + 1;
  roomInfo.current = roomInfo.current == 2 ? 0 : roomInfo.current + 1;

  if (roomInfo.notUseCardCount == 2) {
    // 大家都要不起，最后一个出牌的人是我
    roomInfo.round = [];
  }
  return roomInfo;
};

/**
 * 发送消息给客户端
 */
const sendMes = (backData: any) => {
  backData &&
    user_sockets.forEach((s) => {
      if (s?.roomId == backData?.roomId) {
        s.socket.send(JSON.stringify(backData));
      }
    });
};

const sendMesForPlay = (userName: any, data: any) => {
  data &&
    user_sockets.forEach((s) => {
      if (s?.userName == userName) {
        s.socket.send(JSON.stringify(data));
      }
    });
};

function decodeWsMessage(msg: any): string {
  if (typeof msg === 'string') return msg;
  if (Buffer.isBuffer(msg)) return msg.toString('utf8');
  // ws 在某些情况下可能传 ArrayBuffer / Uint8Array
  return new TextDecoder('utf-8').decode(new Uint8Array(msg));
}

server.on('connection', function (socket) {
  // 判断是否已经加入了
  let connectionIndex = -1;
  for (let i = 0; i < user_sockets.length; i++) {
    if (user_sockets[i].socket === socket) {
      connectionIndex = i;
      break;
    }
  }

  console.log('--------------', connectionIndex);
  // 重连
  if (connectionIndex >= 0) {
    console.log('有玩家重连');
  } else {
    user_sockets.push({
      socket: socket,
      userName: undefined,
      roomId: 0,
      state: 1,
    });
  }

  socket.on('message', function (msg) {
    try {
      const encData = decodeWsMessage(msg);
      const data = JSON.parse(encData);

      if ((data as any).type === 'onJoin') {
        const { backData, isPass } = onJoin(data, socket);
        console.log(isPass, backData);
        isPass ? sendMes(backData) : sendMesForPlay(data.playerId, { backData, status: 'maxCount' });
      } else if ((data as any).type === 'onStart') {
        const backData = onStart(data);
        sendMes(backData);
      } else if ((data as any).type === 'onNoCall') {
        const backData = onNoCall(data);
        sendMes(backData);
      } else if ((data as any).type === 'onCall') {
        const backData = onCall(data);
        sendMes(backData);
      } else if ((data as any).type === 'useCard') {
        const backData = onUseCard(data);
        sendMes(backData);
      } else if ((data as any).type === 'onNotUseCard') {
        const backData = onNotUseCard(data);
        sendMes(backData);
      } else {
        console.log('其它事件');
        user_sockets.forEach((s) => s.socket.send(JSON.stringify(data)));
      }
    } catch (error) {
      console.log('----------服务器崩溃----------------', error);
      user_sockets.forEach((s) => s.socket.send(JSON.stringify({ err: '服务器崩溃' })));
      user_sockets = [];
    }
  });

  socket.on('close', function () {
    user_sockets = user_sockets.filter((s) => s.socket !== socket);
  });
});

const PORT = process.env.PORT || 9200;
httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

// 获取房间数据
app.get('/api/roomList', function (req, res) {
  res.status(200).json({
    isSuccess: true,
    roomList,
  });
});

// 创建房间
app.post('/api/createRoom', function (req, res) {
  const data = { userName: '测试' };
  res.status(200).json({
    isSuccess: true,
  });
});

