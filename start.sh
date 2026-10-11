#!/bin/bash
# Start the A2A game server with API key from config
export OPENROUTER_API_KEY="$(cat "$HOME/prototypage_key.config")"
cd /tmp/poc-dockeragent
exec node server.js