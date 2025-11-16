# Используем Python 3.11
FROM python:3.11-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем только requirements, чтобы кэшировать слои
COPY backend/requirements.txt .

# Устанавливаем зависимости
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь проект
COPY . .

# Указываем порт для Render
ENV PORT=10000

# Команда запуска
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "backend.app:app", "--bind", "0.0.0.0:10000"]
