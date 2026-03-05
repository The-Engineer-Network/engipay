#!/bin/bash
set -e

echo "Running database migrations..."
npm run migrate

echo "Starting server..."
npm start
