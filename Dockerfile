FROM node:20-slim

WORKDIR /app

# Corepack 활성화 (Yarn Berry 사용)
RUN corepack enable

# Yarn Berry zero-install을 위한 파일 복사
COPY package.json .yarnrc.yml yarn.lock ./
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

# 초기 데이터 파일 복사 (Volume이 비어있을 때 사용)
COPY selected-problems.json ./selected-problems.json.template

# 실행 스크립트 생성
RUN printf '#!/bin/sh\n\
if [ ! -f /data/selected-problems.json ]; then\n\
  echo "Initializing data directory..."\n\
  cp /app/selected-problems.json.template /data/selected-problems.json\n\
fi\n\
exec yarn start\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# 실행
CMD ["/app/entrypoint.sh"]
