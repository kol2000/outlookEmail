# Use Python 3.11 as the base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install curl (for health check)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Copy dependent files
COPY requirements.txt .

# Install dependencies (including production server)
RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install gunicorn

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Exposed port
EXPOSE 5000

# Start the application (gunicorn thread model, single worker multi-thread)
# Timeout and other parameters are injected through environment variables, no need to hardcode in the image
CMD ["sh", "-c", "gunicorn -k gthread -w 1 --threads ${GUNICORN_THREADS:-4} -b 0.0.0.0:5000 --timeout ${GUNICORN_TIMEOUT:-300} --graceful-timeout 30 --access-logfile - --error-logfile - --capture-output web_outlook_app:app"]
