import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Chart from "react-apexcharts";
import { DEFAULT_SETTINGS, formatWon } from "@deposit-studio/shared";

const ROLE_LABELS = {
  super: "슈퍼 계정",
  admin: "관리자",
  member: "일반 계정",
};
const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);
const formatKoreanWon = (value) => {
  const amount = Math.max(0, Math.floor(Number(value) || 0));
  const billions = Math.floor(amount / 100000000);
  const tenThousands = Math.floor((amount % 100000000) / 10000);
  if (billions && tenThousands)
    return `${formatWon(billions)}억 ${formatWon(tenThousands)}만원`;
  if (billions) return `${formatWon(billions)}억원`;
  if (amount >= 10000) return `${formatWon(Math.floor(amount / 10000))}만원`;
  return `${formatWon(amount)}원`;
};

function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("deposit-studio-theme");
    return ["light", "system", "dark"].includes(savedTheme)
      ? savedTheme
      : "system";
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.themeMode = theme;
    };
    apply();
    localStorage.setItem("deposit-studio-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const themes = [
    ["light", "☀", "라이트"],
    ["system", "◐", "시스템"],
    ["dark", "☾", "다크"],
  ];
  return (
    <div className="theme-picker">
      <span>화면 테마</span>
      <div>
        {themes.map(([value, icon, label]) => (
          <button
            key={value}
            className={theme === value ? "active" : ""}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
          >
            <i aria-hidden="true">{icon}</i>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function apiUrl(path) {
  const configuredHost = import.meta.env.VITE_API_HOST;
  const baseUrl =
    import.meta.env.VITE_API_URL ||
    (configuredHost ? `https://${configuredHost}` : "");
  return `${baseUrl}${path}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const { retries = 0, ...fetchOptions } = options;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(apiUrl(path), {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: fetchOptions.signal || AbortSignal.timeout(25000),
        ...fetchOptions,
      });
      const body = await response.text();
      let data;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        const error = new Error(
          "서버가 시작 중입니다. 잠시 후 자동으로 다시 연결합니다.",
        );
        error.transient = true;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(data?.error || "요청에 실패했습니다.");
        error.transient = [502, 503, 504].includes(response.status);
        throw error;
      }
      if (data == null) {
        const error = new Error(
          "서버가 시작 중입니다. 잠시 후 자동으로 다시 연결합니다.",
        );
        error.transient = true;
        throw error;
      }
      return data;
    } catch (error) {
      const transient =
        error.transient ||
        error.name === "TypeError" ||
        error.name === "TimeoutError";
      if (transient && attempt < retries) {
        await wait(3000 * (attempt + 1));
        continue;
      }
      if (transient)
        throw new Error(
          "서버 연결이 늦어지고 있습니다. 잠시 후 다시 로그인해주세요.",
        );
      throw error;
    }
  }
}

export function App() {
  const [, setRoute] = useState(
    () => `${location.pathname}${location.search}${location.hash}`,
  );
  useEffect(() => {
    const navigate = () =>
      setRoute(`${location.pathname}${location.search}${location.hash}`);
    const handleClick = async (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target.closest?.("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${location.pathname}${location.search}${location.hash}`;
      if (next === current) return;
      if (
        window.__settingsNavigationGuard &&
        !(await window.__settingsNavigationGuard(next))
      )
        return;
      history.pushState({}, "", next);
      navigate();
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    addEventListener("popstate", navigate);
    document.addEventListener("click", handleClick);
    return () => {
      removeEventListener("popstate", navigate);
      document.removeEventListener("click", handleClick);
    };
  }, []);
  const overlayMatch = location.pathname.match(/^\/overlay\/([a-f0-9]{48})$/);
  const rankingMatch = location.pathname.match(/^\/ranking\/([a-f0-9]{48})$/);
  if (overlayMatch) return <Overlay token={overlayMatch[1]} />;
  if (rankingMatch) return <Widget token={rankingMatch[1]} />;
  if (location.pathname === "/overlay")
    return new URLSearchParams(location.search).get("preview") === "1" ? (
      <Overlay preview />
    ) : (
      <InvalidObsSource />
    );
  if (location.pathname === "/recent") return <Widget />;
  if (location.pathname === "/ranking") return <Widget type="ranking" />;
  return <AuthenticatedApp />;
}

function InvalidObsSource() {
  return (
    <div className="widget-source-error">
      OBS 연결 화면에서 계정 전용 주소를 다시 복사해주세요.
    </div>
  );
}

function AuthenticatedApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return <div className="auth-loading">로그인 상태를 확인하고 있습니다.</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <AuthenticatedRoutes />
    </AuthContext.Provider>
  );
}

function AuthenticatedRoutes() {
  const { user } = useAuth();
  const canManage = ["super", "admin"].includes(user.role);
  const isSuper = user.role === "super";
  if (location.pathname === "/" || location.pathname === "/my-dashboard")
    return <MyDashboard />;
  if (location.pathname === "/crew-dashboard") return <Dashboard />;
  if (location.pathname === "/deposits") return <DepositHistory />;
  if (location.pathname === "/deposits/live") return <LiveDepositPopup />;
  if (location.pathname === "/settings/youtube-donors") return <YoutubeDonorLinksPopup />;
  if (location.pathname === "/phone-test") return <PhoneTestPage />;
  if (location.pathname === "/admin/notification-rules") return isSuper ? <NotificationRules /> : <AccessDenied />;
  if (location.pathname === "/admin/api-logs") return canManage ? <ApiLogs /> : <AccessDenied />;
  if (location.pathname === "/admin/users") return <AdminAccounts />;
  if (location.pathname === "/obs") return <ObsSetup />;
  if (location.pathname === "/settings/ranking")
    return <Settings mode="ranking" />;
  if (location.pathname === "/settings" && location.hash === "#ranking")
    return <Settings mode="ranking" />;
  if (
    location.pathname === "/settings/alert" ||
    location.pathname === "/settings"
  )
    return <Settings mode="alert" />;
  return <MyDashboard />;
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ loginId: "", password: "" });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      onLogin(
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(form),
          retries: 5,
        }),
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span aria-hidden="true">N9</span>
          <div>
            <b>N9 SIGNAL</b>
          </div>
        </div>
        <div className="login-heading">
          <h1>로그인</h1>
        </div>
        <form onSubmit={submit}>
          <label>
            아이디
            <input
              autoFocus
              autoComplete="username"
              value={form.loginId}
              onChange={(e) => setForm({ ...form, loginId: e.target.value })}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {message && <p className="login-error">{message}</p>}
          <button disabled={submitting}>
            {submitting ? "확인 중..." : "로그인"}
          </button>
        </form>
      </section>
    </div>
  );
}

function AccessDenied() {
  return (
    <PageLayout>
      <div className="shell">
        <section className="panel access-denied">
          <h1>접근 권한이 없습니다</h1>
          <p>이 화면은 관리자 계정만 사용할 수 있습니다.</p>
        </section>
      </div>
    </PageLayout>
  );
}

const PAGE_INFO = {
  "/": ["후원 현황", "내 후원 현황"],
  "/my-dashboard": ["후원 현황", "내 후원 현황"],
  "/crew-dashboard": ["후원 현황", "크루 후원 현황"],
  "/deposits": ["후원 관리", "입금 내역"],
  "/settings/alert": ["내 방송", "후원 알림 설정"],
  "/settings": ["내 방송", "후원 알림 설정"],
  "/settings/ranking": ["내 방송", "후원 순위표 설정"],
  "/obs": ["내 방송", "OBS 연결"],
  "/phone-test": ["내 방송", "휴대폰 연동 테스트"],
  "/admin/users": ["관리", "계정 관리"],
  "/admin/notification-rules": ["관리", "알림 파싱 규칙"],
  "/admin/api-logs": ["관리", "API 로그"],
};

async function resizeAvatar(file) {
  if (!file.type.startsWith("image/"))
    throw new Error("이미지 파일을 선택해주세요.");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("원본 이미지는 8MB 이하만 사용할 수 있습니다.");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = reject;
    value.src = source;
  });
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const context = canvas.getContext("2d");
  context.drawImage(
    image,
    (image.naturalWidth - size) / 2,
    (image.naturalHeight - size) / 2,
    size,
    size,
    0,
    0,
    400,
    400,
  );
  return canvas.toDataURL("image/jpeg", 0.84);
}

function ProfileDialog({ mode, onClose, forced = false }) {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({
    displayName: user.displayName,
    avatar: user.avatar || null,
  });
  const [password, setPassword] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function readAvatar(event) {
    try {
      const file = event.target.files?.[0];
      if (file) {
        const avatar = await resizeAvatar(file);
        setProfile((value) => ({ ...value, avatar }));
      }
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const updated = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      setUser(updated);
      setMessage("내 정보가 저장되었습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }
  async function savePassword(event) {
    event.preventDefault();
    setMessage("");
    if (password.newPassword !== password.confirmPassword)
      return setMessage("새 비밀번호가 서로 일치하지 않습니다.");
    setSaving(true);
    try {
      await api("/api/profile/password", {
        method: "PUT",
        body: JSON.stringify(password),
      });
      setUser({ ...user, mustChangePassword: 0 });
      setMessage("비밀번호를 변경했습니다.");
      setPassword({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      if (forced) onClose();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!forced && event.target === event.currentTarget) onClose();
      }}
    >
      <section className="profile-dialog" role="dialog" aria-modal="true">
        <div className="dialog-title">
          <div>
            <small>{forced ? "첫 로그인 보호" : "내 계정"}</small>
            <h2>
              {mode === "profile"
                ? "프로필 설정"
                : forced
                  ? "새 비밀번호를 설정해주세요"
                  : "비밀번호 변경"}
            </h2>
            {forced && <p>초기 비밀번호를 계속 사용할 수 없습니다.</p>}
          </div>
          {!forced && (
            <button onClick={onClose} aria-label="닫기">
              ×
            </button>
          )}
        </div>
        {mode === "profile" ? (
          <form onSubmit={saveProfile}>
            <div className="avatar-editor">
              {profile.avatar ? (
                <img src={profile.avatar} alt="프로필 미리보기" />
              ) : (
                <span>{profile.displayName.slice(0, 1) || "?"}</span>
              )}
              <div>
                <label className="file-button">
                  사진 선택
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={readAvatar}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setProfile((value) => ({ ...value, avatar: null }))
                  }
                >
                  사진 삭제
                </button>
                <small>사진은 정사각형으로 자동 조정됩니다.</small>
              </div>
            </div>
            <label>
              표시 이름
              <input
                maxLength="20"
                value={profile.displayName}
                onChange={(event) =>
                  setProfile({ ...profile, displayName: event.target.value })
                }
              />
            </label>
            <label>
              로그인 아이디
              <input value={user.loginId} disabled />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button" disabled={saving}>
              {saving ? "저장 중..." : "변경사항 저장"}
            </button>
          </form>
        ) : (
          <form onSubmit={savePassword}>
            <PasswordField
              label="현재 비밀번호"
              autoComplete="current-password"
              value={password.currentPassword}
              onChange={(value) =>
                setPassword({ ...password, currentPassword: value })
              }
            />
            <PasswordField
              label="새 비밀번호"
              autoComplete="new-password"
              value={password.newPassword}
              onChange={(value) =>
                setPassword({ ...password, newPassword: value })
              }
              hint="8자 이상, 영문·숫자·특수문자 포함"
            />
            <PasswordField
              label="새 비밀번호 확인"
              autoComplete="new-password"
              value={password.confirmPassword}
              onChange={(value) =>
                setPassword({ ...password, confirmPassword: value })
              }
            />
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button" disabled={saving}>
              {saving ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <div className="password-field">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="password-field-actions">
          <button
            type="button"
            onClick={() => setVisible((state) => !state)}
            aria-label={`${label} ${visible ? "숨기기" : "보기"}`}
            aria-pressed={visible}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={
                  visible
                    ? "M2 2l20 20M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.5 10.5 0 0112 4c6.5 0 10 8 10 8a17 17 0 01-3.1 4.4M6.6 6.6C3.6 8.5 2 12 2 12s3.5 8 10 8a9.8 9.8 0 004.1-.9"
                    : "M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12zm10 3a3 3 0 110-6 3 3 0 010 6z"
                }
              />
            </svg>
          </button>
          {value && (
            <button
              className="password-clear"
              type="button"
              onClick={() => onChange("")}
              aria-label={`${label} 전체 삭제`}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function PageLayout({ children }) {
  const { user, setUser } = useAuth();
  const [profileMenu, setProfileMenu] = useState(false);
  const [dialog, setDialog] = useState(
    user.mustChangePassword ? "password" : null,
  );
  const path = location.pathname;
  const activePath =
    path === "/my-dashboard"
      ? "/"
      : path === "/settings"
        ? "/settings/alert"
        : path;
  const canManage = ["super", "admin"].includes(user.role);
  const openLiveManager = () => {
    const popup = window.open(
      "/deposits/live",
      "n9-live-deposits",
      "popup=yes,width=900,height=600",
    );
    popup?.focus();
  };
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }
  const NAV_ICONS = {
    "/": "⌁",
    "/crew-dashboard": "◫",
    "/deposits": "₩",
    "/settings/alert": "◉",
    "/settings/ranking": "≡",
    "/obs": "↗",
    "/phone-test": "⌁",
    "/admin/users": "♙",
    "/admin/notification-rules": "⌘",
    "/admin/api-logs": "≣",
  };
  const Link = ({ href, label, hint }) => (
    <a className={activePath === href ? "active" : ""} href={href}>
      <span className="nav-icon" aria-hidden="true">
        {NAV_ICONS[href]}
      </span>
      <span className="nav-copy">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </a>
  );
  const [pageGroup, pageTitle] = PAGE_INFO[path] || ["", "N9 SIGNAL"];
  return (
    <div className="app-layout">
      <aside className="side-menu">
        <a className="brand" href="/">
          <span aria-hidden="true">N9</span>
          <b>N9 SIGNAL</b>
          <small>CREW DONATION</small>
        </a>
        <nav className="side-nav" aria-label="주 메뉴">
          <span className="nav-label">후원 현황</span>
          <Link href="/" label="내 후원 현황" hint="나의 방송과 후원 통계" />
          <Link
            href="/crew-dashboard"
            label="크루 후원 현황"
            hint="크루 전체 후원자 현황"
          />
          <span className="nav-label nav-group">후원 관리</span>
          <Link
            href="/deposits"
            label="입금 내역"
            hint="날짜별 입금과 입금자명 관리"
          />
          <span className="nav-label nav-group">내 방송</span>
          <Link
            href="/settings/alert"
            label="후원 알림 설정"
            hint="문구 · 디자인 · 표시 시간"
          />
          <Link
            href="/settings/ranking"
            label="후원 순위표 설정"
            hint="순위 · 테마 · 표시 인원"
          />
          <Link
            href="/obs"
            label="OBS 연결"
            hint="송출 주소 · 해상도 · 미리보기"
          />
          <Link href="/phone-test" label="휴대폰 연동 테스트" hint="실시간 API 수신 확인" />
          {canManage && (
            <>
              <span className="nav-label nav-group">관리</span>
              <Link
                href="/admin/users"
                label="계정 관리"
                hint="크루 멤버와 권한"
              />
              {user.role === "super" && <Link href="/admin/notification-rules" label="알림 파싱 규칙" hint="앱 패키지별 정규식" />}
              <Link href="/admin/api-logs" label="API 로그" hint="요청과 응답 기록" />
            </>
          )}
        </nav>
        <ThemeSelector />
      </aside>
      <div className="app-content">
        <div className="top-bar">
          <div className="page-crumb">
            <small>{pageGroup}</small>
            <i>›</i>
            <strong>{pageTitle}</strong>
          </div>
          <div className="top-profile">
            <button className="live-manager-launch" onClick={openLiveManager}>
              <i aria-hidden="true" />
              <span>방송 실시간 관리</span>
            </button>
            <button
              className="profile-trigger"
              onClick={() => setProfileMenu((value) => !value)}
              aria-expanded={profileMenu}
            >
              {user.avatar ? (
                <img src={user.avatar} alt="" />
              ) : (
                <span>{user.displayName.slice(0, 1)}</span>
              )}
              <div>
                <b>{user.displayName}</b>
                <small>{ROLE_LABELS[user.role]}</small>
              </div>
              <i>⌄</i>
            </button>
            {profileMenu && (
              <div className="profile-menu">
                <div>
                  <b>{user.displayName}</b>
                  <small>{user.loginId}</small>
                </div>
                <button
                  onClick={() => {
                    setDialog("profile");
                    setProfileMenu(false);
                  }}
                >
                  프로필 사진 및 내 정보
                </button>
                <button
                  onClick={() => {
                    setDialog("password");
                    setProfileMenu(false);
                  }}
                >
                  비밀번호 변경
                </button>
                <button className="menu-logout" onClick={logout}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="page-body">{children}</div>
      </div>
      {dialog && (
        <ProfileDialog
          mode={dialog}
          forced={Boolean(user.mustChangePassword)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

const DONOR_PAGE_SIZE = 50;
const DONOR_ROW_HEIGHT = 64;
const DONOR_LIST_HEIGHT = 520;

function VirtualDonorList({
  endpoint,
  title,
  kicker,
  totalLabel = "명",
  className = "",
}) {
  const viewportRef = useRef(null);
  const loadedPages = useRef(new Set());
  const loadingPages = useRef(new Set());
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  async function loadPage(page) {
    if (
      page < 0 ||
      loadedPages.current.has(page) ||
      loadingPages.current.has(page)
    )
      return;
    loadingPages.current.add(page);
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const result = await api(
        `${endpoint}${separator}offset=${page * DONOR_PAGE_SIZE}&limit=${DONOR_PAGE_SIZE}`,
      );
      setTotal(result.total);
      setItems((previous) => {
        const next = previous.slice();
        next.length = result.total;
        result.items.forEach((item, index) => {
          next[result.offset + index] = item;
        });
        return next;
      });
      loadedPages.current.add(page);
    } finally {
      loadingPages.current.delete(page);
    }
  }

  useEffect(() => {
    loadedPages.current.clear();
    loadingPages.current.clear();
    setItems([]);
    setTotal(0);
    setScrollTop(0);
    setSearchResult(null);
    setHasSearched(false);
    setSearchMessage("");
    viewportRef.current?.scrollTo({ top: 0 });
    loadPage(0);
  }, [endpoint]);

  const startIndex = Math.max(0, Math.floor(scrollTop / DONOR_ROW_HEIGHT) - 5);
  const endIndex = Math.min(
    total,
    Math.ceil((scrollTop + DONOR_LIST_HEIGHT) / DONOR_ROW_HEIGHT) + 5,
  );
  useEffect(() => {
    if (!total) return;
    const firstPage = Math.floor(startIndex / DONOR_PAGE_SIZE);
    const lastPage = Math.floor(
      Math.max(startIndex, endIndex - 1) / DONOR_PAGE_SIZE,
    );
    for (let page = firstPage; page <= lastPage; page += 1) loadPage(page);
  }, [startIndex, endIndex, total, endpoint]);

  async function search(event) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      setSearchMessage("닉네임을 입력해주세요.");
      return;
    }
    setHasSearched(true);
    const separator = endpoint.includes("?") ? "&" : "?";
    const result = await api(
      `${endpoint}${separator}offset=0&limit=1&query=${encodeURIComponent(normalized)}`,
    );
    if (!result.match) {
      setSearchMessage("검색 결과가 없습니다.");
      setSearchResult(null);
      return;
    }
    setSearchResult(result.match);
    setSearchMessage(`${result.match.donorName} 검색 결과`);
  }

  const visibleItems = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = items[index];
    visibleItems.push(
      <li
        className={item ? "" : "donor-row-loading"}
        style={{
          position: "absolute",
          top: index * DONOR_ROW_HEIGHT,
          height: DONOR_ROW_HEIGHT,
          left: 0,
          right: 0,
        }}
        key={item?.donorName || `loading-${index}`}
      >
        <i>{index + 1}</i>
        {item ? (
          <>
            <strong>
              {item.donorName}
              <small>{item.count}회 후원</small>
            </strong>
            <span>{formatWon(item.amount)}원</span>
          </>
        ) : (
          <strong>
            <small>불러오는 중...</small>
          </strong>
        )}
      </li>,
    );
  }

  function changeQuery(event) {
    const value = event.target.value;
    setQuery(value);
    if (!value.trim()) {
      setSearchResult(null);
      setHasSearched(false);
      setSearchMessage("");
    }
  }

  return (
    <section className={`panel donor-list-panel ${className}`}>
      <div className="panel-title">
        <div>
          <span className="section-kicker">{kicker}</span>
          <h3>{title}</h3>
        </div>
        <span>
          전체 {total}
          {totalLabel}
        </span>
      </div>
      <form className="donor-list-search" onSubmit={search}>
        <input
          value={query}
          onChange={changeQuery}
          placeholder="후원자 닉네임 검색"
          aria-label="후원자 닉네임 검색"
        />
        <button>검색</button>
      </form>
      <div className="donor-search-status" aria-live="polite">
        {searchMessage}
      </div>
      {hasSearched ? (
        searchResult ? (
          <ol className="ranking ranking-large donor-search-result">
            <li>
              <i>{Number(searchResult.donorIndex) + 1}</i>
              <strong>
                {searchResult.donorName}
                <small>{searchResult.count}회 후원</small>
              </strong>
              <span>{formatWon(searchResult.amount)}원</span>
            </li>
          </ol>
        ) : (
          <Empty />
        )
      ) : total ? (
        <div
          className="virtual-donor-viewport"
          ref={viewportRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <ol
            className="ranking ranking-large virtual-donor-list"
            style={{ height: total * DONOR_ROW_HEIGHT }}
          >
            {visibleItems}
          </ol>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}

function MyDashboard() {
  const donationStatsStartMonth = "2026-09";
  const { user } = useAuth();
  const [data, setData] = useState({
    summary: {
      totalAmount: 0,
      donationCount: 0,
      donorCount: 0,
      averageAmount: 0,
    },
    donors: [],
    weekdays: [],
    days: [],
    months: [],
    hours: [],
    largestDonation: null,
  });
  const [weekData, setWeekData] = useState({ days: [] });
  const [trendPeriod, setTrendPeriod] = useState("week");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setMessage("");
    Promise.all([
      api("/api/my/analytics?period=month"),
      api("/api/my/analytics?period=7d"),
    ])
      .then(([month, week]) => {
        setData(month);
        setWeekData(week);
      })
      .catch((error) => setMessage(error.message));
  }, []);
  const months = Array.from({ length: 12 }, (_, offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (11 - offset));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const found = data.months.find((item) => item.month === key);
    return {
      label: `${date.getMonth() + 1}월`,
      key,
      amount: Number(found?.amount || 0),
      count: Number(found?.count || 0),
      donorCount: Number(found?.donorCount || 0),
    };
  });
  const weekDays = (() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    const items = [];
    for (
      const date = new Date(start);
      date <= today;
      date.setDate(date.getDate() + 1)
    ) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      items.push({
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        amount: Number(
          weekData.days?.find((item) => item.day === key)?.amount || 0,
        ),
        note:
          key ===
          `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
            ? "오늘"
            : "",
      });
    }
    return items;
  })();
  const trendItems = trendPeriod === "week" ? weekDays : months;
  const currentMonthLabel = `${new Date().getMonth() + 1}월`;
  const averageMonths = months.filter(
    (item) => item.key >= donationStatsStartMonth,
  );
  const averageMonthCount = Math.max(1, averageMonths.length);
  const monthlyAverageAmount = Math.round(
    averageMonths.reduce((sum, item) => sum + item.amount, 0) /
      averageMonthCount,
  );
  const monthlyAverageDonors =
    Math.round(
      (averageMonths.reduce((sum, item) => sum + item.donorCount, 0) /
        averageMonthCount) *
        10,
    ) / 10;
  const monthlyAverageCount =
    Math.round(
      (averageMonths.reduce((sum, item) => sum + item.count, 0) /
        averageMonthCount) *
        10,
    ) / 10;
  return (
    <PageLayout>
      <div className="shell">
        <header>
          <div>
            <span className="eyebrow">MY DONATION ANALYTICS</span>
            <h1>{user.displayName}님의 후원 현황</h1>
            <p className="page-description">
              이번 달 후원 흐름과 후원자 데이터를 정리합니다.
            </p>
          </div>
        </header>
        <section className="dashboard-kpis personal-kpis">
          <article className="kpi primary">
            <span>{currentMonthLabel} 후원금</span>
            <strong>
              {formatWon(Number(data.summary.totalAmount) || 0)}
              <small>원</small>
            </strong>
          </article>
          <article className="kpi">
            <span>월별 평균 후원자 수</span>
            <strong>
              {monthlyAverageDonors}
              <small>명</small>
            </strong>
            <p>2026년 9월부터</p>
          </article>
          <article className="kpi">
            <span>월별 평균 후원 건수</span>
            <strong>
              {monthlyAverageCount}
              <small>건</small>
            </strong>
            <p>2026년 9월부터</p>
          </article>
          <article className="kpi">
            <span>월별 평균 후원</span>
            <strong>
              {formatWon(monthlyAverageAmount)}
              <small>원</small>
            </strong>
            <p>2026년 9월부터</p>
          </article>
        </section>
        {message && <p className="notice">{message}</p>}
        <main className="analytics-grid">
          <AnalyticsChart
            className="dashboard-trend"
            title={
              trendPeriod === "week"
                ? "최근 1주일 후원 추이"
                : "최근 1년 후원 추이"
            }
            caption={trendPeriod === "week" ? "일별 후원금액" : "월별 후원금액"}
            items={trendItems}
            chartType={trendPeriod === "week" ? "area" : "bar"}
            controls={
              <div className="chart-segment">
                <button
                  className={trendPeriod === "week" ? "active" : ""}
                  onClick={() => setTrendPeriod("week")}
                >
                  최근 1주일
                </button>
                <button
                  className={trendPeriod === "year" ? "active" : ""}
                  onClick={() => setTrendPeriod("year")}
                >
                  최근 1년
                </button>
              </div>
            }
          />
          <VirtualDonorList
            endpoint="/api/my/donors?period=all"
            title="전체 후원자 목록"
            kicker="MY DONORS"
          />
        </main>
      </div>
    </PageLayout>
  );
}

function AnalyticsChart({
  title,
  caption,
  items,
  chartType = "area",
  controls = null,
  className = "",
}) {
  const [colorMode, setColorMode] = useState(
    () => document.documentElement.dataset.theme || "dark",
  );
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setColorMode(root.dataset.theme || "dark");
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const isLight = colorMode === "light";
  const compact = (value) =>
    value >= 100000000
      ? `${(value / 100000000).toFixed(value % 100000000 ? 1 : 0)}억`
      : value >= 10000
        ? `${Math.round(value / 10000)}만`
        : formatWon(value);
  const options = {
    chart: {
      type: chartType,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
      foreColor: isLight ? "#65778e" : "#8295b0",
      animations: { enabled: true, easing: "easeinout", speed: 550 },
    },
    colors: ["#5b7cfa"],
    dataLabels: {
      enabled: true,
      formatter: (value) => (value ? compact(value) : ""),
      offsetY: chartType === "bar" ? -10 : -7,
      style: {
        fontSize: "10px",
        fontWeight: 700,
        colors: [isLight ? "#3f5fb8" : "#a9bbff"],
      },
      background: { enabled: false },
    },
    stroke: {
      curve: chartType === "area" ? "smooth" : "straight",
      width: chartType === "area" ? 3 : 0,
    },
    fill:
      chartType === "area"
        ? {
            type: "gradient",
            gradient: {
              shade: isLight ? "light" : "dark",
              type: "vertical",
              opacityFrom: 0.5,
              opacityTo: 0.05,
              stops: [0, 92, 100],
            },
          }
        : {
            type: "gradient",
            gradient: {
              type: "vertical",
              opacityFrom: 1,
              opacityTo: 0.72,
              stops: [0, 100],
            },
          },
    markers: {
      size: chartType === "area" ? 4 : 0,
      strokeWidth: 3,
      strokeColors: [isLight ? "#fff" : "#111b2e"],
      hover: { size: 6 },
    },
    plotOptions: {
      bar: {
        borderRadius: 7,
        borderRadiusApplication: "end",
        columnWidth: "46%",
      },
    },
    grid: {
      borderColor: isLight ? "#dce5ef" : "#263a58",
      strokeDashArray: 4,
      padding: { top: 20, right: 12, left: 10, bottom: 0 },
    },
    xaxis: {
      categories: items.map((item) => item.label),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: "10px" } },
    },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: { formatter: compact, style: { fontSize: "10px" } },
    },
    tooltip: {
      theme: isLight ? "light" : "dark",
      y: { formatter: (value) => `${formatWon(value)}원` },
      marker: { show: true },
    },
    legend: { show: false },
  };
  return (
    <section
      className={`panel analytics-chart apex-donation-chart ${className}`}
    >
      <div className="panel-title">
        <div>
          <span className="section-kicker">DONATION TREND</span>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
        {controls}
      </div>
      <Chart
        key={`${chartType}-${colorMode}`}
        options={options}
        series={[{ name: "후원금", data: items.map((item) => item.amount) }]}
        type={chartType}
        height={300}
      />
    </section>
  );
}

function YoutubeDonorLinksPopup() {
  const [data, setData] = useState({ items:[], total:0, page:1, pageSize:50 });
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const load = async (targetPage = data.page, targetQuery = query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:String(targetPage), pageSize:"50" });
      if (targetQuery) params.set("query", targetQuery);
      setData(await api(`/api/youtube/donor-links?${params}`, { cache:"no-store" }));
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(data.page, query); }, [data.page, query]);
  const search = (event) => {
    event.preventDefault();
    const next = queryInput.trim();
    if (data.page === 1 && query === next) return load(1, next);
    setData((current) => ({ ...current, page:1 }));
    setQuery(next);
  };
  const edit = async (link) => {
    const donorName = prompt("변경할 입금자명을 입력하세요.", link.donorName);
    if (!donorName || donorName === link.donorName) return;
    try {
      await api(`/api/youtube/donor-links/${link.id}`, { method:"PUT", body:JSON.stringify({ donorName }) });
      setMessage("유튜브 후원자 연결을 수정했습니다.");
      await load(data.page, query);
    } catch (error) { setMessage(error.message); }
  };
  const remove = async (link) => {
    if (!confirm(`${link.youtubeName || link.youtubeChannelId} 연결을 삭제할까요?`)) return;
    try {
      await api(`/api/youtube/donor-links/${link.id}`, { method:"DELETE" });
      const nextPage = data.items.length === 1 && data.page > 1 ? data.page - 1 : data.page;
      setMessage("유튜브 후원자 연결을 삭제했습니다.");
      if (nextPage === data.page) await load(nextPage, query);
      else setData((current) => ({ ...current, page:nextPage }));
    } catch (error) { setMessage(error.message); }
  };
  return (
    <main className="youtube-donor-popup">
      <header>
        <div><small>YOUTUBE DONORS</small><h1>등록된 유튜브 후원자</h1><p>유튜브 채널과 입금자명 연결을 검색하고 관리합니다.</p></div>
        <button type="button" onClick={()=>window.close()}>닫기</button>
      </header>
      <form className="youtube-donor-search" onSubmit={search}>
        <input value={queryInput} onChange={(event)=>setQueryInput(event.target.value)} placeholder="유튜브 이름·채널 ID·입금자명 검색" />
        <button>검색</button>
        {query && <button type="button" onClick={()=>{setQueryInput("");setData((current)=>({...current,page:1}));setQuery("");}}>전체 보기</button>}
      </form>
      <div className="youtube-donor-summary"><b>총 {formatWon(data.total)}명</b><span>{data.page} / {pageCount} 페이지</span></div>
      {message && <p className="notice">{message}</p>}
      <section className="youtube-donor-list">
        <div className="youtube-donor-head"><span>유튜브 채널</span><span>연결된 입금자명</span><span>관리</span></div>
        {data.items.map((link) => (
          <article key={link.id}>
            <div><strong>{link.youtubeName || "이름 없는 채널"}</strong><small>{link.youtubeChannelId}</small></div>
            <b>{link.donorName}</b>
            <div><button type="button" onClick={()=>edit(link)}>수정</button><button type="button" className="delete" onClick={()=>remove(link)}>삭제</button></div>
          </article>
        ))}
        {!loading && !data.items.length && <p className="empty">{query ? "검색 결과가 없습니다." : "아직 등록된 연결이 없습니다."}</p>}
        {loading && <p className="empty">목록을 불러오는 중입니다.</p>}
      </section>
      <nav className="youtube-donor-pagination" aria-label="유튜브 후원자 페이지">
        <button type="button" disabled={data.page <= 1 || loading} onClick={()=>setData((current)=>({...current,page:current.page-1}))}>이전</button>
        <span>{data.page} / {pageCount}</span>
        <button type="button" disabled={data.page >= pageCount || loading} onClick={()=>setData((current)=>({...current,page:current.page+1}))}>다음</button>
      </nav>
    </main>
  );
}

function LiveDepositPopup() {
  const [deposits, setDeposits] = useState([]);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [youtubeControl, setYoutubeControl] = useState({ enabled:false, state:"disabled", text:"채팅 TTS 꺼짐" });
  const [youtubeSaving, setYoutubeSaving] = useState(false);
  const [editForm, setEditForm] = useState({ donorName: "", amount: "", scope: "single" });
  const selected = deposits.find((item) => item.id === selectedId) || null;
  const load = async () => {
    try {
      const result = await api("/api/my/deposits?range=session");
      setDeposits(result.deposits);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  };
  useEffect(() => {
    load();
    const loadYoutube = () => api("/api/youtube/status", { cache:"no-store" }).then(setYoutubeControl).catch(() => {});
    loadYoutube();
    const youtubeTimer = setInterval(loadYoutube, 10000);
    let fallbackTimer = null;
    const stream = new EventSource(apiUrl("/api/my/deposits/events"), { withCredentials:true });
    stream.addEventListener("change", load);
    stream.onopen = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    stream.onerror = () => {
      if (!fallbackTimer) fallbackTimer = setInterval(load, 15000);
    };
    return () => {
      stream.close();
      clearInterval(youtubeTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, []);
  const toggleYoutubeChat = async () => {
    setYoutubeSaving(true);
    try {
      const result = await api("/api/youtube/enabled", {
        method:"PUT",
        body:JSON.stringify({ enabled:!youtubeControl.enabled }),
      });
      setYoutubeControl(result);
      setMessage(result.enabled ? "유튜브 후원 채팅 TTS를 켰습니다." : "유튜브 후원 채팅 TTS를 즉시 껐습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setYoutubeSaving(false);
    }
  };
  const toggleStatus = async (item) => {
    setSavingId(item.id);
    try {
      await api(`/api/my/deposits/${item.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: item.status === "included" ? "excluded" : "included" }),
      });
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingId(null);
    }
  };
  const saveEdit = async (event) => {
    event.preventDefault();
    setSavingId(editing.id);
    try {
      await Promise.all([
        api(`/api/my/deposits/${editing.id}/donor`, {
          method: "PUT",
          body: JSON.stringify({ canonicalName: editForm.donorName, scope: editForm.scope }),
        }),
        api(`/api/my/deposits/${editing.id}/amount`, {
          method: "PUT",
          body: JSON.stringify({ amount: Number(editForm.amount) }),
        }),
      ]);
      setEditing(null);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingId(null);
    }
  };
  const replay = async () => {
    if (!selected) return setMessage("먼저 입금 내역을 선택해주세요.");
    setSavingId(selected.id);
    try { const result=await api(`/api/my/deposits/${selected.id}/replay`,{method:"POST"}); setMessage(result.delivered?"선택한 후원 알림을 실행했습니다.":"연결된 OBS 알림 화면이 없습니다."); }
    catch(error){setMessage(error.message);} finally{setSavingId(null);}
  };
  const setSelectedStatus = async (status) => {
    if (!selected) return setMessage("먼저 입금 내역을 선택해주세요.");
    if (selected.status === status) return;
    await toggleStatus(selected);
  };
  const addDeposit = async (event) => {
    event.preventDefault(); setSavingId("new");
    try { await api("/api/my/deposits",{method:"POST",body:JSON.stringify({donorName:editForm.donorName,amount:Number(editForm.amount),receivedAt:new Date().toISOString()})}); setAdding(false); setMessage("입금을 추가했습니다."); await load(); }
    catch(error){setMessage(error.message);} finally{setSavingId(null);}
  };
  return (
    <main className="live-deposit-popup">
      {message && <p className="notice">{message}</p>}
      <div className="live-manager-layout"><div className="live-deposit-table">
        <div className="live-deposit-head"><span>시간</span><span>입금자</span><span>금액</span><span>상태</span></div>
        {deposits.map((item) => (
          <article key={item.id} className={`${item.status !== "included" ? "excluded" : ""} ${selectedId===item.id?"selected":""}`} onClick={()=>setSelectedId(item.id)} onDoubleClick={()=>{setSelectedId(item.id);setEditing(item);setEditForm({donorName:item.donorName,amount:String(item.amount),scope:"single"});}}>
            <time>{String(item.receivedAt).slice(11, 16)}</time>
            <strong className="live-donor-name">
              <span>{item.donorName}</span>
              {Boolean(item.nameAdjusted) && item.rawDonorName && item.rawDonorName !== item.donorName && (
                <small>(변경 전: {item.rawDonorName})</small>
              )}
            </strong>
            <b>{formatWon(item.amount)}원</b>
            <em>{item.status === "included" ? "후원 반영" : "제외됨"}</em>
          </article>
        ))}
        {!deposits.length && <p className="empty">오늘 들어온 입금이 없습니다.</p>}
      </div><aside className="live-manager-actions"><span className="live-indicator"><i /> 실시간</span>
        <section className="live-action-group"><h2>유튜브 채팅 TTS</h2>
          <button className={youtubeControl.enabled ? "youtube-on" : "youtube-off"} onClick={toggleYoutubeChat} disabled={youtubeSaving} title={youtubeControl.text}>
            {youtubeSaving ? "변경 중…" : youtubeControl.enabled ? "채팅 TTS 끄기" : "채팅 TTS 켜기"}
          </button>
        </section>
        <section className="live-action-group alert-actions"><h2>후원 알림</h2>
          <button className="stop-chat" onClick={async()=>{try{const result=await api("/api/overlay/control",{method:"POST",body:JSON.stringify({action:"stop-current-chat"})});setMessage(result.delivered?"현재 후원 채팅 화면과 TTS를 강제 종료했습니다.":"연결된 OBS 알림 화면이 없습니다.");}catch(error){setMessage(error.message);}}}>현재 채팅 강제 종료</button>
          <button className="run" onClick={async()=>{if(!selected)return;await setSelectedStatus("included");await replay();}} disabled={!selected||selected.status==="included"||savingId}>반영 후 알림 실행</button>
          <button className="rerun" onClick={replay} disabled={!selected||selected.status!=="included"||savingId}>알림만 재실행</button>
        </section>
        <section className="live-action-group"><h2>후원 내역</h2>
          <button onClick={()=>{if(!selected)return setMessage("먼저 입금 내역을 선택해주세요.");setEditing(selected);setEditForm({donorName:selected.donorName,amount:String(selected.amount),scope:"single"});}} disabled={!selected}>수정</button>
          <button onClick={()=>{setAdding(true);setEditForm({donorName:"",amount:"",scope:"single"});}}>추가</button>
          <button className="delete" onClick={()=>setSelectedStatus("excluded")} disabled={!selected||selected.status!=="included"}>제외</button>
          <button onClick={()=>setSelectedStatus("included")} disabled={!selected||selected.status==="included"}>되돌리기</button>
          <button onClick={load}>목록 새로고침</button>
        </section>
        <section className="live-action-group preview-actions"><h2>미리보기</h2>
          <button className="ranking" onClick={()=>window.open("/ranking","n9-ranking-preview","popup=yes,width=900,height=700")}>합계 순위</button>
        </section>
        <button className="start" onClick={async()=>{if(!confirm("현재 방송 입금 목록과 순위표를 초기화할까요?"))return;try{await api("/api/my/broadcast/start",{method:"POST"});setSelectedId(null);setMessage("방송 집계 기준을 초기화했습니다.");await load();}catch(error){setMessage(error.message);}}}>초기화</button>
        <button className="close" onClick={()=>window.close()}>닫기</button>
      </aside></div>
      {editing && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
        <form className="live-edit-dialog" onSubmit={saveEdit}>
          <h2>입금 내역 수정</h2>
          <label>입금자명<input autoFocus required maxLength="40" value={editForm.donorName} onChange={(event) => setEditForm({...editForm, donorName:event.target.value})}/></label>
          <label>후원 금액<input required type="number" min="1" max="100000000" value={editForm.amount} onChange={(event) => setEditForm({...editForm, amount:event.target.value})}/></label>
          <p>저장하면 후원 합계와 순위표가 자동으로 다시 계산됩니다.</p>
          <div className="live-edit-actions">
            <label className="live-edit-scope">
              <input type="checkbox" checked={editForm.scope === "same_name"} onChange={(event) => setEditForm({...editForm, scope:event.target.checked ? "same_name" : "single"})}/>
              <span><b>앞으로 같은 입금자명 전체 변경</b><small>같은 은행 원본 이름에도 계속 적용</small></span>
            </label>
            <div className="live-edit-buttons"><button type="button" onClick={() => setEditing(null)}>취소</button><button className="primary-button" disabled={savingId === editing.id}>저장</button></div>
          </div>
        </form>
      </div>}
      {adding && <div className="dialog-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setAdding(false)}><form className="live-edit-dialog" onSubmit={addDeposit}><h2>입금 내역 추가</h2><label>입금자명<input autoFocus required maxLength="40" value={editForm.donorName} onChange={(event)=>setEditForm({...editForm,donorName:event.target.value})}/></label><label>후원 금액<input required type="number" min="1" max="100000000" value={editForm.amount} onChange={(event)=>setEditForm({...editForm,amount:event.target.value})}/></label><p>추가 즉시 후원 합계와 순위표에 반영됩니다.</p><div><button type="button" onClick={()=>setAdding(false)}>취소</button><button className="primary-button" disabled={savingId==="new"}>추가</button></div></form></div>}
    </main>
  );
}

function DepositHistory() {
  const today = new Date();
  const dateValue = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dateTimeValue = (date) =>
    `${dateValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const [filters, setFilters] = useState({
    range: "today",
    query: "",
    status: "",
    from: dateValue(today),
    to: dateValue(today),
  });
  const [data, setData] = useState({
    summary: {
      totalAmount: 0,
      depositCount: 0,
      donorCount: 0,
      averageAmount: 0,
    },
    deposits: [],
    donorNames: [],
  });
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [donorForm, setDonorForm] = useState({
    canonicalName: "",
    scope: "single",
  });
  const [statusSaving, setStatusSaving] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [manualForm, setManualForm] = useState({
    donorName: "",
    amount: "",
    receivedAt: dateTimeValue(today),
  });
  const ranges = [
    ["today", "오늘"],
    ["yesterday", "어제"],
    ["7d", "최근 7일"],
    ["30d", "최근 30일"],
    ["month", "이번 달"],
    ["custom", "직접 선택"],
    ["all", "전체"],
  ];
  const statuses = {
    included: "후원 반영",
    excluded: "후원 제외",
    below_minimum: "기준 미달",
    needs_review: "확인 필요",
  };
  const bankNames = {
    tossbank: "토스뱅크",
    kbank: "케이뱅크",
    toonation: "투네이션",
    kakao: "카카오뱅크",
    ibk: "기업은행",
    manual: "수동 입력",
  };
  const load = async () => {
    setMessage("");
    const params = new URLSearchParams({ range: filters.range });
    if (filters.query.trim()) params.set("query", filters.query.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.range === "custom") {
      params.set("from", filters.from);
      params.set("to", filters.to);
    }
    try {
      setData(await api(`/api/my/deposits?${params}`));
    } catch (error) {
      setMessage(error.message);
    }
  };
  useEffect(() => {
    const timer = setTimeout(load, filters.query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filters.range, filters.query, filters.status, filters.from, filters.to]);
  useEffect(() => {
    let fallbackTimer = null;
    const stream = new EventSource(apiUrl("/api/my/deposits/events"), { withCredentials:true });
    stream.addEventListener("change", load);
    stream.onopen = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    stream.onerror = () => {
      if (!fallbackTimer) fallbackTimer = setInterval(load, 15000);
    };
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stream.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [filters.range, filters.query, filters.status, filters.from, filters.to]);
  const groups = data.deposits.reduce((result, item) => {
    const day = String(item.receivedAt).slice(0, 10);
    (result[day] ||= []).push(item);
    return result;
  }, {});
  function openDonor(item) {
    setEditing(item);
    setDonorForm({ canonicalName: item.donorName, scope: "single" });
  }
  async function saveDonor(event) {
    event.preventDefault();
    try {
      await api(`/api/my/deposits/${editing.id}/donor`, {
        method: "PUT",
        body: JSON.stringify(donorForm),
      });
      setEditing(null);
      setMessage(
        donorForm.canonicalName
          ? "입금자명을 변경했습니다."
          : "은행 원본 이름으로 되돌렸습니다.",
      );
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function changeStatus(item) {
    const status = item.status === "included" ? "excluded" : "included";
    setStatusSaving(item.id);
    try {
      await api(`/api/my/deposits/${item.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, note: "" }),
      });
      setMessage(
        status === "included"
          ? "후원 금액에 다시 반영했습니다."
          : "후원 금액에서 제외했습니다.",
      );
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStatusSaving(null);
    }
  }
  async function addManualDeposit(event) {
    event.preventDefault();
    setManualSaving(true);
    setMessage("");
    try {
      await api("/api/my/deposits", {
        method: "POST",
        body: JSON.stringify({
          donorName: manualForm.donorName,
          amount: Number(manualForm.amount),
          receivedAt: new Date(manualForm.receivedAt).toISOString(),
        }),
      });
      setShowManual(false);
      setManualForm({
        donorName: "",
        amount: "",
        receivedAt: dateTimeValue(new Date()),
      });
      setMessage(
        "수동 입금을 추가했습니다. 후원 현황과 OBS에 바로 반영됩니다.",
      );
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setManualSaving(false);
    }
  }
  async function testAlert() {
    setAlertTesting(true);
    setMessage("");
    try {
      const result = await api("/api/my/deposits/test-alert", {
        method: "POST",
      });
      setMessage(
        result.delivered
          ? "OBS로 테스트 알림을 전송했습니다."
          : "테스트 알림을 보낼 OBS 화면이 연결되어 있지 않습니다.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAlertTesting(false);
    }
  }
  const formatDay = (value) => {
    const [year, month, day] = value.split("-");
    return `${year}년 ${Number(month)}월 ${Number(day)}일`;
  };
  return (
    <PageLayout>
      <div className="shell deposit-page">
        <header>
          <div>
            <h1>입금 내역</h1>
            <p className="page-description">
              내 계정으로 들어온 입금을 확인하고 입금자명과 후원 반영 여부를
              관리합니다.
            </p>
          </div>
          <div className="deposit-header-actions">
            <button
              className="header-button alert-test-button"
              disabled={alertTesting}
              onClick={testAlert}
            >
              {alertTesting ? "전송 중..." : "알림 테스트"}
            </button>
            <button
              className="header-button manual-deposit-button"
              onClick={() => {
                setManualForm({
                  donorName: "",
                  amount: "",
                  receivedAt: dateTimeValue(new Date()),
                });
                setShowManual(true);
              }}
            >
              + 수동 입금 추가
            </button>
          </div>
        </header>
        <section className="deposit-filters">
          <div className="period-tabs">
            {ranges.map(([value, label]) => (
              <button
                className={filters.range === value ? "active" : ""}
                onClick={() => setFilters({ ...filters, range: value })}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          {filters.range === "custom" && (
            <div className="custom-dates">
              <label>
                시작일
                <input
                  type="date"
                  value={filters.from}
                  max={filters.to}
                  onChange={(event) =>
                    setFilters({ ...filters, from: event.target.value })
                  }
                />
              </label>
              <i>–</i>
              <label>
                종료일
                <input
                  type="date"
                  value={filters.to}
                  min={filters.from}
                  onChange={(event) =>
                    setFilters({ ...filters, to: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="deposit-search">
            <input
              value={filters.query}
              onChange={(event) =>
                setFilters({ ...filters, query: event.target.value })
              }
              placeholder="입금자명 검색"
            />
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value })
              }
            >
              <option value="">전체 상태</option>
              {Object.entries(statuses).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </section>
        {message && <p className="notice">{message}</p>}
        <section className="deposit-kpis">
          <article>
            <span>조회 기간 입금액</span>
            <b>
              {formatWon(Number(data.summary.totalAmount) || 0)}
              <small>원</small>
            </b>
          </article>
          <article>
            <span>입금 건수</span>
            <b>
              {Number(data.summary.depositCount) || 0}
              <small>건</small>
            </b>
          </article>
          <article>
            <span>입금자 수</span>
            <b>
              {Number(data.summary.donorCount) || 0}
              <small>명</small>
            </b>
          </article>
          <article>
            <span>평균 입금액</span>
            <b>
              {formatWon(Math.round(Number(data.summary.averageAmount) || 0))}
              <small>원</small>
            </b>
          </article>
        </section>
        <section className="panel deposit-list-panel">
          <div className="deposit-table-head">
            <span>입금 시각</span>
            <span>입금자</span>
            <span>은행</span>
            <span>후원 반영</span>
            <span>금액</span>
          </div>
          {Object.entries(groups).map(([day, items]) => (
            <div className="deposit-day" key={day}>
              <div className="deposit-day-title">
                <b>{formatDay(day)}</b>
                <span>
                  {items.length}건 ·{" "}
                  {formatWon(
                    items.reduce((sum, item) => sum + Number(item.amount), 0),
                  )}
                  원
                </span>
              </div>
              {items.map((item) => (
                <article className="deposit-row" key={item.id}>
                  <time>{String(item.receivedAt).slice(11, 16)}</time>
                  <div className="deposit-donor">
                    <div>
                      <strong>{item.donorName}</strong>
                      <button
                        className="donor-edit-button"
                        type="button"
                        onClick={() => openDonor(item)}
                      >
                        입금자명 변경
                      </button>
                    </div>
                    {Boolean(item.nameAdjusted) && (
                      <small>은행 원문 · {item.rawDonorName}</small>
                    )}
                  </div>
                  <span>{bankNames[item.bank] || item.bank}</span>
                  <div className="deposit-status-control">
                    <em className={`deposit-status ${item.status}`}>
                      {statuses[item.status] || item.status}
                    </em>
                    <button
                      type="button"
                      disabled={statusSaving === item.id}
                      onClick={() => changeStatus(item)}
                    >
                      {statusSaving === item.id
                        ? "변경 중"
                        : item.status === "included"
                          ? "후원 제외"
                          : "후원 반영"}
                    </button>
                  </div>
                  <b>{formatWon(item.amount)}원</b>
                </article>
              ))}
            </div>
          ))}
          {!data.deposits.length && (
            <div className="empty deposit-empty">
              선택한 조건의 입금 내역이 없습니다.
            </div>
          )}
        </section>
      </div>
      {showManual && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !manualSaving)
              setShowManual(false);
          }}
        >
          <section
            className="profile-dialog manual-deposit-dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="dialog-title">
              <div>
                <small>MANUAL DEPOSIT</small>
                <h2>수동 입금 추가</h2>
                <p>
                  계좌로 확인되지 않은 후원을 직접 추가합니다. 저장 즉시 후원
                  현황과 OBS에 반영됩니다.
                </p>
              </div>
              <button
                disabled={manualSaving}
                onClick={() => setShowManual(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <form onSubmit={addManualDeposit}>
              <label>
                입금자명
                <input
                  autoFocus
                  required
                  list="manual-known-donors"
                  maxLength="40"
                  value={manualForm.donorName}
                  onChange={(event) =>
                    setManualForm({
                      ...manualForm,
                      donorName: event.target.value,
                    })
                  }
                  placeholder="입금자명 입력"
                />
                <datalist id="manual-known-donors">
                  {data.donorNames.map((name) => (
                    <option value={name} key={name} />
                  ))}
                </datalist>
              </label>
              <label>
                금액
                <input
                  required
                  type="number"
                  min="1"
                  max="100000000"
                  step="1"
                  value={manualForm.amount}
                  onChange={(event) =>
                    setManualForm({ ...manualForm, amount: event.target.value })
                  }
                  placeholder="금액 입력"
                />
              </label>
              <label>
                입금 일시
                <input
                  required
                  type="datetime-local"
                  max={dateTimeValue(new Date())}
                  value={manualForm.receivedAt}
                  onChange={(event) =>
                    setManualForm({
                      ...manualForm,
                      receivedAt: event.target.value,
                    })
                  }
                />
              </label>
              <p className="manual-deposit-note">
                목록의 은행 항목에는 ‘수동 입력’으로 표시됩니다.
              </p>
              <button className="primary-button" disabled={manualSaving}>
                {manualSaving ? "추가 중..." : "입금 추가"}
              </button>
            </form>
          </section>
        </div>
      )}
      {editing && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <section
            className="profile-dialog donor-dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="dialog-title">
              <div>
                <small>은행 원본 · {editing.rawDonorName}</small>
                <h2>입금자명 변경</h2>
                <p>
                  같은 후원자가 다른 이름으로 입금했을 때 순위표에 표시할 이름을
                  직접 정할 수 있습니다.
                </p>
              </div>
              <button onClick={() => setEditing(null)} aria-label="닫기">
                ×
              </button>
            </div>
            <form onSubmit={saveDonor}>
              <label>
                변경할 입금자명
                <input
                  autoFocus
                  list="known-donors"
                  maxLength="40"
                  value={donorForm.canonicalName}
                  onChange={(event) =>
                    setDonorForm({
                      ...donorForm,
                      canonicalName: event.target.value,
                    })
                  }
                />
                <datalist id="known-donors">
                  {data.donorNames.map((name) => (
                    <option value={name} key={name} />
                  ))}
                </datalist>
              </label>
              <div className="donor-scope">
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={donorForm.scope === "single"}
                    onChange={() =>
                      setDonorForm({ ...donorForm, scope: "single" })
                    }
                  />
                  <span>
                    <b>이번 입금만</b>
                    <small>선택한 한 건에만 적용합니다.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={donorForm.scope === "same_name"}
                    onChange={() =>
                      setDonorForm({ ...donorForm, scope: "same_name" })
                    }
                  />
                  <span>
                    <b>같은 입금자명 전체</b>
                    <small>앞으로 같은 원본 이름에도 적용합니다.</small>
                  </span>
                </label>
              </div>
              <button
                type="button"
                className="restore-name"
                onClick={() =>
                  setDonorForm({ ...donorForm, canonicalName: "" })
                }
              >
                은행 원본 이름으로 되돌리기
              </button>
              <button className="primary-button">입금자명 저장</button>
            </form>
          </section>
        </div>
      )}
    </PageLayout>
  );
}

function AdminAccounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    loginId: "",
    role: "member",
  });
  const canManage = ["super", "admin"].includes(user.role);
  const load = () =>
    api("/api/users")
      .then(setAccounts)
      .catch((error) => setMessage(error.message));
  useEffect(() => {
    if (canManage) load();
  }, [canManage]);
  if (!canManage) return <AccessDenied />;
  const isSuper = user.role === "super";
  const canReset = (account) =>
    account.loginId !== user.loginId && (isSuper || account.role !== "super");
  async function createAccount(event) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    try {
      const created = await api("/api/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setMessage(
        `${created.displayName} 계정을 만들었습니다. 초기 비밀번호는 ${created.temporaryPassword} 입니다.`,
      );
      setForm({ displayName: "", loginId: "", role: "member" });
      setShowCreate(false);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCreating(false);
    }
  }
  async function toggleAccount(account) {
    const action = account.isActive ? "중지" : "다시 활성화";
    if (
      !confirm(
        `${account.displayName} 계정을 ${action}할까요?${account.isActive ? " 후원 기록은 그대로 보존됩니다." : ""}`,
      )
    )
      return;
    try {
      await api(`/api/users/${account.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ active: !account.isActive }),
      });
      setMessage(`${account.displayName} 계정을 ${action}했습니다.`);
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function resetPassword(account) {
    if (
      !confirm(
        `${account.displayName}의 비밀번호를 초기화할까요? 현재 로그인된 기기에서도 로그아웃됩니다.`,
      )
    )
      return;
    try {
      const result = await api(`/api/users/${account.id}/reset-password`, {
        method: "POST",
      });
      setMessage(
        `${account.displayName}의 임시 비밀번호는 ${result.temporaryPassword} 입니다.`,
      );
    } catch (error) {
      setMessage(error.message);
    }
  }
  return (
    <PageLayout>
      <div className="shell">
        <header>
          <div>
            <h1>계정 관리</h1>
            <p className="page-description">
              크루원 계정을 만들고 권한, 로그인 상태와 비밀번호를 관리합니다.
            </p>
          </div>
          <button
            className="header-button"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "취소" : "새 계정 만들기"}
          </button>
        </header>
        {showCreate && (
          <section className="panel create-account">
            <div>
              <h3>새 크루 계정</h3>
              <p>
                관리자·일반 계정의 초기 비밀번호는 <b>Init1234!!</b>입니다.
              </p>
            </div>
            <form onSubmit={createAccount}>
              <label>
                이름
                <input
                  autoFocus
                  maxLength="20"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm({ ...form, displayName: event.target.value })
                  }
                  placeholder="예: 새 크루원"
                />
              </label>
              <label>
                로그인 아이디
                <input
                  maxLength="30"
                  value={form.loginId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      loginId: event.target.value.toLowerCase(),
                    })
                  }
                  placeholder="영문 소문자와 숫자"
                />
              </label>
              <label>
                계정 등급
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value })
                  }
                >
                  <option value="member">일반 계정</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              <button className="primary-button" disabled={creating}>
                {creating ? "생성 중..." : "계정 생성"}
              </button>
            </form>
          </section>
        )}
        {message && <p className="notice">{message}</p>}
        <section className={`account-summary ${isSuper ? "" : "three"}`}>
          <article>
            <b>{accounts.filter((item) => item.isActive).length}</b>
            <span>활성 계정</span>
          </article>
          {isSuper && (
            <article>
              <b>{accounts.filter((item) => item.role === "super").length}</b>
              <span>슈퍼 계정</span>
            </article>
          )}
          <article>
            <b>
              {
                accounts.filter(
                  (item) => item.role === "admin" && item.isActive,
                ).length
              }
            </b>
            <span>관리자 계정</span>
          </article>
          <article>
            <b>
              {
                accounts.filter(
                  (item) => item.role === "member" && item.isActive,
                ).length
              }
            </b>
            <span>일반 계정</span>
          </article>
        </section>
        <section className="panel account-panel">
          <div className="panel-title">
            <div>
              <h3>크루 계정</h3>
              <p className="account-explain">
                나간 크루원은 계정을 중지하면 로그인만 차단되고 기존 후원 기록은
                보존됩니다.
              </p>
            </div>
            <span>{accounts.length}개 계정</span>
          </div>
          <div className="account-list">
            {accounts.map((account) => (
              <article
                className={account.isActive ? "" : "inactive"}
                key={account.loginId}
              >
                {account.avatar ? (
                  <img
                    className="account-avatar"
                    src={account.avatar}
                    alt={`${account.displayName} 프로필`}
                  />
                ) : (
                  <span className="account-avatar">
                    {account.displayName.slice(0, 1)}
                  </span>
                )}
                <div>
                  <strong>{account.displayName}</strong>
                  <small>
                    아이디 {account.loginId} · {ROLE_LABELS[account.role]}
                  </small>
                </div>
                <em
                  className={
                    account.isActive ? "status-active" : "status-paused"
                  }
                >
                  {account.isActive ? "활성" : "중지"}
                </em>
                {canReset(account) && (
                  <div className="account-actions">
                    <button
                      className="account-reset"
                      type="button"
                      onClick={() => resetPassword(account)}
                    >
                      비밀번호 초기화
                    </button>
                    <button
                      className="account-toggle"
                      type="button"
                      onClick={() => toggleAccount(account)}
                    >
                      {account.isActive ? "계정 중지" : "다시 활성화"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
        <section className="panel password-policy">
          <div className="panel-title">
            <h3>계정 운영 기준</h3>
            <span>후원 기록 보존</span>
          </div>
          <div>
            <article>
              <b>새 크루원</b>
              <p>
                초기 비밀번호 Init1234!!로 로그인한 뒤 본인이 새 비밀번호로
                변경합니다.
              </p>
            </article>
            <article>
              <b>비밀번호 분실</b>
              <p>
                관리자가 Init1234!!로 재설정하며, 기존 로그인 세션은 종료됩니다.
              </p>
            </article>
            <article>
              <b>크루 탈퇴</b>
              <p>
                계정을 중지해 로그인을 차단합니다. 통계와 후원 기록은 삭제하지
                않습니다.
              </p>
            </article>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

function PhoneTestPage() {
  const [events,setEvents]=useState([]);
  const [connected,setConnected]=useState(false);
  useEffect(()=>{
    const source=new EventSource(apiUrl('/api/my/phone-test/events'),{withCredentials:true});
    source.addEventListener('ready',()=>setConnected(true));
    source.addEventListener('notification',event=>{
      try { setEvents(items=>[JSON.parse(event.data),...items].slice(0,50)); } catch {}
    });
    source.onerror=()=>setConnected(false);
    return()=>source.close();
  },[]);
  return <PageLayout><div className="shell"><section className="panel">
    <div className="section-heading"><div><span className="eyebrow">MOBILE API</span><h1>휴대폰 연동 테스트</h1><p>이 계정으로 들어온 성공·실패 API 요청을 실시간으로 확인합니다.</p></div><span className={connected?'status-pill active':'status-pill'}>{connected?'연결됨':'연결 중'}</span></div>
    {!events.length?<p className="empty">휴대폰에서 알림 API를 전송하면 여기에 표시됩니다.</p>:<div className="table-wrap"><table><thead><tr><th>시간</th><th>패키지</th><th>제목</th><th>내용</th><th>응답</th></tr></thead><tbody>{events.map((item,index)=><tr key={`${item.receivedAt}-${index}`}><td>{new Date(item.receivedAt).toLocaleString('ko-KR')}</td><td><code>{item.request?.packageName}</code></td><td>{item.request?.title}</td><td>{item.request?.content}</td><td><b>{item.response?.status}</b> {item.response?.body?.error||item.response?.body?.donation?.donorName||''}</td></tr>)}</tbody></table></div>}
  </section></div></PageLayout>;
}

function NotificationRules() {
  const empty={packageName:'',titlePattern:'',contentPattern:''};
  const [items,setItems]=useState([]),[editing,setEditing]=useState(null),[form,setForm]=useState(empty),[message,setMessage]=useState('');
  const load=()=>api('/api/notification-rules').then(setItems).catch(error=>setMessage(error.message));
  useEffect(()=>{
    load();
  },[]);
  const open=item=>{setEditing(item||{});setForm(item||empty);setMessage('');};
  async function save(event){event.preventDefault();try{await api(editing?.packageName?`/api/notification-rules/${encodeURIComponent(editing.packageName)}`:'/api/notification-rules',{method:editing?.packageName?'PUT':'POST',body:JSON.stringify(form)});setEditing(null);load();}catch(error){setMessage(error.message);}}
  async function remove(packageName){if(!confirm(`${packageName} 규칙을 삭제할까요?`))return;await api(`/api/notification-rules/${encodeURIComponent(packageName)}`,{method:'DELETE'});load();}
  return <PageLayout><div className="shell notification-rules-page"><section className="panel"><div className="section-heading notification-rules-header"><div><span className="eyebrow">PARSING RULES</span><h1>알림 파싱 규칙</h1><p>앱 패키지명을 기준으로 제목과 내용에서 입금자와 금액을 추출합니다.</p></div><button className="primary-button notification-add-button" onClick={()=>open(null)}><span>＋</span> 새 규칙 추가</button></div>
    {message&&<p className="form-message error">{message}</p>}<div className="table-wrap notification-rules-table"><table><thead><tr><th>앱 패키지명</th><th>제목 정규식</th><th>내용 정규식</th><th>관리</th></tr></thead><tbody>{items.length?items.map(item=><tr key={item.packageName}><td><code>{item.packageName}</code></td><td><code>{item.titlePattern||'-'}</code></td><td><code>{item.contentPattern}</code></td><td><div className="notification-rule-actions"><button onClick={()=>open(item)}>수정</button><button className="danger" onClick={()=>remove(item.packageName)}>삭제</button></div></td></tr>):<tr><td colSpan="4"><div className="notification-rules-empty"><b>등록된 파싱 규칙이 없습니다</b><span>새 규칙을 추가해 알림 제목과 내용을 파싱해 보세요.</span><button onClick={()=>open(null)}>첫 규칙 만들기</button></div></td></tr>}</tbody></table></div>
    {editing&&<div className="dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&setEditing(null)}><form className="dialog-card notification-rule-dialog" onSubmit={save}><div className="notification-dialog-heading"><div><span>{editing.packageName?'EDIT RULE':'NEW RULE'}</span><h2>{editing.packageName?'규칙 수정':'새 파싱 규칙'}</h2></div><button type="button" aria-label="닫기" onClick={()=>setEditing(null)}>×</button></div><div className="notification-rule-fields"><label>앱 패키지명<input value={form.packageName} onChange={e=>setForm({...form,packageName:e.target.value})} placeholder="예: com.example.bank" required/></label><label>제목 정규식 <small>선택</small><textarea rows="3" value={form.titlePattern||''} onChange={e=>setForm({...form,titlePattern:e.target.value})} placeholder="예: 입금\\s+(?<amount>[\\d,]+)원"/></label><label>내용 정규식 <small>필수</small><textarea rows="5" value={form.contentPattern} onChange={e=>setForm({...form,contentPattern:e.target.value})} placeholder="예: 입금자\\s*:\\s*(?<donor>.+)" required/></label></div><p className="notification-rule-help">제목과 내용을 합쳐 <code>(?&lt;donor&gt;...)</code>와 <code>(?&lt;amount&gt;...)</code> 캡처 그룹이 필요합니다.</p><div className="dialog-actions"><button type="button" onClick={()=>setEditing(null)}>취소</button><button className="primary-button">{editing.packageName?'변경사항 저장':'규칙 저장'}</button></div></form></div>}
  </section></div></PageLayout>;
}

function ApiLogs() {
  const [data,setData]=useState({items:[],page:1,totalPages:1,total:0}),[page,setPage]=useState(1),[selected,setSelected]=useState(null),[message,setMessage]=useState('');
  useEffect(()=>{api(`/api/api-logs?page=${page}&pageSize=50`).then(setData).catch(error=>setMessage(error.message));},[page]);
  return <PageLayout><div className="shell"><section className="panel"><div className="section-heading"><div><span className="eyebrow">REQUEST LOGS</span><h1>API 로그</h1><p>최근 알림 API 요청 {data.total.toLocaleString()}건을 확인합니다.</p></div></div>{message&&<p className="form-message error">{message}</p>}
    <div className="table-wrap"><table><thead><tr><th>시간</th><th>메서드</th><th>경로</th><th>상태</th><th>처리시간</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id} onClick={()=>setSelected(item)}><td>{item.createdAt}</td><td>{item.method}</td><td>{item.path}</td><td><b>{item.responseStatus}</b></td><td>{item.durationMs}ms</td></tr>)}</tbody></table></div><div className="pagination"><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {data.totalPages}</span><button disabled={page>=data.totalPages} onClick={()=>setPage(value=>value+1)}>다음</button></div>
    {selected&&<div className="dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&setSelected(null)}><div className="dialog-card"><h2>API 요청 #{selected.id}</h2><h3>헤더</h3><pre>{JSON.stringify(selected.requestHeaders,null,2)}</pre><h3>요청 바디</h3><pre>{JSON.stringify(selected.requestBody,null,2)}</pre><h3>응답 ({selected.responseStatus})</h3><pre>{JSON.stringify(selected.responseBody,null,2)}</pre><div className="dialog-actions"><button onClick={()=>setSelected(null)}>닫기</button></div></div></div>}
  </section></div></PageLayout>;
}

function ObsSetup() {
  const [copied, setCopied] = useState("");
  const [paths, setPaths] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/obs/sources")
      .then(setPaths)
      .catch((value) => setError(value.message));
  }, []);
  const sources = paths
    ? [
        {
          key: "alert",
          title: "후원 알림",
          description: "새 후원이 들어올 때 잠시 나타나는 화면",
          path: paths.alertPath,
          previewPath: "/overlay?preview=1",
          size: `${ALERT_OUTPUT_WIDTH} × ${ALERT_OUTPUT_HEIGHT}`,
        },
        {
          key: "ranking",
          title: "후원 순위표",
          description: "방송 화면에 계속 표시하는 누적 후원 순위",
          path: paths.rankingPath,
          previewPath: "/ranking",
          size: `${RANKING_OUTPUT_WIDTH} × ${RANKING_OUTPUT_HEIGHT}`,
        },
      ]
    : [];
  async function copy(source) {
    await navigator.clipboard.writeText(`${location.origin}${source.path}`);
    setCopied(source.key);
    setTimeout(() => setCopied(""), 1800);
  }
  return (
    <PageLayout>
      <div className="shell">
        <header>
          <div>
            <span className="eyebrow">OBS BROWSER SOURCES</span>
            <h1>OBS 연결</h1>
            <p className="page-description">
              내 계정 전용 OBS 주소와 권장 크기를 확인합니다.
            </p>
          </div>
        </header>
        {error && <p className="notice">{error}</p>}
        {!paths && !error && (
          <section className="panel obs-loading">
            전용 주소를 불러오고 있습니다.
          </section>
        )}
        <section className="obs-grid">
          {sources.map((source) => (
            <article className="panel obs-card" key={source.key}>
              <span className="section-kicker">
                {source.key === "alert" ? "ALERT SOURCE" : "RANKING SOURCE"}
              </span>
              <h2>{source.title}</h2>
              <p>{source.description}</p>
              <label>내 계정 전용 브라우저 소스 주소</label>
              <code>
                {location.origin}
                {source.path}
              </code>
              <dl>
                <div>
                  <dt>권장 크기</dt>
                  <dd>{source.size}</dd>
                </div>
                <div>
                  <dt>배경</dt>
                  <dd>투명</dd>
                </div>
                <div>
                  <dt>설정 반영</dt>
                  <dd>
                    {source.key === "alert"
                      ? "후원 알림 설정"
                      : "후원 순위표 설정"}{" "}
                    즉시 적용
                  </dd>
                </div>
              </dl>
              <div className="obs-actions">
                <button onClick={() => copy(source)}>
                  {copied === source.key ? "복사 완료" : "주소 복사"}
                </button>
                <a href={source.previewPath} target="_blank">
                  예시 미리보기 ↗
                </a>
              </div>
            </article>
          ))}
        </section>
        <section className="panel obs-help">
          <h3>OBS에 연결하는 방법</h3>
          <ol>
            <li>OBS에서 소스 추가 → 브라우저를 선택합니다.</li>
            <li>위의 내 계정 전용 주소를 복사해 URL에 붙여 넣습니다.</li>
            <li>권장 크기를 입력하고 사용자 지정 CSS는 비워둡니다.</li>
            <li>
              후원 알림 설정을 저장하면 내 OBS 오버레이에 바로 반영됩니다.
            </li>
            <li>
              기존 공용 주소를 사용 중이라면 반드시 새 전용 주소로 교체해주세요.
            </li>
          </ol>
        </section>
      </div>
    </PageLayout>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const canManageGrades = user.role === "super";
  const [data, setData] = useState({
    session: {},
    donations: [],
    summary: { totalAmount: 0, donationCount: 0, donorCount: 0 },
    settings: DEFAULT_SETTINGS,
  });
  const [message, setMessage] = useState("");
  const [savingGrades, setSavingGrades] = useState(false);
  const [isGradeEditing, setIsGradeEditing] = useState(false);
  const load = () =>
    api("/api/dashboard")
      .then(setData)
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    load();
  }, []);

  const setGrades = (crewGrades) =>
    setData((current) => ({
      ...current,
      settings: { ...current.settings, crewGrades },
    }));
  const addGrade = () =>
    setGrades([
      ...(data.settings.crewGrades || []),
      {
        id: crypto.randomUUID(),
        name: "새 등급",
        minAmount: 100000,
        maxAmount: 1000000,
        imageName: "",
        imageData: "",
      },
    ]);
  const changeGrade = (id, key, value) =>
    setGrades(
      (data.settings.crewGrades || []).map((grade) =>
        grade.id === id ? { ...grade, [key]: value } : grade,
      ),
    );
  async function loadGradeImage(id, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage("등급 이미지는 5MB 이하만 사용할 수 있습니다.");
      return;
    }
    const imageData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setGrades(
      (data.settings.crewGrades || []).map((grade) =>
        grade.id === id ? { ...grade, imageName: file.name, imageData } : grade,
      ),
    );
    event.target.value = "";
  }
  async function saveGrades() {
    const ranges = [...(data.settings.crewGrades || [])]
      .map((grade) => ({
        name: grade.name,
        min: Number(grade.minAmount) || 0,
        max:
          grade.maxAmount == null || grade.maxAmount === ""
            ? null
            : Number(grade.maxAmount),
      }))
      .sort((a, b) => a.min - b.min);
    const invalid = ranges.find(
      (range) => range.max != null && range.max < range.min,
    );
    if (invalid) {
      setMessage(
        `${invalid.name} 등급의 최대 누적 금액은 최소 누적 금액보다 크거나 같아야 합니다.`,
      );
      return;
    }
    const overlap = ranges.find(
      (range, index) =>
        index > 0 &&
        (ranges[index - 1].max == null || range.min <= ranges[index - 1].max),
    );
    if (overlap) {
      setMessage(
        `${overlap.name} 등급의 누적 금액 구간이 다른 등급과 겹칩니다.`,
      );
      return;
    }
    setSavingGrades(true);
    setMessage("");
    try {
      const settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(data.settings),
      });
      setData((current) => ({ ...current, settings }));
      setIsGradeEditing(false);
      setMessage(
        "크루 등급표를 저장했습니다. 후원 알림에서 자동으로 사용됩니다.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingGrades(false);
    }
  }

  const total = Number(data.summary?.totalAmount || 0);
  const donationCount = Number(data.summary?.donationCount || 0);
  const average = donationCount ? Math.round(total / donationCount) : 0;
  const visibleGrades = [...(data.settings.crewGrades || [])].sort(
    (a, b) => Number(b.minAmount || 0) - Number(a.minAmount || 0),
  );
  return (
    <PageLayout>
      <div className="shell">
        <header>
          <div>
            <span className="eyebrow">CREW DONATION OVERVIEW</span>
            <h1>크루 후원 현황</h1>
            <p className="page-description">
              크루 전체 후원자의 누적 현황을 확인합니다.
            </p>
          </div>
        </header>
        <section className="dashboard-kpis">
          <article className="kpi primary">
            <span>전체 후원금</span>
            <strong>
              {formatWon(total)}
              <small>원</small>
            </strong>
          </article>
          <article className="kpi">
            <span>전체 후원자</span>
            <strong>
              {Number(data.summary?.donorCount || 0)}
              <small>명</small>
            </strong>
            <p>동일 닉네임은 합산</p>
          </article>
          <article className="kpi">
            <span>후원 1건당 평균 금액</span>
            <strong>
              {formatWon(average)}
              <small>원</small>
            </strong>
            <p>전체 후원 건수 기준</p>
          </article>
        </section>
        <section
          className={`panel crew-grade-panel ${canManageGrades && isGradeEditing ? "" : "readonly"}`}
        >
          <div className="panel-title">
            <div>
              <h3>크루 누적 등급표</h3>
              {canManageGrades && (
                <p className="account-explain">
                  누적 후원 구간과 이미지를 등록하면 모든 크루 계정의 후원
                  알림에 공통으로 적용됩니다.
                </p>
              )}
            </div>
            {canManageGrades && (!isGradeEditing ? (
              <button type="button" className="header-button" onClick={()=>setIsGradeEditing(true)}>등급 추가/변경</button>
            ) : (
              <div className="grade-panel-actions">
                <button type="button" className="secondary-button" onClick={async()=>{setIsGradeEditing(false);await load();}}>편집 취소</button>
                <button type="button" className="header-button" onClick={addGrade}>등급 추가</button>
              </div>
            ))}
          </div>
          <div className="crew-grade-list">
            {visibleGrades.map((grade) => (
              <article key={grade.id}>
                {grade.imageData ? (
                  <img src={grade.imageData} alt={`${grade.name} 등급`} />
                ) : (
                  <span className="grade-image-empty">이미지</span>
                )}
                {canManageGrades && isGradeEditing ? (
                  <>
                    <label className="grade-name">
                      등급명
                      <input
                        value={grade.name}
                        maxLength="30"
                        onChange={(e) =>
                          changeGrade(grade.id, "name", e.target.value)
                        }
                      />
                    </label>
                    <div className="grade-range">
                      <label>
                        최소 누적 금액
                        <input
                          type="number"
                          min="0"
                          step="10000"
                          value={grade.minAmount}
                          onChange={(e) =>
                            changeGrade(
                              grade.id,
                              "minAmount",
                              Math.max(0, Number(e.target.value)),
                            )
                          }
                        />
                      </label>
                      <span>~</span>
                      <label>
                        최대 누적 금액
                        <input
                          type="number"
                          min="0"
                          step="10000"
                          placeholder="제한 없음"
                          value={grade.maxAmount ?? ""}
                          onChange={(e) =>
                            changeGrade(
                              grade.id,
                              "maxAmount",
                              e.target.value === ""
                                ? null
                                : Math.max(0, Number(e.target.value)),
                            )
                          }
                        />
                      </label>
                      <small>
                        {formatKoreanWon(grade.minAmount)} ~{" "}
                        {grade.maxAmount == null
                          ? "제한 없음"
                          : formatKoreanWon(grade.maxAmount)}
                      </small>
                    </div>
                    <label className="grade-file">
                      등급 이미지
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => loadGradeImage(grade.id, e)}
                      />
                      <small>{grade.imageName || "5MB 이하"}</small>
                    </label>
                    <button
                      type="button"
                      className="grade-remove"
                      onClick={() =>
                        setGrades(
                          (data.settings.crewGrades || []).filter(
                            (item) => item.id !== grade.id,
                          ),
                        )
                      }
                    >
                      삭제
                    </button>
                  </>
                ) : (
                  <>
                    <div className="grade-readonly-name">
                      <small>등급</small>
                      <b>{grade.name}</b>
                    </div>
                    <div className="grade-readonly-amount">
                      <small>누적 금액 구간</small>
                      <b>
                        {formatKoreanWon(grade.minAmount)} ~{" "}
                        {grade.maxAmount == null
                          ? "제한 없음"
                          : formatKoreanWon(grade.maxAmount)}
                      </b>
                    </div>
                  </>
                )}
              </article>
            ))}
            {!visibleGrades.length && (
              <p className="empty">등록된 등급이 없습니다.</p>
            )}
          </div>
          {canManageGrades && isGradeEditing && (
            <button
              type="button"
              className="primary-button grade-save"
              disabled={savingGrades}
              onClick={saveGrades}
            >
              {savingGrades ? "저장 중" : "등급표 저장"}
            </button>
          )}
        </section>
        {message && <p className="notice">{message}</p>}
        <main className="dashboard-main crew-dashboard-content">
          <VirtualDonorList
            endpoint="/api/dashboard/donors"
            title="후원자 목록"
            kicker="CREW DONORS"
            className="crew-donor-list"
          />
        </main>
      </div>
    </PageLayout>
  );
}

function Empty() {
  return <p className="empty">아직 입금 내역이 없습니다.</p>;
}

const FONT_OPTIONS = [
  // Web fonts: OBS에서 별도 설치 없이 사용할 수 있습니다.
  ['"Noto Sans KR", sans-serif', "Noto Sans KR"],
  ['"Noto Serif KR", serif', "Noto Serif KR"],
  ['"Gothic A1", sans-serif', "Gothic A1"],
  ['"IBM Plex Sans KR", sans-serif', "IBM Plex Sans KR"],
  ['"Nanum Gothic", sans-serif', "나눔고딕"],
  ['"Nanum Myeongjo", serif', "나눔명조"],
  ['"Nanum Gothic Coding", monospace', "나눔고딕 코딩"],
  ['"Gowun Dodum", sans-serif', "고운돋움"],
  ['"Gowun Batang", serif', "고운바탕"],
  ['"Hahmlet", serif', "함렛"],
  ['"Sunflower", sans-serif', "해바라기"],
  ['"Do Hyeon", sans-serif', "도현"],
  ['"Black Han Sans", sans-serif', "검은고딕"],
  ['"Jua", sans-serif', "주아"],
  ['"Gugi", sans-serif', "구기"],
  ['"Gasoek One", sans-serif', "가석원"],
  ['"Bagel Fat One", sans-serif', "베이글팻원"],
  ['"Orbit", sans-serif', "오르빗"],
  ['"Moirai One", sans-serif', "모이라이원"],
  ['"Grandiflora One", serif', "그란디플로라원"],
  ['"Diphylleia", serif', "디필레이아"],
  ['"Stylish", sans-serif', "스타일리시"],
  ['"Song Myung", serif', "송명"],
  ['"Dongle", sans-serif', "동글"],
  ['"Cute Font", cursive', "귀여운 글씨"],
  ['"Gamja Flower", cursive', "감자꽃"],
  ['"Gaegu", cursive', "개구쟁이"],
  ['"Hi Melody", cursive', "하이멜로디"],
  ['"Poor Story", cursive', "푸어스토리"],
  ['"Single Day", cursive', "싱글데이"],
  ['"Yeon Sung", cursive', "연성"],
  ['"Nanum Pen Script", cursive', "나눔펜"],
  ['"Nanum Brush Script", cursive', "나눔붓글씨"],
  ['"Kirang Haerang", cursive', "기랑해랑"],
  ['"Dokdo", cursive', "독도"],
  ['"East Sea Dokdo", cursive', "동해독도"],
  // Latin display fonts: 한글 문자는 Noto Sans KR로 자동 대체됩니다.
  ['"Montserrat", "Noto Sans KR", sans-serif', "Montserrat (영문)"],
  ['"Roboto Condensed", "Noto Sans KR", sans-serif', "Roboto Condensed (영문)"],
  ['"Oswald", "Noto Sans KR", sans-serif', "Oswald (영문)"],
  ['"Anton", "Noto Sans KR", sans-serif', "Anton (영문)"],
  ['"Bebas Neue", "Noto Sans KR", sans-serif', "Bebas Neue (영문)"],
  ['"Bungee", "Noto Sans KR", sans-serif', "Bungee (영문)"],
  ['"Cinzel", "Noto Serif KR", serif', "Cinzel (영문)"],
  ['"Playfair Display", "Noto Serif KR", serif', "Playfair Display (영문)"],
  ['"Lobster", "Noto Sans KR", cursive', "Lobster (영문)"],
  ['"Pacifico", "Noto Sans KR", cursive', "Pacifico (영문)"],
  ['"Permanent Marker", "Noto Sans KR", cursive', "Permanent Marker (영문)"],
  // Local fonts: OBS가 실행되는 PC에 설치되어 있어야 합니다.
  ['Pretendard, "Noto Sans KR", sans-serif', "Pretendard (로컬)"],
  ['"NanumSquare", "Noto Sans KR", sans-serif', "나눔스퀘어 (로컬)"],
  ['"NanumSquareRound", "Noto Sans KR", sans-serif', "나눔스퀘어라운드 (로컬)"],
  ['"Gmarket Sans", "Noto Sans KR", sans-serif', "G마켓 산스 (로컬)"],
  ['"S-Core Dream", "Noto Sans KR", sans-serif', "에스코어 드림 (로컬)"],
  ['"Spoqa Han Sans Neo", "Noto Sans KR", sans-serif', "스포카 한 산스 (로컬)"],
  ['"Apple SD Gothic Neo", "Noto Sans KR", sans-serif', "Apple SD Gothic Neo (로컬)"],
  ['"Malgun Gothic", "Noto Sans KR", sans-serif', "맑은 고딕 (로컬)"],
  ['"Arial", sans-serif', "Arial"],
  ['"Arial Black", sans-serif', "Arial Black"],
  ["Impact, sans-serif", "Impact"],
  ["Georgia, serif", "Georgia"],
  ["cursive", "손글씨 계열"],
  ["monospace", "고정폭 계열"],
];
const ENTER_EFFECTS = [
  ["fade", "부드럽게 나타나기"],
  ["zoom", "확대 등장"],
  ["slide-up", "아래에서 올라오기"],
  ["slide-down", "위에서 내려오기"],
  ["slide-left", "오른쪽에서 밀려오기"],
  ["slide-right", "왼쪽에서 밀려오기"],
  ["bounce", "통통 튀기"],
  ["flip", "뒤집기"],
  ["pulse", "강조 맥박"],
  ["shake", "좌우 흔들기"],
];
const EXIT_EFFECTS = [
  ["fade-out", "부드럽게 사라지기"],
  ["zoom-out", "축소하며 사라지기"],
  ["slide-down-out", "아래로 사라지기"],
  ["slide-up-out", "위로 사라지기"],
];
const SOUND_OPTIONS = [
  ["coin", "코인"],
  ["chime", "차임벨"],
  ["pop", "팝"],
  ["fanfare", "팡파르"],
  ["bell", "맑은 종"],
  ["sparkle", "반짝임"],
  ["success", "성공 알림"],
  ["drum", "드럼 임팩트"],
  ["laser", "레이저"],
  ["magic", "마법 효과"],
  ["custom", "직접 추가한 음원"],
  ["none", "소리 없음"],
];
const RANKING_THEMES = [
  ["midnight", "미드나이트", "1 2 3"],
  ["clean", "화이트 표", "01 02 03"],
  ["neon", "네온 배지", "① ② ③"],
  ["gold", "메달", "🥇 🥈 🥉"],
  ["rose", "리본", "1st 2nd 3rd"],
  ["ocean", "오션 카드", "TOP 1"],
  ["forest", "포레스트", "◆ 1"],
  ["lavender", "라벤더 카드", "1위"],
  ["mono", "모노 숫자", "01"],
  ["transparent", "투명 미니멀", "1."],
  ["custom", "직접 설정", "내 스타일"],
];
const rankingStyles = (first, second, third, rest) => [
  first,
  second,
  third,
  rest,
];
const RANKING_THEME_PRESETS = {
  midnight: {
    rankingFontFamily: '"Noto Sans KR", sans-serif', rankingFontSize: 30, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.2, rankingLetterSpacing: -1, rankingRowGap: 10, rankingColumnGap: 24,
    rankingTitleSize: 24, rankingTitleAlign: "left", rankingTitleColor: "#ffffff", rankingNameColor: "#ffffff", rankingAmountColor: "#b9dcff",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "fade", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#ffe58a", badge: "#8a6414", size: 118, weight: 900 }, { color: "#e2edfa", badge: "#60758b", size: 109, weight: 800 },
      { color: "#ffc092", badge: "#855137", size: 104, weight: 800 }, { color: "#ffffff", badge: "#315b88", size: 100, weight: 700 },
    ),
  },
  clean: {
    rankingFontFamily: '"Gothic A1", sans-serif', rankingFontSize: 27, rankingFontWeight: 600,
    rankingUseLineHeight: true, rankingLineHeight: 1.3, rankingLetterSpacing: -0.5, rankingRowGap: 7, rankingColumnGap: 28,
    rankingTitleSize: 21, rankingTitleAlign: "left", rankingTitleColor: "#27425e", rankingNameColor: "#315574", rankingAmountColor: "#376e9f",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "slide-up", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#173b5f", badge: "#b9d7ef", size: 112, weight: 900 }, { color: "#315574", badge: "#d8e5ef", size: 106, weight: 800 },
      { color: "#426882", badge: "#e5edf3", size: 102, weight: 700 }, { color: "#315574", badge: "#e4edf6", size: 100, weight: 600 },
    ),
  },
  neon: {
    rankingFontFamily: '"Gasoek One", sans-serif', rankingFontSize: 29, rankingFontWeight: 400,
    rankingUseLineHeight: true, rankingLineHeight: 1.25, rankingLetterSpacing: 0, rankingRowGap: 13, rankingColumnGap: 30,
    rankingTitleSize: 27, rankingTitleAlign: "center", rankingTitleColor: "#ff72ef", rankingNameColor: "#70ffe7", rankingAmountColor: "#ff8ff2",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "zoom", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#fff36d", badge: "#ff34dc", size: 125, weight: 900 }, { color: "#7ffff0", badge: "#793fff", size: 114, weight: 800 },
      { color: "#ff9cf1", badge: "#254fff", size: 108, weight: 800 }, { color: "#70ffe7", badge: "#2b0b35", size: 100, weight: 700 },
    ),
  },
  gold: {
    rankingFontFamily: '"Noto Serif KR", serif', rankingFontSize: 31, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.25, rankingLetterSpacing: -0.5, rankingRowGap: 12, rankingColumnGap: 26,
    rankingTitleSize: 29, rankingTitleAlign: "center", rankingTitleColor: "#ffd76a", rankingNameColor: "#fff1bf", rankingAmountColor: "#ffd76a",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "stagger", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#fff3a8", badge: "#c99628", size: 130, weight: 900 }, { color: "#f0f2f5", badge: "#9ca6af", size: 117, weight: 800 },
      { color: "#f2b384", badge: "#a75d31", size: 110, weight: 800 }, { color: "#fff1bf", badge: "#6d511b", size: 100, weight: 700 },
    ),
  },
  rose: {
    rankingFontFamily: '"Hahmlet", serif', rankingFontSize: 29, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.3, rankingLetterSpacing: -0.5, rankingRowGap: 9, rankingColumnGap: 24,
    rankingTitleSize: 26, rankingTitleAlign: "left", rankingTitleColor: "#ff9cbd", rankingNameColor: "#ffe8f0", rankingAmountColor: "#ff9cbd",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "slide-left", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#fff0c9", badge: "#c13f70", size: 120, weight: 900 }, { color: "#ffe3ee", badge: "#963457", size: 111, weight: 800 },
      { color: "#ffc1d7", badge: "#7b2948", size: 105, weight: 800 }, { color: "#ffe8f0", badge: "#a5315c", size: 100, weight: 700 },
    ),
  },
  ocean: {
    rankingFontFamily: '"Gowun Dodum", sans-serif', rankingFontSize: 29, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.25, rankingLetterSpacing: 0, rankingRowGap: 11, rankingColumnGap: 30,
    rankingTitleSize: 25, rankingTitleAlign: "left", rankingTitleColor: "#6bd9ff", rankingNameColor: "#d9f6ff", rankingAmountColor: "#6bd9ff",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "slide-up", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#ffffff", badge: "#00a7d8", size: 122, weight: 900 }, { color: "#b8efff", badge: "#167da4", size: 112, weight: 800 },
      { color: "#89def8", badge: "#11607f", size: 106, weight: 800 }, { color: "#d9f6ff", badge: "#0d4a64", size: 100, weight: 700 },
    ),
  },
  forest: {
    rankingFontFamily: '"Gowun Batang", serif', rankingFontSize: 29, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.32, rankingLetterSpacing: 0, rankingRowGap: 10, rankingColumnGap: 28,
    rankingTitleSize: 25, rankingTitleAlign: "left", rankingTitleColor: "#87e7b0", rankingNameColor: "#dcf7e7", rankingAmountColor: "#87e7b0",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "fade", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#efffb0", badge: "#3b875e", size: 119, weight: 900 }, { color: "#d7f5e3", badge: "#317655", size: 110, weight: 800 },
      { color: "#aee8c6", badge: "#286046", size: 105, weight: 800 }, { color: "#dcf7e7", badge: "#246645", size: 100, weight: 700 },
    ),
  },
  lavender: {
    rankingFontFamily: '"Jua", sans-serif', rankingFontSize: 30, rankingFontWeight: 400,
    rankingUseLineHeight: true, rankingLineHeight: 1.25, rankingLetterSpacing: 0, rankingRowGap: 11, rankingColumnGap: 26,
    rankingTitleSize: 27, rankingTitleAlign: "center", rankingTitleColor: "#dccbff", rankingNameColor: "#eee7ff", rankingAmountColor: "#cbb2ff",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "zoom", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#fff4ad", badge: "#9877d8", size: 123, weight: 900 }, { color: "#eee7ff", badge: "#8061bd", size: 113, weight: 800 },
      { color: "#d7c5ff", badge: "#6f50a7", size: 106, weight: 700 }, { color: "#eee7ff", badge: "#5c438a", size: 100, weight: 700 },
    ),
  },
  mono: {
    rankingFontFamily: '"Nanum Gothic Coding", monospace', rankingFontSize: 27, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.2, rankingLetterSpacing: 1, rankingRowGap: 6, rankingColumnGap: 20,
    rankingTitleSize: 20, rankingTitleAlign: "left", rankingTitleColor: "#ffffff", rankingNameColor: "#f1f1f1", rankingAmountColor: "#c8c8c8",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "none", rankingBackgroundEnabled: true,
    rankingRankStyles: rankingStyles(
      { color: "#ffffff", badge: "#777777", size: 114, weight: 900 }, { color: "#e0e0e0", badge: "#5e5e5e", size: 108, weight: 800 },
      { color: "#c5c5c5", badge: "#494949", size: 104, weight: 800 }, { color: "#f1f1f1", badge: "#333333", size: 100, weight: 700 },
    ),
  },
  transparent: {
    rankingFontFamily: '"Noto Sans KR", sans-serif', rankingFontSize: 28, rankingFontWeight: 700,
    rankingUseLineHeight: true, rankingLineHeight: 1.2, rankingLetterSpacing: -0.5, rankingRowGap: 5, rankingColumnGap: 20,
    rankingTitleSize: 22, rankingTitleAlign: "right", rankingTitleColor: "#ffffff", rankingNameColor: "#ffffff", rankingAmountColor: "#dbeaff",
    rankingRowAlign: "spread", rankingNameAlign: "left", rankingAmountAlign: "right", rankingAnimation: "fade", rankingBackgroundEnabled: false,
    rankingRankStyles: rankingStyles(
      { color: "#ffe080", badge: "#ffffff", size: 116, weight: 900 }, { color: "#e8eef5", badge: "#ffffff", size: 108, weight: 800 },
      { color: "#e8b48b", badge: "#ffffff", size: 103, weight: 800 }, { color: "#ffffff", badge: "#ffffff", size: 100, weight: 700 },
    ),
  },
};
function rankMarker(theme, index) {
  const rank = index + 1;
  if (theme === "gold" && rank <= 3) return ["🥇", "🥈", "🥉"][index];
  if (theme === "rose" && rank <= 3)
    return `${rank}${["st", "nd", "rd"][index]}`;
  if (theme === "clean") return String(rank).padStart(2, "0");
  if (theme === "ocean") return rank <= 3 ? `TOP ${rank}` : rank;
  if (theme === "forest") return `◆ ${rank}`;
  if (theme === "lavender") return `${rank}위`;
  if (theme === "mono") return String(rank).padStart(2, "0");
  if (theme === "transparent") return `${rank}.`;
  return rank;
}
const soundOptions = (settings) => [
  ...SOUND_OPTIONS.filter(([value]) => value !== "custom"),
  ...(settings.soundLibrary || []).map((sound) => [
    `library:${sound.id}`,
    `내 음원 · ${sound.name}`,
  ]),
  ["custom", "기존 직접 추가 음원"],
];
const soundData = (settings, preset, fallback = "") =>
  preset?.startsWith("library:")
    ? (settings.soundLibrary || []).find(
        (sound) => sound.id === preset.slice(8),
      )?.data || ""
    : preset === "custom"
      ? fallback || settings.customSoundData
      : "";

function resolveTier(settings, amount = 50000) {
  return (
    [...(settings.amountTiers || [])]
      .filter(
        (tier) =>
          tier.enabled !== false &&
          amount >= Number(tier.minAmount || 0) &&
          (tier.maxAmount == null || amount <= Number(tier.maxAmount)),
      )
      .sort((a, b) => Number(b.minAmount) - Number(a.minAmount))[0] || null
  );
}

function hexToRgba(hex, opacity = 1) {
  const value = String(hex || "").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(21,21,34,${opacity})`;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16},${(number >> 8) & 255},${number & 255},${Math.max(0, Math.min(1, Number(opacity) || 0))})`;
}

function colorPickerValue(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const match = text.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!match) return "#000000";
  return `#${match.slice(1).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
}

function useTransparentDocument() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = { html:html.style.background, body:body.style.background };
    html.style.setProperty("background", "transparent", "important");
    body.style.setProperty("background", "transparent", "important");
    return () => {
      html.style.background = previous.html;
      body.style.background = previous.body;
    };
  }, []);
}

function alertAppearance(settings, amount = 50000) {
  const tier = resolveTier(settings, amount);
  const previewGrade = (settings.crewGrades || []).find(
    (grade) => grade.id === settings.previewCrewGradeId,
  );
  const customText = tier?.textMode === "custom";
  const customEffect = tier?.effectMode === "custom";
  const customSound = tier?.soundMode === "custom";
  const customTts = tier?.ttsMode === "custom";
  const family = customText
    ? tier.fontFamily
    : settings.customFontFamily?.trim() || settings.fontFamily;
  return {
    tier,
    gradeImage: previewGrade?.imageData || "",
    gradeName: previewGrade?.name || "",
    gradeSize: settings.crewGradeImageSize,
    gradeDisplayMode: settings.crewGradeDisplayMode,
    gradeTextStyle: { color:settings.crewGradeTextColor, fontFamily:settings.crewGradeTextFontFamily, fontSize:settings.crewGradeTextSize },
    showGrade: settings.crewGradeEnabled,
    nameColorEnabled: settings.nameColorEnabled,
    nameColor: settings.nameColor,
    amountColorEnabled: settings.amountColorEnabled,
    amountColor: settings.amountColor,
    suffixStyle: settings.suffixStyleEnabled ? { color:settings.suffixColor, fontFamily:settings.suffixFontFamily } : undefined,
    messageTemplate:
      tier?.messageMode === "custom" && tier.messageTemplate
        ? tier.messageTemplate
        : settings.messageTemplate,
    animation: customEffect ? tier.animation : settings.animation,
    exitAnimation: customEffect ? tier.exitAnimation : settings.exitAnimation,
    durationMs: customEffect ? tier.durationMs : settings.durationMs,
    soundPreset: customSound ? tier.soundPreset : settings.soundPreset,
    soundVolume: customSound ? tier.soundVolume : settings.soundVolume,
    customSoundData: soundData(
      settings,
      customSound ? tier.soundPreset : settings.soundPreset,
      customSound ? tier.customSoundData : settings.customSoundData,
    ),
    ttsEnabled: customTts ? tier.ttsEnabled !== false : settings.ttsEnabled,
    ttsProvider: customTts ? tier.ttsProvider : settings.ttsProvider,
    ttsVoiceURI: customTts ? tier.ttsVoiceURI : settings.ttsVoiceURI,
    ttsElevenVoiceId: customTts
      ? tier.ttsElevenVoiceId
      : settings.ttsElevenVoiceId,
    ttsElevenVoiceName: customTts
      ? tier.ttsElevenVoiceName
      : settings.ttsElevenVoiceName,
    ttsModel: customTts ? tier.ttsModel : settings.ttsModel,
    ttsTypecastVoiceId: customTts
      ? tier.ttsTypecastVoiceId
      : settings.ttsTypecastVoiceId,
    ttsTypecastVoiceName: customTts
      ? tier.ttsTypecastVoiceName
      : settings.ttsTypecastVoiceName,
    ttsTypecastEmotion: customTts
      ? tier.ttsTypecastEmotion
      : settings.ttsTypecastEmotion,
    ttsRate: customTts ? tier.ttsRate : settings.ttsRate,
    ttsPitch: customTts ? tier.ttsPitch : settings.ttsPitch,
    ttsVolume: customTts ? tier.ttsVolume : settings.ttsVolume,
    backgroundImageArea: settings.backgroundImageArea === "canvas" ? "canvas" : "alert",
    style: {
      color: customText ? tier.textColor : settings.textColor,
      fontSize: customText ? tier.fontSize : settings.fontSize,
      fontWeight: customText ? tier.fontWeight : settings.fontWeight,
      fontFamily: family,
      textAlign: settings.textAlign,
      lineHeight: settings.lineHeight,
      letterSpacing: `${settings.letterSpacing}px`,
      WebkitTextStroke:
        settings.outlineEnabled === false
          ? "0 transparent"
          : `${customText ? tier.outlineWidth : settings.outlineWidth}px ${customText ? tier.outlineColor : settings.outlineColor}`,
      textShadow: settings.textShadow ? "0 5px 16px #000b" : "none",
      padding: settings.backgroundEnabled
        ? `${settings.backgroundPadding}px`
        : "0",
      borderRadius: settings.backgroundEnabled
        ? `${settings.backgroundRadius}px`
        : "0",
      backgroundColor: settings.backgroundEnabled && settings.backgroundColorEnabled !== false
        ? hexToRgba(settings.backgroundColor, settings.backgroundOpacity)
        : "transparent",
      backgroundImage: settings.backgroundEnabled && settings.backgroundImageData
        ? `url(${settings.backgroundImageData})` : "none",
      backgroundSize: Number(settings.backgroundImageScale || 100) === 100
        ? (settings.backgroundImageFit === "contain" ? "contain" : "cover")
        : `${settings.backgroundImageScale}% auto`,
      backgroundPosition: `${settings.backgroundImagePositionX ?? 50}% ${settings.backgroundImagePositionY ?? 50}%`,
      backgroundRepeat: "no-repeat",
    },
  };
}

function useSpeechVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .slice()
          .sort(
            (a, b) =>
              (a.lang === "ko-KR" ? 0 : 1) - (b.lang === "ko-KR" ? 0 : 1) ||
              a.lang.localeCompare(b.lang) ||
              a.name.localeCompare(b.name),
          ),
      );
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

function waitForSpeechVoices(preferredVoiceURI = "") {
  const synthesis = window.speechSynthesis;
  if (!synthesis) return Promise.resolve([]);
  const ready = (voices) =>
    voices.length > 0 &&
    (!preferredVoiceURI ||
      voices.some((voice) => voice.voiceURI === preferredVoiceURI));
  const current = synthesis.getVoices();
  if (ready(current)) return Promise.resolve(current);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      synthesis.removeEventListener("voiceschanged", handleChange);
      resolve(synthesis.getVoices());
    };
    const handleChange = () => {
      if (ready(synthesis.getVoices())) finish();
    };
    const timer = setTimeout(finish, 1200);
    synthesis.addEventListener("voiceschanged", handleChange);
  });
}

async function playBrowserSpeech(appearance, text) {
  if (
    !appearance.ttsEnabled ||
    !window.speechSynthesis ||
    !window.SpeechSynthesisUtterance
  )
    return;
  const utterance = new SpeechSynthesisUtterance(
    String(text || "")
      .replaceAll("{grade}", "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const availableVoices = await waitForSpeechVoices(appearance.ttsVoiceURI);
  const voice =
    availableVoices.find((item) => item.voiceURI === appearance.ttsVoiceURI) ||
    availableVoices.find((item) => item.lang?.toLowerCase().startsWith("ko"));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "ko-KR";
  utterance.rate = Math.max(0.5, Math.min(2, Number(appearance.ttsRate) || 1));
  utterance.pitch = Math.max(0, Math.min(2, Number(appearance.ttsPitch) || 1));
  utterance.volume = Math.max(
    0,
    Math.min(1, Number(appearance.ttsVolume) / 100),
  );
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

let activeAlertSpeechAudio = null;

function stopActiveAlertSpeech() {
  window.speechSynthesis?.cancel();
  if (activeAlertSpeechAudio) {
    activeAlertSpeechAudio.audio.pause();
    activeAlertSpeechAudio.audio.currentTime = 0;
    URL.revokeObjectURL(activeAlertSpeechAudio.url);
    activeAlertSpeechAudio = null;
  }
}

async function playRemoteSpeech(appearance, text, token = null) {
  const endpoint = token
    ? `/api/overlay/${encodeURIComponent(token)}/tts`
    : "/api/tts/preview";
  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      provider: appearance.ttsProvider,
      voiceId: appearance.ttsProvider === "typecast"
        ? appearance.ttsTypecastVoiceId
        : appearance.ttsElevenVoiceId,
      model: appearance.ttsModel,
      rate: appearance.ttsRate,
      pitch: appearance.ttsPitch,
      emotion: appearance.ttsTypecastEmotion,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "AI 음성을 만들지 못했습니다.");
  }
  const url = URL.createObjectURL(await response.blob());
  const audio = new Audio(url);
  activeAlertSpeechAudio?.audio.pause();
  activeAlertSpeechAudio = { audio, url };
  audio.volume = Math.max(0, Math.min(1, Number(appearance.ttsVolume) / 100));
  const cleanup = () => {
    if (activeAlertSpeechAudio?.audio === audio) activeAlertSpeechAudio = null;
    URL.revokeObjectURL(url);
  };
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  await audio.play();
  return appearance.ttsProvider;
}

async function playAlertSpeech(appearance, text, options = {}) {
  const speechText = String(text || "")
    .replaceAll("{grade}", "")
    .replace(/\s+/g, " ")
    .trim();
  if (!speechText) return "none";
  if (!appearance.ttsTypecastVoiceId) return "none";
  return playRemoteSpeech(
    { ...appearance, ttsProvider:"typecast" },
    speechText,
    options.token,
  );
}

const TYPECAST_EMOTION_LABELS = {
  smart:"스마트 감정 · 문맥 자동 분석",
  normal:"보통",
  happy:"기쁨",
  sad:"슬픔",
  angry:"화남",
  whisper:"속삭임",
  toneup:"밝은 톤",
  tonedown:"차분한 톤",
};
const TYPECAST_SEARCH_PRESETS = [
  ["여성", "female"], ["남성", "male"], ["젊은 목소리", "young_adult"],
  ["어린이", "child"], ["대화", "Conversational"], ["나레이션", "Narration"],
  ["아나운서", "Announcer"], ["뉴스", "News"], ["오디오북", "Audiobook"],
  ["게임", "Game"], ["쇼츠", "Tiktok/Reels"],
];
const TYPECAST_SEARCH_ALIASES = {
  female:"여성 여자", male:"남성 남자", child:"어린이 아이 키즈",
  teenager:"청소년 십대", young_adult:"청년 젊은", middle_age:"중년", senior:"노년 시니어",
  conversational:"대화 친근한", narration:"나레이션 내레이션", announcer:"아나운서",
  news:"뉴스 기자", audiobook:"오디오북 낭독", game:"게임 캐릭터",
  "tiktok/reels":"쇼츠 릴스 틱톡", podcast:"팟캐스트", documentary:"다큐멘터리",
  "e-learning":"교육 학습", ads:"광고", voicemail:"안내 음성",
};

async function playAlertSound(
  settings,
  preset = settings.soundPreset,
  volume = settings.soundVolume,
  customSoundData = settings.customSoundData,
  waitForCompletion = false,
) {
  if (!settings.soundEnabled || preset === "none") return;
  if (
    (preset === "custom" || preset?.startsWith("library:")) &&
    customSoundData
  ) {
    const audio = new Audio(customSoundData);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    await audio.play().catch(() => {});
    if (waitForCompletion && !audio.paused) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 15000);
        const finish = () => { clearTimeout(timer); resolve(); };
        audio.addEventListener("ended", finish, { once:true });
        audio.addEventListener("error", finish, { once:true });
      });
    }
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  const master = context.createGain();
  master.connect(context.destination);
  master.gain.setValueAtTime(
    Math.max(0.05, volume / 100) * 0.42,
    context.currentTime,
  );
  const notes = {
    coin: [880, 1320],
    chime: [523, 659, 784],
    pop: [320, 180],
    fanfare: [523, 659, 784, 1046],
    bell: [784, 1175, 1568],
    sparkle: [1046, 1318, 1568, 2093],
    success: [523, 659, 784, 1046],
    drum: [150, 105, 72],
    laser: [1320, 990, 660, 330],
    magic: [659, 988, 1318, 1760],
  }[preset] || [660];
  let finishAt = 0;
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = ["pop", "drum"].includes(preset)
      ? "triangle"
      : preset === "laser"
        ? "sawtooth"
        : "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(master);
    const step = ["sparkle", "magic"].includes(preset) ? 0.08 : 0.11;
    const length = preset === "bell" ? 0.5 : 0.25;
    const start = context.currentTime + index * step;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length - 0.01);
    oscillator.start(start);
    oscillator.stop(start + length);
    finishAt = Math.max(finishAt, index * step + length);
  });
  if (waitForCompletion) {
    await new Promise(resolve => setTimeout(resolve, Math.ceil(finishAt * 1000) + 30));
    await context.close().catch(() => {});
  } else {
    setTimeout(() => context.close().catch(() => {}), 1500);
  }
}

function TierMode({
  title,
  description,
  mode = "inherit",
  onChange,
  children,
}) {
  return (
    <section className="tier-mode">
      <div className="tier-mode-head">
        <div>
          <b>{title}</b>
          <small>{description}</small>
        </div>
        <div className="inherit-selector">
          <button
            type="button"
            className={mode !== "custom" ? "active" : ""}
            onClick={() => onChange("inherit")}
          >
            기본 설정 사용
          </button>
          <button
            type="button"
            className={mode === "custom" ? "active" : ""}
            onClick={() => onChange("custom")}
          >
            이 구간만 다르게
          </button>
        </div>
      </div>
      {children && <div className="tier-mode-body">{children}</div>}
    </section>
  );
}

function AlertSettingSection({
  id,
  title,
  description,
  open,
  onToggle,
  action,
  children,
}) {
  return (
    <section className={`alert-setting-card ${open ? "open" : ""}`}>
      <div className="alert-setting-head">
        <button
          className="alert-setting-title"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`alert-setting-${id}`}
        >
          <b>{title}</b>
          <small>{description}</small>
        </button>
        <div className="alert-setting-actions">
          {action}
          <button
            className="collapse-control"
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`alert-setting-${id}`}
            aria-label={`${title} ${open ? "닫기" : "열기"}`}
          >
            <span>{open ? "닫기" : "열기"}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div className="alert-setting-body" id={`alert-setting-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}

function Settings({ mode }) {
  const voices = useSpeechVoices();
  const [elevenVoices, setElevenVoices] = useState([]);
  const [elevenConfigured, setElevenConfigured] = useState(null);
  const [elevenVoiceError, setElevenVoiceError] = useState("");
  const [typecastVoices, setTypecastVoices] = useState([]);
  const [typecastConfigured, setTypecastConfigured] = useState(null);
  const [typecastVoiceError, setTypecastVoiceError] = useState("");
  const [typecastVoiceQuery, setTypecastVoiceQuery] = useState("");
  const [typecastGenderFilter, setTypecastGenderFilter] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [settingsLoadAttempt, setSettingsLoadAttempt] = useState(0);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [toonationStatus, setToonationStatus] = useState({ state:"disabled", text:"투네이션 수신 꺼짐" });
  const [youtubeStatus, setYoutubeStatus] = useState({ state:"disabled", text:"유튜브 채팅 수신 꺼짐" });
  const [saved, setSaved] = useState("");
  const [previewRun, setPreviewRun] = useState(0);
  const [rankingPreviewCount, setRankingPreviewCount] = useState(60);
  const [openTiers, setOpenTiers] = useState({});
  const [openAlertSections, setOpenAlertSections] = useState({});
  const [leaveRequest, setLeaveRequest] = useState(null);
  const leaveResolver = useRef(null);
  const savingBeforeLeave = useRef(false);
  const selectedTypecastVoice = typecastVoices.find(
    (voice) => voice.id === settings.ttsTypecastVoiceId,
  );
  const filteredTypecastVoices = typecastVoices.filter((voice) => {
    const query = typecastVoiceQuery.trim().toLowerCase();
    const rawTerms = [voice.gender, voice.age, ...(voice.useCases || [])];
    const aliases = rawTerms.flatMap((term) => TYPECAST_SEARCH_ALIASES[String(term).toLowerCase()] || []);
    const haystack = [voice.name, voice.englishName, ...rawTerms, ...aliases]
      .join(" ")
      .toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!typecastGenderFilter || voice.gender === typecastGenderFilter);
  });
  useEffect(() => {
    let active = true;
    api("/api/tts/typecast-voices", { cache: "no-store" })
      .then((value) => {
        if (!active) return;
        setTypecastConfigured(Boolean(value.configured));
        setTypecastVoices(value.voices || []);
      })
      .catch((error) => {
        if (!active) return;
        setTypecastConfigured(false);
        setTypecastVoiceError(error.message || "Typecast 음성을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active=true;
    setSettingsLoaded(false);
    setSettingsLoadError("");
    api("/api/settings").then((value) => {
      if(!active)return;
      setSettings(value);
      setSavedSettings(value);
      setSettingsLoaded(true);
    }).catch((error)=>{
      if(active)setSettingsLoadError(error.message||"설정을 불러오지 못했습니다.");
    });
    return()=>{active=false;};
  }, [settingsLoadAttempt]);
  useEffect(() => {
    if (mode !== "alert" || !settingsLoaded) return;
    let active = true;
    const loadStatus = () => Promise.all([
      api("/api/toonation/status", { cache:"no-store" }).then((value) => active && setToonationStatus(value)).catch(() => {}),
      api("/api/youtube/status", { cache:"no-store" }).then((value) => active && setYoutubeStatus(value)).catch(() => {}),
    ]);
    loadStatus();
    const timer = setInterval(loadStatus, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [mode, settingsLoaded]);
  const isDirty =
    settingsLoaded &&
    JSON.stringify(settings) !== JSON.stringify(savedSettings);
  useEffect(() => {
    if (!isDirty) {
      delete window.__settingsNavigationGuard;
      return;
    }
    window.__settingsNavigationGuard = (next) =>
      new Promise((resolve) => {
        leaveResolver.current = resolve;
        setLeaveRequest(next);
      });
    return () => {
      delete window.__settingsNavigationGuard;
    };
  }, [isDirty]);
  useEffect(() => {
    const warn = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [isDirty]);
  const update = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setPreviewRun((current) => current + 1);
  };
  async function persistSettings() {
    const next = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    setSettings(next);
    setSavedSettings(next);
    return next;
  }
  function restoreSettings() {
    setSettings(savedSettings);
    setPreviewRun((current) => current + 1);
    setSaved("저장된 설정으로 되돌렸습니다.");
  }
  function finishLeave(allow) {
    if (allow && !savingBeforeLeave.current) {
      setSettings(savedSettings);
      setPreviewRun((current) => current + 1);
      setSaved("");
    }
    const resolve = leaveResolver.current;
    leaveResolver.current = null;
    setLeaveRequest(null);
    resolve?.(allow);
  }
  async function saveAndLeave() {
    savingBeforeLeave.current = true;
    try {
      await persistSettings();
      finishLeave(true);
    } catch (error) {
      setSaved(error.message || "설정을 저장하지 못했습니다.");
    } finally {
      savingBeforeLeave.current = false;
    }
  }
  async function save(event) {
    event.preventDefault();
    if(settingsSaving||!isDirty)return;
    setSettingsSaving(true);
    setSaved("");
    try {
      await persistSettings();
      setSaved(
        mode === "alert"
          ? "알림 설정을 저장했습니다. 다음 후원 알림부터 적용됩니다."
          : "후원 순위표 설정을 저장했습니다. OBS 순위표에 바로 적용됩니다.",
      );
    } catch(error) {
      setSaved(error.message||"설정을 저장하지 못했습니다.");
    } finally {
      setSettingsSaving(false);
    }
  }
  async function openWidgetPreview() {
    const popup = window.open("about:blank", "_blank");
    try {
      await persistSettings();
      if (popup && isAlert) {
        const previewSession = await api("/api/overlay/preview-session", { method:"POST", body:"{}" });
        let played = false;
        const playSyncedAudio = () => {
          if (played) return;
          played = true;
          playAlertSound(
            settings,
            appearance.soundPreset,
            appearance.soundVolume,
            appearance.customSoundData,
          );
          playAlertSpeech(appearance, preview);
          removeEventListener("message", handlePreviewReady);
        };
        const handlePreviewReady = (event) => {
          if (
            event.origin === location.origin &&
            event.source === popup &&
            event.data?.type === "n9-preview-visible"
          )
            playSyncedAudio();
        };
        addEventListener("message", handlePreviewReady);
        setTimeout(playSyncedAudio, 1800);
        popup.location.href = `/overlay?preview=1&sound=off&previewToken=${encodeURIComponent(previewSession.token)}`;
      } else if (popup) popup.location.href = "/ranking";
      setSaved("현재 설정을 저장하고 예시 화면을 열었습니다.");
    } catch (error) {
      popup?.close();
      setSaved(error.message || "예시 화면을 열지 못했습니다.");
    }
  }
  if(!settingsLoaded){
    const isAlert=mode==="alert";
    return <PageLayout><div className="shell settings-loading-shell"><header><div><span className="eyebrow">{isAlert?"DONATION ALERT":"DONATION RANKING"}</span><h1>{isAlert?"후원 알림 설정":"후원 순위표 설정"}</h1><p className="page-description">저장된 설정을 안전하게 불러온 뒤 화면을 표시합니다.</p></div></header><section className="panel settings-loading-card" aria-live="polite">{settingsLoadError?<><span className="settings-loading-error">!</span><h2>설정을 불러오지 못했습니다</h2><p>{settingsLoadError}</p><button type="button" className="primary-button" onClick={()=>setSettingsLoadAttempt(value=>value+1)}>다시 불러오기</button></>:<><span className="settings-loading-spinner"/><h2>저장된 설정을 불러오는 중입니다</h2><p>잠시만 기다려주세요.</p></>}</section></div></PageLayout>;
  }
  const appearance = alertAppearance(settings, 50000);
  const preview = appearance.messageTemplate
    .replaceAll("{name}", "폴조지")
    .replaceAll("{amount}", "50,000");
  const style = appearance.style;
  const isAlert = mode === "alert";
  const isAlertInitialView =
    isAlert && !Object.values(openAlertSections).some(Boolean);
  const toggleAlertSection = (id) =>
    setOpenAlertSections((current) => ({ ...current, [id]: !current[id] }));
  const toggleCrewGrade = (enabled) => {
    setSettings((current) => {
      const messageWithoutGrade = current.messageTemplate.replaceAll(
        "{grade}",
        "",
      );
      const messageTemplate = enabled
        ? messageWithoutGrade.includes("{name}")
          ? messageWithoutGrade.replace("{name}", "{grade}{name}")
          : `{grade}${messageWithoutGrade}`
        : messageWithoutGrade;
      return { ...current, crewGradeEnabled: enabled, messageTemplate };
    });
  };
  const addTier = () => {
    const id = crypto.randomUUID();
    update("amountTiers", [
      ...(settings.amountTiers || []),
      {
        id,
        draft: true,
        name: `${(settings.amountTiers || []).length + 1}구간`,
        minAmount: 100000,
        maxAmount: null,
        enabled: true,
        messageMode: "inherit",
        messageTemplate: "",
        textMode: "inherit",
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        fontWeight: settings.fontWeight,
        textColor: settings.textColor,
        outlineColor: settings.outlineColor,
        outlineWidth: settings.outlineWidth,
        effectMode: "inherit",
        animation: settings.animation,
        exitAnimation: settings.exitAnimation,
        durationMs: settings.durationMs,
        soundMode: "inherit",
        soundPreset: settings.soundPreset,
        soundVolume: settings.soundVolume,
        customSoundName: "",
        customSoundData: "",
        ttsMode: "inherit",
        ttsEnabled: settings.ttsEnabled,
        ttsProvider: settings.ttsProvider,
        ttsVoiceURI: settings.ttsVoiceURI,
        ttsElevenVoiceId: settings.ttsElevenVoiceId,
        ttsElevenVoiceName: settings.ttsElevenVoiceName,
        ttsModel: settings.ttsModel,
        ttsTypecastVoiceId: settings.ttsTypecastVoiceId,
        ttsTypecastVoiceName: settings.ttsTypecastVoiceName,
        ttsTypecastEmotion: settings.ttsTypecastEmotion,
        ttsRate: settings.ttsRate,
        ttsPitch: settings.ttsPitch,
        ttsVolume: settings.ttsVolume,
      },
    ]);
    setOpenAlertSections((current) => ({ ...current, tiers: true }));
    setOpenTiers((current) => ({ ...current, [id]: true }));
  };
  const changeTier = (id, key, value) =>
    update(
      "amountTiers",
      (settings.amountTiers || []).map((tier) =>
        tier.id === id ? { ...tier, [key]: value } : tier,
      ),
    );
  const removeTier = (id) => {
    update(
      "amountTiers",
      (settings.amountTiers || []).filter((tier) => tier.id !== id),
    );
    setOpenTiers((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const toggleTier = (id) =>
    setOpenTiers((current) => ({ ...current, [id]: !current[id] }));
  async function readSound(file) {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("효과음 파일은 5MB 이하만 사용할 수 있습니다.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const changeRankStyle = (index, key, value) =>
    update(
      "rankingRankStyles",
      (settings.rankingRankStyles || DEFAULT_SETTINGS.rankingRankStyles).map(
        (style, i) => (i === index ? { ...style, [key]: value } : style),
      ),
    );
  async function addLibrarySound(file, select) {
    if (!file) return;
    try {
      const data = await readSound(file);
      const id = crypto.randomUUID();
      setSettings((current) => {
        if ((current.soundLibrary || []).length >= 10) {
          setSaved("내 음원은 계정마다 최대 10개까지 보관할 수 있습니다.");
          return current;
        }
        return select(
          {
            ...current,
            soundLibrary: [
              ...(current.soundLibrary || []),
              { id, name: file.name, data },
            ],
          },
          `library:${id}`,
        );
      });
      setSaved(`‘${file.name}’을 내 음원 보관함에 추가했습니다.`);
    } catch (error) {
      setSaved(error.message);
    }
  }
  const loadSound = (event) =>
    addLibrarySound(event.target.files?.[0], (current, preset) => ({
      ...current,
      soundPreset: preset,
      soundEnabled: true,
    }));
  const loadTierSound = (tierId, event) =>
    addLibrarySound(event.target.files?.[0], (current, preset) => ({
      ...current,
      amountTiers: (current.amountTiers || []).map((tier) =>
        tier.id === tierId ? { ...tier, soundPreset: preset } : tier,
      ),
    }));
  const removeLibrarySound = (id) =>
    setSettings((current) => {
      const preset = `library:${id}`;
      return {
        ...current,
        soundPreset:
          current.soundPreset === preset ? "coin" : current.soundPreset,
        soundLibrary: (current.soundLibrary || []).filter(
          (sound) => sound.id !== id,
        ),
        amountTiers: (current.amountTiers || []).map((tier) =>
          tier.soundPreset === preset ? { ...tier, soundPreset: "coin" } : tier,
        ),
      };
    });
  return (
    <PageLayout>
      <div className="shell">
        <header>
          <div>
            <span className="eyebrow">
              {isAlert ? "DONATION ALERT" : "DONATION RANKING"}
            </span>
            <h1>{isAlert ? "후원 알림 설정" : "후원 순위표 설정"}</h1>
            <p className="page-description">
              위에서 아래로 하나씩 설정하면 오른쪽 미리보기에 바로 반영됩니다.
            </p>
          </div>
        </header>
        <main
          className={`settings-grid alert-settings-grid ${isAlert ? "" : "ranking-settings-grid"} ${isAlertInitialView ? "alert-initial-view" : ""}`}
        >
          <form
            id="broadcast-settings-form"
            className={`controls alert-controls ${isAlert ? "" : "ranking-controls"}`}
            onSubmit={save}
          >
            {isAlert ? (
              <>
                <AlertSettingSection
                  id="toonation"
                  title="투네이션 연동"
                  description="투네이션 후원을 순위와 알림에 연결"
                  open={Boolean(openAlertSections.toonation)}
                  onToggle={() => toggleAlertSection("toonation")}
                >
                  <label className="toggle-label">
                    투네이션 후원 수신
                    <input type="checkbox" checked={settings.toonationEnabled} onChange={(e) => update("toonationEnabled", e.target.checked)} />
                    <i />
                  </label>
                  <label className="toonation-url-label">
                    투네이션 공식 알림 위젯 URL <small>최초 1회 설정</small>
                    <input type="password" value={settings.toonationWidgetUrl} placeholder="https://toon.at/widget/alertbox/..." autoComplete="off" onChange={(e) => update("toonationWidgetUrl", e.target.value)} />
                  </label>
                  <p className="alert-setting-help">한 번 저장하면 이 계정에 계속 유지되며 자동으로 재연결됩니다. 투네이션에서 주소를 재발급한 경우에만 다시 입력하세요.</p>
                  <div className="toonation-display-setting">
                    <b>투네이션 알림 화면</b>
                    <div className="toonation-display-options" role="radiogroup" aria-label="투네이션 알림 화면">
                      <button type="button" role="radio" aria-checked={settings.toonationAlertMode === "official"} className={settings.toonationAlertMode === "official" ? "selected" : ""} onClick={()=>setSettings(current=>({...current,toonationAlertMode:"official",toonationUseOwnAlert:false}))}>
                        <span className="toonation-option-icon">T</span>
                        <strong>투네이션 공식 화면</strong>
                        <small>금액만 순위에 합산하고<br/>OBS 공식 위젯으로 표시</small>
                        <i />
                      </button>
                      <button type="button" role="radio" aria-checked={settings.toonationAlertMode === "custom"} className={settings.toonationAlertMode === "custom" ? "selected" : ""} onClick={()=>setSettings(current=>({...current,toonationAlertMode:"custom",toonationUseOwnAlert:true}))}>
                        <span className="toonation-option-icon own">N9</span>
                        <strong>자체 알림 화면</strong>
                        <small>투네이션 후원도<br/>자체 알림 대기열에서 표시</small>
                        <i />
                      </button>
                      <button type="button" role="radio" aria-checked={settings.toonationAlertMode === "custom-original-audio"} className={settings.toonationAlertMode === "custom-original-audio" ? "selected" : ""} onClick={()=>setSettings(current=>({...current,toonationAlertMode:"custom-original-audio",toonationUseOwnAlert:true}))}>
                        <span className="toonation-option-icon audio">♪</span>
                        <strong>자체 화면 + 원본 소리</strong>
                        <small>화면은 자체 알림<br/>TTS·음원은 투네이션 원본</small>
                        <i />
                      </button>
                    </div>
                  </div>
                  <p className="alert-setting-help">
                    {settings.toonationAlertMode === "custom-original-audio"
                      ? "화면은 자체 알림으로 표시하고, 투네이션 공식 위젯에서는 원본 소리만 재생합니다."
                      : settings.toonationUseOwnAlert
                        ? "투네이션 후원도 자체 알림 대기열에서 표시합니다. 화면 중복을 막으려면 OBS의 투네이션 공식 위젯 소스를 숨겨주세요."
                        : "자체 알림에는 투네이션 후원을 표시하지 않고 금액만 순위에 합산합니다. OBS에는 투네이션 공식 위젯 소스를 추가하세요."}
                  </p>
                  {settings.toonationAlertMode === "custom-original-audio" && <div className="toonation-audio-guide"><b>원본 소리용 OBS 설정</b><ol><li>같은 투네이션 URL을 브라우저 소스로 추가</li><li>소스 너비와 높이를 <strong>1 × 1</strong>로 설정</li><li>눈 아이콘은 켜둔 상태로 화면 구석이나 캔버스 밖에 배치</li></ol><small>투네이션 후원에는 자체 효과음과 자체 TTS를 재생하지 않습니다. 계좌 입금 알림의 소리와 TTS는 그대로 유지됩니다.</small></div>}
                  <div className={`toonation-connection-status ${toonationStatus.state}`}>
                    <span />
                    <b>{toonationStatus.text}</b>
                    <button type="button" className="secondary-button" onClick={async()=>{
                      const result=await api("/api/toonation/reconnect",{method:"POST",body:"{}"});
                      setToonationStatus(result.status);
                    }}>다시 연결</button>
                  </div>
                </AlertSettingSection>
                <AlertSettingSection
                  id="youtube-chat"
                  title="유튜브 후원 채팅"
                  description="계좌 입금 후 !후원 명령어의 메시지를 TTS로 재생"
                  open={Boolean(openAlertSections.youtubeChat)}
                  onToggle={() => toggleAlertSection("youtubeChat")}
                >
                  <label className="toggle-label">
                    유튜브 후원 채팅 수신
                    <input type="checkbox" checked={settings.youtubeChatEnabled} onChange={(e) => update("youtubeChatEnabled", e.target.checked)} />
                    <i />
                  </label>
                  <label>
                    YouTube Data API 키
                    <input type="password" value={settings.youtubeApiKey} placeholder="AIza..." autoComplete="off" onChange={(e) => update("youtubeApiKey", e.target.value)} />
                  </label>
                  <div className="toonation-audio-guide">
                    <b>API 키 발급 방법</b>
                    <ol>
                      <li><a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3 페이지</a>에서 프로젝트를 선택하고 API를 사용 설정</li>
                      <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud 사용자 인증 정보</a>에서 <strong>사용자 인증 정보 만들기 → API 키</strong> 선택</li>
                      <li>API 제한을 <strong>YouTube Data API v3</strong>로 지정한 뒤 생성된 키를 위에 붙여넣기</li>
                    </ol>
                    <small>API 키는 계정 설정에 저장되며 OBS 공개 주소로 전달되지 않습니다.</small>
                  </div>
                  <label>
                    라이브 방송 URL 또는 영상 ID
                    <input value={settings.youtubeVideoId} placeholder="https://www.youtube.com/watch?v=..." onChange={(e) => update("youtubeVideoId", e.target.value)} />
                  </label>
                  <label>
                    입금 전후 채팅 검색 범위 (각각 초)
                    <input type="number" min="10" max="120" step="5" value={settings.youtubeMatchWindowSeconds} onChange={(e) => update("youtubeMatchWindowSeconds", Number(e.target.value))} />
                  </label>
                  <label>
                    후원 채팅 최대 길이 (글자)
                    <input type="number" min="20" max="500" step="10" value={settings.youtubeMessageMaxLength} onChange={(e) => update("youtubeMessageMaxLength", Number(e.target.value))} />
                  </label>
                  <label>
                    채팅 TTS 최소 입금액 (원)
                    <input type="number" min="0" max="100000000" step="1000" value={settings.youtubeChatMinimumAmount} onChange={(e) => update("youtubeChatMinimumAmount", Number(e.target.value))} />
                  </label>
                  <p className="alert-setting-help">
                    실제 입금 전후에 <code>!후원등록 입금자명</code>을 입력하면 유튜브 채널 ID와 입금자명이 연결됩니다. 입금자명이 바뀌면 새 이름으로 다시 입금하고 같은 명령을 입력해 직접 변경할 수 있습니다. 이후에는 해당 채널이 입금 전후 30초 안에 작성한 첫 미사용 일반 채팅을 자동으로 찾아 효과음 후 읽습니다.
                  </p>
                  <div className="youtube-link-launcher">
                    <div><b>등록된 유튜브 후원자</b><small>목록이 많아도 설정 화면이 느려지지 않도록 별도 창에서 검색·관리합니다.</small></div>
                    <button type="button" onClick={()=>{const popup=window.open("/settings/youtube-donors","n9-youtube-donors","popup=yes,width=1040,height=760");popup?.focus();}}>관리</button>
                  </div>
                  <div className={`toonation-connection-status ${youtubeStatus.state}`}>
                    <span />
                    <b>{youtubeStatus.text}</b>
                    <button type="button" className="secondary-button" onClick={async()=>{
                      const result=await api("/api/youtube/reconnect",{method:"POST",body:"{}"});
                      setYoutubeStatus(result.status);
                    }}>다시 연결</button>
                  </div>
                </AlertSettingSection>
                <AlertSettingSection
                  id="minimum"
                  title="알림 표시 기준"
                  description="설정 금액 이상인 후원만 알림"
                  open={Boolean(openAlertSections.minimum)}
                  onToggle={() => toggleAlertSection("minimum")}
                >
                  <label>
                    알림 최소 금액 (원)
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={settings.alertMinimumAmount}
                      onChange={(e) =>
                        update(
                          "alertMinimumAmount",
                          Math.max(0, Number(e.target.value)),
                        )
                      }
                    />
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="message"
                  title="알림 문구"
                  description="후원자명·금액이 들어가는 문장"
                  open={Boolean(openAlertSections.message)}
                  onToggle={() => toggleAlertSection("message")}
                >
                  <p className="alert-setting-help">
                    <code>{"{name}"}</code> 후원자명 · <code>{"{amount}"}</code>{" "}
                    금액 · <code>{"{grade}"}</code> 크루 누적 등급
                  </p>
                  <label className="toggle-label message-grade-toggle">
                    크루 누적 등급 표시
                    <input
                      type="checkbox"
                      checked={settings.crewGradeEnabled}
                      onChange={(e) => toggleCrewGrade(e.target.checked)}
                    />
                    <i />
                  </label>
                  <p className="message-grade-help">
                    켜면 크루 후원 현황에 등록한 등급표를 기준으로 닉네임 앞에
                    해당 이미지를 자동 표시합니다.
                  </p>
                  {settings.crewGradeEnabled && (
                    <><label>
                      등급 표시 방식
                      <select value={settings.crewGradeDisplayMode} onChange={(e)=>update("crewGradeDisplayMode",e.target.value)}>
                        <option value="image">이미지 사용</option>
                        <option value="text">글씨 사용</option>
                      </select>
                    </label><label>
                      등급 이미지 크기
                      <input
                        type="range"
                        min="80"
                        max="400"
                        step="4"
                        value={settings.crewGradeImageSize}
                        onChange={(e) =>
                          update("crewGradeImageSize", Number(e.target.value))
                        }
                      />
                      <span>{settings.crewGradeImageSize}px</span>
                    </label>{settings.crewGradeDisplayMode === "text" && <><label>등급 글꼴<select value={settings.crewGradeTextFontFamily} onChange={(e)=>update("crewGradeTextFontFamily",e.target.value)}>{FONT_OPTIONS.map(([value,label])=><option value={value} key={label}>{label}</option>)}</select></label><label>등급 글자색<input type="color" value={settings.crewGradeTextColor} onChange={(e)=>update("crewGradeTextColor",e.target.value)}/><input className="color-code-input" value={settings.crewGradeTextColor} onChange={(e)=>update("crewGradeTextColor",e.target.value)}/></label><label>등급 글자 크기<input type="range" min="16" max="160" value={settings.crewGradeTextSize} onChange={(e)=>update("crewGradeTextSize",Number(e.target.value))}/><span>{settings.crewGradeTextSize}px</span></label></>}</>
                  )}
                  <label>
                    알림 문구
                    <textarea
                      value={settings.messageTemplate}
                      onChange={(e) =>
                        update("messageTemplate", e.target.value)
                      }
                    />
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="text"
                  title="글자 설정"
                  description="글꼴·크기·색상·테두리"
                  open={Boolean(openAlertSections.text)}
                  onToggle={() => toggleAlertSection("text")}
                >
                  <p className="alert-setting-help">
                    웹폰트는 OBS PC에 설치하지 않아도 사용할 수 있습니다. 이름에
                    ‘로컬’이 붙은 글꼴과 직접 입력한 글꼴은 OBS PC에 설치되어야
                    합니다.
                  </p>
                  <label>
                    글꼴
                    <select
                      value={settings.fontFamily}
                      onChange={(e) => update("fontFamily", e.target.value)}
                    >
                      {FONT_OPTIONS.map(([value, label]) => (
                        <option value={value} key={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    직접 입력할 글꼴명
                    <input
                      placeholder="예: 여기어때 잘난체"
                      value={settings.customFontFamily || ""}
                      onChange={(e) =>
                        update("customFontFamily", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    글자 크기
                    <input
                      type="range"
                      min="20"
                      max="160"
                      value={settings.fontSize}
                      onChange={(e) =>
                        update("fontSize", Number(e.target.value))
                      }
                    />
                    <span>{settings.fontSize}px</span>
                  </label>
                  <label>
                    글자 굵기
                    <select
                      value={settings.fontWeight}
                      onChange={(e) =>
                        update("fontWeight", Number(e.target.value))
                      }
                    >
                      {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    정렬
                    <select
                      value={settings.textAlign}
                      onChange={(e) => update("textAlign", e.target.value)}
                    >
                      <option value="left">왼쪽</option>
                      <option value="center">가운데</option>
                      <option value="right">오른쪽</option>
                    </select>
                  </label>
                  <label>
                    줄 간격
                    <input
                      type="range"
                      min="0.8"
                      max="2.5"
                      step="0.05"
                      value={settings.lineHeight}
                      onChange={(e) =>
                        update("lineHeight", Number(e.target.value))
                      }
                    />
                    <span>{settings.lineHeight}</span>
                  </label>
                  <label>
                    자간
                    <input
                      type="range"
                      min="-5"
                      max="30"
                      value={settings.letterSpacing}
                      onChange={(e) =>
                        update("letterSpacing", Number(e.target.value))
                      }
                    />
                    <span>{settings.letterSpacing}px</span>
                  </label>
                  <div className="text-color-row">
                    <label className="color-control">
                      글자색
                      <span className="inline-color-control">
                        <input type="color" value={colorPickerValue(settings.textColor)} onChange={(e) => update("textColor", e.target.value)} />
                        <input className="color-code-input" value={settings.textColor} onChange={(e)=>update("textColor",e.target.value)} placeholder="#FFFFFF" />
                      </span>
                    </label>
                    <div
                      className={`outline-control ${settings.outlineEnabled === false ? "disabled" : ""}`}
                    >
                      <div className="outline-control-head">
                        <span>글자 테두리</span>
                        <label
                          className="compact-check"
                          aria-label="글자 테두리 사용"
                        >
                          <input
                            type="checkbox"
                            checked={settings.outlineEnabled !== false}
                            onChange={(e) =>
                              update("outlineEnabled", e.target.checked)
                            }
                          />
                          <span aria-hidden="true" />
                        </label>
                      </div>
                      <span className="inline-color-control">
                        <input aria-label="테두리색" type="color" disabled={settings.outlineEnabled === false} value={colorPickerValue(settings.outlineColor)} onChange={(e) => update("outlineColor", e.target.value)} />
                        <input aria-label="테두리 색상 코드" className="color-code-input" disabled={settings.outlineEnabled === false} value={settings.outlineColor} onChange={(e)=>update("outlineColor",e.target.value)} />
                      </span>
                    </div>
                  </div>
                  {settings.outlineEnabled !== false && (
                    <label>
                      테두리 굵기
                      <input
                        type="range"
                        min="0.5"
                        max="12"
                        step=".5"
                        value={Math.max(0.5, settings.outlineWidth)}
                        onChange={(e) =>
                          update("outlineWidth", Number(e.target.value))
                        }
                      />
                      <span>{settings.outlineWidth}px</span>
                    </label>
                  )}
                  <div className="token-color-settings">
                    <div>
                      <label className="toggle-label">
                        닉네임 색상 따로 지정
                        <input
                          type="checkbox"
                          checked={Boolean(settings.nameColorEnabled)}
                          onChange={(e) =>
                            update("nameColorEnabled", e.target.checked)
                          }
                        />
                        <i />
                      </label>
                      {settings.nameColorEnabled && (
                        <label className="token-color-picker">
                          <span>{"{name}"} 색상</span>
                          <input
                            type="color"
                            value={colorPickerValue(settings.nameColor)}
                            onChange={(e) => update("nameColor", e.target.value)}
                          />
                          <input className="color-code-input" value={settings.nameColor} onChange={(e)=>update("nameColor",e.target.value)} />
                        </label>
                      )}
                    </div>
                    <div>
                      <label className="toggle-label">
                        금액 색상 따로 지정
                        <input
                          type="checkbox"
                          checked={Boolean(settings.amountColorEnabled)}
                          onChange={(e) =>
                            update("amountColorEnabled", e.target.checked)
                          }
                        />
                        <i />
                      </label>
                      {settings.amountColorEnabled && (
                        <label className="token-color-picker">
                          <span>{"{amount}"} 색상</span>
                          <input
                            type="color"
                            value={colorPickerValue(settings.amountColor)}
                            onChange={(e) =>
                              update("amountColor", e.target.value)
                            }
                          />
                          <input className="color-code-input" value={settings.amountColor} onChange={(e)=>update("amountColor",e.target.value)} />
                        </label>
                      )}
                    </div>
                  </div>
                  <label className="toggle-label">
                    글자 그림자
                    <input
                      type="checkbox"
                      checked={settings.textShadow}
                      onChange={(e) => update("textShadow", e.target.checked)}
                    />
                    <i />
                  </label>
                  <label className="toggle-label">‘님’·‘원’ 개별 스타일<input type="checkbox" checked={Boolean(settings.suffixStyleEnabled)} onChange={(e)=>update("suffixStyleEnabled",e.target.checked)}/><i /></label>
                  {settings.suffixStyleEnabled && <><label>‘님’·‘원’ 글꼴<select value={settings.suffixFontFamily} onChange={(e)=>update("suffixFontFamily",e.target.value)}>{FONT_OPTIONS.map(([value,label])=><option value={value} key={label}>{label}</option>)}</select></label><label>‘님’·‘원’ 색상<span className="inline-color-control"><input type="color" value={colorPickerValue(settings.suffixColor)} onChange={(e)=>update("suffixColor",e.target.value)}/><input className="color-code-input" value={settings.suffixColor} onChange={(e)=>update("suffixColor",e.target.value)} placeholder="#FFFFFF"/></span></label></>}
                </AlertSettingSection>
                <AlertSettingSection
                  id="background"
                  title="알림 배경"
                  description="배경색·투명도·여백"
                  open={Boolean(openAlertSections.background)}
                  onToggle={() => toggleAlertSection("background")}
                >
                  <p className="alert-setting-help">
                    기본값은 배경 없음입니다. 방송 화면 위에 글자만 투명하게
                    표시됩니다.
                  </p>
                  <div className="background-control-row">
                    <label className="toggle-label">
                      알림 배경 사용
                      <input
                        type="checkbox"
                        checked={settings.backgroundEnabled}
                        onChange={(e) =>
                          update("backgroundEnabled", e.target.checked)
                        }
                      />
                      <i />
                    </label>
                    {settings.backgroundEnabled && (
                      <>
                        <label className="toggle-label">
                          배경색 사용
                          <input type="checkbox" checked={settings.backgroundColorEnabled !== false} onChange={(e)=>update("backgroundColorEnabled",e.target.checked)} />
                          <i />
                        </label>
                        {settings.backgroundColorEnabled !== false && (
                          <label className="background-color-control">
                            <span>배경색</span>
                            <input
                              aria-label="알림 배경색"
                              type="color"
                              value={colorPickerValue(settings.backgroundColor)}
                              onChange={(e) =>
                                update("backgroundColor", e.target.value)
                              }
                            />
                            <input className="color-code-input" value={settings.backgroundColor} onChange={(e)=>update("backgroundColor",e.target.value)} />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                  {settings.backgroundEnabled && (
                    <>
                      <label>배경 이미지<input type="file" accept="image/*" onChange={(event)=>{const file=event.target.files?.[0];if(!file)return;if(file.size>5*1024*1024){setSaved("배경 이미지는 5MB 이하만 사용할 수 있습니다.");return;}const reader=new FileReader();reader.onload=()=>setSettings(current=>({...current,backgroundImageData:String(reader.result),backgroundImageName:file.name,backgroundImageArea:"canvas"}));reader.readAsDataURL(file);}} />{settings.backgroundImageName&&<small>{settings.backgroundImageName} <button type="button" onClick={()=>setSettings(current=>({...current,backgroundImageData:"",backgroundImageName:""}))}>제거</button></small>}</label>
                      {settings.backgroundImageData && (
                        <>
                          <label>
                            사진 적용 영역
                            <select value={settings.backgroundImageArea || "alert"} onChange={(e)=>update("backgroundImageArea",e.target.value)}>
                              <option value="canvas">알림 화면 전체 (위·아래 빈 공간 포함)</option>
                              <option value="alert">문구 영역만</option>
                            </select>
                          </label>
                          <label>
                            이미지 맞춤
                            <select
                              value={settings.backgroundImageFit || "cover"}
                              onChange={(e) => update("backgroundImageFit", e.target.value)}
                            >
                              <option value="cover">영역 채우기 (일부 잘릴 수 있음)</option>
                              <option value="contain">사진 전체 보기 (여백 생길 수 있음)</option>
                            </select>
                          </label>
                          <label>
                            사진 크기
                            <input type="range" min="25" max="300" step="5" value={settings.backgroundImageScale ?? 100} onChange={(e)=>update("backgroundImageScale",Number(e.target.value))} />
                            <span>{settings.backgroundImageScale ?? 100}%</span>
                            <small>100%에서는 위의 맞춤 방식을 사용합니다. 값을 바꾸면 사진 너비를 기준으로 자유롭게 확대·축소합니다.</small>
                          </label>
                          <label>
                            가로 위치
                            <input type="range" min="0" max="100" value={settings.backgroundImagePositionX ?? 50} onChange={(e)=>update("backgroundImagePositionX",Number(e.target.value))} />
                            <span>{settings.backgroundImagePositionX ?? 50}%</span>
                          </label>
                          <label>
                            세로 위치
                            <input type="range" min="0" max="100" value={settings.backgroundImagePositionY ?? 50} onChange={(e)=>update("backgroundImagePositionY",Number(e.target.value))} />
                            <span>{settings.backgroundImagePositionY ?? 50}%</span>
                          </label>
                        </>
                      )}
                      <label>
                        배경 투명도
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step=".05"
                          value={settings.backgroundOpacity}
                          onChange={(e) =>
                            update("backgroundOpacity", Number(e.target.value))
                          }
                        />
                        <span>
                          {Math.round(settings.backgroundOpacity * 100)}%
                        </span>
                      </label>
                      <label>
                        안쪽 여백
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.backgroundPadding}
                          onChange={(e) =>
                            update("backgroundPadding", Number(e.target.value))
                          }
                        />
                        <span>{settings.backgroundPadding}px</span>
                      </label>
                      <label>
                        모서리 둥글기
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.backgroundRadius}
                          onChange={(e) =>
                            update("backgroundRadius", Number(e.target.value))
                          }
                        />
                        <span>{settings.backgroundRadius}px</span>
                      </label>
                    </>
                  )}
                </AlertSettingSection>
                <AlertSettingSection
                  id="effect"
                  title="표시 효과"
                  description="표시 시간·등장·퇴장 효과"
                  open={Boolean(openAlertSections.effect)}
                  onToggle={() => toggleAlertSection("effect")}
                >
                  <label>
                    표시 시간 (초)
                    <input
                      type="range"
                      min="1"
                      max="30"
                      step=".5"
                      value={settings.durationMs / 1000}
                      onChange={(e) =>
                        update("durationMs", Number(e.target.value) * 1000)
                      }
                    />
                    <span>{settings.durationMs / 1000}초</span>
                  </label>
                  <label>
                    등장 효과
                    <select
                      value={settings.animation}
                      onChange={(e) => update("animation", e.target.value)}
                    >
                      {ENTER_EFFECTS.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    퇴장 효과
                    <select
                      value={settings.exitAnimation}
                      onChange={(e) => update("exitAnimation", e.target.value)}
                    >
                      {EXIT_EFFECTS.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="sound"
                  title="효과음"
                  description="효과음·볼륨·내 음원"
                  open={Boolean(openAlertSections.sound)}
                  onToggle={() => toggleAlertSection("sound")}
                >
                  <p className="alert-setting-help">
                    기본 효과음을 고르거나 MP3·WAV·OGG 파일을 직접 추가할 수
                    있습니다.
                  </p>
                  <label className="toggle-label">
                    효과음 사용
                    <input
                      type="checkbox"
                      checked={settings.soundEnabled}
                      onChange={(e) => update("soundEnabled", e.target.checked)}
                    />
                    <i />
                  </label>
                  {settings.soundEnabled && (
                    <>
                      <label>
                        기본 효과음
                        <select
                          value={settings.soundPreset}
                          onChange={(e) =>
                            update("soundPreset", e.target.value)
                          }
                        >
                          {soundOptions(settings).map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        볼륨
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.soundVolume}
                          onChange={(e) =>
                            update("soundVolume", Number(e.target.value))
                          }
                        />
                        <span>{settings.soundVolume}%</span>
                      </label>
                      <label className="sound-upload">
                        내 음원 보관함에 추가
                        <input
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/ogg"
                          onChange={loadSound}
                        />
                        <small>
                          {(settings.soundLibrary || []).length}/10개 · 5MB 이하
                          MP3, WAV, OGG
                        </small>
                      </label>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          playAlertSound(
                            settings,
                            appearance.soundPreset,
                            appearance.soundVolume,
                            appearance.customSoundData,
                          )
                        }
                      >
                        효과음 미리 듣기
                      </button>
                      {(settings.soundLibrary || []).length > 0 && (
                        <div className="sound-library">
                          <div>
                            <b>내 음원 관리</b>
                            <small>
                              이 계정에서 기본 알림과 모든 금액 구간에 다시
                              사용할 수 있습니다.
                            </small>
                          </div>
                          {settings.soundLibrary.map((sound) => (
                            <article key={sound.id}>
                              <span title={sound.name}>{sound.name}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  playAlertSound(
                                    settings,
                                    `library:${sound.id}`,
                                    settings.soundVolume,
                                    sound.data,
                                  )
                                }
                              >
                                듣기
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => removeLibrarySound(sound.id)}
                              >
                                삭제
                              </button>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </AlertSettingSection>
                <AlertSettingSection
                  id="tts"
                  title="TTS 음성 알림"
                  description="알림 문구를 음성으로 읽기"
                  open={Boolean(openAlertSections.tts)}
                  onToggle={() => toggleAlertSection("tts")}
                >
                  <p className="alert-setting-help">
                    Typecast SSFM 3.0 전용으로 동작합니다. 선택한 보이스가
                    제공하는 실제 감정과 스타일만 표시합니다.
                  </p>
                  <label className="toggle-label">
                    TTS 사용
                    <input
                      type="checkbox"
                      checked={settings.ttsEnabled}
                      onChange={(e) => update("ttsEnabled", e.target.checked)}
                    />
                    <i />
                  </label>
                  {settings.ttsEnabled && (
                    <>
                      <div className="tts-provider-fixed">
                        <b>Typecast AI 음성</b>
                        <span>SSFM 3.0 · 한국어 · 스마트 감정</span>
                      </div>
                      {settings.ttsProvider === "elevenlabs" ? (
                        <>
                          {!elevenConfigured && (
                            <p className="form-message">
                              {elevenVoiceError ||
                                "서버에 ELEVENLABS_API_KEY를 설정하면 음성 목록이 표시됩니다."}
                            </p>
                          )}
                          <label>
                            ElevenLabs 목소리
                            <select
                              value={settings.ttsElevenVoiceId || ""}
                              disabled={!elevenConfigured}
                              onChange={(e) => {
                                const selected = elevenVoices.find(
                                  (voice) => voice.id === e.target.value,
                                );
                                setSettings((current) => ({
                                  ...current,
                                  ttsElevenVoiceId: e.target.value,
                                  ttsElevenVoiceName: selected?.name || "",
                                }));
                                setPreviewRun((current) => current + 1);
                              }}
                            >
                              <option value="">목소리를 선택해주세요</option>
                              {elevenVoices.map((voice) => (
                                <option value={voice.id} key={voice.id}>
                                  {voice.name}
                                  {voice.labels?.gender
                                    ? ` · ${voice.labels.gender}`
                                    : ""}
                                  {voice.category ? ` · ${voice.category}` : ""}
                                </option>
                              ))}
                            </select>
                            <small className="tts-voice-count">
                              ElevenLabs 계정에서 사용 가능한 음성 {elevenVoices.length}개
                            </small>
                          </label>
                          <label>
                            음성 모델
                            <select
                              value={settings.ttsModel || "eleven_flash_v2_5"}
                              onChange={(e) => update("ttsModel", e.target.value)}
                            >
                              <option value="eleven_flash_v2_5">
                                Flash v2.5 · 빠름·저렴함
                              </option>
                              <option value="eleven_multilingual_v2">
                                Multilingual v2 · 자연스러움
                              </option>
                            </select>
                          </label>
                        </>
                      ) : settings.ttsProvider === "typecast" ? (
                        <>
                          {!typecastConfigured && (
                            <p className="form-message">
                              {typecastVoiceError ||
                                "서버에 TYPECAST_API_KEY를 설정하면 음성 목록이 표시됩니다."}
                            </p>
                          )}
                          <div className="typecast-voice-filters">
                            <label>
                              보이스 검색
                              <input
                                value={typecastVoiceQuery}
                                onChange={(e) => setTypecastVoiceQuery(e.target.value)}
                                placeholder="이름·연령·용도 검색"
                              />
                            </label>
                            <label>
                              성별
                              <select
                                value={typecastGenderFilter}
                                onChange={(e) => setTypecastGenderFilter(e.target.value)}
                              >
                                <option value="">전체</option>
                                <option value="female">여성</option>
                                <option value="male">남성</option>
                              </select>
                            </label>
                          </div>
                          <div className="typecast-search-suggestions">
                            <span>추천 검색어</span>
                            {TYPECAST_SEARCH_PRESETS.map(([label, query]) => (
                              <button
                                type="button"
                                key={query}
                                className={typecastVoiceQuery === query ? "active" : ""}
                                onClick={() => setTypecastVoiceQuery(query)}
                              >
                                {label}
                              </button>
                            ))}
                            {typecastVoiceQuery && (
                              <button type="button" onClick={() => setTypecastVoiceQuery("")}>초기화</button>
                            )}
                          </div>
                          <label>
                            Typecast 목소리
                            <select
                              value={settings.ttsTypecastVoiceId || ""}
                              disabled={!typecastConfigured}
                              onChange={(e) => {
                                const selected = typecastVoices.find(
                                  (voice) => voice.id === e.target.value,
                                );
                                setSettings((current) => ({
                                  ...current,
                                  ttsTypecastVoiceId: e.target.value,
                                  ttsTypecastVoiceName: selected?.name || "",
                                  ttsTypecastEmotion: "smart",
                                }));
                                setPreviewRun((current) => current + 1);
                              }}
                            >
                              <option value="">목소리를 선택해주세요</option>
                              {filteredTypecastVoices.map((voice) => (
                                <option value={voice.id} key={voice.id}>
                                  {voice.name}
                                  {voice.gender ? ` · ${voice.gender}` : ""}
                                  {voice.age ? ` · ${voice.age}` : ""}
                                </option>
                              ))}
                            </select>
                            <small className="tts-voice-count">
                              검색 결과 {filteredTypecastVoices.length}개 / 전체 {typecastVoices.length}개
                            </small>
                          </label>
                          {selectedTypecastVoice && (
                            <div className="typecast-voice-detail">
                              <div>
                                <b>{selectedTypecastVoice.name}</b>
                                {selectedTypecastVoice.englishName && <span>{selectedTypecastVoice.englishName}</span>}
                              </div>
                              <small>
                                {[selectedTypecastVoice.gender, selectedTypecastVoice.age, ...(selectedTypecastVoice.useCases || [])]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                              {selectedTypecastVoice.previewUrl && (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => new Audio(selectedTypecastVoice.previewUrl).play()}
                                >
                                  Typecast 원본 샘플 듣기
                                </button>
                              )}
                            </div>
                          )}
                          <label>
                            감정 표현
                            <select
                              value={settings.ttsTypecastEmotion || "smart"}
                              onChange={(e) => update("ttsTypecastEmotion", e.target.value)}
                            >
                              <option value="smart">{TYPECAST_EMOTION_LABELS.smart}</option>
                              {(selectedTypecastVoice?.emotions || []).map((emotion) => (
                                <option value={emotion} key={emotion}>
                                  {TYPECAST_EMOTION_LABELS[emotion] || emotion}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : (
                      <label>
                        목소리
                        <select
                          value={settings.ttsVoiceURI || ""}
                          onChange={(e) =>
                            update("ttsVoiceURI", e.target.value)
                          }
                        >
                          <option value="">자동 선택 (한국어 우선)</option>
                          {voices.map((voice) => (
                            <option value={voice.voiceURI} key={voice.voiceURI}>
                              {voice.name} · {voice.lang}
                              {voice.localService ? " · 기기 내장" : ""}
                            </option>
                          ))}
                        </select>
                        <small className="tts-voice-count">
                          현재 브라우저에서 사용 가능한 전체 음성{" "}
                          {voices.length}개
                        </small>
                      </label>
                      )}
                      <label>
                        읽기 속도
                        <input
                          type="range"
                          min={settings.ttsProvider === "elevenlabs" ? "0.7" : "0.5"}
                          max={settings.ttsProvider === "elevenlabs" ? "1.2" : "2"}
                          step="0.1"
                          value={settings.ttsRate}
                          onChange={(e) =>
                            update("ttsRate", Number(e.target.value))
                          }
                        />
                        <span>{settings.ttsRate}×</span>
                      </label>
                      {settings.ttsProvider === "typecast" && <label>
                        목소리 높낮이 (반음)
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={settings.ttsPitch}
                          onChange={(e) =>
                            update("ttsPitch", Number(e.target.value))
                          }
                        />
                        <span>{settings.ttsPitch > 0 ? "+" : ""}{settings.ttsPitch}</span>
                      </label>}
                      <label>
                        TTS 볼륨
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.ttsVolume}
                          onChange={(e) =>
                            update("ttsVolume", Number(e.target.value))
                          }
                        />
                        <span>{settings.ttsVolume}%</span>
                      </label>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={
                          (settings.ttsProvider === "elevenlabs" &&
                            (!elevenConfigured || !settings.ttsElevenVoiceId)) ||
                          (settings.ttsProvider === "typecast" &&
                            (!typecastConfigured || !settings.ttsTypecastVoiceId))
                        }
                        onClick={async () => {
                          try {
                            const provider = await playAlertSpeech(
                              appearance,
                              preview,
                              { allowFallback: false },
                            );
                            setSaved(
                              provider === "elevenlabs"
                                ? "선택한 ElevenLabs 음성을 재생했습니다."
                                : provider === "typecast"
                                  ? "선택한 Typecast 음성을 재생했습니다."
                                  : "방송 PC 기본 음성을 재생했습니다.",
                            );
                          } catch (error) {
                            setSaved(error.message || "TTS 미리듣기에 실패했습니다.");
                          }
                        }}
                      >
                        TTS 미리 듣기
                      </button>
                    </>
                  )}
                </AlertSettingSection>
                <AlertSettingSection
                  id="tiers"
                  title="금액대별 설정"
                  description={`${(settings.amountTiers || []).length}개 구간 · 필요한 항목만 다르게 설정`}
                  open={Boolean(openAlertSections.tiers)}
                  onToggle={() => toggleAlertSection("tiers")}
                  action={
                    <button
                      type="button"
                      className="alert-section-action"
                      onClick={addTier}
                    >
                      + 구간 추가
                    </button>
                  }
                >
                  <div className="tier-guide">
                    <b>사용 방법</b>
                    <span>① 금액 범위를 정하고</span>
                    <span>
                      ② 바꾸고 싶은 항목만 ‘이 구간만 다르게’를 선택하세요.
                    </span>
                    <span>
                      ③ 나머지는 위의 기본 설정이 자동으로 적용됩니다.
                    </span>
                  </div>
                  <div className="amount-tiers">
                    {(settings.amountTiers || []).map((tier) => {
                      const customCount = [
                        "messageMode",
                        "textMode",
                        "effectMode",
                        "soundMode",
                        "ttsMode",
                      ].filter((key) => tier[key] === "custom").length;
                      const isOpen = Boolean(openTiers[tier.id]);
                      return (
                        <article
                          className={
                            tier.enabled === false ? "tier-disabled" : ""
                          }
                          key={tier.id}
                        >
                          <div className="tier-card-head">
                            <button
                              type="button"
                              className="tier-expand"
                              onClick={() => toggleTier(tier.id)}
                              aria-expanded={isOpen}
                            >
                              <div>
                                <b>{tier.name}</b>
                                <small>
                                  {formatWon(tier.minAmount || 0)}원 ~{" "}
                                  {tier.maxAmount == null
                                    ? "제한 없음"
                                    : `${formatWon(tier.maxAmount)}원`}
                                </small>
                              </div>
                            </button>
                            <div className="tier-summary">
                              <em className={customCount ? "custom" : ""}>
                                {customCount
                                  ? `${customCount}개 별도 설정`
                                  : "모두 기본 설정"}
                              </em>
                              <label className="mini-toggle">
                                <input
                                  type="checkbox"
                                  checked={tier.enabled !== false}
                                  onChange={(e) =>
                                    changeTier(
                                      tier.id,
                                      "enabled",
                                      e.target.checked,
                                    )
                                  }
                                />
                                <span>사용</span>
                              </label>
                              <button
                                className="collapse-control"
                                type="button"
                                onClick={() => toggleTier(tier.id)}
                                aria-expanded={isOpen}
                                aria-label={`${tier.name} ${isOpen ? "닫기" : "열기"}`}
                              >
                                <span>{isOpen ? "닫기" : "열기"}</span>
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path d="M4 6l4 4 4-4" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="inherit-chips">
                            <span
                              className={
                                tier.messageMode === "custom" ? "custom" : ""
                              }
                            >
                              문구 ·{" "}
                              {tier.messageMode === "custom" ? "별도" : "기본"}
                            </span>
                            <span
                              className={
                                tier.textMode === "custom" ? "custom" : ""
                              }
                            >
                              글자 ·{" "}
                              {tier.textMode === "custom" ? "별도" : "기본"}
                            </span>
                            <span
                              className={
                                tier.effectMode === "custom" ? "custom" : ""
                              }
                            >
                              효과 ·{" "}
                              {tier.effectMode === "custom" ? "별도" : "기본"}
                            </span>
                            <span
                              className={
                                tier.soundMode === "custom" ? "custom" : ""
                              }
                            >
                              효과음 ·{" "}
                              {tier.soundMode === "custom" ? "별도" : "기본"}
                            </span>
                            <span
                              className={
                                tier.ttsMode === "custom" ? "custom" : ""
                              }
                            >
                              TTS ·{" "}
                              {tier.ttsMode === "custom" ? "별도" : "기본"}
                            </span>
                          </div>
                          {isOpen && (
                            <div className="tier-detail">
                              <div className="tier-title">
                                <label>
                                  구간 이름
                                  <input
                                    value={tier.name}
                                    onChange={(e) =>
                                      changeTier(
                                        tier.id,
                                        "name",
                                        e.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeTier(tier.id)}
                                >
                                  {tier.draft ? "추가 취소" : "구간 삭제"}
                                </button>
                              </div>
                              <div className="tier-range">
                                <label>
                                  최소 금액
                                  <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    value={tier.minAmount}
                                    onChange={(e) =>
                                      changeTier(
                                        tier.id,
                                        "minAmount",
                                        Number(e.target.value),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  최대 금액
                                  <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    placeholder="제한 없음"
                                    value={tier.maxAmount ?? ""}
                                    onChange={(e) =>
                                      changeTier(
                                        tier.id,
                                        "maxAmount",
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                      )
                                    }
                                  />
                                </label>
                              </div>
                              <TierMode
                                title="알림 문구"
                                description="후원자명과 금액이 들어가는 문장"
                                mode={tier.messageMode}
                                onChange={(value) =>
                                  changeTier(tier.id, "messageMode", value)
                                }
                              >
                                {tier.messageMode === "custom" && (
                                  <div className="tier-message-editor">
                                    <div className="tier-message-token-guide">
                                      <span><code>{"{name}"}</code> 후원자명</span>
                                      <span><code>{"{amount}"}</code> 금액</span>
                                      <span><code>{"{grade}"}</code> 크루 등급</span>
                                      <span><code>{"{message}"}</code> 후원 메시지</span>
                                    </div>
                                    <div className="tier-message-token-buttons">
                                      <span>빠른 삽입</span>
                                      {["{name}", "{amount}", "{grade}", "{message}"].map((token) => (
                                        <button
                                          type="button"
                                          key={token}
                                          onClick={() => {
                                            const current = tier.messageTemplate || "";
                                            changeTier(tier.id, "messageTemplate", `${current}${current && !/\s$/.test(current) ? " " : ""}${token}`);
                                          }}
                                        >
                                          {token}
                                        </button>
                                      ))}
                                    </div>
                                    <label>
                                      이 구간 전용 문구
                                      <textarea
                                        value={tier.messageTemplate || ""}
                                        placeholder={settings.messageTemplate}
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "messageTemplate",
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </label>
                                    <div className="tier-message-example">
                                      <small>표시 예시</small>
                                      <p>{(tier.messageTemplate || settings.messageTemplate)
                                        .replaceAll("{name}", "폴조지")
                                        .replaceAll("{amount}", formatWon(tier.minAmount || 50000))
                                        .replaceAll("{grade}", "[크루 등급]")
                                        .replaceAll("{message}", "응원합니다!")}</p>
                                    </div>
                                    <small className="tier-message-note">
                                      {"{grade}"}는 화면의 등급 이미지·텍스트 위치에만 사용되며 TTS에서는 읽지 않습니다.
                                    </small>
                                  </div>
                                )}
                              </TierMode>
                              <TierMode
                                title="글자 설정"
                                description="글꼴·크기·굵기·색상·테두리"
                                mode={tier.textMode}
                                onChange={(value) =>
                                  changeTier(tier.id, "textMode", value)
                                }
                              >
                                {tier.textMode === "custom" && (
                                  <div className="tier-custom-grid">
                                    <label>
                                      글꼴
                                      <select
                                        value={
                                          tier.fontFamily || settings.fontFamily
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "fontFamily",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {FONT_OPTIONS.map(([value, label]) => (
                                          <option value={value} key={label}>
                                            {label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      크기
                                      <input
                                        type="number"
                                        min="20"
                                        max="160"
                                        value={
                                          tier.fontSize || settings.fontSize
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "fontSize",
                                            Number(e.target.value),
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      굵기
                                      <select
                                        value={
                                          tier.fontWeight || settings.fontWeight
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "fontWeight",
                                            Number(e.target.value),
                                          )
                                        }
                                      >
                                        {[
                                          100, 200, 300, 400, 500, 600, 700,
                                          800, 900,
                                        ].map((value) => (
                                          <option key={value}>{value}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      글자색
                                      <span className="inline-color-control">
                                        <input type="color" value={colorPickerValue(tier.textColor || settings.textColor)} onChange={(e) => changeTier(tier.id, "textColor", e.target.value)} />
                                        <input className="color-code-input" value={tier.textColor || settings.textColor} onChange={(e) => changeTier(tier.id, "textColor", e.target.value)} aria-label="구간 글자색 HEX 코드" />
                                      </span>
                                    </label>
                                    <label>
                                      테두리색
                                      <span className="inline-color-control">
                                        <input type="color" value={colorPickerValue(tier.outlineColor || settings.outlineColor)} onChange={(e) => changeTier(tier.id, "outlineColor", e.target.value)} />
                                        <input className="color-code-input" value={tier.outlineColor || settings.outlineColor} onChange={(e) => changeTier(tier.id, "outlineColor", e.target.value)} aria-label="구간 테두리색 HEX 코드" />
                                      </span>
                                    </label>
                                    <label>
                                      테두리 굵기
                                      <input
                                        type="number"
                                        min="0"
                                        max="12"
                                        step=".5"
                                        value={
                                          tier.outlineWidth ??
                                          settings.outlineWidth
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "outlineWidth",
                                            Number(e.target.value),
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                )}
                              </TierMode>
                              <TierMode
                                title="표시 효과"
                                description="등장·퇴장 효과와 표시 시간"
                                mode={tier.effectMode}
                                onChange={(value) =>
                                  changeTier(tier.id, "effectMode", value)
                                }
                              >
                                {tier.effectMode === "custom" && (
                                  <div className="tier-custom-grid">
                                    <label>
                                      등장 효과
                                      <select
                                        value={
                                          tier.animation || settings.animation
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "animation",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {ENTER_EFFECTS.map(([value, label]) => (
                                          <option value={value} key={value}>
                                            {label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      퇴장 효과
                                      <select
                                        value={
                                          tier.exitAnimation ||
                                          settings.exitAnimation
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "exitAnimation",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {EXIT_EFFECTS.map(([value, label]) => (
                                          <option value={value} key={value}>
                                            {label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      표시 시간
                                      <input
                                        type="number"
                                        min="1"
                                        max="30"
                                        step=".5"
                                        value={
                                          (tier.durationMs ||
                                            settings.durationMs) / 1000
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "durationMs",
                                            Number(e.target.value) * 1000,
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                )}
                              </TierMode>
                              <TierMode
                                title="효과음"
                                description="기본 효과음이나 내 음원 보관함에서 선택"
                                mode={tier.soundMode}
                                onChange={(value) =>
                                  changeTier(tier.id, "soundMode", value)
                                }
                              >
                                {tier.soundMode === "custom" && (
                                  <div className="tier-custom-grid tier-sound-grid">
                                    <label>
                                      효과음
                                      <select
                                        value={
                                          tier.soundPreset ||
                                          settings.soundPreset
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "soundPreset",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {soundOptions(settings).map(
                                          ([value, label]) => (
                                            <option value={value} key={value}>
                                              {label}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </label>
                                    <label>
                                      볼륨
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={
                                          tier.soundVolume ??
                                          settings.soundVolume
                                        }
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "soundVolume",
                                            Number(e.target.value),
                                          )
                                        }
                                      />
                                      <span>
                                        {tier.soundVolume ??
                                          settings.soundVolume}
                                        %
                                      </span>
                                    </label>
                                    <label className="sound-upload">
                                      새 음원 추가
                                      <input
                                        type="file"
                                        accept="audio/mpeg,audio/wav,audio/ogg"
                                        onChange={(e) =>
                                          loadTierSound(tier.id, e)
                                        }
                                      />
                                      <small>
                                        추가하면 내 음원 목록에 저장됩니다.
                                      </small>
                                    </label>
                                    <button
                                      type="button"
                                      className="secondary-button tier-preview-button"
                                      onClick={() =>
                                        playAlertSound(
                                          settings,
                                          tier.soundPreset,
                                          tier.soundVolume,
                                          soundData(
                                            settings,
                                            tier.soundPreset,
                                            tier.customSoundData,
                                          ),
                                        )
                                      }
                                    >
                                          효과음 듣기
                                    </button>
                                  </div>
                                )}
                              </TierMode>
                              <TierMode
                                title="TTS 음성"
                                description="이 금액 구간의 음성 알림"
                                mode={tier.ttsMode}
                                onChange={(value) =>
                                  changeTier(tier.id, "ttsMode", value)
                                }
                              >
                                {tier.ttsMode === "custom" && (
                                  <div className="tier-custom-grid">
                                    <label className="toggle-label">
                                      이 구간 TTS 사용
                                      <input
                                        type="checkbox"
                                        checked={tier.ttsEnabled !== false}
                                        onChange={(e) =>
                                          changeTier(
                                            tier.id,
                                            "ttsEnabled",
                                            e.target.checked,
                                          )
                                        }
                                      />
                                      <i />
                                    </label>
                                    {tier.ttsEnabled !== false && (
                                      <>
                                        <div className="tts-provider-fixed">
                                          <b>Typecast AI 음성</b>
                                          <span>이 구간 전용 보이스 설정</span>
                                        </div>
                                        {tier.ttsProvider === "elevenlabs" ? (
                                          <label>
                                            ElevenLabs 목소리
                                            <select
                                              value={tier.ttsElevenVoiceId || ""}
                                              disabled={!elevenConfigured}
                                              onChange={(e) => {
                                                changeTier(
                                                  tier.id,
                                                  "ttsElevenVoiceId",
                                                  e.target.value,
                                                );
                                              }}
                                            >
                                              <option value="">목소리를 선택해주세요</option>
                                              {elevenVoices.map((voice) => (
                                                <option value={voice.id} key={voice.id}>
                                                  {voice.name}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                        ) : tier.ttsProvider === "typecast" ? (
                                          <>
                                            <label>
                                              Typecast 목소리
                                              <select
                                                value={tier.ttsTypecastVoiceId || ""}
                                                disabled={!typecastConfigured}
                                                onChange={(e) => {
                                                  const selected = typecastVoices.find(
                                                    (voice) => voice.id === e.target.value,
                                                  );
                                                  changeTier(tier.id, "ttsTypecastVoiceId", e.target.value);
                                                  changeTier(tier.id, "ttsTypecastVoiceName", selected?.name || "");
                                                  changeTier(tier.id, "ttsTypecastEmotion", "smart");
                                                }}
                                              >
                                                <option value="">목소리를 선택해주세요</option>
                                                {typecastVoices.map((voice) => (
                                                  <option value={voice.id} key={voice.id}>
                                                    {voice.name}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <label>
                                              감정 표현
                                              <select
                                                value={tier.ttsTypecastEmotion || "smart"}
                                                onChange={(e) =>
                                                  changeTier(tier.id, "ttsTypecastEmotion", e.target.value)
                                                }
                                              >
                                                <option value="smart">스마트 감정</option>
                                                <option value="normal">보통</option>
                                                <option value="happy">기쁨</option>
                                                <option value="sad">슬픔</option>
                                                <option value="angry">화남</option>
                                                <option value="whisper">속삭임</option>
                                                <option value="toneup">밝은 톤</option>
                                                <option value="tonedown">차분한 톤</option>
                                              </select>
                                            </label>
                                          </>
                                        ) : (
                                        <label>
                                          목소리
                                          <select
                                            value={tier.ttsVoiceURI || ""}
                                            onChange={(e) =>
                                              changeTier(
                                                tier.id,
                                                "ttsVoiceURI",
                                                e.target.value,
                                              )
                                            }
                                          >
                                            <option value="">자동 선택</option>
                                            {voices.map((voice) => (
                                              <option
                                                value={voice.voiceURI}
                                                key={voice.voiceURI}
                                              >
                                                {voice.name} · {voice.lang}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        )}
                                        <label>
                                          속도
                                          <input
                                            type="range"
                                            min="0.5"
                                            max="2"
                                            step="0.1"
                                            value={
                                              tier.ttsRate ?? settings.ttsRate
                                            }
                                            onChange={(e) =>
                                              changeTier(
                                                tier.id,
                                                "ttsRate",
                                                Number(e.target.value),
                                              )
                                            }
                                          />
                                          <span>
                                            {tier.ttsRate ?? settings.ttsRate}×
                                          </span>
                                        </label>
                                        <label>
                                          높낮이 (반음)
                                          <input
                                            type="range"
                                            min="-12"
                                            max="12"
                                            step="1"
                                            value={
                                              tier.ttsPitch ?? settings.ttsPitch
                                            }
                                            onChange={(e) =>
                                              changeTier(
                                                tier.id,
                                                "ttsPitch",
                                                Number(e.target.value),
                                              )
                                            }
                                          />
                                          <span>
                                            {(tier.ttsPitch ?? settings.ttsPitch) > 0 ? "+" : ""}
                                            {tier.ttsPitch ?? settings.ttsPitch}
                                          </span>
                                        </label>
                                        <label>
                                          볼륨
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={
                                              tier.ttsVolume ??
                                              settings.ttsVolume
                                            }
                                            onChange={(e) =>
                                              changeTier(
                                                tier.id,
                                                "ttsVolume",
                                                Number(e.target.value),
                                              )
                                            }
                                          />
                                          <span>
                                            {tier.ttsVolume ??
                                              settings.ttsVolume}
                                            %
                                          </span>
                                        </label>
                                        <button
                                          type="button"
                                          className="secondary-button tier-preview-button"
                                          onClick={() =>
                                            playAlertSpeech(
                                              alertAppearance(
                                                {
                                                  ...settings,
                                                  amountTiers: [tier],
                                                },
                                                tier.minAmount || 50000,
                                              ),
                                              (tier.messageMode === "custom"
                                                ? tier.messageTemplate
                                                : settings.messageTemplate
                                              )
                                                .replaceAll("{name}", "폴조지")
                                                .replaceAll(
                                                  "{amount}",
                                                  formatWon(
                                                    tier.minAmount || 50000,
                                                  ),
                                                ),
                                            )
                                          }
                                        >
                                          TTS 듣기
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </TierMode>
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {!(settings.amountTiers || []).length && (
                      <p className="tier-empty">
                        아직 금액 구간이 없습니다. ‘구간 추가’를 누르면 기본
                        설정을 그대로 물려받은 구간이 만들어집니다.
                      </p>
                    )}
                  </div>
                </AlertSettingSection>
              </>
            ) : (
              <>
                <AlertSettingSection
                  id="ranking-display"
                  title="표시할 후원"
                  description="순위표에 집계할 최소 금액"
                  open={Boolean(openAlertSections["ranking-display"])}
                  onToggle={() => toggleAlertSection("ranking-display")}
                >
                  <label>
                    최소 기록 금액 (원)
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={settings.minimumDonationAmount}
                      onChange={(e) =>
                        update(
                          "minimumDonationAmount",
                          Math.max(0, Number(e.target.value)),
                        )
                      }
                    />
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="ranking-theme"
                  title="디자인 테마"
                  description="순위표 테마·배경 스타일"
                  open={Boolean(openAlertSections["ranking-theme"])}
                  onToggle={() => toggleAlertSection("ranking-theme")}
                >
                  <p className="alert-setting-help">
                    테마를 고르면 글꼴·간격·색상·상위 순위 강조까지 함께
                    적용됩니다. 적용 후 각 항목을 자유롭게 수정할 수 있습니다.
                  </p>
                  <div className="ranking-theme-picker">
                    {RANKING_THEMES.map(([value, label, marker]) => (
                      <button
                        type="button"
                        key={value}
                        className={`theme-swatch swatch-${value} ${settings.rankingTheme === value ? "active" : ""}`}
                        onClick={() => {
                          const preset = RANKING_THEME_PRESETS[value] || {};
                          setSettings((current) => ({
                            ...current,
                            ...preset,
                            rankingTheme: value,
                            rankingShowRank: true,
                            rankingRankHighlightEnabled: true,
                          }));
                          setPreviewRun((current) => current + 1);
                        }}
                      >
                        <i>
                          <small>{marker}</small>
                        </i>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <label className="toggle-label ranking-background-toggle">
                    순위표 배경 사용
                    <input
                      type="checkbox"
                      checked={settings.rankingBackgroundEnabled}
                      onChange={(e) =>
                        update("rankingBackgroundEnabled", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                  {settings.rankingTheme === "custom" && (
                    <div className="custom-theme-editor">
                      <label>
                        전체 배경색
                        <input
                          type="color"
                          value={colorPickerValue(settings.rankingCustomBackground)}
                          onChange={(e) =>
                            update("rankingCustomBackground", e.target.value)
                          }
                        />
                        <input className="color-code-input" value={settings.rankingCustomBackground} onChange={(e)=>update("rankingCustomBackground",e.target.value)}/>
                      </label>
                      <div className="custom-color-setting">
                        <span className="setting-label-row">
                          테두리색
                          <span className="inline-setting-check">
                            <input type="checkbox" checked={settings.rankingCustomBorderEnabled !== false} onChange={(e)=>update("rankingCustomBorderEnabled",e.target.checked)}/>
                            사용
                          </span>
                        </span>
                        <input
                          type="color"
                          value={colorPickerValue(settings.rankingCustomBorder)}
                          disabled={settings.rankingCustomBorderEnabled === false}
                          onChange={(e) =>
                            update("rankingCustomBorder", e.target.value)
                          }
                        />
                        <input className="color-code-input" disabled={settings.rankingCustomBorderEnabled === false} value={settings.rankingCustomBorder} onChange={(e)=>update("rankingCustomBorder",e.target.value)}/>
                      </div>
                      <div className="custom-color-setting">
                        <span className="setting-label-row">
                          행 배경색
                          <span className="inline-setting-check">
                            <input type="checkbox" checked={settings.rankingCustomRowBackgroundEnabled !== false} onChange={(e)=>update("rankingCustomRowBackgroundEnabled",e.target.checked)}/>
                            사용
                          </span>
                        </span>
                        <input
                          type="color"
                          value={colorPickerValue(settings.rankingCustomRowBackground)}
                          disabled={settings.rankingCustomRowBackgroundEnabled === false}
                          onChange={(e) =>
                            update("rankingCustomRowBackground", e.target.value)
                          }
                        />
                        <input className="color-code-input" disabled={settings.rankingCustomRowBackgroundEnabled === false} value={settings.rankingCustomRowBackground} onChange={(e)=>update("rankingCustomRowBackground",e.target.value)}/>
                      </div>
                      <label>
                        모서리 둥글기
                        <input
                          type="range"
                          min="0"
                          max="60"
                          value={settings.rankingCustomRadius}
                          onChange={(e) =>
                            update(
                              "rankingCustomRadius",
                              Number(e.target.value),
                            )
                          }
                        />
                        <span>{settings.rankingCustomRadius}px</span>
                      </label>
                      <label>
                        순위 표시 모양
                        <select
                          value={settings.rankingCustomMarker}
                          onChange={(e) =>
                            update("rankingCustomMarker", e.target.value)
                          }
                        >
                          <option value="circle">원형</option>
                          <option value="square">사각형</option>
                          <option value="pill">긴 배지</option>
                          <option value="plain">배경 없는 숫자</option>
                        </select>
                      </label>
                    </div>
                  )}
                </AlertSettingSection>
                <AlertSettingSection
                  id="ranking-title"
                  title="순위표 제목"
                  description="제목 문구·크기·정렬·색상"
                  open={Boolean(openAlertSections["ranking-title"])}
                  onToggle={() => toggleAlertSection("ranking-title")}
                >
                  <label className="toggle-label">
                    제목 표시
                    <input
                      type="checkbox"
                      checked={settings.rankingShowTitle}
                      onChange={(e) =>
                        update("rankingShowTitle", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                  {settings.rankingShowTitle && (
                    <>
                      <label>
                        제목 문구
                        <input
                          value={settings.rankingTitle}
                          onChange={(e) =>
                            update("rankingTitle", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        제목 크기
                        <input
                          type="range"
                          min="14"
                          max="72"
                          value={settings.rankingTitleSize}
                          onChange={(e) =>
                            update("rankingTitleSize", Number(e.target.value))
                          }
                        />
                        <span>{settings.rankingTitleSize}px</span>
                      </label>
                      <label>
                        제목 정렬
                        <select
                          value={settings.rankingTitleAlign}
                          onChange={(e) =>
                            update("rankingTitleAlign", e.target.value)
                          }
                        >
                          <option value="left">왼쪽</option>
                          <option value="center">가운데</option>
                          <option value="right">오른쪽</option>
                        </select>
                      </label>
                      <label>
                        제목 기준 열
                        <select value={settings.rankingTitleColumn || "first"} onChange={(e)=>update("rankingTitleColumn",e.target.value)}>
                          <option value="first">1위가 포함된 열</option>
                          <option value="last">가장 오른쪽 열</option>
                        </select>
                      </label>
                      <label className="ranking-inline-color-setting">
                        제목 색상
                        <span className="inline-color-control">
                          <input
                            type="color"
                            value={colorPickerValue(settings.rankingTitleColor)}
                            onChange={(e) =>
                              update("rankingTitleColor", e.target.value)
                            }
                          />
                          <input className="color-code-input" value={settings.rankingTitleColor} onChange={(e)=>update("rankingTitleColor",e.target.value)}/>
                        </span>
                      </label>
                    </>
                  )}
                </AlertSettingSection>
                <AlertSettingSection
                  id="ranking-text"
                  title="글자와 간격"
                  description="글자 크기·색상·행과 열 간격"
                  open={Boolean(openAlertSections["ranking-text"])}
                  onToggle={() => toggleAlertSection("ranking-text")}
                >
                  <label>
                    글꼴
                    <select
                      value={settings.rankingFontFamily}
                      onChange={(e) =>
                        update("rankingFontFamily", e.target.value)
                      }
                    >
                      {FONT_OPTIONS.map(([value, label]) => (
                        <option value={value} key={label}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    글자 크기
                    <input
                      type="range"
                      min="16"
                      max="72"
                      value={settings.rankingFontSize}
                      onChange={(e) =>
                        update("rankingFontSize", Number(e.target.value))
                      }
                    />
                    <span>{settings.rankingFontSize}px</span>
                  </label>
                  <label>
                    글자 굵기
                    <select
                      value={settings.rankingFontWeight}
                      onChange={(e) =>
                        update("rankingFontWeight", Number(e.target.value))
                      }
                    >
                      {[400, 500, 600, 700, 800, 900].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="toggle-label">
                    줄 높이 직접 설정
                    <input
                      type="checkbox"
                      checked={settings.rankingUseLineHeight}
                      onChange={(e) =>
                        update("rankingUseLineHeight", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                  {settings.rankingUseLineHeight && (
                    <label>
                      줄 높이
                      <input
                        type="range"
                        min=".8"
                        max="2"
                        step=".05"
                        value={settings.rankingLineHeight}
                        onChange={(e) =>
                          update("rankingLineHeight", Number(e.target.value))
                        }
                      />
                      <span>{settings.rankingLineHeight}</span>
                    </label>
                  )}
                  <label>
                    자간
                    <input
                      type="range"
                      min="-5"
                      max="20"
                      step=".5"
                      value={settings.rankingLetterSpacing}
                      onChange={(e) =>
                        update("rankingLetterSpacing", Number(e.target.value))
                      }
                    />
                    <span>{settings.rankingLetterSpacing}px</span>
                  </label>
                  <label>
                    행 간격
                    <input
                      type="range"
                      min="0"
                      max="40"
                      value={settings.rankingRowGap}
                      onChange={(e) =>
                        update("rankingRowGap", Number(e.target.value))
                      }
                    />
                    <span>{settings.rankingRowGap}px</span>
                  </label>
                  <label>
                    열 간격
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={settings.rankingColumnGap}
                      onChange={(e) =>
                        update("rankingColumnGap", Number(e.target.value))
                      }
                    />
                    <span>{settings.rankingColumnGap}px</span>
                  </label>
                  <label className="ranking-suffix-setting">
                    닉네임 뒤 문구
                    <span className="ranking-suffix-control">
                      <input
                        className="ranking-suffix-text"
                        placeholder="예: 님, 씨"
                        value={settings.rankingNameSuffix}
                        onChange={(e) => update("rankingNameSuffix", e.target.value)}
                      />
                      <input
                        type="color"
                        aria-label="닉네임 뒤 문구 색상"
                        value={colorPickerValue(settings.rankingNameSuffixColor || settings.rankingNameColor)}
                        onChange={(e) => update("rankingNameSuffixColor", e.target.value)}
                      />
                      <input className="color-code-input" value={settings.rankingNameSuffixColor || settings.rankingNameColor} maxLength="7" aria-label="닉네임 뒤 문구 색상 HEX 코드" onChange={(e)=>update("rankingNameSuffixColor",e.target.value)}/>
                    </span>
                  </label>
                  <label className="ranking-suffix-setting">
                    금액 뒤 문구
                    <span className="ranking-suffix-control">
                      <input
                        className="ranking-suffix-text"
                        placeholder="예: 원, 달러"
                        value={settings.rankingAmountSuffix}
                        onChange={(e) => update("rankingAmountSuffix", e.target.value)}
                      />
                      <input
                        type="color"
                        aria-label="금액 뒤 문구 색상"
                        value={colorPickerValue(settings.rankingAmountSuffixColor || settings.rankingAmountColor)}
                        onChange={(e) => update("rankingAmountSuffixColor", e.target.value)}
                      />
                      <input className="color-code-input" value={settings.rankingAmountSuffixColor || settings.rankingAmountColor} maxLength="7" aria-label="금액 뒤 문구 색상 HEX 코드" onChange={(e)=>update("rankingAmountSuffixColor",e.target.value)}/>
                    </span>
                  </label>
                  <label className="ranking-inline-color-setting">
                    닉네임 색상
                    <span className="inline-color-control">
                      <input
                        type="color"
                        value={colorPickerValue(settings.rankingNameColor)}
                        onChange={(e) =>
                          update("rankingNameColor", e.target.value)
                        }
                      />
                      <input className="color-code-input" value={settings.rankingNameColor} onChange={(e)=>update("rankingNameColor",e.target.value)}/>
                    </span>
                  </label>
                  <label className="ranking-inline-color-setting">
                    금액 색상
                    <span className="inline-color-control">
                      <input
                        type="color"
                        value={colorPickerValue(settings.rankingAmountColor)}
                        onChange={(e) =>
                          update("rankingAmountColor", e.target.value)
                        }
                      />
                      <input className="color-code-input" value={settings.rankingAmountColor} onChange={(e)=>update("rankingAmountColor",e.target.value)}/>
                    </span>
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="ranking-layout"
                  title="목록 배치"
                  description="정렬·열 수·표시 효과"
                  open={Boolean(openAlertSections["ranking-layout"])}
                  onToggle={() => toggleAlertSection("ranking-layout")}
                >
                  <label>
                    한 행 전체 정렬
                    <select
                      value={settings.rankingRowAlign}
                      onChange={(e) =>
                        update("rankingRowAlign", e.target.value)
                      }
                    >
                      <option value="spread">닉네임·금액 양쪽 배치</option>
                      <option value="left">한 묶음 왼쪽</option>
                      <option value="center">한 묶음 가운데</option>
                      <option value="right">한 묶음 오른쪽</option>
                    </select>
                  </label>
                  <label>
                    열 수 (1~5)
                    <input
                      type="number"
                      min="1"
                      max="5"
                      value={settings.rankingColumns}
                      onChange={(e) =>
                        update("rankingColumns", Math.max(1, Math.min(5, Number(e.target.value))))
                      }
                    />
                  </label>
                  <label>
                    한 열의 인원 (1~20)
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={settings.rankingRowsPerColumn}
                      onChange={(e) =>
                        update("rankingRowsPerColumn", Math.max(1, Math.min(20, Number(e.target.value))))
                      }
                    />
                  </label>
                  <label>
                    등장 효과
                    <select
                      value={settings.rankingAnimation}
                      onChange={(e) =>
                        update("rankingAnimation", e.target.value)
                      }
                    >
                      <option value="none">효과 없음</option>
                      <option value="fade">부드럽게</option>
                      <option value="slide-up">아래에서</option>
                      <option value="slide-left">오른쪽에서</option>
                      <option value="zoom">확대</option>
                      <option value="stagger">순서대로</option>
                    </select>
                  </label>
                  <label className="toggle-label">
                    순위 번호 표시
                    <input
                      type="checkbox"
                      checked={settings.rankingShowRank}
                      onChange={(e) =>
                        update("rankingShowRank", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                  {settings.rankingShowRank && (
                    <label>
                      순위 번호 표시 범위
                      <select
                        value={Number(settings.rankingLimit) === 1 ? 1 : 3}
                        onChange={(e) =>
                          update("rankingLimit", Number(e.target.value))
                        }
                      >
                        <option value="1">1위까지만</option>
                        <option value="3">3위까지</option>
                      </select>
                    </label>
                  )}
                  <label className="toggle-label">
                    후원 횟수 표시
                    <input
                      type="checkbox"
                      checked={settings.rankingShowCount}
                      onChange={(e) =>
                        update("rankingShowCount", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                </AlertSettingSection>
                <AlertSettingSection
                  id="ranking-highlight"
                  title="상위 순위 강조"
                  description="순위별 색상·크기·굵기"
                  open={Boolean(openAlertSections["ranking-highlight"])}
                  onToggle={() => toggleAlertSection("ranking-highlight")}
                >
                  <label className="toggle-label">
                    순위별 강조 사용
                    <input
                      type="checkbox"
                      checked={settings.rankingRankHighlightEnabled !== false}
                      onChange={(e) =>
                        update("rankingRankHighlightEnabled", e.target.checked)
                      }
                    />
                    <i />
                  </label>
                  {settings.rankingRankHighlightEnabled !== false && (
                    <div className="rank-style-editor">
                      <p className="rank-style-help">전체 글자 크기와 같은 px 단위입니다. 1~3위만 개별 강조되며 4위 이하는 선택한 테마 설정을 따라갑니다.</p>
                      {["1위", "2위", "3위"].map((label, index) => {
                        const rankStyle = (settings.rankingRankStyles ||
                          DEFAULT_SETTINGS.rankingRankStyles)[index];
                        const rankSizePx = Math.round(
                          settings.rankingFontSize * (rankStyle.size / 100),
                        );
                        return (
                          <article key={label}>
                            <b>{label}</b>
                            <label>
                              순위색
                              <span className="rank-color-control">
                                <input type="color" value={colorPickerValue(rankStyle.badge)} onChange={(e) => changeRankStyle(index, "badge", e.target.value)} />
                                <input className="color-code-input" value={rankStyle.badge} maxLength="7" aria-label={`${label} 순위색 HEX 코드`} onChange={(e) => changeRankStyle(index, "badge", e.target.value)} />
                              </span>
                            </label>
                            <label>
                              닉네임색
                              <span className="rank-color-control">
                                <input type="color" value={colorPickerValue(rankStyle.color)} onChange={(e) => changeRankStyle(index, "color", e.target.value)} />
                                <input className="color-code-input" value={rankStyle.color} maxLength="7" aria-label={`${label} 닉네임색 HEX 코드`} onChange={(e) => changeRankStyle(index, "color", e.target.value)} />
                              </span>
                            </label>
                            <label>
                              금액색
                              <span className="rank-color-control">
                                <input type="color" value={colorPickerValue(rankStyle.amountColor || settings.rankingAmountColor)} onChange={(e) => changeRankStyle(index, "amountColor", e.target.value)} />
                                <input className="color-code-input" value={rankStyle.amountColor || settings.rankingAmountColor} maxLength="7" aria-label={`${label} 금액색 HEX 코드`} onChange={(e) => changeRankStyle(index, "amountColor", e.target.value)} />
                              </span>
                            </label>
                            <label>
                              크기 (px)
                              <input
                                type="number"
                                min="12"
                                max="96"
                                step="1"
                                value={rankSizePx}
                                onChange={(e) =>
                                  changeRankStyle(
                                    index,
                                    "size",
                                    Math.round(
                                      (Number(e.target.value) /
                                        settings.rankingFontSize) * 100,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </AlertSettingSection>
              </>
            )}
          </form>
          <aside className="settings-side">
            <section
              className={`panel preview alert-preview ${isAlert ? "" : "ranking-settings-preview"}`}
            >
              <div className="preview-heading">
                <div>
                  <span>
                    예시 미리보기 · {isAlert ? "후원 알림" : "후원 순위표"}
                  </span>
                  <small>
                    {isAlert
                      ? "실제 출력과 동일한 16:9 · 1920 × 1080 기준"
                      : "설정을 바꾸면 순위표에 바로 반영됩니다."}
                  </small>
                </div>
                {isAlert && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewRun((value) => value + 1);
                      playAlertSound(
                        settings,
                        appearance.soundPreset,
                        appearance.soundVolume,
                        appearance.customSoundData,
                      );
                      playAlertSpeech(appearance, preview);
                    }}
                  >
                    다시 재생
                  </button>
                )}
                {!isAlert && (
                  <div className="ranking-preview-count" aria-label="미리보기 후원자 수">
                    {[20, 40, 60, 80, 100].map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={rankingPreviewCount === count ? "active" : ""}
                        aria-pressed={rankingPreviewCount === count}
                        onClick={() => setRankingPreviewCount(count)}
                      >
                        {count}명
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isAlert ? (
                <AlertPreviewFrame
                  key={previewRun}
                  appearance={appearance}
                  donorName="폴조지"
                  amountText="50,000"
                />
              ) : (
                <RankingPreview key={previewRun} settings={settings} count={rankingPreviewCount} />
              )}
              <div className="widget-links">
                <button type="button" onClick={openWidgetPreview}>
                  전체 화면으로 확인
                </button>
              </div>
            </section>
            <section className="panel settings-actions-card">
              <div className="settings-action-bar">
                <button
                  type="button"
                  className="settings-restore"
                  disabled={!isDirty}
                  onClick={restoreSettings}
                >
                  저장된 설정으로 되돌리기
                </button>
                <button
                  type="submit"
                  form="broadcast-settings-form"
                  className="settings-save"
                  disabled={!isDirty || settingsSaving}
                >
                  {settingsSaving?"저장 중...":isAlert ? "알림 설정 저장" : "순위표 설정 저장"}
                </button>
              </div>
              {saved && <p className="settings-save-message">{saved}</p>}
            </section>
          </aside>
        </main>
        {leaveRequest && (
          <div className="dialog-backdrop settings-leave-backdrop">
            <section
              className="settings-leave-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-leave-title"
            >
              <span className="settings-leave-icon">!</span>
              <h2 id="settings-leave-title">
                변경한 설정이 저장되지 않았습니다
              </h2>
              <p>
                저장하고 이동할까요? 저장하지 않고 이동하면 이번 변경사항은
                사라집니다.
              </p>
              <div>
                <button
                  type="button"
                  className="leave-cancel"
                  onClick={() => finishLeave(false)}
                >
                  계속 편집
                </button>
                <button
                  type="button"
                  className="leave-discard"
                  onClick={() => finishLeave(true)}
                >
                  저장하지 않고 이동
                </button>
                <button
                  type="button"
                  className="leave-save"
                  onClick={saveAndLeave}
                >
                  저장하고 이동
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

const ALERT_OUTPUT_WIDTH = 1920;
const ALERT_OUTPUT_HEIGHT = 1080;
const RANKING_OUTPUT_WIDTH = 1920;
const RANKING_OUTPUT_HEIGHT = 1080;

function AlertOutputCanvas({ children, className = "" }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () => setScale(frame.clientWidth / ALERT_OUTPUT_WIDTH);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={frameRef} className={`alert-output-frame ${className}`}>
      <div
        className="alert-output-canvas"
        style={{
          width: ALERT_OUTPUT_WIDTH,
          height: ALERT_OUTPUT_HEIGHT,
          transform: `translate(-50%,-50%) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AlertMessage({
  template,
  donorName,
  amountText,
  message = "",
  gradeImage = "",
  gradeName = "",
  gradeSize = 56,
  gradeDisplayMode = "image",
  gradeTextStyle,
  showGrade = false,
  nameColorEnabled = false,
  nameColor,
  amountColorEnabled = false,
  amountColor,
  suffixStyle,
}) {
  return (
    <div className="alert-text">
      {template.split("\n").map((line, index) => (
        <div className="alert-line" key={index}>
          {line.split(/(\{grade\}|\{name\}|\{amount\}|\{message\})/g).map((part, partIndex) => {
            if (part === "{grade}")
              return showGrade && gradeDisplayMode === "text" ? <span key={partIndex} className="alert-grade-text" style={gradeTextStyle}>{gradeName}</span> : showGrade && gradeImage ? (
                <img
                  key={partIndex}
                  className="alert-grade-image"
                  src={gradeImage}
                  alt=""
                  style={{ width: gradeSize, height: gradeSize }}
                />
              ) : null;
            if (part === "{name}")
              return <span key={partIndex} className="alert-token-name" style={nameColorEnabled?{color:nameColor}:undefined}>{donorName}</span>;
            if (part === "{amount}")
              return <span key={partIndex} className="alert-token-amount" style={amountColorEnabled?{color:amountColor}:undefined}>{amountText}</span>;
            if (part === "{message}")
              return <span key={partIndex} className="alert-token-message">{message}</span>;
            return <Fragment key={partIndex}>{part.split(/([님원])/g).map((text,textIndex)=>(text === "님" || text === "원") ? <span key={textIndex} className="alert-token-suffix" style={suffixStyle}>{text}</span> : text)}</Fragment>;
          })}
        </div>
      ))}
    </div>
  );
}

function AlertPreviewFrame({ appearance, donorName, amountText }) {
  const fullCanvasBackground = appearance.backgroundImageArea === "canvas" && appearance.style.backgroundImage !== "none";
  const message = (
    <AlertMessage
      template={appearance.messageTemplate}
      donorName={donorName}
      amountText={amountText}
      gradeImage={appearance.gradeImage}
      gradeName={appearance.gradeName}
      gradeSize={appearance.gradeSize}
      gradeDisplayMode={appearance.gradeDisplayMode}
      gradeTextStyle={appearance.gradeTextStyle}
      showGrade={appearance.showGrade}
      nameColorEnabled={appearance.nameColorEnabled}
      nameColor={appearance.nameColor}
      amountColorEnabled={appearance.amountColorEnabled}
      amountColor={appearance.amountColor}
      suffixStyle={appearance.suffixStyle}
    />
  );
  return (
    <AlertOutputCanvas className="preview-stage alert-preview-frame">
      <div className="alert-preview-canvas dark-mosaic">
        <div
          className={`alert ${fullCanvasBackground ? "alert-full-canvas" : appearance.animation}`}
          style={appearance.style}
        >
          {fullCanvasBackground ? <div className={`alert alert-foreground ${appearance.animation}`}>{message}</div> : message}
        </div>
      </div>
    </AlertOutputCanvas>
  );
}

function RankingOutputCanvas({ children, preview = false }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () =>
      setScale(
        Math.min(
          frame.clientWidth / RANKING_OUTPUT_WIDTH,
          frame.clientHeight / RANKING_OUTPUT_HEIGHT,
        ),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={frameRef}
      className={`ranking-output-frame${preview ? " ranking-preview dark-mosaic" : ""}`}
    >
      <div
        className="ranking-output-canvas"
        style={{
          width: RANKING_OUTPUT_WIDTH,
          height: RANKING_OUTPUT_HEIGHT,
          transform: `translate(-50%,-50%) scale(${scale})`,
        }}
      >
        <div className="ranking-output-content">{children}</div>
      </div>
    </div>
  );
}

function RankingPreview({ settings, count = 60 }) {
  const sampleNames = [
    "폴조지",
    "제병이",
    "일집헬스",
    "행복한 조이킹",
    "둥이운동",
    "피스",
  ];
  const sample = Array.from({ length: count }, (_, index) => ({
    donorName:
      sampleNames[index] || `후원자 ${String(index + 1).padStart(2, "0")}`,
    amount: Math.max(10000, 180000 - index * 2800),
    count: (index % 4) + 1,
  }));
  return (
    <RankingOutputCanvas preview>
      <RankingCard
        items={sample}
        settings={{
          ...settings,
          rankingColumns: 5,
          rankingRowsPerColumn: 20,
        }}
      />
    </RankingOutputCanvas>
  );
}

function RankingCard({ items, settings, onEdit }) {
  const rows = Math.max(1, Math.min(20, settings.rankingRowsPerColumn || 10));
  const maxColumns = Math.max(1, Math.min(5, settings.rankingColumns || 1));
  const estimatedLineHeight = settings.rankingUseLineHeight
    ? settings.rankingLineHeight
    : 1.2;
  const themeRowVerticalPadding = {
    ocean: 16,
    lavender: 18,
    transparent: 4,
  }[settings.rankingTheme] ?? 10;
  const configuredRankStyles =
    settings.rankingRankStyles || DEFAULT_SETTINGS.rankingRankStyles;
  const topRankScaleOverhead = settings.rankingRankHighlightEnabled === false
    ? 0
    : configuredRankStyles
        .slice(0, Math.min(3, rows))
        .reduce(
          (total, rankStyle) =>
            total +
            Math.max(
              0,
              Math.max(0.7, Math.min(2.4, rankStyle.size / 100)) - 1,
            ),
          0,
        );
  const availableRowsHeight = RANKING_OUTPUT_HEIGHT - 180;
  const fixedRowsHeight =
    rows * (settings.rankingRowGap + themeRowVerticalPadding);
  const safeFontSize = Math.max(
    12,
    Math.floor(
      (availableRowsHeight - fixedRowsHeight) /
        (estimatedLineHeight * (rows + topRankScaleOverhead)),
    ),
  );
  const effectiveFontSize = Math.min(settings.rankingFontSize, safeFontSize);
  const visible = items.slice(0, rows * maxColumns);
  const rankNumberLimit = Number(settings.rankingLimit) === 1 ? 1 : 3;
  const columns = Array.from(
    { length: Math.min(maxColumns, Math.ceil(visible.length / rows) || 1) },
    (_, column) => visible.slice(column * rows, (column + 1) * rows),
  );
  const firstGridColumn = maxColumns - columns.length + 1;
  const cardStyle = {
    fontFamily: settings.rankingFontFamily,
    "--ranking-size": `${effectiveFontSize}px`,
    "--ranking-gap": `${settings.rankingRowGap}px`,
    "--column-gap": `${settings.rankingColumnGap}px`,
    "--line-height": settings.rankingUseLineHeight
      ? settings.rankingLineHeight
      : "normal",
    "--letter-spacing": `${settings.rankingLetterSpacing}px`,
    "--name-color": settings.rankingNameColor,
    "--amount-color": settings.rankingAmountColor,
    "--custom-bg": settings.rankingCustomBackground,
    "--custom-border": settings.rankingCustomBorderEnabled === false ? "transparent" : settings.rankingCustomBorder,
    "--custom-row": settings.rankingCustomRowBackgroundEnabled === false ? "transparent" : settings.rankingCustomRowBackground,
    "--custom-radius": `${settings.rankingCustomRadius}px`,
  };
  const titleGridColumn = settings.rankingTitleColumn === "last"
    ? firstGridColumn + columns.length - 1
    : firstGridColumn;
  return (
    <div
      className={`widget-card theme-${settings.rankingTheme} ${settings.rankingBackgroundEnabled ? "" : "ranking-no-background"} marker-${settings.rankingCustomMarker} ranking-enter-${settings.rankingAnimation}`}
      style={cardStyle}
    >
      {settings.rankingShowTitle && (
        <h2
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${maxColumns},minmax(0,1fr))`,
            columnGap: `var(--column-gap)`,
            fontSize: settings.rankingTitleSize,
            color: settings.rankingTitleColor,
          }}
        >
          <span
            style={{
              gridColumn: titleGridColumn,
              textAlign: settings.rankingTitleAlign,
            }}
          >
            {settings.rankingTitle || "오늘의 후원"}
          </span>
        </h2>
      )}
      <div
        className="ranking-grid"
        style={{ gridTemplateColumns: `repeat(${maxColumns},minmax(0,1fr))` }}
      >
        {columns.map((column, columnIndex) => (
          <div
            className="ranking-column"
            key={columnIndex}
            style={{ gridColumn: firstGridColumn + columnIndex }}
          >
            {column.map((item, rowIndex) => {
              const index = columnIndex * rows + rowIndex;
              const savedRankStyles = settings.rankingRankStyles || DEFAULT_SETTINGS.rankingRankStyles;
              const rankStyle = index < 3
                ? savedRankStyles[index]
                : {
                    color: settings.rankingNameColor,
                    badge: (RANKING_THEME_PRESETS[settings.rankingTheme]?.rankingRankStyles || DEFAULT_SETTINGS.rankingRankStyles)[3].badge,
                    size: 100,
                    weight: settings.rankingFontWeight,
                  };
              const rankHighlight =
                settings.rankingRankHighlightEnabled !== false;
              return (
                <div
                  className={`widget-row rank-${index + 1} row-${settings.rankingRowAlign}`}
                  key={`${item.donorName}-${index}`}
                  onClick={onEdit ? () => onEdit(item) : undefined}
                  role={onEdit ? "button" : undefined}
                  tabIndex={onEdit ? 0 : undefined}
                  onKeyDown={onEdit ? (event) => {
                    if (event.key === "Enter" || event.key === " ") onEdit(item);
                  } : undefined}
                  style={{
                    "--rank-color": rankHighlight
                      ? rankStyle.color
                      : settings.rankingNameColor,
                    "--rank-badge": rankHighlight ? rankStyle.badge : undefined,
                    "--rank-amount-color": rankHighlight && index < 3
                      ? (rankStyle.amountColor || settings.rankingAmountColor)
                      : settings.rankingAmountColor,
                    "--rank-scale": rankHighlight && index < 3
                      ? Math.max(0.7, Math.min(2.4, rankStyle.size / 100))
                      : 1,
                    "--rank-weight": settings.rankingFontWeight,
                    "--delay": `${index * 0.07}s`,
                  }}
                >
                  <b style={{ textAlign: settings.rankingNameAlign }}>
                    {settings.rankingShowRank && index < rankNumberLimit && (
                      <em>{rankMarker(settings.rankingTheme, index)}</em>
                    )}
                    <span className="donor-name">
                      {item.donorName}
                      {settings.rankingNameSuffix && <span className="donor-name-suffix" style={{ color: settings.rankingNameSuffixColor || settings.rankingNameColor }}>{settings.rankingNameSuffix}</span>}
                    </span>
                    {settings.rankingShowCount && <small>{item.count}회</small>}
                  </b>
                  <span
                    className="donor-amount"
                    style={{ textAlign: settings.rankingAmountAlign }}
                  >
                    {formatWon(item.amount)}
                    {settings.rankingAmountSuffix && <span className="donor-amount-suffix" style={{ color: settings.rankingAmountSuffixColor || settings.rankingAmountColor }}>{settings.rankingAmountSuffix}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Widget({ token }) {
  useTransparentDocument();
  const [data, setData] = useState({ ranking: [], settings: DEFAULT_SETTINGS });
  useEffect(() => {
    const load = () =>
      token
        ? api(`/api/widgets/${encodeURIComponent(token)}`).then((value) =>
            setData({ ranking: value.ranking, settings: value.settings }),
          )
        : Promise.all([api("/api/widgets"), api("/api/settings")]).then(
            ([widgets, settings]) =>
              setData({ ranking: widgets.ranking, settings }),
          );
    load();
    let fallbackTimer = null;
    const eventPath = token
      ? `/api/widgets/${encodeURIComponent(token)}/events`
      : "/api/my/deposits/events";
    const stream = new EventSource(apiUrl(eventPath), { withCredentials:true });
    stream.addEventListener("change", load);
    stream.onopen = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    stream.onerror = () => {
      if (!fallbackTimer) fallbackTimer = setInterval(load, 15000);
    };
    return () => {
      stream.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [token]);
  return (
    <div className="ranking-root">
      <RankingOutputCanvas>
        <RankingCard items={data.ranking} settings={data.settings} />
      </RankingOutputCanvas>
    </div>
  );
}

function Overlay({ token, preview = false }) {
  useTransparentDocument();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [current, setCurrent] = useState(null);
  const lastId = useRef(0);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const queue = useRef([]);
  const playing = useRef(false);
  const currentRef = useRef(null);
  const playbackTimers = useRef([]);
  const playbackSequence = useRef(0);
  const [exiting, setExiting] = useState(false);
  const previewSoundMuted =
    new URLSearchParams(location.search).get("sound") === "off";
  const previewMode =
    preview || new URLSearchParams(location.search).get("preview") === "1";

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    if (!current || !previewSoundMuted) return;
    const frame = requestAnimationFrame(() =>
      window.opener?.postMessage(
        { type: "n9-preview-visible" },
        location.origin,
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [current, previewSoundMuted]);

  useEffect(() => {
    let events;
    let stopped = false;
    const bootstrapPath = previewMode
      ? new URLSearchParams(location.search).get("previewToken")
        ? `/api/overlay/preview-session/${encodeURIComponent(new URLSearchParams(location.search).get("previewToken"))}`
        : "/api/overlay/preview"
      : `/api/overlay/${encodeURIComponent(token)}/bootstrap`;
    api(bootstrapPath).then(async ({ settings: value, lastDonationId, previewDonation }) => {
      if (stopped) return;
      setSettings(value);
      settingsRef.current = value;
      if (previewMode) {
        if (value.ttsEnabled)
          await waitForSpeechVoices(value.ttsVoiceURI || "");
        queue.current.push(previewDonation);
        play();
        return;
      }
      lastId.current = lastDonationId;
      events = new EventSource(
        apiUrl(
          `/api/overlay/${encodeURIComponent(token)}/events?after=${lastId.current}`,
        ),
        { withCredentials: true },
      );
      events.addEventListener("bootstrap", (event) => {
        const snapshot = JSON.parse(event.data);
        setSettings(snapshot.settings);
        settingsRef.current = snapshot.settings;
      });
      events.addEventListener("settings", (event) => {
        const nextSettings = JSON.parse(event.data);
        setSettings(nextSettings);
        settingsRef.current = nextSettings;
      });
      events.addEventListener("donation", (event) => {
        const donation = JSON.parse(event.data);
        if (!donation.isTest) {
          if (!donation.isChatMessage && donation.id <= lastId.current) return;
          lastId.current = Math.max(lastId.current, Number(donation.id) || 0);
        }
        if (
          donation.amount < Number(settingsRef.current.alertMinimumAmount || 0)
        )
          return;
        queue.current.push(donation);
        play();
      });
      events.addEventListener("control", (event) => {
        const control = JSON.parse(event.data);
        if (control.action === "stop-current-chat") stopCurrentChat();
      });
    });
    return () => {
      stopped = true;
      events?.close();
    };
  }, [token, preview]);

  function play() {
    if (playing.current || !queue.current.length) return;
    playing.current = true;
    const donation = queue.current.shift();
    const sequence = ++playbackSequence.current;
    currentRef.current = donation;
    setExiting(false);
    setCurrent(donation);
    const appearance = alertAppearance(settingsRef.current, donation.amount);
    const messageTemplate = donation.message
      ? `${appearance.messageTemplate}\n{message}`
      : appearance.messageTemplate;
    const spokenText = donation.message || messageTemplate
      .replaceAll("{name}", donation.donorName)
      .replaceAll("{amount}", formatWon(donation.amount))
      .replaceAll("{message}", "");
    const usesToonationOriginalAudio = donation.bank === "toonation" && settingsRef.current.toonationAlertMode === "custom-original-audio";
    if (!previewSoundMuted && !usesToonationOriginalAudio) {
      if (donation.message) {
        void (async () => {
          try {
            await playAlertSound(
              settingsRef.current,
              appearance.soundPreset,
              appearance.soundVolume,
              appearance.customSoundData,
              true,
            );
            if (playbackSequence.current !== sequence) return;
            await playAlertSpeech(appearance, spokenText, { token: preview ? null : token });
          } catch (error) {
            console.warn("알림 음성 재생을 건너뜁니다:", error);
          }
        })();
      } else {
        playAlertSound(
          settingsRef.current,
          appearance.soundPreset,
          appearance.soundVolume,
          appearance.customSoundData,
        );
        playAlertSpeech(appearance, spokenText, { token: preview ? null : token })
          .catch((error) => console.warn("알림 음성 재생을 건너뜁니다:", error));
      }
    }
    if (previewMode) return;
    const duration = Math.max(1000, appearance.durationMs);
    playbackTimers.current = [
      setTimeout(() => setExiting(true), Math.max(200, duration - 500)),
      setTimeout(() => {
      setCurrent(null);
      currentRef.current = null;
      setExiting(false);
      playing.current = false;
      playbackTimers.current = [];
      setTimeout(play, 350);
      }, duration),
    ];
  }

  function stopCurrentChat() {
    if (!currentRef.current?.message) return;
    playbackSequence.current += 1;
    for (const timer of playbackTimers.current) clearTimeout(timer);
    playbackTimers.current = [];
    stopActiveAlertSpeech();
    currentRef.current = null;
    setCurrent(null);
    setExiting(false);
    playing.current = false;
    setTimeout(play, 100);
  }

  if (!current) return <div className="overlay-stage" />;
  const appearance = alertAppearance(settings, current.amount);
  const outputTemplate = current.message
    ? `${appearance.messageTemplate}\n{message}`
    : appearance.messageTemplate;
  const crewGrade = (settings.crewGrades || []).find(
    (grade) => grade.id === current.crewGradeId,
  );
  const fullCanvasBackground = appearance.backgroundImageArea === "canvas" && appearance.style.backgroundImage !== "none";
  const message = (
    <AlertMessage
      template={outputTemplate}
      donorName={current.donorName}
      amountText={formatWon(current.amount)}
      message={current.message || ""}
      gradeImage={crewGrade?.imageData || ""}
      gradeName={crewGrade?.name || ""}
      gradeSize={settings.crewGradeImageSize}
      gradeDisplayMode={settings.crewGradeDisplayMode}
      gradeTextStyle={{color:settings.crewGradeTextColor,fontFamily:settings.crewGradeTextFontFamily,fontSize:settings.crewGradeTextSize}}
      showGrade={settings.crewGradeEnabled && Boolean(crewGrade)}
      nameColorEnabled={appearance.nameColorEnabled}
      nameColor={appearance.nameColor}
      amountColorEnabled={appearance.amountColorEnabled}
      amountColor={appearance.amountColor}
      suffixStyle={appearance.suffixStyle}
    />
  );
  return (
    <AlertOutputCanvas className="overlay-stage">
      <div
        className={`alert ${fullCanvasBackground ? "alert-full-canvas" : exiting ? appearance.exitAnimation : appearance.animation}`}
        style={appearance.style}
      >
        {fullCanvasBackground ? <div className={`alert alert-foreground ${exiting ? appearance.exitAnimation : appearance.animation}`}>{message}</div> : message}
      </div>
    </AlertOutputCanvas>
  );
}
