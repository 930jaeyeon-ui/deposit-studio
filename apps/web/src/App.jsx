import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, formatWon } from '@deposit-studio/shared';
import { ApiTest } from './ApiTest';

async function api(path, options) {
  const configuredHost = import.meta.env.VITE_API_HOST;
  const baseUrl = import.meta.env.VITE_API_URL || (configuredHost ? `https://${configuredHost}` : '');
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

export function App() {
  if (location.pathname === '/api-test') return <ApiTest/>;
  if (location.pathname === '/overlay') return <Overlay/>;
  if (location.pathname === '/recent') return <Widget type="recent"/>;
  if (location.pathname === '/ranking') return <Widget type="ranking"/>;
  if (location.pathname === '/settings') return <Settings/>;
  return <Dashboard/>;
}

function Dashboard() {
  const [data, setData] = useState({ session: {}, donations: [], ranking: [] });
  const [form, setForm] = useState({ donorName: '폴조지', amount: 50000, bank: '테스트' });
  const [message, setMessage] = useState('');
  const load = () => api('/api/dashboard').then(setData).catch(e => setMessage(e.message));
  useEffect(() => { load(); }, []);

  async function submit(event) {
    event.preventDefault();
    try {
      await api('/api/donations', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      setMessage('테스트 입금을 저장했습니다.');
      load();
    } catch (error) { setMessage(error.message); }
  }

  async function display(action) {
    await api(`/api/display/${action}`, { method: 'POST' });
    setMessage(action === 'reset' ? 'OBS 표시 목록을 초기화했습니다. 원본 입금은 보존됩니다.' : 'OBS 표시 목록을 복구했습니다.');
    load();
  }

  return <div className="shell">
    <header><div><span className="eyebrow">DEPOSIT STUDIO</span><h1>입금 후원 관리</h1></div><nav><a href="/settings">OBS 설정</a><a href="/overlay" target="_blank">알림 열기 ↗</a></nav></header>
    <section className="hero"><div><span>현재 방송</span><h2>{data.session.title || '불러오는 중...'}</h2></div><div className="hero-stat"><b>{data.donations.length}</b><span>입금 건수</span></div><div className="hero-stat"><b>{formatWon(data.donations.reduce((sum, item) => sum + item.amount, 0))}</b><span>총 후원금</span></div></section>
    {message && <p className="notice">{message}</p>}
    <main>
      <section className="panel test-panel"><div className="panel-title"><h3>테스트 입금</h3><span>Android Agent 연결 전 테스트용</span></div>
        <form onSubmit={submit}><label>입금자<input value={form.donorName} onChange={e=>setForm({...form,donorName:e.target.value})}/></label><label>금액<input type="number" min="1" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label>은행<input value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})}/></label><button>입금 테스트</button></form>
      </section>
      <section className="panel"><div className="panel-title"><h3>후원 랭킹</h3><span>현재 방송 기준</span></div><ol className="ranking">{data.ranking.map((item,i)=><li key={item.donorName}><i>{i+1}</i><strong>{item.donorName}</strong><span>{formatWon(item.amount)}원</span></li>)}{!data.ranking.length&&<Empty/>}</ol></section>
      <section className="panel wide"><div className="panel-title"><h3>최근 입금</h3><div><button className="ghost" onClick={()=>display('reset')}>OBS 목록 초기화</button><button className="ghost" onClick={()=>display('restore')}>복구</button></div></div>
        <div className="table"><div className="table-head"><span>입금자</span><span>은행</span><span>금액</span><span>시간</span></div>{data.donations.map(item=><div className="table-row" key={item.id}><strong>{item.donorName}</strong><span>{item.bank}</span><b>{formatWon(item.amount)}원</b><time>{new Date(item.receivedAt+'Z').toLocaleString('ko-KR')}</time></div>)}{!data.donations.length&&<Empty/>}</div>
      </section>
    </main>
  </div>;
}

function Empty(){ return <p className="empty">아직 입금 내역이 없습니다.</p>; }

function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState('');
  useEffect(() => { api('/api/settings').then(setSettings); }, []);
  const update = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setSettings(await api('/api/settings', { method:'PUT', body:JSON.stringify(settings) }));
    setSaved('저장했습니다. OBS 화면에 다음 알림부터 적용됩니다.');
  }
  const preview = settings.messageTemplate.replace('{name}','폴조지').replace('{amount}','50,000');
  const style = { color:settings.textColor,fontSize:settings.fontSize,fontWeight:settings.fontWeight,WebkitTextStroke:`${settings.outlineWidth}px ${settings.outlineColor}`,backgroundColor:settings.backgroundColor };
  return <div className="shell"><header><div><span className="eyebrow">DEPOSIT STUDIO</span><h1>OBS 알림 설정</h1></div><a href="/">← 관리 화면</a></header><main className="settings-grid"><form className="panel controls" onSubmit={save}>
    <label>알림 문구<textarea value={settings.messageTemplate} onChange={e=>update('messageTemplate',e.target.value)}/></label>
    <label>표시 시간 (초)<input type="number" min="1" max="30" value={settings.durationMs/1000} onChange={e=>update('durationMs',Number(e.target.value)*1000)}/></label>
    <label>글자 크기<input type="range" min="24" max="100" value={settings.fontSize} onChange={e=>update('fontSize',Number(e.target.value))}/><span>{settings.fontSize}px</span></label>
    <label>글자 굵기<select value={settings.fontWeight} onChange={e=>update('fontWeight',Number(e.target.value))}><option>400</option><option>600</option><option>700</option><option>800</option><option>900</option></select></label>
    <label>글자색<input type="color" value={settings.textColor} onChange={e=>update('textColor',e.target.value)}/></label>
    <label>외곽선색<input type="color" value={settings.outlineColor} onChange={e=>update('outlineColor',e.target.value)}/></label>
    <label>외곽선 두께<input type="range" min="0" max="8" value={settings.outlineWidth} onChange={e=>update('outlineWidth',Number(e.target.value))}/><span>{settings.outlineWidth}px</span></label>
    <label>배경색<input type="color" value={settings.backgroundColor} onChange={e=>update('backgroundColor',e.target.value)}/></label>
    <button>설정 저장</button>{saved&&<p className="saved">{saved}</p>}
  </form><section className="panel preview"><span>실시간 미리보기</span><div className="preview-stage"><div className="alert" style={style}>{preview.split('\n').map((line,i)=><div key={i}>{line}</div>)}</div></div><div className="widget-links"><a href="/overlay" target="_blank">/overlay</a><a href="/recent" target="_blank">/recent</a><a href="/ranking" target="_blank">/ranking</a></div></section></main></div>;
}

function Widget({ type }) {
  const [items, setItems] = useState([]);
  useEffect(() => { const load=()=>api('/api/widgets').then(data=>setItems(type==='recent'?data.donations:data.ranking)); load(); const timer=setInterval(load,1000); return()=>clearInterval(timer); },[type]);
  return <div className="widget"><div className="widget-card"><h2>{type==='recent'?'최근 후원':'후원 랭킹'}</h2>{items.map((item,index)=><div className="widget-row" key={type==='recent'?item.id:item.donorName}><b>{type==='ranking'&&`${index+1}. `}{item.donorName}</b><span>{formatWon(item.amount)}원</span></div>)}</div></div>;
}

function Overlay() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [current, setCurrent] = useState(null);
  const lastId = useRef(0);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const queue = useRef([]);
  const playing = useRef(false);

  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const rows = await api(`/api/donations?after=${lastId.current}`);
        if (rows.length) { lastId.current = rows.at(-1).id; queue.current.push(...rows); play(); }
      } catch { /* 다음 폴링에서 재시도 */ }
    };
    Promise.all([api('/api/settings'), api('/api/dashboard')]).then(([value, dashboard]) => {
      setSettings(value); settingsRef.current = value;
      lastId.current = dashboard.donations[0]?.id || 0;
      timer = setInterval(poll, 500);
    });
    return () => clearInterval(timer);
  }, []);

  function play() {
    if (playing.current || !queue.current.length) return;
    playing.current = true;
    setCurrent(queue.current.shift());
    setTimeout(() => { setCurrent(null); playing.current = false; setTimeout(play, 350); }, settingsRef.current.durationMs);
  }

  const style = { color:settings.textColor, fontSize:settings.fontSize, fontWeight:settings.fontWeight,
    WebkitTextStroke:`${settings.outlineWidth}px ${settings.outlineColor}`,
    background:`color-mix(in srgb, ${settings.backgroundColor} ${settings.backgroundOpacity*100}%, transparent)` };
  if (!current) return <div className="overlay-stage"/>;
  const text = settings.messageTemplate.replace('{name}',current.donorName).replace('{amount}',formatWon(current.amount));
  return <div className="overlay-stage"><div className={`alert ${settings.animation}`} style={style}>{text.split('\n').map((line,i)=><div key={i}>{line}</div>)}</div></div>;
}
