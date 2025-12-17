# BOJ Random Problem Selector

백준 온라인 저지의 **골드 4~5 난이도** 문제 중에서 랜덤하게 하나를 선택하는 스크립트입니다.

## 기능

- 🎲 골드 4~5 난이도 문제 중 랜덤 선택
- 👤 특정 유저가 푼 문제 제외 기능
- 📝 선택된 문제를 JSON 파일에 기록하여 중복 방지
- 📊 문제 정보 (번호, 제목, 티어, 맞은 사람 수, 평균 시도 횟수) 표시

## 사용법

```bash
# 의존성 설치
yarn install

# 실행
yarn dev

# 또는 빌드 후 실행
yarn build
yarn start
```

## 설정

`src/index.ts` 파일 상단의 `EXCLUDE_USER_IDS` 배열에 제외할 백준 아이디를 추가하세요.

```typescript
const EXCLUDE_USER_IDS: string[] = [
  "user1",
  "user2",
];
```

이 유저들이 이미 푼 문제는 랜덤 선택에서 제외됩니다.

## 선택 기록 초기화

모든 문제를 다시 선택하고 싶다면 `selected-problems.json` 파일을 삭제하세요.

```bash
rm selected-problems.json
```

## API

이 스크립트는 [solved.ac 비공식 API](https://solvedac.github.io/unofficial-documentation/#/)를 사용합니다.

