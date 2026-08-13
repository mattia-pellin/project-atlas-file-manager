FROM node:26-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./

# Two stamps for the "Informazioni" panel, whose job is to answer "is the tab in front
# of me this build?". `.git` is dockerignored, so the sha has to be handed in — CI
# passes `github.sha`, a local build leaves it empty and the panel prints a dash. The
# date is taken here rather than passed, so a local `docker compose up --build` is
# still identifiable. It is stamped when this layer actually re-runs — `date` in a RUN
# is not a cache key — which is whenever the frontend source changed, and the build
# counter in `src/buildinfo.ts` is part of that source.
ARG GIT_SHA=""
RUN VITE_BUILD_SHA="$(echo "$GIT_SHA" | cut -c1-7)" \
    VITE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    npm run build

FROM python:3.14-slim AS backend-builder

# Pinned to the same uv the dev group installs, so the image and the developer
# resolve with identical logic. It stays in this stage — the 52 MB binary has
# no business in the published image.
COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /usr/local/bin/uv

WORKDIR /app

# Install from uv.lock: exact versions, hash-verified. --no-dev leaves out
# pytest/ruff/uv, --frozen refuses to re-resolve, so the image can only ever
# ship what CI tested. Only the lock is copied, so a code change does not
# invalidate this layer.
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.14-slim
WORKDIR /app

# The venv is relocatable only to the same path on the same base image; both
# stages are python:3.14-slim and both use /app/.venv. Keep them in step.
COPY --from=backend-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Default environment variables
ENV PORT=8000
# The only tree the app may read or rename inside. `backend/paths.py` enforces it.
ENV MEDIA_ROOT=/media
ENV TMDB_API_KEY=""
ENV TVDB_API_KEY=""
ENV CACHE_TTL_HOURS=24
ENV FRONTEND_DIR=/app/frontend/dist

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
