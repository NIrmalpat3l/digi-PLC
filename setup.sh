#!/bin/bash
# setup.sh - Environment initialization script for the client laptop

echo "Starting setup..."

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "Node.js could not be found. Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "Node.js is installed. Version: $(node -v)"

# Setup Gateway
echo "Setting up Gateway..."
cd gateway || exit
if [ ! -d "node_modules" ]; then
    echo "Installing Gateway dependencies..."
    npm install
else
    echo "Gateway dependencies are already installed. Skipping..."
fi
cd ..

echo "Setup complete! You can now start the applications."
