FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir reportlab pypdf && \
    apt-get update && \
    apt-get install -y --no-install-recommends fonts-noto-cjk gosu && \
    rm -rf /var/lib/apt/lists/*

COPY *.py *.html *.css *.js ./

RUN mkdir -p /app/data

# 启动脚本：以 PUID/PGID 对应的用户运行
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8321

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "server.py"]
