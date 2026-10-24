#!/usr/bin/env bash
# Start n8n for Draft Desk on macOS or Linux. Keep this terminal open while you want drafts.
# Execute Command is off by default since n8n 2.0; NODES_EXCLUDE below turns it back on.
cd "$(dirname "$0")"
export NODES_EXCLUDE='["n8n-nodes-base.localFileTrigger"]'
export N8N_RESTRICT_FILE_ACCESS_TO="$(pwd)"
export N8N_LISTEN_ADDRESS=127.0.0.1
exec n8n start
