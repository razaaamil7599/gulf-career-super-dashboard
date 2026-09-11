#!/usr/bin/env bash
# Cloud Run deploy script for gulf-career-super-dashboard
# Run from inside the project folder in Cloud Shell.

set -euo pipefail

SERVICE_NAME="gulf-career-dashboard"
REGION="asia-south1"
PROJECT_ID="gen-lang-client-0253136401"
# PROJECT_ID="$(gcloud config get-value project 2>/dev/null)"

if [ -z "${PROJECT_ID}" ]; then
  echo "No active gcloud project. Set it with: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

echo "Project : ${PROJECT_ID}"
echo "Service : ${SERVICE_NAME}"
echo "Region  : ${REGION}"
echo

# Enable required APIs once (no-op if already enabled).
echo "Enabling Cloud Run, Cloud Build, and Artifact Registry APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="${PROJECT_ID}"

echo
echo "Deploying to Cloud Run (this builds the container via Cloud Build first)..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 3 \
  --env-vars-file env-vars.yaml \
  --project "${PROJECT_ID}"

echo
echo "Done. Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --format='value(status.url)' \
  --project "${PROJECT_ID}"
