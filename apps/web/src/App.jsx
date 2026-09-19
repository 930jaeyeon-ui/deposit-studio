import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { DEFAULT_SETTINGS, formatWon } from '@deposit-studio/shared';
import { ApiTest } from './ApiTest';

const ROLE_LABELS = { super:'슈퍼 계정', admin:'관리자', member:'일반 계정' };
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('deposit-studio-theme');
    return ['light','system','dark'].includes(savedTheme) ? savedTheme : 'system';
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.themeMode = theme;
    };
    apply();
    localStorage.setItem('deposit-studio-theme', theme);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <div className="theme-picker"><span>화면 테마</span><div>{[['light','라이트'],['system','시스템'],['dark','다크']].map(([value,label])=><button key={value} className={theme===value?'active':''} onClick={()=>setTheme(value)}>{label}</button>)}</div></div>;
}

async function api(path, options) {
  const configuredHost = import.meta.env.VITE_API_HOST;
  const baseUrl = import.meta.env.VITE_API_URL || (configuredHost ? `https://${configuredHost}` : '');
  const response = await fetch(`${baseUrl}${path}`, { credentials:'include', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

export function App() {
  if (location.pathname === '/overlay') return <Overlay/>;
  if (location.pathname === '/recent') return <Widget/>;
  if (location.pathname === '/ranking') return <Widget type="ranking"/>;
  return <AuthenticatedApp/>;
}

function AuthenticatedApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api('/api/auth/me').then(setUser).catch(()=>setUser(null)).finally(()=>setLoading(false)); }, []);
  if (loading) return <div className="auth-loading">로그인 상태를 확인하고 있습니다.</div>;
  if (!user) return <Login onLogin={setUser}/>;
  return <AuthContext.Provider value={{ user, setUser }}><AuthenticatedRoutes/></AuthContext.Provider>;
}

function AuthenticatedRoutes() {
  const { user } = useAuth();
  const canManage = ['super','admin'].includes(user.role);
  if (location.pathname === '/' || location.pathname === '/my-dashboard') return <MyDashboard/>;
  if (location.pathname === '/crew-dashboard') return <Dashboard/>;
  if (location.pathname === '/deposits') return <DepositHistory/>;
  if (location.pathname === '/api-test') return canManage?<PageLayout><ApiTest/></PageLayout>:<AccessDenied/>;
  if (location.pathname === '/admin/users') return <AdminAccounts/>;
  if (location.pathname === '/obs') return <ObsSetup/>;
  if (location.pathname === '/settings/ranking') return <Settings mode="ranking"/>;
  if (location.pathname === '/settings' && location.hash === '#ranking') return <Settings mode="ranking"/>;
  if (location.pathname === '/settings/alert' || location.pathname === '/settings') return <Settings mode="alert"/>;
  return <MyDashboard/>;
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ loginId:'', password:'' });
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault(); setMessage(''); setSubmitting(true);
    try { onLogin(await api('/api/auth/login', { method:'POST', body:JSON.stringify(form) })); }
    catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  }
  return <div className="login-page"><section className="login-card"><div className="login-brand"><span className="brand-logo" aria-hidden="true"/><div><b>N9 SIGNAL</b></div></div><div className="login-heading"><h1>로그인</h1></div><form onSubmit={submit}><label>아이디<input autoFocus autoComplete="username" value={form.loginId} onChange={e=>setForm({...form,loginId:e.target.value})}/></label><label>비밀번호<input type="password" autoComplete="current-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>{message&&<p className="login-error">{message}</p>}<button disabled={submitting}>{submitting?'확인 중...':'로그인'}</button></form></section></div>;
}

function AccessDenied() { return <PageLayout><div className="shell"><section className="panel access-denied"><h1>접근 권한이 없습니다</h1><p>이 화면은 관리자 계정만 사용할 수 있습니다.</p></section></div></PageLayout>; }

const PAGE_INFO = {
  '/':['후원 현황','내 후원 현황'], '/my-dashboard':['후원 현황','내 후원 현황'], '/crew-dashboard':['후원 현황','크루 후원 현황'],
  '/deposits':['후원 관리','입금 내역'],
  '/settings/alert':['내 방송','후원 알림 설정'], '/settings':['내 방송','후원 알림 설정'], '/settings/ranking':['내 방송','후원 순위표 설정'],
  '/obs':['내 방송','OBS 연결'], '/admin/users':['관리','계정 관리'], '/api-test':['관리','API 수신 테스트']
};

async function resizeAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일을 선택해주세요.');
  if (file.size > 8 * 1024 * 1024) throw new Error('원본 이미지는 8MB 이하만 사용할 수 있습니다.');
  const source = await new Promise((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
  const image = await new Promise((resolve, reject) => { const value=new Image(); value.onload=()=>resolve(value); value.onerror=reject; value.src=source; });
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas'); canvas.width=400; canvas.height=400;
  const context = canvas.getContext('2d');
  context.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,400,400);
  return canvas.toDataURL('image/jpeg',.84);
}

function ProfileDialog({ mode, onClose, forced=false }) {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({ displayName:user.displayName, avatar:user.avatar||null });
  const [password, setPassword] = useState({ currentPassword:'', newPassword:'', confirmPassword:'' });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  async function readAvatar(event) {
    try { const file=event.target.files?.[0]; if (file) { const avatar=await resizeAvatar(file); setProfile(value=>({...value,avatar})); } }
    catch (error) { setMessage(error.message); }
  }
  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setMessage('');
    try { const updated=await api('/api/profile',{method:'PUT',body:JSON.stringify(profile)}); setUser(updated); setMessage('내 정보가 저장되었습니다.'); }
    catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }
  async function savePassword(event) {
    event.preventDefault(); setMessage('');
    if (password.newPassword !== password.confirmPassword) return setMessage('새 비밀번호가 서로 일치하지 않습니다.');
    setSaving(true);
    try { await api('/api/profile/password',{method:'PUT',body:JSON.stringify(password)}); setUser({...user,mustChangePassword:0}); setMessage('비밀번호를 변경했습니다.'); setPassword({currentPassword:'',newPassword:'',confirmPassword:''}); if (forced) onClose(); }
    catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={event=>{if(!forced&&event.target===event.currentTarget)onClose();}}><section className="profile-dialog" role="dialog" aria-modal="true"><div className="dialog-title"><div><small>{forced?'첫 로그인 보호':'내 계정'}</small><h2>{mode==='profile'?'프로필 설정':forced?'새 비밀번호를 설정해주세요':'비밀번호 변경'}</h2>{forced&&<p>초기 비밀번호를 계속 사용할 수 없습니다.</p>}</div>{!forced&&<button onClick={onClose} aria-label="닫기">×</button>}</div>{mode==='profile'?<form onSubmit={saveProfile}><div className="avatar-editor">{profile.avatar?<img src={profile.avatar} alt="프로필 미리보기"/>:<span>{profile.displayName.slice(0,1)||'?'}</span>}<div><label className="file-button">사진 선택<input type="file" accept="image/png,image/jpeg,image/webp" onChange={readAvatar}/></label><button type="button" onClick={()=>setProfile(value=>({...value,avatar:null}))}>사진 삭제</button><small>사진은 정사각형으로 자동 조정됩니다.</small></div></div><label>표시 이름<input maxLength="20" value={profile.displayName} onChange={event=>setProfile({...profile,displayName:event.target.value})}/></label><label>로그인 아이디<input value={user.loginId} disabled/></label>{message&&<p className="form-message">{message}</p>}<button className="primary-button" disabled={saving}>{saving?'저장 중...':'변경사항 저장'}</button></form>:<form onSubmit={savePassword}><PasswordField label="현재 비밀번호" autoComplete="current-password" value={password.currentPassword} onChange={value=>setPassword({...password,currentPassword:value})}/><PasswordField label="새 비밀번호" autoComplete="new-password" value={password.newPassword} onChange={value=>setPassword({...password,newPassword:value})} hint="8자 이상, 영문·숫자·특수문자 포함"/><PasswordField label="새 비밀번호 확인" autoComplete="new-password" value={password.confirmPassword} onChange={value=>setPassword({...password,confirmPassword:value})}/>{message&&<p className="form-message">{message}</p>}<button className="primary-button" disabled={saving}>{saving?'변경 중...':'비밀번호 변경'}</button></form>}</section></div>;
}

function PasswordField({ label, value, onChange, autoComplete, hint }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<div className="password-field"><input type={visible?'text':'password'} autoComplete={autoComplete} value={value} onChange={event=>onChange(event.target.value)}/><div className="password-field-actions"><button type="button" onClick={()=>setVisible(state=>!state)} aria-label={`${label} ${visible?'숨기기':'보기'}`} aria-pressed={visible}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={visible?'M2 2l20 20M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.5 10.5 0 0112 4c6.5 0 10 8 10 8a17 17 0 01-3.1 4.4M6.6 6.6C3.6 8.5 2 12 2 12s3.5 8 10 8a9.8 9.8 0 004.1-.9':'M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12zm10 3a3 3 0 110-6 3 3 0 010 6z'}/></svg></button>{value&&<button className="password-clear" type="button" onClick={()=>onChange('')} aria-label={`${label} 전체 삭제`}>×</button>}</div></div>{hint&&<small>{hint}</small>}</label>;
}

function PageLayout({ children }) {
  const { user, setUser } = useAuth();
  const [profileMenu, setProfileMenu] = useState(false);
  const [dialog, setDialog] = useState(user.mustChangePassword?'password':null);
  const path = location.pathname;
  const activePath = path === '/my-dashboard' ? '/' : path === '/settings' ? '/settings/alert' : path;
  const canManage = ['super','admin'].includes(user.role);
  async function logout() { await api('/api/auth/logout', { method:'POST' }).catch(()=>{}); setUser(null); }
  const Link = ({ href, label, hint }) => <a className={activePath === href ? 'active' : ''} href={href}><strong>{label}</strong><small>{hint}</small></a>;
  const [pageGroup,pageTitle] = PAGE_INFO[path] || ['','N9 SIGNAL'];
  return <div className="app-layout">
    <aside className="side-menu">
      <a className="brand" href="/"><span className="brand-logo" aria-hidden="true"/><b>N9 SIGNAL</b><small>CREW DONATION</small></a>
      <nav className="side-nav" aria-label="주 메뉴">
        <span className="nav-label">후원 현황</span>
        <Link href="/" label="내 후원 현황" hint="나의 방송과 후원 통계"/>
        <Link href="/crew-dashboard" label="크루 후원 현황" hint="크루 전체 후원자 현황"/>
        <span className="nav-label nav-group">후원 관리</span>
        <Link href="/deposits" label="입금 내역" hint="날짜별 입금과 입금자명 관리"/>
        <span className="nav-label nav-group">내 방송</span>
        <Link href="/settings/alert" label="후원 알림 설정" hint="문구 · 디자인 · 표시 시간"/>
        <Link href="/settings/ranking" label="후원 순위표 설정" hint="순위 · 테마 · 표시 인원"/>
        <Link href="/obs" label="OBS 연결" hint="송출 주소 · 해상도 · 미리보기"/>
        {canManage && <><span className="nav-label nav-group">관리</span><Link href="/admin/users" label="계정 관리" hint="크루 멤버와 권한"/><Link href="/api-test" label="API 수신 테스트" hint="휴대폰 · 외부 연동 확인"/></>}
      </nav>
      <ThemeSelector/>
    </aside>
    <div className="app-content"><div className="top-bar"><div className="page-crumb"><small>{pageGroup}</small><i>›</i><strong>{pageTitle}</strong></div><div className="top-profile"><button className="profile-trigger" onClick={()=>setProfileMenu(value=>!value)} aria-expanded={profileMenu}>{user.avatar?<img src={user.avatar} alt=""/>:<span>{user.displayName.slice(0,1)}</span>}<div><b>{user.displayName}</b><small>{ROLE_LABELS[user.role]}</small></div><i>⌄</i></button>{profileMenu&&<div className="profile-menu"><div><b>{user.displayName}</b><small>{user.loginId}</small></div><button onClick={()=>{setDialog('profile');setProfileMenu(false);}}>프로필 사진 및 내 정보</button><button onClick={()=>{setDialog('password');setProfileMenu(false);}}>비밀번호 변경</button><button className="menu-logout" onClick={logout}>로그아웃</button></div>}</div></div><div className="page-body">{children}</div></div>
    {dialog&&<ProfileDialog mode={dialog} forced={Boolean(user.mustChangePassword)} onClose={()=>setDialog(null)}/>}
  </div>;
}

function MyDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ summary:{ totalAmount:0, donationCount:0, donorCount:0, averageAmount:0 }, donors:[], weekdays:[], days:[], months:[], hours:[], largestDonation:null });
  const [weekData, setWeekData] = useState({ days:[] });
  const [trendPeriod, setTrendPeriod] = useState('week');
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => { setMessage(''); Promise.all([api('/api/my/analytics?period=month'),api('/api/my/analytics?period=7d')]).then(([month,week])=>{setData(month);setWeekData(week);}).catch(error=>setMessage(error.message)); }, []);
  const months = Array.from({ length:12 }, (_,offset) => { const date=new Date(); date.setMonth(date.getMonth()-(11-offset)); const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; const found=data.months.find(item=>item.month===key);return { label:`${date.getMonth()+1}월`, key, amount:Number(found?.amount||0), count:Number(found?.count||0), donorCount:Number(found?.donorCount||0) }; });
  const weekDays = (() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate()-6);
    const items = [];
    for (const date = new Date(start); date <= today; date.setDate(date.getDate()+1)) {
      const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      items.push({ key, label:`${date.getMonth()+1}/${date.getDate()}`, amount:Number(weekData.days?.find(item=>item.day===key)?.amount || 0), note:key===`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`?'오늘':'' });
    }
    return items;
  })();
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR');
  const searchedIndex = normalizedQuery ? data.donors.findIndex(item=>item.donorName.toLocaleLowerCase('ko-KR').includes(normalizedQuery)) : -1;
  const searchedDonor = searchedIndex >= 0 ? data.donors[searchedIndex] : null;
  const selectedPeriodLabel = '이번 달';
  const trendItems = trendPeriod==='week' ? weekDays : months;
  const currentMonthLabel=`${new Date().getMonth()+1}월`;
  const monthlyAverageAmount=Math.round(months.reduce((sum,item)=>sum+item.amount,0)/12);
  const monthlyAverageDonors=Math.round(months.reduce((sum,item)=>sum+item.donorCount,0)/12*10)/10;
  const monthlyAverageCount=Math.round(months.reduce((sum,item)=>sum+item.count,0)/12*10)/10;
  return <PageLayout><div className="shell">
    <header><div><span className="eyebrow">MY DONATION ANALYTICS</span><h1>{user.displayName}님의 후원 현황</h1><p className="page-description">이번 달 후원 흐름과 후원자 데이터를 정리합니다.</p></div></header>
    <section className="dashboard-kpis personal-kpis"><article className="kpi primary"><span>{currentMonthLabel} 후원금</span><strong>{formatWon(Number(data.summary.totalAmount)||0)}<small>원</small></strong></article><article className="kpi"><span>월별 평균 후원자 수</span><strong>{monthlyAverageDonors}<small>명</small></strong><p>최근 12개월 기준</p></article><article className="kpi"><span>월별 평균 후원 건수</span><strong>{monthlyAverageCount}<small>건</small></strong><p>최근 12개월 기준</p></article><article className="kpi"><span>월별 평균 후원</span><strong>{formatWon(monthlyAverageAmount)}<small>원</small></strong><p>최근 12개월 기준</p></article></section>
    {message&&<p className="notice">{message}</p>}
    <main className="analytics-grid"><AnalyticsChart className="dashboard-trend" title={trendPeriod==='week'?'최근 1주일 후원 추이':'최근 1년 후원 추이'} caption={trendPeriod==='week'?'일별 후원금액':'월별 후원금액'} items={trendItems} chartType={trendPeriod==='week'?'area':'bar'} controls={<div className="chart-segment"><button className={trendPeriod==='week'?'active':''} onClick={()=>setTrendPeriod('week')}>최근 1주일</button><button className={trendPeriod==='year'?'active':''} onClick={()=>setTrendPeriod('year')}>최근 1년</button></div>}/>
      <section className="panel"><div className="panel-title"><div><span className="section-kicker">MY RANKING</span><h3>{selectedPeriodLabel} 내 후원자 순위</h3></div><span>상위 20명</span></div><ol className="ranking ranking-large">{data.donors.slice(0,20).map((item,index)=><li key={item.donorName}><i>{index+1}</i><strong>{item.donorName}<small>{item.count}회 후원</small></strong><span>{formatWon(item.amount)}원</span></li>)}{!data.donors.length&&<Empty/>}</ol></section>
      <section className="panel donor-lookup"><div className="panel-title"><div><span className="section-kicker">MY DONOR SEARCH</span><h3>{selectedPeriodLabel} 내 후원자 검색</h3></div></div><label className="donor-search"><span>닉네임 검색</span><input value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="예: 폴조지"/></label>{!normalizedQuery&&<div className="search-guide"><b>후원자를 검색해보세요</b><span>{selectedPeriodLabel} 기준 순위, 누적 금액과 후원 건수를 확인합니다.</span></div>}{normalizedQuery&&!searchedDonor&&<div className="search-guide"><b>검색 결과가 없습니다</b><span>기간이나 닉네임을 다시 확인해주세요.</span></div>}{searchedDonor&&<div className="donor-result"><span>검색된 후원자</span><strong>{searchedDonor.donorName}</strong><dl><div><dt>{selectedPeriodLabel} 순위</dt><dd>{searchedIndex+1}위</dd></div><div><dt>누적 후원금</dt><dd>{formatWon(searchedDonor.amount)}원</dd></div><div><dt>후원 건수</dt><dd>{searchedDonor.count}건</dd></div></dl></div>}</section>
    </main>
  </div></PageLayout>;
}

function AnalyticsChart({ title, caption, items, chartType='area', controls=null, className='' }) {
  const [colorMode,setColorMode] = useState(()=>document.documentElement.dataset.theme||'dark');
  useEffect(() => {
    const root=document.documentElement;
    const update=()=>setColorMode(root.dataset.theme||'dark');
    const observer=new MutationObserver(update);observer.observe(root,{attributes:true,attributeFilter:['data-theme']});
    return()=>observer.disconnect();
  },[]);
  const isLight=colorMode==='light';
  const compact=value=>value>=100000000?`${(value/100000000).toFixed(value%100000000?1:0)}억`:value>=10000?`${Math.round(value/10000)}만`:formatWon(value);
  const options={
    chart:{type:chartType,toolbar:{show:false},zoom:{enabled:false},fontFamily:'Pretendard, "Noto Sans KR", sans-serif',foreColor:isLight?'#65778e':'#8295b0',animations:{enabled:true,easing:'easeinout',speed:550}},
    colors:['#5b8cff'],
    dataLabels:{enabled:true,formatter:value=>value?compact(value):'',offsetY:chartType==='bar'?-10:-7,style:{fontSize:'10px',fontWeight:700,colors:[isLight?'#355b89':'#a9ceff']},background:{enabled:false}},
    stroke:{curve:chartType==='area'?'smooth':'straight',width:chartType==='area'?3:0},
    fill:chartType==='area'?{type:'gradient',gradient:{shade:isLight?'light':'dark',type:'vertical',opacityFrom:.5,opacityTo:.05,stops:[0,92,100]}}:{type:'gradient',gradient:{type:'vertical',opacityFrom:1,opacityTo:.72,stops:[0,100]}},
    markers:{size:chartType==='area'?4:0,strokeWidth:3,strokeColors:[isLight?'#fff':'#111b2e'],hover:{size:6}},
    plotOptions:{bar:{borderRadius:7,borderRadiusApplication:'end',columnWidth:'46%'}},
    grid:{borderColor:isLight?'#dce5ef':'#263a58',strokeDashArray:4,padding:{top:20,right:12,left:10,bottom:0}},
    xaxis:{categories:items.map(item=>item.label),axisBorder:{show:false},axisTicks:{show:false},labels:{style:{fontSize:'10px'}}},
    yaxis:{min:0,forceNiceScale:true,labels:{formatter:compact,style:{fontSize:'10px'}}},
    tooltip:{theme:isLight?'light':'dark',y:{formatter:value=>`${formatWon(value)}원`},marker:{show:true}},
    legend:{show:false}
  };
  return <section className={`panel analytics-chart apex-donation-chart ${className}`}><div className="panel-title"><div><span className="section-kicker">DONATION TREND</span><h3>{title}</h3><p>{caption}</p></div>{controls}</div><Chart key={`${chartType}-${colorMode}`} options={options} series={[{name:'후원금',data:items.map(item=>item.amount)}]} type={chartType} height={300}/></section>;
}

function DepositHistory() {
  const today = new Date();
  const dateValue = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const [filters, setFilters] = useState({ range:'today', query:'', status:'', from:dateValue(today), to:dateValue(today) });
  const [data, setData] = useState({ summary:{totalAmount:0,depositCount:0,donorCount:0,averageAmount:0}, deposits:[], donorNames:[] });
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(null);
  const [donorForm, setDonorForm] = useState({ canonicalName:'', scope:'single' });
  const [statusSaving, setStatusSaving] = useState(null);
  const ranges = [['today','오늘'],['yesterday','어제'],['7d','최근 7일'],['30d','최근 30일'],['month','이번 달'],['custom','직접 선택'],['all','전체']];
  const statuses = { included:'후원 반영', excluded:'후원 제외', below_minimum:'기준 미달', needs_review:'확인 필요' };
  const bankNames = { tossbank:'토스뱅크',kbank:'케이뱅크',kakao:'카카오뱅크',ibk:'기업은행' };
  const load = async () => {
    setMessage('');
    const params=new URLSearchParams({range:filters.range});
    if(filters.query.trim())params.set('query',filters.query.trim());
    if(filters.status)params.set('status',filters.status);
    if(filters.range==='custom'){params.set('from',filters.from);params.set('to',filters.to);}
    try { setData(await api(`/api/my/deposits?${params}`)); } catch(error) { setMessage(error.message); }
  };
  useEffect(()=>{const timer=setTimeout(load,filters.query?250:0);return()=>clearTimeout(timer);},[filters.range,filters.query,filters.status,filters.from,filters.to]);
  const groups = data.deposits.reduce((result,item)=>{const day=String(item.receivedAt).slice(0,10);(result[day] ||= []).push(item);return result;},{});
  function openDonor(item) { setEditing(item); setDonorForm({canonicalName:item.donorName,scope:'single'}); }
  async function saveDonor(event) {
    event.preventDefault();
    try { await api(`/api/my/deposits/${editing.id}/donor`,{method:'PUT',body:JSON.stringify(donorForm)}); setEditing(null); setMessage(donorForm.canonicalName?'입금자명을 변경했습니다.':'은행 원본 이름으로 되돌렸습니다.'); await load(); }
    catch(error){setMessage(error.message);}
  }
  async function changeStatus(item) {
    const status=item.status==='included'?'excluded':'included';
    setStatusSaving(item.id);
    try { await api(`/api/my/deposits/${item.id}/status`,{method:'PUT',body:JSON.stringify({status,note:''})}); setMessage(status==='included'?'후원 금액에 다시 반영했습니다.':'후원 금액에서 제외했습니다.'); await load(); }
    catch(error){setMessage(error.message);} finally { setStatusSaving(null); }
  }
  const formatDay = value => { const [year,month,day]=value.split('-'); return `${year}년 ${Number(month)}월 ${Number(day)}일`; };
  return <PageLayout><div className="shell deposit-page"><header><div><h1>입금 내역</h1><p className="page-description">내 계정으로 들어온 입금을 확인하고 입금자명과 후원 반영 여부를 관리합니다.</p></div></header><section className="deposit-filters"><div className="period-tabs">{ranges.map(([value,label])=><button className={filters.range===value?'active':''} onClick={()=>setFilters({...filters,range:value})} key={value}>{label}</button>)}</div><div className="deposit-search"><input value={filters.query} onChange={event=>setFilters({...filters,query:event.target.value})} placeholder="입금자명 검색"/><select value={filters.status} onChange={event=>setFilters({...filters,status:event.target.value})}><option value="">전체 상태</option>{Object.entries(statuses).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>{filters.range==='custom'&&<div className="custom-dates"><label>시작일<input type="date" value={filters.from} max={filters.to} onChange={event=>setFilters({...filters,from:event.target.value})}/></label><i>–</i><label>종료일<input type="date" value={filters.to} min={filters.from} onChange={event=>setFilters({...filters,to:event.target.value})}/></label></div>}</section>{message&&<p className="notice">{message}</p>}<section className="deposit-kpis"><article><span>조회 기간 입금액</span><b>{formatWon(Number(data.summary.totalAmount)||0)}<small>원</small></b></article><article><span>입금 건수</span><b>{Number(data.summary.depositCount)||0}<small>건</small></b></article><article><span>입금자 수</span><b>{Number(data.summary.donorCount)||0}<small>명</small></b></article><article><span>평균 입금액</span><b>{formatWon(Math.round(Number(data.summary.averageAmount)||0))}<small>원</small></b></article></section><section className="panel deposit-list-panel"><div className="deposit-table-head"><span>입금 시각</span><span>입금자</span><span>은행</span><span>후원 반영</span><span>금액</span></div>{Object.entries(groups).map(([day,items])=><div className="deposit-day" key={day}><div className="deposit-day-title"><b>{formatDay(day)}</b><span>{items.length}건 · {formatWon(items.reduce((sum,item)=>sum+Number(item.amount),0))}원</span></div>{items.map(item=><article className="deposit-row" key={item.id}><time>{String(item.receivedAt).slice(11,16)}</time><div className="deposit-donor"><div><strong>{item.donorName}</strong><button type="button" onClick={()=>openDonor(item)}>입금자명 변경</button></div>{Boolean(item.nameAdjusted)&&<small>은행 원문 · {item.rawDonorName}</small>}</div><span>{bankNames[item.bank]||item.bank}</span><div className="deposit-status-control"><em className={`deposit-status ${item.status}`}>{statuses[item.status]||item.status}</em><button type="button" disabled={statusSaving===item.id} onClick={()=>changeStatus(item)}>{statusSaving===item.id?"변경 중":item.status==="included"?"후원 제외":"후원 반영"}</button></div><b>{formatWon(item.amount)}원</b></article>)}</div>)}{!data.deposits.length&&<div className="empty deposit-empty">선택한 조건의 입금 내역이 없습니다.</div>}</section></div>{editing&&<div className="dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setEditing(null);}}><section className="profile-dialog donor-dialog" role="dialog" aria-modal="true"><div className="dialog-title"><div><small>은행 원본 · {editing.rawDonorName}</small><h2>입금자명 변경</h2><p>같은 후원자가 다른 이름으로 입금했을 때 순위표에 표시할 이름을 직접 정할 수 있습니다.</p></div><button onClick={()=>setEditing(null)} aria-label="닫기">×</button></div><form onSubmit={saveDonor}><label>변경할 입금자명<input autoFocus list="known-donors" maxLength="40" value={donorForm.canonicalName} onChange={event=>setDonorForm({...donorForm,canonicalName:event.target.value})}/><datalist id="known-donors">{data.donorNames.map(name=><option value={name} key={name}/>)}</datalist></label><div className="donor-scope"><label><input type="radio" name="scope" checked={donorForm.scope==='single'} onChange={()=>setDonorForm({...donorForm,scope:'single'})}/><span><b>이번 입금만</b><small>선택한 한 건에만 적용합니다.</small></span></label><label><input type="radio" name="scope" checked={donorForm.scope==='same_name'} onChange={()=>setDonorForm({...donorForm,scope:'same_name'})}/><span><b>같은 입금자명 전체</b><small>앞으로 같은 원본 이름에도 적용합니다.</small></span></label></div><button type="button" className="restore-name" onClick={()=>setDonorForm({...donorForm,canonicalName:''})}>은행 원본 이름으로 되돌리기</button><button className="primary-button">입금자명 저장</button></form></section></div>}</PageLayout>;
}

function AdminAccounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ displayName:'', loginId:'', role:'member' });
  const canManage = ['super','admin'].includes(user.role);
  const load = () => api('/api/users').then(setAccounts).catch(error=>setMessage(error.message));
  useEffect(() => { if (canManage) load(); }, [canManage]);
  if (!canManage) return <AccessDenied/>;
  const isSuper = user.role === 'super';
  const canReset = account => account.loginId !== user.loginId && (isSuper || account.role !== 'super');
  async function createAccount(event) {
    event.preventDefault(); setCreating(true); setMessage('');
    try { const created=await api('/api/users',{method:'POST',body:JSON.stringify(form)}); setMessage(`${created.displayName} 계정을 만들었습니다. 초기 비밀번호는 ${created.temporaryPassword} 입니다.`); setForm({displayName:'',loginId:'',role:'member'}); setShowCreate(false); await load(); }
    catch (error) { setMessage(error.message); } finally { setCreating(false); }
  }
  async function toggleAccount(account) {
    const action=account.isActive?'중지':'다시 활성화';
    if (!confirm(`${account.displayName} 계정을 ${action}할까요?${account.isActive?' 후원 기록은 그대로 보존됩니다.':''}`)) return;
    try { await api(`/api/users/${account.id}/status`,{method:'PUT',body:JSON.stringify({active:!account.isActive})}); setMessage(`${account.displayName} 계정을 ${action}했습니다.`); await load(); }
    catch (error) { setMessage(error.message); }
  }
  async function resetPassword(account) {
    if (!confirm(`${account.displayName}의 비밀번호를 초기화할까요? 현재 로그인된 기기에서도 로그아웃됩니다.`)) return;
    try { const result=await api(`/api/users/${account.id}/reset-password`,{method:'POST'}); setMessage(`${account.displayName}의 임시 비밀번호는 ${result.temporaryPassword} 입니다.`); }
    catch (error) { setMessage(error.message); }
  }
  return <PageLayout><div className="shell"><header><div><h1>계정 관리</h1><p className="page-description">크루원 계정을 만들고 권한, 로그인 상태와 비밀번호를 관리합니다.</p></div><button className="header-button" onClick={()=>setShowCreate(value=>!value)}>{showCreate?'취소':'새 계정 만들기'}</button></header>{showCreate&&<section className="panel create-account"><div><h3>새 크루 계정</h3><p>관리자·일반 계정의 초기 비밀번호는 <b>Init1234!!</b>입니다.</p></div><form onSubmit={createAccount}><label>이름<input autoFocus maxLength="20" value={form.displayName} onChange={event=>setForm({...form,displayName:event.target.value})} placeholder="예: 새 크루원"/></label><label>로그인 아이디<input maxLength="30" value={form.loginId} onChange={event=>setForm({...form,loginId:event.target.value.toLowerCase()})} placeholder="영문 소문자와 숫자"/></label><label>계정 등급<select value={form.role} onChange={event=>setForm({...form,role:event.target.value})}><option value="member">일반 계정</option><option value="admin">관리자</option></select></label><button className="primary-button" disabled={creating}>{creating?'생성 중...':'계정 생성'}</button></form></section>}{message&&<p className="notice">{message}</p>}<section className={`account-summary ${isSuper?'':'three'}`}><article><b>{accounts.filter(item=>item.isActive).length}</b><span>활성 계정</span></article>{isSuper&&<article><b>{accounts.filter(item=>item.role==='super').length}</b><span>슈퍼 계정</span></article>}<article><b>{accounts.filter(item=>item.role==='admin'&&item.isActive).length}</b><span>관리자 계정</span></article><article><b>{accounts.filter(item=>item.role==='member'&&item.isActive).length}</b><span>일반 계정</span></article></section><section className="panel account-panel"><div className="panel-title"><div><h3>크루 계정</h3><p className="account-explain">나간 크루원은 계정을 중지하면 로그인만 차단되고 기존 후원 기록은 보존됩니다.</p></div><span>{accounts.length}개 계정</span></div><div className="account-list">{accounts.map(account=><article className={account.isActive?'':'inactive'} key={account.loginId}>{account.avatar?<img className="account-avatar" src={account.avatar} alt={`${account.displayName} 프로필`}/>:<span className="account-avatar">{account.displayName.slice(0,1)}</span>}<div><strong>{account.displayName}</strong><small>아이디 {account.loginId} · {ROLE_LABELS[account.role]}</small></div><em className={account.isActive?'status-active':'status-paused'}>{account.isActive?'활성':'중지'}</em>{canReset(account)&&<div className="account-actions"><button className="account-reset" type="button" onClick={()=>resetPassword(account)}>비밀번호 초기화</button><button className="account-toggle" type="button" onClick={()=>toggleAccount(account)}>{account.isActive?'계정 중지':'다시 활성화'}</button></div>}</article>)}</div></section><section className="panel password-policy"><div className="panel-title"><h3>계정 운영 기준</h3><span>후원 기록 보존</span></div><div><article><b>새 크루원</b><p>초기 비밀번호 Init1234!!로 로그인한 뒤 본인이 새 비밀번호로 변경합니다.</p></article><article><b>비밀번호 분실</b><p>관리자가 Init1234!!로 재설정하며, 기존 로그인 세션은 종료됩니다.</p></article><article><b>크루 탈퇴</b><p>계정을 중지해 로그인을 차단합니다. 통계와 후원 기록은 삭제하지 않습니다.</p></article></div></section></div></PageLayout>;
}

function ObsSetup() {
  const [copied, setCopied] = useState('');
  const sources = [{key:'alert',title:'후원 알림',description:'새 후원이 들어올 때 잠시 나타나는 화면',path:'/overlay',previewPath:'/overlay?preview=1',size:'1920 × 1080'},{key:'ranking',title:'후원 순위표',description:'방송 화면에 계속 표시하는 누적 후원 순위',path:'/ranking',previewPath:'/ranking',size:'600 × 800'}];
  async function copy(source) {
    await navigator.clipboard.writeText(`${location.origin}${source.path}`);
    setCopied(source.key);
    setTimeout(()=>setCopied(''),1800);
  }
  return <PageLayout><div className="shell"><header><div><span className="eyebrow">OBS BROWSER SOURCES</span><h1>OBS 연결</h1><p className="page-description">OBS 브라우저 소스에 사용할 주소와 권장 크기를 확인합니다.</p></div></header><section className="obs-grid">{sources.map(source=><article className="panel obs-card" key={source.key}><span className="section-kicker">{source.key==='alert'?'ALERT SOURCE':'RANKING SOURCE'}</span><h2>{source.title}</h2><p>{source.description}</p><label>브라우저 소스 주소</label><code>{location.origin}{source.path}</code><dl><div><dt>권장 크기</dt><dd>{source.size}</dd></div><div><dt>배경</dt><dd>투명</dd></div><div><dt>설정 반영</dt><dd>{source.key==='alert'?'후원 알림 설정':'후원 순위표 설정'} 즉시 적용</dd></div></dl><div className="obs-actions"><button onClick={()=>copy(source)}>{copied===source.key?'복사 완료':'주소 복사'}</button><a href={source.previewPath} target="_blank">예시 미리보기 ↗</a></div></article>)}</section><section className="panel obs-help"><h3>OBS에 연결하는 방법</h3><ol><li>OBS에서 소스 추가 → 브라우저를 선택합니다.</li><li>위 주소를 복사해 URL에 붙여 넣습니다.</li><li>권장 크기를 입력하고 사용자 지정 CSS는 비워둡니다.</li><li>후원 알림 설정을 저장하면 OBS 오버레이에도 바로 반영됩니다.</li><li>화면이 보이지 않으면 브라우저 소스 새로고침을 실행합니다.</li></ol></section></div></PageLayout>;
}

function Dashboard() {
  const [data, setData] = useState({ session: {}, donations: [], ranking: [], settings: DEFAULT_SETTINGS });
  const [form, setForm] = useState({ donorName: '폴조지', amount: 50000, bank: '테스트' });
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const load = () => api('/api/dashboard').then(setData).catch(e => setMessage(e.message));
  useEffect(() => { load(); }, []);

  async function submit(event) {
    event.preventDefault();
    try {
      const result = await api('/api/donations', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      setMessage(result.ignored ? result.message : '후원 리스트에 반영했습니다. 같은 입금자명은 자동으로 합산됩니다.');
      load();
    } catch (error) { setMessage(error.message); }
  }

  const total = data.donations.reduce((sum, item) => sum + item.amount, 0);
  const average = data.donations.length ? Math.round(total / data.donations.length) : 0;
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR');
  const searchedIndex = normalizedQuery ? data.ranking.findIndex(item => item.donorName.toLocaleLowerCase('ko-KR').includes(normalizedQuery)) : -1;
  const searchedDonor = searchedIndex >= 0 ? data.ranking[searchedIndex] : null;
  return <PageLayout><div className="shell">
    <header><div><span className="eyebrow">CREW DONATION OVERVIEW</span><h1>크루 후원 현황</h1><p className="page-description">크루 전체 후원자의 누적 현황을 확인합니다.</p></div></header>
    <section className="dashboard-kpis">
      <article className="kpi primary"><span>전체 후원금</span><strong>{formatWon(total)}<small>원</small></strong></article>
      <article className="kpi"><span>전체 후원자</span><strong>{data.ranking.length}<small>명</small></strong><p>동일 닉네임은 합산</p></article>
      <article className="kpi"><span>후원 1건당 평균 금액</span><strong>{formatWon(average)}<small>원</small></strong><p>전체 후원 건수 기준</p></article>
    </section>
    {message && <p className="notice">{message}</p>}
    <main className="dashboard-main">
      <section className="panel ranking-panel"><div className="panel-title"><div><span className="section-kicker">CREW RANKING</span><h3>크루 전체 후원 순위</h3></div><span>누적 금액 기준 · 상위 20명</span></div><ol className="ranking ranking-large">{data.ranking.slice(0, 20).map((item,i)=><li key={item.donorName}><i>{i+1}</i><strong>{item.donorName}<small>{item.count}회 후원</small></strong><span>{formatWon(item.amount)}원</span></li>)}{!data.ranking.length&&<Empty/>}</ol></section>
      <section className="panel crew-summary"><div className="panel-title"><div><span className="section-kicker">DONOR SEARCH</span><h3>후원자 조회</h3></div></div>
        <label className="donor-search"><span>닉네임 검색</span><input value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="예: 폴조지"/></label>
        {!normalizedQuery && <div className="search-guide"><b>후원자를 검색해보세요</b><span>누적 후원금과 후원 건수를 바로 확인할 수 있습니다.</span></div>}
        {normalizedQuery && !searchedDonor && <div className="search-guide"><b>검색 결과가 없습니다</b><span>닉네임을 다시 확인해주세요.</span></div>}
        {searchedDonor && <div className="donor-result"><span>검색된 후원자</span><strong>{searchedDonor.donorName}</strong><dl><div><dt>현재 순위</dt><dd>{searchedIndex+1}위</dd></div><div><dt>누적 후원금</dt><dd>{formatWon(searchedDonor.amount)}원</dd></div><div><dt>후원 건수</dt><dd>{searchedDonor.count}건</dd></div></dl></div>}
      </section>
      <section className="panel wide test-panel test-panel-bottom"><div className="panel-title"><div><span className="section-kicker">TEST TOOL</span><h3>후원 수동 추가</h3></div><span>테스트 및 누락 내역 입력용</span></div>
        <form onSubmit={submit}><label>입금자명<input placeholder="예: 폴조지" value={form.donorName} onChange={e=>setForm({...form,donorName:e.target.value})}/></label><label>금액<input type="number" min="1" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label>입금 경로<input placeholder="예: 카카오뱅크" value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})}/></label><button>후원 리스트에 추가</button></form>
      </section>
    </main>
  </div></PageLayout>;
}

function Empty(){ return <p className="empty">아직 입금 내역이 없습니다.</p>; }

const FONT_OPTIONS = [
  ['Pretendard, "Noto Sans KR", sans-serif','Pretendard'], ['"Noto Sans KR", sans-serif','Noto Sans KR'], ['"Noto Serif KR", serif','Noto Serif KR'],
  ['"Nanum Gothic", sans-serif','나눔고딕'], ['"Nanum Myeongjo", serif','나눔명조'], ['"NanumSquare", sans-serif','나눔스퀘어'], ['"NanumSquareRound", sans-serif','나눔스퀘어라운드'],
  ['"Gmarket Sans", sans-serif','G마켓 산스'], ['"S-Core Dream", sans-serif','에스코어 드림'], ['"Spoqa Han Sans Neo", sans-serif','스포카 한 산스'],
  ['"Apple SD Gothic Neo", sans-serif','Apple SD Gothic Neo'], ['"Malgun Gothic", sans-serif','맑은 고딕'], ['"Arial", sans-serif','Arial'],
  ['"Arial Black", sans-serif','Arial Black'], ['Impact, sans-serif','Impact'], ['Georgia, serif','Georgia'], ['cursive','손글씨 계열'], ['monospace','고정폭 계열']
];
const ENTER_EFFECTS = [['fade','부드럽게 나타나기'],['zoom','확대 등장'],['slide-up','아래에서 올라오기'],['slide-down','위에서 내려오기'],['slide-left','오른쪽에서 밀려오기'],['slide-right','왼쪽에서 밀려오기'],['bounce','통통 튀기'],['flip','뒤집기'],['pulse','강조 맥박'],['shake','좌우 흔들기']];
const EXIT_EFFECTS = [['fade-out','부드럽게 사라지기'],['zoom-out','축소하며 사라지기'],['slide-down-out','아래로 사라지기'],['slide-up-out','위로 사라지기']];
const SOUND_OPTIONS = [['coin','코인'],['chime','차임벨'],['pop','팝'],['fanfare','팡파르'],['custom','직접 추가한 음원'],['none','소리 없음']];
const RANKING_THEMES = [['midnight','미드나이트','1 2 3'],['clean','화이트 표','01 02 03'],['neon','네온 배지','① ② ③'],['gold','메달','🥇 🥈 🥉'],['rose','리본','1st 2nd 3rd'],['ocean','오션 카드','TOP 1'],['forest','포레스트','◆ 1'],['lavender','라벤더 카드','1위'],['mono','모노 숫자','01'],['transparent','투명 미니멀','1.'],['custom','직접 설정','내 스타일']];
function rankMarker(theme,index){const rank=index+1;if(theme==='gold'&&rank<=3)return ['🥇','🥈','🥉'][index];if(theme==='rose'&&rank<=3)return `${rank}${['st','nd','rd'][index]}`;if(theme==='clean')return String(rank).padStart(2,'0');if(theme==='ocean')return rank<=3?`TOP ${rank}`:rank;if(theme==='forest')return `◆ ${rank}`;if(theme==='lavender')return `${rank}위`;if(theme==='mono')return String(rank).padStart(2,'0');if(theme==='transparent')return `${rank}.`;return rank;}
const soundOptions = settings => [...SOUND_OPTIONS.filter(([value])=>value!=='custom'),...(settings.soundLibrary||[]).map(sound=>[`library:${sound.id}`,`내 음원 · ${sound.name}`]),['custom','기존 직접 추가 음원']];
const soundData = (settings,preset,fallback='') => preset?.startsWith('library:') ? (settings.soundLibrary||[]).find(sound=>sound.id===preset.slice(8))?.data||'' : preset==='custom' ? fallback||settings.customSoundData : '';

function resolveTier(settings, amount=50000) {
  return [...(settings.amountTiers || [])].filter(tier=>tier.enabled!==false && amount>=Number(tier.minAmount||0) && (tier.maxAmount==null || amount<=Number(tier.maxAmount))).sort((a,b)=>Number(b.minAmount)-Number(a.minAmount))[0] || null;
}

function alertAppearance(settings, amount=50000) {
  const tier = resolveTier(settings, amount);
  const customText = tier?.textMode === 'custom';
  const customEffect = tier?.effectMode === 'custom';
  const customSound = tier?.soundMode === 'custom';
  const family = customText ? tier.fontFamily : (settings.customFontFamily?.trim() || settings.fontFamily);
  return {
    tier,
    messageTemplate:tier?.messageMode === 'custom' && tier.messageTemplate ? tier.messageTemplate : settings.messageTemplate,
    animation:customEffect ? tier.animation : settings.animation,
    exitAnimation:customEffect ? tier.exitAnimation : settings.exitAnimation,
    durationMs:customEffect ? tier.durationMs : settings.durationMs,
    soundPreset:customSound ? tier.soundPreset : settings.soundPreset,
    soundVolume:customSound ? tier.soundVolume : settings.soundVolume,
    customSoundData:soundData(settings,customSound?tier.soundPreset:settings.soundPreset,customSound?tier.customSoundData:settings.customSoundData),
    style:{ color:customText?tier.textColor:settings.textColor,fontSize:customText?tier.fontSize:settings.fontSize,fontWeight:customText?tier.fontWeight:settings.fontWeight,fontFamily:family,textAlign:settings.textAlign,lineHeight:settings.lineHeight,letterSpacing:`${settings.letterSpacing}px`,
      WebkitTextStroke:`${customText?tier.outlineWidth:settings.outlineWidth}px ${customText?tier.outlineColor:settings.outlineColor}`,textShadow:settings.textShadow?'0 5px 16px #000b':'none',padding:settings.backgroundEnabled?`${settings.backgroundPadding}px`:'0',borderRadius:settings.backgroundEnabled?`${settings.backgroundRadius}px`:'0',
      background:settings.backgroundEnabled?`color-mix(in srgb, ${settings.backgroundColor} ${settings.backgroundOpacity*100}%, transparent)`:'transparent' }
  };
}

function playAlertSound(settings, preset=settings.soundPreset, volume=settings.soundVolume, customSoundData=settings.customSoundData) {
  if (!settings.soundEnabled || preset==='none') return;
  if (preset==='custom' && customSoundData) { const audio=new Audio(customSoundData); audio.volume=volume/100; audio.play().catch(()=>{}); return; }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context=new AudioContext(); const gain=context.createGain(); gain.connect(context.destination); gain.gain.setValueAtTime(Math.max(.01,volume/100)*.18,context.currentTime);
  const notes={coin:[880,1320],chime:[523,659,784],pop:[320,180],fanfare:[523,659,784,1046]}[preset] || [660];
  notes.forEach((frequency,index)=>{ const oscillator=context.createOscillator(); oscillator.type=preset==='pop'?'triangle':'sine'; oscillator.frequency.value=frequency; oscillator.connect(gain); const start=context.currentTime+index*.1; oscillator.start(start); oscillator.stop(start+.16); });
  setTimeout(()=>context.close(),1200);
}

function TierMode({ title, description, mode='inherit', onChange, children }) {
  return <section className="tier-mode"><div className="tier-mode-head"><div><b>{title}</b><small>{description}</small></div><div className="inherit-selector"><button type="button" className={mode!=='custom'?'active':''} onClick={()=>onChange('inherit')}>기본 설정 사용</button><button type="button" className={mode==='custom'?'active':''} onClick={()=>onChange('custom')}>이 구간만 다르게</button></div></div>{children&&<div className="tier-mode-body">{children}</div>}</section>;
}

function Settings({ mode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState('');
  const [previewRun, setPreviewRun] = useState(0);
  const [openTiers, setOpenTiers] = useState({});
  useEffect(() => { api('/api/settings').then(setSettings); }, []);
  const update = (key, value) => { setSettings(current => ({ ...current, [key]: value })); setPreviewRun(current=>current+1); };
  async function persistSettings() { const next=await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)});setSettings(next);return next; }
  async function save(event) {
    event.preventDefault();
    await persistSettings();
    setSaved(mode === 'alert' ? '알림 설정을 저장했습니다. 다음 후원 알림부터 적용됩니다.' : '후원 순위표 설정을 저장했습니다. OBS 순위표에 바로 적용됩니다.');
  }
  async function openWidgetPreview() { const popup=window.open('about:blank','_blank');try{await persistSettings();if(popup)popup.location.href=isAlert?'/overlay?preview=1':'/ranking';setSaved('현재 설정을 저장하고 예시 화면을 열었습니다.');}catch(error){popup?.close();setSaved(error.message||'예시 화면을 열지 못했습니다.');} }
  const appearance = alertAppearance(settings,50000);
  const preview = appearance.messageTemplate.replaceAll('{name}','폴조지').replaceAll('{amount}','50,000').replaceAll('{grade}',settings.crewGradeEnabled?'[크루 VIP] ':'');
  const style = appearance.style;
  const isAlert = mode === 'alert';
  const addTier = () => { const id=crypto.randomUUID(); update('amountTiers',[...(settings.amountTiers||[]),{id,draft:true,name:`${(settings.amountTiers||[]).length+1}구간`,minAmount:100000,maxAmount:null,enabled:true,messageMode:'inherit',messageTemplate:'',textMode:'inherit',fontFamily:settings.fontFamily,fontSize:settings.fontSize,fontWeight:settings.fontWeight,textColor:settings.textColor,outlineColor:settings.outlineColor,outlineWidth:settings.outlineWidth,effectMode:'inherit',animation:settings.animation,exitAnimation:settings.exitAnimation,durationMs:settings.durationMs,soundMode:'inherit',soundPreset:settings.soundPreset,soundVolume:settings.soundVolume,customSoundName:'',customSoundData:''}]); setOpenTiers(current=>({...current,[id]:true})); };
  const changeTier = (id,key,value) => update('amountTiers',(settings.amountTiers||[]).map(tier=>tier.id===id?{...tier,[key]:value}:tier));
  const removeTier = id => { update('amountTiers',(settings.amountTiers||[]).filter(tier=>tier.id!==id)); setOpenTiers(current=>{const next={...current};delete next[id];return next;}); };
  const toggleTier = id => setOpenTiers(current=>({...current,[id]:!current[id]}));
  async function readSound(file) { if(file.size>1024*1024) throw new Error('효과음 파일은 1MB 이하만 사용할 수 있습니다.'); return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);}); }
  const changeRankStyle=(index,key,value)=>update('rankingRankStyles',(settings.rankingRankStyles||DEFAULT_SETTINGS.rankingRankStyles).map((style,i)=>i===index?{...style,[key]:value}:style));
  async function addLibrarySound(file,select) { if(!file)return; try { const data=await readSound(file); const id=crypto.randomUUID(); setSettings(current=>{ if((current.soundLibrary||[]).length>=10){setSaved('내 음원은 계정마다 최대 10개까지 보관할 수 있습니다.');return current;} return select({...current,soundLibrary:[...(current.soundLibrary||[]),{id,name:file.name,data}]},`library:${id}`); }); setSaved(`‘${file.name}’을 내 음원 보관함에 추가했습니다.`); } catch(error){setSaved(error.message);} }
  const loadSound = event => addLibrarySound(event.target.files?.[0],(current,preset)=>({...current,soundPreset:preset,soundEnabled:true}));
  const loadTierSound = (tierId,event) => addLibrarySound(event.target.files?.[0],(current,preset)=>({...current,amountTiers:(current.amountTiers||[]).map(tier=>tier.id===tierId?{...tier,soundPreset:preset}:tier)}));
  const removeLibrarySound = id => setSettings(current=>{const preset=`library:${id}`;return {...current,soundPreset:current.soundPreset===preset?'coin':current.soundPreset,soundLibrary:(current.soundLibrary||[]).filter(sound=>sound.id!==id),amountTiers:(current.amountTiers||[]).map(tier=>tier.soundPreset===preset?{...tier,soundPreset:'coin'}:tier)};});
  return <PageLayout><div className="shell"><header><div><span className="eyebrow">{isAlert?'DONATION ALERT':'DONATION RANKING'}</span><h1>{isAlert?'후원 알림 설정':'후원 순위표 설정'}</h1><p className="page-description">{isAlert?'새 후원이 들어왔을 때 나타나는 알림을 설정합니다.':'방송에 계속 표시할 누적 후원 순위표를 설정합니다.'}</p></div></header><main className="settings-grid"><form className="panel controls" onSubmit={save}>
    {isAlert ? <>
      <div className="control-section"><h3>알림 표시 기준</h3><p>기록된 후원 중 설정 금액 이상인 후원만 화면에 알립니다.</p></div>
      <label>알림 최소 금액 (원)<input type="number" min="0" step="100" value={settings.alertMinimumAmount} onChange={e=>update('alertMinimumAmount',Math.max(0,Number(e.target.value)))}/></label>
      <div className="control-section"><h3>알림 문구</h3><p><code>{'{name}'}</code> 후원자명 · <code>{'{amount}'}</code> 금액 · <code>{'{grade}'}</code> 크루 누적 등급</p></div>
      <label>알림 문구<textarea value={settings.messageTemplate} onChange={e=>update('messageTemplate',e.target.value)}/></label>
      <div className="control-section"><h3>글자 설정</h3><p>OBS가 실행되는 PC에 설치된 글꼴이 사용됩니다. 목록에 없는 글꼴은 직접 입력할 수 있습니다.</p></div>
      <label>글꼴<select value={settings.fontFamily} onChange={e=>update('fontFamily',e.target.value)}>{FONT_OPTIONS.map(([value,label])=><option value={value} key={label}>{label}</option>)}</select></label>
      <label>직접 입력할 글꼴명<input placeholder="예: 여기어때 잘난체" value={settings.customFontFamily||''} onChange={e=>update('customFontFamily',e.target.value)}/></label>
      <label>글자 크기<input type="range" min="20" max="160" value={settings.fontSize} onChange={e=>update('fontSize',Number(e.target.value))}/><span>{settings.fontSize}px</span></label>
      <label>글자 굵기<select value={settings.fontWeight} onChange={e=>update('fontWeight',Number(e.target.value))}>{[100,200,300,400,500,600,700,800,900].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>정렬<select value={settings.textAlign} onChange={e=>update('textAlign',e.target.value)}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
      <label>줄 간격<input type="range" min="0.8" max="2.5" step="0.05" value={settings.lineHeight} onChange={e=>update('lineHeight',Number(e.target.value))}/><span>{settings.lineHeight}</span></label>
      <label>자간<input type="range" min="-5" max="30" value={settings.letterSpacing} onChange={e=>update('letterSpacing',Number(e.target.value))}/><span>{settings.letterSpacing}px</span></label>
      <label>글자색<input type="color" value={settings.textColor} onChange={e=>update('textColor',e.target.value)}/></label><label>테두리 색상<input type="color" value={settings.outlineColor} onChange={e=>update('outlineColor',e.target.value)}/></label>
      <label>테두리 굵기<input type="range" min="0" max="12" step=".5" value={settings.outlineWidth} onChange={e=>update('outlineWidth',Number(e.target.value))}/><span>{settings.outlineWidth}px</span></label>
      <label className="toggle-label">글자 그림자<input type="checkbox" checked={settings.textShadow} onChange={e=>update('textShadow',e.target.checked)}/><i/></label>
      <div className="control-section"><h3>알림 배경</h3><p>기본값은 배경 없음입니다. 방송 화면 위에 글자만 투명하게 표시됩니다.</p></div>
      <label className="toggle-label">알림 배경 사용<input type="checkbox" checked={settings.backgroundEnabled} onChange={e=>update('backgroundEnabled',e.target.checked)}/><i/></label>
      {settings.backgroundEnabled&&<><label>배경색<input type="color" value={settings.backgroundColor} onChange={e=>update('backgroundColor',e.target.value)}/></label><label>배경 투명도<input type="range" min="0" max="1" step=".05" value={settings.backgroundOpacity} onChange={e=>update('backgroundOpacity',Number(e.target.value))}/><span>{Math.round(settings.backgroundOpacity*100)}%</span></label><label>안쪽 여백<input type="range" min="0" max="100" value={settings.backgroundPadding} onChange={e=>update('backgroundPadding',Number(e.target.value))}/><span>{settings.backgroundPadding}px</span></label><label>모서리 둥글기<input type="range" min="0" max="100" value={settings.backgroundRadius} onChange={e=>update('backgroundRadius',Number(e.target.value))}/><span>{settings.backgroundRadius}px</span></label></>}
      <div className="control-section"><h3>표시 효과</h3><p>알림이 나타나고 사라지는 방식과 화면에 머무는 시간을 정합니다.</p></div>
      <label>표시 시간 (초)<input type="range" min="1" max="30" step=".5" value={settings.durationMs/1000} onChange={e=>update('durationMs',Number(e.target.value)*1000)}/><span>{settings.durationMs/1000}초</span></label>
      <label>등장 효과<select value={settings.animation} onChange={e=>update('animation',e.target.value)}>{ENTER_EFFECTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label>퇴장 효과<select value={settings.exitAnimation} onChange={e=>update('exitAnimation',e.target.value)}>{EXIT_EFFECTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <div className="control-section"><h3>효과음</h3><p>기본 효과음을 고르거나 MP3·WAV·OGG 파일을 직접 추가할 수 있습니다.</p></div>
      <label className="toggle-label">효과음 사용<input type="checkbox" checked={settings.soundEnabled} onChange={e=>update('soundEnabled',e.target.checked)}/><i/></label>
      {settings.soundEnabled&&<><label>기본 효과음<select value={settings.soundPreset} onChange={e=>update('soundPreset',e.target.value)}>{soundOptions(settings).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>볼륨<input type="range" min="0" max="100" value={settings.soundVolume} onChange={e=>update('soundVolume',Number(e.target.value))}/><span>{settings.soundVolume}%</span></label><label className="sound-upload">내 음원 보관함에 추가<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={loadSound}/><small>{(settings.soundLibrary||[]).length}/10개 · 1MB 이하 MP3, WAV, OGG</small></label><button type="button" className="secondary-button" onClick={()=>playAlertSound(settings,appearance.soundPreset,appearance.soundVolume,appearance.customSoundData)}>효과음 미리 듣기</button>{(settings.soundLibrary||[]).length>0&&<div className="sound-library"><div><b>내 음원 관리</b><small>이 계정에서 기본 알림과 모든 금액 구간에 다시 사용할 수 있습니다.</small></div>{settings.soundLibrary.map(sound=><article key={sound.id}><span title={sound.name}>{sound.name}</span><button type="button" onClick={()=>playAlertSound(settings,`library:${sound.id}`,settings.soundVolume,sound.data)}>듣기</button><button type="button" className="danger" onClick={()=>removeLibrarySound(sound.id)}>삭제</button></article>)}</div>}</>}
      <div className="control-section tier-heading"><div><h3>금액대별 설정</h3><p>기본 알림 설정을 그대로 사용하고, 필요한 항목만 구간별로 다르게 바꿀 수 있습니다.</p></div><button type="button" onClick={addTier}>+ 구간 추가</button></div>
      <div className="tier-guide"><b>사용 방법</b><span>① 금액 범위를 정하고</span><span>② 바꾸고 싶은 항목만 ‘이 구간만 다르게’를 선택하세요.</span><span>③ 나머지는 위의 기본 설정이 자동으로 적용됩니다.</span></div>
      <div className="amount-tiers">{(settings.amountTiers||[]).map(tier=>{
        const customCount=['messageMode','textMode','effectMode','soundMode'].filter(key=>tier[key]==='custom').length;
        const isOpen=Boolean(openTiers[tier.id]);
        return <article className={tier.enabled===false?'tier-disabled':''} key={tier.id}>
          <div className="tier-card-head"><button type="button" className="tier-expand" onClick={()=>toggleTier(tier.id)} aria-expanded={isOpen}><span>{isOpen?'⌃':'⌄'}</span><div><b>{tier.name}</b><small>{formatWon(tier.minAmount||0)}원 ~ {tier.maxAmount==null?'제한 없음':`${formatWon(tier.maxAmount)}원`}</small></div></button><div className="tier-summary"><em className={customCount?'custom':''}>{customCount?`${customCount}개 별도 설정`:'모두 기본 설정'}</em><label className="mini-toggle"><input type="checkbox" checked={tier.enabled!==false} onChange={e=>changeTier(tier.id,'enabled',e.target.checked)}/><span>사용</span></label></div></div>
          <div className="inherit-chips"><span className={tier.messageMode==='custom'?'custom':''}>문구 · {tier.messageMode==='custom'?'별도':'기본'}</span><span className={tier.textMode==='custom'?'custom':''}>글자 · {tier.textMode==='custom'?'별도':'기본'}</span><span className={tier.effectMode==='custom'?'custom':''}>효과 · {tier.effectMode==='custom'?'별도':'기본'}</span><span className={tier.soundMode==='custom'?'custom':''}>효과음 · {tier.soundMode==='custom'?'별도':'기본'}</span></div>
          {isOpen&&<div className="tier-detail"><div className="tier-title"><label>구간 이름<input value={tier.name} onChange={e=>changeTier(tier.id,'name',e.target.value)}/></label><button type="button" onClick={()=>removeTier(tier.id)}>{tier.draft?'추가 취소':'구간 삭제'}</button></div><div className="tier-range"><label>최소 금액<input type="number" min="0" step="1000" value={tier.minAmount} onChange={e=>changeTier(tier.id,'minAmount',Number(e.target.value))}/></label><label>최대 금액<input type="number" min="0" step="1000" placeholder="제한 없음" value={tier.maxAmount??''} onChange={e=>changeTier(tier.id,'maxAmount',e.target.value===''?null:Number(e.target.value))}/></label></div>
            <TierMode title="알림 문구" description="후원자명과 금액이 들어가는 문장" mode={tier.messageMode} onChange={value=>changeTier(tier.id,'messageMode',value)}>{tier.messageMode==='custom'&&<label>이 구간 전용 문구<textarea value={tier.messageTemplate||''} onChange={e=>changeTier(tier.id,'messageTemplate',e.target.value)}/></label>}</TierMode>
            <TierMode title="글자 설정" description="글꼴·크기·굵기·색상·테두리" mode={tier.textMode} onChange={value=>changeTier(tier.id,'textMode',value)}>{tier.textMode==='custom'&&<div className="tier-custom-grid"><label>글꼴<select value={tier.fontFamily||settings.fontFamily} onChange={e=>changeTier(tier.id,'fontFamily',e.target.value)}>{FONT_OPTIONS.map(([value,label])=><option value={value} key={label}>{label}</option>)}</select></label><label>크기<input type="number" min="20" max="160" value={tier.fontSize||settings.fontSize} onChange={e=>changeTier(tier.id,'fontSize',Number(e.target.value))}/></label><label>굵기<select value={tier.fontWeight||settings.fontWeight} onChange={e=>changeTier(tier.id,'fontWeight',Number(e.target.value))}>{[100,200,300,400,500,600,700,800,900].map(value=><option key={value}>{value}</option>)}</select></label><label>글자색<input type="color" value={tier.textColor||settings.textColor} onChange={e=>changeTier(tier.id,'textColor',e.target.value)}/></label><label>테두리색<input type="color" value={tier.outlineColor||settings.outlineColor} onChange={e=>changeTier(tier.id,'outlineColor',e.target.value)}/></label><label>테두리 굵기<input type="number" min="0" max="12" step=".5" value={tier.outlineWidth??settings.outlineWidth} onChange={e=>changeTier(tier.id,'outlineWidth',Number(e.target.value))}/></label></div>}</TierMode>
            <TierMode title="표시 효과" description="등장·퇴장 효과와 표시 시간" mode={tier.effectMode} onChange={value=>changeTier(tier.id,'effectMode',value)}>{tier.effectMode==='custom'&&<div className="tier-custom-grid"><label>등장 효과<select value={tier.animation||settings.animation} onChange={e=>changeTier(tier.id,'animation',e.target.value)}>{ENTER_EFFECTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>퇴장 효과<select value={tier.exitAnimation||settings.exitAnimation} onChange={e=>changeTier(tier.id,'exitAnimation',e.target.value)}>{EXIT_EFFECTS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>표시 시간<input type="number" min="1" max="30" step=".5" value={(tier.durationMs||settings.durationMs)/1000} onChange={e=>changeTier(tier.id,'durationMs',Number(e.target.value)*1000)}/></label></div>}</TierMode>
            <TierMode title="효과음" description="기본 효과음이나 내 음원 보관함에서 선택" mode={tier.soundMode} onChange={value=>changeTier(tier.id,'soundMode',value)}>{tier.soundMode==='custom'&&<div className="tier-custom-grid"><label>효과음<select value={tier.soundPreset||settings.soundPreset} onChange={e=>changeTier(tier.id,'soundPreset',e.target.value)}>{soundOptions(settings).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>볼륨<input type="range" min="0" max="100" value={tier.soundVolume??settings.soundVolume} onChange={e=>changeTier(tier.id,'soundVolume',Number(e.target.value))}/><span>{tier.soundVolume??settings.soundVolume}%</span></label><label className="sound-upload">새 음원 추가<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={e=>loadTierSound(tier.id,e)}/><small>추가하면 내 음원 목록에 저장됩니다.</small></label><button type="button" className="secondary-button" onClick={()=>playAlertSound(settings,tier.soundPreset,tier.soundVolume,soundData(settings,tier.soundPreset,tier.customSoundData))}>구간 효과음 미리 듣기</button></div>}</TierMode>
          </div>}
        </article>;
      })}{!(settings.amountTiers||[]).length&&<p className="tier-empty">아직 금액 구간이 없습니다. ‘구간 추가’를 누르면 기본 설정을 그대로 물려받은 구간이 만들어집니다.</p>}</div>
      <div className="control-section"><h3>크루 누적 등급 표시</h3><p>등급명과 누적 금액 구간이 확정되면 크루 전체 누적액을 기준으로 <code>{'{grade}'}</code> 위치에 자동 표시됩니다.</p></div>
      <label className="toggle-label">등급 자동 표시 준비<input type="checkbox" checked={settings.crewGradeEnabled} onChange={e=>update('crewGradeEnabled',e.target.checked)}/><i/></label>
    </> : <>
      <div className="control-section"><h3>1. 표시 기준</h3><p>순위표에 포함할 후원과 표시 인원을 먼저 정합니다.</p></div>
      <label>최소 기록 금액 (원)<input type="number" min="0" step="100" value={settings.minimumDonationAmount} onChange={e=>update('minimumDonationAmount',Math.max(0,Number(e.target.value)))}/></label><label>표시 인원<input type="number" min="1" max="50" value={settings.rankingLimit} onChange={e=>update('rankingLimit',Math.min(50,Math.max(1,Number(e.target.value))))}/></label>
      <div className="control-section"><h3>2. 테마</h3><p>먼저 전체 분위기를 고른 뒤 아래에서 세부 값을 조절하세요.</p></div>
      <div className="ranking-theme-picker">{RANKING_THEMES.map(([value,label,marker])=><button type="button" key={value} className={`theme-swatch swatch-${value} ${settings.rankingTheme===value?'active':''}`} onClick={()=>{setSettings(current=>({...current,rankingTheme:value,rankingShowRank:true}));setPreviewRun(current=>current+1);}}><i><small>{marker}</small></i><span>{label}</span></button>)}</div>
      <label className="toggle-label ranking-background-toggle">순위표 배경 사용<input type="checkbox" checked={settings.rankingBackgroundEnabled} onChange={e=>update('rankingBackgroundEnabled',e.target.checked)}/><i/></label>
      {settings.rankingTheme==='custom'&&<div className="custom-theme-editor"><label>전체 배경색<input type="color" value={settings.rankingCustomBackground} onChange={e=>update('rankingCustomBackground',e.target.value)}/></label><label>테두리색<input type="color" value={settings.rankingCustomBorder} onChange={e=>update('rankingCustomBorder',e.target.value)}/></label><label>행 배경색<input type="color" value={settings.rankingCustomRowBackground} onChange={e=>update('rankingCustomRowBackground',e.target.value)}/></label><label>모서리 둥글기<input type="range" min="0" max="60" value={settings.rankingCustomRadius} onChange={e=>update('rankingCustomRadius',Number(e.target.value))}/><span>{settings.rankingCustomRadius}px</span></label><label>순위 표시 모양<select value={settings.rankingCustomMarker} onChange={e=>update('rankingCustomMarker',e.target.value)}><option value="circle">원형</option><option value="square">사각형</option><option value="pill">긴 배지</option><option value="plain">배경 없는 숫자</option></select></label></div>}
      <div className="control-section"><h3>3. 제목</h3><p>순위표 상단 제목을 사용하거나 숨길 수 있습니다.</p></div>
      <label className="toggle-label">제목 표시<input type="checkbox" checked={settings.rankingShowTitle} onChange={e=>update('rankingShowTitle',e.target.checked)}/><i/></label>{settings.rankingShowTitle&&<><label>제목 문구<input value={settings.rankingTitle} onChange={e=>update('rankingTitle',e.target.value)}/></label><label>제목 크기<input type="range" min="14" max="72" value={settings.rankingTitleSize} onChange={e=>update('rankingTitleSize',Number(e.target.value))}/><span>{settings.rankingTitleSize}px</span></label><label>제목 정렬<select value={settings.rankingTitleAlign} onChange={e=>update('rankingTitleAlign',e.target.value)}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><label>제목 색상<input type="color" value={settings.rankingTitleColor} onChange={e=>update('rankingTitleColor',e.target.value)}/></label></>}
      <div className="control-section"><h3>4. 글자와 문구</h3><p>닉네임과 금액의 크기·간격·색상·뒤 문구를 설정합니다.</p></div>
      <label>글자 크기<input type="range" min="16" max="72" value={settings.rankingFontSize} onChange={e=>update('rankingFontSize',Number(e.target.value))}/><span>{settings.rankingFontSize}px</span></label><label>글자 굵기<select value={settings.rankingFontWeight} onChange={e=>update('rankingFontWeight',Number(e.target.value))}>{[400,500,600,700,800,900].map(value=><option key={value}>{value}</option>)}</select></label><label className="toggle-label">줄 높이 직접 설정<input type="checkbox" checked={settings.rankingUseLineHeight} onChange={e=>update('rankingUseLineHeight',e.target.checked)}/><i/></label>{settings.rankingUseLineHeight&&<label>줄 높이<input type="range" min=".8" max="2" step=".05" value={settings.rankingLineHeight} onChange={e=>update('rankingLineHeight',Number(e.target.value))}/><span>{settings.rankingLineHeight}</span></label>}<label>자간<input type="range" min="-5" max="20" value={settings.rankingLetterSpacing} onChange={e=>update('rankingLetterSpacing',Number(e.target.value))}/><span>{settings.rankingLetterSpacing}px</span></label><label>행 간격<input type="range" min="0" max="40" value={settings.rankingRowGap} onChange={e=>update('rankingRowGap',Number(e.target.value))}/><span>{settings.rankingRowGap}px</span></label><label>열 간격<input type="range" min="0" max="80" value={settings.rankingColumnGap} onChange={e=>update('rankingColumnGap',Number(e.target.value))}/><span>{settings.rankingColumnGap}px</span></label><label>닉네임 뒤 문구<input placeholder="예: 님, 씨" value={settings.rankingNameSuffix} onChange={e=>update('rankingNameSuffix',e.target.value)}/></label><label>금액 뒤 문구<input placeholder="예: 원, 달러" value={settings.rankingAmountSuffix} onChange={e=>update('rankingAmountSuffix',e.target.value)}/></label><label>닉네임 색상<input type="color" value={settings.rankingNameColor} onChange={e=>update('rankingNameColor',e.target.value)}/></label><label>금액 색상<input type="color" value={settings.rankingAmountColor} onChange={e=>update('rankingAmountColor',e.target.value)}/></label>
      <div className="control-section"><h3>5. 정렬과 배치</h3><p>한 행 안의 배치와 여러 열로 넘어가는 기준을 정합니다.</p></div>
      <label>한 행 전체 정렬<select value={settings.rankingRowAlign} onChange={e=>update('rankingRowAlign',e.target.value)}><option value="spread">닉네임·금액 양쪽 배치</option><option value="left">한 묶음 왼쪽</option><option value="center">한 묶음 가운데</option><option value="right">한 묶음 오른쪽</option></select></label><label>닉네임 정렬<select value={settings.rankingNameAlign} onChange={e=>update('rankingNameAlign',e.target.value)}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><label>금액 정렬<select value={settings.rankingAmountAlign} onChange={e=>update('rankingAmountAlign',e.target.value)}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><label>열 수<input type="number" min="1" max="4" value={settings.rankingColumns} onChange={e=>update('rankingColumns',Number(e.target.value))}/></label><label>한 열의 인원<input type="number" min="1" max="20" value={settings.rankingRowsPerColumn} onChange={e=>update('rankingRowsPerColumn',Number(e.target.value))}/></label><label>등장 효과<select value={settings.rankingAnimation} onChange={e=>update('rankingAnimation',e.target.value)}><option value="none">효과 없음</option><option value="fade">부드럽게</option><option value="slide-up">아래에서</option><option value="slide-left">오른쪽에서</option><option value="zoom">확대</option><option value="stagger">순서대로</option></select></label><label className="toggle-label">순위 번호 표시<input type="checkbox" checked={settings.rankingShowRank} onChange={e=>update('rankingShowRank',e.target.checked)}/><i/></label><label className="toggle-label">후원 횟수 표시<input type="checkbox" checked={settings.rankingShowCount} onChange={e=>update('rankingShowCount',e.target.checked)}/><i/></label>
      <div className="control-section"><h3>6. 순위별 강조</h3><p>사용하면 1위·2위·3위와 4위 이하를 각각 다르게 표시합니다.</p></div>
      <label className="toggle-label">순위별 강조 사용<input type="checkbox" checked={settings.rankingRankHighlightEnabled!==false} onChange={e=>update('rankingRankHighlightEnabled',e.target.checked)}/><i/></label>
      {settings.rankingRankHighlightEnabled!==false&&<div className="rank-style-editor">{['1위','2위','3위','4위 이하'].map((label,index)=>{const rankStyle=(settings.rankingRankStyles||DEFAULT_SETTINGS.rankingRankStyles)[index];return <article key={label}><b>{label}</b><label>글자색<input type="color" value={rankStyle.color} onChange={e=>changeRankStyle(index,'color',e.target.value)}/></label><label>순위색<input type="color" value={rankStyle.badge} onChange={e=>changeRankStyle(index,'badge',e.target.value)}/></label><label>크기<input type="number" min="70" max="160" value={rankStyle.size} onChange={e=>changeRankStyle(index,'size',Number(e.target.value))}/></label><label>굵기<select value={rankStyle.weight} onChange={e=>changeRankStyle(index,'weight',Number(e.target.value))}>{[400,500,600,700,800,900].map(value=><option key={value}>{value}</option>)}</select></label></article>})}</div>}
    </>}
    <button>{isAlert?'알림 설정 저장':'후원 순위표 설정 저장'}</button>{saved&&<p className="saved">{saved}</p>}
  </form><section className="panel preview"><div className="preview-heading"><span>예시 미리보기 · {isAlert?'후원 알림':'후원 순위표'}</span>{isAlert&&<button type="button" onClick={()=>{setPreviewRun(value=>value+1);playAlertSound(settings,appearance.soundPreset,appearance.soundVolume,appearance.customSoundData);}}>예시 알림 다시 보기</button>}</div>{isAlert?<div className="preview-stage checkerboard"><div key={previewRun} className={`alert ${appearance.animation}`} style={style}><div className="alert-text">{preview.split('\n').map((line,i)=><div key={i}>{line}</div>)}</div></div></div>:<RankingPreview key={previewRun} settings={settings}/>}<div className="widget-links"><button type="button" onClick={openWidgetPreview}>{isAlert?'후원 알림 예시 화면 열기':'후원 순위표 화면 열기'}</button></div></section></main></div></PageLayout>;
}

function RankingPreview({ settings }) {
  const sample = [{ donorName:'폴조지', amount:150000, count:2 }, { donorName:'제병이', amount:100000, count:1 }, { donorName:'일집헬스', amount:50000, count:1 },{donorName:'행복한 조이킹',amount:30000,count:3},{donorName:'둥이운동',amount:20000,count:1},{donorName:'피스',amount:10000,count:1}];
  return <div className="ranking-preview"><RankingCard items={sample} settings={settings}/></div>;
}

function RankingCard({ items, settings }) {
  const visible=items.slice(0,settings.rankingLimit||10);const rows=Math.max(1,settings.rankingRowsPerColumn||10);const columns=Array.from({length:Math.min(settings.rankingColumns||1,Math.ceil(visible.length/rows)||1)},(_,column)=>visible.slice(column*rows,(column+1)*rows));
  const cardStyle={'--ranking-size':`${settings.rankingFontSize}px`,'--ranking-gap':`${settings.rankingRowGap}px`,'--column-gap':`${settings.rankingColumnGap}px`,'--line-height':settings.rankingUseLineHeight?settings.rankingLineHeight:'normal','--letter-spacing':`${settings.rankingLetterSpacing}px`,'--name-color':settings.rankingNameColor,'--amount-color':settings.rankingAmountColor,'--custom-bg':settings.rankingCustomBackground,'--custom-border':settings.rankingCustomBorder,'--custom-row':settings.rankingCustomRowBackground,'--custom-radius':`${settings.rankingCustomRadius}px`};
  return <div className={`widget-card theme-${settings.rankingTheme} ${settings.rankingBackgroundEnabled?'':'ranking-no-background'} marker-${settings.rankingCustomMarker} ranking-enter-${settings.rankingAnimation}`} style={cardStyle}>{settings.rankingShowTitle&&<h2 style={{fontSize:settings.rankingTitleSize,textAlign:settings.rankingTitleAlign,color:settings.rankingTitleColor}}>{settings.rankingTitle||'오늘의 후원'}</h2>}<div className="ranking-grid" style={{gridTemplateColumns:`repeat(${columns.length},minmax(0,1fr))`}}>{columns.map((column,columnIndex)=><div className="ranking-column" key={columnIndex}>{column.map((item,rowIndex)=>{const index=columnIndex*rows+rowIndex;const rankStyle=(settings.rankingRankStyles||DEFAULT_SETTINGS.rankingRankStyles)[Math.min(index,3)];const rankHighlight=settings.rankingRankHighlightEnabled!==false;return <div className={`widget-row rank-${index+1} row-${settings.rankingRowAlign}`} key={`${item.donorName}-${index}`} style={{'--rank-color':rankHighlight?rankStyle.color:settings.rankingNameColor,'--rank-badge':rankHighlight?rankStyle.badge:undefined,'--rank-scale':rankHighlight?rankStyle.size/100:1,'--rank-weight':rankHighlight?rankStyle.weight:settings.rankingFontWeight,'--delay':`${index*.07}s`}}><b style={{textAlign:settings.rankingNameAlign}}>{settings.rankingShowRank&&<em>{rankMarker(settings.rankingTheme,index)}</em>}<span className="donor-name">{item.donorName}{settings.rankingNameSuffix}</span>{settings.rankingShowCount&&<small>{item.count}회</small>}</b><span className="donor-amount" style={{textAlign:settings.rankingAmountAlign}}>{formatWon(item.amount)}{settings.rankingAmountSuffix}</span></div>})}</div>)}</div></div>;
}

function Widget() {
  const [data, setData] = useState({ ranking:[], settings:DEFAULT_SETTINGS });
  useEffect(() => { const load=()=>Promise.all([api('/api/widgets'), api('/api/settings')]).then(([widgets, settings])=>setData({ ranking:widgets.ranking, settings })); load(); const timer=setInterval(load,1000); return()=>clearInterval(timer); },[]);
  return <div className="widget"><RankingCard items={data.ranking} settings={data.settings}/></div>;
}

function Overlay() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [current, setCurrent] = useState(null);
  const lastId = useRef(0);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const queue = useRef([]);
  const playing = useRef(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const previewMode = new URLSearchParams(location.search).get('preview') === '1';
    let timer;
    const poll = async () => {
      try {
        const rows = await api(`/api/donations?after=${lastId.current}`);
        if (rows.length) { lastId.current = rows.at(-1).id; queue.current.push(...rows); play(); }
      } catch { /* 다음 폴링에서 재시도 */ }
    };
    api(previewMode?'/api/overlay/preview':'/api/overlay/bootstrap').then(({ settings:value, lastDonationId }) => {
      setSettings(value); settingsRef.current = value;
      if (previewMode) { setCurrent({ donorName:'폴조지', amount:50000 }); return; }
      lastId.current = lastDonationId;
      timer = setInterval(poll, 500);
    });
    return () => clearInterval(timer);
  }, []);

  function play() {
    if (playing.current || !queue.current.length) return;
    playing.current = true;
    const donation=queue.current.shift();
    setExiting(false); setCurrent(donation);
    const appearance=alertAppearance(settingsRef.current,donation.amount); playAlertSound(settingsRef.current,appearance.soundPreset,appearance.soundVolume,appearance.customSoundData);
    const duration=Math.max(1000,appearance.durationMs);
    setTimeout(()=>setExiting(true),Math.max(200,duration-500));
    setTimeout(() => { setCurrent(null); setExiting(false); playing.current = false; setTimeout(play, 350); }, duration);
  }

  if (!current) return <div className="overlay-stage"/>;
  const appearance=alertAppearance(settings,current.amount);
  const text = appearance.messageTemplate.replaceAll('{name}',current.donorName).replaceAll('{amount}',formatWon(current.amount)).replaceAll('{grade}',settings.crewGradeEnabled?(current.grade?`[${current.grade}] `:''):'');
  return <div className="overlay-stage"><div className={`alert ${exiting?appearance.exitAnimation:appearance.animation}`} style={appearance.style}><div className="alert-text">{text.split('\n').map((line,i)=><div key={i}>{line}</div>)}</div></div></div>;
}
