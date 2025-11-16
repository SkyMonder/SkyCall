# Используем стабильный Python 3.11
FROM python:3.11-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем backend
COPY backend/ ./backend/
COPY backend/requirements.txt .

# Устанавливаем зависимости Python
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir eventlet>=0.24.1

# Копируем фронтенд как статические файлы
COPY frontend/ ./static/

# Указываем порт
EXPOSE 5000

# Запуск приложения с eventlet
CMD ["gunicorn", "-b", "0.0.0.0:5000", "backend.app:app", "-k", "eventlet", "--worker-connections", "1000"]
