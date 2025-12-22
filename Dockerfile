FROM node:20-slim

WORKDIR /app

# Corepack 활성화 (Yarn 사용)
RUN corepack enable

# 패키지 파일 복사
COPY package.json yarn.lock ./

# nodeLinker를 node-modules로 설정 (PnP 대신)
RUN echo 'nodeLinker: node-modules' > .yarnrc.yml

# 의존성 설치
RUN yarn install --immutable

# 소스 복사
COPY tsconfig.json ./
COPY src ./src

# 빌드
RUN yarn build

# 선택된 문제 기록 파일 복사
COPY selected-problems.json ./

# 실행
CMD ["yarn", "start"]
