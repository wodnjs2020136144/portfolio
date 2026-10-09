# 황재원 포트폴리오

https://hwangjaewon.vercel.app

빌드 없이 동작하는 정적 사이트다. JavaScript는 나에게 질문하기(`/ask/`)에만 쓴다.

- 쪽: 홈(`index.html`), 사례 6쪽(`work/<사례>/index.html`), 이 사이트를 만든 방식(`colophon/index.html`), 나에게 질문하기(`ask/`)와 검증 결과(`ask/eval/`)
- 서버: `api/ask.js`(Vercel 함수, Claude API). 골든셋 평가는 `eval/`이고, 그 결과로 검증 결과 쪽과 질문하기의 자주 받는 질문을 다시 쓴다
- 스타일: 모든 쪽이 `assets/site.css` 한 파일을 함께 쓴다
- 이미지는 `images/`에, 링크 미리보기 이미지는 `og.png`(1200×630)에 있다
- 글꼴: Pretendard(jsDelivr), Noto Serif KR(Google Fonts)
- 배포: 이 저장소를 Vercel에 연결해 `main`에 푸시하면 자동 배포된다
- 작업 규칙: [AGENTS.md](AGENTS.md)
