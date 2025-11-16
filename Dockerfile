# --- Stage 1: Base Python image ---
FROM python:3.11-slim

# Рабочая директория
WORKDIR /app

# Копируем backend зависимости
COPY backend/requirements.txt .

# Устанавливаем зависимости
RUN pip install --no-cache-dir -r requirements.txt

# Копируем backend код
COPY backend/ ./backend/

# Копируем фронтенд как статические файлы
COPY frontend/ ./static/

# Устанавливаем рабочую директорию в backend
WORKDIR /app/backend

# Команда запуска (Flask + SocketIO через eventlet)
CMD ["gunicorn", "-k", "eventlet", "-w", "1", "app:app", "-b", "0.0.0.0:8000"]
