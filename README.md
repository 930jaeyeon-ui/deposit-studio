# N9 SIGNAL

## 인증 설계 원칙

- 웹 로그인은 서버 세션으로 유지하고 세션 식별자는 `HttpOnly`, `Secure`, `SameSite` 쿠키로 전달한다.
- 푸시 알림은 하나의 통합 API로 받고, 앱 패키지별 정규식 규칙으로 입금자와 금액을 추출한다.
- 운영 환경에서는 `NOTIFICATION_API_KEY`를 설정해 알림 수신 API를 보호한다.
- 앱 패키지 정규식은 공용으로 사용하고, 파싱된 입금은 Basic Auth로 인증한 사용자 계정에 저장한다.
- 슈퍼 계정은 폴조지, 관리자 계정은 차니·오뚝2, 나머지 크루원은 일반 계정으로 시작한다.
- 내 대시보드와 크루 대시보드는 모든 로그인 계정이 조회할 수 있다.
- 크루 대시보드는 비제이별 실적 비교가 아니라 크루 전체 후원 금액과 후원자 순위를 제공한다.
- 계정 관리와 API 인증정보 관리는 슈퍼 계정과 관리자 계정만 접근할 수 있다.

은행 입금 정보를 방송 후원으로 관리하고 OBS에 표시하는 모노레포입니다.

## 구성

- `apps/web`: React + Vite 관리 화면 및 OBS 위젯
- `apps/api`: Node.js + Express API, SQLite 저장소
- `packages/shared`: 웹과 API가 함께 쓰는 상수와 검증 함수

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

- 관리 화면: http://127.0.0.1:5173
- OBS 알림: http://127.0.0.1:5173/overlay
- API: http://127.0.0.1:3001/api/health
- 알림 파싱 규칙: http://127.0.0.1:5173/admin/notification-rules (최고 관리자 전용)

휴대폰과 PC를 같은 Wi-Fi에 연결한 뒤, 휴대폰에서는 `127.0.0.1` 대신 PC의 Wi-Fi IPv4 주소를 사용합니다. 최고 관리자 화면에서 앱 패키지별 파싱 규칙을 등록한 후 `POST /api/notifications`로 아래 JSON을 보냅니다.

```json
{
  "packageName": "com.example.bank",
  "title": "입금 알림",
  "content": "홍길동님이 50,000원을 입금했습니다."
}
```

내용 정규식에는 입금자 `(?<donor>...)`와 금액 `(?<amount>...)` 이름 캡처 그룹이 필요합니다. 요청에는 사용자 로그인 아이디와 비밀번호를 HTTP Basic Auth로 전송합니다. Authorization 헤더는 API 로그에서 마스킹됩니다.

SQLite 파일은 최초 실행 시 `data/deposit-studio.db`에 생성됩니다.

## Render 배포

루트의 `render.yaml` Blueprint는 두 서비스를 생성합니다.

- `deposit-studio-web`: React 정적 사이트
- `deposit-studio-api`: 무료 Node.js API와 Turso SQLite 호환 DB

Render에서 **New > Blueprint**를 선택하고 이 저장소를 연결하면 됩니다. 배포 시
Turso에서 발급한 `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN`을 입력합니다.
