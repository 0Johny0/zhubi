FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir reportlab pypdf && \
    apt-get update && \
    apt-get install -y --no-install-recommends fonts-noto-cjk gosu fontconfig && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

# 验证字体已安装
RUN fc-list :lang=zh file | head -5

COPY *.py *.html *.css *.js ./

RUN mkdir -p /app/data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8321

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "server.py"]
