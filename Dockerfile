FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir reportlab pypdf && \
    apt-get update && \
    apt-get install -y --no-install-recommends fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

COPY *.py *.html *.css *.js ./

RUN mkdir -p /app/data

EXPOSE 8321

CMD ["python", "server.py"]
