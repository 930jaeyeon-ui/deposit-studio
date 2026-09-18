# Deposit Studio

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
- API 수신 테스트: http://127.0.0.1:5173/api-test

휴대폰과 PC를 같은 Wi-Fi에 연결한 뒤, 휴대폰에서는 `127.0.0.1` 대신 PC의 Wi-Fi IPv4 주소를 사용합니다. 테스트 페이지에 표시되는 `POST /api/test/messages` 주소로 `Content-Type: application/json` 헤더와 JSON 객체를 보내면 페이지의 수신함에 즉시 표시됩니다. 화면 갱신은 단방향 실시간 전송에 맞는 SSE(Server-Sent Events)를 사용합니다.

SQLite 파일은 최초 실행 시 `data/deposit-studio.db`에 생성됩니다.

## Render 배포

루트의 `render.yaml` Blueprint는 두 서비스를 생성합니다.

- `deposit-studio-web`: React 정적 사이트
- `deposit-studio-api`: 무료 Node.js API와 Turso SQLite 호환 DB

Render에서 **New > Blueprint**를 선택하고 이 저장소를 연결하면 됩니다. 배포 시
Turso에서 발급한 `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN`을 입력합니다.
