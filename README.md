# 그림일기 타임머신

사진 한 장이나 일기 몇 줄만 넣으면, 2010년대 초등학교 2학년 남자아이의 여름방학 숙제 같은 `그림일기` 이미지로 바꿔주는 작은 웹앱입니다.

처음 보는 분도 바로 감이 오실 수 있도록, 결과 이미지를 앞에 두는 방식으로 정리했습니다.

## 미리 보기

<table>
  <tr>
    <td><img src="./main.png" alt="메인 화면" width="100%" /></td>
    <td><img src="./main2.png" alt="메인 화면 2" width="100%" /></td>
  </tr>
  <tr>
    <td><img src="./public/sample-output.png" alt="샘플 출력 1" width="100%" /></td>
    <td><img src="./public/sample-output2.png" alt="샘플 출력 2" width="100%" /></td>
  </tr>
</table>

## 이 앱이 하는 일

- 참고 사진 업로드
- 날짜, 날씨, 제목, 장소, 일기 내용 입력
- 초등학생 그림일기 감성 프롬프트 자동 생성
- OpenAI Image API로 이미지 생성
- 결과 이미지 다운로드
- Google, KakaoTalk, Naver OAuth 로그인
- 로그인한 사용자별 그림일기 저장 및 날짜별 다시 보기
- API 키가 없어도 샘플 이미지와 프롬프트 미리보기 가능

## 실행 방법

Node.js 20 이상이 필요합니다.

```bash
cd picture-diary-time-machine
cp .env.example .env
```

`.env`에 키를 넣어 주세요.

```bash
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-2
PORT=8787
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

로그인과 일기장 저장을 사용하려면 Supabase 프로젝트가 필요합니다.

1. Supabase에서 새 프로젝트를 만듭니다.
2. `supabase.schema.sql` 내용을 SQL Editor에서 실행합니다.
3. Authentication Providers에서 Google과 Kakao를 활성화합니다.
4. Naver는 Supabase 기본 제공 Provider 목록에 없으므로 Custom OAuth/OIDC Provider로 `custom:naver`를 만들어 연결합니다.
5. Vercel 환경 변수에도 `SUPABASE_URL`, `SUPABASE_ANON_KEY`를 추가합니다.

실행:

```bash
npm start
```

브라우저에서 열기:

```bash
http://localhost:8787
```

## 한 줄 요약

이 프로젝트는 사진과 짧은 메모를 넣으면, 진짜 초등학생 그림일기 같은 결과물로 바꿔주는 이미지 생성 도구입니다.

## 배포할 때 주의할 점

- API 키는 절대 프론트엔드에 넣지 않아야 합니다.
- 지금 코드는 작은 MVP라서 결제와 rate limit은 없습니다.
- 공개 서비스로 만들 경우, 서버 쪽에 사용자별 요청 제한, 비용 한도, 업로드 이미지 삭제 정책을 꼭 넣으셔야 합니다.
- 생성 이미지가 실제 과거 숙제처럼 보일 수 있으니, 서비스 설명에 `AI 생성 이미지`라는 안내를 넣는 것이 좋습니다.

## 다음에 하면 좋은 것

- 결과 4장 비교 생성
- 일기 문장 자동 초2 말투 변환
- 일기장 검색/월별 보기
- Vercel, Render, Fly.io 같은 곳에 배포
- 결제 전환용 랜딩 페이지 추가
