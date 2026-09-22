import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import grpc from '@grpc/grpc-js';
import { createYouTubeGrpcStream, parseDonationCommand, parseRegistrationCommand, YouTubeChatConnection, youtubeGrpc, youtubeVideoId } from '../src/youtube.js';

test('유튜브 라이브 주소와 영상 ID를 정규화한다', () => {
  assert.equal(youtubeVideoId('abcdefghijk'),'abcdefghijk');
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk'),'abcdefghijk');
  assert.equal(youtubeVideoId('https://youtu.be/abcdefghijk'),'abcdefghijk');
  assert.equal(youtubeVideoId('잘못된 주소'),'');
});

test('후원 채팅 명령어에서 입금자명과 메시지를 추출한다', () => {
  assert.deepEqual(parseDonationCommand('!후원 홍길동 오늘 방송도 재미있어요'),{
    donorName:'홍길동', message:'오늘 방송도 재미있어요'
  });
  assert.equal(parseDonationCommand('일반 채팅입니다'),null);
  assert.equal(parseDonationCommand('!후원 홍길동'),null);
});

test('최초 후원자 등록 명령에서 입금자명을 정규화한다', () => {
  assert.deepEqual(parseRegistrationCommand('!후원등록 홍 길동'),{ donorName:'홍 길동',donorNormalized:'홍길동' });
  assert.equal(parseRegistrationCommand('!후원등록'),null);
});

test('streamList 연결은 기존 채팅을 건너뛰고 새 명령을 중복 없이 전달한다', async () => {
  const streams=[];
  const commands=[];
  const statuses=[];
  const streamFactory = input => {
    const stream = new EventEmitter();
    stream.cancel = () => {};
    streams.push({ input, stream });
    return stream;
  };
  const fetchImpl = async () => ({
    ok:true,
    json:async () => ({ items:[{ liveStreamingDetails:{ activeLiveChatId:'live-chat-1' } }] }),
  });
  const connection = new YouTubeChatConnection(7,'api-key','abcdefghijk',async (_userId, command) => commands.push(command),(_userId,status)=>statuses.push(status),{ streamFactory,fetchImpl,retryDelayMs:1 });
  await connection.connect();
  assert.equal(streams.length,1);
  streams[0].stream.emit('data',{ nextPageToken:'page-1',items:[{
    id:'history',snippet:{type:'TEXT_MESSAGE_EVENT',displayMessage:'!후원 과거 과거 메시지'},authorDetails:{channelId:'old',displayName:'과거'}
  }] });
  streams[0].stream.emit('data',{ nextPageToken:'page-2',items:[{
    id:'new-1',snippet:{type:'TEXT_MESSAGE_EVENT',displayMessage:'!후원 홍길동 새 메시지'},authorDetails:{channelId:'channel-1',displayName:'시청자'}
  }] });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(commands.length,1);
  assert.equal(commands[0].text,'!후원 홍길동 새 메시지');
  streams[0].stream.emit('data',{ nextPageToken:'page-3',items:[{
    id:'new-1',snippet:{type:'TEXT_MESSAGE_EVENT',displayMessage:'!후원 홍길동 새 메시지'},authorDetails:{channelId:'channel-1',displayName:'시청자'}
  }] });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(commands.length,1);
  assert.ok(statuses.some(status=>status.state==='connected'));
  streams[0].stream.emit('end');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(streams.length,2);
  assert.equal(streams[1].input.pageToken,'page-3');
  connection.stop();
});

test('공식 proto로 gRPC streamList 요청과 응답을 직렬화한다', async () => {
  const server = new grpc.Server();
  let receivedMetadata='';
  server.addService(youtubeGrpc.V3DataLiveChatMessageService.service, {
    streamList(call) {
      receivedMetadata=call.metadata.get('x-goog-api-key')[0];
      assert.equal(call.request.liveChatId,'live-chat-local');
      assert.deepEqual(call.request.part,['id','snippet','authorDetails']);
      call.write({ nextPageToken:'next-local',items:[{
        id:'chat-local',
        snippet:{ type:'TEXT_MESSAGE_EVENT',displayMessage:'!후원 로컬 테스트 메시지' },
        authorDetails:{ channelId:'channel-local',displayName:'로컬 사용자' },
      }] });
      call.end();
    },
  });
  const port = await new Promise((resolve,reject) => server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(error,value)=>error?reject(error):resolve(value)));
  const call = createYouTubeGrpcStream({
    apiKey:'local-api-key',liveChatId:'live-chat-local',endpoint:`127.0.0.1:${port}`,credentials:grpc.credentials.createInsecure()
  });
  const responses=[];
  await new Promise((resolve,reject) => {
    call.on('data',response=>responses.push(response));
    call.on('error',reject);
    call.on('end',resolve);
  });
  assert.equal(receivedMetadata,'local-api-key');
  assert.equal(responses[0].nextPageToken,'next-local');
  assert.equal(responses[0].items[0].snippet.displayMessage,'!후원 로컬 테스트 메시지');
  assert.equal(responses[0].items[0].authorDetails.displayName,'로컬 사용자');
  await new Promise(resolve=>server.tryShutdown(resolve));
});
