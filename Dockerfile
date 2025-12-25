FROM node:20-slim

WORKDIR /app

# Corepack 활성화 (Yarn Berry 사용)
RUN corepack enable

# Yarn Berry zero-install을 위한 파일 복사
COPY package.json .yarnrc.yml ./
COPY .yarn ./.yarn

# PnP 런타임 파일 복사
COPY .pnp.cjs .pnp.loader.mjs* ./

# 의존성 설치 (zero-install이므로 캐시에서 복원만 수행)
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
