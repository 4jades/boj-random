FROM node:20-slim

WORKDIR /app

# Corepack 활성화 (Yarn 사용)
RUN corepack enable

# 패키지 파일 복사
COPY package.json yarn.lock ./
COPY .pnp.cjs .pnp.loader.mjs ./
COPY .yarn ./.yarn

# 소스 복사
COPY tsconfig.json ./
COPY src ./src

# 빌드
RUN yarn build

# selected-problems.json 초기 파일 생성
RUN echo '{"problems":[]}' > selected-problems.json

# 실행
CMD ["yarn", "start"]
