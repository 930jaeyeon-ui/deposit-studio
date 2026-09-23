import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('전체 API E2E 흐름', { timeout:30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(),'n9-signal-e2e-'));
  process.env.TURSO_DATABASE_URL = `file:${join(directory,'test.db')}`;
  const [{ app, handleYouTubeDonationCommand, queueBankDonationAlert },{ initializeDatabase, db, activeSession }] = await Promise.all([import('../src/app.js'),import('../src/db.js')]);
  await initializeDatabase();
  const server = await new Promise(resolve => { const value=app.listen(0,'127.0.0.1',()=>resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const basic = (id,password) => `Basic ${Buffer.from(`${id}:${password}`).toString('base64')}`;
  let superCookie = '';
  let memberCookie = '';

  async function request(path,{ method='GET', body, cookie, authorization }={}) {
    const response = await fetch(`${base}${path}`,{
      method,
      headers:{ ...(body?{'Content-Type':'application/json'}:{}), ...(cookie?{Cookie:cookie}:{}), ...(authorization?{Authorization:authorization}:{}) },
      body:body?JSON.stringify(body):undefined
    });
    const text = await response.text();
    let data=null; try { data=text?JSON.parse(text):null; } catch { data=text; }
    return { response, data };
  }

  try {
    assert.equal((await request('/api/health')).response.status,200);
    assert.equal((await request('/api/auth/me')).response.status,401);

    let result = await request('/api/auth/login',{method:'POST',body:{loginId:'admin',password:'Init1357!!'}});
    assert.equal(result.response.status,200);
    superCookie = result.response.headers.get('set-cookie').split(';')[0];
    result = await request('/api/auth/login',{method:'POST',body:{loginId:'hh01',password:'Init1234!!'}});
    assert.equal(result.response.status,200);
    memberCookie = result.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/auth/me',{cookie:memberCookie})).data.loginId,'hh01');

    assert.equal((await request('/api/users',{cookie:memberCookie})).response.status,403);
    assert.equal((await request('/api/notification-rules',{cookie:memberCookie})).response.status,403);
    assert.equal((await request('/api/api-logs',{cookie:memberCookie})).response.status,403);

    result = await request('/api/profile',{method:'PUT',cookie:memberCookie,body:{displayName:'E2E 멤버',avatar:null}});
    assert.equal(result.data.displayName,'E2E 멤버');
    result = await request('/api/settings',{cookie:memberCookie});
    assert.equal(result.response.status,200);
    assert.equal((await request('/api/settings')).response.status,401);
    assert.equal((await request('/api/tts/voices',{cookie:memberCookie})).data.configured,false);
    assert.equal((await request('/api/tts/typecast-voices',{cookie:memberCookie})).data.configured,false);
    assert.equal((await request('/api/tts/typecast-voices')).response.status,401);
    assert.equal((await request('/api/tts/preview',{method:'POST',cookie:memberCookie,body:{text:'테스트',voiceId:'voice-test'}})).response.status,503);
    assert.equal((await request('/api/settings',{method:'PUT',cookie:memberCookie,body:{...result.data,toonationEnabled:true,toonationWidgetUrl:'https://example.com/widget/alertbox/abcdefgh'}})).response.status,400);

    const detailedSettings = {
      ...result.data,
      minimumDonationAmount:1000,
      alertMinimumAmount:1000,
      youtubeApiKey:'test-private-youtube-key',
      durationMs:999999,
      fontSize:1,
      fontWeight:9999,
      textAlign:'invalid',
      animation:'invalid',
      exitAnimation:'invalid',
      soundVolume:-20,
      ttsProvider:'invalid',
      ttsRate:99,
      ttsPitch:-1,
      ttsVolume:101,
      toonationEnabled:false,
      toonationWidgetUrl:'  https://toon.at/widget/alertbox/abcdefgh  ',
      toonationAlertMode:'custom-original-audio',
      rankingCustomBorderEnabled:false,
      rankingCustomRowBackgroundEnabled:false,
      rankingTitleColumn:'last',
      backgroundImageData:'data:text/plain;base64,Zm9v',
      soundLibrary:[
        { id:'valid',name:'효과음',data:'data:audio/mp3;base64,Zm9v' },
        { id:'invalid',name:'잘못된 파일',data:'data:text/plain;base64,Zm9v' },
      ],
      amountTiers:[{
        id:'vip',name:'VIP',minAmount:-10,maxAmount:999999999,enabled:true,
        textMode:'custom',fontSize:999,fontWeight:1,
        effectMode:'custom',durationMs:1,
        soundMode:'custom',soundVolume:500,
        ttsMode:'custom',ttsProvider:'invalid',ttsRate:0.1,ttsPitch:9,ttsVolume:-1,
      }],
      crewGrades:[{ id:'forbidden',name:'멤버가 바꿀 수 없음',minAmount:0,maxAmount:null }],
    };
    result = await request('/api/settings',{method:'PUT',cookie:memberCookie,body:detailedSettings});
    assert.equal(result.data.minimumDonationAmount,1000);
    assert.equal(result.data.durationMs,30000);
    assert.equal(result.data.fontSize,20);
    assert.equal(result.data.fontWeight,900);
    assert.equal(result.data.textAlign,'center');
    assert.equal(result.data.animation,'zoom');
    assert.equal(result.data.exitAnimation,'fade-out');
    assert.equal(result.data.soundVolume,0);
    assert.equal(result.data.ttsProvider,'typecast');
    assert.equal(result.data.ttsRate,2);
    assert.equal(result.data.ttsPitch,-1);
    assert.equal(result.data.ttsVolume,100);
    assert.equal(result.data.toonationWidgetUrl,'https://toon.at/widget/alertbox/abcdefgh');
    assert.equal(result.data.toonationAlertMode,'custom-original-audio');
    assert.equal(result.data.toonationUseOwnAlert,true);
    assert.equal(result.data.rankingCustomBorderEnabled,false);
    assert.equal(result.data.rankingCustomRowBackgroundEnabled,false);
    assert.equal(result.data.rankingTitleColumn,'last');
    assert.equal(result.data.backgroundImageData,'');
    assert.equal(result.data.soundLibrary.length,1);
    assert.equal(result.data.amountTiers[0].minAmount,0);
    assert.equal(result.data.amountTiers[0].maxAmount,100000000);
    assert.equal(result.data.amountTiers[0].fontSize,160);
    assert.equal(result.data.amountTiers[0].fontWeight,100);
    assert.equal(result.data.amountTiers[0].durationMs,1000);
    assert.equal(result.data.amountTiers[0].soundVolume,100);
    assert.equal(result.data.amountTiers[0].ttsProvider,'typecast');
    assert.equal(result.data.amountTiers[0].ttsRate,.5);
    assert.equal(result.data.amountTiers[0].ttsPitch,9);
    assert.equal(result.data.amountTiers[0].ttsVolume,0);
    assert.equal(result.data.crewGrades.some(grade=>grade.id==='forbidden'),false);
    assert.equal((await request('/api/toonation/status',{cookie:memberCookie})).data.state,'disabled');
    assert.equal((await request('/api/toonation/reconnect',{method:'POST',cookie:memberCookie,body:{}})).response.status,200);
    assert.equal((await request('/api/my/deposits/test-alert',{method:'POST',cookie:memberCookie,body:{}})).data.ok,true);

    result = await request('/api/users',{method:'POST',cookie:superCookie,body:{loginId:'e2e-user',displayName:'E2E 사용자',role:'member'}});
    assert.equal(result.response.status,201);
    const createdUserId = Number(result.data.id);
    assert.equal((await request(`/api/users/${createdUserId}/status`,{method:'PUT',cookie:superCookie,body:{active:false}})).data.active,false);
    assert.equal((await request(`/api/users/${createdUserId}/status`,{method:'PUT',cookie:superCookie,body:{active:true}})).data.active,true);
    assert.equal((await request(`/api/users/${createdUserId}/reset-password`,{method:'POST',cookie:superCookie})).response.status,200);

    const rule = { packageName:'com.n9.e2e.bank',contentPattern:'(?<donor>.+?)님.*?(?<amount>[\\d,]+)원' };
    assert.equal((await request('/api/notification-rules',{method:'POST',cookie:superCookie,body:rule})).response.status,201);
    result = await request('/api/notification-rules',{cookie:superCookie});
    assert.equal(result.data.length,1);
    const updatedRule = { ...rule,packageName:'com.n9.e2e.bank.updated' };
    assert.equal((await request(`/api/notification-rules/${rule.packageName}`,{method:'PUT',cookie:superCookie,body:updatedRule})).response.status,200);

    const notification = content => ({ packageName:updatedRule.packageName,title:'입금 알림',content });
    assert.equal((await request('/api/notifications',{method:'POST',body:notification('홍길동님이 1,000원을 입금했습니다.')})).response.status,401);
    assert.equal((await request('/api/notifications',{method:'POST',authorization:basic('hh01','Init1234!!'),body:{...notification('홍길동님이 1,000원을 입금했습니다.'),packageName:'unknown.package'}})).response.status,404);
    assert.equal((await request('/api/notifications',{method:'POST',authorization:basic('hh01','Init1234!!'),body:notification('정규식 불일치')})).response.status,422);
    const first = await request('/api/notifications',{method:'POST',authorization:basic('hh01','Init1234!!'),body:notification('홍길동님이 12,345원을 입금했습니다.')});
    const second = await request('/api/notifications',{method:'POST',authorization:basic('hh01','Init1234!!'),body:notification('홍길동님이 23,456원을 입금했습니다.')});
    assert.equal(first.response.status,201);
    assert.equal(second.response.status,201);
    assert.equal(first.data.recipient.loginId,'hh01');

    result = await request('/api/my/analytics?period=all',{cookie:memberCookie});
    assert.equal(Number(result.data.summary.totalAmount),35801);
    assert.equal(Number(result.data.summary.donationCount),2);
    result = await request('/api/my/donors?period=all&query=%ED%99%8D%EA%B8%B8%EB%8F%99',{cookie:memberCookie});
    assert.equal(Number(result.data.match.amount),35801);
    assert.equal(Number(result.data.match.count),2);
    result = await request('/api/dashboard',{cookie:memberCookie});
    assert.equal(Number(result.data.summary.totalAmount),35801);
    result = await request('/api/dashboard/donors?query=%ED%99%8D%EA%B8%B8%EB%8F%99',{cookie:memberCookie});
    assert.equal(Number(result.data.match.amount),35801);

    result = await request('/api/my/deposits?range=all&query=%ED%99%8D%EA%B8%B8%EB%8F%99',{cookie:memberCookie});
    assert.equal(result.data.deposits.length,2);
    const [latest,older] = result.data.deposits;
    assert.equal((await request(`/api/my/deposits/${latest.id}/donor`,{method:'PUT',cookie:memberCookie,body:{canonicalName:'길동이',scope:'single'}})).response.status,200);
    assert.equal((await request(`/api/my/deposits/${older.id}/status`,{method:'PUT',cookie:memberCookie,body:{status:'excluded',note:'E2E 제외'}})).response.status,200);
    result = await request('/api/my/analytics?period=all',{cookie:memberCookie});
    assert.equal(Number(result.data.summary.totalAmount),Number(latest.amount));
    assert.equal((await request(`/api/my/deposits/${older.id}/status`,{method:'PUT',cookie:memberCookie,body:{status:'included',note:''}})).response.status,200);

    assert.equal((await request('/api/widgets',{cookie:memberCookie})).response.status,200);
    const memberRow = await db.execute(`SELECT id FROM users WHERE login_id = 'hh01'`);
    const memberId = Number(memberRow.rows[0].id);
    const youtubeSettings = { ...(await request('/api/settings',{cookie:memberCookie})).data, youtubeChatEnabled:true, youtubeMatchWindowSeconds:30, youtubeMessageMaxLength:200, youtubeChatMinimumAmount:0 };
    await db.execute({ sql:'UPDATE user_settings SET value = ? WHERE user_id = ?', args:[JSON.stringify(youtubeSettings),memberId] });
    const currentSession = await activeSession();
    const registrationDeposit = await db.execute({ sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank) VALUES (?, ?, '등록후원자', 10000, 'bank.test')`, args:[currentSession.id,memberId] });
    await handleYouTubeDonationCommand(memberId,{ text:'!후원등록 등록후원자',chatId:'register-chat-1',channelId:'registered-channel',youtubeName:'등록 시청자' });
    let linked = await db.execute({ sql:'SELECT donor_name donorName FROM youtube_donor_links WHERE recipient_user_id = ? AND youtube_channel_id = ?', args:[memberId,'registered-channel'] });
    assert.equal(linked.rows[0].donorName,'등록후원자');
    const automaticDeposit = await db.execute({ sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank) VALUES (?, ?, '등록후원자', 20000, 'bank.test')`, args:[currentSession.id,memberId] });
    await queueBankDonationAlert(Number(automaticDeposit.lastInsertRowid),memberId,youtubeSettings);
    await handleYouTubeDonationCommand(memberId,{ text:'자동으로 읽을 첫 채팅',chatId:'normal-chat-1',channelId:'registered-channel',youtubeName:'등록 시청자' });
    await handleYouTubeDonationCommand(memberId,{ text:'같은 입금에서 읽히면 안 되는 두 번째 채팅',chatId:'normal-chat-2',channelId:'registered-channel',youtubeName:'등록 시청자' });
    const matchedDonation = await db.execute({ sql:'SELECT message, youtube_chat_id youtubeChatId FROM donations WHERE id = ?', args:[automaticDeposit.lastInsertRowid] });
    assert.equal(matchedDonation.rows[0].message,'자동으로 읽을 첫 채팅');
    assert.equal(matchedDonation.rows[0].youtubeChatId,'normal-chat-1');
    const unusedSecondChat = await db.execute({ sql:'SELECT matched_at matchedAt FROM youtube_chat_messages WHERE recipient_user_id = ? AND chat_id = ?', args:[memberId,'normal-chat-2'] });
    assert.equal(unusedSecondChat.rows[0].matchedAt,null);
    await handleYouTubeDonationCommand(memberId,{ text:'!후원등록 등록후원자',chatId:'register-chat-duplicate',channelId:'other-channel',youtubeName:'다른 시청자' });
    linked = await db.execute({ sql:`SELECT youtube_channel_id channelId FROM youtube_donor_links WHERE recipient_user_id = ? AND donor_normalized = '등록후원자'`, args:[memberId] });
    assert.equal(linked.rows.length,1);
    assert.equal(linked.rows[0].channelId,'registered-channel');
    const changedNameDeposit = await db.execute({ sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank) VALUES (?, ?, '변경후원자', 30000, 'bank.test')`, args:[currentSession.id,memberId] });
    await handleYouTubeDonationCommand(memberId,{ text:'!후원등록 변경후원자',chatId:'register-chat-change',channelId:'registered-channel',youtubeName:'등록 시청자' });
    linked = await db.execute({ sql:'SELECT donor_name donorName FROM youtube_donor_links WHERE recipient_user_id = ? AND youtube_channel_id = ?', args:[memberId,'registered-channel'] });
    assert.equal(linked.rows[0].donorName,'변경후원자');
    await db.execute({ sql:'DELETE FROM youtube_chat_messages WHERE recipient_user_id = ?', args:[memberId] });
    await db.execute({ sql:'DELETE FROM youtube_donor_links WHERE recipient_user_id = ?', args:[memberId] });
    await db.execute({ sql:'DELETE FROM donations WHERE id IN (?, ?, ?)', args:[registrationDeposit.lastInsertRowid,automaticDeposit.lastInsertRowid,changedNameDeposit.lastInsertRowid] });
    youtubeSettings.youtubeChatEnabled=false;
    await db.execute({ sql:'UPDATE user_settings SET value = ? WHERE user_id = ?', args:[JSON.stringify(youtubeSettings),memberId] });
    await db.execute({ sql:`INSERT INTO youtube_donor_links (recipient_user_id, youtube_channel_id, youtube_name, donor_name, donor_normalized) VALUES (?, ?, ?, ?, ?)`, args:[memberId,'channel-e2e-1','E2E 시청자','홍길동','홍길동'] });
    await assert.rejects(
      db.execute({ sql:`INSERT INTO youtube_donor_links (recipient_user_id, youtube_channel_id, youtube_name, donor_name, donor_normalized) VALUES (?, ?, ?, ?, ?)`, args:[memberId,'channel-e2e-2','중복 시청자','홍 길동','홍길동'] }),
      /UNIQUE/
    );
    result = await request('/api/youtube/donor-links',{cookie:memberCookie});
    assert.equal(result.data.length,1);
    const donorLinkId = result.data[0].id;
    result = await request('/api/youtube/donor-links?page=1&pageSize=10&query=E2E',{cookie:memberCookie});
    assert.equal(result.data.total,1);
    assert.equal(result.data.items[0].id,donorLinkId);
    assert.equal(result.data.page,1);
    assert.equal(result.data.pageSize,10);
    assert.equal((await request(`/api/youtube/donor-links/${donorLinkId}`,{method:'PUT',cookie:memberCookie,body:{donorName:'길동이'}})).response.status,200);
    result = await request('/api/youtube/donor-links',{cookie:memberCookie});
    assert.equal(result.data[0].donorName,'길동이');
    assert.equal((await request(`/api/youtube/donor-links/${donorLinkId}`,{method:'DELETE',cookie:memberCookie})).response.status,200);
    assert.equal((await request('/api/youtube/donor-links',{cookie:memberCookie})).data.length,0);
    const sources = await request('/api/obs/sources',{cookie:memberCookie});
    result = await request(`/api${sources.data.alertPath}/bootstrap`);
    assert.equal(result.response.status,200);
    assert.equal('toonationWidgetUrl' in result.data.settings,false);
    assert.equal(result.data.settings.youtubeApiKey,undefined);
    const overlayLastDonationId = Number(result.data.lastDonationId);
    const lastId = overlayLastDonationId-2;
    result = await request(`/api/donations?after=${Math.max(0,lastId)}`);
    assert.equal(result.data.filter(item=>['홍길동','길동이'].includes(item.donorName)).length,2);
    assert.equal((await request('/api/overlay/preview',{cookie:memberCookie})).response.status,200);
    result = await request('/api/overlay/preview-session',{method:'POST',cookie:memberCookie,body:{}});
    assert.equal(result.response.status,200);
    const previewSession = await request(`/api/overlay/preview-session/${result.data.token}`);
    assert.equal(previewSession.response.status,200);
    assert.equal('toonationWidgetUrl' in previewSession.data.settings,false);
    assert.equal((await request('/api/overlay/preview-session/not-a-token')).response.status,404);

    const overlayController = new AbortController();
    const overlayResponse = await fetch(`${base}/api${sources.data.alertPath}/events?after=${overlayLastDonationId}`,{signal:overlayController.signal});
    const overlayReader = overlayResponse.body.getReader();
    const overlayDecoder = new TextDecoder();
    let overlayText='';
    while (!overlayText.includes('event: bootstrap')) overlayText += overlayDecoder.decode((await overlayReader.read()).value,{stream:true});
    const liveNotification = await request('/api/notifications',{method:'POST',authorization:basic('hh01','Init1234!!'),body:notification('실시간후원자님이 7,777원을 입금했습니다.')});
    assert.equal(liveNotification.response.status,201);
    while (!overlayText.includes('event: donation')) overlayText += overlayDecoder.decode((await overlayReader.read()).value,{stream:true});
    overlayController.abort();
    assert.match(overlayText,/"donorName":"실시간후원자"/);
    assert.match(overlayText,/"amount":7777/);

    const controller = new AbortController();
    const sseResponse = await fetch(`${base}/api/my/phone-test/events`,{headers:{Cookie:memberCookie},signal:controller.signal});
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let sseText='';
    while (!sseText.includes('event: snapshot')) sseText += decoder.decode((await reader.read()).value,{stream:true});
    controller.abort();
    assert.match(sseText,/com\.n9\.e2e\.bank\.updated/);
    assert.match(sseText,/"status":201/);

    const malformedResponse = await fetch(`${base}/api/notifications`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:basic('hh01','Init1234!!') },
      body:'{"packageName":"com.n9.e2e.bank.updated","title":"입금","content":"복구후원자님이 9,999원을 입금했습니다.\n잔액 10,000원"}'
    });
    assert.equal(malformedResponse.status,201);
    const malformedBody = await malformedResponse.json();
    assert.equal(malformedBody.donation.donorName,'복구후원자');
    assert.equal(malformedBody.donation.amount,9999);
    await new Promise(resolve=>setTimeout(resolve,50));

    result = await request('/api/api-logs?page=1&pageSize=10',{cookie:superCookie});
    assert.ok(result.data.total>=5);
    assert.equal(result.data.pageSize,10);
    assert.ok(result.data.items.some(item=>item.requestHeaders.authorization==='[REDACTED]'));
    const malformedLog = result.data.items.find(item=>item.requestBody.recovered===true);
    assert.ok(malformedLog);
    assert.equal(malformedLog.responseStatus,201);
    assert.match(malformedLog.requestBody.rawBody,/복구후원자/);
    assert.match(malformedLog.requestBody.parseError,/JSON/);
    assert.equal(malformedLog.requestBody.parsedBody.content,'복구후원자님이 9,999원을 입금했습니다.\n잔액 10,000원');
    assert.equal((await request('/api/api-logs',{method:'DELETE',cookie:superCookie})).response.status,200);
    assert.equal((await request('/api/api-logs?page=1&pageSize=10',{cookie:superCookie})).data.total,0);

    assert.equal((await request('/api/display/reset',{method:'POST',cookie:memberCookie})).response.status,200);
    assert.equal((await request('/api/display/restore',{method:'POST',cookie:memberCookie})).response.status,200);
    assert.equal((await request('/api/sessions',{method:'POST',cookie:memberCookie,body:{title:'E2E 새 방송'}})).response.status,201);
    assert.equal((await request(`/api/notification-rules/${updatedRule.packageName}`,{method:'DELETE',cookie:superCookie})).response.status,200);

    assert.equal((await request('/api/profile/password',{method:'PUT',cookie:memberCookie,body:{currentPassword:'Init1234!!',newPassword:'Changed1234!!'}})).response.status,200);
    assert.equal((await request('/api/auth/login',{method:'POST',body:{loginId:'hh01',password:'Changed1234!!'}})).response.status,200);
    assert.equal((await request('/api/auth/logout',{method:'POST',cookie:superCookie})).response.status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await db.close();
    try {
      rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    } catch (error) {
      // Windows may briefly retain libSQL file handles after close(); do not turn
      // an otherwise successful E2E run into a product failure during cleanup.
      if (error.code !== 'EPERM') throw error;
    }
  }
});
