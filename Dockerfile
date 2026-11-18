FROM node:24-alpine
WORKDIR /app
COPY serve.mjs ./
COPY public ./public
ENV HOST=0.0.0.0
USER node
CMD ["node", "serve.mjs"]
