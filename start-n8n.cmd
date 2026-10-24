@echo off
rem Start n8n for Draft Desk on Windows. Keep this window open while you want drafts.
rem Execute Command is off by default since n8n 2.0; NODES_EXCLUDE below turns it back on.
set NODES_EXCLUDE=["n8n-nodes-base.localFileTrigger"]
set N8N_RESTRICT_FILE_ACCESS_TO=%~dp0
set N8N_LISTEN_ADDRESS=127.0.0.1
n8n start
