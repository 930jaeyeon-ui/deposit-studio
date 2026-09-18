import { useEffect, useState } from 'react';
import './api-test.css';

const base = import.meta.env.VITE_API_URL
  || (import.meta.env.VITE_API_HOST ? `https://${import.meta.env.VITE_API_HOST}` : location.origin);
const apiBase = base.replace(/\/$/, '');
const endpoint = `${apiBase}/api/test/messages`;

export function ApiTest() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('연결 중');
  const [body, setBody] = useState(JSON.stringify({
    device: 'phone',
    message: '휴대폰에서 보낸 테스트',
    amount: 1000
  }, null, 2));
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${apiBase}/api/test/events`);
    source.onopen = () => setStatus('실시간 연결됨');
    source.onerror = () => setStatus('연결 끊김 · 자동 재연결 중');
    source.addEventListener('snapshot', event => setMessages(JSON.parse(event.data)));
    source.onmessage = event => setMessages(current => [JSON.parse(event.data), ...current].slice(0, 100));
    return () => source.close();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 객체를 입력하세요.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setNotice(`전송 완료 · ${data.id}`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="shell api-test">
    <header><div><span className="eyebrow">LIVE API MONITOR</span><h1>API 수신 테스트</h1></div><a href="/">관리 화면</a></header>
    <div className="test-status" role="status"><strong>{status}</strong><span>최근 {messages.length}건 · 새 요청이 맨 위에 표시됩니다</span></div>
    <main>
      <section className="panel">
        <h2>휴대폰에서 보내기</h2>
        <p>PC와 같은 Wi-Fi에서 이 페이지를 열거나 아래 주소로 JSON을 보내세요.</p>
        <div className="endpoint"><b>POST</b><code>{endpoint}</code></div>
        <p>헤더: <code>Content-Type: application/json</code></p>
        <form onSubmit={submit}>
          <label htmlFor="json-body">요청 본문</label>
          <textarea id="json-body" spellCheck="false" value={body} onChange={event => setBody(event.target.value)}/>
          <button disabled={busy}>{busy ? '전송 중…' : '테스트 API 보내기'}</button>
        </form>
        <p role="status">{notice}</p>
        <details><summary>curl 호출 예제</summary><pre>{`curl -X POST '${endpoint}' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '{"device":"phone","message":"안녕하세요"}'`}</pre></details>
        <p className="test-help">폰에서는 localhost 대신 PC의 Wi-Fi IPv4 주소를 사용하세요. 예: http://192.168.0.10:5173/api-test</p>
        <p className="test-help">테스트 전용 · 인증 없음 · 최근 100건을 메모리에 보관하며 서버 재시작 시 삭제됩니다. 실제 입금 내역에는 저장되지 않습니다.</p>
      </section>
      <section className="panel">
        <h2>실시간 수신함</h2>
        <p>휴대폰 → HTTP POST → 서버 → SSE → 이 화면</p>
        <div className="test-messages" aria-live="polite">
          {messages.length ? messages.map(item => <article key={item.id}>
            <time>{new Date(item.receivedAt).toLocaleString('ko-KR')}</time>
            <pre>{JSON.stringify(item.body, null, 2)}</pre>
            <small>{item.id}</small>
          </article>) : <div className="empty">수신 대기 중<br/>휴대폰에서 첫 API를 보내보세요.</div>}
        </div>
      </section>
    </main>
  </div>;
}
