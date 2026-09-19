import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('전체 API E2E 흐름', { timeout:30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(),'n9-signal-e2e-'));
  process.env.TURSO_DATABASE_URL = `file:${join(directory,'test.db')}`;
  const [{ app },{ initializeDatabase, db }] = await Promise.all([import('../src/app.js'),import('../src/db.js')]);
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
    result = await request('/api/settings',{method:'PUT',cookie:memberCookie,body:{...result.data,minimumDonationAmount:1000,alertMinimumAmount:1000}});
    assert.equal(result.data.minimumDonationAmount,1000);

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

    assert.equal((await request('/api/widgets')).response.status,200);
    result = await request('/api/overlay/bootstrap');
    assert.equal(result.response.status,200);
    const lastId = Number(result.data.lastDonationId)-2;
    result = await request(`/api/donations?after=${Math.max(0,lastId)}`);
    assert.equal(result.data.filter(item=>['홍길동','길동이'].includes(item.donorName)).length,2);
    assert.equal((await request('/api/overlay/preview',{cookie:memberCookie})).response.status,200);

    const controller = new AbortController();
    const sseResponse = await fetch(`${base}/api/my/phone-test/events`,{headers:{Cookie:memberCookie},signal:controller.signal});
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let sseText='';
    while (!sseText.includes('event: snapshot')) sseText += decoder.decode((await reader.read()).value,{stream:true});
    controller.abort();
    assert.match(sseText,/com\.n9\.e2e\.bank\.updated/);
    assert.match(sseText,/"status":201/);

    result = await request('/api/api-logs?page=1&pageSize=10',{cookie:superCookie});
    assert.ok(result.data.total>=5);
    assert.equal(result.data.pageSize,10);
    assert.ok(result.data.items.some(item=>item.requestHeaders.authorization==='[REDACTED]'));
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
    db.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
