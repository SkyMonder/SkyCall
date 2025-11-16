# Используем Python 3.11 slim
FROM python:3.11-slim

# Устанавливаем зависимости системы
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Рабочая директория
WORKDIR /app

# Копируем backend requirements
COPY backend/requirements.txt .

# Обновляем pip и ставим зависимости
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Копируем backend
COPY backend/ ./

# Копируем frontend и билдим его в папку static
COPY frontend/ ./frontend/
RUN apt-get update && apt-get install -y nodejs npm && \
    cd frontend && npm install && npm run build && \
    mkdir -p ../static && cp -r build/* ../static && \
    cd .. && rm -rf frontend && apt-get remove -y nodejs npm && apt-get autoremove -y

# Экспортируем порт
EXPOSE 5000

# Запуск через Gunicorn с eventlet
CMD ["gunicorn", "-w", "1", "-k", "eventlet", "-b", "0.0.0.0:5000", "app:app"]
