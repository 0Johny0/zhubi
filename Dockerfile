FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir reportlab pypdf && \
    apt-get update && \
    apt-get install -y --no-install-recommends gosu fontconfig jbig2dec && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/share/fonts/zhubi && \
    apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
    wget -q -O /usr/share/fonts/zhubi/NotoSansSC-Regular.ttf \
      "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf" && \
    apt-get purge -y wget && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY *.py *.html *.css *.js ./
RUN mkdir -p /app/data
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8321

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "server.py"]
