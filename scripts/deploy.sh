#!/usr/bin/env bash
# ==============================================================================
# Frame — Production Deployment & Orchestration Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTPAY_DIR="$ROOT_DIR/agentpay"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${CYAN}ℹ [Frame Deploy]${NC} $1"; }
log_success() { echo -e "${GREEN}✔ [Frame Deploy]${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠ [Frame Deploy]${NC} $1"; }
log_error() { echo -e "${RED}✖ [Frame Deploy]${NC} $1"; }
log_header() {
  echo -e "\n${PURPLE}============================================================${NC}"
  echo -e "${PURPLE}  $1${NC}"
  echo -e "${PURPLE}============================================================${NC}\n"
}

check_prerequisites() {
  log_info "Verifying prerequisites..."

  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js is not installed. Please install Node.js (v18+) to proceed."
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log_error "npm is not installed. Please install npm to proceed."
    exit 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log_warn "Docker is not installed or not in PATH. Containerized deployment will not be available."
  else
    log_success "Docker is available: $(docker --version)"
  fi

  log_success "Core prerequisites verified."
}

build_artifacts() {
  log_header "Building Production Artifacts"

  log_info "1. Building Backend..."
  cd "$AGENTPAY_DIR/backend"
  npm ci
  npm run build
  log_success "Backend built successfully (dist/ ready with migrations)."

  log_info "2. Building Frontend..."
  cd "$AGENTPAY_DIR/frontend"
  npm ci
  npm run build
  log_success "Frontend built successfully (standalone bundle ready)."

  cd "$ROOT_DIR"
}

run_migrations() {
  log_header "Running Database Migrations"

  if [ -z "${DATABASE_URL:-}" ]; then
    if [ -f "$AGENTPAY_DIR/backend/.env" ]; then
      log_info "Loading DATABASE_URL from agentpay/backend/.env"
      export $(grep -v '^#' "$AGENTPAY_DIR/backend/.env" | grep -E '^DATABASE_URL=' | xargs)
    fi
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    log_error "DATABASE_URL is not set. Cannot run migrations without database connection string."
    exit 1
  fi

  cd "$AGENTPAY_DIR/backend"
  npm run db:migrate:prod
  log_success "Database migrations applied successfully."
  cd "$ROOT_DIR"
}

deploy_docker_prod() {
  log_header "Starting Production Stack with Docker Compose"

  cd "$AGENTPAY_DIR"
  if [ ! -f "docker-compose.prod.yml" ]; then
    log_error "docker-compose.prod.yml not found in $AGENTPAY_DIR"
    exit 1
  fi

  log_info "Building and starting production containers in background..."
  docker compose -f docker-compose.prod.yml up -d --build

  log_info "Waiting for services to become healthy..."
  sleep 5

  docker compose -f docker-compose.prod.yml ps
  log_success "Frame Production Stack is running!"
  echo ""
  echo -e "  ${GREEN}Frontend Dashboard:${NC} http://localhost:80 (or port configured in PORT_HTTP)"
  echo -e "  ${GREEN}Backend API Health:${NC} http://localhost:3001/health"
  echo ""
  cd "$ROOT_DIR"
}

show_cloud_guides() {
  log_header "Cloud Deployment Options"

  echo -e "${BLUE}1. Render Blueprint (Recommended for quick live setup):${NC}"
  echo "   - Connect your GitHub repository to Render (https://render.com)."
  echo "   - Create a 'New Blueprint Instance'."
  echo "   - Render will automatically parse 'render.yaml' and provision:"
  echo "       • Managed PostgreSQL (frame-postgres)"
  echo "       • Managed Redis (frame-redis)"
  echo "       • Backend API Web Service (frame-backend)"
  echo "       • Frontend Web Service (frame-frontend)"
  echo ""
  echo -e "${BLUE}2. Railway / Fly.io / VPS:${NC}"
  echo "   - Point the deployment to 'agentpay/docker-compose.prod.yml'."
  echo "   - Provide the production environment variables (see .env.production.example)."
  echo ""
  echo -e "${BLUE}3. Vercel (Frontend only) + Cloud Backend:${NC}"
  echo "   - Deploy 'agentpay/frontend' to Vercel."
  echo "   - Set NEXT_PUBLIC_API_URL to your deployed backend URL."
  echo ""
}

start_tunnel() {
  log_header "Free Instant Public HTTPS Tunnel"
  log_info "Creating instant free public tunnel for Frontend (port 3000)..."
  echo ""
  echo -e "${GREEN}Running localtunnel on port 3000...${NC}"
  echo -e "Press Ctrl+C anytime to stop."
  echo ""
  npx localtunnel --port 3000
}

print_help() {
  cat << EOF
Frame Deployment CLI

Usage:
  ./scripts/deploy.sh [command]

Commands:
  tunnel       Start an instant, 100% free public HTTPS tunnel for live testing
  check        Verify all dependencies and environment prerequisites
  build        Build production bundles for both backend and frontend
  migrate      Apply database schema migrations
  prod         Build and launch complete production stack via Docker Compose
  cloud        Display step-by-step 100% free cloud deployment guide (Render/Vercel)
  help         Display this help message

Examples:
  ./scripts/deploy.sh tunnel
  ./scripts/deploy.sh check
  ./scripts/deploy.sh prod
EOF
}

# Main routing
CMD="${1:-help}"

case "$CMD" in
  tunnel)
    start_tunnel
    ;;
  check)
    check_prerequisites
    ;;
  build)
    check_prerequisites
    build_artifacts
    ;;
  migrate)
    run_migrations
    ;;
  prod)
    check_prerequisites
    deploy_docker_prod
    ;;
  cloud)
    show_cloud_guides
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    log_error "Unknown command: $CMD"
    print_help
    exit 1
    ;;
esac
