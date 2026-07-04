FROM python:3.12-slim

ARG PUID=1000
ARG PGID=1000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN groupadd --gid ${PGID} app \
 && useradd --uid ${PUID} --gid app --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data \
 && chown app:app /data

USER app

ENV FF3LANTERN_DATA_DIR=/data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
