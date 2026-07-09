FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir reportlab pypdf && \
    apt-get update && \
    apt-get install -y --no-install-recommends gosu fontconfig && \
    rm -rf /var/lib/apt/lists/*

# 下载独立 .ttf 中文字体（避免 .ttc 兼容问题）
RUN mkdir -p /usr/share/fonts/zhubi && \
    apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
    wget -q -O /usr/share/fonts/zhubi/NotoSansSC-Regular.ttf \
      "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf" && \
    apt-get purge -y wget && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# 验证字体
RUN ls -lh /usr/share/fonts/zhubi/

COPY *.py *.html *.css *.js ./
RUN mkdir -p /app/data
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8321

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "server.py"]
