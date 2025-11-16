# --- Stage 1: Build Backend ---
FROM python:3.11-slim AS backend

# Установим системные зависимости для Python и сборки
RUN apt-get update && apt-get install -y \
    build-essential \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Рабочая директория
WORKDIR /app

# Копируем зависимости
COPY backend/requirements.txt .

# Устанавливаем зависимости
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "eventlet==0.31.1"

# Копируем весь backend
COPY backend/ ./

# --- Stage 2: Build Frontend ---
FROM node:20 AS frontend

WORKDIR /app/frontend

# Копируем фронтенд
COPY frontend/ .

# Устанавливаем зависимости и собираем
RUN npm install --legacy-peer-deps && npm run build

# --- Stage 3: Final Image ---
FROM python:3.11-slim

WORKDIR /app

# Копируем backend
COPY --from=backend /app /app

# Копируем фронтенд сборку в static
COPY --from=frontend /app/frontend/build /app/static

# Устанавливаем Eventlet для Gunicorn
RUN pip install --no-cache-dir "eventlet==0.31.1"

# Открываем порт
EXPOSE 5000

# Команда запуска
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app", "-k", "eventlet", "--worker-connections", "1000"]
