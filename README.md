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

규칙의 제목(선택) 및 내용 정규식을 합쳐 입금자 `(?<donor>...)`와 금액 `(?<amount>...)` 이름 캡처 그룹이 필요합니다. 예를 들어 제목에서 `amount`를, 내용에서 `donor`를 각각 추출할 수 있습니다. 제목 정규식이 비어 있으면 기존처럼 내용만 파싱합니다. 요청에는 사용자 로그인 아이디와 비밀번호를 HTTP Basic Auth로 전송합니다. Authorization 헤더는 API 로그에서 마스킹됩니다.

SQLite 파일은 최초 실행 시 `data/deposit-studio.db`에 생성됩니다.

### 투네이션 연동

각 사용자는 **후원 알림 설정 → 투네이션 연동**에서 자신의 투네이션 공식 알림 위젯 URL을 저장할 수 있습니다. 수신된 후원은 해당 사용자의 입금 내역과 순위에 `투네이션`으로 합산됩니다. 알림 화면은 `투네이션 공식 화면 사용`과 `자체 알림 화면 사용` 중 하나를 선택할 수 있습니다. 자체 화면을 선택할 때는 중복 표시를 막기 위해 OBS의 투네이션 공식 위젯 소스를 숨겨야 합니다.

`자체 화면 + 원본 소리` 모드는 자체 알림 화면과 투네이션 원본 TTS·음원을 함께 사용합니다. OBS에서 투네이션 공식 위젯 소스를 활성 상태로 유지한 채 크기를 `1 × 1`로 설정하고 화면 밖에 배치하면 공식 화면 없이 원본 소리만 사용할 수 있습니다.

## ElevenLabs TTS

API 서버의 `ELEVENLABS_API_KEY` 환경변수에 ElevenLabs API 키를 설정하면 후원
알림 설정에서 ElevenLabs 계정에 저장된 음성을 선택하고 미리 들을 수 있습니다.
API 키는 웹 브라우저로 전달되지 않으며 서버에서만 사용됩니다. 키가 없거나 외부
음성 생성에 실패하면 OBS 알림은 방송 PC의 기본 TTS로 자동 대체됩니다.

## Render 배포

루트의 `render.yaml` Blueprint는 두 서비스를 생성합니다.

- `deposit-studio-web`: React 정적 사이트
- `deposit-studio-api`: 무료 Node.js API와 Turso SQLite 호환 DB

Render에서 **New > Blueprint**를 선택하고 이 저장소를 연결하면 됩니다. 배포 시
Turso에서 발급한 `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN`을 입력합니다.

## OCI 자동 배포

`main` 브랜치에 푸시하면 GitHub Actions가 테스트와 웹 빌드를 통과한 뒤 OCI의 웹/WAS 인스턴스에 각각 배포합니다.
웹 인스턴스는 React 정적 파일을 제공하고, WAS 인스턴스는 Node.js API와 SQLite를 실행합니다.
SQLite 파일은 릴리스와 분리된 `/srv/deposit-studio-data/deposit-studio.db`를 계속 사용합니다.

GitHub 저장소의 **Settings > Secrets and variables > Actions**에 다음 Repository secret을 등록합니다.

- `OCI_WEB_HOST`: 웹 인스턴스의 고정 공인 IP 또는 도메인
- `OCI_WAS_HOST`: WAS 인스턴스의 고정 공인 IP 또는 도메인
- `OCI_USER`: SSH 사용자(생략하려면 secret 대신 `opc`가 기본값으로 사용됨)
- `OCI_SSH_PRIVATE_KEY`: 배포용 SSH 개인 키 전체 내용
- `OCI_KNOWN_HOSTS`: 두 서버에 대한 `ssh-keyscan -H <OCI_WEB_HOST> <OCI_WAS_HOST>` 결과
- `ELEVENLABS_API_KEY`: 후원 알림 TTS에 사용할 ElevenLabs API 키

워크플로 파일은 `.github/workflows/deploy-oci.yml`, 서버 배포 스크립트는
`deploy/oci/deploy-web.sh`와 `deploy/oci/deploy-was.sh`입니다. 배포마다 새 릴리스를 만들고,
데이터베이스를 건드리지 않은 채 `current` 심볼릭 링크를 전환합니다.
